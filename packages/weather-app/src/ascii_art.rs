// ASCII art module — weather condition art, emoji, and descriptions for WMO codes.

const SUNNY: &str = "    \\   /    \n     .-.     \n  ― (   ) ― \n     `-'     \n    /   \\    ";

const PARTLY_CLOUDY: &str = "   \\  /      \n _ /\"\".-.    \n   \\_(   ).  \n   /(___(__) \n             ";

const CLOUDY: &str = "             \n     .--.    \n  .-(    ).  \n (___.__)__) \n             ";

const RAIN: &str = "     .-.     \n    (   ).   \n   (___(__)  \n   ' ' ' '  \n   ' ' ' '  ";

const SNOW: &str = "     .-.     \n    (   ).   \n   (___(__)  \n   * * * *   \n   * * * *   ";

const THUNDERSTORM: &str = "     .-.     \n    (   ).   \n   (___(__)  \n    ⚡' '⚡  \n   ' ' ' '  ";

const FOG: &str = "             \n _ - _ - _ - \n  _ - _ - _  \n _ - _ - _ - \n             ";

/// Returns ASCII art for the given WMO weather code.
pub fn weather_art(wmo_code: i32) -> &'static str {
    match wmo_code {
        0 => SUNNY,
        1 | 2 => PARTLY_CLOUDY,
        3 => CLOUDY,
        45 | 48 => FOG,
        51..=57 => RAIN,
        61..=67 => RAIN,
        71..=77 => SNOW,
        80..=82 => RAIN,
        85 | 86 => SNOW,
        95 | 96 | 99 => THUNDERSTORM,
        _ => PARTLY_CLOUDY,
    }
}

/// Returns an emoji for the given WMO weather code.
pub fn weather_emoji(wmo_code: i32) -> &'static str {
    match wmo_code {
        0 => "☀️",
        1 | 2 => "⛅",
        3 => "☁️",
        45 | 48 => "🌫️",
        51..=57 => "🌦️",
        61..=67 => "🌧️",
        71..=77 => "🌨️",
        80..=82 => "🌧️",
        85 | 86 => "🌨️",
        95 | 96 | 99 => "⛈️",
        _ => "⛅",
    }
}

/// Returns a human-readable description for the given WMO weather code.
pub fn weather_description(wmo_code: i32) -> &'static str {
    match wmo_code {
        0 => "Clear sky",
        1 => "Mainly clear",
        2 => "Partly cloudy",
        3 => "Overcast",
        45 => "Fog",
        48 => "Depositing rime fog",
        51 => "Light drizzle",
        53 => "Moderate drizzle",
        55 => "Dense drizzle",
        56 => "Light freezing drizzle",
        57 => "Dense freezing drizzle",
        61 => "Light rain",
        63 => "Moderate rain",
        65 => "Heavy rain",
        66 => "Light freezing rain",
        67 => "Heavy freezing rain",
        71 => "Light snow",
        73 => "Moderate snow",
        75 => "Heavy snow",
        77 => "Snow grains",
        80 => "Light rain showers",
        81 => "Moderate rain showers",
        82 => "Violent rain showers",
        85 => "Light snow showers",
        86 => "Heavy snow showers",
        95 => "Thunderstorm",
        96 => "Thunderstorm with light hail",
        99 => "Thunderstorm with heavy hail",
        _ => "Unknown",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wmo_0_returns_sunny_art() {
        assert_eq!(weather_art(0), SUNNY);
    }

    #[test]
    fn wmo_0_returns_sun_emoji() {
        assert_eq!(weather_emoji(0), "☀️");
    }

    #[test]
    fn wmo_0_returns_clear_sky_description() {
        assert_eq!(weather_description(0), "Clear sky");
    }

    #[test]
    fn wmo_3_returns_cloudy_art() {
        assert_eq!(weather_art(3), CLOUDY);
    }

    #[test]
    fn wmo_61_returns_rain_art() {
        assert_eq!(weather_art(61), RAIN);
    }

    #[test]
    fn wmo_61_returns_rain_emoji() {
        assert_eq!(weather_emoji(61), "🌧️");
    }

    #[test]
    fn wmo_61_returns_light_rain_description() {
        assert_eq!(weather_description(61), "Light rain");
    }

    #[test]
    fn wmo_71_returns_snow_art() {
        assert_eq!(weather_art(71), SNOW);
    }

    #[test]
    fn wmo_95_returns_thunderstorm_art() {
        assert_eq!(weather_art(95), THUNDERSTORM);
    }

    #[test]
    fn all_art_blocks_have_5_lines() {
        let arts = [SUNNY, PARTLY_CLOUDY, CLOUDY, RAIN, SNOW, THUNDERSTORM, FOG];
        for art in &arts {
            let line_count = art.lines().count();
            assert_eq!(line_count, 5, "Art block has {line_count} lines instead of 5:\n{art}");
        }
    }
}
