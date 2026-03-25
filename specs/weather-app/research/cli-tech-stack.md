# CLI Tech Stack Research: Weather Tool

## Summary

This document evaluates technology choices for building a standalone command-line weather tool. We compare four language ecosystems (Node.js/TypeScript, Python, Go, Rust), their argument-parsing and terminal-formatting libraries, and draw inspiration from existing open-source weather CLIs. The primary decision axes are developer velocity, distribution ease, runtime performance, and richness of terminal output. For a standalone weather CLI whose core logic is "fetch API, format output," Node.js/TypeScript and Go emerge as the strongest candidates, with Python as a pragmatic fallback and Rust as an option only if binary size and startup time are critical.

## Key Findings

1. **Node.js/TypeScript ecosystem has the richest terminal-UI library set.** Packages like `chalk` (colors), `cli-table3` / `tty-table` (tables), `ora` (spinners), `boxen` (boxes), and `figlet` (ASCII banners) are mature, composable, and well-maintained. The `ink` framework even brings React-style rendering to the terminal.

2. **Go produces single static binaries with zero runtime dependencies.** This makes distribution trivial (copy the binary). The Go CLI ecosystem is strong: `cobra` + `viper` for argument parsing and config, `lipgloss` / `glamour` / `termenv` from Charm for styled terminal output, and `tablewriter` for tables.

3. **Python has the lowest barrier to entry but the hardest distribution story.** `argparse` is built-in; `click` and `typer` provide richer ergonomics. `rich` (by Will McGuinness) is a standout library for colors, tables, markdown rendering, progress bars, and tree views. However, shipping a Python CLI to end users requires bundling (PyInstaller, shiv) or expecting a Python runtime.

4. **Rust delivers the smallest, fastest binaries but has the steepest learning curve.** `clap` (argument parsing) and `colored` / `termcolor` (colors) are mature. `comfy-table` handles tables. Build times are longer than Go, and the async story (needed for HTTP) adds complexity (`tokio` + `reqwest`).

5. **Existing weather CLIs worth studying:**
   - **wego** (Go) — ASCII-art weather display using wego's own rendering engine; reads from multiple weather APIs. Clean architecture separating data fetching from rendering.
   - **wttr.in** (Python/server-side) — curl-friendly weather service; its terminal output format (ASCII art + ANSI colors) is the de facto standard for "weather in terminal." The client is just `curl`.
   - **weather-cli** (Node.js) — simple OpenWeatherMap wrapper using `chalk` and `ora`. Good reference for minimal viable feature set.
   - **rusty-weather** (Rust) — newer Rust-based CLI; demonstrates `clap` + `reqwest` + `colored` integration.

6. **Weather APIs to consider:** OpenWeatherMap (free tier: 1000 calls/day), WeatherAPI.com (free tier: 1M calls/month), Open-Meteo (fully free, no key required, open-source), and wttr.in's JSON endpoint.

7. **ASCII art weather icons** are a defining UX feature of terminal weather tools. `wego` includes a full icon set; alternatively, Unicode block/braille characters or emoji can be used for a simpler approach.

## Trade-offs

### Node.js / TypeScript

| Pros | Cons |
|------|------|
| Richest terminal-UI library ecosystem | Requires Node.js runtime on user's machine |
| Fast development iteration (ts-node, tsx) | Larger distribution size if bundled (e.g., pkg, vercel/pkg) |
| Native JSON handling (weather APIs return JSON) | Startup overhead (~100-200ms for Node process) |
| TypeScript gives type safety without compilation friction | `node_modules` size can be surprising |
| `fetch` is built-in since Node 18 | SEA (Single Executable Application) support is still maturing |

### Python

| Pros | Cons |
|------|------|
| `rich` library alone covers colors, tables, panels, markdown | Distribution to non-developers is painful |
| `typer` + `rich` gives polished CLI with minimal code | Slower startup than compiled languages |
| Huge ecosystem for data manipulation if needed | Dependency management (venv, pip) adds friction |
| Most developers can read/write Python | Type annotations are advisory, not enforced at runtime |

### Go

| Pros | Cons |
|------|------|
| Single static binary, trivial cross-compilation | Verbose error handling |
| Fast startup (~5-10ms) | Terminal-UI libraries are good but fewer than Node/Python |
| `cobra` is the de facto standard for CLI apps | No generics until 1.18; some libraries lag |
| `wego` proves the approach works well for weather CLIs | JSON unmarshalling requires struct definitions |
| Charm ecosystem (`lipgloss`, `bubbletea`) is excellent | Module/package management has rough edges |

### Rust

| Pros | Cons |
|------|------|
| Smallest binaries, fastest execution | Steep learning curve (ownership, lifetimes) |
| `clap` derive macros make arg parsing ergonomic | Longer compile times |
| Memory safety without GC | Async runtime (`tokio`) adds complexity for simple HTTP |
| Strong community push for CLI tools (ripgrep, fd, bat) | Fewer high-level terminal formatting libraries |

## Recommendations

### Primary recommendation: **Node.js / TypeScript**

**Rationale:**

1. **Developer velocity** is the top priority for a weather CLI, which is fundamentally a thin wrapper around an API. TypeScript lets us iterate quickly with strong type safety.
2. **Terminal output libraries are unmatched.** `chalk`, `cli-table3`, `boxen`, and `figlet` compose naturally. For richer UIs, `ink` provides a React-like model.
3. **Argument parsing with `commander` or `yargs`** is straightforward. For a modern approach, `citty` (from UnJS) or `cleye` are lightweight alternatives.
4. **Distribution**: For developer audiences, `npx weather-tool` works out of the box. For broader distribution, Node.js SEA or `pkg` can produce standalone binaries.
5. **JSON is native.** Weather APIs return JSON; no marshalling boilerplate needed.

### Suggested library stack (TypeScript):

| Concern | Library | Notes |
|---------|---------|-------|
| Argument parsing | `commander` or `yargs` | `commander` for simplicity, `yargs` for complex subcommands |
| HTTP client | Built-in `fetch` (Node 18+) | No external dependency needed |
| Colors/styling | `chalk` | De facto standard |
| Tables | `cli-table3` | Handles Unicode width correctly |
| Spinners/loading | `ora` | Clean async-friendly API |
| ASCII art banners | `figlet` | Optional, for splash screens |
| Box drawing | `boxen` | Wraps text in styled boxes |
| Configuration | `conf` or `rc` | For storing API keys, default location |

### Secondary recommendation: **Go**

If distribution as a zero-dependency binary is a hard requirement (e.g., `brew install weather-tool`), Go is the better choice. Use `cobra` for CLI structure and the Charm stack (`lipgloss`, `bubbletea`) for terminal rendering. `wego` serves as a direct architectural reference.

### Weather API recommendation: **Open-Meteo**

Open-Meteo requires no API key, is fully open-source, and provides comprehensive weather data (current, hourly, daily forecasts, historical data). This eliminates onboarding friction for users. WeatherAPI.com is a good secondary option if geocoding or air-quality data is needed.

## References

- **wego** (Go weather CLI): https://github.com/schachmat/wego
- **wttr.in** (curl-based weather): https://github.com/chubin/wttr.in
- **Open-Meteo API**: https://open-meteo.com/en/docs
- **OpenWeatherMap API**: https://openweathermap.org/api
- **chalk** (Node.js colors): https://github.com/chalk/chalk
- **cli-table3** (Node.js tables): https://github.com/cli-table/cli-table3
- **ora** (Node.js spinner): https://github.com/sindresorhus/ora
- **commander** (Node.js arg parsing): https://github.com/tj/commander.js
- **yargs** (Node.js arg parsing): https://github.com/yargs/yargs
- **rich** (Python terminal formatting): https://github.com/Textualize/rich
- **typer** (Python CLI framework): https://github.com/tiangolo/typer
- **cobra** (Go CLI framework): https://github.com/spf13/cobra
- **lipgloss** (Go terminal styling): https://github.com/charmbracelet/lipgloss
- **bubbletea** (Go TUI framework): https://github.com/charmbracelet/bubbletea
- **clap** (Rust arg parsing): https://github.com/clap-rs/clap
- **ink** (React for CLI): https://github.com/vadimdemedes/ink
