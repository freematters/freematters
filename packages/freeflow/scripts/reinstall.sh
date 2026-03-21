#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

# Build and install CLI globally
npm run build
npm install -g .

# Register as Claude plugin
fflow install claude
