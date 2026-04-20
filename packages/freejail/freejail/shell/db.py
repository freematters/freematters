"""SQLite database for container record tracking."""

import json
import sqlite3
from datetime import UTC, datetime

from freejail.models import ContainerRecord, Mount

CURRENT_SCHEMA_VERSION = 2

MIGRATIONS: dict[int, list[str]] = {
    1: [
        """\
CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER NOT NULL
)""",
        """\
CREATE TABLE IF NOT EXISTS containers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    tracked BOOLEAN NOT NULL DEFAULT 1,
    app_container_id TEXT NOT NULL,
    proxy_container_id TEXT NOT NULL,
    network_name TEXT NOT NULL,
    subnet_index INTEGER NOT NULL,
    config_path TEXT,
    mounts TEXT NOT NULL,
    env_vars TEXT NOT NULL,
    cwd_path TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
)""",
        """\
CREATE UNIQUE INDEX IF NOT EXISTS idx_tracked_name
    ON containers(name) WHERE tracked = 1""",
    ],
    2: [
        """\
ALTER TABLE containers ADD COLUMN cli_mounts TEXT NOT NULL DEFAULT '[]'""",
    ],
}


class Database:
    def __init__(self, db_path: str) -> None:
        self._conn = sqlite3.connect(db_path)
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.row_factory = sqlite3.Row
        self._migrate()

    def _migrate(self) -> None:
        cursor = self._conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'")
        current_version = 0
        if cursor.fetchone():
            row = self._conn.execute("SELECT MAX(version) FROM schema_version").fetchone()
            if row and row[0] is not None:
                current_version = row[0]

        for version in range(current_version + 1, CURRENT_SCHEMA_VERSION + 1):
            for sql in MIGRATIONS[version]:
                self._conn.execute(sql)
            if current_version == 0 and version == 1:
                self._conn.execute("INSERT INTO schema_version (version) VALUES (?)", (version,))
            else:
                self._conn.execute("UPDATE schema_version SET version = ?", (version,))
            self._conn.commit()

    def schema_version(self) -> int:
        row = self._conn.execute("SELECT MAX(version) FROM schema_version").fetchone()
        return row[0] if row and row[0] is not None else 0

    def insert_container(
        self,
        name: str,
        app_container_id: str,
        proxy_container_id: str,
        network_name: str,
        subnet_index: int,
        config_path: str | None,
        cli_mounts: list[Mount],
        mounts: list[Mount],
        env_vars: dict[str, str],
        cwd_path: str,
    ) -> int:
        cli_mounts_json = json.dumps([m.model_dump() for m in cli_mounts])
        mounts_json = json.dumps([m.model_dump() for m in mounts])
        env_json = json.dumps(env_vars)
        cursor = self._conn.execute(
            """\
INSERT INTO containers
    (name, tracked, app_container_id, proxy_container_id, network_name,
     subnet_index, config_path, cli_mounts, mounts, env_vars, cwd_path, created_at)
VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                name,
                app_container_id,
                proxy_container_id,
                network_name,
                subnet_index,
                config_path,
                cli_mounts_json,
                mounts_json,
                env_json,
                cwd_path,
                datetime.now(tz=UTC).isoformat(),
            ),
        )
        self._conn.commit()
        assert cursor.lastrowid is not None
        return cursor.lastrowid

    def get_tracked(self, name: str) -> ContainerRecord | None:
        row = self._conn.execute("SELECT * FROM containers WHERE name = ? AND tracked = 1", (name,)).fetchone()
        if row is None:
            return None
        return self._row_to_record(row)

    def list_tracked(self) -> list[ContainerRecord]:
        rows = self._conn.execute("SELECT * FROM containers WHERE tracked = 1 ORDER BY created_at").fetchall()
        return [self._row_to_record(r) for r in rows]

    def untrack(self, name: str) -> None:
        self._conn.execute(
            "UPDATE containers SET tracked = 0 WHERE name = ? AND tracked = 1",
            (name,),
        )
        self._conn.commit()

    def used_subnet_indices(self) -> set[int]:
        rows = self._conn.execute("SELECT subnet_index FROM containers WHERE tracked = 1").fetchall()
        return {row[0] for row in rows}

    def _row_to_record(self, row: sqlite3.Row) -> ContainerRecord:
        cli_mounts_data = json.loads(row["cli_mounts"])
        mounts_data = json.loads(row["mounts"])
        return ContainerRecord(
            id=row["id"],
            name=row["name"],
            tracked=bool(row["tracked"]),
            app_container_id=row["app_container_id"],
            proxy_container_id=row["proxy_container_id"],
            network_name=row["network_name"],
            subnet_index=row["subnet_index"],
            config_path=row["config_path"],
            cli_mounts=[Mount.model_validate(m) for m in cli_mounts_data],
            mounts=[Mount.model_validate(m) for m in mounts_data],
            env_vars=json.loads(row["env_vars"]),
            cwd_path=row["cwd_path"],
            created_at=datetime.fromisoformat(row["created_at"]),
        )
