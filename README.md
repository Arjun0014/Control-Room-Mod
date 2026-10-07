# Control Room

A supervisory control layer for Claude Code, for the terminal CLI and for local sessions in
Claude Desktop's Code tab. One plugin gives you:

- a persistent **HUD** above the prompt
- a docked **Control Centre** pane
- **Context Autopilot**: automatic handoff and fresh-context continuation
- a **Session Chain** for long runs
- policies for effort, laziness, models, subagents, machine load and risky actions
- **Profiles** that switch everything at once

> **Status: 0.1.0, early access.** Control Room is built on Claude Code's function-hooks plugin
> API ("mods"), which is itself early access and may change between releases. It is verified on
> Claude Code **2.1.289** (the engine bundled with Claude Desktop) and **2.1.292** (CLI) on
> Windows 11. See [Compatibility](#compatibility).

```
◆ CONTROL ROOM │ CTX — │ $0.00 │ FRONTIER MAX │ AUTO 700k │ RES MED ▲ 81% │ AGENTS ∞ │ GUARD ON │ FOCUS │ Run #6 · S1   [ Control Room ]
```

```
◆ CONTROL ROOM                              Normal* · Run #6 · S1
CTX —  $0.00  AUTO 700k

1: Overview 2: Autopilot 3: Modes 4: Resources 5: Permissions
6: Chain 7: Activity 8: Profiles 9: Settings
─────────────────────────────────────────────────────────────────
MONITORING
Context                         Cost
waiting for the first response  $0.00 this session
handoff at 700k                 $0.00 across the run

Context Autopilot               Frontier Max
AUTO 700k                       ON · effort max
Armed — watching context        applies from the next request

No-Lazy-Exit Guard              Resource Governor
ON                              MED ▲ 79%
watching stops                  CPU 23% · RAM 79% · elevated
```

<sub>Both captured from a real 150-column terminal session (Windows 11, Claude Code 2.1.292) before
the first response. That is why context reads "—" and cost reads $0.00.</sub>

---

## Contents

- [Features](#features)
- [Requirements](#requirements)
- [Install](#install)
- [Using Control Room](#using-control-room)
- [Profiles](#profiles)
- [How the systems interact](#how-the-systems-interact)
- [Security and privacy](#security-and-privacy)
- [Compatibility](#compatibility)
- [Limitations](#limitations)
- [Development](#development)
- [License](#license)

Further reading: [Configuration](docs/CONFIGURATION.md) ·
[Troubleshooting](docs/TROUBLESHOOTING.md) · [Architecture](docs/ARCHITECTURE.md) ·
[Security](SECURITY.md) · [Changelog](CHANGELOG.md) · [Contributing](CONTRIBUTING.md)

## Features

| System | What it does | Default |
| --- | --- | --- |
| **HUD** | One line above the prompt. Shows context tokens and %, session cost, the active profile or Frontier Max, the Autopilot state and threshold, machine load, subagents, guard, router and the run/session. Segments drop by priority as the terminal narrows. A second line appears only when something needs you. | On |
| **Control Centre** | A docked pane with nine tabs: Overview, Autopilot, Modes, Resources, Permissions, Chain, Activity, Profiles, Settings. Native controls on Desktop, keyboard-driven in the terminal (`1`–`9`, Tab/arrows, Enter, Esc). | `/cr` opens it |
| **Context Autopilot** | At a threshold (tokens or % of the window) it marks **HANDOFF PENDING**. Claude finishes the current unit of work, then runs a handoff turn: it verifies the state, updates project docs, records unfinished work, runs a minimal validation and creates or updates `NEXT_SESSION_PROMPT.md` (Claude decides what goes in it). Control Room then runs `/clear` and seeds the fresh context. Claude reads the docs and the handoff file and continues on its own. Compaction is only a fallback for when `/clear` is refused. | Off |
| **Session Chain** | Records a run across context resets: run id, session ids, start and end times, peak context, cost per session as Claude Code reports it, cumulative cost, turns, handoff reasons and transitions. | On |
| **Frontier Max** | A senior-engineer evaluation policy in the system prompt, plus the maximum reasoning effort the model supports on every request. Models without an effort setting get none, never a fake one. Persists across continuations. | Off |
| **No-Lazy-Exit Guard** | Catches premature stops: work handed back to you, "next steps" Claude could have done, unverified claims. It tells these apart from genuinely complete work, real blockers, decisions that are yours, and optional ideas. It continues the turn with the specific gaps, with per-turn and per-session caps. It stands down during a handoff. | Off |
| **Model Router** | Balanced, Performance, Economy or Custom model choice for subagents, and per turn for the main conversation. Never downgrades under Frontier Max. No model ids are hard-coded. | Off |
| **Subagent Control** | Unrestricted, Off (hidden and denied), Ask each time, or Max *N* running. Live counts are shown. | Unrestricted |
| **Focus View** | Presentation only. Tool calls become one compact line each, results and inline diffs are hidden, and an activity line reads like `Working · 27 tools · 6 files changed · tests running`. The Activity tab holds every call and a per-file change and diff view. Claude still reads everything. | On |
| **Resource Governor** | Advisory CPU and RAM ceilings (Low, Medium, High or Custom). A lightweight machine-wide sampler drives them. Claude is told about pressure mid-task, extra heavy jobs can be held back, and only Claude-started background tasks can be stopped. It is not an OS quota. | Off |
| **Permission Policy** | Allow, Ask, Deny or Claude Code decides, per category: package installs, network, downloads, project edits, edits outside the project, deletion, commits, push, force push and destructive Git, deploy and publish, and dangerous commands. It never loosens a deny, plan mode or your organisation's managed settings. | Safe defaults |
| **Profiles** | Normal, Frontier Max, Low Resource, Release/QA and your own. Each shows exactly what it changes, and an override marks the profile `Name*`. | Normal |

Cost is shown only as Claude Code reports it, and "—" means it was not reported. Nothing is
estimated.

## Requirements

- Claude Code **2.1.289 or newer** with function-hooks plugins (mods). Check with `claude --version`.
- The terminal CLI, or Claude Desktop's Code tab for **local** sessions.
- Nothing else. Control Room has no runtime dependencies and no build step, because Claude Code
  loads its TypeScript directly.

## Install

### Try it for one session

```bash
claude --plugin-dir /path/to/control-room/plugins/control-room
```

Nothing is installed. The plugin loads from that folder for that session, and edits to it reload live.

### Install it (terminal and Desktop)

From a clone of this repository, add it as a marketplace, then install:

```bash
claude plugin marketplace add /path/to/control-room
```

```bash
claude plugin install control-room@control-room
```

Once the repository is published you can add it by its GitHub name instead
(`claude plugin marketplace add <owner>/<repo>`). An installed folder marketplace is read straight from
the folder: after you pull changes, run `/reload-plugins` in a session.

### Claude Desktop (Code tab)

Desktop's local sessions run the same Claude Code engine and load the plugins installed above.
To load a working copy without installing it, name the folder in the `env` block of
`~/.claude/settings.json`. Claude Code reads `CLAUDE_CODE_PLUGIN_DIRS` there for sessions that
the Desktop app starts:

```json
{
  "env": { "CLAUDE_CODE_PLUGIN_DIRS": "/path/to/control-room/plugins/control-room" }
}
```

Use your platform's path-list separator (`;` on Windows, `:` elsewhere) for several folders.
Remote (cloud) sessions have not been tested.

### Uninstall

```bash
claude plugin uninstall control-room@control-room
```

Settings and run history live in Claude Code's per-plugin store (see [Configuration](docs/CONFIGURATION.md#where-settings-live)).
Use `/cr reset confirm` first if you also want the settings cleared.

## Using Control Room

### The HUD

The band above the prompt shows, from most to least important:

| Segment | Meaning |
| --- | --- |
| `CTX 312k/1M 31%` | Live context: tokens, window, percent. It turns amber at 85% of the Autopilot threshold and red at or past it (with the Autopilot off: 90% of the window). A small meter marks the threshold. |
| `$4.18` | This session's cost as Claude Code reports it. `run $9.40` is added when a chain has several sessions, and `+` when some session's cost was not reported. |
| `NORMAL*` / `FRONTIER MAX` | Active profile (`*` = modified), or Frontier Max and its effort. |
| `AUTO 700k` | Autopilot threshold. It reads `HANDOFF PENDING`, `HANDOFF`, `FRESH CONTEXT…`, `RESUMING` or `AUTO NEEDS YOU` as it works. |
| `RES MED ▲ 81%` | Resource Governor level and the hottest reading (`▲` = elevated or worse). |
| `AGENTS 1/2` | Running subagents against the limit (`∞` unrestricted, `OFF`, `ASK`). |
| `GUARD ON` · `ROUTER ECO` · `FOCUS` | Shown while active. |
| `Run #6 · S2` | Run number and the session within it. |
| `[ Control Room ]` | Opens the Control Centre. |

When the Autopilot is pending, a second line offers **Handoff now** and **Snooze**. If it ever
waits for you, it offers **Start fresh context**.

### The Control Centre

`/cr` (or `/control-room`) opens or closes it, and the HUD button opens it. In the fullscreen
terminal it docks beside the transcript. If it opens on its own (with *Open at session start*),
it waits for at least 144 columns; opened by you, it seats at any width. While it has the
keyboard: `1`–`9` switch tabs, Tab and the arrows move, Enter activates, and Esc returns to the
prompt. Desktop draws the same controls natively.

Each tab puts monitoring above controls:

- **Overview**: every system's effective state (with the reason when it differs from the
  setting), the profile picker and quick toggles.
- **Autopilot**: state, the context meter with its threshold marker, threshold mode and value,
  continuation method, compact fallback, auto-continue and the handoff file name.
- **Modes**: Frontier Max, Release/QA, No-Lazy-Exit Guard, Model Router, Subagent Control and Focus View.
- **Resources**: live CPU and RAM meters with sparklines, ceilings, interventions, and Claude's
  background tasks (each can be stopped).
- **Permissions**: the policy per category and the recent decisions.
- **Chain**: the current run's sessions and transitions, and recent runs.
- **Activity**: this turn's tool calls, and the Changes view (files changed this session with diffs).
- **Profiles**: built-in and custom profiles, each with its exact changes. You can also save the
  current setup as a profile.
- **Settings**: HUD placement, toasts, open at start, about, privacy, and reset.

### Commands

Every control is also a command. This is handy over Remote Control, for muscle memory, and on
surfaces without the pane.

| Command | Effect |
| --- | --- |
| `/cr` | Open or close the Control Centre |
| `/cr status` | One-screen status |
| `/cr help` | Command list |
| `/cr profile [name]` | List profiles, or apply one (`normal`, `frontier`, `low-resource`, `release-qa`, or a custom name) |
| `/cr autopilot on\|off\|70%\|700k` | Toggle the Context Autopilot or set its threshold (`%` of the window, or tokens with `k`/`m`) |
| `/cr handoff` | Hand off now: notes and `NEXT_SESSION_PROMPT.md`, then continue in a fresh context |
| `/cr fresh` | Start the fresh context when a written handoff is waiting for you |
| `/cr frontier on\|off` | Frontier Max (turning it on also turns on the guard) |
| `/cr guard on\|off` · `/cr qa on\|off` · `/cr focus on\|off` | Guard, Release/QA policy, Focus View |
| `/cr resources off\|low\|medium\|high\|<cpu>/<ram>` | Resource Governor level, or custom ceilings such as `60/80` |
| `/cr agents unlimited\|off\|ask\|<n>` | Subagent Control |
| `/cr router off\|balanced\|performance\|economy\|custom` | Model Router strategy |
| `/cr hud band\|status\|both\|off` | Where the HUD draws: the band above the prompt, the status line, both, or neither |
| `/cr reset confirm` | All settings back to Normal (custom profiles are kept) |

`/cr` is registered only if no other command already uses the name. `/control-room` always works.

## Profiles

| Profile | Changes from Normal |
| --- | --- |
| **Normal** | Claude Code as usual, with Focus View's quieter transcript and the safe permission defaults. |
| **Frontier Max** | Frontier Max on (max effort), guard on (standard), Autopilot on at 70%, Resource Governor Medium. |
| **Low Resource** | Resource Governor Low (CPU 50%, RAM 75%, strict), at most 1 subagent. |
| **Release / QA** | Verification-first policy, strict guard (3 continuations per turn), Autopilot on at 70%, at most 2 subagents, inline diffs shown, Resource Governor Medium, commits set to Ask. |

Applying a profile sets every system at once. Changing any setting afterwards keeps the name
with a `*`, and the Profiles tab shows each change (`Guard strictness: standard → strict`). Save
any setup as a custom profile from the Profiles tab.

## How the systems interact

Conflicts are resolved in a fixed order (higher wins):

1. **Organisation and engine safety**: managed settings, deny rules, plan mode. Never loosened.
2. **Permission Policy**: applies to everything, including work the Autopilot or the guard asked for.
3. **Your live actions**: an interrupt cancels pending automation. A prompt you type while a
   handoff is pending is honoured, with a reminder.
4. **Context Autopilot**: once pending, the guard stands down for the handoff, and no new large
   work is encouraged.
5. **Resource Governor**: constrains *how* (parallelism, heavy jobs), never *whether*. It applies
   under Frontier Max too.
6. **Subagent Control**: hard limits that Frontier Max and the Router cannot exceed.
7. **Frontier Max**: vetoes Router downgrades of the main conversation (unless the Router is Custom).
8. **No-Lazy-Exit Guard**: subordinate to everything above and to its own loop limits.
9. **Model Router**: acts only where nothing above constrains it.
10. **Focus View**: presentation only. It never changes what Claude reads.

The Overview tab shows each system's *effective* state and why, for example "Guard · suspended —
handoff in progress".

## Security and privacy

Control Room runs entirely inside Claude Code. It makes **no network requests**, sends **no
telemetry**, and nothing leaves your machine through it. It observes session figures (context,
cost), tool calls as they happen, and machine-wide CPU and RAM totals (only with the Resource
Governor on). It writes only its own plugin store. Claude, not the plugin, writes the handoff
file. The guard's optional model check sends the last request and answer to your configured
model through Claude Code's own client, as every turn does.

What it observes, what it can change and what it never does is listed in [SECURITY.md](SECURITY.md).

## Compatibility

| | Status |
| --- | --- |
| Claude Code 2.1.292, terminal CLI (Windows 11) | Verified: unit and engine tests, live headless runs, real-terminal rendering |
| Claude Code 2.1.289 (bundled with Claude Desktop) | Verified: type-checked against its declarations, live headless runs in the Desktop host protocol |
| Claude Desktop Code tab, visual | Built for and tested in the harness on the `desktop` surface. Not yet visually reviewed in the app. |
| macOS and Linux resource sampling | Implemented and unit-tested against real `top`, `sysctl` and `/proc` output. Not yet run live. |
| Mobile and VS Code surfaces | Draw (mobile falls back to cycling buttons where it has no Select). Not reviewed visually. |
| Older Claude Code | Loads with a notice below 2.1.289. Features may not work. |

## Limitations

- **Advisory resource ceilings.** Control Room informs Claude and holds back additional heavy
  commands. It does not and cannot enforce an OS-level CPU or RAM quota, and it never stops or
  changes other programs.
- **Pattern-based shell classification.** The Permission Policy narrows what Claude may do. It is
  not a sandbox.
- **Model Router, main conversation.** Claude Code rejects a bare alias such as `haiku` on a model
  request. So the main conversation is only routed to a model whose full id Claude Code has
  already reported answering in this session (for example, after an Explore subagent ran on
  Haiku). Subagents take aliases, which Claude Code resolves.
- **Headless runs.** With no one to answer, Claude Code refuses an **Ask**. In CI or `claude -p`,
  set categories you need to *Claude Code decides*. A plugin command such as `claude -p "/cr status"`
  given as the *initial* prompt goes to the model, because plugin commands register as the session
  starts. Use an interactive session, the stream-json input, or the Control Centre.
- **Managed machines.** Where your organisation seats Claude Code's managed policy guard,
  Control Room's system-prompt section can be skipped. Control Room detects this and delivers its
  policies as prompt context instead.
- **No global sidebar.** There is no API to change the Desktop application's own sidebar. The
  docked Control Centre pane is the supported equivalent.

## Development

```
plugins/control-room/
  .claude-plugin/plugin.json   manifest
  hooks/hooks.json             { "modules": ["./register.tsx"] }
  hooks/register.tsx           the Host adapter and every hook registration (the only file that touches `$`)
  hooks/app/                   Runtime (composition root), views, publisher, commands, persistence, monitor
  hooks/core/                  settings schema and defaults, profiles, policy, formatting
  hooks/features/              autopilot, chain, guard, router, subagents, activity, prompts, permissions/, resources/
  hooks/ui/                    theme, components, HUD, Focus View rows, Control Centre tabs
  types/index.d.ts             the plugin's $.state contract
  tests/                       claude plugin test suites
```

```bash
npm install
```

```bash
npm run check
```

`npm run check` runs `tsc`, `claude plugin validate --strict` (plugin and marketplace) and the test
suites. Claude Code writes the engine's type declarations into
`plugins/control-room/.claude-plugin/types/` whenever a session loads the folder. Load it once
(`claude --plugin-dir plugins/control-room`, then `/exit`) before running `tsc`.
See [CONTRIBUTING.md](CONTRIBUTING.md) for the rules the code follows.

This repository is ready to be published as a Claude Code plugin marketplace
(`.claude-plugin/marketplace.json`). It has not been submitted to any public directory.

## License

[MIT](LICENSE)
