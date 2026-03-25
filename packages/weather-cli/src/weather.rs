use anyhow::{bail, Context, Result};
use reqwest::Client;
use serde::Deserialize;
use std::time::Duration;

use crate::models::{CurrentWeather, DayForecast, Forecast, Location, Units};

const FORECAST_URL: &str = "https://api.open-meteo.com/v1/forecast";
const TIMEOUT_SECS: u64 = 10;

// --- JSON response shapes ---

#[derive(Debug, Deserialize)]
struct CurrentResponse {
    current: Option<CurrentData>,
}

#[derive(Debug, Deserialize)]
struct CurrentData {
    temperature_2m: f64,
    relative_humidity_2m: f64,
    wind_speed_10m: f64,
    weather_code: u8,
}

#[derive(Debug, Deserialize)]
struct ForecastResponse {
    daily: Option<DailyData>,
}

#[derive(Debug, Deserialize)]
struct DailyData {
    time: Vec<String>,
    temperature_2m_max: Vec<f64>,
    temperature_2m_min: Vec<f64>,
    weather_code: Vec<u8>,
    precipitation_sum: Vec<f64>,
}

// --- Parsing helpers (unit-testable) ---

fn parse_current_response(body: &str) -> Result<CurrentWeather> {
    let resp: CurrentResponse =
        serde_json::from_str(body).context("Unexpected response from weather service")?;

    let current = resp
        .current
        .context("Unexpected response from weather service: missing current data")?;

    Ok(CurrentWeather {
        temperature: current.temperature_2m,
        humidity: current.relative_humidity_2m,
        wind_speed: current.wind_speed_10m,
        weather_code: current.weather_code,
    })
}

fn parse_forecast_response(body: &str) -> Result<Forecast> {
    let resp: ForecastResponse =
        serde_json::from_str(body).context("Unexpected response from weather service")?;

    let daily = resp
        .daily
        .context("Unexpected response from weather service: missing daily data")?;

    let n = daily.time.len();
    if daily.temperature_2m_max.len() != n
        || daily.temperature_2m_min.len() != n
        || daily.weather_code.len() != n
        || daily.precipitation_sum.len() != n
    {
        bail!("Unexpected response: mismatched daily array lengths");
    }

    let days: Vec<DayForecast> = daily
        .time
        .iter()
        .enumerate()
        .map(|(i, date)| DayForecast {
            date: date.clone(),
            temp_max: daily.temperature_2m_max[i],
            temp_min: daily.temperature_2m_min[i],
            weather_code: daily.weather_code[i],
            precipitation: daily.precipitation_sum[i],
        })
        .collect();

    if days.is_empty() {
        bail!("Unexpected response from weather service: no forecast days");
    }

    Ok(Forecast { days })
}

/// Build the unit query parameters for the Open-Meteo API.
fn units_query(units: Units) -> &'static str {
    match units {
        Units::Fahrenheit => "&temperature_unit=fahrenheit&wind_speed_unit=mph",
        Units::Celsius => "",
    }
}

fn build_client() -> Result<Client> {
    Client::builder()
        .timeout(Duration::from_secs(TIMEOUT_SECS))
        .build()
        .context("Failed to create HTTP client")
}

/// Fetch current weather for a location.
pub async fn fetch_current(loc: &Location, units: Units) -> Result<CurrentWeather> {
    let client = build_client()?;
    let url = format!(
        "{FORECAST_URL}?latitude={}&longitude={}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code{}",
        loc.latitude, loc.longitude, units_query(units)
    );

    let body = client
        .get(&url)
        .send()
        .await
        .context("Unable to reach weather service. Check your internet connection.")?
        .text()
        .await
        .context("Failed to read weather response")?;

    parse_current_response(&body)
}

/// Fetch a multi-day forecast for a location.
pub async fn fetch_forecast(loc: &Location, days: u8, units: Units) -> Result<Forecast> {
    let client = build_client()?;
    let url = format!(
        "{FORECAST_URL}?latitude={}&longitude={}&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_sum&forecast_days={}{}",
        loc.latitude, loc.longitude, days, units_query(units)
    );

    let body = client
        .get(&url)
        .send()
        .await
        .context("Unable to reach weather service. Check your internet connection.")?
        .text()
        .await
        .context("Failed to read weather response")?;

    parse_forecast_response(&body)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_current_weather_valid() {
        let json = r#"{
            "current": {
                "temperature_2m": 22.5,
                "relative_humidity_2m": 45.0,
                "wind_speed_10m": 12.3,
                "weather_code": 0
            }
        }"#;

        let cw = parse_current_response(json).unwrap();
        assert!((cw.temperature - 22.5).abs() < 0.01);
        assert!((cw.humidity - 45.0).abs() < 0.01);
        assert!((cw.wind_speed - 12.3).abs() < 0.01);
        assert_eq!(cw.weather_code, 0);
    }

    #[test]
    fn parse_current_weather_missing_current_returns_error() {
        let json = r#"{}"#;
        let result = parse_current_response(json);
        assert!(result.is_err());
    }

    #[test]
    fn parse_forecast_valid() {
        let json = r#"{
            "daily": {
                "time": ["2026-03-25", "2026-03-26", "2026-03-27"],
                "temperature_2m_max": [18.0, 20.0, 15.5],
                "temperature_2m_min": [8.0, 10.0, 7.0],
                "weather_code": [0, 3, 61],
                "precipitation_sum": [0.0, 0.0, 5.2]
            }
        }"#;

        let forecast = parse_forecast_response(json).unwrap();
        assert_eq!(forecast.days.len(), 3);

        assert_eq!(forecast.days[0].date, "2026-03-25");
        assert!((forecast.days[0].temp_max - 18.0).abs() < 0.01);
        assert!((forecast.days[0].temp_min - 8.0).abs() < 0.01);
        assert_eq!(forecast.days[0].weather_code, 0);
        assert!((forecast.days[0].precipitation - 0.0).abs() < 0.01);

        assert_eq!(forecast.days[2].date, "2026-03-27");
        assert_eq!(forecast.days[2].weather_code, 61);
        assert!((forecast.days[2].precipitation - 5.2).abs() < 0.01);
    }

    #[test]
    fn parse_forecast_missing_daily_returns_error() {
        let json = r#"{}"#;
        let result = parse_forecast_response(json);
        assert!(result.is_err());
    }

    #[test]
    fn parse_forecast_invalid_json_returns_error() {
        let result = parse_forecast_response("not json at all");
        assert!(result.is_err());
    }

    #[test]
    fn units_query_celsius_is_empty() {
        assert_eq!(units_query(Units::Celsius), "");
    }

    #[test]
    fn units_query_fahrenheit_has_params() {
        let q = units_query(Units::Fahrenheit);
        assert!(q.contains("temperature_unit=fahrenheit"));
        assert!(q.contains("wind_speed_unit=mph"));
    }
}
