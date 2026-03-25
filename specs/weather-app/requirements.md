# Requirements

### Q1: Which weather API do you want to use?

Based on research, Open-Meteo (no API key, free, clean JSON) is the top recommendation, with wttr.in as a simpler fallback. Do you want to go with Open-Meteo, or do you have a preference?

**A1:** Open-Meteo. No API key needed, use its geocoding endpoint for city→lat/lon resolution.

### Q2: What features should the CLI support?

**A2:** Full scope — current weather, daily forecast, hourly forecast, plus extras (sunrise/sunset, wind, humidity, etc.)

### Q3: What tech stack do you want?

**A3:** Rust. Single binary, fast, no runtime dependencies.

### Q4: What should the CLI interface look like?

**A4:** Simple positional — `weather beijing` shows everything (current + forecast + hourly). Flags for options like `--days 7`, `--json`.

### Q5: How should the output be formatted?

**A5:** Friendly, colorful output with emoji weather icons. Tables for forecast. Also support `--json` for machine-readable output.

### Q6: E2E testing?

**A6:** Skipped — not needed for a standalone CLI tool outside the monorepo.

