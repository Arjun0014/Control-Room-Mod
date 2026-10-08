# Project Sentinel — Architecture & Implementation Plan

Status: implemented (see `CHANGELOG.md`). This document is the design record:
what the platform verifiably supports, how Project Sentinel (called Control
Room until 1.4.0; its panel still is) is built on it, and why each decision was
made. Written before implementation, kept current.

Target platform: Claude Code function-hooks plugins ("mods"), verified on
**2.1.289**, **2.1.292** and **2.1.293** (the engine Claude Desktop and the
CLI run on this machine now). The mods API is early access; the generated
declarations (`.claude-plugin/types/claude-code/index.d.ts`) are the authority.

---

## 1. Verified capabilities (evidence, not assumptions)

Every mechanism below was exercised in throwaway headless stream-json
sessions (the same host protocol the Desktop app uses) on both engine
versions, with a prototype mod. Log excerpts are in the development notes.

| Need | Mechanism | Result |
| --- | --- | --- |
| Automatic `/clear` | `$.command.run({ command: 'clear' })` from a `$.clock.after` timer after `turn.complete` | ✅ Host protocol (Desktop): `session.end{reason:'clear'}` → new session id → `classic.SessionStart{source:'clear'}` → promise resolves; the stream emits `conversation_reset`. ⚠ Interactive terminal: the promise resolves *first* and the reset follows. Project Sentinel therefore waits for `classic.SessionStart{clear}` (up to 15 s, else a changed session id) before it continues. |
| Inject context into the fresh window | `prompt.context` answering `{ blocks: [...e.blocks, { name: 'contextAutopilot', text }] }` for the fresh context's first message, once; after its own `/clear` the plugin calls `$.ui.invalidate('prompt.context')` so the engine asks again | ✅ live on 2.1.293 (Haiku 5.5, a terminal session handing off at 62k): the fresh context's first message carried the block as a context section, with the run and session numbers, the notes' path, the objective and all five milestones, and the fresh context finished the task; and in the engine harness. (Until 1.3.0: `classic.SessionStart` answering `additionalContext`, verified live; Anthropic's directory cannot read that answer as leaving the session's start alone, so `classic.SessionStart` now passes `next(e)` on unchanged.) |
| Resume autonomously | `$.prompt.submit({ text })` after the clear resolves | ✅ turn starts by itself, framed as "The control-room plugin sent a message" (now "The project-sentinel plugin …") |
| `$.state` across `/clear` | — | ⚠ **reset** by `/clear` (version back to 0). Module memory survives `/clear`; `$.store` survives everything. |
| Mid-turn policy updates (no user prompt) | `$.session.append({ message: { type: 'user', content } })` during a running turn | ✅ stored as a hidden (`isMeta`) user row and read on the very next model request |
| Continue a premature stop | `classic.Stop` answering `{ block }` | ✅ model continued in the same turn; 2nd Stop carries `stop_hook_active: true` |
| Subagent enforcement | `agent.spawn` answering `{ deny }` | ✅ model receives "Subagent spawn denied by a plugin: …" |
| Ask before a call | In `tool.call`, before `next`: `$.tool.check({ tool, input })` reads Claude Code's own verdict (it runs nothing); where Claude Code would not ask (allow, no verdict, auto mode), `$.ui.ask(question, { options: ['Run it', "Don't run it"], header: 'Approve' })` asks in Claude Code's question dialog; a decline answers `{ deny }` | ✅ in the engine harness; the dialog is Claude Code's own. There is no `tool.check` hook: the directory refuses one that reads what `next` answered, and answering a permission check is what the removed *Allow* did. (Until 1.3.0: `tool.check` answering `{ decision: 'ask' }`, which held in `bypassPermissions` mode.) |
| Per-request effort | `turn.step` → `next({ ...e, effort: 'max' })` | ✅ accepted (Sonnet 5.5 default `medium` → sent `max`); `e.effort` is absent for models without effort (Haiku) |
| Live context / cost | `session.measure` (pushed after every main turn) + `$.session.usage()` | ✅ `context.tokens/window/percent`, `cost.usd`, `rateLimits` |
| Host CPU/RAM | `$.process.spawn` of one long-lived sampler | ✅ Windows P/Invoke sampler: ~0.5 s CPU / 30 s incl. start-up, ~80 MB; one-shot probes cost ~2.4 s each (rejected). Verified live through the final plugin on 2.1.289 and 2.1.292. |
| Model per request | `turn.step` → `next({ ...e, model })` | ⚠ **full ids only**: a bare alias (`haiku`) fails the turn on 2.1.292 (`unrecognized_model` → `model_fallback` → an error answer). Ids reported in `usage.model` (main and subagent steps) work. Subagent spawns *do* resolve aliases. |
| Store scope | `$.store` | One store per plugin name and source (`~/.claude/plugins/store/<name>_<source>-<hash>.json`, the hash the first 12 hex digits of the SHA-256 of `<name>@<source>`; the source `inline` for a folder or a directory marketplace loaded in place); every `--plugin-dir` load of `project-sentinel` shares one. |
| A renamed plugin and its store | the marketplace's `renames` (`{ "control-room": "project-sentinel" }`); `$.fs.read` of the former store's file once | ✅ in an isolated configuration (2.1.293): `claude plugin marketplace update` rewrote `enabledPlugins` to the new name, the next session installed and loaded it, and the carry-over (`app/formerStore.ts`: at the first load, before a setting is read, the configuration folder from `CLAUDE_CONFIG_DIR`, `USERPROFILE` or `HOME`, else the session's transcript path at its start; of the candidate files, the one written last) copied the settings, the cache memory, the Quest log and a run, renumbering the new one. The old file is only read. |
| Two copies in one session | Claude Desktop hands a Code tab session its plugins once, when its process starts (the SDK's `plugins`, loaded as `<name>@inline` from the paths in `installed_plugins.json`); when that file changes it sends `reload_plugins` to every live session (idle ones at once, busy ones when their turn ends), which keeps those and adds what `enabledPlugins` names | ✅ seen live (1.4.0-rc.1, Claude 2.26454, Claude Code 2.1.293): after `claude plugin marketplace update control-room` the idle sessions ran Control Room 1.3.0 and Project Sentinel side by side, Project Sentinel on its defaults. Since rc.2 Project Sentinel reads Control Room's `hud` in `$.state` when it loads and, if Control Room published one, stands by: every hook passes its event on until the session restarts. |
| The cache's lifetime on a plan | `$.session.usage().rateLimits` naming `five_hour` or `seven_day` windows | Read as a claude.ai plan, whose default prompt-cache lifetime is one hour: used below anything learned or reported, never stored, corrected by a miss after five idle minutes. |
| Prompt cache figures | `turn.step` answer `usage` (`input_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`, `model`) for each main-thread request | ✅ in the engine harness and live. ⚠ Claude Code keeps its own tracker (expiry, hit ratio, misses and their causes), but hands it only to the **status line** (`prompt_cache` in its input), never to a mod: `$.session.usage()` has context, rate limits and cost only. So Project Sentinel derives the same figures from the usage and names them as derived. Checked live against the status line's `prompt_cache` (1-hour cache, Sonnet 5.5): the derived expiry within a second of the engine's, the hit ratio identical (0.62185) once Keep warm's refreshes are left out of it, as the engine leaves them. |
| Cache lifetime and a confirmed model switch | `classic.PreModelSwitch` (`prompt_cache_warm`, `cache_ttl`, `context_tokens`, `estimated_cache_write_usd`) answering `permissionDecision: 'ask'` with a reason; `classic.PostModelSwitch` (`from_model`, `to_model`, `cache_ttl`, `source`) | ✅ live on 2.1.293 (143k warm, Sonnet → Opus): Claude Code asks "Switch model?" with the hook's reason and Yes / No; declining keeps the model and the cache. ⚠ The reason is drawn on one line and cut at the terminal's width, so it is kept short. After the switch, the lifetime as Claude Code reports it, and the rebuild named as Claude Code names it (model and effort changed, 143k re-cached). |
| Keep the cache warm | `$.model.fork({ prompt })` from a `$.clock.after` timer | ✅ live on 2.1.293 (Sonnet 5.5, 1-hour cache): a fork re-sends the main thread's last request plus one user message, never added to the transcript (0 rows), and returns the request's usage. The engine counts a fork that reads the cache as a *touch*, not a request: its own expiry moved 05:38 → 05:44 → 06:34 with each refresh (requests stayed 2). A real prompt 66 minutes after the last one, past the expiry the refreshes replaced, read the cache (0 misses), and Keep warm marked itself verified. Each refresh of an 87k context cost about $0.02. On a 5-minute cache too: the probe learned the lifetime (it found the cache gone, as a probe past five minutes must), refreshes every four minutes read the whole 141k, and a prompt after a replaced expiry hit. ⚠ Claude Code's own tracker touches the expiry only for a fork that *reads* the cache, so after a probe that rebuilt it the status line says cold while the cache is warm (the next refresh read all of it). `nothing-to-fork` before the first response. |
| A drawing with its own clock | a `Client` element naming a surface module, written `<ui.Client module="./kit.client.tsx" />` with `const ui = $.ui.resolve(e)` (the directory reads a `Client` taken out of the table as one with no fixed path); the module gets `surface.every`, `setState`, `onPointer`, `post`; `ui.message` carries its posts to the hooks module | ✅ terminal, live in a real console (Kit through a demo turn, clicks). Desktop runs the module in its own page (a frame with Claude Code's runtime): pointer events in cells of 1ch × 1lh, its local state kept across redraws under one key; a hand-made `{ type: 'Svg', props }` element is accepted in its tree (at most 2000 nodes, depth 32, scalar props; an `Svg` source up to 131072 characters). Chromium decodes a fresh data-URL image before its first paint (60 of 60), and Desktop replaces the region's DOM per render, so an image per frame does not flicker. No `ui.fault` hook: it is not on the directory's list of events; a module that cannot draw posts `{ fault }` instead. |
| Graphics on Desktop | `Svg` with `source`, `alt`, `width`, `height`; `isInteractive` draws it in a script-less sandboxed frame instead of an image | ⚠ A frame with no `width` takes the browser's default (300 px), and a frame whose color scheme differs from the page's is painted opaque: 1.2.0's animated work track showed as a white bar on Desktop. So Project Sentinel draws every graphic as an image with an explicit size and never asks for a frame. (SMIL animates inside a plain image too, but an image that animates itself restarts from its own beginning whenever it is replaced: 1.3.0's Kit teleported back at each mood change. Kit is now an image per frame from its surface module.) |
| How Desktop lays a tree out | the app's own renderer (Claude Desktop 2.26454, read from its bundle) | A `Box` is a flex `div`: `width`, `minWidth`, `columnGap` and horizontal margin and padding in `ch`; `height` and `minHeight` in `lh`; `rowGap` and vertical margin and padding in half lines (`--engine-row-unit`, `.5lh`); a bordered box gets the app's border, radius and padding. A `Text` is a `span` that wraps (`pre-wrap`) unless it truncates. A row box that sets no `alignItems` centers its texts, buttons, images and pickers on the row (so a mark beside two lines sits between them). `Select` is the app's combobox: a button `width: fit-content`, no width prop, so pickers are as wide as their value. An `Svg` without `isInteractive` is an `img` (`display: block`, `max-width: 100%`, its width and height in px). `tools/desktop-preview` renders with these rules. |
| A trace nobody sees | `$.ui.log(text, { to: 'debug' })` | ✅ lines appear in Claude Code's debug log (`--debug`, `--debug-file`) under the plugin's name, never on screen. Autopilot traces each step and turn there. |
| What a stopped turn leaves running | `classic.Stop` input `background_tasks` (id, type, description) and `session_crons` (schedule, recurring) | ✅ in the engine harness (2.1.293): the status bar says *Waiting for …* instead of *done* while a job or a wake-up will bring the turn back. |
| The project's Git state | `$.session.repo()` (the repository root, or null) and `$.process.run(['git', 'status', '--porcelain=v1', '--branch', ...], { timeoutMs: 10_000 })` | ✅ live in a real console: `master · clean`, then `master · 4 uncommitted` after a turn that changed four files. |

Platform constraints discovered and designed around:

* `claude plugin validate` statically tracks `$`: it must always be spelled
  `$.noun.method(...)` and may only be passed to a function declared at the
  top level of the same file. → one **Host adapter** (`hostOf($)`) in
  `register.tsx`; every feature module works against the `Host` interface.
  This is also the pattern of Anthropic's own `diff` mod, and it makes the
  core unit-testable.
* `$.state` refs need literal `plugin`/`key` at the call site → state atoms
  are top-level consts read with `read($, atom)` inside render hooks.
* Hooks have a 10 s *own-time* budget (`$` calls and `next` don't count).
  Long work runs from timers, never inside a dispatch.
* `session.start` does **not** fire after `/clear`; re-initialisation runs
  from `session.end{clear}` / `classic.SessionStart{clear}`.
* `$.ui.invalidate('ui.render')` redraws *every* instance a plugin's render
  matchers select (all transcript tool rows once Focus View hooks them). →
  rendering is driven by `$.state` subscriptions so only readers redraw.
* `prompt.compose` is continued past the user tier by Anthropic's
  `sec-default` guard on managed machines. → Frontier/Resource policies fall
  back to `prompt.submit` context automatically when the compose hook is not
  reached (detected, not guessed).
* A mod may turn an engine `ask` into `allow`, but **must never loosen a
  `deny`**; `sec-default` enforces this where seated and Project Sentinel
  enforces it everywhere as an invariant.

## 2. Product surface

| Surface element | Mechanism | Terminal | Desktop |
| --- | --- | --- | --- |
| **Status bar** (persistent) | `ui.render` `AbovePrompt` band, yields to surveys; or `$.ui.status`. Two lines: what Claude is doing with the run's cost and the panel button, then the three lifecycles (Context, Work, Cache) and the checks; graphics as glyphs, SVG on Desktop | ✅ | ✅ |
| **Kit** (optional) | a row under the status bar: a `Client` surface module in the terminal, a self-animating SVG on Desktop | ✅ | ✅ (SVG) |
| **Launcher / sidebar** | `Pane` `control-room`: docked beside the transcript in the fullscreen TUI, inline otherwise; placed by Desktop | ✅ | ✅ |
| **Control Room panel** | the same pane: six sections drawn by the design system (`ui/primitives.tsx`) | ✅ | ✅ (native controls, SVG meters) |
| Activity line | `Spinner` `message` rewrite while a turn runs | ✅ | ✅ |
| Focus View | `ToolUse` / `ToolResult` / `ToolGroup` render hooks | ✅ | ✅ |
| Alerts | `$.ui.toast`, `$.ui.status` (only on state changes) | ✅ | ✅ |
| Commands | `/control-room [sub-command]` (`/cr` when free) | ✅ | ✅ |

No API exists to modify the Desktop application's global sidebar; the
docked Pane is the supported "sidebar-like" mechanism.

## 3. Module layout

```
plugins/project-sentinel/
  .claude-plugin/plugin.json      manifest (types → ./types/index.d.ts; icon and listing links for the directory)
  .claude-plugin/icon.png         the directory's icon: Kit, 1024 × 1024
  README.md, LICENSE              the directory's listing text and disclosure; MIT
  hooks/hooks.json                { "modules": ["./register.tsx"] }
  hooks/register.tsx              Host adapter (hostOf) + every on(...) registration (thin)
  hooks/kit.client.tsx            Kit's surface module (terminal and Desktop): behaviour model, art, glue
  hooks/host.ts                   Host interface (the only door to the engine)
  hooks/constants.ts              ids, store keys, limits
  hooks/app/
    runtime.ts                    composition root: wires features, owns the live model, performs effects
    views.ts                      projections (HUD, pane, resources, chain, activity, permissions, focus, spinner)
                                  and the plain-language status every surface shares
    headline.ts                   the status bar's headline (what the run is doing or waiting for, in words,
                                  with its state) and its chips (what needs a look)
    publisher.ts                  coalesced, diffed writes of those projections to $.state (+ status line)
    commands.ts / actions.ts      /cr sub-commands; the panel's actions
    persist.ts                    store reads/writes (settings, runs, index), debouncing, pruning
    monitor.ts                    resource sampler lifecycle (spawn, parse, restart, stop)
    cacheGuardian.ts              Cache Guardian: request telemetry, Keep warm's timer and fork, its
                                  self-check, stable policies, the countdown, the cache's views
    formerStore.ts                the one-time carry-over from the store kept as Control Room; standby beside it
  hooks/core/
    settings.ts                   schema, defaults, normalisation (clamps, a saved allow → default)
    profiles.ts                   built-in + custom profiles, labelled diffs
    policy.ts                     effective() snapshot (the priority system) + system-prompt sections
    answers.ts                    answer styles in the panel's words: labels, hints, sample lines, notes
    format.ts / text.ts / version.ts
  hooks/features/
    autopilot.ts                  threshold maths + pure state machine (events → model + effects)
    chain.ts                      run + session records, totals (reported costs only)
    guard.ts                      premature-exit heuristics, thresholds, repeat detection
    router.ts                     task classes, tables, main/subagent routing, model families
    subagents.ts                  spawn decisions, live counts
    activity.ts                   tool-call tracker, changed files and hunks, refusals and reasons, summary line
    plan.ts                       the run plan from Claude's task tools (TodoWrite, TaskCreate/Update/List), progress
    validation.ts                 checks recognised by their runner (tests, build, type-check, lint, checks, simulation)
    digest.ts                     signal: change groups, Attention, the turn in counted lines, what Claude is doing now
    quest.ts                      Quest log: XP table, levels, achievements, validation of the stored quest
    cache.ts                      the prompt cache model: observeRequest, miss causes and kinds, the TTL
                                  learned, nextRefresh (Keep warm's schedule), the stored cache.v1
    handoff.ts                    Handoff Health and Continuity: healthOf, continuityOf, the stored record
    companion.ts                  Kit: its mood from the status bar's state, and the props for its module
    git.ts                        `git status --porcelain=v1 --branch` parsed into a line
    prompts.ts                    every text Project Sentinel gives Claude (answer-style policies included)
    permissions/                  shell tokenizer, category classifier, decisions + invariants
    resources/                    samplers + parsers (Windows/macOS/Linux), pressure, heavy commands
  hooks/ui/                       design system (primitives.tsx, theme.ts, kit.ts: the view kit, not
                                  the companion), status bar (hud.tsx), Focus view rows,
                                  pane/ (frame + overview, context with cache and handoff, behavior,
                                  guardrails, activity, setup)
  types/index.d.ts                settings schema + PluginState contract (render view models)

tests/                            claude plugin test suites + fixtures (fake host, engine world),
                                  outside the plugin folder; tools/test/mod.mjs runs them on .build/mod
```

Data flow: engine event → `register.tsx` hook → `Runtime` method (pure
decisions in feature modules, effects through `Host`) → model mutation →
**publisher** projects view models into `$.state` atoms → subscribed render
sites redraw. No feature module touches `$`.

## 4. State model

| Layer | Holder | Survives | Contents |
| --- | --- | --- | --- |
| Settings | `$.store` `settings.v1` (normalised on load) + module memory | everything | active profile, per-system settings, custom profiles |
| Run / chain | `$.store` `run.v1.<id>` + `runs.index.v1` + `runs.counter.v1` | `/clear`, reload, restart | run id, sessions (ids, times, peak context, cost, turns, model, end reason, transitions); 30 runs × 60 sessions kept |
| Run plan and objective | inside the run record (`plan`, `objective`) | `/clear`, reload, restart | Claude's milestones as its task tools left them; the objective as Claude stated it, else the person's latest substantial request |
| Quest log | `$.store` `quest.v1`, and the run record's `quest` | everything | lifetime XP, achievements with when each was earned, the last 8 awards; per run, its XP and the milestones already paid for |
| Prompt cache memory | `$.store` `cache.v1` | everything | the cache lifetime learned (`5m` or `1h`) and how; Keep warm's verdict on itself and when; the short model names on which an effort change was seen to rebuild the cache (at most 12) |
| Last handoff | the run record's `lastHandoff` | `/clear`, reload, restart | when, from and to which session, how (clear, compact, manual), Handoff Health's checks, the milestone under way then, the plan's count, and Continuity's checks once the fresh context's first turn ended |
| Handoff in flight | `$.state` `autopilot` (`{ record }`) | hot reload only (gone after restart or `/clear`) | the Autopilot step under way, when it began, retries, a snooze: what a reload needs to carry the handoff on instead of starting a second one |
| Live session | module memory (`Runtime`) | `/clear` (module stays loaded) | context, cost, autopilot machine, guard counters, activity, changes, resources, agents, learned model ids; this context's cache state (requests, misses, Keep warm's refreshes; reset at a fresh context); the Git state |
| View models | `$.state` atoms `hud`, `pane`, `resources`, `chain`, `activity`, `permissions`, `focus`, `spinner` | hot reload (re-published after `/clear`) | render-ready projections only |

On hot reload `session.start` fires again: settings and run are re-read from
`$.store`, live figures from `$.session.usage()`; nothing important lives
only in a render projection. Settings writes are whole-object, debounced;
run writes are per-run keys (no cross-session clobbering of the index's
contents beyond the id list).

## 5. Explicit priority system

Conflicts are resolved by one `effective()` snapshot (`core/policy.ts`),
computed from settings + live state, in this order (higher wins):

1. **Organisation & engine safety** — managed settings, deny rules, plan
   mode. Never loosened (hard invariant in code).
2. **Permission Policy** — deny > ask > allow; applies to every action,
   including work the autopilot or guard asked for.
3. **The person's live actions** — Esc/abort cancels pending automation; a
   prompt typed while a handoff is pending is honoured (with a handoff reminder).
4. **Context Autopilot** — once pending, the guard is suspended for the
   boundary and the handoff turn; no new large work is encouraged.
5. **Resource Governor** — constrains *how* (parallelism, heavy jobs), never
   *whether*; applies under Frontier Max too.
6. **Subagent Control** — hard spawn limits; Frontier/Router cannot exceed.
7. **Frontier Max** — behaviour + max effort; vetoes Router economy
   downgrades of the main loop (unless the person customises the router).
8. **No-Lazy-Exit Guard** — subordinate to 3–6 and to its own loop limits.
9. **Model Router** — acts only where nothing above constrains.
10. **Focus View** — presentation only; never changes what Claude reads.

Overview shows each system's *effective* state with the reason when it
differs from its setting (e.g. "Lazy-exit guard ● On  Paused during the handoff").
The UI's design decisions are recorded in [DESIGN.md](DESIGN.md).

## 6. Context Autopilot state machine

```
off ─enable→ armed ─(context ≥ threshold: mid-turn from turn.step usage, or after the turn)→
pending ─(main turn completes, not aborted)→ requested ─($.prompt.submit handoff prompt)→
handoff ─(handoff turn completes)→ verifying ─(NEXT_SESSION_PROMPT.md freshly written)→
clearing ─($.command.run clear; classic.SessionStart{clear}, before or after it resolves; prompt.context seeds the fresh context)→
resuming ─(continuation prompt submitted, turn starts)→ armed (new session, same run)

clearing ✗ (refused, or no fresh session in 15 s) → compacting (if allowed) → resuming
                                               → else awaiting [Start fresh context · /cr fresh]
verifying ✗ (file not written)        → one corrective prompt, then awaiting (no clear)
continuation = manual                 → awaiting after a verified handoff
aborted by the person                 → stays pending (no auto action) + HUD actions
```

The reducer (`features/autopilot.ts`) is pure: `step(model, event, cfg)`
returns the next model and a list of effects (append a notice, submit a
prompt, verify the file, clear, compact, notify), which the Runtime performs.

**Driven by events, never by timers.** Each step moves on when the turn it
is about starts or ends, never when a prompt was sent or a delay passed. A
turn is recognised as one of Project Sentinel's own (handoff, retry,
continuation) by the text it starts with (`prompts.ownPromptKind`), so a
prompt the person queued in between is never taken for it, and a reload
cannot confuse the two. Claude Code starts a plugin's prompt framed ("The
control-room plugin sent a message:" and a line break); the match looks
past that frame and accepts the prompt at the start of any of the first
three lines. (A live run found this: matching only at the very start left
the handoff waiting forever after its turn ended. Engine-driven tests now
start those turns with the framed text.) The `/clear` waits while any turn
runs, so a prompt the person queued behind the handoff finishes first. Every
step and every turn's start and end is written to Claude Code's debug log
(`$.ui.log` with `to: 'debug'`; `claude --debug-file <path>`), never on
screen.

**A reload mid-handoff.** A hot reload or `/reload-plugins` starts a fresh
Runtime, whose module memory is empty. Every step of the machine is
therefore mirrored into `$.state` (`recordOf`), which outlives a reload but
not a restart or `/clear`, so a record can only ever apply to the context it
was written in. At session start a fresh Runtime replays it (`recover`):
`pending`, `handoff` and `awaiting` resume as they were and the turn under
way moves them on; an owed check or `/clear` is carried out; a step that may
or may not have happened (`requested`: the handoff prompt about to go out;
`compacting`) waits for the person instead of being repeated. The context
crossing the threshold again never starts a second handoff.

* Threshold: exact tokens or % of the live window; clamped below Claude
  Code's own auto-compact threshold (warned in the UI).
* **Room for a fresh context** (`handoffPoint`, `roomOf`). A context after
  a handoff or a clear is *orienting* until it starts working: Project Sentinel
  sees it record its milestones or task list, edit a file or start an agent,
  or end a turn (`oriented`, with the context's size then). While orienting
  it hands off only past the threshold plus a room of 20k tokens or a tenth
  of the threshold; from where it started working it gets at least that
  room, with one notice when that moves the point. A context that fills past
  the point before any work began goes to `awaiting` instead of handing off
  again: a low threshold can never loop. Live, with a 64k threshold, a fresh
  context's first request was 44k and reading in took another 20k; without
  this, five contexts in a row did one roadmap step each.
* Pending notice is injected mid-turn with `$.session.append` (finish the
  current logical unit; do not begin another large task).
* The handoff prompt asks Claude to verify state, run minimum validation and
  leave the work in four places, each for what it is for: the run's
  milestones (the canonical run state, which Project Sentinel hands to the fresh
  context), the project's own documentation, CLAUDE.md (durable
  instructions only, never a progress log) and `NEXT_SESSION_PROMPT.md`
  (the prompt Claude would want to receive) — **without prescribing its
  contents**.
* **Handoff Health** is read when the notes are verified, from what Control
  Room counted in the handoff turn: run state saved, the milestone under way
  captured, notes written, docs updated, validation recorded, CLAUDE.md.
  **Continuity** is read when the fresh context's first turn ends: notes
  read, run state restored, the milestone picked up, docs read, work
  resumed; a toast says how it went. Both are pure (`features/handoff.ts`),
  counted from tool calls only, kept in the run record (`lastHandoff`) and
  shown in Context → *Last handoff*.
* Keep warm stands down while a handoff will clear the context (pending,
  under way, waiting for the person, or past the threshold), since `/clear`
  throws the cache away; a handoff that compacts keeps it.
* After `/clear`: `classic.SessionStart{clear}` marks the fresh context
  (and is passed on unchanged); the plugin invalidates `prompt.context`, and
  the fresh context's first message carries one block, `contextAutopilot`,
  once: the run and session numbers, where the handoff file is, and the run
  plan's milestones and objective, so the fresh context rebuilds its task
  list and work progress carries on (the policies are in the system prompt);
  the continuation prompt asks Claude to read project docs +
  `NEXT_SESSION_PROMPT.md` and continue; ask the person only for decisions
  the handoff marks as theirs.
* `/compact` is used only when `/clear` fails (and the fallback is allowed).

## 7. Feature mechanisms (summary)

* **Session Chain** — run record updated on `session.measure`, transitions
  and exit; per-session cost from `$.session.usage().cost` (resets per
  session), cumulative = Σ. Unavailable figures render as "—", never guessed.
* **Run progress** — the run plan (`features/plan.ts`) is read from Claude's
  own task list as its tools report it: TodoWrite's whole list, or
  TaskCreate / TaskUpdate / TaskList, read at `tool.call` as each call
  succeeds (a subagent's list is its own). Claude Code
  2.1.29x offers neither by default, so at session start, when
  `$.tool.list()` shows no task tool and `progress.milestones` is on,
  Project Sentinel registers `milestones` (`$.tool.register`, offered as
  `mcp__project-sentinel__milestones`) and adds a short "Run progress" policy
  section; a `tool.call` hook registered before the general one answers it
  (`fromMilestones`, the whole list each time). The plan and the objective
  (the first sentence of the person's latest substantial request) live in
  the run record, so they survive `/clear`, reloads and restarts; after a
  handoff the continuation context names the open milestones so the fresh
  context records them again. Progress is done of total, never estimated.
  `validation.ts` and `digest.ts` turn the same tool calls into Activity's
  checks, Attention, change groups and the "now" line.
* **Answer styles** — `answers.style` adds one policy section
  (`prompts.answerStylePolicy`) to the same `prompt.compose` section as the
  other policies: Brief, Simplified Technical English (after ASD-STE100's
  writing rules), Mission control or Quest log, each scoped to Claude's
  messages, never code, files or commit messages. `prompt.compose` carries
  the session's Claude Code output style (`e.outputStyle`); when the person
  chose one, `policySections(…, { nativeOutputStyle })` leaves the answer
  style out and the panel reads *Paused*. A change mid-session reaches
  Claude as a hidden note, like the other policies.
* **Quest log** — only while the style is `quest`. `features/quest.ts` is
  pure (XP per outcome, levels at 50·n·(n−1), achievements); the Runtime
  decides when an outcome happened: a milestone newly marked done (paid
  once per run, keyed by its subject), a whole plan of three or more done,
  a check's first pass per kind per turn or a pass after a failure
  (`questForCheck`), and a handoff whose notes were verified. Nothing is
  paid for activity (lines, files, tool calls) or for Claude's words.
  Toasts announce achievements and level ups; Activity draws the Quest
  card and the status bar the level.
* **Frontier Max** — `prompt.compose` session section (stable text → one
  cache miss per toggle, none while *Keep policies stable* holds a warm
  cache) with automatic `prompt.submit` context fallback;
  `turn.step` effort `max` where the step carries an effort (never invented
  for models without one); auto-enables the guard via profile.
* **No-Lazy-Exit Guard** — `classic.Stop`: heuristic scoring of the last
  message against the last request; optional low-effort model classification
  (`complete / blocked / needs_user / optional_only / premature`) only when
  heuristics are unsure; `{ block }` with the specific unfinished items;
  per-turn and per-session caps, `stop_hook_active` respected, suspended by
  autopilot handoff, aborts, plan mode, background work in flight.
* **Model Router** — off by default. Subagent model selection via
  `agent.spawn` (cache-neutral; aliases, which the engine resolves);
  main-loop routing decided once per turn (never per step), only while the
  switch is cheap (≤ 60k context unless upgrading hard work), a small-window
  model only under 150k, never downgrading under Frontier Max, and only to a
  full model id the engine has reported answering in this session (`usage.model`
  of any main or subagent step), because a request with a bare alias fails.
  A refused model's family is disabled for the session.
* **Subagent Control** — off by default; Off (offer hidden + spawn denied),
  Ask (`$.ui.ask`, fails closed headless), Max N (live count from
  `$.agent.list()`), Unlimited.
* **Focus View** — compact one-line tool rows, hidden results and inline
  diffs by default when on; reveal per Focus toggle, the Activity tab and
  Activity → Changes (per-file hunks from `structuredPatch`, `<Code format="diff">`).
  Spinner shows `Working · 27 tools · 6 files changed · tests running`.
* **Resource Governor** — one sampler process per platform (Windows
  P/Invoke→CIM fallback, macOS `top` + `kern.memorystatus_level`, Linux
  `/proc` reads, no process). Pressure from a sliding window; policy section
  per level; `$.session.append` notices on transitions and on level changes;
  heavy-command classifier on shell tools denies *additional* heavy jobs
  under pressure; lists only Claude-launched background tasks (stop on the
  person's press via `TaskStop`). No OS-level quotas are claimed.
* **Permission Policy** — categories (install, network, download, edit,
  outside-project edit, delete, commit, push, destructive git, deploy/publish,
  catastrophic commands); states Default / Ask / Deny (Allow removed in
  1.4.0; a saved Allow reads as Default). Both decided in `tool.call` before
  `next`: Deny answers `{ deny }`; Ask reads Claude Code's own verdict
  (`$.tool.check`) and, where Claude Code would not ask, asks in its
  question dialog (`$.ui.ask`) and passes the call on after a yes. Nothing
  answers a permission check. Shell commands are tokenized and every segment
  classified; the strictest wins.
* **Profiles** — Normal, Frontier Max, Low Resource, Release/QA + custom;
  shown as an explicit diff; individual overrides mark the profile modified.
* **Cache Guardian** — `turn.step` hands each main-thread request's usage to
  `CacheGuardian` (`app/cacheGuardian.ts`), and `features/cache.ts` decides
  what it means: a request that reads less than half of the prompt the one
  before it sent missed the cache (prompts under 4,096 tokens are ignored).
  The cause is the change seen before it, in order: compaction (expected),
  a model switch (by the person, the engine, or the router), changed
  policies, the output style, the tools offered (`$.tool.list` at each turn
  start), an effort change; else idling past the lifetime; else
  *unexplained*. A change made after the cache had surely lapsed is not
  blamed. The lifetime is the engine's (PreModelSwitch / PostModelSwitch
  report it), else observed: a hit after more than five idle minutes proves
  the hour, a lapse inside the hour with nothing else to blame points to
  five minutes. Every cache figure is timed by `Runtime.clock()`.
  **Keep warm** (off by default) plans one refresh at a time
  (`nextRefresh`): a sixth of the lifetime before the expiry, between one
  and ten minutes; with the lifetime unknown, one probe at six idle
  minutes. It refreshes only while the person is away (no turn running),
  the context is worth keeping (`cache.minTokens`, 20k), no handoff is about
  to clear it, and the idle limit is not reached (`cache.maxIdleMinutes`,
  capped at 45 for the five-minute cache, past which refreshing costs more
  than one rebuild). A refresh is `$.model.fork` with a one-word answer
  asked for. It checks itself: the first request after the expiry a
  refresh replaced must still read the cache; if it does, Keep warm is
  verified, and if it does not, Keep warm stops, as it does after two
  refreshes sent in time that found the cache gone. The verdict is kept in
  `cache.v1` until the person turns Keep warm on again. *Ask before a model
  switch* answers PreModelSwitch with `ask` when a switch the person makes
  would re-send 100k or more warm tokens. *Keep policies stable* holds
  Project Sentinel's system-prompt section while the cache is warm and sends a
  setting change as a hidden note instead (and a second note when the
  settings go back). An effort change on a model where one was seen to
  rebuild the cache is announced. The router does not downgrade the main
  conversation while 20k or more tokens are warm.
* **Kit** — `features/companion.ts` is pure: a mood from the status bar's
  state and the time (`moodOf`) and the props for Kit's module
  (`companionView`: the mood and its caption, the calm switches, whether a
  turn runs, the local hour, the context's start and whether it is fresh,
  and four signals the module compares with what it last saw: milestones
  done, a green finish, failed checks, a Keep warm refresh). In the terminal
  and on Desktop `register.tsx` draws `<ui.Client key="kit"
  module="./kit.client.tsx" />` with those props and the surface.
  `hooks/kit.client.tsx` holds a behaviour model of pure functions
  (`createKit`, `stepKit`, `touchKit`, `resizeKit`, `drawableOf`): the act
  under way, a queue planned with transitions (a cursor of posture, facing
  and place, so stand ⇄ sit ⇄ down and every turn get their frames), a
  settled mood (1.2 s to settle, 2.5 s to hold, priority moods at once), a
  seeded generator, the reactions left in this round, the touches. Its
  renderers: `terminalSprite` + `terminalLane` (20 × 10 letters, five rows
  of half blocks, glyphs beside Kit on empty cells only) and
  `desktopSprite` + `desktopLane` + `desktopSvg` (a rig of ellipses and
  triangles rasterized to 40 × 24 art pixels, shaded from the top left and
  outlined between layers, props and particles as bitmaps, one path per
  color). The glue ticks the model on the surface's clock (100 ms on
  Desktop, 200 ms in the terminal), redraws only when the drawn frame's key
  changes (at most every 500 ms on a busy processor), remembers per surface
  where the last Kit stood (a new instance appears there) and which
  contexts it has walked into (an entrance plays once), and posts
  `{ fault }` if anything throws (`ui.message` → Kit left out until the
  plugin reloads). VS Code, which draws no `Client`, shows `kitStillSvg`.
  While Kit is on, a one-minute tick lets its mood move on with time.
* **Git** — terminal only (Desktop shows Git natively): `$.session.repo()`
  once, then `git status --porcelain=v1 --branch` at session start and after
  each turn, at most every 15 s, read-only, with a 10 s timeout;
  `features/git.ts` keeps the branch, ahead and behind, and the counts of
  changed and untracked files (no paths). Overview's run header and
  `/cr status` show it.

## 8. Failure handling

Every gating hook has a `.catch` that falls back to the engine's own
behaviour (never looser than without Project Sentinel). Store corruption →
defaults with a one-time notice. Sampler failure → monitoring "unavailable"
while the static policy still applies. Clear failure → compact fallback or
the START FRESH CONTEXT action. Model classification failure → heuristics
only. Unknown future events/props → passed through untouched.

## 9. Testing strategy

* `claude plugin test` (273 tests in 22 files, run on 2.1.293, and in CI on the latest
  Claude Code for Linux, Windows and macOS and on 2.1.289 for Linux). The
  tests live in the repository's `tests/`, outside the plugin folder (which
  Anthropic's directory scans, and which ships only the plugin);
  `tools/test/mod.mjs` copies the plugin and `tests/` into `.build/mod` and
  runs `tsc` and `claude plugin test` there. Suites:
  pure-logic suites (settings, profiles, permissions classifier, guard
  heuristics, resource parsers, Autopilot reducer, router, chain, activity,
  the cache model, handoff health and continuity, the former store's
  carry-over, Kit's moods, its behaviour model and both renderers, Git's
  parser),
  Cache Guardian over the in-memory host (`guardian.test.ts`: Keep warm's
  schedule, refresh, self-check and stand-down),
  a Runtime suite over an in-memory host with a manual clock, and
  engine-driven suites (`$.session.start`, `$.tool.call` (Ask's question and Deny),
  `$.agent.spawn`, `$.classic.Stop`, `$.prompt.compose`, `$.turn.step`, the
  Autopilot `/clear` in both orderings, and `$.ui.mount` on `terminal`,
  `desktop` and `mobile`, including the rule that a row never repeats its
  card's title) with the world answered beneath the mod. Engine-driven tests
  start Project Sentinel's own turns with the text framed as Claude Code frames a
  plugin's prompt, since the test kit passes the bare text.
* `tsc` against the engine-written declarations of 2.1.293 (and earlier of
  2.1.292 and 2.1.289).
* `claude plugin validate --strict` (plugin) and `claude plugin validate .`
  (marketplace), and `tools/test/source.mjs`: the source rules Anthropic's
  directory reads (no local `h`/`Fragment`, no `name('!', VALUE)` calls, no
  accessors, no tests in the plugin folder, every `Client` with a fixed
  path).
* Live headless stream-json runs (the Desktop host protocol) of the final
  plugin: the full Autopilot chain on 2.1.292 and 2.1.289; Permission Deny,
  subagent block, Router learning and routing, and the Windows sampler on
  2.1.292; a live resource-pressure notice that Claude acted on (2.1.289).
* Terminal UI in a real console (Windows conhost at 150, 120 and 100
  columns, docked and in the frame above the prompt): the status bar and
  every panel section read back from the screen buffer, driven with injected
  keyboard and mouse input (Tab order, focus ring, Enter, Esc, in-place
  pickers, saving and deleting a profile), including hot reload. The full
  Autopilot chain ran in the interactive terminal on 2.1.292: mid-turn
  crossing, handoff notes, *Wait for me*, Start fresh, continuation.
* Install from the folder marketplace into an isolated Claude Code config,
  and a session loading the installed copy.
* The 1.1.0 status bar (both lines, 150 columns and docked at 78), Activity's
  charts, the answer style picker and the Quest log in a real console, during
  a turn from `tools/demo`: its `turn.step` hook answers each model step from a
  script, so Claude Code runs every tool call inside a genuine turn (the
  `milestones` tool included) without a model or a login.
* 1.2.0 in a real console (150 columns, docked and full width): the status
  bar with Kit, Overview's lifecycle cards, Context's Cache card and Cache
  health, `/cr cache` and Activity, during the demo driver's turn with a
  scripted model switch (`/demo miss`); the Git line in a throwaway
  repository, before and after a turn.
* 1.3.0 live on 2.1.293 with real models (Sonnet 5.5, Opus 5.5), in
  consoles, each test session loading a renamed copy of the plugin
  (`cr-test`) so its settings live in a store of its own: Autopilot end to
  end in four runs, traced step by step with `--debug-file` (two bugs found
  and fixed: the framed handoff prompt, and a fresh context handing off
  after every step); Keep warm on the 1-hour cache (two refreshes moved the
  engine's expiry; a prompt 66 minutes after the last one hit) and on the
  5-minute cache (the probe learned it; refreshes every four minutes; a
  prompt after a replaced expiry hit), each verified by its own self-check;
  Project Sentinel's derived figures against the status line's `prompt_cache`;
  a model switch confirmed first and declined, then made; policy and effort
  changes while warm. The 1.3.0 status bar and every panel section in a real
  console at 80, 100 and 150 columns during the demo driver's turn.
* The Desktop layout through `tools/desktop-preview`: the status bar's and
  the panel's `desktop` element trees rendered as HTML with the CSS the
  app's own renderer gives them, the bar at 512 to 960 pixels.
* 1.3.0 inside the Claude Desktop app (2.26454): the person's review of
  rc.5 (screenshots), then rc.6 installed and loaded by a fresh session,
  captured read-only from the app's window (`PrintWindow`, no input sent):
  the status bar's four cells while Claude works and after the turn, Kit
  at its new size, and Overview with the cache's dot and Now's mark on its
  first line. Kit's seams at a 125% display scale were reproduced in
  headless Chrome and fixed there.
* Not yet done: the answer styles with a real model, and live sampling on
  macOS and Linux.
