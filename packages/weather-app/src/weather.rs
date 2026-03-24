// Weather client module — fetches weather data from Open-Meteo

use serde::Deserialize;

#[derive(Debug, Clone, PartialEq)]
pub enum Units {
    Metric,
    Imperial,
}

impl Default for Units {
    fn default() -> Self {
        Units::Metric
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct CurrentWeather {
    pub temperature: f64,
    pub humidity: f64,
    pub wind_speed: f64,
    pub weather_code: i32,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DayForecast {
    pub date: String,
    pub weather_code: i32,
    pub temp_max: f64,
    pub temp_min: f64,
    pub precipitation_sum: f64,
}

#[derive(Debug, Clone)]
pub struct WeatherData {
    pub current: CurrentWeather,
    pub daily: Vec<DayForecast>,
}

const BASE_URL: &str = "https://api.open-meteo.com/v1/forecast";

pub fn build_url(lat: f64, lon: f64, units: &Units, days: u8) -> String {
    let (temp_unit, wind_unit) = match units {
        Units::Metric => ("celsius", "kmh"),
        Units::Imperial => ("fahrenheit", "mph"),
    };

    format!(
        "{}?latitude={}&longitude={}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum&forecast_days={}&temperature_unit={}&wind_speed_unit={}",
        BASE_URL, lat, lon, days, temp_unit, wind_unit
    )
}

#[derive(Deserialize)]
struct ApiCurrent {
    temperature_2m: f64,
    relative_humidity_2m: f64,
    wind_speed_10m: f64,
    weather_code: i32,
}

#[derive(Deserialize)]
struct ApiDaily {
    time: Vec<String>,
    weather_code: Vec<i32>,
    temperature_2m_max: Vec<f64>,
    temperature_2m_min: Vec<f64>,
    precipitation_sum: Vec<f64>,
}

#[derive(Deserialize)]
struct ApiResponse {
    current: ApiCurrent,
    daily: ApiDaily,
}

pub fn parse_response(json: &str) -> Result<WeatherData, String> {
    let resp: ApiResponse =
        serde_json::from_str(json).map_err(|e| format!("Failed to parse weather JSON: {e}"))?;

    let current = CurrentWeather {
        temperature: resp.current.temperature_2m,
        humidity: resp.current.relative_humidity_2m,
        wind_speed: resp.current.wind_speed_10m,
        weather_code: resp.current.weather_code,
    };

    let daily: Vec<DayForecast> = resp
        .daily
        .time
        .iter()
        .enumerate()
        .map(|(i, date)| DayForecast {
            date: date.clone(),
            weather_code: resp.daily.weather_code[i],
            temp_max: resp.daily.temperature_2m_max[i],
            temp_min: resp.daily.temperature_2m_min[i],
            precipitation_sum: resp.daily.precipitation_sum[i],
        })
        .collect();

    Ok(WeatherData { current, daily })
}

pub fn fetch_weather(lat: f64, lon: f64, units: &Units, days: u8) -> Result<WeatherData, String> {
    let url = build_url(lat, lon, units, days);
    let body = reqwest::blocking::get(&url)
        .map_err(|e| format!("HTTP request failed: {e}"))?
        .text()
        .map_err(|e| format!("Failed to read response body: {e}"))?;
    parse_response(&body)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE_JSON: &str = r#"{
        "current": {
            "time": "2026-03-24T12:00",
            "interval": 900,
            "temperature_2m": 18.5,
            "relative_humidity_2m": 65.0,
            "wind_speed_10m": 12.3,
            "weather_code": 1
        },
        "daily": {
            "time": ["2026-03-24", "2026-03-25"],
            "weather_code": [1, 3],
            "temperature_2m_max": [20.0, 22.5],
            "temperature_2m_min": [10.0, 12.0],
            "precipitation_sum": [0.0, 1.5]
        }
    }"#;

    #[test]
    fn parse_valid_json_returns_correct_weather_data() {
        let data = parse_response(SAMPLE_JSON).unwrap();

        assert!((data.current.temperature - 18.5).abs() < f64::EPSILON);
        assert!((data.current.humidity - 65.0).abs() < f64::EPSILON);
        assert!((data.current.wind_speed - 12.3).abs() < f64::EPSILON);
        assert_eq!(data.current.weather_code, 1);

        assert_eq!(data.daily.len(), 2);
        assert_eq!(data.daily[0].date, "2026-03-24");
        assert_eq!(data.daily[0].weather_code, 1);
        assert!((data.daily[0].temp_max - 20.0).abs() < f64::EPSILON);
        assert!((data.daily[0].temp_min - 10.0).abs() < f64::EPSILON);
        assert!((data.daily[0].precipitation_sum - 0.0).abs() < f64::EPSILON);

        assert_eq!(data.daily[1].date, "2026-03-25");
        assert_eq!(data.daily[1].weather_code, 3);
        assert!((data.daily[1].precipitation_sum - 1.5).abs() < f64::EPSILON);
    }

    #[test]
    fn build_url_imperial_includes_fahrenheit_and_mph() {
        let url = build_url(51.5, -0.12, &Units::Imperial, 3);
        assert!(url.contains("temperature_unit=fahrenheit"));
        assert!(url.contains("wind_speed_unit=mph"));
        assert!(url.contains("forecast_days=3"));
    }

    #[test]
    fn build_url_metric_includes_celsius_and_kmh() {
        let url = build_url(51.5, -0.12, &Units::Metric, 7);
        assert!(url.contains("temperature_unit=celsius"));
        assert!(url.contains("wind_speed_unit=kmh"));
        assert!(url.contains("forecast_days=7"));
    }
}
