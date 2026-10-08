# Console driver (Windows)

Development only; not part of the plugin. It runs Claude Code with this repository's plugin in a
real Windows console (conhost), reads the screen back as text and sends keys and mouse clicks.
That is how the terminal UI is checked at a given width without looking at the window, as
[CONTRIBUTING.md](../../CONTRIBUTING.md#checking-it-live) asks before a release.

```powershell
.\tools\console\console.ps1 launch -Dir C:\path\to\a\trusted\folder -Cols 150 -Lines 48
.\tools\console\console.ps1 send -Spec 'text:/cr|enter'
.\tools\console\console.ps1 read
.\tools\console\console.ps1 kill
```

- **launch** opens a console of that size, starts `claude --plugin-dir plugins/project-sentinel` in
  `-Dir`, and remembers the console. Use a folder Claude Code already trusts (an empty one is
  best), because a trust dialog would wait for you. The size is set before Claude Code starts:
  once it holds the alternate screen, the console cannot be resized. `-Claude '<command>'`
  replaces `claude` (to add a model or allowed tools, say). `-Also <folder>` loads more plugin
  folders after Project Sentinel, so their hooks sit beneath its own (the demo driver:
  `-Also tools\demo`). `-Font 'Cascadia Mono'`
  (`-FontSize`, default 16) sets the console's font first: the default one lacks some of the glyphs
  Claude Code draws. Keep the window within the screen, or its bottom rows are not drawn.
- **read** prints the visible screen, one numbered row per line, and writes it to
  `%TEMP%\project-sentinel-screen.txt` (read that when the caller loses the printed copy). `-Attrs`
  adds a grid of each cell's attributes, where `#` marks reverse video, which is the focus ring.
- **send** takes tokens separated by `|`: `text:<chars>`, `enter`, `tab`, `stab` (Shift+Tab),
  `esc`, `space`, `bs`, `up`, `down`, `left`, `right`, `click:<col>,<row>` (1-based, an SGR mouse
  press and release), `wheel:up|down,<col>,<row>` and `wait:<ms>`.
- **capture** `-Out shot.png [-Cells 'col,row,width,height']` saves the console window, or that
  block of cells (1-based), as a PNG, as drawn even when other windows cover it.
- **kill** stops the console and the session in it. `/exit` first is kinder.

A `--plugin-dir` session reloads the plugin on every save, and the transcript says
"project-sentinel: reloaded" or "reload failed". A reload starts a fresh runtime, so the panel returns
to Overview and in-memory state (an Autopilot handoff in progress, this turn's activity) is gone.

Every session that loads Project Sentinel from a folder (`--plugin-dir`, from any path) shares one
plugin store, `~/.claude/plugins/store/project-sentinel_inline-<hash>.json`, and that includes a
session you work in yourself. Changing a setting in the test session saves it for all of them.
Don't move the store aside while another session uses it: that session's saved settings go with
it. To tidy up, remove only the test session's run record (`run.v1.<id>` with the test folder as
its `root`).

`launch` clears the `CLAUDE*`, `ANTHROPIC*` and `NO_COLOR` variables for the console it starts:
inherited from a Claude Code session, they would point the child at that session's API proxy
("Not logged in") and turn its colors off.
