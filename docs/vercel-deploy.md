# Vercel Monorepo Deployment Convention

Each deployable app in this monorepo gets its own Vercel project. This keeps configurations isolated — adding or changing one app never affects another.

## How It Works

1. Each deployable package has a `vercel.json` in its directory
2. Each Vercel project's **Root Directory** points to the package path (e.g., `packages/my-app`)
3. Vercel auto-detects npm workspaces and runs `npm install` from the repo root
4. `ignoreCommand` ensures only changes within the package trigger a deployment

## Adding a New Deployable App

### 1. Create the package

```bash
mkdir -p packages/<app-name>/
# Add package.json with build script, source files, etc.
```

### 2. Add `vercel.json` in the package directory

Use the appropriate template below.

### 3. Create a Vercel project

1. Go to [vercel.com](https://vercel.com) → **Add New → Project**
2. Import the `freematters/freematters` repo
3. Set **Root Directory** to `packages/<app-name>`
4. Set **Framework Preset** to match your app (or "Other" for static)
5. Leave Build/Output overrides empty — `vercel.json` handles it
6. Deploy

### 4. Update root `package.json`

Add the package to the root `build` script so CI also builds it.

## `vercel.json` Templates

### Static HTML

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "buildCommand": "npm run build",
  "outputDirectory": "public",
  "framework": null,
  "ignoreCommand": "git diff HEAD^ HEAD --quiet ."
}
```

### Next.js

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "nextjs",
  "ignoreCommand": "git diff HEAD^ HEAD --quiet ."
}
```

Next.js auto-detects build command and output directory.

### Vite SPA

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "framework": "vite",
  "ignoreCommand": "git diff HEAD^ HEAD --quiet .",
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

The `rewrites` rule enables client-side routing.

## Cross-Package Build Dependencies

If your app depends on another workspace package at build time, chain the builds:

```json
{
  "buildCommand": "npm run build -w packages/shared-lib && npm run build",
  ...
}
```

## Notes

- **No root `vercel.json`** — each package owns its config
- **No `.vercelignore`** — Root Directory scopes file uploads automatically
- **First deployment**: `ignoreCommand` may fail on the very first commit (no `HEAD^`). Vercel defaults to building in this case, which is correct
- **Install**: don't set `installCommand` unless you have a specific reason — Vercel's workspace auto-detection handles it
