use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
pub struct Location {
    pub name: String,
    pub latitude: f64,
    pub longitude: f64,
    pub country: String,
}

#[derive(Debug, Clone)]
pub struct CurrentWeather {
    pub temperature: f64,
    pub humidity: f64,
    pub wind_speed: f64,
    pub weather_code: u8,
}

#[derive(Debug, Clone)]
pub struct Forecast {
    pub days: Vec<DayForecast>,
}

#[derive(Debug, Clone)]
pub struct DayForecast {
    pub date: String,
    pub temp_max: f64,
    pub temp_min: f64,
    pub weather_code: u8,
    pub precipitation: f64,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum Units {
    #[default]
    Celsius,
    Fahrenheit,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn location_has_required_fields() {
        let loc = Location {
            name: "London".to_string(),
            latitude: 51.5,
            longitude: -0.12,
            country: "United Kingdom".to_string(),
        };
        assert_eq!(loc.name, "London");
        assert_eq!(loc.latitude, 51.5);
        assert_eq!(loc.longitude, -0.12);
        assert_eq!(loc.country, "United Kingdom");
    }

    #[test]
    fn current_weather_has_required_fields() {
        let cw = CurrentWeather {
            temperature: 22.0,
            humidity: 45.0,
            wind_speed: 12.0,
            weather_code: 0,
        };
        assert_eq!(cw.temperature, 22.0);
        assert_eq!(cw.humidity, 45.0);
        assert_eq!(cw.wind_speed, 12.0);
        assert_eq!(cw.weather_code, 0);
    }

    #[test]
    fn forecast_contains_day_forecasts() {
        let forecast = Forecast {
            days: vec![DayForecast {
                date: "2026-03-25".to_string(),
                temp_max: 18.0,
                temp_min: 8.0,
                weather_code: 3,
                precipitation: 0.5,
            }],
        };
        assert_eq!(forecast.days.len(), 1);
        assert_eq!(forecast.days[0].date, "2026-03-25");
        assert_eq!(forecast.days[0].temp_max, 18.0);
        assert_eq!(forecast.days[0].temp_min, 8.0);
        assert_eq!(forecast.days[0].weather_code, 3);
        assert_eq!(forecast.days[0].precipitation, 0.5);
    }

    #[test]
    fn units_default_is_celsius() {
        let units = Units::default();
        assert!(matches!(units, Units::Celsius));
    }

    #[test]
    fn units_has_both_variants() {
        let _c = Units::Celsius;
        let _f = Units::Fahrenheit;
    }
}
