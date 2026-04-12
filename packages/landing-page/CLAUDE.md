# Landing Page

Marketing landing page for FreeFlow — agent workflow engine. React 19 + Vite single-page application with interactive workflow demos, animated state machines, and a multi-theme system.

## Tech Stack

| Layer | Tool |
|-------|------|
| Framework | React 19 + TypeScript (strict) |
| Build | Vite 6 |
| Styling | Tailwind CSS 4 (Vite plugin) |
| Components | shadcn/ui (New York style) + Radix UI primitives |
| Icons | Lucide React |
| Class utils | `cn()` via clsx + tailwind-merge |

## Build & Dev

```bash
npm run dev       # Vite dev server
npm run build     # tsc -b && vite build
npm run preview   # serve dist/
```

## Project Structure

```
src/
├── main.tsx                        # Entry point
├── App.tsx                         # Root — assembles all sections
├── globals.css                     # Tailwind import + global styles
├── vite-env.d.ts
├── lib/
│   └── utils.ts                    # cn() class merge utility
├── themes/
│   ├── tokens.css                  # CSS variables for all 6 themes
│   ├── theme-provider.tsx          # ThemeProvider context + useTheme()
│   └── theme-switcher.tsx          # Theme selector UI
├── components/
│   ├── Nav.tsx                     # Top navigation bar
│   ├── CtaFooter.tsx               # Bottom CTA section
│   ├── hero/
│   │   ├── HeroSection.tsx         # Hero with animated workflow demo
│   │   ├── StateGraph.tsx          # SVG state machine visualization
│   │   ├── TerminalPanel.tsx       # Simulated terminal output
│   │   └── YamlPanel.tsx           # YAML config display
│   ├── sections/
│   │   ├── HowItWorks.tsx          # Mechanism explanation
│   │   ├── WorkflowShowcase.tsx    # Built-in workflow tabs
│   │   └── Composable.tsx          # Composable architecture demo
│   └── ui/                         # shadcn/ui primitives
│       ├── badge.tsx
│       ├── button.tsx
│       ├── card.tsx
│       ├── scroll-area.tsx
│       ├── separator.tsx
│       └── tabs.tsx
├── data/
│   ├── showcase.ts                 # Workflow graph definitions (nodes, edges, viewBox)
│   ├── composable.ts               # Parent/child workflow structures
│   └── workflow-states.ts          # State definitions + YAML lines for animation
└── hooks/
    └── use-workflow-animation.ts   # Hero section animation state machine
```

## Theme System

6 themes, applied via `data-theme` attribute on `<html>`. Persisted in localStorage key `fflow-theme`.

| Theme | Character | Background |
|-------|-----------|------------|
| **noir** (default) | Dark warm | `#0e0d0b` |
| **aurora** | Dark cool | `#09090f` |
| **light** | Light warm | `#fafaf7` |
| **mono** | Monochrome | `#0a0a0a` |
| **glass** | Translucent | `transparent` |
| **paper** | Warm paper | `#f5f0e4` |

### CSS Variable Tokens

All themes define these variables in `src/themes/tokens.css`:

| Token | Purpose |
|-------|---------|
| `--bg`, `--bg2` | Primary / secondary background |
| `--text` | Body text color |
| `--accent` | Accent / highlight color |
| `--dim` | Muted / secondary text |
| `--border` | Border color |
| `--ok` | Success / positive color |
| `--fh` | Heading font stack |
| `--fb` | Body font stack |
| `--fm` | Monospace font stack |
| `--term-bg`, `--term-border`, `--term-bar` | Terminal panel colors |

Use these tokens via `var(--token)` in Tailwind arbitrary values or inline styles. Do not hardcode colors.

## Component Architecture

App.tsx renders sections in this order:

```
<ThemeProvider>
  <ThemeSwitcher />      ← floating theme selector
  <Nav />                ← top bar with logo + links
  <HeroSection />        ← animated workflow demo
  <HowItWorks />         ← mechanism explanation (3 cards)
  <WorkflowShowcase />   ← tabbed built-in workflows
  <Composable />         ← parent/child workflow architecture
  <CtaFooter />          ← npx freeflow init CTA
</ThemeProvider>
```

## Data Structures

Workflow visualizations use a shared graph model (`src/data/showcase.ts`):

```typescript
interface GraphNode {
  id: string; label: string;
  x: number; y: number;        // SVG coordinates
  terminal?: boolean;
}
interface GraphEdge { from: string; to: string; label?: string; }
interface WorkflowGraph {
  id: string; label: string;
  nodes: GraphNode[]; edges: GraphEdge[];
  viewBox: string;
}
```

Composable workflows (`src/data/composable.ts`) extend this with `composite?: string` on nodes to indicate sub-workflow embedding.

## UI Development Workflow

Playwright MCP enables the agent to directly inspect the live page — reading element trees via `browser_snapshot` without the user having to describe UI state. This makes UI iteration significantly faster and more precise.

### First-Time Setup

Check if Playwright MCP is available by looking for `mcp__playwright__*` tools in your tool list.

**If Playwright MCP tools are NOT available:**

1. Install the Playwright plugin in Claude Code:
   ```bash
   claude mcp add playwright -- npx @playwright/mcp@latest
   ```
2. One-time Chrome install:
   ```bash
   npx playwright install chrome
   ```
3. Restart the Claude Code session to pick up the new MCP server.

**If Playwright MCP tools ARE available**, you're good to go — skip to Quick Start.

### Quick Start (with Playwright)

```
npm run dev                  # start Vite dev server
browser_navigate(url)        # open in Playwright
browser_snapshot()           # read element tree — use this for all verification
```

### Recommended Patterns

1. **Before editing a component**: run `browser_snapshot` to read the current element structure — understand what's on the page before changing code
2. **After editing**: `browser_snapshot` to verify the change rendered correctly
3. **Theme verification**: click theme buttons via `browser_click` → `browser_snapshot` to confirm structure, ask the user to visually confirm in their browser
4. **Do NOT use `browser_take_screenshot`** — it generates PNG files that pollute the repo and consumes excessive image tokens. Visual checks (layout, color, spacing) should be done by the user in their browser

### Without Playwright MCP (Fallback)

If Playwright MCP is not installed or unavailable, UI iteration still works — just with less precision:

1. Start `npm run dev` and tell the user to open the page in their browser
2. Read component source code directly to understand current structure
3. After making changes, ask the user to visually confirm the result
4. For theme checks, read `src/themes/tokens.css` to reason about how tokens apply

## Deployment

Deployed on Vercel. Vite base path is `./` (relative) for subpath compatibility. See repo-level `docs/vercel-deploy.md` for the monorepo deployment convention. Package-level config is in `vercel.json`.

## Conventions

- See root `CLAUDE.md` for monorepo-wide conventions (biome, TypeScript, no cross-package imports)
- Path alias: `@/*` → `src/*`
- Use `cn()` from `@/lib/utils` for merging Tailwind classes
- shadcn/ui components live in `src/components/ui/` — add new ones via `npx shadcn@latest add <component>`
- No tests currently — visual verification via Playwright MCP or manual browser check
