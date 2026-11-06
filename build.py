#!/usr/bin/env python3
"""Assemble src/template.html + src/*.js into a single self-contained dist/index.html."""
import pathlib
root = pathlib.Path(__file__).parent
order = ['core.js', 'engine.js', 'views.js', 'events.js']   # order matters
js = '\n\n'.join((root / 'src' / f).read_text() for f in order)
html = (root / 'src' / 'template.html').read_text().replace('/*__APP_JS__*/', js)
out = root / 'dist' / 'index.html'
out.parent.mkdir(exist_ok=True)
out.write_text(html)
print(f'built {out} ({len(html):,} chars)')
