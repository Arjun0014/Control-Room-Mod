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

- **launch** opens a console of that size, starts `claude --plugin-dir plugins/control-room` in
  `-Dir`, and remembers the console. Use a folder Claude Code already trusts (an empty one is
  best), because a trust dialog would wait for you. The size is set before Claude Code starts:
  once it holds the alternate screen, the console cannot be resized.
- **read** prints the visible screen, one numbered row per line. `-Attrs` adds a grid of each
  cell's attributes, where `#` marks reverse video, which is the focus ring.
- **send** takes tokens separated by `|`: `text:<chars>`, `enter`, `tab`, `stab` (Shift+Tab),
  `esc`, `space`, `bs`, `up`, `down`, `left`, `right`, `click:<col>,<row>` (1-based, an SGR mouse
  press and release), `wheel:up|down,<col>,<row>` and `wait:<ms>`.
- **kill** stops the console and the session in it. `/exit` first is kinder.

A `--plugin-dir` session reloads the plugin on every save, and the transcript says
"control-room: reloaded" or "reload failed". A reload starts a fresh runtime, so the panel returns
to Overview and in-memory state (an Autopilot handoff in progress, this turn's activity) is gone.
These sessions share one plugin store, `~/.claude/plugins/store/control-room_inline-*.json`;
move it aside afterwards if you want a clean slate.
