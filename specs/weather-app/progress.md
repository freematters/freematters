# Progress

## Step 1: Project Scaffold & CLI Parser
- **Files changed**: weather-cli/Cargo.toml, weather-cli/src/{main,cli,geocoder,weather,display,json}.rs
- **What was built**: Rust project with clap-based CLI parser, Args struct with city/days/json/units, stub modules
- **Tests**: 6 unit tests added (all passing) — default values, flag parsing, validation
- **Notes**: Used tokio current_thread flavor for single-threaded CLI

## Step 2: Geocoder Module
- **Files changed**: weather-cli/src/geocoder.rs
- **What was built**: Location struct, geocode() function hitting Open-Meteo geocoding API
- **Tests**: 2 tests added (all passing) — known city resolution, unknown city error
- **Notes**: Tests hit real API, no mocking
