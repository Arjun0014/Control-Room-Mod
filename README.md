# Control Room

A calm control layer for Claude Code, for the terminal CLI and for local sessions in Claude
Desktop's Code tab. One plugin gives you:

- a quiet **status bar** above the prompt
- the **Control Room** panel, docked beside the conversation
- **Autopilot** (Context Autopilot): automatic handoff to a fresh context before this one fills up
- a **session chain** that follows long runs across context resets
- policies for effort, finishing the job, models, subagents, machine load and risky actions
- **profiles** that set everything at once

> **Status: 1.0.0.** Control Room is built on Claude Code's function-hooks plugin API ("mods"),
> which is still early access and may change between Claude Code releases. It is verified on
> Claude Code **2.1.289** (the engine bundled with Claude Desktop) and **2.1.292** (CLI) on
> Windows 11. See [Compatibility](#compatibility).

The status bar shows live readings only (context, cost, CPU, memory, running agents) and events as they happen:

```
◆   Context ━━━━━━━─── 69%   $78.35   CPU ▂▃▅▃▂▃ 23%   RAM ▇▇▇▇▇▇ 79%   2 agents        Control Room
```

The panel answers one question per section. This is Overview:

```
◆ Control Room                                            Normal

Overview   Context   Behavior   Guardrails   Activity   Setup
━━━━━━━━────────────────────────────────────────────────────────

Context   ━━──────────────────────────────────────────────    5%
          52k of 1M tokens
Cost      $0.41 this session
Machine   CPU 16%   Memory 72%

╭──────────────────────────────────────────────────────────────╮
│ Profile                                             Normal ▾ │
│ Claude Code as usual, quieter                                │
╰──────────────────────────────────────────────────────────────╯

CONTEXT                                                   Open ›
╭──────────────────────────────────────────────────────────────╮
│ Autopilot                                              ○ Off │
╰──────────────────────────────────────────────────────────────╯

BEHAVIOR                                                  Open ›
╭──────────────────────────────────────────────────────────────╮
│ Frontier Max                                           ○ Off │
│ Lazy-exit guard                                        ○ Off │
│ Release check                                          ○ Off │
│ Model router                                           Off › │
╰──────────────────────────────────────────────────────────────╯
```

Guardrails and Activity follow below. Choices open in place, each with one line on what it means.
They work with a click or with Tab and Enter:

```
│ Package installs                                       Ask ▾ │
│ Network access                                     Default ▾ │
│ Downloads                                              Ask ▴ │
│ e.g. wget https://…/model.bin                                │
│   ○ Default  Claude Code decides                             │
│   ○ Allow    answers prompts for you                         │
│   ● Ask      always asks you first                           │
│   ○ Deny     never runs                                      │
│ Project edits                                      Default ▾ │
```

<sub>Captured from a real 150-column terminal (Windows 11, Claude Code 2.1.292) after one short
reply, with the panel docked beside the conversation. In a narrower terminal the panel opens in a
frame above the prompt. On Desktop the same controls are native buttons and popups, and the meters
are drawn as graphics.</sub>

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
[Troubleshooting](docs/TROUBLESHOOTING.md) · [Design](docs/DESIGN.md) ·
[Architecture](docs/ARCHITECTURE.md) · [Security](SECURITY.md) · [Changelog](CHANGELOG.md) ·
[Contributing](CONTRIBUTING.md)

## Features

| System | What it does | Default |
| --- | --- | --- |
| **Status bar** | One line above the prompt, live readings only: context (a thin meter and %), cost, CPU and memory, running agents, and Autopilot events as they happen. Items drop by priority as the terminal narrows. A second line appears only when something needs you. | On |
| **Control Room panel** | Six sections: Overview, Context, Behavior, Guardrails, Activity, Setup. In the terminal: switches, segmented choices, choices that open in place, and − / + steppers. Every control works with a click or with Tab and Enter, and there are no popups to get stuck in. On Desktop: native buttons and popups, plus graphical meters. | `/cr` opens it |
| **Autopilot** (Context Autopilot) | At a threshold (a % of the window, or tokens), Claude finishes the step it is on. Then it runs a handoff: it verifies the state, updates project docs, records unfinished work, runs a minimal validation and writes `NEXT_SESSION_PROMPT.md` in its own words. Control Room then runs `/clear`, seeds the fresh context, and Claude continues on its own. Compaction is only a fallback for when clearing is refused. | Off |
| **Session chain** | Follows a run across context resets: sessions, times, peak context, cost per session as Claude Code reports it, total cost, handoffs. | On |
| **Frontier Max** | Senior-engineer standards in the system prompt (verify, finish, report honestly), plus the strongest reasoning effort the model supports. Models without an effort setting get none, never a fake one. It persists across continuations. | Off |
| **Lazy-exit guard** (No-Lazy-Exit Guard) | Continues the turn when Claude stops before the job is done: work handed back to you, "next steps" it could have taken, unverified claims. It leaves genuinely finished work, real blockers, your decisions and optional ideas alone. It has per-turn and per-session caps and stands down during a handoff. | Off |
| **Release check** | A verification-first policy: test before calling work done, and say plainly what was not checked. | Off |
| **Model router** | Balanced, Performance, Economy or Custom model choices, for subagents and per turn for the main conversation. It never downgrades under Frontier Max, and no model ids are hard-coded. | Off |
| **Subagents** | No limit, up to *N* at once, ask each time, or off. Live counts are shown. | No limit |
| **Focus view** | Presentation only. Tool calls become one compact line each, results and inline diffs are hidden, and the spinner reads `Working · 27 tools · 6 files changed · tests running`. Activity has every call and every changed file with its diff. Claude still reads everything. | On |
| **Machine load** (Resource Governor) | Advisory CPU and memory ceilings (Low, Medium, High or Custom), from a lightweight machine-wide sampler. Claude is told about pressure mid-task, extra heavy jobs can be held back, and only Claude-started background jobs can be stopped. It is not an OS quota. | Off |
| **Permissions** (Permission Policy) | Default, Allow, Ask or Deny per category: package installs, network, downloads, project edits, edits outside the project, deleting files, commits, push, force push and resets, deploy and publish, and dangerous commands. It never loosens a deny, plan mode or your organisation's settings. | Safe defaults |
| **Profiles** | Normal, Frontier Max, Low Resource, Release / QA and your own. Setup shows exactly what changed since you applied one. | Normal |

Cost is shown only as Claude Code reports it, and "—" means it was not reported. Nothing is
estimated.

## Requirements

- Claude Code **2.1.289 or newer** with function-hooks plugins (mods). Check with `claude --version`.
- The terminal CLI, or Claude Desktop's Code tab for **local** sessions.
- Nothing else. Control Room has no runtime dependencies and no build step, because Claude Code
  loads its TypeScript directly.

## Install

### Install it (terminal and Desktop)

Add the repository as a marketplace, then install:

```bash
claude plugin marketplace add Arjun0014/Control-Room-Mod
```

```bash
claude plugin install control-room@control-room
```

Or do both from inside a session (Claude Code 2.1.275 or newer):
`/plugin install control-room --marketplace Arjun0014/Control-Room-Mod`.

A local clone works too: `claude plugin marketplace add /path/to/Control-Room-Mod`. The terminal
reads an installed folder marketplace straight from the folder, so after you pull changes, run
`/reload-plugins` in a session. Desktop's Code tab loads the copy Claude Code made when you
installed, so it needs `claude plugin update control-room@control-room` after a new version, then a
new session.

### Update

Each release raises the version, and Claude Code installs it when you ask:

```bash
claude plugin update control-room@control-room
```

To get releases automatically, open **Marketplaces** in `/plugin`, select `control-room` and
choose **Enable auto-update**. It is off by default for marketplaces you add yourself.

### Try it for one session

```bash
claude --plugin-dir /path/to/Control-Room-Mod/plugins/control-room
```

Nothing is installed. The plugin loads from that folder for that session, and edits to it reload live.

### Claude Desktop (Code tab)

Desktop's local sessions run the same Claude Code engine and load the plugins installed above.
To load a working copy without installing it, name the folder in the `env` block of
`~/.claude/settings.json`. Claude Code reads `CLAUDE_CODE_PLUGIN_DIRS` there for sessions that
the Desktop app starts:

```json
{
  "env": { "CLAUDE_CODE_PLUGIN_DIRS": "/path/to/Control-Room-Mod/plugins/control-room" }
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

### The status bar

It shows live readings only. Settings live in the panel.

| Item | Meaning |
| --- | --- |
| `Context ━━━━──── 31%` | Live context. The meter turns amber at 85% of the Autopilot threshold and red at it (with Autopilot off: 90% of the window). The orange tick is the threshold. |
| `$4.18` | This session's cost as Claude Code reports it. `run $9.40` is added when a run spans several sessions; `+` means some session's cost was not reported. |
| `CPU ▂▃▅▃▂▃ 23%` · `RAM 79%` | Machine-wide CPU and memory, every 3 s. In terminals 110 columns or wider, the last six readings appear as a sparkline once there are six. Amber near a ceiling, red at it. Turn off in Setup → *Live CPU and memory*. |
| `Handoff soon` | Autopilot events as they happen: `Handoff soon`, `Writing the handoff`, `Starting fresh`, `Resuming`, `Waiting for you`. |
| `2 agents` | Subagents are running (`2 of 2 agents` with a limit). |
| `Kept going ×1` | The lazy-exit guard continued this turn. |
| `Control Room` | Opens or closes the panel (`Open` or `Close` when the bar is narrow). |

When a handoff is about to happen, a second line offers **Hand off now** and **Later**. If a
handoff ever waits for you, it offers **Start fresh**.

### The Control Room panel

`/cr` (or `/control-room`) opens or closes it, and so does the status bar's button. In the
fullscreen terminal from 110 columns it docks beside the conversation; otherwise it opens in a
frame above the prompt, where a wide terminal keeps the page to 80 columns, centred. Opened by
you, it seats at any width. If it opens on its own (*Open at session start*), it waits for 144
columns.

Click anything, or move with **Tab**, choose with **Enter**, and return to the prompt with **Esc**.

| Section | Answers |
| --- | --- |
| **Overview** | How is this session doing? Context, cost and the machine at a glance, the profile, then one card per section with its systems, each with its switch and one line of state. Anything that needs you sits on top. |
| **Context** | When does Claude hand off? The Autopilot's state, meter and settings, then the run's sessions and earlier runs. |
| **Behavior** | How does Claude work? Frontier Max, Release check, the lazy-exit guard and the model router. Finer settings appear only while a system is on. |
| **Guardrails** | What may Claude do, and how hard may it push the machine? Permissions, subagents, machine load with live meters, and Claude's background jobs. |
| **Activity** | What did Claude just do? This turn's tool calls, every changed file with its diff, and Focus view's switches. |
| **Setup** | Profiles (with exactly what changed), display, and about. |

### Commands

Every control is also a command. This is handy over Remote Control, for muscle memory, and on
surfaces without the panel.

| Command | Effect |
| --- | --- |
| `/cr` | Open or close Control Room |
| `/cr status` | Everything at a glance |
| `/cr help` | Command list |
| `/cr profile [name]` | List profiles, or switch (`normal`, `frontier`, `low-resource`, `release-qa`, or a custom name) |
| `/cr autopilot on\|off\|70%\|700k` | Turn Autopilot on or off, or set its threshold (`%` of the window, or tokens with `k`/`m`) |
| `/cr handoff` | Hand off now: notes and `NEXT_SESSION_PROMPT.md`, then continue in a fresh context |
| `/cr fresh` | Start the fresh context when a written handoff is waiting for you |
| `/cr frontier on\|off` | Frontier Max (turning it on also turns on the guard) |
| `/cr guard on\|off` · `/cr qa on\|off` · `/cr focus on\|off` | Lazy-exit guard, Release check, Focus view |
| `/cr resources off\|low\|medium\|high\|<cpu>/<ram>` | Machine load level, or custom ceilings such as `60/80` |
| `/cr agents unlimited\|off\|ask\|<n>` | Subagents |
| `/cr router off\|balanced\|performance\|economy\|custom` | Model router |
| `/cr hud band\|status\|both\|off` | Where the status bar draws: above the prompt, in Claude Code's status line, both, or neither |
| `/cr reset confirm` | All settings back to Normal (custom profiles are kept) |

`/cr` is registered only if no other command already uses the name. `/control-room` always works.

## Profiles

| Profile | Changes from Normal |
| --- | --- |
| **Normal** | Claude Code as usual, with Focus view's quieter transcript and the safe permission defaults. |
| **Frontier Max** | Frontier Max on (maximum effort), guard on (standard), Autopilot at 70%, machine load Medium. |
| **Low Resource** | Machine load Low (CPU 50%, memory 75%, hold all heavy jobs), at most 1 subagent. |
| **Release / QA** | Release check on, strict guard (3 continuations per turn), Autopilot at 70%, at most 2 subagents, inline diffs shown, machine load Medium, commits set to Ask. |

A profile sets everything at once. Change anything afterwards and the profile reads
`Normal · edited`, and Setup lists each change (`Machine load  Off › Medium`). Save any setup as
a profile of your own, or go back to the profile in one click.

## How the systems interact

Conflicts are resolved in a fixed order (higher wins):

1. **Organisation and engine safety**: managed settings, deny rules, plan mode. Never loosened.
2. **Permissions**: apply to everything, including work the Autopilot or the guard asked for.
3. **Your live actions**: an interrupt cancels pending automation. A prompt you type while a
   handoff is pending is honoured, with a reminder.
4. **Autopilot**: once a handoff is pending, the guard stands down, and no new large work is encouraged.
5. **Machine load**: constrains *how* (parallelism, heavy jobs), never *whether*. It applies
   under Frontier Max too.
6. **Subagents**: hard limits that Frontier Max and the router cannot exceed.
7. **Frontier Max**: vetoes router downgrades of the main conversation (unless the router is Custom).
8. **Lazy-exit guard**: subordinate to everything above and to its own caps.
9. **Model router**: acts only where nothing above constrains it.
10. **Focus view**: presentation only. It never changes what Claude reads.

Overview shows each system's *effective* state, for example "Lazy-exit guard ● On  Paused
during the handoff".

## Security and privacy

Control Room runs entirely inside Claude Code. It makes **no network requests**, sends **no
telemetry**, and nothing leaves your machine through it. It observes session figures (context,
cost), tool calls as they happen, and machine-wide CPU and memory totals (only with machine load
on). It writes only its own plugin store. Claude, not the plugin, writes the handoff file. The
guard's optional smart check sends the last request and answer to your configured model through
Claude Code's own client, as every turn does.

What it observes, what it can change and what it never does is listed in [SECURITY.md](SECURITY.md).

## Compatibility

| | Status |
| --- | --- |
| Claude Code 2.1.292, terminal CLI (Windows 11) | Verified: unit and engine tests, live headless runs, real-terminal rendering at 100–150 columns, mouse and keyboard use, and the full Autopilot chain in the interactive terminal |
| Claude Code 2.1.289 (bundled with Claude Desktop) | Verified: the test suite run on its engine, type-checked against its declarations, live headless runs in the Desktop host protocol |
| Claude Desktop Code tab, visual | Built for and tested in the harness on the `desktop` surface. Visual review in the app is ongoing; screenshots are welcome. |
| macOS and Linux machine-load sampling | Implemented and unit-tested against real `top`, `sysctl` and `/proc` output. Not yet run live. |
| Mobile and VS Code surfaces | Draw (mobile opens choices in place, as in the terminal). Not reviewed visually. |
| Older Claude Code | Loads with a notice below 2.1.289. Features may not work. |

## Limitations

- **Advisory machine load.** Control Room informs Claude and holds back additional heavy commands.
  It does not and cannot enforce an OS-level CPU or memory quota, and it never stops or changes
  other programs.
- **Pattern-based shell classification.** Permissions narrow what Claude may do. They are not a sandbox.
- **Model router, main conversation.** Claude Code rejects a bare alias such as `haiku` on a model
  request. So the main conversation is only routed to a model whose full id Claude Code has
  already reported answering in this session (for example, after an Explore subagent ran on
  Haiku). Subagents take aliases, which Claude Code resolves.
- **Headless runs.** With no one to answer, Claude Code refuses an **Ask**. In CI or `claude -p`,
  set categories you need to *Default*. A plugin command such as `claude -p "/cr status"` given as
  the *initial* prompt goes to the model, because plugin commands register as the session starts.
  Use an interactive session, stream-json input, or the panel.
- **Managed machines.** Where your organisation seats Claude Code's managed policy guard,
  Control Room's system-prompt section can be skipped. Control Room detects this and delivers its
  policies as prompt context instead.
- **No global sidebar.** There is no API to change the Desktop application's own sidebar. The
  docked panel is the supported equivalent.

## Development

```
plugins/control-room/
  .claude-plugin/plugin.json   manifest
  hooks/hooks.json             { "modules": ["./register.tsx"] }
  hooks/register.tsx           the Host adapter and every hook registration (the only file that touches `$`)
  hooks/app/                   Runtime (composition root), views and status wording, publisher, commands, persistence, monitor
  hooks/core/                  settings schema and defaults, profiles, policy, formatting
  hooks/features/              autopilot, chain, guard, router, subagents, activity, prompts, permissions/, resources/
  hooks/ui/                    design system (primitives, theme), status bar, Focus view rows, panel sections
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
(`claude --plugin-dir plugins/control-room`, then `/exit`) before running `tsc`. See
[CONTRIBUTING.md](CONTRIBUTING.md) for the rules the code follows and [docs/DESIGN.md](docs/DESIGN.md)
for the design system. On Windows, [tools/console](tools/console/README.md) runs a session in a
real console of a given width and reads the screen back, for checking the terminal UI.

This repository is a Claude Code plugin marketplace (`.claude-plugin/marketplace.json`). It has
not been submitted to any public directory.

## License

[MIT](LICENSE)
