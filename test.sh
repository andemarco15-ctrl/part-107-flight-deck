#!/bin/bash
# Publish the current work to the TEST site: https://andemarco15-ctrl.github.io
# Nothing here touches the real site.
#
# Usage: ./test.sh "what changed" [path-to-test-clone]
set -euo pipefail
cd "$(dirname "$0")"
MSG="${1:-Test build}"
python3 tools/stamp.py .
MIRROR="${2:-../mirror}"

if [ ! -d "$MIRROR/.git" ]; then
  echo "No test clone at $MIRROR. Create it with:"
  echo "  git clone https://github.com/andemarco15-ctrl/andemarco15-ctrl.github.io.git $MIRROR"
  exit 1
fi

# Record exactly what is being tested, on the local "test" branch.
git add -A
git diff --cached --quiet || git commit -q -m "$MSG"
git branch -f test HEAD

# Copy the site across, minus the files that belong to the real site only.
rsync -a --delete \
  --exclude '.git' --exclude '.claude' --exclude 'CNAME' --exclude '.gitignore' \
  --exclude 'test.sh' --exclude 'ship.sh' --exclude 'README.md' --exclude 'tools' --exclude 'VERSION' \
  ./ "$MIRROR/"

# Mark it as the test copy and keep it out of search results.
python3 - "$MIRROR" <<'PY'
import sys, pathlib
root = pathlib.Path(sys.argv[1])
robots = '<meta name="robots" content="noindex, nofollow">'
for name in ('index.html', '404.html'):
    p = root / name
    s = p.read_text()
    if robots not in s:
        s = s.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n  ' + robots, 1)
    s = s.replace('<body data-view="dashboard">', '<body data-view="dashboard" data-env="test">', 1)
    s = s.replace('<title>', '<title>[TEST] ', 1)
    p.write_text(s)
PY

cd "$MIRROR"
git add -A
if git diff --cached --quiet; then
  echo "No changes to publish."
else
  git commit -q -m "$MSG"
  git push -q origin main
  echo "published → https://andemarco15-ctrl.github.io (takes ~30s to appear)"
fi
