# Changelog

All notable changes to Control Room are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). The version in
`plugins/control-room/.claude-plugin/plugin.json` and in `.claude-plugin/marketplace.json` must
match. `claude plugin tag plugins/control-room` checks this when tagging a release.

## [Unreleased]

## [1.0.2] - 2026-10-07

A public-release polish pass: the status bar and Activity now show how far the run is and what
needs a look, and a reload mid-handoff can no longer start a second one.

### Added

- **Run progress.** The run's objective (your latest substantial request) and its milestones, done
  of the total Claude listed, counted from Claude's own task list: TodoWrite, or TaskCreate,
  TaskUpdate and TaskList. It is kept with the run, so it survives `/clear`, reloads and restarts,
  and after a handoff the fresh context is told the open milestones, so the work meter keeps
  climbing while the context meter starts over. A subagent's list is its own. Progress needs a list
  to count: without one there is no work meter.
- **A `milestones` tool where Claude Code has none.** Claude Code 2.1.29x offers no task list by
  default (its task tools are behind flags). There, Control Room offers Claude one small tool,
  `mcp__control-room__milestones`, with a short "Run progress" policy, so it can keep one. Where a
  task list exists, nothing is added. Behavior → *Run progress* switches it (`progress.milestones`,
  on by default). It has not yet been watched with a real model.
- **Activity: Attention and Validation.** Attention lists failures nothing has fixed (with the line
  of output that says why and how many tries), refusals, calls the machine-load limit held back,
  long-running and unusually slow calls, then failures a later attempt recovered from, dimmed.
  Validation has one row per kind of check (tests, build, type-check, lint, checks, simulation),
  recognised by its runner; readers such as `grep` or `cat` are not checks.
- **Activity: this turn in counted lines,** such as "Changed 4 files · 2 in code, 1 in tests, 1 in
  docs" and "Ran tests 3×, passing after a fix". No model writes them.
- **Moving around.** Choosing a section starts its page at the top, and every page ends with
  *↑ Sections*, which brings the section bar back. The plugin API has no pinned region inside a
  pane, so this is the supported way back.
- **Continuous integration.** GitHub Actions run the type-check, strict validation of the plugin
  and the marketplace, and the tests on every push and pull request: on Linux, Windows and macOS
  with the latest Claude Code, and on Linux with 2.1.289. No step signs in.
- **Development tools.** `tools/console` saves the console as a PNG (`capture`), sets its font
  (`-Font`), and starts the child session clean of the calling session's `CLAUDE*`, `ANTHROPIC*`
  and `NO_COLOR` variables. `tools/demo` is a development-only driver that replays scripted work
  through real tool calls, for screenshots without a model turn.

### Changed

- **Status bar: the run at a glance.** Context is a line with Autopilot's handoff tick; work is one
  square per milestone with `done/total`; then what Claude is doing right now, in the room that is
  left; then the run's total cost (a session's own cost moved to the panel). Failing checks, open
  issues, a busy machine (calm CPU and memory readings moved to the panel), running agents and
  handoffs show only while they matter. Labels drop at medium widths and meters shorten when
  narrow; Desktop draws both meters as graphics.
- **Activity leads with the run.** Its summary reads: run progress (objective, milestones, now,
  next, checks), this turn, Attention, Validation, then Changes grouped as code, tests, docs,
  config and other, with generated and temporary files (temp and build folders, `.claude`, the
  handoff notes, files outside the project) folded into one row. Every tool call, newest first, is
  now the secondary view.
- **Overview** shows the run's work under the context meter.
- **README:** screenshots from the terminal and from Claude Desktop, badges, and the new status bar.
- The workspace `package.json` no longer carries a version of its own, which disagreed with the
  plugin's.

### Fixed

- **Autopilot: a reload mid-handoff started a second one.** A hot reload or `/reload-plugins`
  starts a fresh runtime with empty memory, so a handoff in progress was forgotten and the context
  crossing the threshold again began another. The step under way is now kept in `$.state`, which
  outlives a reload but not a restart or `/clear`, so it never applies to the wrong context. A
  fresh runtime carries it on: a pending or running handoff waits for its turn to end, an owed
  check or `/clear` is carried out, and a step that may or may not have happened (the handoff
  prompt about to go out, a compaction) waits for you instead of being repeated.
- **Changes said `+0 −0` for files without a diff.** A file written whole now counts its lines, and
  one with no reported diff reads `new · diff unavailable` or `diff unavailable`.
- **A failure's reason was often just `Exit code 1`.** Attention now shows the line that names the
  error (`npm error Missing script: "lint"`, `not ok 1 - …`), skipping the exit status and a
  runner echoing its script.
- **Desktop: the profile name field's button read "save".** It reads "Save"; the terminal keeps its
  lowercase key hint.

### Security

- **Deleting files is high-risk.** Like edits outside the project, push and deploys, it can ask or
  be refused but no longer answers an approval for you: *Allow* is not offered. A saved *Allow*,
  in settings or in a custom profile, reads as *Ask*, is named once in the panel, and is saved
  tightened. This is a tightening: a setup that relied on it now asks.
- SECURITY.md lists the new engine calls: `$.tool.list` (tool names, once per session, to see
  whether a task list exists), `$.tool.register` (the `milestones` tool), `$.ui.scroll` (the
  panel's own pane) and the `autopilot` record in `$.state`.

## [1.0.1] - 2026-10-07

Desktop fixes after a look at the panel in Claude Desktop's Code tab.

### Fixed

- **Desktop: lines ran past their cards.** In Activity, a long tool call pushed past the card's
  edge and hid its duration. A browser keeps a flex item as wide as its text, so lines that should
  end in an ellipsis overflowed instead. They now cut at the card's edge, and so do file names,
  card asides and the status bar's readings.
- **Desktop: the profile name field overflowed.** In Setup, *Keep as a profile* squeezed its
  label into a narrow column and its text field ran past the card. In a narrow panel the field now
  sits under its label.

### Changed

- **Desktop: section buttons.** When they all fit, they sit in one row at their own widths with an
  even gap, like the panel's other choices. In a narrow panel they form three equal cells per row,
  each button centred, so the columns line up. At full size they no longer spread across the
  window.
- **Desktop: a readable page width.** At full size the page keeps to 80 columns, centred, as in a
  wide terminal, so a setting's label and its control stay close together.

## [1.0.0] - 2026-10-07

The first stable release. It finishes the 0.2 redesign after a live pass in a real terminal, and
fixes Autopilot's handoff in the interactive terminal.

### Changed

- **Status bar: live readings only.** Context, cost, CPU and memory (with recent history in wide
  terminals), running agents, and events as they happen. Settings such as Frontier Max or the
  handoff threshold are no longer shown there. CPU and memory are sampled while *Live CPU and
  memory* (Setup, on by default) or a machine-load limit is on, every 3 s by default.
- **Panel: settings-list rows and cards.** Each row has its label and a one-line description on the
  left and its control on the right, at every width. Groups sit in rounded cards with a title in
  their section's accent (one quiet hue per section).
- **Overview** is a map of the product: the live readings, then one color-coded card per section
  with its systems and an *Open ›* link.
- **Context** explains the handoff in three numbered steps, with the actions beside them.
- **Behavior** gives each system its own card, with its live state in the title.
- **Desktop:** the section buttons form an even grid (one row when wide, three per row when narrow),
  and rows are spaced so native buttons never touch.
- **Overview** opens with a compact block of live readings: context with its meter, cost, CPU and
  memory. The first screen now shows the systems too, even in the short frame above the prompt.
- **No repeated titles.** A row never repeats its card's title. Behavior's cards say what each
  system does ("Keep Claude going when it stops early"), Context's reads "Hand off before the
  context fills up", and Subagents reads "Allowed  No limit". Overview's profile row has no title.
- A segmented choice moves under its label only when the label or description would not fit beside
  it (or it would take over half the row), so text never wraps into a narrow column, and wide
  panels keep each setting on one line.
- **Terminal:** a page is at most 80 columns, centred in a wider frame. In the frame above the prompt
  the tabs sit right under the title. Action buttons keep a blank line above them.
- **Setup** lists changes in the panel's own words and units (`Effort  Maximum › High`,
  `Hand off at  70% › 75%`). The field for saving a profile reads "Type a name".
- The status bar's sparklines appear once there are six readings, so the bar does not shift with
  each new sample. Guardrails' sparklines grow from the right.
- A handoff that waits for you because you chose *Wait for me* reads calm (the accent color), not
  red. Red is kept for a handoff that went wrong (no notes, clearing refused).
- Notifications, Autopilot notices and `/cr` replies use the panel's words: "Autopilot on. Hands
  off at 70%", "Machine load Medium", "Status bar above the prompt", "Kept Claude going". They no
  longer start with "Control Room:", since Claude Code already heads each notification with the
  plugin's name.

### Fixed

- **Autopilot in the interactive terminal:** its `/clear` was taken for one of yours. The terminal
  finishes the reset after the command returns (the Desktop host protocol does it before), so the
  run recorded "cleared" instead of a handoff, the fresh context missed its continuation note, and
  the continuation prompt carried the old session number. Control Room now waits for the fresh
  session before it continues. If no fresh session comes, the clear counts as refused and
  compaction takes over (when allowed).
- Guardrails' CPU and memory gauges read "—" while live readings were on without a machine-load
  limit. They now show the same readings as the status bar.
- In a narrow status bar, the panel button read "Open" while the panel was open. After a hot reload
  Control Room also forgot that the panel was open.
- `/control-room`'s description listed the sections of 0.1.
- At a very low handoff point, the status bar's ten-cell meter drew its tick over its only filled
  cell, hiding that the context was past it. A reading past the tick now always shows beyond it.

### Added

- The manifest and the marketplace entry link to the repository (`homepage`, `repository`).
- The README covers the one-line install from inside a session and how to get updates.

### Verified

- `tsc`, `claude plugin validate --strict` (plugin and marketplace) and 127 tests in
  `claude plugin test`, on Claude Code 2.1.292 and 2.1.289.
- A live pass in a real Windows terminal (Claude Code 2.1.292) at 150, 120, 100 and 80 columns,
  docked and above the prompt: the status bar, every panel section, the pickers, profiles, and
  keyboard focus.
- The full Autopilot chain in the interactive terminal, twice: the mid-turn notice, the handoff
  notes, *Wait for me*, then *Start fresh*, the seeded fresh context and the continuation.

## [0.2.0] - 2026-10-07

A redesign of everything you see, for the terminal and Desktop. The design is recorded in
[docs/DESIGN.md](docs/DESIGN.md).

### Changed

- **Status bar** (formerly the HUD) now uses plain words and shows only what is on or needs a
  look. "Context ━━━━── 31%", "Hands off at 70%" and "Memory 91%" replace codes like `CTX`,
  `AUTO 700k` and `RES MED ▲`. There are no separators or all-caps labels. Its button opens and
  closes the panel.
- **Control Room panel** has six sections instead of nine tabs: Overview, Context (Autopilot and
  the session chain), Behavior, Guardrails (permissions, subagents, machine load), Activity and
  Setup (profiles, display, about). Each section answers one question.
- **A design system** (`hooks/ui/primitives.tsx`) draws every control natively per surface:
  - switches, segmented choices, choices that open in place with one line per option, − / +
    steppers, thin meters with a threshold tick, and callouts for anything that needs you;
  - Desktop gets native buttons and popups, plus SVG meters and charts.
- **Progressive disclosure:** a system is one switch, and its finer settings appear only while it
  is on.
- **Profiles** read "Normal · edited" when changed, and Setup lists each change
  (`Machine load  Off › Medium`), with *Save as* and *Back to Normal*.
- `/cr status` and `/cr help` use the same plain language.
- The Autopilot's state notes and the guard's pause reasons are reworded the same way.

### Fixed

- Terminal choices could get stuck open: Claude Code's terminal dropdown opens on a click, but its
  options could not be clicked and it could not be closed with the pointer. The terminal no longer
  uses dropdowns. Every choice works with a click or with Tab and Enter, and closes on a pick or a
  second click.

## [0.1.0] - 2026-10-07

First release.

### Added

- **HUD**: a persistent band above the prompt with context tokens, %, a threshold meter, session
  and run cost as reported, profile, Frontier Max, Autopilot state and threshold, Resource
  Governor, subagents, guard, router, Focus View and the run/session. Segments are fitted to the
  width by priority. A second line appears only when something needs you. The HUD can go on the
  status line instead.
- **Control Centre**: a docked pane with nine tabs (Overview, Autopilot, Modes, Resources,
  Permissions, Chain, Activity, Profiles, Settings). Keyboard-driven in the terminal (`1`–`9`,
  Tab/arrows, Enter, Esc) and native controls on Desktop. Mobile falls back to cycling buttons.
- **`/control-room` and `/cr`**: every control as a sub-command.
- **Context Autopilot**: thresholds by tokens or %, clamped below Claude Code's auto-compact point.
  HANDOFF PENDING with a mid-turn notice to finish the current unit of work. A handoff turn that
  verifies the state, updates docs, records unfinished work, runs minimal validation and writes
  `NEXT_SESSION_PROMPT.md` in Claude's own words. A freshness check of that file. `/clear`, a
  seeded fresh context, and an automatic continuation. Compaction only as a fallback. A START
  FRESH CONTEXT action when it needs you.
- **Session Chain**: run and session records across context resets, with reported costs only.
  The current run and recent runs appear in the Chain tab.
- **Frontier Max**: a professional evaluation policy and the maximum supported reasoning effort,
  never invented for models without effort. It persists across continuations.
- **No-Lazy-Exit Guard**: heuristic premature-exit detection that credits completion evidence and
  exempts blockers, your decisions and optional ideas. An optional low-cost model check when
  unsure. Per-turn and per-session caps, and repeat detection. It stands down during handoffs.
- **Model Router**: Balanced, Performance, Economy and Custom tables for subagents (by type) and
  for the main conversation (per turn, only when cheap to switch, only to model ids seen
  answering). It never downgrades under Frontier Max.
- **Subagent Control**: Unrestricted, Off, Ask or Max *N*, with live counts.
- **Focus View**: compact tool rows that expand in place, hidden results and inline diffs by
  default, an activity summary in the spinner, and the Activity tab with tool calls and per-file
  diffs.
- **Resource Governor**: Low, Medium, High or Custom advisory CPU/RAM ceilings, a lightweight
  machine-wide sampler for each platform, mid-task notices to Claude, heavy-job gating, and
  stopping Claude-started background tasks on request.
- **Permission Policy**: 11 categories with Claude Code decides / Allow / Ask / Deny, safe
  defaults, and invariants that never loosen a deny or plan mode. Allow is not offered for
  high-risk categories.
- **Profiles**: Normal, Frontier Max, Low Resource, Release/QA and custom profiles, each shown as
  an exact diff.
- Policy delivery that falls back from the system prompt to prompt context on machines whose
  managed guard skips user plugins' prompt sections.

### Verified

- `claude plugin validate --strict` (plugin and marketplace), `tsc` against the declarations of
  Claude Code 2.1.292 and 2.1.289, and 115 tests in `claude plugin test` (pure logic,
  engine-driven hooks, and UI on the terminal, desktop and mobile surfaces).
- Live headless runs in the Desktop host protocol on Windows 11:
  - the full Autopilot chain (threshold mid-turn, handoff, verified file, `/clear`, new session,
    automatic continuation)
  - Deny before execution
  - subagents blocked
  - the Windows sampler through Claude Code's process API
  - Router routing to a learned model id
- Real-terminal rendering of the HUD and every Control Centre tab at 150 columns, including
  hot reload.
- Marketplace install, enable and load in an isolated Claude Code configuration.

### Known limitations

See the README's [Limitations](README.md#limitations). In short: the resource ceilings are
advisory; shell classification is pattern-based; Ask is refused in headless runs; the Desktop
app's own sidebar cannot be modified; and the Desktop visuals and macOS/Linux sampling are not yet
verified live.
