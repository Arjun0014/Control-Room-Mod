# Configuration

Everything is configured from the Control Room panel (`/cr`) or with `/cr` sub-commands. Settings
apply immediately, are saved within a couple of seconds, and are used by every later session.
Claude is told about material changes mid-session (Frontier Max, Release check, the subagent policy,
machine load). The updated policy reaches the system prompt from its next request.

## Where settings live

Claude Code gives every plugin its own store, a JSON file under `~/.claude/plugins/store/`.
Control Room keeps `settings.v1` (settings and custom profiles), its run records and what it
learned about the prompt cache (`cache.v1`) there. The
store is validated on load: unknown values fall back to defaults, numbers are clamped to the
ranges below, and a high-risk permission set to `allow` is repaired to `ask`. Hand-editing is
possible but not needed. `/cr reset confirm` restores the defaults and keeps custom profiles.

The settings are global to your user account, not per project. Run records note the project
they ran in.

## Reference

### Autopilot (`autopilot`)

In the panel: **Context**.

| Setting | Values | Default | Notes |
| --- | --- | --- | --- |
| `enabled` | on / off | off | `/cr autopilot on\|off` |
| `thresholdMode` | `percent` / `tokens` | `percent` | |
| `thresholdPercent` | 10–95 | 70 | Percent of the live context window |
| `thresholdTokens` | 10,000–10,000,000 | 700,000 | `/cr autopilot 700k` |
| `continuation` | `clear` / `compact` / `manual` | `clear` | `clear` is preferred. `manual` writes the handoff and waits for **Start fresh context** (`/cr fresh`). |
| `fallbackToCompact` | on / off | on | Compact only if `/clear` is refused |
| `autoContinue` | on / off | on | Submit the continuation prompt automatically in the fresh context |
| `handoffFile` | a relative path inside the project | `NEXT_SESSION_PROMPT.md` | Paths that would leave the project are rejected |

The effective threshold is capped at 97% of the window. It is also kept below Claude Code's own
auto-compact point (minus 5% of the window), so the handoff runs before Claude Code would
compact. The Context section says when this clamp applies.

### Frontier Max (`frontier`)

In the panel: **Behavior**.

| Setting | Values | Default | Notes |
| --- | --- | --- | --- |
| `enabled` | on / off | off | `/cr frontier on` also turns the guard on |
| `effort` | `max` / `xhigh` / `high` / `keep` | `max` | Sent only to models that take an effort setting. `keep` leaves the session's effort alone and applies only the policy. |
| `subagentEffort` | on / off | off | Also raise subagents' effort (costs more) |

### Release check (`qa`)

| Setting | Values | Default | Notes |
| --- | --- | --- | --- |
| `enabled` | on / off | off | A verification-first policy: test before claiming, report what was and was not verified |

### Lazy-exit guard (`guard`)

| Setting | Values | Default | Notes |
| --- | --- | --- | --- |
| `enabled` | on / off | off | |
| `strictness` | `lenient` / `standard` / `strict` | `standard` | How much evidence of a premature stop is needed |
| `maxPerTurn` | 1–5 | 2 | Continuations within one turn |
| `maxPerSession` | 1–50 | 12 | Continuations per session |
| `modelCheck` | on / off | on | *Smart check*: one small classification through Claude Code's client, only when the heuristics are unsure |

The guard only judges turns you started (and Autopilot continuations). It stands down during a
handoff, in plan mode, while background work Claude started is still running, and when Claude
repeats the answer it was just continued from.

### Model router (`router`)

| Setting | Values | Default | Notes |
| --- | --- | --- | --- |
| `strategy` | `off` / `balanced` / `performance` / `economy` / `custom` | `off` | |
| `mainLoop` | on / off | on | Route the main conversation per turn (see below) |
| `subagents` | on / off | on | Route subagents by type |
| `custom.*` | `session` / `haiku` / `sonnet` / `opus` / `fable` per class | see below | `trivial`, `simple`, `standard`, `hard`, `explore`, `plan`, `general` |

Built-in tables:

| Class | Balanced | Performance | Economy |
| --- | --- | --- | --- |
| trivial (acknowledgements) | haiku | sonnet | haiku |
| simple (lookups, short questions) | sonnet | session | haiku |
| standard (implementation) | session | session | sonnet |
| hard (design, debugging, analysis) | session | fable | session |
| Explore subagents | haiku | sonnet | haiku |
| Plan subagents | session | opus | sonnet |
| other subagents | sonnet | opus | haiku |

Rules:

- The main conversation is routed once per turn, never mid-turn. It is routed only while the
  context is small (60k tokens or less), except for upgrades on hard work. A smaller-window model
  is only chosen under 150k tokens.
- It is routed only to a model whose full id Claude Code has reported answering in this session.
  Claude Code rejects a bare alias on a model request.
- Frontier Max vetoes downgrades unless the strategy is Custom. Subagents never go below Sonnet
  under Frontier Max.
- A model that Claude Code refuses is not chosen again in that session.
- Forks inherit the parent's model, and a model Claude chose explicitly for a subagent is respected.

### Run progress (`progress`)

In the panel: **Behavior → Run progress**.

| Setting | Values | Default | Notes |
| --- | --- | --- | --- |
| `milestones` | on / off | on | Where Claude Code offers no task list of its own, give Claude a small `milestones` tool and ask it to record the run's steps, so Activity and the status bar can count them |

Run progress is counted from Claude's task list: TodoWrite or the Task tools where Claude Code
offers them, else Control Room's `milestones` tool. Where a task list exists, nothing is added
and Behavior reads *Automatic*. Off, Claude is offered no tool and no progress is shown.
Switched on mid-session, the tool is offered at once. Switched off mid-session, the policy goes
and Claude is told; a tool already offered stays until the session ends, and answers that
tracking is off. Progress is milestones done of the total Claude listed, never an estimate, and
it carries across handoffs.

### Answer style (`answers`)

In the panel: **Behavior → Answer style**.

| Setting | Values | Default | Notes |
| --- | --- | --- | --- |
| `style` | `standard` / `brief` / `ste` / `mission` / `quest` | `standard` | How Claude writes its messages to you. `/cr style <name>` |

| Style | In the panel | What Claude is asked to do |
| --- | --- | --- |
| `standard` | Standard | Nothing: Claude Code's own way |
| `brief` | Brief | The bottom line first, then only what you need to act on it. Code, commands, paths and error text stay exact; failures and anything unverified are still said. |
| `ste` | Plain technical | Simplified Technical English, after the writing rules of ASD-STE100: one instruction per sentence of at most 20 words, descriptions of at most 25, active voice, simple tenses, one word for one meaning. It does not check the STE dictionary. |
| `mission` | Mission control | A status call first (GO, NO-GO or HOLD, with its reason), a short board of the areas touched, then `NEXT:` with the next action and its owner. GO only for what was verified. |
| `quest` | Quest log | Short log entries (the step, the obstacle, the outcome) and the next quest step. Control Room keeps the XP, levels and achievements; Claude is told never to state them. |

A style governs Claude's messages only, never code, commands, file contents or commit messages.
`/cr style` also takes `default`, `short`, `plain` and `game`. The style is part of a profile; the
built-in profiles use Standard. Changed mid-session, Claude is told at its next request.

When you have chosen one of Claude Code's own output styles (`/config`), that style is in charge:
Control Room adds no answer-style rules, and Behavior reads *Paused* until you set it back to
Default.

**Quest log XP.** Only outcomes Control Room counts itself earn XP: a milestone Claude marked done
(50, once per run), a check's first pass in a turn (10), a check passing again after failing (30),
every milestone of a plan of three or more done (100), and an Autopilot handoff with verified notes
(40). Level *n* starts at 50·*n*·(*n*−1) XP: 0, 100, 300, 600, 1,000. Achievements: *First green*,
*Comeback*, *Full clear*, *Clean handoff*, *Relay* (one run across three contexts) and *Long haul*
(ten milestones in one run). XP and achievements are kept across sessions in the plugin store
(`quest.v1`) and are earned only while the Quest log style is chosen.

### Prompt cache (`cache`)

In the panel: **Context → Cache**. `/cr cache` shows it in words.

| Setting | Values | Default | Notes |
| --- | --- | --- | --- |
| `keepWarm` | on / off | off | *Keep warm while you are away*: refresh the cache shortly before it lapses by re-sending the last request (see below). `/cr cache keep on\|off` |
| `maxIdleMinutes` | 15–480 | 120 | *Stop after*: how long Keep warm holds the cache while you have not come back. The panel steps through 15, 30, 45 minutes, 1, 1.5, 2, 3 … 8 hours; `/cr cache idle 45m` or `idle 2h` takes any value in range. The five-minute cache stops at 45 minutes whatever is set: past that, refreshing it costs more than one rebuild. |
| `minTokens` | 5,000–1,000,000 | 20,000 | Keep warm leaves a smaller context alone (starting it cold costs little), and *Keep policies stable* holds only a cache at least this large. Not in the panel. |
| `guardModelSwitch` | on / off | on | *Ask before a model switch*: a switch you make (`/model`, the model picker) that would re-send 100k or more warm tokens is confirmed first, with Claude Code's own estimate of what it costs. `/cr cache guard on\|off` |
| `stablePolicies` | on / off | on | *Keep policies stable*: while the cache is warm, a setting you change reaches Claude as a note, and the system prompt keeps the policies it was cached with until the cache lapses or the context starts fresh. Off, every change rewrites the system prompt, which rebuilds the whole cache. `/cr cache stable on\|off` |

Claude Code reports how many tokens each request read from the cache and wrote to it. From those
Control Room derives the rest: a request that read less than half of what the one before it sent
missed the cache, and the change it saw before it is the cause (a model or effort switch, the
model router's switch, changed policies, the output style, a new tool, compaction), else idling
past the cache's lifetime, else *unexplained*. The lifetime is the one Claude Code reports at a
model switch, or learned: a request that still read the cache after more than five idle minutes
proves the one-hour cache. It is remembered across sessions.

**Keep warm** refreshes only while you are away (no turn running), the context is at least
`minTokens`, no handoff is about to clear the context, and the idle limit has not passed. It
refreshes a sixth of the lifetime before the expiry (ten minutes ahead for the one-hour cache, one
minute for the five-minute one); with the lifetime unknown, one refresh six minutes after the
last request learns it. A refresh asks Claude Code to re-send the last request with a one-word
reply asked for; the transcript never sees it, and it costs tokens (mostly cache reads at a tenth
of the input price, plus the short reply). It checks itself: the first request after an expiry it
replaced must still read the cache. If refreshes do not hold the cache, it says so and stops;
turning it on again lets it try afresh.

### Subagents (`subagents`)

In the panel: **Guardrails**.

| Setting | Values | Default | Notes |
| --- | --- | --- | --- |
| `mode` | `unrestricted` / `limit` / `ask` / `block` | `unrestricted` | *Allowed*: No limit, Up to a number, Ask each time, None. `block` (None) hides the agent types and refuses spawns. `ask` asks you each time (and refuses in headless runs). `limit` refuses a spawn while the limit is running, and Claude waits or does the work itself. |
| `limit` | 1–16 | 2 | For `limit`: the maximum running at once |
| `countTeammates` | on / off | on | Count agent-team teammates against the limit |

### Focus view (`focus`)

In the panel: **Activity**.

| Setting | Values | Default | Notes |
| --- | --- | --- | --- |
| `enabled` | on / off | on | Presentation only |
| `tools` | `compact` / `hidden` | `compact` | One line per tool call, or hidden (the activity line still counts them) |
| `results` | on / off | off | Show tool results under the rows |
| `diffs` | on / off | off | Show inline file diffs for edits |
| `spinner` | on / off | on | Activity summary in the spinner: `Working · 27 tools · 6 files changed · tests running` |

A compact row expands in place (`▸`). Errors are always shown.

### Machine load (`resources`)

In the panel: **Guardrails**.

| Setting | Values | Default | Notes |
| --- | --- | --- | --- |
| `level` | `off` / `low` / `medium` / `high` / `custom` | `off` | |
| `cpu`, `ram` | 10–100 (%) | 70, 85 | Used by `custom` |
| `intervalSec` | 2–60 | 3 | Seconds between readings, for the status bar's live CPU and memory and for the ceilings |
| `enforcement` | `inform` / `limit` / `strict` | `limit` | *When over*. `inform` (Just tell Claude): notices only. `limit` (Hold extra heavy jobs): also hold back *additional* heavy jobs over a ceiling. `strict` (Hold all heavy jobs): hold back every new heavy job while over a ceiling. |

| Level | CPU ceiling | RAM ceiling | Heavy jobs at once (over a ceiling) |
| --- | --- | --- | --- |
| Low | 50% | 75% | 1 |
| Medium | 70% | 85% | 2 |
| High | 90% | 92% | 3 |
| Custom | yours | yours | 1–3, from the CPU ceiling |

Heavy jobs are recognised by command: test runners, builds, package installs, containers,
compilers, benchmarks and dev servers. Pressure levels are *ok*, *elevated* (near a ceiling),
*high* (over a ceiling for two samples in a row) and *critical* (10 points over, or RAM at 95% or
more). Claude is told when pressure starts and ends. The ceilings are machine-wide and advisory;
see [SECURITY.md](../SECURITY.md#what-it-observes) for how they are measured.

### Permissions (`permissions`)

In the panel: **Guardrails**.

Each category is `default` (shown as *Default*: Claude Code decides), `allow`, `ask` or `deny`.

| Category | Examples | Default | Allow offered |
| --- | --- | --- | --- |
| `install`: package installs | `npm install zod`, `pip install requests` | ask | yes |
| `network`: internet and network access | `curl https://…`, `git pull` | Default | yes |
| `download`: downloading files | `wget https://…/model.bin` | ask | yes |
| `edit`: project edits | Edit `src/app.ts` | Default | yes |
| `editOutside`: changes outside the project | Write `~/.bashrc` | ask | no |
| `delete`: deleting files | `rm -rf dist` | ask | no |
| `commit`: Git commits | `git commit -m "…"` | Default | yes |
| `push`: Git push | `git push origin main` | ask | no |
| `gitDestructive`: force push and resets | `git push --force`, `git reset --hard` | deny | no |
| `deploy`: deploy and publish | `npm publish`, `terraform apply` | ask | no |
| `dangerous`: dangerous system commands | `rm -rf ~`, `curl … \| sh` | deny | no |

- **Deny** refuses before any dialog, in every permission mode, for Claude and its subagents.
- **Ask** forces an approval prompt, even where a rule or the mode (including bypass) would allow.
- **Allow** only answers a prompt Claude Code would otherwise show. It never lifts a deny, never
  acts in plan mode, and is not offered for the high-risk categories (edits outside the project,
  deleting files, push, force push and resets, deploy, dangerous commands). A saved Allow for one
  of them reads as Ask, and the panel says so once.

### Display (`ui`)

In the panel: **Setup**.

| Setting | Values | Default | Notes |
| --- | --- | --- | --- |
| `hud` | `band` / `status` / `both` / `off` | `band` | *Status bar*: above the prompt, in Claude Code's status line, both, or hidden |
| `toasts` | on / off | on | Brief notices on state changes |
| `liveLoad` | on / off | on | *Live CPU and memory*: machine-wide readings in the status bar and in Guardrails, sampled every `resources.intervalSec` seconds, even with no machine-load limit. Off stops the sampler unless a limit needs it. It is not sampled while the status bar is hidden. |
| `companion` | on / off | off | *Companion*: Kit, a small pixel fox on a row of its own under the status bar, shows what Claude is doing. In the terminal a click on it opens Control Room. `/cr companion on\|off` |
| `reducedMotion` | on / off | off | *Reduce motion*: still drawings instead of animation (Kit, and the pulse of the milestone under way on Desktop). `/cr motion off` turns it on. |
| `openOnStart` | on / off | off | Open the Control Room panel when a session starts. In the terminal it seats from 144 columns. |

## Profiles

A profile is a complete set of the systems above (everything except Display). The built-in
profiles are described in the [README](../README.md#profiles). Custom profiles are saved from
Setup with a name. Saving a name again replaces that profile, and custom profiles can be
deleted there. `profile` records which profile was applied last. When the current settings differ from it, the
panel reads "Normal · edited" and Setup lists each change in the panel's own words
(`Effort  Maximum › High`), with *Back to Normal* and *Keep as a profile*.
