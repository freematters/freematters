use anyhow::Result;
use clap::{Parser, Subcommand, ValueEnum};

use weather_cli::format::{format_current, format_forecast};
use weather_cli::geocode::geocode;
use weather_cli::models::Units;
use weather_cli::weather::{fetch_current, fetch_forecast};

#[derive(Parser)]
#[command(name = "weather-cli", about = "Get weather information for any city")]
struct Cli {
    /// Temperature units
    #[arg(long, value_enum, global = true, default_value_t = UnitArg::Celsius)]
    units: UnitArg,

    /// Language for location names (e.g., zh, ja, de, fr, es)
    #[arg(long, global = true)]
    lang: Option<String>,

    #[command(subcommand)]
    command: Command,
}

#[derive(Clone, Copy, ValueEnum)]
enum UnitArg {
    Celsius,
    Fahrenheit,
}

impl From<UnitArg> for Units {
    fn from(arg: UnitArg) -> Self {
        match arg {
            UnitArg::Celsius => Units::Celsius,
            UnitArg::Fahrenheit => Units::Fahrenheit,
        }
    }
}

#[derive(Subcommand)]
enum Command {
    /// Show current weather for a location
    Now {
        /// City name to look up
        location: String,
    },
    /// Show multi-day forecast for a location
    Forecast {
        /// City name to look up
        location: String,
        /// Number of forecast days (1-16)
        #[arg(long, default_value_t = 5)]
        days: u8,
    },
}

#[tokio::main]
async fn main() {
    let cli = Cli::parse();
    let units: Units = cli.units.into();

    let lang = cli.lang;

    if let Err(e) = run(cli.command, units, lang.as_deref()).await {
        // Walk the anyhow error chain to find the most user-friendly message.
        // The outermost context is typically the user-facing message we attached.
        eprintln!("{e}");
        std::process::exit(1);
    }
}

async fn run(command: Command, units: Units, lang: Option<&str>) -> Result<()> {
    match command {
        Command::Now { location } => {
            let loc = geocode(&location, lang).await?;
            let weather = fetch_current(&loc, units).await?;
            println!("{}", format_current(&loc, &weather, units));
        }
        Command::Forecast { location, days } => {
            let loc = geocode(&location, lang).await?;
            let forecast = fetch_forecast(&loc, days, units).await?;
            println!("{}", format_forecast(&loc, &forecast, units));
        }
    }
    Ok(())
}
