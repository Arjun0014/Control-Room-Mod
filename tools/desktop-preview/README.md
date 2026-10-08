# Desktop preview (development only)

Not part of the plugin and never installed. It shows what the status bar draws on Claude
Desktop, without the app: Claude cannot capture the Claude Desktop window, and Desktop's renderer
is not available outside it.

`preview.py` copies the plugin into a scratch folder with `preview.test.ts` as its only test and
runs it with `claude plugin test`. The test mounts the status bar on the engine's `desktop`
surface in several states (ready, working on a ten-milestone plan, a failing check after the
turn, away with the cache warm, with Kit) at 120, 96 and 64 columns, and prints each drawn element
tree. `preview.py` renders those trees as HTML the way a remote surface lays them out: a `Box` is
a flex box (its numbers are character cells, drawn 8 pixels wide), a `Text` is text, a `Button` a
button, an `Svg` an image of its given size.

```bash
python tools/desktop-preview/preview.py
```

It writes `tools/desktop-preview/out/preview.html` (git-ignored). To capture it:

```bash
chrome --headless=new --hide-scrollbars --window-size=1060,2300 --screenshot=shot.png tools/desktop-preview/out/preview.html
```

What it shows faithfully: the layout (what shares a row, what grows, what is cut short), overflow
at narrow widths, alignment, and the graphics themselves. What it does not: Desktop's fonts, its
exact spacing per cell and the native button's look. It found the 1.2.0 white bar's cause (an
interactive SVG with no width) and checked the 1.3.0 grid at 512 to 960 pixels; the real app still
has the last word.
