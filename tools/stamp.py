#!/usr/bin/env python3
"""Stamp the site with the version in VERSION.

- adds ?v=<version> to the CSS/JS the page loads, so a new release is never
  served from an old cache
- writes <meta name="app-version"> into index.html
- writes version.json, which the running site polls to notice a new release
"""
import json, pathlib, re, sys

root = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else '.')
version = (root / 'VERSION').read_text().strip()

html = (root / 'index.html').read_text()
html = re.sub(r'(href|src)="(assets/[^"?]+\.(?:css|js))(?:\?v=[^"]*)?"', rf'\1="\2?v={version}"', html)
if 'name="app-version"' in html:
    html = re.sub(r'<meta name="app-version" content="[^"]*">', f'<meta name="app-version" content="{version}">', html)
else:
    html = html.replace('<meta charset="utf-8">', f'<meta charset="utf-8">\n  <meta name="app-version" content="{version}">', 1)
(root / 'index.html').write_text(html)
(root / 'version.json').write_text(json.dumps({'version': version}) + '\n')
print(f'stamped version {version}')
