// JSON formatter module — serializes weather data as JSON to stdout.

use crate::geocoder::Location;
use crate::weather::WeatherData;

/// Combined output struct for JSON serialization.
#[derive(serde::Serialize)]
struct JsonOutput<'a> {
    location: &'a Location,
    current: &'a crate::weather::Current,
    daily: &'a Vec<crate::weather::DayForecast>,
    hourly: &'a Vec<crate::weather::HourForecast>,
}

/// Serialize weather data and location as JSON, returning the JSON string.
pub fn format_json(data: &WeatherData, loc: &Location) -> String {
    let output = JsonOutput {
        location: loc,
        current: &data.current,
        daily: &data.daily,
        hourly: &data.hourly,
    };
    serde_json::to_string_pretty(&output).expect("failed to serialize weather data to JSON")
}

/// Print JSON weather data to stdout.
pub fn display_json(data: &WeatherData, loc: &Location) {
    println!("{}", format_json(data, loc));
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::weather::{Current, DayForecast, HourForecast, WeatherData};

    fn sample_data() -> (WeatherData, Location) {
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
        (data, loc)
    }

    #[test]
    fn test_json_output_is_valid_json() {
        let (data, loc) = sample_data();
        let output = format_json(&data, &loc);
        let parsed: serde_json::Value =
            serde_json::from_str(&output).expect("output should be valid JSON");
        assert!(parsed.is_object());
    }

    #[test]
    fn test_json_output_has_expected_keys() {
        let (data, loc) = sample_data();
        let output = format_json(&data, &loc);
        let parsed: serde_json::Value = serde_json::from_str(&output).unwrap();
        let obj = parsed.as_object().unwrap();
        assert!(obj.contains_key("current"), "missing 'current' key");
        assert!(obj.contains_key("daily"), "missing 'daily' key");
        assert!(obj.contains_key("hourly"), "missing 'hourly' key");
        assert!(obj.contains_key("location"), "missing 'location' key");
    }

    #[test]
    fn test_json_location_fields() {
        let (data, loc) = sample_data();
        let output = format_json(&data, &loc);
        let parsed: serde_json::Value = serde_json::from_str(&output).unwrap();
        let location = &parsed["location"];
        assert_eq!(location["name"], "London");
        assert_eq!(location["country"], "United Kingdom");
    }

    #[test]
    fn test_json_current_has_temperature() {
        let (data, loc) = sample_data();
        let output = format_json(&data, &loc);
        let parsed: serde_json::Value = serde_json::from_str(&output).unwrap();
        let current = &parsed["current"];
        assert_eq!(current["temperature"], 20.0);
    }

    #[test]
    fn test_json_daily_is_array() {
        let (data, loc) = sample_data();
        let output = format_json(&data, &loc);
        let parsed: serde_json::Value = serde_json::from_str(&output).unwrap();
        assert!(parsed["daily"].is_array(), "daily should be an array");
        assert_eq!(parsed["daily"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn test_json_hourly_is_array() {
        let (data, loc) = sample_data();
        let output = format_json(&data, &loc);
        let parsed: serde_json::Value = serde_json::from_str(&output).unwrap();
        assert!(parsed["hourly"].is_array(), "hourly should be an array");
        assert_eq!(parsed["hourly"].as_array().unwrap().len(), 1);
    }
}
