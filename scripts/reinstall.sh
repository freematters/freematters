#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../freefsm"

npm run build
npm install -g .
