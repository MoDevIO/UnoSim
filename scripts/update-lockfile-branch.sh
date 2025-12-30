#!/usr/bin/env bash
set -euo pipefail

# Helper: create branch, run npm install to update package-lock.json, commit and push
if [ -z "$(git status --porcelain)" ]; then
  echo "Working tree clean. Creating branch fix/lockfile..."
else
  echo "Please commit or stash local changes before running this script." >&2
  exit 1
fi

BRANCH="fix/lockfile"
git checkout -b "$BRANCH"

echo "Running npm install to update package-lock.json (this will modify lockfile)..."
npm install

git add package-lock.json
git commit -m "chore: update package-lock.json"
git push -u origin "$BRANCH"

echo "Branch '$BRANCH' pushed. Open a PR on GitHub to merge the updated lockfile."
