mod ascii_art;
mod display;
mod geocode;
mod weather;

use clap::Parser;

#[derive(Parser)]
#[command(name = "weather", about = "A friendly weather CLI")]
struct Args {
    /// City name (e.g., "london" or "new york")
    city: Vec<String>,

    /// Unit system
    #[arg(long, default_value = "metric")]
    units: String,

    /// Number of forecast days (1-7)
    #[arg(long, default_value = "7")]
    days: u8,
}

fn main() {
    let args = Args::parse();
    let city = args.city.join(" ");
    if city.is_empty() {
        eprintln!("\u{26a0}\u{fe0f}  Please provide a city name. Example: weather london");
        std::process::exit(2);
    }
    println!("Weather CLI stub — city: {city}, units: {}, days: {}", args.units, args.days);
}
