mod cli;
mod display;
mod geocoder;
mod json;
mod weather;

use clap::Parser;
use cli::Args;

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let args = Args::parse();

    let loc = match geocoder::geocode(&args.city).await {
        Ok(loc) => loc,
        Err(e) => {
            let msg = e.to_string();
            if msg.contains("not found") {
                eprintln!("City '{}' not found. Try a different spelling.", args.city);
            } else if is_network_error(&msg) {
                eprintln!("Could not connect. Check your internet connection.");
            } else {
                eprintln!("Unexpected response from weather service.");
            }
            std::process::exit(1);
        }
    };

    let data = match weather::fetch_weather(&loc, args.days, &args.units).await {
        Ok(data) => data,
        Err(e) => {
            let msg = e.to_string();
            if is_network_error(&msg) {
                eprintln!("Could not connect. Check your internet connection.");
            } else {
                eprintln!("Unexpected response from weather service.");
            }
            std::process::exit(1);
        }
    };

    if args.json {
        json::display_json(&data, &loc);
    } else {
        display::display_weather(&data, &loc);
    }
}

fn is_network_error(msg: &str) -> bool {
    let lower = msg.to_lowercase();
    lower.contains("connect")
        || lower.contains("dns")
        || lower.contains("network")
        || lower.contains("timeout")
        || lower.contains("resolve")
}
