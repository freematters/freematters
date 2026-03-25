// Weather fetcher module — fetches current and forecast data from Open-Meteo API.

use anyhow::{bail, Result};
use serde::{Deserialize, Serialize};

use crate::cli::Units;
use crate::geocoder::Location;

#[derive(Debug, Serialize, Deserialize)]
pub struct Current {
    pub temperature: f64,
    pub feels_like: f64,
    pub humidity: f64,
    pub wind_speed: f64,
    pub wind_direction: f64,
    pub weather_code: u8,
    pub is_day: bool,
    pub time: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DayForecast {
    pub date: String,
    pub temp_max: f64,
    pub temp_min: f64,
    pub weather_code: u8,
    pub precipitation_probability: f64,
    pub sunrise: String,
    pub sunset: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct HourForecast {
    pub time: String,
    pub temperature: f64,
    pub weather_code: u8,
    pub wind_speed: f64,
    pub precipitation_probability: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WeatherData {
    pub current: Current,
    pub daily: Vec<DayForecast>,
    pub hourly: Vec<HourForecast>,
}

// Raw API response structs for deserialization

#[derive(Debug, Deserialize)]
struct ApiResponse {
    current: ApiCurrent,
    daily: ApiDaily,
    hourly: ApiHourly,
}

#[derive(Debug, Deserialize)]
struct ApiCurrent {
    time: String,
    temperature_2m: f64,
    apparent_temperature: f64,
    relative_humidity_2m: f64,
    wind_speed_10m: f64,
    wind_direction_10m: f64,
    weather_code: u8,
    is_day: u8,
}

#[derive(Debug, Deserialize)]
struct ApiDaily {
    time: Vec<String>,
    temperature_2m_max: Vec<f64>,
    temperature_2m_min: Vec<f64>,
    weather_code: Vec<u8>,
    precipitation_probability_max: Vec<f64>,
    sunrise: Vec<String>,
    sunset: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct ApiHourly {
    time: Vec<String>,
    temperature_2m: Vec<f64>,
    weather_code: Vec<u8>,
    wind_speed_10m: Vec<f64>,
    precipitation_probability: Vec<f64>,
}

pub async fn fetch_weather(loc: &Location, days: u8, units: &Units) -> Result<WeatherData> {
    let (temp_unit, wind_unit) = match units {
        Units::Metric => ("celsius", "kmh"),
        Units::Imperial => ("fahrenheit", "mph"),
    };

    let url = format!(
        "https://api.open-meteo.com/v1/forecast\
         ?latitude={lat}&longitude={lon}\
         &current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m,is_day\
         &daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_probability_max\
         &hourly=temperature_2m,weather_code,wind_speed_10m,precipitation_probability\
         &forecast_days={days}\
         &temperature_unit={temp_unit}\
         &wind_speed_unit={wind_unit}",
        lat = loc.latitude,
        lon = loc.longitude,
        days = days,
        temp_unit = temp_unit,
        wind_unit = wind_unit,
    );

    let resp = reqwest::get(&url).await?;
    if !resp.status().is_success() {
        bail!("Unexpected response from weather service.");
    }

    let api: ApiResponse = resp.json().await?;

    let current = Current {
        temperature: api.current.temperature_2m,
        feels_like: api.current.apparent_temperature,
        humidity: api.current.relative_humidity_2m,
        wind_speed: api.current.wind_speed_10m,
        wind_direction: api.current.wind_direction_10m,
        weather_code: api.current.weather_code,
        is_day: api.current.is_day != 0,
        time: api.current.time,
    };

    let daily: Vec<DayForecast> = api
        .daily
        .time
        .into_iter()
        .zip(api.daily.temperature_2m_max)
        .zip(api.daily.temperature_2m_min)
        .zip(api.daily.weather_code)
        .zip(api.daily.precipitation_probability_max)
        .zip(api.daily.sunrise)
        .zip(api.daily.sunset)
        .map(|((((((date, temp_max), temp_min), wc), precip), sunrise), sunset)| {
            DayForecast {
                date,
                temp_max,
                temp_min,
                weather_code: wc,
                precipitation_probability: precip,
                sunrise,
                sunset,
            }
        })
        .collect();

    let hourly: Vec<HourForecast> = api
        .hourly
        .time
        .into_iter()
        .zip(api.hourly.temperature_2m)
        .zip(api.hourly.weather_code)
        .zip(api.hourly.wind_speed_10m)
        .zip(api.hourly.precipitation_probability)
        .map(|((((time, temperature), wc), wind_speed), precip)| {
            HourForecast {
                time,
                temperature,
                weather_code: wc,
                wind_speed,
                precipitation_probability: precip,
            }
        })
        .collect();

    Ok(WeatherData {
        current,
        daily,
        hourly,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::geocoder::geocode;

    #[tokio::test]
    async fn test_fetch_weather_returns_expected_structure() {
        let loc = geocode("London").await.expect("should resolve London");
        let data = fetch_weather(&loc, 3, &Units::Metric)
            .await
            .expect("should fetch weather");

        // Current conditions should be populated
        assert!(
            !data.current.time.is_empty(),
            "current time should be non-empty"
        );

        // Daily forecast should have exactly 3 entries (matching days=3)
        assert_eq!(
            data.daily.len(),
            3,
            "daily forecast should have 3 entries, got {}",
            data.daily.len()
        );

        // Hourly forecast should have 24+ entries (at least one full day)
        assert!(
            data.hourly.len() >= 24,
            "hourly forecast should have 24+ entries, got {}",
            data.hourly.len()
        );
    }
}
