mod cli;
mod display;
mod geocoder;
mod json;
mod weather;

use anyhow::Result;
use clap::Parser;
use cli::Args;

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<()> {
    let args = Args::parse();
    println!("Fetching weather for: {}", args.city);
    Ok(())
}
