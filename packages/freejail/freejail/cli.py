"""fj CLI — freejail command-line interface."""

import os
import pwd
import shutil
from pathlib import Path
from typing import Annotated

import typer
from rich.console import Console
from rich.table import Table

from freejail.constants import DATA_DIR_ENV, DATA_DIR_NAME
from freejail.core.config import merge_egress, parse_config_yaml
from freejail.core.dns import parse_nameservers
from freejail.core.egress import generate_addon_script
from freejail.core.env import capture_env_vars
from freejail.core.mounts import resolve_mounts
from freejail.core.subnet import next_subnet_index
from freejail.models import Mount
from freejail.profile import load_config
from freejail.shell import podman
from freejail.shell.ca import ca_dir, ensure_ca
from freejail.shell.db import Database

REQUIRED_BINARIES = ["podman", "runsc"]

app = typer.Typer(name="fj", help="freejail — container sandboxing CLI")
console = Console()


@app.callback()
def _check_deps() -> None:
    """Verify required external binaries are available."""
    missing = [b for b in REQUIRED_BINARIES if shutil.which(b) is None]
    if missing:
        console.print(f"[red]Error:[/red] missing required dependencies: {', '.join(missing)}")
        raise typer.Exit(1)


def _data_dir() -> Path:
    override = os.environ.get(DATA_DIR_ENV)
    if override:
        return Path(override)
    return Path.home() / DATA_DIR_NAME


def _db() -> Database:
    data = _data_dir()
    data.mkdir(parents=True, exist_ok=True)
    return Database(str(data / "freejail.db"))


def _read_resolv_conf() -> str:
    for path in ["/run/systemd/resolve/resolv.conf", "/etc/resolv.conf"]:
        p = Path(path)
        if p.exists():
            return p.read_text()
    return ""


def _parse_mount_arg(value: str) -> Mount:
    """Parse a -m 'host:container' or 'host:container:options' string."""
    parts = value.split(":")
    if len(parts) == 2:
        return Mount(source=parts[0], target=parts[1], options="rw")
    if len(parts) == 3:
        return Mount(source=parts[0], target=parts[1], options=parts[2])
    raise typer.BadParameter(f"Invalid mount format: {value}. Use host:container[:options]")


def _apply_inner(
    name: str,
    db: Database,
    config_path: str | None,
    cwd: str,
    cli_mounts: list[Mount],
) -> None:
    """Core apply logic shared by apply and restart."""
    # 1. Load site/defaults profile
    site_config = load_config()

    # 2. Parse user config
    config_content = ""
    if config_path:
        p = Path(config_path)
        if p.exists():
            config_content = p.read_text()
        else:
            console.print(f"[yellow]Warning:[/yellow] Config file '{config_path}' not found, using defaults.")
            config_path = None
    user_config = parse_config_yaml(config_content)

    # 3. Merge egress
    merged_egress = merge_egress(site_config.egress, user_config.egress)
    config = user_config.model_copy(update={"egress": merged_egress})

    # 4. Resolve mounts
    home_dir = str(Path.home())
    host_user = pwd.getpwuid(os.getuid()).pw_name
    container_home = home_dir
    cert_path = ensure_ca(home_dir)
    all_mounts = resolve_mounts(
        cwd=cwd,
        home_dir=home_dir,
        container_home=container_home,
        ca_cert_path=cert_path,
        default_mounts=site_config.mounts,
        config_mounts=config.mounts,
        cli_mounts=cli_mounts,
    )

    # 5. Capture env vars
    env_vars = capture_env_vars(dict(os.environ), site_config.captured_env_prefixes)
    env_vars["FJ_USER"] = host_user
    env_vars["FJ_HOME"] = container_home

    # 6. Generate addon script
    run_dir = _data_dir() / "run" / name
    run_dir.mkdir(parents=True, exist_ok=True)
    addon_path = run_dir / "addon.py"
    addon_script = generate_addon_script(merged_egress, name)
    addon_path.write_text(addon_script)

    # 7. Allocate subnet
    used = db.used_subnet_indices()
    subnet_index = next_subnet_index(used)

    # 8. DNS
    dns_servers = parse_nameservers(_read_resolv_conf())

    # 9. Ensure container images are available
    podman.ensure_app_image()
    podman.ensure_proxy_image()

    # 10. Create resources (with cleanup on failure)
    network_name: str | None = None
    proxy_id: str | None = None
    app_id: str | None = None
    try:
        podman.ensure_external_network()
        network_name = podman.create_network(name, subnet_index)
        proxy_id = podman.start_proxy(
            name=name,
            network_name=network_name,
            subnet_index=subnet_index,
            ca_dir=str(ca_dir(home_dir)),
            addon_path=str(addon_path),
            dns_servers=dns_servers,
        )
        app_id = podman.start_app(
            name=name,
            network_name=network_name,
            subnet_index=subnet_index,
            config=config,
            mounts=all_mounts,
            env_vars=env_vars,
            container_env_vars=site_config.env_vars,
            dns_servers=dns_servers,
        )
    except Exception as e:
        if app_id:
            podman.stop_and_remove(f"fj-app-{name}")
        if proxy_id:
            podman.stop_and_remove(f"fj-proxy-{name}")
        if network_name:
            podman.remove_network(network_name)
        if run_dir.exists():
            shutil.rmtree(run_dir)
        console.print(f"[red]Error:[/red] {e}")
        raise typer.Exit(1) from None

    # 11. Record in DB
    db.insert_container(
        name=name,
        app_container_id=app_id,
        proxy_container_id=proxy_id,
        network_name=network_name,
        subnet_index=subnet_index,
        config_path=config_path,
        cli_mounts=cli_mounts,
        mounts=all_mounts,
        env_vars=env_vars,
        cwd_path=cwd,
    )
    console.print(f"[green]Created[/green] '{name}' (subnet 21.18.{subnet_index}.0/24)")


def _rm_inner(name: str, db: Database) -> None:
    """Core rm logic shared by rm and restart."""
    record = db.get_tracked(name)
    if record is None:
        console.print(f"[red]Error:[/red] '{name}' not found.")
        raise typer.Exit(1)

    podman.stop_and_remove(f"fj-app-{name}")
    podman.stop_and_remove(f"fj-proxy-{name}")
    podman.remove_network(record.network_name)

    run_dir = _data_dir() / "run" / name
    if run_dir.exists():
        shutil.rmtree(run_dir)

    db.untrack(name)


@app.command()
def apply(
    name: Annotated[str, typer.Argument(help="Container name")],
    config_file: Annotated[str | None, typer.Option("-f", help="Config YAML file")] = None,
    mounts: Annotated[
        list[str] | None,
        typer.Option("-m", help="Extra mounts (host:container[:options])"),
    ] = None,
) -> None:
    """Create and start a sandboxed container environment."""
    db = _db()

    if db.get_tracked(name) is not None:
        console.print(f"[red]Error:[/red] '{name}' is already tracked. Run 'fj rm {name}' first.")
        raise typer.Exit(1)

    config_path: str | None = None
    if config_file:
        config_path = str(Path(config_file).resolve())

    cli_mount_list = [_parse_mount_arg(m) for m in (mounts or [])]
    _apply_inner(name, db, config_path, str(Path.cwd()), cli_mount_list)


@app.command(name="ls")
def list_containers() -> None:
    """List all tracked containers."""
    db = _db()
    records = db.list_tracked()
    if not records:
        console.print("No tracked containers.")
        return
    table = Table()
    table.add_column("Name")
    table.add_column("Subnet")
    table.add_column("CWD")
    table.add_column("Created")
    for r in records:
        table.add_row(
            r.name,
            f"21.18.{r.subnet_index}.0/24",
            r.cwd_path,
            r.created_at.strftime("%Y-%m-%d %H:%M"),
        )
    console.print(table)


@app.command()
def exec(
    name: Annotated[str, typer.Argument(help="Container name")],
    command: Annotated[list[str] | None, typer.Argument(help="Command to run (default: claude)")] = None,
) -> None:
    """Exec into a tracked container."""
    db = _db()
    record = db.get_tracked(name)
    if record is None:
        console.print(f"[red]Error:[/red] '{name}' not found.")
        raise typer.Exit(1)
    cmd = command if command else ["claude"]
    if cmd[0] == "claude" and "--dangerously-skip-permissions" not in cmd:
        cmd.append("--dangerously-skip-permissions")
    # execvp replaces the process — this line never returns
    container_home = str(Path.home())
    podman.exec_container(name, record.cwd_path, cmd, container_home=container_home)


@app.command()
def restart(
    name: Annotated[str, typer.Argument(help="Container name")],
) -> None:
    """Restart a tracked container (rm + apply with same config)."""
    db = _db()
    record = db.get_tracked(name)
    if record is None:
        console.print(f"[red]Error:[/red] '{name}' not found.")
        raise typer.Exit(1)

    config_path = record.config_path
    cwd = record.cwd_path
    cli_mounts = record.cli_mounts

    _rm_inner(name, db)
    console.print(f"[green]Removed[/green] '{name}', re-creating...")
    _apply_inner(name, db, config_path, cwd, cli_mounts)


@app.command()
def rm(
    name: Annotated[str, typer.Argument(help="Container name")],
) -> None:
    """Stop and remove a tracked container."""
    db = _db()
    _rm_inner(name, db)
    console.print(f"[green]Removed[/green] '{name}'")
