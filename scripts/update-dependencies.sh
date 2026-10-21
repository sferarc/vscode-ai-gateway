#!/bin/bash
# Latest versions of every package except @types/vscode, which stays at the engines.vscode floor.
set -euo pipefail

pnpm install --no-frozen-lockfile
pnpm update --recursive --latest
node -e '
const fs = require("node:fs");
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
pkg.devDependencies["@types/vscode"] = pkg.engines.vscode.replace(/^\^/, "");
fs.writeFileSync("package.json", `${JSON.stringify(pkg, null, "\t")}\n`);
'
pnpm install --no-frozen-lockfile
pnpm exec biome migrate --write || true
