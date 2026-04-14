"""Pydantic models for freejail."""

from datetime import datetime

from pydantic import BaseModel


class EgressRule(BaseModel):
    host: str


class EgressRewrite(BaseModel):
    from_host: str
    to_url: str
    headers: dict[str, str] = {}


class EgressPolicy(BaseModel):
    allowed: list[EgressRule] = []
    rewrites: list[EgressRewrite] = []


class Mount(BaseModel):
    source: str
    target: str
    options: str = "rw"


class Resources(BaseModel):
    cpu_shares: int | None = None
    memory_mb: int | None = None
    pids_limit: int | None = None


class SiteConfig(BaseModel):
    """Profile configuration loaded from config.yaml."""

    egress: EgressPolicy = EgressPolicy()
    env_vars: dict[str, str] = {}
    mounts: list[Mount] = []
    captured_env_prefixes: list[str] = []


class ContainerConfig(BaseModel):
    image: str = "freematters/freejail:local_latest"
    command: list[str] = ["sleep", "infinity"]
    mounts: list[Mount] = []
    egress: EgressPolicy = EgressPolicy()
    resources: Resources = Resources()
    extra_args: list[str] = []


class ContainerRecord(BaseModel):
    """Persisted in SQLite."""

    id: int
    name: str
    tracked: bool
    app_container_id: str
    proxy_container_id: str
    network_name: str
    subnet_index: int
    config_path: str | None
    cli_mounts: list[Mount]
    mounts: list[Mount]
    env_vars: dict[str, str]
    cwd_path: str
    created_at: datetime
