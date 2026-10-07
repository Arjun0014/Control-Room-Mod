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
- **Presentation never changes behaviour.** Focus view and the status bar only draw.
- **Hooks stay fast.** A hook has a 10-second own-time budget, so long work runs from timers.
  Don't block `session.end`.
- **Same tree everywhere, through the design system.** Pages are built only from the components in
  `hooks/ui/primitives.tsx`, which draw natively per surface. Decide capabilities by surface
  (`uiOf`), not by whether an element exists in the table. Never use the terminal's `Select`: its
  options cannot be picked or closed with the pointer. Read [docs/DESIGN.md](docs/DESIGN.md) first.

## Tests

Tests live in `plugins/control-room/tests/` and run with `claude plugin test`:

- **Pure logic:** settings, profiles, permissions classifier, guard heuristics, Autopilot reducer
  (and its recovery after a reload), router, chain, run plan, validation and Activity's signal
  (`signal.test.ts`), activity, resource parsers, answer styles (`answers.test.ts`) and the Quest
  log (`quest.test.ts`).
- **Runtime:** `runtime.test.ts`, with the in-memory host in `tests/fixtures/fake-host.ts` (a manual
  clock and recorded effects).
- **Engine-driven:** `register.test.ts` and `ui.test.ts`, using the real engine with the world
  answered beneath the plugin by `tests/fixtures/world.ts`, and UI mounted on the `terminal`,
  `desktop` and `mobile` surfaces.

Add a test with every behaviour change. For UI, loop the test over the surfaces rather than
assuming one.

### Continuous integration

`.github/workflows/check.yml` runs on every push to `main` and every pull request: the type-check,
strict validation of the plugin and the marketplace, and the tests, on Linux, Windows and macOS
with the latest Claude Code from npm, and on Linux with the oldest supported engine (2.1.289). The
engine's type declarations are laid by loading the plugin once in a headless session, which stops
at "Not logged in" before any model call; no step signs in. CI does not run the live machine-load
sampler, a real Autopilot handoff, or Desktop's rendering. Those are checked by hand (below).

## Checking it live

Unit tests don't paint. Before a release:

- Run the plugin in a real terminal at a few widths (80, 120, 150+ columns). Look at the status bar
  and every panel section, and use them with the mouse and the keyboard. On Windows,
  [`tools/console`](tools/console/README.md) runs a session in a console of a given size and reads
  the screen back as text. [`tools/demo`](tools/demo/README.md) plays a scripted turn of real tool
  calls without a model, so the status bar's top line, This turn and the Quest log have something
  to show.
- Run one Autopilot chain end to end, both in the interactive terminal and in the Desktop host
  protocol (stream-json): they order the `/clear` differently. A low threshold with a cheap model
  is enough: `/cr autopilot 45k`, then a small multi-step task.
- On macOS and Linux, turn machine load on and confirm `/cr status` shows live CPU and memory.

## Releases

1. Update `version` in `plugins/control-room/.claude-plugin/plugin.json`, in
   `.claude-plugin/marketplace.json` **and** `VERSION` in `plugins/control-room/hooks/constants.ts`.
   The workspace `package.json` is private and carries no version of its own.
2. Move the `Unreleased` notes in `CHANGELOG.md` under the new version.
3. Run `npm run check`.
4. Run `claude plugin tag plugins/control-room` to create the `control-room--v<version>` tag after
   checking that the manifest and the marketplace entry agree.
