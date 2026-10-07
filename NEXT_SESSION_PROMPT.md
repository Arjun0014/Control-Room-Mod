# Next session — Control Room

You are continuing work on **Control Room**, a Claude Code function-hooks plugin ("mod") for the
terminal CLI and Claude Desktop's Code tab. Repo: `C:\Web UI\Control Room Mod`, pushed to
github.com/Arjun0014/Control-Room-Mod (`main`). Read `README.md`, `docs/DESIGN.md` and
`docs/ARCHITECTURE.md` first, then `CONTRIBUTING.md` for the code rules (only
`hooks/register.tsx` touches `$`; pages are built only from `hooks/ui/primitives.tsx`).

## State at handoff

- **1.0.0 is released** (2026-10-07). The version is raised in `plugin.json`, the marketplace
  entry and `VERSION` in `hooks/constants.ts`. The notes sit under `[1.0.0]` in `CHANGELOG.md`, and
  `Unreleased` is empty. The tag `control-room--v1.0.0` is pushed.
- The manifest and the marketplace entry carry `homepage` and `repository`. The README has the
  one-line install from inside a session and an Update section.
- `npm run check` passes: `tsc`, `validate --strict` for the plugin and the marketplace, and
  **127 tests**. The suite also passes on the **2.1.289** engine. To repeat that, copy
  `plugins/control-room` to a scratch folder, run
  `%APPDATA%\Claude\claude-code\2.1.289\<hash>\claude.exe plugin test <copy>`, start one 2.1.289
  session on the copy (it writes the 2.1.289 types), then run `tsc -p <copy>`.
- The user installed the plugin from this folder (`control-room@control-room`, user scope). Their
  sessions read it straight from here and pick up changes with `/reload-plugins`.

## How to release

1. Raise the version in `plugins/control-room/.claude-plugin/plugin.json`,
   `.claude-plugin/marketplace.json` and `VERSION` in `hooks/constants.ts`. They must match.
2. Move the `Unreleased` notes under the new version in `CHANGELOG.md`.
3. Run `npm run check`, then commit and push.
4. Run `claude plugin tag plugins/control-room --push`. It checks that the versions agree and
   pushes `control-room--v<version>`.

People who installed from GitHub get a release only when the version changes, with
`claude plugin update control-room@control-room` or auto-update (off by default for a marketplace
they add themselves).

## Verified live in the 1.0.0 pass (terminal, 2.1.292, Windows conhost)

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
- The user looked at the panel and approved it before 1.0.0.

## Needs the user (ask; don't guess)

1. **Anthropic's directory (optional).** Anyone can already install from the GitHub marketplace.
   Listing on Anthropic's directory as well puts it in claude.ai's plugin catalog, in
   `/plugin directory`, and in the `claude-community` marketplace. Only the user can submit:
   - they need a paid claude.ai plan and submit at claude.ai/directory/manage
     (*Submit new › Plugin bundle*, repository `Arjun0014/Control-Room-Mod`, plugin folder
     `plugins/control-room`), then select **Validate** before submitting;
   - `claude-plugins-official` takes no submissions, except through an Anthropic partner contact;
   - the directory lists a mod for Claude Code only;
   - what the checklist looks at: a README of 40 or more words in the plugin folder (it has
     about 100), a license (`license` is set), files under 256 KiB, no `.DS_Store` or `Thumbs.db`;
   - the security scan looks for behavior the README doesn't disclose. SECURITY.md and the README
     already say what Control Room runs (process sampling, the guard's optional model check,
     permission decisions). A reviewer may still hold it.
2. **Desktop polish.** If the user reports anything on Desktop, ask for screenshots at a narrow
   and a wide width after `/reload-plugins`. Claude cannot see the Desktop window.

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

- Listing on Anthropic's directory, if the user wants it (above).
- Desktop polish, if the user reports anything (above).
- macOS and Linux sampling is still unverified live (only Windows here).
- Possibly persist the Autopilot state across reloads, if the reload edge case ever matters.
