use anyhow::{Context, Result};
use reqwest::Client;
use serde::Deserialize;
use std::time::Duration;

use crate::models::Location;

const GEOCODING_URL: &str = "https://geocoding-api.open-meteo.com/v1/search";
const TIMEOUT_SECS: u64 = 10;

#[derive(Debug, Deserialize)]
struct GeoResponse {
    results: Option<Vec<GeoResult>>,
}

#[derive(Debug, Deserialize)]
struct GeoResult {
    name: String,
    latitude: f64,
    longitude: f64,
    country: String,
}

/// Parse a geocoding JSON response into a `Location`.
fn parse_geocode_response(body: &str) -> Result<Location> {
    let resp: GeoResponse =
        serde_json::from_str(body).context("Unexpected response from weather service")?;

    let results = resp
        .results
        .filter(|r| !r.is_empty())
        .context("Location not found")?;

    let first = &results[0];
    Ok(Location {
        name: first.name.clone(),
        latitude: first.latitude,
        longitude: first.longitude,
        country: first.country.clone(),
    })
}

/// Look up a location by name using the Open-Meteo geocoding API.
/// If `lang` is provided, location names are returned in that language.
pub async fn geocode(name: &str, lang: Option<&str>) -> Result<Location> {
    let client = Client::builder()
        .timeout(Duration::from_secs(TIMEOUT_SECS))
        .build()
        .context("Failed to create HTTP client")?;

    let mut url = format!("{GEOCODING_URL}?name={}&count=1", urlencoding(name));
    if let Some(lang) = lang {
        url.push_str(&format!("&language={}", urlencoding(lang)));
    }

    let resp = client
        .get(&url)
        .send()
        .await
        .context("Unable to reach weather service. Check your internet connection.")?;

    let body = resp
        .text()
        .await
        .context("Failed to read geocoding response")?;

    parse_geocode_response(&body)
        .with_context(|| format!("Location '{}' not found. Try a different city name.", name))
}

/// Simple percent-encoding for the query parameter.
fn urlencoding(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '~' => c.to_string(),
            ' ' => "%20".to_string(),
            _ => format!("%{:02X}", c as u32),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_geocode_valid_response() {
        let json = r#"{
            "results": [
                {
                    "name": "London",
                    "latitude": 51.50853,
                    "longitude": -0.12574,
                    "country": "United Kingdom",
                    "id": 2643743,
                    "country_code": "GB"
                }
            ]
        }"#;

        let loc = parse_geocode_response(json).unwrap();
        assert_eq!(loc.name, "London");
        assert!((loc.latitude - 51.50853).abs() < 0.001);
        assert!((loc.longitude - (-0.12574)).abs() < 0.001);
        assert_eq!(loc.country, "United Kingdom");
    }

    #[test]
    fn parse_geocode_empty_results_returns_error() {
        let json = r#"{"results": []}"#;
        let result = parse_geocode_response(json);
        assert!(result.is_err());
        let err_msg = format!("{}", result.unwrap_err());
        assert!(err_msg.contains("not found"), "Error was: {err_msg}");
    }

    #[test]
    fn parse_geocode_null_results_returns_error() {
        let json = r#"{}"#;
        let result = parse_geocode_response(json);
        assert!(result.is_err());
    }

    #[test]
    fn parse_geocode_invalid_json_returns_error() {
        let result = parse_geocode_response("not json");
        assert!(result.is_err());
    }
}
