"""Desktop preview (development only): what the status bar draws on Claude Desktop, as HTML.

Claude cannot capture the Claude Desktop window, and Desktop's renderer is not available outside
the app, so this approximates it: it copies the plugin into a scratch mod folder with
preview.test.ts as its only test, runs it with `claude plugin test` (the engine mounts the status
bar on the `desktop` surface in several states and prints each drawn element tree), and renders
those trees as HTML the way a remote surface lays them out: Box as a flex box (numbers are
character cells, 8 px), Text as text, Button as a button, Svg as an image.

    python tools/desktop-preview/preview.py [--out DIR] [--state NAME]

It writes DIR/preview.html (default: tools/desktop-preview/out, git-ignored). Open it in a
browser, or capture it with headless Chrome:

    chrome --headless=new --hide-scrollbars --window-size=1060,2300 --screenshot=shot.png <file>

Layout, overflow, alignment and the graphics are faithful; fonts, exact spacing and the native
button's look are Desktop's own. Check the real app before calling a Desktop change done.
"""
import argparse
import html
import json
import os
import shutil
import subprocess
import sys
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
PLUGIN = os.path.normpath(os.path.join(HERE, '..', '..', 'plugins', 'control-room'))
CW = 8  # px per column cell
RH = 8  # px per row cell, for gaps between rows

DARK = {
    'text': '#E8E6E3', 'dim': '#9B9A97', 'claude': '#D97757', 'success': '#5CB979', 'error': '#F0707B', 'warning': '#E8B04B',
    'suggestion': '#8EA2F7', 'subtle': '#4A4A47', 'inactive': '#9B9A97', 'ide': '#5A9BF6', 'planMode': '#48A89A', 'autoAccept': '#AF87FF',
    'permission': '#8EA2F7', 'promptBorder': '#4A4A47', 'remember': '#8EA2F7', 'merged': '#AF87FF',
}


def trees_of(out_dir):
    mod = os.path.join(out_dir, 'mod')
    if os.path.isdir(mod):
        shutil.rmtree(mod)
    shutil.copytree(PLUGIN, mod, ignore=shutil.ignore_patterns('*.test.ts', '*.test.tsx'))
    shutil.copy(os.path.join(HERE, 'preview.test.ts'), os.path.join(mod, 'tests', 'preview.test.ts'))
    run = subprocess.run(['claude', 'plugin', 'test', mod], capture_output=True, text=True, encoding='utf-8', errors='replace', shell=os.name == 'nt')
    trees = []
    for line in (run.stdout + '\n' + run.stderr).splitlines():
        if line.startswith('PREVIEW\t'):
            _, name, surface, columns, tree = line.split('\t', 4)
            trees.append({'name': name, 'surface': surface, 'columns': int(columns), 'tree': json.loads(tree)})
    if not trees:
        sys.exit('No trees were drawn:\n' + run.stdout[-3000:] + run.stderr[-3000:])
    return trees


def px(v, unit):
    return f'{v * unit}px' if isinstance(v, (int, float)) else str(v)


def box_style(p):
    s = ['display:flex', 'box-sizing:border-box', f"flex-direction:{p.get('flexDirection', 'row')}", f"flex-grow:{p.get('flexGrow', 0)}", f"flex-shrink:{p.get('flexShrink', 1)}"]
    for k, css in (('flexWrap', 'flex-wrap'), ('alignItems', 'align-items'), ('alignSelf', 'align-self'), ('justifyContent', 'justify-content')):
        if k in p:
            s.append(f'{css}:{p[k]}')
    if 'gap' in p:
        s.append(f"gap:{px(p['gap'], RH)} {px(p['gap'], CW)}")
    if 'columnGap' in p:
        s.append(f"column-gap:{px(p['columnGap'], CW)}")
    if 'rowGap' in p:
        s.append(f"row-gap:{px(p['rowGap'], RH)}")
    for k, css, unit in (('width', 'width', CW), ('minWidth', 'min-width', CW), ('height', 'height', 20), ('minHeight', 'min-height', 20)):
        if p.get(k) is not None:
            s.append(f'{css}:{px(p[k], unit)}')
    for k in ('margin', 'padding'):
        if k in p:
            s.append(f'{k}:{px(p[k], RH)} {px(p[k], CW)}')
        if f'{k}X' in p:
            s.append(f"{k}-left:{px(p[k + 'X'], CW)};{k}-right:{px(p[k + 'X'], CW)}")
        if f'{k}Y' in p:
            s.append(f"{k}-top:{px(p[k + 'Y'], RH)};{k}-bottom:{px(p[k + 'Y'], RH)}")
        for side, unit in (('Top', RH), ('Bottom', RH), ('Left', CW), ('Right', CW)):
            if f'{k}{side}' in p:
                s.append(f'{k}-{side.lower()}:{px(p[k + side], unit)}')
    if p.get('overflow') == 'hidden':
        s.append('overflow:hidden')
    if p.get('display') == 'none':
        s.append('display:none')
    if 'backgroundColor' in p:
        s.append(f"background:{DARK.get(p['backgroundColor'], p['backgroundColor'])}")
    if 'borderStyle' in p:
        s.append(f"border:1px solid {DARK.get(p.get('borderColor', 'subtle'), '#4A4A47')};border-radius:10px")
    return ';'.join(s)


def text_style(p):
    s = []
    if p.get('color'):
        s.append(f"color:{DARK.get(p['color'], p['color'])}")
    if p.get('dimColor'):
        s.append(f"color:{DARK['dim']}")
    if p.get('bold'):
        s.append('font-weight:600')
    if p.get('italic'):
        s.append('font-style:italic')
    return ';'.join(s)


def render(n, top=True):
    if isinstance(n, str):
        return html.escape(n)
    if not isinstance(n, dict):
        return ''
    t, p, kids = n.get('type'), n.get('props') or {}, n.get('children') or []
    if t == 'Box':
        return f'<div style="{box_style(p)}">' + ''.join(render(c) for c in kids) + '</div>'
    if t == 'Text':
        clip = ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0' if str(p.get('wrap', '')).startswith('truncate') else ';white-space:pre-wrap'
        return f'<span style="{text_style(p)}{clip if top else ""}">' + ''.join(render(c, False) for c in kids) + '</span>'
    if t == 'Button':
        look = 'background:#E8E6E3;color:#1F1E1D;border-color:#E8E6E3' if p.get('variant') == 'primary' else 'background:#3A3936;color:#E8E6E3;border-color:#4A4A47'
        return f'<button style="{look}">{html.escape(str(p.get("label", "")))}</button>'
    if t == 'Svg':
        size = ''.join(f' {k}="{p[k]}"' for k in ('width', 'height') if k in p)
        return f'<img src="data:image/svg+xml;utf8,{urllib.parse.quote(p.get("source", ""))}"{size} alt="{html.escape(str(p.get("alt", "")))}" style="display:block;flex-shrink:0">'
    return ''.join(render(c) for c in kids)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=os.path.join(HERE, 'out'))
    ap.add_argument('--state', default=None, help='only this state (ready, working, done-failing, away, kit)')
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    parts = []
    for t in trees_of(args.out):
        if t['surface'] != 'desktop' or (args.state and t['name'] != args.state):
            continue
        width = t['columns'] * CW
        parts.append(f'<section><h2>{html.escape(t["name"])} · {t["columns"]} columns ({width}px)</h2><div class="band" style="width:{width}px">{render(t["tree"])}</div></section>')
    page = (
        '<!doctype html><html><head><meta charset="utf-8"><title>Status bar on Desktop (preview)</title><style>'
        'body{background:#262624;color:#E8E6E3;font:14px/20px system-ui,-apple-system,"Segoe UI",sans-serif;margin:24px}'
        'h2{font-size:12px;font-weight:500;color:#9B9A97;margin:22px 0 6px}'
        '.band{background:#30302E;border:1px solid #3d3d3a;border-radius:12px;padding:12px 16px;box-sizing:content-box}'
        'button{font:13px system-ui,"Segoe UI",sans-serif;border:1px solid;border-radius:8px;padding:3px 10px;white-space:nowrap}'
        f'</style></head><body>{"".join(parts)}</body></html>'
    )
    path = os.path.join(args.out, 'preview.html')
    open(path, 'w', encoding='utf-8').write(page)
    print(f'{len(parts)} bands -> {path}')


if __name__ == '__main__':
    main()
