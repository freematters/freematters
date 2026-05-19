mod cli;
mod client;
mod framed;
mod install;
mod proto;
mod server;
mod state;

use clap::Parser;

#[tokio::main(flavor = "multi_thread")]
async fn main() -> anyhow::Result<()> {
    let _ = tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info,glove=info")),
        )
        .with_writer(std::io::stderr)
        .try_init();

    let args = cli::Cli::parse();
    cli::dispatch(args).await
}
