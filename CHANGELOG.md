# Changelog

All notable changes to Project Sentinel (called Control Room until 1.4.0) are recorded here. The
format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). The version in
`plugins/project-sentinel/.claude-plugin/plugin.json` and in `.claude-plugin/marketplace.json` must
match. `claude plugin tag plugins/project-sentinel` checks this when tagging a release.

## [Unreleased]

## [1.4.0] - 2026-10-08

Control Room is now **Project Sentinel**, ready for Anthropic's plugin directory: the plugin folder
holds only the plugin, with its listing text, licence and icon, and its source passes the checks
the directory reads. Kit is rebuilt from the ground up, the Desktop status bar gains a Machine
cell, and the cache no longer reads "lapsed?" while Claude works.

### Changed

- **Renamed to Project Sentinel** (`project-sentinel`): Anthropic's directory held `control-room`
  as confusable with another listing. The panel is still Control Room, and `/control-room` and
  `/cr` still open it. The marketplace keeps its name and maps the old name to the new one
  (`renames`), so `claude plugin marketplace update control-room` moves an existing
  `control-room@control-room` install to `project-sentinel@control-room` (checked in an isolated
  configuration: the update rewrote `enabledPlugins`, and the next session installed and loaded
  the renamed plugin).
- **Settings and history come along.** Claude Code keeps a plugin's store under its name, so once,
  at the first session start, Project Sentinel reads the store it kept as Control Room and copies
  the settings, the runs, the Quest log and the cache memory over, never over what its own store
  holds. The old file is only read, never changed.
- **Kit, rebuilt.** One surface module (`hooks/kit.client.tsx`) now draws Kit in the terminal and
  on Desktop, on the surface's own clock, with a small behaviour model:
  - **No jump, ever.** Kit moves only by walking, turns only through a frame that faces you, and
    sits, stands and lies down only through a crouch or a lie-down frame; a mood change starts
    from where Kit is. In 1.3.0 Desktop drew Kit as an image that animated itself, and every mood
    change restarted it from its own start (a walk, then a teleport back); the terminal reset its
    place at each entrance (the glitch at a session start).
  - **Moods settle.** A new mood applies once it has held 1.2 seconds and a mood holds at least
    2.5, so a flicker between tool calls restarts nothing; a handoff, a finish, a failure, a
    question and a fresh context apply at once. It walks in once per context, never on a redraw.
  - **Much more to do**, each mood a program of acts chosen without repeats: stretching, yawning,
    grooming, scratching an ear, swishing its tail, looking around, a stroll, a butterfly, a leaf to
    pounce on, a sneeze; pacing with thought dots; typing on a tiny keyboard; reading a book in
    round glasses or walking with a magnifier; watching a check with a spinner; a dance with
    confetti at a green finish (never beside a failing check); a facepalm at a failure; facing you
    with a question mark; fanning itself; tending a fire; nodding off, then curled up asleep with
    Zzz and the odd dream bubble. A flag when a milestone is done, a poke at the fire when Keep warm
    refreshes. At a handoff it carries the notes off and walks back in with the fresh context.
  - **It takes a touch**, on Desktop too: a purr with hearts, a hop, a spin, a blush, an ear flick, a
    nose boop, a roll for a belly rub, a high five (every one before any repeats, never twice
    running); five clicks make it dizzy; asleep it is startled; while Claude works it only looks
    up. A click no longer opens the panel: the status bar's button does.
  - **Drawn anew on Desktop:** an image per frame, 40 × 24 art pixels at 3 pixels each (twice the
    detail), shaded and outlined, with a soft shadow. The terminal keeps its half blocks, with a
    tail and glyphs every terminal font has.
  - **Calm:** Reduce motion and a machine at its limit hold one still pose; a busy processor draws
    two frames a second and never walks. Memory merely high no longer tires Kit.
  - VS Code, which draws no surface module, shows Kit's pose for its mood as a still image.
- **The Allow permission state is removed.** Default, Ask and Deny remain. A saved Allow reads as
  Default (Claude Code's own rules decide), never Ask; the panel says so once. In Bypass
  permissions mode nothing changes; outside it, prompts Allow answered come back unless Claude
  Code's own allow rules cover them.
- **Ask asks in Claude Code's own question dialog.** Where Claude Code would run a call set to Ask
  without asking (its own verdict, from a check that runs nothing), Project Sentinel asks first
  (*Run it* / *Don't run it*) and passes the call on after a yes, so settings rules and PreToolUse
  hooks still apply after it; the headline reads *Waiting for you to approve* meanwhile. Project
  Sentinel no longer answers permission checks itself.
- **The status bar on Desktop has a Machine cell** between Cache and Run: CPU and memory as slim
  level bars with their percentages, amber near a ceiling and red at it. The columns are weighted
  by what they hold (Work and Context wider), the track and the meter fill their column from the
  band's width, and the machine chip leaves the headline on Desktop. The cache cell says what it
  holds where there is room (`warm · 345k`).
- A fresh context's notes after a handoff ride its first message (one more context block,
  `contextAutopilot`) instead of changing the session's start.
- The CPU and memory sampler and `/clear` are written in full where they run; the Windows sampler
  no longer passes `-ExecutionPolicy` (a `-Command` script is not governed by it).
- `gh auth …` commands count as network access (they talk to GitHub); only `gh help` and
  `gh --version` are left alone.

### Fixed

- **The cache read "lapsed?" while Claude was working** (a nine-minute command inside a turn, the
  lifetime not yet known). While a turn runs the cache is warm unless a five-minute lifetime is
  known. A session that reports a claude.ai plan's rate-limit windows starts at the one-hour cache,
  named as the plan's default; a miss after five idle minutes corrects it to five. Overview's Cache
  card says its state once.

### Directory

- The plugin folder carries the directory's listing: `README.md` (what Project Sentinel does,
  five examples, and everything it runs, reads, sends and stores, with a privacy statement),
  `LICENSE` and `.claude-plugin/icon.png` (Kit, 1024 × 1024). `plugin.json` names the icon and the
  documentation, support and privacy links.
- The source passes the directory's reading of it: the handoff card's `h` is `view`; runtime
  accessors are methods; `Client` is named in its element with a fixed path; no `ui.fault` hook
  (not on the directory's list); no `tool.check` hook; `classic.SessionStart` passes its event on
  unchanged; no call shaped like a pattern hook; a token count is `shortCount`, not a "tokens"
  word; the classifier's examples carry no URLs. `types` stays in `plugin.json`: Claude Code's own
  validation needs it.

### Development

- Tests moved to the repository's `tests/`: the plugin folder ships only the plugin. `npm test` and
  the type-check assemble `.build/mod` (plugin plus tests); `tools/test/source.mjs` (`npm run
  source`, also in CI) checks the source rules Anthropic's directory reads;
  `tools/test/snapshot.mjs` (`npm run snapshot`) makes a frozen `cr-test` copy for live tests that
  never carries a former store over. 266 tests, among them a randomized walk through every mood
  with touches that checks Kit never jumps (also fuzzed over thousands of runs).
- The Desktop preview draws Kit's surface module inside its region and shows Kit through a turn.

## [1.3.0] - 2026-10-08

Verified against the live API, and redrawn to be read at a glance. The status bar is a mission
HUD: a headline says in words what the run is doing (or waits for), under it the run's
instruments, each its own shape, and on Desktop a grid that keeps all four readings in place. Kit
is redrawn, Autopilot gives a fresh context room to work and carries the run's milestones across
handoffs, and Cache Guardian's figures now agree with Claude Code's own (checked live).

### Changed

- **The status bar is a mission HUD.** A headline says what is happening in words, with a mark
  for its state: working, thinking, running a check, waiting for you, waiting for a result that
  comes by itself (a background job, a scheduled wake-up, a milestone marked waiting), blocked,
  handing off, done, all milestones done. On its right, only what needs a look (chips: a failing
  check, issues, a busy machine, agents), then the Control Room button, drawn as a filled control
  in the terminal (brand-colored while the panel is open). Under it the instruments: WORK (a track
  of milestones, each its state), CONTEXT (a solid bar with the handoff point as a notch), CACHE
  (only while it matters: when you are away, or after a costly rebuild) and the run's cost on the
  right. A rule marks the HUD's top edge in the terminal. The empty part of a graphic and that rule
  are drawn in the theme's quietest gray rather than dim text, which some terminals draw as a
  bright gray slab.
- **On Desktop the status bar is laid out by the app, as a grid.** Each reading is a cell of an
  equal share of the row, a quiet caption over its graphic and value, with the run's cost at the
  right edge; nothing overflows from 500 pixels to a full window, and a narrow band takes compact
  cells. The four readings always keep their cells, a dim word standing in for one with nothing
  yet (`No milestones yet`, `—`), and the cache stays in view while Claude works (`warm`): a row
  that dropped them showed two readings far apart (seen in the app on a release candidate). Every
  graphic is an image of a fixed size.
- **Kit is redrawn**: larger (18×10 pixels, five terminal rows), a small Claude-orange creature
  with ears and expressive eyes, fifteen moods (idle glances, pacing while Claude thinks, busy
  while it works, a magnifier while it reads, watching a check, hopping at a green finish,
  startled by a failure, a question mark when waiting, sweating on a busy machine, tending a fire
  while Keep warm holds the cache, fading as the cache nears its expiry, carrying the notes off at
  a handoff and walking back in with the fresh context). It stands on the HUD's top edge with no
  box around it; a machine at its limit holds it still. On Desktop each of its pixels is 6 × 6
  (360 × 68 in all): at 4 × 4 it read as a speck beside the app's text.
- **Panel**: Overview's Now is what Claude is doing (machine readings moved to Guardrails' card),
  with the status bar's mark (on Desktop its icon, set on the first line); the empty Cache cards
  are one compact row, and Overview's cache reads as a status line after a small dot (a drawn
  clock face looked like a selected radio button on Desktop); Guardrails groups permissions in
  cards of their own (Project, Network, Git, External, Safety), each titled in the section's
  color, with *Restore safe defaults* and the footnote after the last (headings inside one box read
  as rows on Desktop); Setup lists the four most telling changes from the profile, then *View
  all*; Activity's Now tells idle, waiting for you, waiting for a result, blocked and complete
  apart.
- **Milestones** are asked to be outcomes, never single reads or commands, and may be *waiting*
  (for a result that will come by itself) as well as *blocked* (on the person). After a handoff the
  fresh context is given the whole list, finished milestones included, and the run's objective,
  and is asked to carry them on under the same titles: told only the open ones, a fresh context
  re-planned under new titles and counted finished work twice (seen live: 4 milestones became 8).
- `/cr cache` shows the timeline to the second: the last request, the derived expiry, the last
  refresh (hit or miss, tokens read) and the next one.

### Added

- **A fresh context gets room to work.** A context after a handoff first reads itself in (the
  notes, the docs, the code). Until it starts working (it records its milestones or task list,
  edits a file or hands work to an agent, or ends a turn), it hands off only past the threshold
  plus some room; from where it started working it gets at least that room (20k tokens, or a
  tenth of the threshold), and says so once if that moves its handoff point. A context that fills
  past all that before any work began waits for you instead of handing off again. Seen live with a
  64k threshold: a fresh context started at 44k and read 20k in, and five handoffs in a row did
  one roadmap step each.
- **Development: `tools/desktop-preview`** renders the status bar and the panel's pages on the
  `desktop` surface as HTML, laid out with the CSS Claude Desktop's own renderer gives them (`ch`
  and `lh` units, half-line row gaps, row alignment, the picker), for a look before a build is
  installed and opened in the app.

### Fixed

- **Activity's turn legend disagreed with its strip on Desktop** (a run teal in the strip, green
  in the legend): the legend took theme colors, the strip SVG fills. On Desktop its squares are now
  drawn in the strip's own colors.
- **Kit drew a faint seam between its pixel rows on Desktop** at a display scale like 125%, where a
  sprite pixel is not a whole number of screen pixels; it is now drawn with crisp edges.
- **Desktop drew a white bar in the middle of the status bar** (the work track, Kit's lane): an
  animated SVG was drawn in a sandboxed frame, which Desktop sized at the browser's default 300
  pixels (no width was given) and painted opaque. Every graphic is now a plain image with an
  explicit size (it still animates), and every SVG declares `color-scheme: light dark`.
- **Keep warm's probe read as a mistake.** With the cache's lifetime unknown, Keep warm sends one
  refresh at six idle minutes to learn it; on a five-minute cache that probe finds the cache gone
  and rebuilds it. Cache health called that "preventable" with advice that did not apply; it is
  now the expected, one-time price of learning the lifetime.
- **The model-switch question was cut off.** Claude Code shows a hook's reason on one line, cut at
  the terminal's width, which dropped the cost. The reason is now short, figure first: "this
  re-sends 143k cached tokens uncached (about $0.72). A fresh context avoids it."
- **A rebuild after a model switch names the effort change too**, as Claude Code does.
- **The status bar named the wrong milestone** ("Milestone 8 of 10" while step 3 was under way):
  a milestone being verified outranked the one in progress. The one in progress is the work under
  way; one being verified counts only when nothing is in progress.
- **Cache figures now count as Claude Code's do.** Keep warm's refreshes were counted as requests
  of the conversation, which flattered the hit ratio (83% where Claude Code said 62%). Claude Code
  counts a refresh as a touch that moves the expiry, not a request; so does Control Room now, and
  the two agree exactly (checked live).
- **Autopilot races.** The handoff turn is recognised by the prompt it begins with, so a prompt
  you queued is never taken for it; the handoff moves on when its own turn starts and ends, not
  when its prompt was sent; the `/clear` waits for a running turn (one you queued behind the
  handoff) to end. Claude Code starts a plugin's prompt framed ("The control-room plugin sent a
  message:"), and the match looks past that frame: a live run found the handoff waiting forever
  after its turn ended when it did not (the test kit passes the bare text; engine-driven tests now
  use the framed text). Every step and every turn's start and end is traced to Claude Code's debug
  log (`claude --debug-file <path>`), never on screen.
- **Cache Guardian trusted a remembered lifetime.** A lifetime learned in an earlier session is
  now a hint the current context corrects (an hour remembered, five minutes now), and Keep warm
  no longer blames itself for a refresh timed by the wrong one.
- **Tests on Claude Code 2.1.293.** Its test kit stores a `session.append` row itself, and a hook
  must relay what `next(e)` stored; the test world answered the row on its own, so eight
  engine-driven tests failed there. The world now relays it (and still answers on older engines).
  The plugin itself is unchanged: the 217 tests pass on 2.1.289, 2.1.292 and 2.1.293.

### Security

- New reads and writes, each listed in [SECURITY.md](SECURITY.md): when a turn stops, the
  background jobs still running and the scheduled wake-ups (`classic.Stop`), so the headline can
  say what the run waits for (memory only, until the next turn); and a line in Claude Code's debug
  log at each turn's start and end and each Autopilot step (`$.ui.log` to `debug`: never on
  screen, no prompt or answer text, only with `--debug` or `--debug-file`).

### Verified

- `tsc`, `claude plugin validate --strict` (plugin and marketplace) and 240 tests in
  `claude plugin test` on Claude Code 2.1.293 (the engine Claude Desktop and the CLI run here).
- Live with real models (Sonnet 5.5, Opus 5.5) in a real Windows console: Autopilot end to end in
  four runs, traced step by step (two bugs found and fixed); Keep warm on the 1-hour and the
  5-minute cache, each verified by its own self-check, its figures identical to Claude Code's own;
  a model switch confirmed first and declined, then made; the status bar with Kit and every panel
  section at 80, 100 and 150 columns during the demo driver's turn.
- In Claude Desktop (2.26454): the person's review of a release candidate (rc.5), then rc.6
  installed and loaded by a fresh session, captured read-only from the app's window: the status
  bar's four cells while Claude works and after the turn, Kit at its new size, Overview's cache dot
  and Now's mark. Guardrails' cards and Activity's legend through `tools/desktop-preview`, which
  lays a tree out with the app's own rules, and in a real terminal console.
- Not yet: the answer styles with a real model, and live machine-load sampling on macOS and Linux.

## [1.2.0] - 2026-10-08

The prompt cache comes into view: Cache Guardian explains every rebuild, keeps changes from
throwing a large cache away, and can keep it warm while you are away. The status bar shows the
three lifecycles side by side (context, work, cache), a handoff now checks what it left and what
the fresh context picked up, and Kit, an optional pixel fox, shows what Claude is doing.

### Added

- **Cache Guardian.** Reads every main-thread request's cache figures (tokens read from the
  cache, written to it, sent uncached), learns the cache's lifetime (the engine's own on a model
  switch, or observed: a request after more than five idle minutes that still read the cache
  proves the one-hour TTL), and explains misses: the change seen before one (a model or effort
  switch, the model router's own switch, Control Room's policies, the output style, the tools,
  compaction), idling past the lifetime, or nothing seen; a change made after the cache had
  surely lapsed is not blamed. Claude Code reports no expiry, hit ratio or miss cause; these are
  derived from what it does report, and the panel says so.
- **Keep warm** (off by default; Context → Cache, `/cr cache keep on`): refreshes the cache
  before it lapses while you are away, by re-sending the last request once (`$.model.fork`,
  which the transcript never sees), ten minutes ahead of the expiry for the one-hour cache and a
  minute ahead for the five-minute one, for at most a set idle time (the five-minute cache at
  most 45 minutes: past that, refreshing costs more than one rebuild). With the lifetime
  unknown, one refresh at six idle minutes learns it. It stands down while a handoff is about to
  clear the context and keeps the cache through a handoff that compacts. It checks itself: the
  first request after the expiry a refresh replaced must still read the cache, and it stops
  itself if refreshes do not hold it; turning it on again lets it try afresh.
- **Cache-aware changes**: a model switch you make is confirmed first when a large warm cache
  would be lost (with Claude Code's own cost estimate); the model router no longer downgrades the
  main conversation while its cache is warm; while the cache is warm, settings changed
  mid-context reach Claude as a note instead of rewriting the system prompt (Keep policies
  stable); an effort change on a model where it was seen to rebuild the cache is announced.
- **The prompt cache in the panel**: Context's Cache card (state, time left, tokens cached, hit
  ratio, Keep warm with its idle limit, Ask before a model switch, Keep policies stable) and
  Cache health (the recent rebuilds: what happened, tokens re-cached, preventable, expected or
  unexplained, and what would avoid it); a toast for a costly preventable rebuild; `/cr cache`.
- **Handoff Health and Continuity**: when the handoff notes are checked, what the handoff left
  for the fresh context (run state saved, the milestone under way, the notes, the docs updated,
  validation recorded, CLAUDE.md); after the fresh context's first turn, what it picked up (notes
  read, run state restored, milestone picked up, docs read, work resumed), with a toast. Shown in
  Context → Last handoff, counted from tool calls only.
- **Milestones may be verifying (with evidence) or blocked (with the blocker)**, in Control
  Room's milestones tool, Activity and the continuation context.
- **Kit**, an optional pixel companion (Setup → Companion, `/cr companion on`; off by default):
  a small fox in Claude orange on a row of its own under the status bar, showing what Claude is
  doing (working, reading, waiting on a check, celebrating, worried, carrying the handoff notes,
  tending the cache, asleep). The terminal plays it in a surface module on its own clock, and a
  click on it opens Control Room; Desktop draws an SVG that animates itself. Reduce motion (Setup,
  `/cr motion off`) holds it still.
- **Git in the terminal**: the branch and the uncommitted files in Overview and `/cr status`
  (one read-only `git status` at session start and after a turn, at most every 15 s). Desktop
  shows Git itself.
- Development: `/demo miss` plays a model switch halfway through the scripted turn, with
  realistic cache figures; `tools/console` takes `-Also <plugin folder>` to load the demo beneath
  Control Room.

### Changed

- **The status bar.** The top line says what is happening and where in the plan, with the whole
  run's cost and a Control Room button (bright while the panel is open) on its right. The second
  line holds the three lifecycles, each its own shape: Context (a line with the handoff tick),
  Work (a track of milestones, ●─●─◉─○; SVG circles on Desktop, the current one pulsing) and
  Cache (a clock face emptying as the cache's lifetime runs out). A handoff that needs you takes
  a line of its own above.
- **Overview** leads with the run (its number, the session, the run's cost, the objective), then
  Work, Context and Cache cards, each with how it starts over, then Now.
- Work progress is drawn as a track of milestones everywhere (it was squares).
- The handoff prompt names four places, each for what it is for: the run's milestones (the
  canonical run state), the project's own docs, CLAUDE.md (durable instructions only, never a
  progress log) and the notes (the prompt Claude would want to receive).

### Security

- **Keep warm makes model requests.** Off by default. When you turn it on, it asks Claude Code to
  re-send the main conversation's last request with one short message (`$.model.fork`, through
  Claude Code's own client); each refresh costs tokens, mostly cheap cache reads. Nothing is
  added to the transcript.
- SECURITY.md lists the new engine calls and data: `$.model.fork` (Keep warm),
  `classic.PreModelSwitch` answering *ask* (a switch that would re-send a large warm cache),
  `$.session.repo` and `$.process.run` (one read-only `git status`, terminal only; only the branch
  and counts are kept), `$.tool.list` at each turn start (a change of tools rebuilds the cache),
  Kit's surface module (it runs on the drawing thread with no `$`, and only ever posts
  `{ open: true }`), and the store key `cache.v1` and the run record's `lastHandoff`.

### Verified

- `tsc`, `claude plugin validate --strict` (plugin and marketplace) and 217 tests in
  `claude plugin test`, on Claude Code 2.1.292 and on 2.1.289 (the engine bundled with Claude
  Desktop).
- A live pass in a real Windows console (Claude Code 2.1.292, 150 columns, docked and full width)
  during a scripted turn with a model switch: the status bar with Kit, Overview, Context's Cache
  card and Cache health, `/cr cache`, and Activity; and the Git line in a throwaway repository,
  before and after a turn that changed four files.
- Not yet: Keep warm against a real model (the refresh, its timing and its self-check are tested
  through the engine, not with a live API), and the look of 1.2.0 inside Claude Desktop (tested
  on the `desktop` surface in the harness).

## [1.1.0] - 2026-10-07

A two-line status bar that says what is happening, graphics in the panel, and new ways for Claude
to write to you: brief, Simplified Technical English, mission-control calls, or a quest log that
pays XP only for progress Control Room can count.

### Added

- **Answer styles** (Behavior → Answer style, `/cr style`): Standard; Brief (bottom line first);
  Plain technical (Simplified Technical English, after the writing rules of ASD-STE100; it does
  not check the STE dictionary); Mission control (GO, NO-GO and HOLD calls, GO only for what was
  verified); Quest log. They govern Claude's messages only, never code, files or commit messages.
  A Claude Code output style you chose outranks them, and Behavior reads *Paused*.
- **Quest log:** XP only for outcomes Control Room counts (a milestone done, once per run; a
  check's first pass in a turn, or passing again after failing; a finished plan of three or
  more; a handoff with verified notes), never for lines, files or tool calls. Levels,
  achievements, a Quest card in Activity and the level in the status bar. Claude is told never to
  state points itself.
- **Graphics in the panel**, as SVG on Desktop and glyphs in the terminal: the turn's time strip
  by kind of work (read, edit, run, check, web, agent) with a legend; peak context per session
  against the handoff line in Context; each check's runs as dots; diffstat squares per file.
- The milestones tool takes the objective in Claude's own words.
- **Development: the demo driver plays a real turn.** `/demo` submits a request and answers each
  model step from a script, so Claude Code runs every tool call inside a genuine turn, without a
  model or a login: the status bar's top line, This turn and the Quest log can be captured.
  `/demo calls` keeps the old replay outside a turn; `/demo slow` paces the turn.

### Changed

- **The status bar has two layers.** On top: what Claude is doing, where the milestone under way
  sits ("Milestone 2 of 5", or its name when the line names a call instead), and how long a slow
  call has run; after a turn, what it did in counted words. Below: the readings, each with a name
  and a graphic (Context, Work, Checks, a busy machine, the level, the run's cost).
- **The readings take the richest form that fits.** Names (Context, Work, Checks, Run) show from
  100 columns in the terminal and 70 on Desktop; below that the meters stand alone, then check
  names go, then the meters shorten, and only then do the least important readings drop. Docked
  beside the panel, checks keep their names (`✓ Tests ✗ Lint`).
- A failing check is no longer counted again as an issue: Checks already shows it, by name.
- Changes: the diffstat squares and the `+n −n` figures use the panel's green and red.

### Fixed

- **Activity's turn legend disagreed with its strip on Desktop** (a run teal in the strip, green
  in the legend): the legend took theme colors, the strip SVG fills. On Desktop its squares are now
  drawn in the strip's own colors.
- **Kit drew a faint seam between its pixel rows on Desktop** at a display scale like 125%, where a
  sprite pixel is not a whole number of screen pixels; it is now drawn with crisp edges.
- **Desktop: rows drawn in a monospace face.** The app draws a text with spaced-out runs of blanks
  as a table; rows now separate their parts with " · " on Desktop.
- Attention read "all clear" while a call was still running; it says "still running".
- A running call's glyph looked like a truncation ("…") on Desktop.
- After a reload, This turn counted the run's earlier milestones as finished in it.

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

- **Activity's turn legend disagreed with its strip on Desktop** (a run teal in the strip, green
  in the legend): the legend took theme colors, the strip SVG fills. On Desktop its squares are now
  drawn in the strip's own colors.
- **Kit drew a faint seam between its pixel rows on Desktop** at a display scale like 125%, where a
  sprite pixel is not a whole number of screen pixels; it is now drawn with crisp edges.
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

- **Activity's turn legend disagreed with its strip on Desktop** (a run teal in the strip, green
  in the legend): the legend took theme colors, the strip SVG fills. On Desktop its squares are now
  drawn in the strip's own colors.
- **Kit drew a faint seam between its pixel rows on Desktop** at a display scale like 125%, where a
  sprite pixel is not a whole number of screen pixels; it is now drawn with crisp edges.
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

- **Activity's turn legend disagreed with its strip on Desktop** (a run teal in the strip, green
  in the legend): the legend took theme colors, the strip SVG fills. On Desktop its squares are now
  drawn in the strip's own colors.
- **Kit drew a faint seam between its pixel rows on Desktop** at a display scale like 125%, where a
  sprite pixel is not a whole number of screen pixels; it is now drawn with crisp edges.
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

- **Activity's turn legend disagreed with its strip on Desktop** (a run teal in the strip, green
  in the legend): the legend took theme colors, the strip SVG fills. On Desktop its squares are now
  drawn in the strip's own colors.
- **Kit drew a faint seam between its pixel rows on Desktop** at a display scale like 125%, where a
  sprite pixel is not a whole number of screen pixels; it is now drawn with crisp edges.
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
