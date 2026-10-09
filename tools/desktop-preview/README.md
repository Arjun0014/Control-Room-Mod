# Desktop preview (development only)

Not part of the plugin and never installed. It shows what the status bar and the panel draw on
Claude Desktop, without the app: a quick look before installing a build and opening it there.

`preview.py` copies the plugin into a scratch folder with `preview.test.ts` as its only test and
runs it with `claude plugin test`. The test mounts the status bar on the engine's `desktop`
surface in several states (ready, working before any milestone, working on a ten-milestone plan,
a failing check after the turn, away with the cache warm, with Kit) at 120, 96 and 64 columns,
then the panel's six pages as a 90-column docked pane, and prints each drawn element tree.
`preview.py` renders those trees as HTML with the CSS Desktop's own renderer gives them (read from
the app's bundle, Claude Desktop 2.26454):

- a `Box` is a flex box: `width`, `minWidth`, `columnGap` and horizontal margin and padding in
  `ch`, `height` in `lh`, `rowGap` and vertical margin and padding in half lines; a bordered box
  takes the app's padding before its `paddingX`;
- a row box that sets no `alignItems` centers its texts, buttons, images and pickers on the row;
- a `Text` wraps unless it truncates;
- a `Button` is the app's button (its children of strings and `Text`, a chip's mark and words, drawn
  in the label's place), a `Select` its picker (as wide as its value), an `Input` a field
  as wide as its place showing its text or its placeholder (its submit word shows only while it has
  focus, so it is not drawn; the field's look is a guess), an `Svg` an image of its given size;
- a surface module's tree (Kit's region) is drawn only if it passes the page's own check, where an
  `Svg` needs a `width` and a `height`; otherwise the preview shows the app's fault line instead, as
  the app does.

```bash
python tools/desktop-preview/preview.py
python tools/desktop-preview/preview.py --state pane-guardrails
```

It writes `tools/desktop-preview/out/preview.html` (git-ignored). To capture it:

```bash
chrome --headless=new --hide-scrollbars --window-size=1060,2300 --screenshot=shot.png tools/desktop-preview/out/preview.html
```

Add `--force-device-scale-factor=1.25` to see it at a fractional display scale, where a
drawing's smoothed edges can show seams (it found Kit's).

Faithful: the layout (what shares a row, what grows, what is cut short, how items align), overflow
at narrow widths, and the graphics themselves. Close guesses: Desktop's font, its design tokens
(control height, radii, paddings) and its colors. It found the 1.2.0 white bar's cause (an
interactive SVG with no width), checked the 1.3.0 grid at 512 to 960 pixels, and matched the app's
own rendering of 1.3.0 (seen in the app); the real app still has the last word.
