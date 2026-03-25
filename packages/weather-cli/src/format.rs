use colored::Colorize;

use crate::codes::weather_description;
use crate::models::{CurrentWeather, DayForecast, Forecast, Location, Units};

/// Returns the temperature unit suffix for the given units.
fn temp_suffix(units: Units) -> &'static str {
    match units {
        Units::Celsius => "°C",
        Units::Fahrenheit => "°F",
    }
}

/// Returns the wind speed unit label for the given units.
fn wind_unit(units: Units) -> &'static str {
    match units {
        Units::Celsius => "km/h",
        Units::Fahrenheit => "mph",
    }
}

/// Formats current weather for terminal display.
///
/// Layout:
/// ```text
/// 📍 London, United Kingdom
/// ☀️ Clear sky
/// 🌡️  22°C  💧 45%  💨 12 km/h
/// ```
pub fn format_current(loc: &Location, weather: &CurrentWeather, units: Units) -> String {
    let (emoji, description) = weather_description(weather.weather_code);
    let suffix = temp_suffix(units);
    let wind = wind_unit(units);

    let location_line = format!(
        "📍 {}, {}",
        loc.name.bold(),
        loc.country
    );
    let condition_line = format!("{} {}", emoji, description);
    let stats_line = format!(
        "🌡️  {}{}  💧 {}%  💨 {} {}",
        weather.temperature, suffix, weather.humidity, weather.wind_speed, wind
    );

    format!("{}\n{}\n{}", location_line, condition_line, stats_line)
}

/// Formats a multi-day forecast as a table for terminal display.
///
/// Layout:
/// ```text
/// 📍 London, United Kingdom
///
/// Date        Conditions          High / Low    Precip
/// ─────────────────────────────────────────────────────
/// 2026-03-25  ☀️ Clear sky         18°C / 8°C    0.5 mm
/// ```
pub fn format_forecast(loc: &Location, forecast: &Forecast, units: Units) -> String {
    let suffix = temp_suffix(units);

    let location_line = format!(
        "📍 {}, {}",
        loc.name.bold(),
        loc.country
    );

    let header = format!(
        "\n{:<12}{:<22}{:<14}{}",
        "Date".bold(),
        "Conditions".bold(),
        "High / Low".bold(),
        "Precip".bold(),
    );
    let separator = "─".repeat(56);

    let mut rows = Vec::with_capacity(forecast.days.len());
    for day in &forecast.days {
        rows.push(format_day_row(day, suffix));
    }

    format!(
        "{}\n{}\n{}\n{}",
        location_line,
        header,
        separator,
        rows.join("\n")
    )
}

/// Formats a single day row for the forecast table.
fn format_day_row(day: &DayForecast, suffix: &str) -> String {
    let (emoji, desc) = weather_description(day.weather_code);
    let conditions = format!("{} {}", emoji, desc);
    let temp_range = format!("{}{} / {}{}", day.temp_max, suffix, day.temp_min, suffix);

    format!(
        "{:<12}{:<22}{:<14}{:.1} mm",
        day.date, conditions, temp_range, day.precipitation
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_location() -> Location {
        Location {
            name: "London".to_string(),
            latitude: 51.5,
            longitude: -0.12,
            country: "United Kingdom".to_string(),
        }
    }

    #[test]
    fn format_current_contains_temperature_humidity_wind_and_emoji() {
        let loc = sample_location();
        let weather = CurrentWeather {
            temperature: 22.0,
            humidity: 45.0,
            wind_speed: 12.0,
            weather_code: 0,
        };
        let output = format_current(&loc, &weather, Units::Celsius);

        assert!(output.contains("22"), "should contain temperature: {}", output);
        assert!(output.contains("°C"), "should contain °C: {}", output);
        assert!(output.contains("45%"), "should contain humidity: {}", output);
        assert!(output.contains("12"), "should contain wind speed: {}", output);
        assert!(output.contains("km/h"), "should contain km/h: {}", output);
        // Clear sky emoji or description
        assert!(
            output.contains("Clear") || output.contains("☀"),
            "should contain clear sky indicator: {}",
            output
        );
    }

    #[test]
    fn format_current_contains_location() {
        let loc = sample_location();
        let weather = CurrentWeather {
            temperature: 10.0,
            humidity: 80.0,
            wind_speed: 5.0,
            weather_code: 3,
        };
        let output = format_current(&loc, &weather, Units::Celsius);

        assert!(output.contains("London"), "should contain city name: {}", output);
        assert!(
            output.contains("United Kingdom"),
            "should contain country: {}",
            output
        );
    }

    #[test]
    fn format_current_fahrenheit_shows_fahrenheit_units() {
        let loc = sample_location();
        let weather = CurrentWeather {
            temperature: 72.0,
            humidity: 45.0,
            wind_speed: 8.0,
            weather_code: 0,
        };
        let output = format_current(&loc, &weather, Units::Fahrenheit);

        assert!(output.contains("°F"), "should contain °F: {}", output);
        assert!(output.contains("mph"), "should contain mph: {}", output);
        assert!(!output.contains("°C"), "should not contain °C: {}", output);
        assert!(!output.contains("km/h"), "should not contain km/h: {}", output);
    }

    #[test]
    fn format_forecast_produces_row_per_day() {
        let loc = sample_location();
        let forecast = Forecast {
            days: vec![
                DayForecast {
                    date: "2026-03-25".to_string(),
                    temp_max: 18.0,
                    temp_min: 8.0,
                    weather_code: 0,
                    precipitation: 0.0,
                },
                DayForecast {
                    date: "2026-03-26".to_string(),
                    temp_max: 15.0,
                    temp_min: 7.0,
                    weather_code: 61,
                    precipitation: 3.2,
                },
                DayForecast {
                    date: "2026-03-27".to_string(),
                    temp_max: 20.0,
                    temp_min: 10.0,
                    weather_code: 2,
                    precipitation: 0.1,
                },
            ],
        };
        let output = format_forecast(&loc, &forecast, Units::Celsius);

        // Should contain each date
        assert!(output.contains("2026-03-25"), "missing day 1: {}", output);
        assert!(output.contains("2026-03-26"), "missing day 2: {}", output);
        assert!(output.contains("2026-03-27"), "missing day 3: {}", output);

        // Should contain high/low for each day
        assert!(output.contains("18"), "missing temp_max day 1: {}", output);
        assert!(output.contains("8"), "missing temp_min day 1: {}", output);
        assert!(output.contains("15"), "missing temp_max day 2: {}", output);

        // Should contain weather icons/descriptions
        assert!(
            output.contains("Clear") || output.contains("☀"),
            "missing clear sky for day 1: {}",
            output
        );
        assert!(
            output.contains("rain") || output.contains("Rain") || output.contains("🌧"),
            "missing rain for day 2: {}",
            output
        );
    }

    #[test]
    fn format_forecast_fahrenheit_shows_fahrenheit_units() {
        let loc = sample_location();
        let forecast = Forecast {
            days: vec![DayForecast {
                date: "2026-03-25".to_string(),
                temp_max: 64.0,
                temp_min: 46.0,
                weather_code: 0,
                precipitation: 0.0,
            }],
        };
        let output = format_forecast(&loc, &forecast, Units::Fahrenheit);

        assert!(output.contains("°F"), "should contain °F: {}", output);
        assert!(!output.contains("°C"), "should not contain °C: {}", output);
    }

    #[test]
    fn format_forecast_contains_location() {
        let loc = sample_location();
        let forecast = Forecast {
            days: vec![DayForecast {
                date: "2026-03-25".to_string(),
                temp_max: 18.0,
                temp_min: 8.0,
                weather_code: 0,
                precipitation: 0.0,
            }],
        };
        let output = format_forecast(&loc, &forecast, Units::Celsius);

        assert!(output.contains("London"), "should contain city: {}", output);
        assert!(
            output.contains("United Kingdom"),
            "should contain country: {}",
            output
        );
    }
}
