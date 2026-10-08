"""Desktop preview (development only): what the status bar and the panel draw on Claude Desktop, as HTML.

Claude cannot drive the Claude Desktop window, so this renders the same element trees outside the
app: it copies the plugin into a scratch mod folder with preview.test.ts as its only test (and the
tests' fixtures from the repository's tests/), runs it
with `claude plugin test` (the engine mounts the status bar and the panel's pages on the `desktop`
surface in several states and prints each drawn element tree), and renders those trees as HTML
with the CSS Desktop's own renderer gives them (read from the app's bundle, 2.26454): a Box is a
flex box whose widths, column gaps and horizontal spacing are `ch`, whose heights are `lh` and whose
row gaps and vertical spacing are half a line each; a Text wraps unless it truncates; a Button is
the app's button; a Select its field button; an Svg an image of its given size.

    python tools/desktop-preview/preview.py [--out DIR] [--state NAME]

It writes DIR/preview.html (default: tools/desktop-preview/out, git-ignored). Open it in a
browser, or capture it with headless Chrome:

    chrome --headless=new --hide-scrollbars --window-size=1060,2300 --screenshot=shot.png <file>

The layout rules are the app's; its font, its design tokens (control height, radii, paddings) and
its colors are close guesses. Check the real app before calling a Desktop change done.
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
REPO = os.path.normpath(os.path.join(HERE, '..', '..'))
# The plugin folder the marketplace names; the tests and their fixtures live in the repository's tests/.
PLUGIN = os.path.normpath(os.path.join(REPO, json.load(open(os.path.join(REPO, '.claude-plugin', 'marketplace.json'), encoding='utf-8'))['plugins'][0]['source']))

# Desktop's row unit: rowGap, marginY and paddingY count half lines (`--engine-row-unit`, .5lh).
ROW = '.5lh'

DARK = {
    'text': '#E8E6E3', 'dim': '#9B9A97', 'claude': '#D97757', 'success': '#5CB979', 'error': '#F0707B', 'warning': '#E8B04B',
    'suggestion': '#8EA2F7', 'subtle': '#4A4A47', 'inactive': '#9B9A97', 'ide': '#5A9BF6', 'planMode': '#48A89A', 'autoAccept': '#AF87FF',
    'permission': '#8EA2F7', 'promptBorder': '#4A4A47', 'remember': '#8EA2F7', 'merged': '#AF87FF',
}


def trees_of(out_dir):
    mod = os.path.join(out_dir, 'mod')
    if os.path.isdir(mod):
        shutil.rmtree(mod)
    shutil.copytree(PLUGIN, mod)
    shutil.copytree(os.path.join(REPO, 'tests', 'fixtures'), os.path.join(mod, 'tests', 'fixtures'))
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


def num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def unit(v, u):
    """A number in a unit, or a percentage string as given (the app accepts both)."""
    if num(v):
        return f'{v}{u}'
    if isinstance(v, str) and v.endswith('%'):
        return v
    return None


def rows(v):
    return f'calc({v} * {ROW})' if num(v) else None


def spacing(p, k):
    out = []
    if num(p.get(k)):
        out.append(f'{k}:{rows(p[k])} {p[k]}ch')
    for side, axis, conv in (('Top', 'Y', rows), ('Bottom', 'Y', rows), ('Left', 'X', lambda v: unit(v, 'ch')), ('Right', 'X', lambda v: unit(v, 'ch'))):
        v = p.get(k + side, p.get(k + axis))
        if num(v):
            out.append(f'{k}-{side.lower()}:{conv(v)}')
    return out


def box_style(p):
    s = ['display:flex', 'box-sizing:border-box', f"flex-direction:{p.get('flexDirection', 'row')}"]
    for k, css in (('flexGrow', 'flex-grow'), ('flexShrink', 'flex-shrink')):
        if num(p.get(k)):
            s.append(f'{css}:{p[k]}')
    for k, css in (('flexWrap', 'flex-wrap'), ('alignItems', 'align-items'), ('alignSelf', 'align-self'), ('justifyContent', 'justify-content')):
        if k in p:
            s.append(f'{css}:{p[k]}')
    if num(p.get('gap')):
        s.append(f"gap:{rows(p['gap'])} {p['gap']}ch")
    if num(p.get('columnGap')):
        s.append(f"column-gap:{p['columnGap']}ch")
    if num(p.get('rowGap')):
        s.append(f"row-gap:{rows(p['rowGap'])}")
    for k, css, u in (('width', 'width', 'ch'), ('height', 'height', 'lh'), ('minWidth', 'min-width', 'ch'), ('minHeight', 'min-height', 'lh')):
        v = unit(p.get(k), u)
        if v is not None:
            s.append(f'{css}:{v}')
    s += spacing(p, 'margin')
    if p.get('borderStyle'):
        # A bordered box: the app's border and radius, its padding (md lg) before paddingX overrides the sides.
        s.insert(3, 'padding:8px 12px')
        s.append(f"border:1px solid {DARK.get(p.get('borderColor', 'subtle'), '#4A4A47')};border-radius:10px")
    s += spacing(p, 'padding')
    if 'backgroundColor' in p:
        s.append(f"background-color:{DARK.get(p['backgroundColor'], p['backgroundColor'])}")
    if p.get('overflow') in ('hidden', 'visible'):
        s.append(f"overflow:{p['overflow']}")
    if p.get('display') == 'none':
        s.append('display:none')
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
    if p.get('wrap') in (None, 'wrap'):
        s.append('white-space:pre-wrap;overflow-wrap:anywhere')
    else:
        s.append('display:inline-block;max-width:100%;white-space:pre;overflow:hidden;text-overflow:ellipsis;min-width:0')
    return ';'.join(s)


def button(p):
    label = html.escape(str(p.get('label', '')))
    if p.get('plain'):
        dim = f";color:{DARK['dim']}" if p.get('dimColor') else ''
        return f'<button class="plain" style="{dim[1:]}">{label}</button>'
    look = 'primary' if p.get('variant') == 'primary' else 'secondary'
    return f'<button class="{look}">{label}</button>'


def select(p):
    options = p.get('options') or []
    value = p.get('value')
    shown = next((o.get('label') or o.get('value') for o in options if o.get('value') == value), options[0].get('label') if options else '')
    caret = '<svg width="14" height="14" viewBox="0 0 16 16"><path d="M4 6l4 4 4-4" fill="none" stroke="#9B9A97" stroke-width="1.5"/></svg>'
    return f'<span class="field"><button class="select"><span>{html.escape(str(shown))}</span>{caret}</button></span>'


def render(n):
    if isinstance(n, str):
        return html.escape(n)
    if not isinstance(n, dict):
        return ''
    t, p, kids = n.get('type'), n.get('props') or {}, n.get('children') or []
    if t == 'Box':
        # The app marks a row box that sets no alignment; its texts, buttons and images centre on the row.
        is_row = str(p.get('flexDirection', 'row')).startswith('row') and 'alignItems' not in p
        return f'<div{" data-row" if is_row else ""} style="{box_style(p)}">' + ''.join(render(c) for c in kids) + '</div>'
    if t == 'Text':
        return f'<span style="{text_style(p)}">' + ''.join(render(c) for c in kids) + '</span>'
    if t == 'Button':
        return button(p)
    if t == 'Select':
        return select(p)
    if t == 'Svg':
        size = ''.join(f';{k}:{p[k]}px' for k in ('width', 'height') if num(p.get(k)))
        return f'<img src="data:image/svg+xml;charset=utf-8,{urllib.parse.quote(p.get("source", ""))}" alt="{html.escape(str(p.get("alt", "")))}" style="display:block;max-width:100%;border:0{size}">'
    return ''.join(render(c) for c in kids)


CSS = (
    'body{background:#262624;color:#E8E6E3;font:15px/24px system-ui,-apple-system,"Segoe UI",sans-serif;margin:24px}'
    'h2{font-size:12px;line-height:16px;font-weight:500;color:#9B9A97;margin:22px 0 6px}'
    '.band{background:#30302E;border:1px solid #3d3d3a;border-radius:12px;padding:12px 16px;box-sizing:content-box}'
    '.pane{background:#1F1E1D;border:1px solid #3d3d3a;border-radius:12px;padding:12px 16px;box-sizing:content-box}'
    'button{font:inherit;appearance:none;display:inline-flex;flex-shrink:0;align-items:center;justify-content:center;gap:.375rem;box-sizing:border-box;'
    'width:fit-content;max-width:100%;min-width:0;margin:0;border:0;padding:0;background:none;color:#E8E6E3;white-space:nowrap}'
    'button.secondary{height:30px;padding:0 10px;border-radius:6px;background:#3A3936;box-shadow:inset 0 0 0 1px #4A4A47}'
    'button.primary{height:30px;padding:0 10px;border-radius:6px;background:#F0EEE6;color:#1F1E1D;font-weight:500}'
    'button.plain{min-height:1lh;padding:0 4px;border-radius:4px}'
    '.field{display:inline-flex;align-items:center;min-width:0;max-width:100%;position:relative}'
    '[data-row]>span,[data-row]>b,[data-row]>a,[data-row]>button,[data-row]>form,[data-row]>img,[data-row]>.field{align-self:center}'
    'button.select{justify-content:space-between;height:30px;padding:0 6px 0 10px;border-radius:6px;background:#2B2A28;box-shadow:inset 0 0 0 1px #4A4A47}'
)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=os.path.join(HERE, 'out'))
    ap.add_argument('--state', default=None, help='only the states that start with this (ready, working-no-plan, working, done-failing, away, kit (and Kit through a turn: kit-idle, kit-thinking, kit-finished, kit-touched), or a pane page: pane-overview, pane-guardrails, pane-activity)')
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    parts = []
    for t in trees_of(args.out):
        if t['surface'] != 'desktop' or (args.state and not t['name'].startswith(args.state)):
            continue
        kind = 'pane' if t['name'].startswith('pane-') else 'band'
        parts.append(f'<section><h2>{html.escape(t["name"])} · {t["columns"]} columns</h2><div class="{kind}" style="width:{t["columns"]}ch">{render(t["tree"])}</div></section>')
    page = f'<!doctype html><html><head><meta charset="utf-8"><title>Control Room on Desktop (preview)</title><style>{CSS}</style></head><body>{"".join(parts)}</body></html>'
    path = os.path.join(args.out, 'preview.html')
    open(path, 'w', encoding='utf-8').write(page)
    print(f'{len(parts)} drawings -> {path}')


if __name__ == '__main__':
    main()
