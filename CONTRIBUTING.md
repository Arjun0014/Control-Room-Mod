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
- **Surface modules stand alone.** A `Client` surface module (Kit's `hooks/ui/companion.client.tsx`)
  runs on Claude Code's drawing thread: it never touches `$`, imports nothing from the plugin, takes
  everything it draws from its props, and posts only plain data. `register.tsx` names it with a
  string literal (`module="./ui/companion.client.tsx"`), as the validator requires.
- **Never name a local `h` in a `.tsx` module.** JSX compiles to `h(...)`, the environment's
  factory; a local of that name shadows it and the render hook fails ("h is not a function").
- **Every SVG goes through `svgDoc` (`ui/theme.ts`)** or carries its root style: Desktop draws an
  interactive SVG in a sandboxed frame, and without `color-scheme: light dark` the frame is
  painted with an opaque (white) canvas on a dark page.
- **One clock per subsystem.** Cache figures are timed by `Runtime.clock()` (the fake host's clock
  in tests), Activity by `Date.now()`, Autopilot by `host.now()`. Mixing them makes tests disagree
  with the views.

## Tests

Tests live in `plugins/control-room/tests/` and run with `claude plugin test`:

- **Pure logic:** settings, profiles, permissions classifier, guard heuristics, Autopilot reducer
  (and its recovery after a reload), router, chain, run plan, validation and Activity's signal
  (`signal.test.ts`), activity, resource parsers, answer styles (`answers.test.ts`), the Quest
  log (`quest.test.ts`), the prompt cache model (`cache.test.ts`), Kit's moods and frames
  (`companion.test.ts`) and Git's status parser (`git.test.ts`).
- **Runtime:** `runtime.test.ts`, with the in-memory host in `tests/fixtures/fake-host.ts` (a manual
  clock and recorded effects); Cache Guardian and Keep warm (`guardian.test.ts`); Handoff Health
  and Continuity, through a whole handoff (`handoff.test.ts`).
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
  calls without a model, so the status bar's top line, This turn, the prompt cache and the Quest
  log have something to show (`/demo miss` adds a model switch that rebuilds the cache). Load it
  with `console.ps1 launch … -Also tools\demo`, so its hooks sit beneath Control Room's.
- Run one Autopilot chain end to end, both in the interactive terminal and in the Desktop host
  protocol (stream-json): they order the `/clear` differently. With a cheap model, set the
  threshold a little above the session's base context (`/cr autopilot 64k` against a 45k base),
  then a small multi-step task, and start Claude Code with `--debug-file <path>`: every Autopilot
  step and turn is traced there (`autopilot: … → …`, `turn … started (handoff)`).
- Keep live tests away from your own settings. Every session that loads the plugin from a folder
  shares one plugin store, your own working session included, so a threshold set in a test would
  reach it. Load a copy renamed `cr-test` instead (its store is its own), and disable the
  installed copy in the test project's `.claude/settings.local.json`
  (`"enabledPlugins": { "control-room@control-room": false }`). Claude Code's `/effort` and
  `/model` save your default for new sessions: put it back after a test.
- Desktop first through [`tools/desktop-preview`](tools/desktop-preview/README.md): it renders
  the status bar's and the panel's `desktop` element trees as HTML with the CSS the app's own
  renderer gives them (units, row alignment, the picker), so layout and graphics are faithful; the
  font, the design tokens and the colors are close guesses. Then the app itself, which has the last
  word: install the build (bump the pre-release number, `claude plugin update`), start a fresh
  session so it loads it, and look. Never drive Claude's own window with simulated input; a
  read-only capture of it is fine when the person agrees.
- On macOS and Linux, turn machine load on and confirm `/cr status` shows live CPU and memory.

## Releases

1. Update `version` in `plugins/control-room/.claude-plugin/plugin.json`, in
   `.claude-plugin/marketplace.json` **and** `VERSION` in `plugins/control-room/hooks/constants.ts`.
   The workspace `package.json` is private and carries no version of its own.
2. Move the `Unreleased` notes in `CHANGELOG.md` under the new version.
3. Run `npm run check`.
4. Run `claude plugin tag plugins/control-room` to create the `control-room--v<version>` tag after
   checking that the manifest and the marketplace entry agree.
