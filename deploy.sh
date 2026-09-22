#!/bin/bash
# Publish the site to both addresses:
#   https://uaspart107.com                  (this repo)
#   https://andemarco15-ctrl.github.io      (mirror, for networks that block new domains)
#
# Usage: ./deploy.sh "commit message" [path-to-mirror-clone]
set -euo pipefail
cd "$(dirname "$0")"
MSG="${1:-Update site}"
MIRROR="${2:-../mirror}"

git add -A
git diff --cached --quiet || git commit -m "$MSG"
git push origin main
echo "pushed → https://uaspart107.com"

if [ ! -d "$MIRROR/.git" ]; then
  echo "No mirror clone at $MIRROR. Clone it with:"
  echo "  git clone https://github.com/andemarco15-ctrl/andemarco15-ctrl.github.io.git $MIRROR"
  exit 0
fi

# The mirror is the same site without the custom-domain file, and keeps its own README.
rsync -a --delete \
  --exclude '.git' --exclude '.claude' --exclude 'CNAME' --exclude '.gitignore' \
  --exclude 'deploy.sh' --exclude 'README.md' \
  ./ "$MIRROR/"
cd "$MIRROR"
git add -A
git diff --cached --quiet || git commit -m "$MSG"
git push origin main
echo "pushed → https://andemarco15-ctrl.github.io"
