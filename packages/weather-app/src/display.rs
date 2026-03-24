// Display formatting module — colored terminal output

use crate::ascii_art::{weather_art, weather_description, weather_emoji};
use crate::geocode::Location;
use crate::weather::{CurrentWeather, DayForecast, Units};
use chrono::NaiveDate;
use colored::*;

/// Returns a friendly one-liner based on the WMO weather code.
pub fn weather_quip(wmo_code: i32) -> &'static str {
    match wmo_code {
        0 => "Looks like a beautiful day!",
        1 | 2 => "A bit grey, but still a good day!",
        3 => "A bit grey, but still a good day!",
        45 | 48 => "Drive carefully in the fog!",
        51..=57 => "Don't forget your umbrella!",
        61..=67 => "Don't forget your umbrella!",
        71..=77 => "Bundle up, it's snowy out there!",
        80..=82 => "Don't forget your umbrella!",
        85 | 86 => "Bundle up, it's snowy out there!",
        95 | 96 | 99 => "Stay safe indoors if you can!",
        _ => "Enjoy your day!",
    }
}

/// Colorize a temperature value based on units.
fn temp_color(temp: f64, units: &Units) -> ColoredString {
    let (label, cold, hot) = match units {
        Units::Metric => ("\u{00b0}C", 10.0, 30.0),
        Units::Imperial => ("\u{00b0}F", 50.0, 86.0),
    };
    let text = format!("{temp:.1}{label}");
    if temp < cold {
        text.blue()
    } else if temp > hot {
        text.red()
    } else {
        text.yellow()
    }
}

/// Format current weather with ASCII art on the left and stats on the right.
pub fn format_current(location: &Location, current: &CurrentWeather, units: &Units) -> String {
    let art = weather_art(current.weather_code);
    let art_lines: Vec<&str> = art.lines().collect();

    let description = weather_description(current.weather_code);
    let emoji = weather_emoji(current.weather_code);
    let quip = weather_quip(current.weather_code);
    let temp = temp_color(current.temperature, units);
    let wind_unit = match units {
        Units::Metric => "km/h",
        Units::Imperial => "mph",
    };

    let info_lines = vec![
        format!("\u{1f4cd} {}", location.name),
        format!("{emoji}  {description}"),
        format!("\u{1f321}\u{fe0f}  Temperature: {temp}"),
        format!("\u{1f4a7} Humidity: {:.0}%", current.humidity),
        format!("\u{1f4a8} Wind: {:.1} {wind_unit}", current.wind_speed),
    ];

    // Determine the art width for alignment
    let art_width = art_lines.iter().map(|l| l.chars().count()).max().unwrap_or(0);
    let separator = "    "; // gap between art and info

    let max_lines = art_lines.len().max(info_lines.len());
    let mut lines: Vec<String> = Vec::with_capacity(max_lines + 3);

    for i in 0..max_lines {
        let art_part = if i < art_lines.len() {
            format!("{:<width$}", art_lines[i], width = art_width)
        } else {
            " ".repeat(art_width)
        };
        let info_part = if i < info_lines.len() {
            &info_lines[i]
        } else {
            ""
        };
        lines.push(format!("{art_part}{separator}{info_part}"));
    }

    lines.push(String::new());
    lines.push(format!("  {quip}"));
    lines.push(String::new());
    lines.push("Have a great day! \u{1f324}\u{fe0f}".to_string());

    lines.join("\n")
}

/// Format the daily forecast as a Unicode box-drawing table.
pub fn format_forecast(daily: &[DayForecast], units: &Units) -> String {
    if daily.is_empty() {
        return String::new();
    }

    let deg = match units {
        Units::Metric => "\u{00b0}C",
        Units::Imperial => "\u{00b0}F",
    };

    // Build row data
    struct Row {
        day: String,
        emoji: String,
        temp_range: String,
        precip: String,
    }

    let rows: Vec<Row> = daily
        .iter()
        .map(|d| {
            let day = NaiveDate::parse_from_str(&d.date, "%Y-%m-%d")
                .map(|nd| nd.format("%a").to_string())
                .unwrap_or_else(|_| d.date.clone());
            let emoji = weather_emoji(d.weather_code).to_string();
            let temp_range = format!("{:.0}{deg} / {:.0}{deg}", d.temp_min, d.temp_max);
            let precip = if d.precipitation_sum > 0.0 {
                format!("\u{1f4a7} {:.1}mm", d.precipitation_sum)
            } else {
                String::new()
            };
            Row {
                day,
                emoji,
                temp_range,
                precip,
            }
        })
        .collect();

    // Calculate column widths (use char count for proper Unicode alignment)
    let col_day = rows.iter().map(|r| r.day.chars().count()).max().unwrap_or(3).max(3);
    let col_emoji = 4; // emoji column fixed
    let col_temp = rows
        .iter()
        .map(|r| r.temp_range.chars().count())
        .max()
        .unwrap_or(5)
        .max(5);
    let col_precip = rows
        .iter()
        .map(|r| r.precip.chars().count())
        .max()
        .unwrap_or(6)
        .max(6);

    let header_text = if daily.len() == 7 {
        "7-Day Forecast".to_string()
    } else {
        format!("{}-Day Forecast", daily.len())
    };

    let total_inner = col_day + 3 + col_emoji + 3 + col_temp + 3 + col_precip;
    let top = format!(
        "\u{250c}{}\u{2500}\u{2510}",
        "\u{2500}".repeat(total_inner + 1)
    );
    let header_line = format!(
        "\u{2502} {:<width$} \u{2502}",
        header_text,
        width = total_inner
    );
    let sep_after_header = format!(
        "\u{251c}{}\u{2500}\u{253c}{}\u{2500}\u{253c}{}\u{2500}\u{253c}{}\u{2500}\u{2524}",
        "\u{2500}".repeat(col_day + 1),
        "\u{2500}".repeat(col_emoji + 1),
        "\u{2500}".repeat(col_temp + 1),
        "\u{2500}".repeat(col_precip + 1),
    );
    let bottom = format!(
        "\u{2514}{}\u{2500}\u{2534}{}\u{2500}\u{2534}{}\u{2500}\u{2534}{}\u{2500}\u{2518}",
        "\u{2500}".repeat(col_day + 1),
        "\u{2500}".repeat(col_emoji + 1),
        "\u{2500}".repeat(col_temp + 1),
        "\u{2500}".repeat(col_precip + 1),
    );

    let mut out = Vec::new();
    out.push(top);
    out.push(header_line);
    out.push(sep_after_header);

    for row in &rows {
        out.push(format!(
            "\u{2502} {:<col_day$} \u{2502} {:<col_emoji$} \u{2502} {:<col_temp$} \u{2502} {:<col_precip$} \u{2502}",
            row.day, row.emoji, row.temp_range, row.precip,
        ));
    }

    out.push(bottom);
    out.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::geocode::Location;
    use crate::weather::{CurrentWeather, DayForecast, Units};

    #[test]
    fn clear_weather_quip_contains_beautiful() {
        let quip = weather_quip(0);
        assert!(
            quip.contains("beautiful"),
            "Expected 'beautiful' in quip for clear sky, got: {quip}"
        );
    }

    #[test]
    fn rain_weather_quip_contains_umbrella() {
        let quip = weather_quip(61);
        assert!(
            quip.contains("umbrella"),
            "Expected 'umbrella' in quip for rain, got: {quip}"
        );
    }

    #[test]
    fn forecast_row_omits_rain_when_no_precipitation() {
        let daily = vec![DayForecast {
            date: "2026-03-24".to_string(),
            weather_code: 0,
            temp_max: 20.0,
            temp_min: 10.0,
            precipitation_sum: 0.0,
        }];
        let output = format_forecast(&daily, &Units::Metric);
        assert!(
            !output.contains("\u{1f4a7}"),
            "Expected no rain indicator when precipitation is 0.0, got:\n{output}"
        );
    }

    #[test]
    fn forecast_row_includes_rain_when_precipitation_present() {
        let daily = vec![DayForecast {
            date: "2026-03-25".to_string(),
            weather_code: 61,
            temp_max: 15.0,
            temp_min: 8.0,
            precipitation_sum: 3.2,
        }];
        let output = format_forecast(&daily, &Units::Metric);
        assert!(
            output.contains("\u{1f4a7}"),
            "Expected rain indicator when precipitation > 0, got:\n{output}"
        );
        assert!(
            output.contains("3.2"),
            "Expected precipitation amount in output, got:\n{output}"
        );
    }

    #[test]
    fn forecast_table_contains_box_drawing_characters() {
        let daily = vec![DayForecast {
            date: "2026-03-24".to_string(),
            weather_code: 0,
            temp_max: 20.0,
            temp_min: 10.0,
            precipitation_sum: 0.0,
        }];
        let output = format_forecast(&daily, &Units::Metric);
        assert!(output.contains("\u{250c}"), "Missing top-left corner");
        assert!(output.contains("\u{2510}"), "Missing top-right corner");
        assert!(output.contains("\u{2514}"), "Missing bottom-left corner");
        assert!(output.contains("\u{2518}"), "Missing bottom-right corner");
        assert!(output.contains("\u{2500}"), "Missing horizontal line");
        assert!(output.contains("\u{2502}"), "Missing vertical line");
    }

    #[test]
    fn format_current_contains_location_name() {
        let location = Location {
            name: "Berlin".to_string(),
            latitude: 52.52,
            longitude: 13.405,
        };
        let current = CurrentWeather {
            temperature: 18.5,
            humidity: 65.0,
            wind_speed: 12.3,
            weather_code: 0,
        };
        let output = format_current(&location, &current, &Units::Metric);
        assert!(
            output.contains("Berlin"),
            "Expected location name in output, got:\n{output}"
        );
    }
}
