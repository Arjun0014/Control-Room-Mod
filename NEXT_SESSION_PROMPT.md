# Next session — Control Room

You are continuing work on **Control Room**, a Claude Code function-hooks plugin ("mod") for the
terminal CLI and Claude Desktop's Code tab. Repo: `C:\Web UI\Control Room Mod`, pushed to
github.com/Arjun0014/Control-Room-Mod (`main`). Read `README.md`, `docs/DESIGN.md` and
`docs/ARCHITECTURE.md` first, then `CONTRIBUTING.md` for the code rules (only
`hooks/register.tsx` touches `$`; pages are built only from `hooks/ui/primitives.tsx`).

## State at handoff

- Version **0.2.0** plus a large `Unreleased` section in `CHANGELOG.md` (not tagged or bumped).
- Commits this session, on top of `06ef243`:
  - `54f4156` polish from a live terminal pass: compact Overview readouts, no repeated card titles,
    80-column centred pages, the gauge bug fix;
  - `2b45cdd` Autopilot in the interactive terminal waits for the fresh session (a real bug);
    calmer "Wait for me" state; the panel's words in toasts, notices and `/cr` replies;
  - `f0ce05f` a segmented choice stays beside its label whenever the text fits;
  - `1d2a6a1` a shorter pending line in the status bar;
  - `46d4ad2` `tools/console`, the Windows console driver;
  - then a meter fix (a reading past the tick always shows) and these notes.
- `npm run check` passes: `tsc`, `validate --strict` for the plugin and the marketplace, and
  **127 tests**. The suite and `tsc` also pass on the **2.1.289** engine. To repeat that, copy
  `plugins/control-room` to a scratch folder, run
  `%APPDATA%\Claude\claude-code\2.1.289\<hash>\claude.exe plugin test <copy>`, start one 2.1.289
  session on the copy (it writes the 2.1.289 types), then run `tsc -p <copy>`.
- The user installed the plugin from this folder (`control-room@control-room`, user scope). Their
  sessions read it straight from here and pick up changes with `/reload-plugins`.

## Verified live this session (terminal, 2.1.292, Windows conhost)

- At 150, 120, 100 and 80 columns, docked (fullscreen, 110 columns and up) and in the frame above
  the prompt:
  - the status bar, with sparklines once there are six readings;
  - every panel section;
  - in-place pickers;
  - saving and deleting a profile;
  - Tab order and the focus ring, Enter and Esc.
- The full Autopilot chain, twice:
  - a mid-turn crossing shows "Handoff soon" in the status bar, a second line with Hand off now
    and Later, and the amber callout;
  - the handoff notes are written, then *Wait for me* waits ("Waiting for you", calm accent);
  - Start fresh runs `/clear`, the fresh context is seeded, and the continuation runs.
  - Before `2b45cdd` the terminal recorded the handoff as "cleared". After it: "handed off",
    "1 handoff", "continuation (session 3)".

## Needs the user (ask; don't guess)

1. **Desktop screenshots.** Claude cannot see the Desktop window. Ask for screenshots of the panel
   at a narrow and a wide width, after `/reload-plugins`. Worth looking at:
   - Overview: the new readout block, the untitled Profile card, the cards;
   - Behavior with the guard on: the stacked Strictness;
   - Context with Autopilot on;
   - Setup's changes list;
   - the section accents.
   Desktop rendering of `field` (a 10-cell label column) and of rows is unverified.
2. **Release?** `Unreleased` holds the 0.2.x redesign follow-ups and the terminal Autopilot fix.
   People who installed from GitHub get the fix only with a version bump. Releasing means:
   - bump `plugin.json`, `.claude-plugin/marketplace.json` and `VERSION` in `hooks/constants.ts`;
   - move the notes under the new version;
   - run `claude plugin tag plugins/control-room`.
   Ask before tagging, and ask which number (0.3.0 fits).

## User preferences (durable)

- **The bar:** Apple-level polish, calm and uncluttered, easy to tell apart, for both CLI and
  Desktop. They review screenshots closely.
- **Git:** commit and push without asking, as Arjun0014, with **no Git popup**. The remote URL
  includes the username, so Git Credential Manager picks the stored account silently. Push with
  `GCM_INTERACTIVE=never GIT_TERMINAL_PROMPT=0 git push origin main`.
- **Commit attribution:** end commit messages with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Browsing:** use the gstack `/browse` skill for web browsing. Never use the claude-in-chrome tools.

## How to see the terminal UI

Use `tools/console/console.ps1` (see its README):

1. `launch -Dir 'C:\Web UI\test' -Cols 150 -Lines 48`. That folder is trusted and empty. This
   repo's folder shows a trust dialog, which you must not accept.
2. `send -Spec 'text:/cr|enter'`, then `read` (`-Attrs` shows the focus ring as `#`).
3. Clicks are 1-based `click:<col>,<row>`. The docked panel starts at column 84 at 150 columns.
   Its tabs are on row 4 at columns 89, 99, 109, 120, 134 and 144.
4. After live tests:
   - `/exit` the sessions;
   - move `~/.claude/plugins/store/control-room_inline-*.json` aside (never touch
     `control-room_control-room-*.json`, which is the user's);
   - empty `C:\Web UI\test` again, since test turns write `NEXT_SESSION_PROMPT.md` there.

A test prompt costs real usage (one short turn on Opus at about 50k context is about $0.25 to
$0.60). Keep them few.

## Engine facts learned (keep)

- **`$.command.run('clear')` resolution order differs by surface.**
  - Interactive terminal: it resolves *before* the reset (`session.end`, then
    `classic.SessionStart{clear}`).
  - Desktop host protocol: it resolves after the reset.
  - `runClear` therefore waits for the fresh session.
- **Drawn trees and keys.** `drawn()` trees keep `key` on Boxes and Buttons but drop it on Texts.
  Tests find titles and labels through their Box (`card-*-head`, `row-*`).
- **Inputs.** A terminal `Input` keeps its props until it remounts, so a changed placeholder shows
  only after the panel reopens.
- **Toasts.** The engine heads every toast with the plugin's name, so texts carry no prefix.
- **The band's `[-]`.** It is the engine's collapse mark, not Control Room's.
- **Console size.** `mode con` inside `cmd /c "mode … & claude"` did not take. The tool opens
  `cmd /k mode …` and types the command. A running session cannot be resized.
- **Terminal `Select`.** A click opens it, but its options cannot be picked or closed with the
  pointer, so the terminal uses in-place pickers.
- **`turn.step` model.** It rejects bare aliases. The main conversation routes only to model ids
  seen answering in this session.
- **Desktop rendering:**
  - Box `borderStyle`, `rowGap` and percentage widths are drawn;
  - plain Buttons render as native pills;
  - `Select` is a native dropdown;
  - `Svg` renders well.
- **Plugin store.** `~/.claude/plugins/store/`. Test marketplace installs in a throwaway
  `CLAUDE_CONFIG_DIR`.

## Known edge cases (not fixed; small)

- **Reload mid-handoff.** A hot reload or `/reload-plugins` in the middle of a handoff starts a
  fresh runtime. The handoff state is lost, and if the context is still past the threshold, a
  second handoff turn starts. The Autopilot state lives in module memory on purpose.
- **Two sessions, one store.** Two live sessions keep separate in-memory settings and the last
  save wins. This is documented as global settings.

## Open items / ideas

- Desktop polish from the user's screenshots (above).
- macOS and Linux sampling is still unverified live (only Windows here).
- Possibly persist the Autopilot state across reloads, if the reload edge case ever matters.
