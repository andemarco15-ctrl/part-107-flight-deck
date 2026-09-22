#!/bin/bash
# Merge the tested version to the REAL site: https://uaspart107.com
# Run ./test.sh first and check the test site.
#
# Usage: ./ship.sh "what changed"
set -euo pipefail
cd "$(dirname "$0")"
MSG="${1:-Update site}"
python3 tools/stamp.py . --no-bump  # ship exactly the build that was tested

git add -A
git diff --cached --quiet || git commit -q -m "$MSG"

if git rev-parse --verify -q test >/dev/null && [ "$(git rev-parse test)" != "$(git rev-parse HEAD)" ]; then
  echo "Warning: HEAD differs from the last tested build (branch 'test')."
  echo "  tested: $(git log -1 --format='%h %s' test)"
  echo "  now:    $(git log -1 --format='%h %s' HEAD)"
fi

git push -q origin main
git branch -f test HEAD
echo "shipped → https://uaspart107.com (takes ~30s to appear)"
