use assert_cmd::Command;

#[test]
fn test_london_text_output() {
    let mut cmd = Command::cargo_bin("weather-cli").unwrap();
    let output = cmd.arg("London").assert().success();

    let stdout = String::from_utf8(output.get_output().stdout.clone()).unwrap();

    // Output should contain the city name
    assert!(
        stdout.contains("London"),
        "Output should contain 'London', got: {stdout}"
    );

    // Output should contain temperature-like numbers (digits followed by optional decimal)
    let has_temperature = stdout
        .chars()
        .any(|c| c.is_ascii_digit());
    assert!(
        has_temperature,
        "Output should contain temperature-like numbers, got: {stdout}"
    );
}

#[test]
fn test_london_json_output() {
    let mut cmd = Command::cargo_bin("weather-cli").unwrap();
    let output = cmd.args(["London", "--json"]).assert().success();

    let stdout = String::from_utf8(output.get_output().stdout.clone()).unwrap();

    // Output should be valid JSON
    let json: serde_json::Value =
        serde_json::from_str(&stdout).expect("Output should be valid JSON");

    // JSON should contain expected top-level keys
    assert!(
        json.get("current").is_some(),
        "JSON should have 'current' key"
    );
    assert!(
        json.get("daily").is_some(),
        "JSON should have 'daily' key"
    );
    assert!(
        json.get("hourly").is_some(),
        "JSON should have 'hourly' key"
    );
}

#[test]
fn test_invalid_city_error() {
    let mut cmd = Command::cargo_bin("weather-cli").unwrap();
    let output = cmd.arg("xyznotacity").assert().failure();

    let stderr = String::from_utf8(output.get_output().stderr.clone()).unwrap();

    // Should contain a friendly error message
    assert!(
        stderr.to_lowercase().contains("not found")
            || stderr.to_lowercase().contains("error")
            || stderr.to_lowercase().contains("could not"),
        "Should show a friendly error message, got stderr: {stderr}"
    );
}
