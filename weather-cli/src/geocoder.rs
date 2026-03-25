// Geocoder module — resolves city names to coordinates via Open-Meteo geocoding API.

use anyhow::{bail, Result};
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize, Serialize)]
pub struct Location {
    pub name: String,
    pub country: String,
    pub latitude: f64,
    pub longitude: f64,
}

#[derive(Debug, Deserialize)]
struct GeoResponse {
    #[serde(default)]
    results: Vec<GeoResult>,
}

#[derive(Debug, Deserialize)]
struct GeoResult {
    name: String,
    country: String,
    latitude: f64,
    longitude: f64,
}

pub async fn geocode(city: &str) -> Result<Location> {
    let url = format!(
        "https://geocoding-api.open-meteo.com/v1/search?name={}&count=1&language=en",
        city
    );

    let resp: GeoResponse = reqwest::get(&url).await?.json().await?;

    match resp.results.into_iter().next() {
        Some(r) => Ok(Location {
            name: r.name,
            country: r.country,
            latitude: r.latitude,
            longitude: r.longitude,
        }),
        None => bail!("City '{}' not found. Try a different spelling.", city),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_geocode_known_city() {
        let loc = geocode("London").await.expect("should resolve London");
        assert!(
            (loc.latitude - 51.5).abs() < 1.0,
            "latitude should be ~51.5, got {}",
            loc.latitude
        );
        assert!(
            (loc.longitude - (-0.1)).abs() < 1.0,
            "longitude should be ~-0.1, got {}",
            loc.longitude
        );
        assert!(
            loc.country.contains("United Kingdom"),
            "country should contain 'United Kingdom', got '{}'",
            loc.country
        );
    }

    #[tokio::test]
    async fn test_geocode_unknown_city() {
        let result = geocode("xyznotacity").await;
        assert!(result.is_err(), "should return error for unknown city");
        let err_msg = result.unwrap_err().to_string();
        assert!(
            err_msg.contains("not found"),
            "error should mention 'not found', got '{}'",
            err_msg
        );
    }
}
