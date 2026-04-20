import sqlite3

import pytest

from freejail.models import Mount
from freejail.shell.db import Database


@pytest.fixture
def db(tmp_path):
    db_path = tmp_path / "test.db"
    return Database(str(db_path))


def test_insert_and_get(db):
    db.insert_container(
        name="test1",
        app_container_id="app-abc",
        proxy_container_id="proxy-def",
        network_name="fj-test1",
        subnet_index=1,
        config_path="/tmp/config.yaml",
        cli_mounts=[Mount(source="/x", target="/y", options="rw")],
        mounts=[Mount(source="/a", target="/b", options="ro")],
        env_vars={"ANTHROPIC_API_KEY": "sk-test"},
        cwd_path="/home/user/project",
    )
    record = db.get_tracked("test1")
    assert record is not None
    assert record.name == "test1"
    assert record.tracked is True
    assert record.app_container_id == "app-abc"
    assert record.cli_mounts[0].source == "/x"
    assert record.mounts[0].source == "/a"
    assert record.env_vars["ANTHROPIC_API_KEY"] == "sk-test"
    assert record.cwd_path == "/home/user/project"


def test_get_tracked_returns_none_for_missing(db):
    assert db.get_tracked("nonexistent") is None


def test_untrack(db):
    db.insert_container(
        name="test1",
        app_container_id="app-abc",
        proxy_container_id="proxy-def",
        network_name="fj-test1",
        subnet_index=1,
        config_path=None,
        cli_mounts=[],
        mounts=[],
        env_vars={},
        cwd_path="/tmp",
    )
    db.untrack("test1")
    assert db.get_tracked("test1") is None


def test_list_tracked(db):
    for i in range(3):
        db.insert_container(
            name=f"c{i}",
            app_container_id=f"app-{i}",
            proxy_container_id=f"proxy-{i}",
            network_name=f"fj-c{i}",
            subnet_index=i + 1,
            config_path=None,
            cli_mounts=[],
            mounts=[],
            env_vars={},
            cwd_path="/tmp",
        )
    db.untrack("c1")
    tracked = db.list_tracked()
    names = [r.name for r in tracked]
    assert "c0" in names
    assert "c2" in names
    assert "c1" not in names


def test_used_subnet_indices(db):
    db.insert_container(
        name="a",
        app_container_id="app-a",
        proxy_container_id="proxy-a",
        network_name="fj-a",
        subnet_index=3,
        config_path=None,
        cli_mounts=[],
        mounts=[],
        env_vars={},
        cwd_path="/tmp",
    )
    db.insert_container(
        name="b",
        app_container_id="app-b",
        proxy_container_id="proxy-b",
        network_name="fj-b",
        subnet_index=7,
        config_path=None,
        cli_mounts=[],
        mounts=[],
        env_vars={},
        cwd_path="/tmp",
    )
    assert db.used_subnet_indices() == {3, 7}


def test_name_uniqueness_for_tracked(db):
    db.insert_container(
        name="dup",
        app_container_id="app-1",
        proxy_container_id="proxy-1",
        network_name="fj-dup",
        subnet_index=1,
        config_path=None,
        cli_mounts=[],
        mounts=[],
        env_vars={},
        cwd_path="/tmp",
    )
    with pytest.raises(sqlite3.IntegrityError):
        db.insert_container(
            name="dup",
            app_container_id="app-2",
            proxy_container_id="proxy-2",
            network_name="fj-dup2",
            subnet_index=2,
            config_path=None,
            cli_mounts=[],
            mounts=[],
            env_vars={},
            cwd_path="/tmp",
        )


def test_reuse_name_after_untrack(db):
    db.insert_container(
        name="reuse",
        app_container_id="app-1",
        proxy_container_id="proxy-1",
        network_name="fj-reuse",
        subnet_index=1,
        config_path=None,
        cli_mounts=[],
        mounts=[],
        env_vars={},
        cwd_path="/tmp",
    )
    db.untrack("reuse")
    db.insert_container(
        name="reuse",
        app_container_id="app-2",
        proxy_container_id="proxy-2",
        network_name="fj-reuse2",
        subnet_index=2,
        config_path=None,
        cli_mounts=[],
        mounts=[],
        env_vars={},
        cwd_path="/tmp",
    )
    record = db.get_tracked("reuse")
    assert record is not None
    assert record.app_container_id == "app-2"


def test_schema_version(db):
    version = db.schema_version()
    assert version == 2
