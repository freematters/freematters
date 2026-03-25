use clap::{Parser, ValueEnum};

#[derive(Debug, Clone, ValueEnum, PartialEq)]
pub enum Units {
    Metric,
    Imperial,
}

/// A command-line weather tool that fetches weather data from the Open-Meteo API.
#[derive(Parser, Debug)]
#[command(name = "weather", version, about)]
pub struct Args {
    /// City name to look up
    pub city: String,

    /// Number of forecast days (1-16)
    #[arg(long, default_value_t = 7, value_parser = clap::value_parser!(u8).range(1..=16))]
    pub days: u8,

    /// Output as JSON instead of formatted text
    #[arg(long, default_value_t = false)]
    pub json: bool,

    /// Unit system for temperature and wind speed
    #[arg(long, value_enum, default_value_t = Units::Metric)]
    pub units: Units,
}

#[cfg(test)]
mod tests {
    use super::*;
    use clap::Parser;

    #[test]
    fn test_default_values() {
        let args = Args::parse_from(["weather", "London"]);
        assert_eq!(args.city, "London");
        assert_eq!(args.days, 7);
        assert!(!args.json);
        assert_eq!(args.units, Units::Metric);
    }

    #[test]
    fn test_days_flag() {
        let args = Args::parse_from(["weather", "London", "--days", "3"]);
        assert_eq!(args.days, 3);
    }

    #[test]
    fn test_invalid_days_zero() {
        let result = Args::try_parse_from(["weather", "London", "--days", "0"]);
        assert!(result.is_err());
    }

    #[test]
    fn test_invalid_days_too_high() {
        let result = Args::try_parse_from(["weather", "London", "--days", "20"]);
        assert!(result.is_err());
    }

    #[test]
    fn test_json_flag() {
        let args = Args::parse_from(["weather", "London", "--json"]);
        assert!(args.json);
    }

    #[test]
    fn test_units_imperial() {
        let args = Args::parse_from(["weather", "London", "--units", "imperial"]);
        assert_eq!(args.units, Units::Imperial);
    }
}
