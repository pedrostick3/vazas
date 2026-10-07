#!/usr/bin/env python3
"""Junta src/template.html + src/engine.js + src/ui.js num único index.html (o que o GitHub Pages serve)."""
from pathlib import Path
root = Path(__file__).resolve().parent.parent
src = root / 'src'
html = (src / 'template.html').read_text(encoding='utf-8')
html = html.replace('/*ENGINE*/', (src / 'engine.js').read_text(encoding='utf-8'))
html = html.replace('/*UI*/', (src / 'ui.js').read_text(encoding='utf-8'))
(root / 'index.html').write_text(html, encoding='utf-8')
print('index.html gerado,', len(html) // 1024, 'KB')
