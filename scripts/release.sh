#!/bin/bash
# Publishes the extension when package.json carries a version the Marketplace does not have.
# Called by the changesets action once the version PR has merged; needs VSCE_PAT.
set -euo pipefail

LOCAL_VERSION=$(node -p "require('./package.json').version")
EXTENSION_ID="SferaDev.vscode-extension-vercel-ai"

PUBLISHED_VERSION=$(pnpm exec vsce show "$EXTENSION_ID" --json 2>/dev/null | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).versions[0]?.version||'')}catch{console.log('')}})" || echo "")

if [ "$LOCAL_VERSION" = "$PUBLISHED_VERSION" ]; then
  echo "Extension version $LOCAL_VERSION is already published, skipping"
  exit 0
fi

echo "Publishing extension $LOCAL_VERSION (Marketplace has ${PUBLISHED_VERSION:-none})"
pnpm package

# A concurrent run can publish the same version while this one packages, and
# "already exists" then means the goal is met.
set +e
OUTPUT=$(pnpm exec vsce publish --no-dependencies --packagePath ./*.vsix 2>&1)
STATUS=$?
set -e
echo "$OUTPUT"
if [ $STATUS -ne 0 ] && ! echo "$OUTPUT" | grep -q "already exists"; then
  exit $STATUS
fi
