#!/bin/bash
# Creates the GitHub release v<package.json version> once, so a rerun or a later push to main is a no-op.
# Needs GH_TOKEN, GITHUB_REPOSITORY and GITHUB_SHA.
set -euo pipefail

tag="v$(node -p "require('./package.json').version")"
repo="${GITHUB_REPOSITORY:?}"

# Only a 404 means absent: a rate limit or outage must fail here, not lead to a create that 422s.
exists() {
  local err
  if err=$(gh api "$1" --silent 2>&1); then
    return 0
  fi
  if [[ "$err" == *"HTTP 404"* ]]; then
    return 1
  fi
  echo "$err" >&2
  exit 1
}

if exists "repos/${repo}/releases/tags/${tag}"; then
  echo "Release ${tag} exists, skipping"
  exit 0
fi

if exists "repos/${repo}/git/ref/tags/${tag}"; then
  echo "Tag ${tag} exists without a release, creating the release from it"
  gh release create "$tag" --verify-tag --title "$tag" --generate-notes
else
  gh release create "$tag" --target "${GITHUB_SHA:?}" --title "$tag" --generate-notes
fi
