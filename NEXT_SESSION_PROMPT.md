# Next session — Control Room

You are continuing work on **Control Room**, a Claude Code function-hooks plugin ("mod") for the
terminal CLI and Claude Desktop's Code tab. Repo: `C:\Web UI\Control Room Mod`, pushed to
github.com/Arjun0014/Control-Room-Mod (`main`). Read `README.md`, `docs/DESIGN.md` and
`docs/ARCHITECTURE.md` first, then `CONTRIBUTING.md` for the code rules (only
`hooks/register.tsx` touches `$`; pages are built only from `hooks/ui/primitives.tsx`).

## State at handoff

- Version 0.2.0. Last commits:
  - `b184c4c` 0.1.0
  - `4ffa1e6` redesign and stuck-dropdown fix
  - `23905e3` live status bar, cards and settings-list rows
- This handoff's DESIGN.md update and these notes are committed after `23905e3`.
- `npm run check` passes: `tsc`, `validate --strict` for the plugin and the marketplace, and 118
  tests. The 2.1.289 type-check also passes. Its tsconfig lives in the old session's scratchpad.
- The user installed the plugin from this folder (`control-room@control-room`, user scope). Their
  sessions read it straight from here. They run `/reload-plugins` to pick up changes.

## Not verified yet (do this first)

The last UI pass (`23905e3`) passes tests but has **not been looked at** in a real terminal or in
Desktop. Earlier passes were checked live; this one was written right before the handoff.

1. **Terminal.** Drive a real console and read its screen. See "How to see the terminal UI".
   Check at 150 and 100 columns, with the panel docked and inline:
   - the status bar shows live CPU and RAM, with sparklines from 110 columns;
   - Overview's color-coded cards;
   - Context's numbered steps;
   - Behavior's per-system cards;
   - the Guardrails gauges;
   - Setup's profile rows, which show "✓ In use" or "Use".
   Watch for:
   - rounded card borders eating width;
   - stacked segmented controls;
   - right-aligned controls;
   - picker options opening under rows inside a card.
2. **Desktop.** Claude cannot view or control the Claude Desktop window, so ask the user for
   screenshots at a narrow and a wide panel width. Their feedback on 0.2.0 (fixed in `23905e3`,
   unconfirmed):
   - the tab buttons wrapped unevenly and touched each other; they are now an even grid;
   - toggle rows misaligned, with details wrapping under the buttons; rows are now label and
     description left, control right;
   - Context was hard to read; it now opens with three numbered steps and cards;
   - Behavior was cramped; each system now has its own card;
   - they wanted live CPU/RAM in the status bar and no settings there; done.

   The user also allowed per-section accent colors "done properly, not rainbow". They are now one
   theme key per section, used only on card titles and the tab underline. Ask how it looks.

## User preferences (durable)

- **The bar:** Apple-level polish, calm and uncluttered, easy to tell apart, for both CLI and
  Desktop. They review screenshots closely.
- **Git:** commit and push without asking, as Arjun0014, with **no Git popup**. The remote URL
  includes the username (`https://Arjun0014@github.com/...`), so Git Credential Manager picks the
  stored account silently. Push with `GCM_INTERACTIVE=never GIT_TERMINAL_PROMPT=0 git push origin main`.
- **Commit attribution:** end commit messages with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Browsing:** use the gstack `/browse` skill for web browsing. Never use the claude-in-chrome tools.

## How to see the terminal UI (method; the scripts lived in the old scratchpad)

The Terminal panel tool cannot start a shell, because the user's PowerShell profile fails to load
the Claude terminal integration. Instead:

1. **Launch.** Start `conhost.exe cmd.exe /c "mode con: cols=150 lines=48 & claude --plugin-dir
   "C:\Web UI\Control Room Mod\plugins\control-room""`. Use the trusted, empty folder
   `C:\Web UI\test`; this repo's folder shows the trust dialog, which you must not accept.
2. **Read the screen.** From a helper PowerShell script, call `FreeConsole` and
   `AttachConsole(<cmd pid>)`, then `ReadConsoleOutputCharacterW` and `ReadConsoleOutputAttribute`.
   Attribute `0x4000` is the focus ring.
3. **Type and press keys.** Use `WriteConsoleInputW` key events: `/cr` then Enter, digits, Tab, Esc.
4. **Click with the mouse.** Type the SGR sequence `ESC[<0;col;rowM` then `ESC[<0;col;rowm`
   (1-based). This is how the stuck terminal-dropdown bug was found.
5. **Hot reload.** A `--plugin-dir` session reloads on save. If a reload fails mid-edit, `touch` a
   file to reload again. The transcript shows "control-room: reloaded" or "reload failed".
6. **Gotchas:** never name a script `con.ps1` (`CON` is a reserved device name). Exit with `/exit`.

## Engine facts learned (keep)

- **Terminal `Select`:** a click opens it, but its options cannot be clicked and it cannot be
  closed with the pointer (keyboard works). So the terminal uses in-place pickers instead.
- **`turn.step` model:** it rejects bare aliases (`haiku` fails the turn). The router only routes
  the main conversation to model ids seen answering in this session; subagents take aliases.
- **Desktop rendering:**
  - Box `borderStyle`, `rowGap` and percentage widths are drawn;
  - plain Buttons still render as native pills;
  - `Select` is a native dropdown;
  - `Svg` renders well (meters).
- **Plugin store:** `~/.claude/plugins/store/`. The installed copy uses
  `control-room_control-room-*.json`, which is the user's own; don't touch it. `--plugin-dir`
  test runs use `control-room_inline-*.json`; move it aside after live tests.
- **Install tests:** test marketplace installs in a throwaway `CLAUDE_CONFIG_DIR` so the user's
  config is never touched.

## Open items / ideas (not started)

- Confirm `23905e3` visually in the terminal and on Desktop, then polish from what you see.
- `docs/CONFIGURATION.md` does not yet document `ui.liveLoad`, or `resources.intervalSec`'s new
  default of 3 s. README and SECURITY are updated.
- Possibly add a test that `/cr hud status` text contains CPU/RAM when the sampler is live.
  The test world has an unknown platform, so no sampler runs there.
- macOS and Linux sampling is still unverified live. Desktop visuals depend on user screenshots.
