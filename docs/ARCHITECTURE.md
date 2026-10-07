# Control Room — Architecture & Implementation Plan

Status: implemented (see `CHANGELOG.md`). This document is the design record:
what the platform verifiably supports, how Control Room is built on it, and
why each decision was made. Written before implementation, kept current.

Target platform: Claude Code function-hooks plugins ("mods"), verified on
**2.1.289** (the engine bundled with Claude Desktop on this machine) and
**2.1.292** (terminal CLI). The mods API is early access; the generated
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
| **Status bar** (persistent) | `ui.render` `AbovePrompt` band, yields to surveys; or `$.ui.status` | ✅ | ✅ |
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
    publisher.ts                  coalesced, diffed writes of those projections to $.state (+ status line)
    commands.ts / actions.ts      /cr sub-commands; the panel's actions
    persist.ts                    store reads/writes (settings, runs, index), debouncing, pruning
    monitor.ts                    resource sampler lifecycle (spawn, parse, restart, stop)
  hooks/core/
    settings.ts                   schema, defaults, normalisation (clamps, high-risk allow → ask)
    profiles.ts                   built-in + custom profiles, labelled diffs
    policy.ts                     effective() snapshot (the priority system) + system-prompt sections
    format.ts / text.ts / version.ts
  hooks/features/
    autopilot.ts                  threshold maths + pure state machine (events → model + effects)
    chain.ts                      run + session records, totals (reported costs only)
    guard.ts                      premature-exit heuristics, thresholds, repeat detection
    router.ts                     task classes, tables, main/subagent routing, model families
    subagents.ts                  spawn decisions, live counts
    activity.ts                   tool-call tracker, changed files and hunks, summary line
    prompts.ts                    every text Control Room gives Claude
    permissions/                  shell tokenizer, category classifier, decisions + invariants
    resources/                    samplers + parsers (Windows/macOS/Linux), pressure, heavy commands
  hooks/ui/                       design system (primitives.tsx, theme.ts, kit.ts), status bar (hud.tsx),
                                  Focus view rows, pane/ (frame + overview, context, behavior,
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
| Live session | module memory (`Runtime`) | `/clear` (module stays loaded) | context, cost, autopilot machine, guard counters, activity, changes, resources, agents, learned model ids |
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

* Threshold: exact tokens or % of the live window; clamped below Claude
  Code's own auto-compact threshold (warned in the UI).
* Pending notice is injected mid-turn with `$.session.append` (finish the
  current logical unit; do not begin another large task).
* The handoff prompt asks Claude to verify state, update existing project
  docs/handoff files, record unfinished work, run minimum validation and
  create/update `NEXT_SESSION_PROMPT.md` — **without prescribing its
  contents**.
* After `/clear`: `classic.SessionStart{clear}` injects the continuation
  context (run/session numbers, active policies, where the handoff file is);
  the continuation prompt asks Claude to read project docs +
  `NEXT_SESSION_PROMPT.md` and continue; ask the person only for decisions
  the handoff marks as theirs.
* `/compact` is used only when `/clear` fails (and the fallback is allowed).

## 7. Feature mechanisms (summary)

* **Session Chain** — run record updated on `session.measure`, transitions
  and exit; per-session cost from `$.session.usage().cost` (resets per
  session), cumulative = Σ. Unavailable figures render as "—", never guessed.
* **Frontier Max** — `prompt.compose` session section (stable text → one
  cache miss per toggle) with automatic `prompt.submit` context fallback;
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

## 8. Failure handling

Every gating hook has a `.catch` that falls back to the engine's own
behaviour (never looser than without Control Room). Store corruption →
defaults with a one-time notice. Sampler failure → monitoring "unavailable"
while the static policy still applies. Clear failure → compact fallback or
the START FRESH CONTEXT action. Model classification failure → heuristics
only. Unknown future events/props → passed through untouched.

## 9. Testing strategy

* `claude plugin test` (127 tests, run on both 2.1.292 and 2.1.289):
  pure-logic suites (settings, profiles, permissions classifier, guard
  heuristics, resource parsers, Autopilot reducer, router, chain, activity),
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
* Not yet done: visual review inside the Claude Desktop app (needs the
  person's hot-reload approval or an install), and live sampling on macOS
  and Linux.
