#!/usr/bin/env python3
"""Stamp the site with its version and a fresh build number.

VERSION holds the version people see (1.0). BUILD is bumped on every publish so
the browser always fetches the new files instead of reusing cached ones.

  python3 tools/stamp.py .            bump the build number, then stamp
  python3 tools/stamp.py . --no-bump  stamp without bumping
"""
import json, pathlib, re, sys

root = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else '.')
version = (root / 'VERSION').read_text().strip()
build_file = root / 'BUILD'
build = int(build_file.read_text().strip() or 0)
if '--no-bump' not in sys.argv:
    build += 1
    build_file.write_text(f'{build}\n')
tag = f'{version}-{build}'

html = (root / 'index.html').read_text()
html = re.sub(r'(href|src)="(assets/[^"?]+\.(?:css|js))(?:\?v=[^"]*)?"', rf'\1="\2?v={tag}"', html)
meta = f'<meta name="app-version" content="{version}" data-build="{build}">'
if 'name="app-version"' in html:
    html = re.sub(r'<meta name="app-version"[^>]*>', meta, html)
else:
    html = html.replace('<meta charset="utf-8">', f'<meta charset="utf-8">\n  {meta}', 1)
(root / 'index.html').write_text(html)
(root / 'version.json').write_text(json.dumps({'version': version, 'build': build}) + '\n')
print(f'stamped version {version}, build {build}')
