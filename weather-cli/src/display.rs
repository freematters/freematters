// Terminal formatter module — renders weather data with colors and emoji.

use colored::Colorize;

use crate::geocoder::Location;
use crate::weather::{Current, DayForecast, HourForecast, WeatherData};

/// Returns (emoji, description) for a WMO weather code.
pub fn weather_code_to_emoji(code: u8) -> (&'static str, &'static str) {
    match code {
        0 => ("\u{2600}\u{fe0f}", "Clear sky"),
        1..=3 => ("\u{26c5}", "Partly cloudy"),
        45 | 48 => ("\u{1f32b}\u{fe0f}", "Fog"),
        51..=55 => ("\u{1f326}\u{fe0f}", "Drizzle"),
        61..=65 => ("\u{1f327}\u{fe0f}", "Rain"),
        71..=77 => ("\u{1f328}\u{fe0f}", "Snow"),
        80..=82 => ("\u{1f327}\u{fe0f}", "Rain showers"),
        85..=86 => ("\u{1f328}\u{fe0f}", "Snow showers"),
        95..=99 => ("\u{26c8}\u{fe0f}", "Thunderstorm"),
        _ => ("\u{2753}", "Unknown"),
    }
}

/// Colorize a temperature value based on its range.
/// Blue for cold (<= 0), yellow for warm (1..=25), red for hot (> 25).
pub fn colorize_temp(temp: f64) -> colored::ColoredString {
    let text = format!("{:.1}", temp);
    if temp <= 0.0 {
        text.blue()
    } else if temp <= 25.0 {
        text.yellow()
    } else {
        text.red()
    }
}

/// Display formatted weather output to the terminal.
pub fn display_weather(data: &WeatherData, loc: &Location) {
    // Header
    println!(
        "{}",
        format!("Weather for {}, {}", loc.name, loc.country).bold()
    );
    println!();

    // Current conditions
    let (emoji, desc) = weather_code_to_emoji(data.current.weather_code);
    println!("{} {}", "Current conditions:".bold(), data.current.time);
    println!("  {} {}", emoji, desc);
    println!(
        "  Temperature: {}\u{00b0}  (feels like {}\u{00b0})",
        colorize_temp(data.current.temperature),
        colorize_temp(data.current.feels_like)
    );
    println!("  Humidity:    {:.0}%", data.current.humidity);
    println!(
        "  Wind:        {:.1} km/h ({:.0}\u{00b0})",
        data.current.wind_speed, data.current.wind_direction
    );
    println!();

    // Daily forecast
    if !data.daily.is_empty() {
        println!("{}", "Daily Forecast:".bold());
        println!(
            "  {:<12} {:>6} {:>6}  {:<4} {:>8}",
            "Date", "High", "Low", "", "Precip"
        );
        println!("  {}", "-".repeat(44));
        for day in &data.daily {
            let (day_emoji, _) = weather_code_to_emoji(day.weather_code);
            println!(
                "  {:<12} {:>6}\u{00b0} {:>6}\u{00b0}  {}  {:>5.0}%",
                day.date,
                colorize_temp(day.temp_max),
                colorize_temp(day.temp_min),
                day_emoji,
                day.precipitation_probability
            );
        }
        println!();
    }

    // Hourly forecast
    if !data.hourly.is_empty() {
        println!("{}", "Hourly Forecast:".bold());
        println!(
            "  {:<18} {:>6}  {:<4} {:>8} {:>8}",
            "Time", "Temp", "", "Wind", "Precip"
        );
        println!("  {}", "-".repeat(52));
        for hour in &data.hourly {
            let (hr_emoji, _) = weather_code_to_emoji(hour.weather_code);
            println!(
                "  {:<18} {:>6}\u{00b0}  {}  {:>5.1}km/h {:>5.0}%",
                hour.time,
                colorize_temp(hour.temperature),
                hr_emoji,
                hour.wind_speed,
                hour.precipitation_probability
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- Weather code mapping tests ---

    #[test]
    fn test_weather_code_clear_sky() {
        let (emoji, desc) = weather_code_to_emoji(0);
        assert_eq!(emoji, "\u{2600}\u{fe0f}"); // ☀️
        assert_eq!(desc, "Clear sky");
    }

    #[test]
    fn test_weather_code_partly_cloudy() {
        for code in [1, 2, 3] {
            let (emoji, desc) = weather_code_to_emoji(code);
            assert_eq!(emoji, "\u{26c5}"); // ⛅
            assert_eq!(desc, "Partly cloudy");
        }
    }

    #[test]
    fn test_weather_code_fog() {
        for code in [45, 48] {
            let (emoji, desc) = weather_code_to_emoji(code);
            assert_eq!(emoji, "\u{1f32b}\u{fe0f}"); // 🌫️
            assert_eq!(desc, "Fog");
        }
    }

    #[test]
    fn test_weather_code_drizzle() {
        for code in [51, 53, 55] {
            let (emoji, desc) = weather_code_to_emoji(code);
            assert_eq!(emoji, "\u{1f326}\u{fe0f}"); // 🌦️
            assert_eq!(desc, "Drizzle");
        }
    }

    #[test]
    fn test_weather_code_rain() {
        for code in [61, 63, 65] {
            let (emoji, desc) = weather_code_to_emoji(code);
            assert_eq!(emoji, "\u{1f327}\u{fe0f}"); // 🌧️
            assert_eq!(desc, "Rain");
        }
    }

    #[test]
    fn test_weather_code_snow() {
        for code in [71, 73, 75, 77] {
            let (emoji, desc) = weather_code_to_emoji(code);
            assert_eq!(emoji, "\u{1f328}\u{fe0f}"); // 🌨️
            assert_eq!(desc, "Snow");
        }
    }

    #[test]
    fn test_weather_code_rain_showers() {
        for code in [80, 81, 82] {
            let (emoji, desc) = weather_code_to_emoji(code);
            assert_eq!(emoji, "\u{1f327}\u{fe0f}"); // 🌧️
            assert_eq!(desc, "Rain showers");
        }
    }

    #[test]
    fn test_weather_code_snow_showers() {
        for code in [85, 86] {
            let (emoji, desc) = weather_code_to_emoji(code);
            assert_eq!(emoji, "\u{1f328}\u{fe0f}"); // 🌨️
            assert_eq!(desc, "Snow showers");
        }
    }

    #[test]
    fn test_weather_code_thunderstorm() {
        for code in [95, 96, 99] {
            let (emoji, desc) = weather_code_to_emoji(code);
            assert_eq!(emoji, "\u{26c8}\u{fe0f}"); // ⛈️
            assert_eq!(desc, "Thunderstorm");
        }
    }

    #[test]
    fn test_weather_code_unknown() {
        let (emoji, desc) = weather_code_to_emoji(255);
        assert_eq!(emoji, "\u{2753}"); // ❓
        assert_eq!(desc, "Unknown");
    }

    // --- Temperature color coding tests ---

    #[test]
    fn test_temp_color_cold() {
        let colored = colorize_temp(-5.0);
        let s = format!("{}", colored);
        assert!(s.contains("-5.0"));
        assert_eq!(colored.fgcolor(), Some(colored::Color::Blue));
    }

    #[test]
    fn test_temp_color_cold_zero() {
        let colored = colorize_temp(0.0);
        assert_eq!(colored.fgcolor(), Some(colored::Color::Blue));
    }

    #[test]
    fn test_temp_color_warm() {
        let colored = colorize_temp(15.0);
        assert_eq!(colored.fgcolor(), Some(colored::Color::Yellow));
    }

    #[test]
    fn test_temp_color_warm_boundary() {
        let colored = colorize_temp(25.0);
        assert_eq!(colored.fgcolor(), Some(colored::Color::Yellow));
    }

    #[test]
    fn test_temp_color_hot() {
        let colored = colorize_temp(35.0);
        assert_eq!(colored.fgcolor(), Some(colored::Color::Red));
    }

    // --- display_weather smoke test ---

    #[test]
    fn test_display_weather_does_not_panic() {
        let data = WeatherData {
            current: Current {
                temperature: 20.0,
                feels_like: 18.5,
                humidity: 65.0,
                wind_speed: 12.0,
                wind_direction: 180.0,
                weather_code: 0,
                is_day: true,
                time: "2026-03-25T12:00".to_string(),
            },
            daily: vec![DayForecast {
                date: "2026-03-25".to_string(),
                temp_max: 22.0,
                temp_min: 10.0,
                weather_code: 1,
                precipitation_probability: 20.0,
                sunrise: "06:30".to_string(),
                sunset: "18:45".to_string(),
            }],
            hourly: vec![HourForecast {
                time: "2026-03-25T13:00".to_string(),
                temperature: 21.0,
                weather_code: 0,
                wind_speed: 10.0,
                precipitation_probability: 5.0,
            }],
        };
        let loc = Location {
            name: "London".to_string(),
            country: "United Kingdom".to_string(),
            latitude: 51.5,
            longitude: -0.1,
        };
        // Should not panic
        display_weather(&data, &loc);
    }
}
