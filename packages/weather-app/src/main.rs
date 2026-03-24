mod ascii_art;
mod display;
mod geocode;
mod weather;

use clap::Parser;
use colored::*;
use indicatif::{ProgressBar, ProgressStyle};
use std::time::Duration;
use weather::Units;

#[derive(Parser)]
#[command(name = "weather", about = "A friendly weather CLI ⛅")]
struct Args {
    /// City name (e.g., "london" or "new york")
    city: Vec<String>,

    /// Unit system: metric or imperial
    #[arg(long, default_value = "metric")]
    units: String,

    /// Number of forecast days (1-7)
    #[arg(long, default_value = "7")]
    days: u8,
}

fn parse_units(s: &str) -> Result<Units, String> {
    match s.to_lowercase().as_str() {
        "metric" => Ok(Units::Metric),
        "imperial" => Ok(Units::Imperial),
        other => Err(format!(
            "Unknown unit system '{other}'. Use 'metric' or 'imperial'."
        )),
    }
}

fn run(args: Args) -> Result<(), String> {
    let city = args.city.join(" ");
    if city.is_empty() {
        return Err("Please provide a city name. Example: weather london".to_string());
    }

    let units = parse_units(&args.units)?;
    let days = args.days.clamp(1, 7);

    // Spinner
    let spinner = ProgressBar::new_spinner();
    spinner.set_style(
        ProgressStyle::default_spinner()
            .template("{spinner:.cyan} {msg}")
            .unwrap(),
    );
    spinner.enable_steady_tick(Duration::from_millis(80));
    spinner.set_message(format!("Fetching weather for {city}..."));

    // Geocode
    let location = geocode::geocode(&city).map_err(|e| {
        if e.contains("City not found") {
            format!("Hmm, I couldn't find '{city}'. Double-check the spelling or try a nearby city?")
        } else {
            format!("Looks like I can't reach the weather service right now. Check your internet connection and try again!")
        }
    })?;

    // Fetch weather
    let data = weather::fetch_weather(location.latitude, location.longitude, &units, days)
        .map_err(|_| {
            "Something went wrong fetching the weather. Try again in a moment?".to_string()
        })?;

    spinner.finish_and_clear();

    // Display
    let current_output = display::format_current(&location, &data.current, &units);
    let forecast_output = display::format_forecast(&data.daily, &units);

    println!();
    println!("{current_output}");
    println!();
    println!("{forecast_output}");
    println!();

    Ok(())
}

fn main() {
    let args = Args::parse();
    if let Err(e) = run(args) {
        eprintln!("{} {}", "\u{26a0}\u{fe0f} ".yellow(), e.yellow());
        std::process::exit(1);
    }
}
