// Geocoding module — resolves city name to coordinates

use serde::Deserialize;

/// A geographic location with name and coordinates.
#[derive(Debug, Deserialize)]
pub struct Location {
    pub name: String,
    pub latitude: f64,
    pub longitude: f64,
}

#[derive(Deserialize)]
struct GeoResponse {
    results: Option<Vec<Location>>,
}

/// Resolve a city name to geographic coordinates using the Open-Meteo geocoding API.
///
/// Returns the first match or an error if the city is not found or the request fails.
pub fn geocode(city: &str) -> Result<Location, String> {
    let url = format!(
        "https://geocoding-api.open-meteo.com/v1/search?name={}&count=1",
        city
    );

    let response = reqwest::blocking::get(&url)
        .map_err(|e| format!("Network error: {e}"))?;

    let geo: GeoResponse = response
        .json()
        .map_err(|e| format!("Failed to parse geocoding response: {e}"))?;

    geo.results
        .and_then(|mut v| if v.is_empty() { None } else { Some(v.remove(0)) })
        .ok_or_else(|| format!("City not found: {city}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_valid_geocoding_json() {
        let json = r#"{
            "results": [
                {
                    "name": "Berlin",
                    "latitude": 52.52,
                    "longitude": 13.405
                }
            ]
        }"#;

        let geo: GeoResponse = serde_json::from_str(json).expect("should parse");
        let results = geo.results.expect("should have results");
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].name, "Berlin");
        assert!((results[0].latitude - 52.52).abs() < 1e-6);
        assert!((results[0].longitude - 13.405).abs() < 1e-6);
    }

    #[test]
    fn empty_results_returns_city_not_found() {
        let json = r#"{ "results": [] }"#;
        let geo: GeoResponse = serde_json::from_str(json).expect("should parse");

        let location = geo
            .results
            .and_then(|mut v| if v.is_empty() { None } else { Some(v.remove(0)) })
            .ok_or_else(|| format!("City not found: {}", "Nonexistentville"));

        assert!(location.is_err());
        assert!(location.unwrap_err().contains("City not found"));
    }

    #[test]
    fn missing_results_field_returns_city_not_found() {
        let json = r#"{}"#;
        let geo: GeoResponse = serde_json::from_str(json).expect("should parse");

        let location = geo
            .results
            .and_then(|mut v| if v.is_empty() { None } else { Some(v.remove(0)) })
            .ok_or_else(|| format!("City not found: {}", "Nowhere"));

        assert!(location.is_err());
        assert!(location.unwrap_err().contains("City not found"));
    }
}
