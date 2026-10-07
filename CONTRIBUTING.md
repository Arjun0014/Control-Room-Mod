# Contributing

Thanks for helping. Control Room is a privileged plugin, so changes are held to a few firm rules.
This page lists them and how to check your work.

## Setup

1. Install Claude Code 2.1.289 or newer, and Node.js (only for TypeScript).
2. Install the dev dependency:

   ```bash
   npm install
   ```

3. Load the plugin once so Claude Code writes the engine's type declarations next to it
   (`plugins/control-room/.claude-plugin/types/` and `plugins/control-room/tsconfig.json`, both
   git-ignored and rewritten for each Claude Code build):

   ```bash
   claude --plugin-dir plugins/control-room
   ```

   Then `/exit`. While that session is open, every save reloads the plugin live.

4. Run every check:

   ```bash
   npm run check
   ```

   That is `tsc -p plugins/control-room`, `claude plugin validate plugins/control-room --strict`,
   `claude plugin validate .` (the marketplace) and `claude plugin test plugins/control-room`.

## Rules the code follows

- **Only `hooks/register.tsx` touches `$`.** It builds the `Host` adapter (`hostOf($)`) and
  registers every hook, and nothing else. Every other module works against `hooks/host.ts`, which
  keeps the core testable with a fake host and makes every engine call reviewable in one place.
  `claude plugin validate` lists those calls. A new engine call needs a reason in the PR
  description and an entry in [SECURITY.md](SECURITY.md).
- **Decisions are pure; effects go through the Runtime.** Feature modules (`hooks/features/`)
  are pure functions or small classes without I/O. `hooks/app/runtime.ts` wires them together and
  performs effects.
- **No network, no telemetry, no secrets.** Don't add HTTP calls, telemetry hooks, environment
  reads or project-file reads. File access is limited to `stat` of the handoff file and of edited
  paths, plus `/proc` on Linux.
- **Never loosen safety.** A deny stays a deny, plan mode stays plan mode, and managed settings
  win. Fallbacks (`.catch`) must be at least as strict as Claude Code without the plugin.
- **No invented numbers.** Show cost, context and effort only as Claude Code reports them;
  otherwise show "—".
- **Presentation never changes behaviour.** Focus View and the HUD only draw.
- **Hooks stay fast.** A hook has a 10-second own-time budget, so long work runs from timers.
  Don't block `session.end`.
- **Same tree everywhere.** UI code builds one element tree from `$.ui.resolve(e)` for the
  terminal, Desktop, VS Code and mobile. Decide capabilities by surface (`uiOf`), not by whether an
  element exists in the table.

## Tests

Tests live in `plugins/control-room/tests/` and run with `claude plugin test`:

- **Pure logic:** settings, profiles, permissions classifier, guard heuristics, Autopilot reducer,
  router, chain, activity, resource parsers.
- **Runtime:** `runtime.test.ts`, with the in-memory host in `tests/fixtures/fake-host.ts` (a manual
  clock and recorded effects).
- **Engine-driven:** `register.test.ts` and `ui.test.ts`, using the real engine with the world
  answered beneath the plugin by `tests/fixtures/world.ts`, and UI mounted on the `terminal`,
  `desktop` and `mobile` surfaces.

Add a test with every behaviour change. For UI, loop the test over the surfaces rather than
assuming one.

## Checking it live

Unit tests don't paint. Before a release:

- Run the plugin in a real terminal at a few widths (80, 120, 150+ columns) and look at the HUD
  and every Control Centre tab.
- Run one Autopilot chain end to end, ideally in the Desktop host protocol (stream-json). A low
  threshold with a cheap model is enough: `/cr autopilot 45k`, then a small multi-step task.
- On macOS and Linux, turn the Resource Governor on and confirm `/cr status` shows live CPU and RAM.

## Releases

1. Update `version` in `plugins/control-room/.claude-plugin/plugin.json` **and** in
   `.claude-plugin/marketplace.json`.
2. Move the `Unreleased` notes in `CHANGELOG.md` under the new version.
3. Run `npm run check`.
4. Run `claude plugin tag plugins/control-room` to create the `control-room--v<version>` tag after
   checking that the manifest and the marketplace entry agree.
