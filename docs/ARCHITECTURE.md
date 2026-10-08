# Control Room — Architecture & Implementation Plan

Status: implemented (see `CHANGELOG.md`). This document is the design record:
what the platform verifiably supports, how Control Room is built on it, and
why each decision was made. Written before implementation, kept current.

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
| Automatic `/clear` | `$.command.run({ command: 'clear' })` from a `$.clock.after` timer after `turn.complete` | ✅ Host protocol (Desktop): `session.end{reason:'clear'}` → new session id → `classic.SessionStart{source:'clear'}` → promise resolves; the stream emits `conversation_reset`. ⚠ Interactive terminal: the promise resolves *first* and the reset follows. Control Room therefore waits for `classic.SessionStart{clear}` (up to 15 s, else a changed session id) before it continues. |
| Inject context into the fresh window | `classic.SessionStart` (source `clear`) answering `additionalContext` | ✅ fresh-context model quoted the injected marker verbatim |
| Resume autonomously | `$.prompt.submit({ text })` after the clear resolves | ✅ turn starts by itself, framed as "The control-room plugin sent a message" |
| `$.state` across `/clear` | — | ⚠ **reset** by `/clear` (version back to 0). Module memory survives `/clear`; `$.store` survives everything. |
| Mid-turn policy updates (no user prompt) | `$.session.append({ message: { type: 'user', content } })` during a running turn | ✅ stored as a hidden (`isMeta`) user row and read on the very next model request |
| Continue a premature stop | `classic.Stop` answering `{ block }` | ✅ model continued in the same turn; 2nd Stop carries `stop_hook_active: true` |
| Subagent enforcement | `agent.spawn` answering `{ deny }` | ✅ model receives "Subagent spawn denied by a plugin: …" |
| Force approval | `tool.check` answering `{ decision: 'ask' }` | ✅ tightens an `allow` rule; **holds in `bypassPermissions` mode**; headless with no approver → "needs approval" |
| Per-request effort | `turn.step` → `next({ ...e, effort: 'max' })` | ✅ accepted (Sonnet 5.5 default `medium` → sent `max`); `e.effort` is absent for models without effort (Haiku) |
| Live context / cost | `session.measure` (pushed after every main turn) + `$.session.usage()` | ✅ `context.tokens/window/percent`, `cost.usd`, `rateLimits` |
| Host CPU/RAM | `$.process.spawn` of one long-lived sampler | ✅ Windows P/Invoke sampler: ~0.5 s CPU / 30 s incl. start-up, ~80 MB; one-shot probes cost ~2.4 s each (rejected). Verified live through the final plugin on 2.1.289 and 2.1.292. |
| Model per request | `turn.step` → `next({ ...e, model })` | ⚠ **full ids only**: a bare alias (`haiku`) fails the turn on 2.1.292 (`unrecognized_model` → `model_fallback` → an error answer). Ids reported in `usage.model` (main and subagent steps) work. Subagent spawns *do* resolve aliases. |
| Store scope | `$.store` | One store per plugin name and source (`~/.claude/plugins/store/<name>_<source>-<hash>.json`); every `--plugin-dir` load of `control-room` shares one. |
| Prompt cache figures | `turn.step` answer `usage` (`input_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`, `model`) for each main-thread request | ✅ in the engine harness and live. ⚠ Claude Code keeps its own tracker (expiry, hit ratio, misses and their causes), but hands it only to the **status line** (`prompt_cache` in its input), never to a mod: `$.session.usage()` has context, rate limits and cost only. So Control Room derives the same figures from the usage and names them as derived. Checked live against the status line's `prompt_cache` (1-hour cache, Sonnet 5.5): the derived expiry within a second of the engine's, the hit ratio identical (0.62185) once Keep warm's refreshes are left out of it, as the engine leaves them. |
| Cache lifetime and a confirmed model switch | `classic.PreModelSwitch` (`prompt_cache_warm`, `cache_ttl`, `context_tokens`, `estimated_cache_write_usd`) answering `permissionDecision: 'ask'` with a reason; `classic.PostModelSwitch` (`from_model`, `to_model`, `cache_ttl`, `source`) | ✅ live on 2.1.293 (143k warm, Sonnet → Opus): Claude Code asks "Switch model?" with the hook's reason and Yes / No; declining keeps the model and the cache. ⚠ The reason is drawn on one line and cut at the terminal's width, so it is kept short. After the switch, the lifetime as Claude Code reports it, and the rebuild named as Claude Code names it (model and effort changed, 143k re-cached). |
| Keep the cache warm | `$.model.fork({ prompt })` from a `$.clock.after` timer | ✅ live on 2.1.293 (Sonnet 5.5, 1-hour cache): a fork re-sends the main thread's last request plus one user message, never added to the transcript (0 rows), and returns the request's usage. The engine counts a fork that reads the cache as a *touch*, not a request: its own expiry moved 05:38 → 05:44 → 06:34 with each refresh (requests stayed 2). A real prompt 66 minutes after the last one, past the expiry the refreshes replaced, read the cache (0 misses), and Keep warm marked itself verified. Each refresh of an 87k context cost about $0.02. On a 5-minute cache too: the probe learned the lifetime (it found the cache gone, as a probe past five minutes must), refreshes every four minutes read the whole 141k, and a prompt after a replaced expiry hit. ⚠ Claude Code's own tracker touches the expiry only for a fork that *reads* the cache, so after a probe that rebuilt it the status line says cold while the cache is warm (the next refresh read all of it). `nothing-to-fork` before the first response. |
| A drawing with its own clock | a `Client` element naming a surface module (`module` must be a string literal in `register.tsx`); the module gets `surface.every`, `setState`, `onPointer`, `post`; `ui.message` carries its posts to the hooks module, `ui.fault` reports a module that failed | ✅ terminal, live in a real console (Kit). Desktop draws an SVG instead. |
| Graphics on Desktop | `Svg` with `source`, `alt`, `width`, `height`; `isInteractive` draws it in a script-less sandboxed frame instead of an image | ⚠ A frame with no `width` takes the browser's default (300 px), and a frame whose color scheme differs from the page's is painted opaque: 1.2.0's animated work track showed as a white bar on Desktop. SMIL animates inside a plain image too (checked in Chromium). So Control Room draws every graphic as an image with an explicit size and never asks for a frame. |
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
  `deny`**; `sec-default` enforces this where seated and Control Room
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
plugins/control-room/
  .claude-plugin/plugin.json      manifest (types → ./types/index.d.ts)
  hooks/hooks.json                { "modules": ["./register.tsx"] }
  hooks/register.tsx              Host adapter (hostOf) + every on(...) registration (thin)
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
  hooks/core/
    settings.ts                   schema, defaults, normalisation (clamps, high-risk allow → ask)
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
    companion.ts                  Kit: moods from the status bar's state, pixel frames, the Desktop SVG
    git.ts                        `git status --porcelain=v1 --branch` parsed into a line
    prompts.ts                    every text Control Room gives Claude (answer-style policies included)
    permissions/                  shell tokenizer, category classifier, decisions + invariants
    resources/                    samplers + parsers (Windows/macOS/Linux), pressure, heavy commands
  hooks/ui/                       design system (primitives.tsx, theme.ts, kit.ts), status bar (hud.tsx),
                                  Kit's surface module (companion.client.tsx), Focus view rows,
                                  pane/ (frame + overview, context with cache and handoff, behavior,
                                  guardrails, activity, setup)
  types/index.d.ts                settings schema + PluginState contract (render view models)
  tests/                          claude plugin test suites + fixtures (fake host, engine world)
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
clearing ─($.command.run clear; classic.SessionStart{clear}, before or after it resolves, seeds the context)→
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
turn is recognised as one of Control Room's own (handoff, retry,
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
  a handoff or a clear is *orienting* until it starts working: Control Room
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
  milestones (the canonical run state, which Control Room hands to the fresh
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
* After `/clear`: `classic.SessionStart{clear}` injects the continuation
  context (run/session numbers, active policies, where the handoff file is,
  and the run plan's open milestones so the fresh context rebuilds its task
  list and work progress carries on);
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
  Control Room registers `milestones` (`$.tool.register`, offered as
  `mcp__control-room__milestones`) and adds a short "Run progress" policy
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
  catastrophic commands); states Default / Allow / Ask / Deny; deny at
  `tool.call`, ask/allow at `tool.check`; `allow` only upgrades an engine
  `ask` (never a `deny`, never in plan mode) and is unavailable for
  high-risk categories. Shell commands are tokenized and every segment
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
  Control Room's system-prompt section while the cache is warm and sends a
  setting change as a hidden note instead (and a second note when the
  settings go back). An effort change on a model where one was seen to
  rebuild the cache is announced. The router does not downgrade the main
  conversation while 20k or more tokens are warm.
* **Kit** — `features/companion.ts` is pure: a mood from the status bar's
  state and the time (`moodOf`), and its animation (`animationOf`: pixel
  frames, palette, pace; one frame and no pace under Reduce motion, at most
  two frames a second on a busy machine). In the terminal, `register.tsx`
  draws a `Client` naming `ui/companion.client.tsx`, which plays the frames
  as half blocks on its own clock and posts `{ open: true }` on a click
  (`ui.message` → toggle the panel); a `ui.fault` leaves Kit out until the
  plugin reloads. Desktop draws `svgCompanion` as a plain image of a fixed
  size (280 × 48 px) that animates itself with SMIL, above the headline.
  While Kit is on, a one-minute tick lets its mood move on with time.
* **Git** — terminal only (Desktop shows Git natively): `$.session.repo()`
  once, then `git status --porcelain=v1 --branch` at session start and after
  each turn, at most every 15 s, read-only, with a 10 s timeout;
  `features/git.ts` keeps the branch, ahead and behind, and the counts of
  changed and untracked files (no paths). Overview's run header and
  `/cr status` show it.

## 8. Failure handling

Every gating hook has a `.catch` that falls back to the engine's own
behaviour (never looser than without Control Room). Store corruption →
defaults with a one-time notice. Sampler failure → monitoring "unavailable"
while the static policy still applies. Clear failure → compact fallback or
the START FRESH CONTEXT action. Model classification failure → heuristics
only. Unknown future events/props → passed through untouched.

## 9. Testing strategy

* `claude plugin test` (217 tests in 20 files, run on 2.1.292 and 2.1.289, and in CI on the latest
  Claude Code for Linux, Windows and macOS and on 2.1.289 for Linux):
  pure-logic suites (settings, profiles, permissions classifier, guard
  heuristics, resource parsers, Autopilot reducer, router, chain, activity,
  the cache model, handoff health and continuity, Kit's moods, Git's parser),
  Cache Guardian over the in-memory host (`guardian.test.ts`: Keep warm's
  schedule, refresh, self-check and stand-down),
  a Runtime suite over an in-memory host with a manual clock, and
  engine-driven suites (`$.session.start`, `$.tool.call`, `$.tool.check`,
  `$.agent.spawn`, `$.classic.Stop`, `$.prompt.compose`, `$.turn.step`, the
  Autopilot `/clear` in both orderings, and `$.ui.mount` on `terminal`,
  `desktop` and `mobile`, including the rule that a row never repeats its
  card's title) with the world answered beneath the mod.
* `tsc` against the engine-written declarations of 2.1.292 and 2.1.289.
* `claude plugin validate --strict` (plugin) and `claude plugin validate .`
  (marketplace).
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
* Not yet done: visual review of 1.1.0 and 1.2.0 inside the Claude Desktop
  app (1.0.1 and 1.0.2 were reviewed from the person's screenshots), Keep
  warm against the live API, a live `/model` switch with a warm cache, the
  `milestones` tool and the answer styles with a real model, and live
  sampling on macOS and Linux.
