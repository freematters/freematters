/// Maps a WMO weather code (0–99) to an `(emoji, description)` tuple.
///
/// Covers all standard WMO weather interpretation codes. Unknown codes
/// return a generic "Unknown" description.
pub fn weather_description(code: u8) -> (&'static str, &'static str) {
    match code {
        0 => ("☀️", "Clear sky"),
        1 => ("🌤️", "Mainly clear"),
        2 => ("⛅", "Partly cloudy"),
        3 => ("☁️", "Overcast"),
        45 => ("🌫️", "Fog"),
        48 => ("🌫️", "Depositing rime fog"),
        51 => ("🌦️", "Light drizzle"),
        53 => ("🌦️", "Moderate drizzle"),
        55 => ("🌦️", "Dense drizzle"),
        56 => ("🌧️", "Light freezing drizzle"),
        57 => ("🌧️", "Dense freezing drizzle"),
        61 => ("🌧️", "Slight rain"),
        63 => ("🌧️", "Moderate rain"),
        65 => ("🌧️", "Heavy rain"),
        66 => ("🌧️", "Light freezing rain"),
        67 => ("🌧️", "Heavy freezing rain"),
        71 => ("🌨️", "Slight snowfall"),
        73 => ("🌨️", "Moderate snowfall"),
        75 => ("🌨️", "Heavy snowfall"),
        77 => ("🌨️", "Snow grains"),
        80 => ("🌦️", "Slight rain showers"),
        81 => ("🌧️", "Moderate rain showers"),
        82 => ("🌧️", "Violent rain showers"),
        85 => ("🌨️", "Slight snow showers"),
        86 => ("🌨️", "Heavy snow showers"),
        95 => ("⛈️", "Thunderstorm"),
        96 => ("⛈️", "Thunderstorm with slight hail"),
        99 => ("⛈️", "Thunderstorm with heavy hail"),
        _ => ("❓", "Unknown"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn code_0_is_clear_sky() {
        let (emoji, desc) = weather_description(0);
        assert!(emoji.contains('☀'), "expected sun emoji, got: {}", emoji);
        assert!(
            desc.to_lowercase().contains("clear"),
            "expected 'clear' in: {}",
            desc
        );
    }

    #[test]
    fn code_61_is_rain() {
        let (emoji, desc) = weather_description(61);
        assert!(emoji.contains('🌧'), "expected rain emoji, got: {}", emoji);
        assert!(
            desc.to_lowercase().contains("rain"),
            "expected 'rain' in: {}",
            desc
        );
    }

    #[test]
    fn unknown_code_returns_sensible_default() {
        let (emoji, desc) = weather_description(99);
        // Code 99 is a valid WMO code (thunderstorm with heavy hail)
        assert!(!desc.is_empty());
        assert!(!emoji.is_empty());

        // Truly unknown code
        let (emoji2, desc2) = weather_description(100);
        assert!(!desc2.is_empty(), "unknown code should still return a description");
        assert!(!emoji2.is_empty(), "unknown code should still return an emoji");
    }

    #[test]
    fn all_standard_codes_return_non_empty() {
        for code in 0..=99 {
            let (emoji, desc) = weather_description(code);
            assert!(!emoji.is_empty(), "code {} has empty emoji", code);
            assert!(!desc.is_empty(), "code {} has empty description", code);
        }
    }
}
