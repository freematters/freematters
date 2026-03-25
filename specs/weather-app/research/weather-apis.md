# Weather API Research

**Date:** 2026-03-25

---

## Summary

There are several high-quality free weather APIs available for building a CLI weather tool. The strongest candidates are **Open-Meteo**, **OpenWeatherMap**, **wttr.in**, and **WeatherAPI.com**. They differ meaningfully in authentication requirements, rate limits, data richness, and licensing. Open-Meteo stands out for non-commercial projects because it requires no API key, offers generous rate limits, and provides clean JSON responses. For projects that may eventually go commercial or need the simplest possible integration, wttr.in (no auth, curl-native) and OpenWeatherMap (massive ecosystem) are strong alternatives.

---

## Key Findings

1. **Open-Meteo requires no API key for non-commercial use.** This eliminates onboarding friction entirely -- users can start making requests immediately without signing up for anything. Rate limits are 10,000 calls/day, 5,000/hour, 600/minute.

2. **wttr.in is uniquely CLI-friendly.** It was built for terminal use (`curl wttr.in/London`) and supports ANSI-colored text output natively, plus JSON via `?format=j1`. No API key or signup required. However, it has no documented rate limits, which is a risk for reliability planning.

3. **OpenWeatherMap has the largest ecosystem** with 1,000,000 free calls/month (60/minute). It requires an API key (free signup). The free tier covers current weather, 5-day/3-hour forecast, air pollution, geocoding, and weather map layers.

4. **WeatherAPI.com offers a competitive free tier** with current weather, multi-day forecast, astronomy, and search/autocomplete. It requires an API key. Exact free-tier call limits were not extractable from their current site but historically offer 1,000,000 calls/month on the free plan with 3-day forecast.

5. **Open-Meteo provides the richest free data set**: current conditions (15-min updates), up to 16-day forecast, and up to 92 days of historical data -- all from a single `/v1/forecast` endpoint. Data is licensed CC-BY 4.0.

6. **JSON response quality varies significantly.** Open-Meteo returns flat numeric arrays keyed by variable name (efficient, needs client-side assembly). wttr.in's `j1` format returns nested objects with pre-formatted strings (easy to display, harder to compute with). OpenWeatherMap returns a middle-ground nested JSON.

7. **All services cover global locations.** Open-Meteo uses coordinates (lat/lon), OpenWeatherMap supports city names and coordinates, wttr.in accepts city names, airport codes, coordinates, and even domain names.

---

## Trade-offs

### Open-Meteo

**Pros:**
- No API key needed for non-commercial use
- Generous rate limits (10K/day)
- Richest free data: current + 16-day forecast + 92-day history
- Clean, well-structured JSON (also CSV/XLSX)
- Open source, self-hostable
- CC-BY 4.0 licensed data

**Cons:**
- Requires latitude/longitude coordinates (need a geocoding step for city names)
- Non-commercial restriction on free tier (no ads, no subscriptions)
- Response is array-based rather than object-per-timestamp (requires assembly)
- Swiss jurisdiction for legal matters

### wttr.in

**Pros:**
- Zero configuration -- no API key, no signup
- Native terminal/ANSI output (perfect for CLI tools)
- Accepts flexible location formats (city, airport code, IP, coordinates)
- JSON available via `?format=j1` (full) or `?format=j2` (compact)
- Multi-language support (35+ languages)

**Cons:**
- No documented rate limits (risk of throttling without warning)
- No SLA or reliability guarantees
- JSON structure uses string values for numbers (e.g., `"temp_C": "15"`)
- Limited to current + 3-day forecast
- Backed by WorldWeatherOnline data; unclear long-term sustainability
- No historical data access

### OpenWeatherMap

**Pros:**
- Largest weather API ecosystem; extensive documentation
- 1,000,000 calls/month free (60/min)
- Well-known, stable, widely used in tutorials and projects
- Supports city name lookups natively
- Includes air pollution and geocoding APIs free

**Cons:**
- Requires API key (free signup, but still friction)
- Free tier limited to 5-day/3-hour forecast (no daily or extended)
- Historical data requires paid plan (or student plan)
- API response includes some legacy/redundant fields
- Key activation can take up to 2 hours after signup

### WeatherAPI.com

**Pros:**
- Generous free tier with current, forecast, and astronomy data
- Built-in search/autocomplete for locations
- Clean, well-documented JSON responses
- Supports both JSON and XML

**Cons:**
- Requires API key (free signup)
- Free forecast limited to ~3 days
- Historical data requires paid plan
- Less community adoption than OpenWeatherMap

---

## Recommendations

### Primary recommendation: Open-Meteo

For a CLI weather tool, **Open-Meteo** is the best choice for these reasons:

1. **No API key required** -- users can install the tool and use it immediately. This is the single biggest advantage for a CLI tool where onboarding friction matters.
2. **Generous limits** -- 10,000 calls/day is more than sufficient for personal CLI use.
3. **Data richness** -- 16-day forecast and historical data from a single endpoint.
4. **Clean JSON** -- predictable structure, easy to parse programmatically.

The main gap is geocoding (Open-Meteo needs lat/lon). This can be solved by:
- Using Open-Meteo's own geocoding endpoint (`https://geocoding-api.open-meteo.com/v1/search?name=London`)
- Caching resolved coordinates locally

### Secondary recommendation: wttr.in as fallback or alternative mode

wttr.in is worth supporting as a secondary backend because:
- It requires zero configuration
- Its ANSI output can be piped directly to the terminal for a rich display
- It accepts human-friendly location strings
- The `j1` JSON format provides enough data for basic current + 3-day forecast

### Not recommended as primary: OpenWeatherMap

While OpenWeatherMap is the most popular option, the API key requirement adds friction that is unnecessary when Open-Meteo provides equivalent or better free-tier data without one. OpenWeatherMap is a reasonable fallback if the user already has a key.

---

## References

| Source | URL |
|--------|-----|
| Open-Meteo Documentation | https://open-meteo.com/en/docs |
| Open-Meteo Terms of Service | https://open-meteo.com/en/terms |
| Open-Meteo Geocoding API | https://open-meteo.com/en/docs/geocoding-api |
| OpenWeatherMap Pricing | https://openweathermap.org/price |
| OpenWeatherMap Current Weather | https://openweathermap.org/current |
| wttr.in GitHub Repository | https://github.com/chubin/wttr.in |
| wttr.in JSON format | https://wttr.in/:help |
| WeatherAPI.com | https://www.weatherapi.com/ |
| WeatherAPI.com Docs | https://www.weatherapi.com/docs/ |
