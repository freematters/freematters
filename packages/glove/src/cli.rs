use clap::{Parser, Subcommand};
use std::path::PathBuf;

#[derive(Parser, Debug)]
#[command(name = "glove", version, about = "remote shell-exec & file-transfer agent")]
pub struct Cli {
    #[command(subcommand)]
    pub cmd: Cmd,
}

#[derive(Subcommand, Debug)]
pub enum Cmd {
    /// Start the glove server (foreground).
    Start {
        /// Skip cloudflared, bind to 127.0.0.1 only (LOCAL_MODE).
        #[arg(long)]
        local: bool,
        /// Bind address (default 127.0.0.1).
        #[arg(long, default_value = "127.0.0.1")]
        bind: String,
        /// Bind port. 0 = auto-pick.
        #[arg(long, default_value_t = 0)]
        port: u16,
        /// Override public base URL (advanced).
        #[arg(long)]
        public_url: Option<String>,
    },
    /// List currently connected clients.
    List,
    /// Run a shell command on the named client.
    Exec {
        name: String,
        /// Command and args after `--`.
        #[arg(trailing_var_arg = true, allow_hyphen_values = true, required = true)]
        cmd: Vec<String>,
    },
    /// Push a local file to the named client.
    Push {
        name: String,
        local: PathBuf,
        remote: String,
    },
    /// Pull a remote file from the named client to a local path.
    Pull {
        name: String,
        remote: String,
        local: PathBuf,
    },
    /// (hidden) Run as client daemon. Token comes from --token or $GLOVE_TOKEN.
    #[command(name = "_client", hide = true)]
    Client {
        #[arg(long)]
        server: String,
        #[arg(long)]
        name: String,
        #[arg(long)]
        token: Option<String>,
    },
}

pub async fn dispatch(cli: Cli) -> anyhow::Result<()> {
    match cli.cmd {
        Cmd::Start {
            local,
            bind,
            port,
            public_url,
        } => crate::server::run_start(local, bind, port, public_url).await,
        Cmd::List => crate::server::ctl_list().await,
        Cmd::Exec { name, cmd } => crate::server::ctl_exec(name, cmd).await,
        Cmd::Push { name, local, remote } => {
            crate::server::ctl_push(name, local, remote).await
        }
        Cmd::Pull { name, remote, local } => {
            crate::server::ctl_pull(name, remote, local).await
        }
        Cmd::Client { server, name, token } => {
            let token = token
                .or_else(|| std::env::var("GLOVE_TOKEN").ok())
                .ok_or_else(|| anyhow::anyhow!("token must be provided via --token or $GLOVE_TOKEN"))?;
            crate::client::run(server, name, token).await
        }
    }
}
