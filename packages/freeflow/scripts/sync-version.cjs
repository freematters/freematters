#!/usr/bin/env node
// Syncs .claude-plugin JSON files with package.json version.
// Called automatically by npm's "version" lifecycle script.

const fs = require("node:fs");
const path = require("node:path");

const pkg = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../package.json"), "utf8"),
);
const version = pkg.version;

const files = [".claude-plugin/plugin.json", ".claude-plugin/marketplace.json"];

for (const rel of files) {
  const file = path.join(__dirname, "..", rel);
  const json = JSON.parse(fs.readFileSync(file, "utf8"));
  if (json.version) json.version = version;
  if (json.plugins) {
    for (const p of json.plugins) p.version = version;
  }
  fs.writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
}
