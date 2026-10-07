# Control Room

Mission control for long Claude Code runs: context and run progress at a glance, Autopilot
handoffs before the context fills up, guardrails, and a calm view of what Claude did. For the
terminal CLI and for local sessions in Claude Desktop's Code tab.

[![Check](https://github.com/Arjun0014/Control-Room-Mod/actions/workflows/check.yml/badge.svg)](https://github.com/Arjun0014/Control-Room-Mod/actions/workflows/check.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Claude Code 2.1.289 or newer](https://img.shields.io/badge/Claude%20Code-%E2%89%A5%202.1.289-d97757)

<p align="center">
  <img src="docs/images/desktop-overview.png" width="460" alt="Control Room's Overview in Claude Desktop's Code tab: the context meter with its handoff tick, cost, CPU and memory, the profile, then one card per section with each system's switch">
</p>

One plugin gives you:

- a quiet two-line **status bar** above the prompt: what Claude is doing now on top; below, the
  context meter, the run's progress, the checks and the run's cost
- the **Control Room** panel, docked beside the conversation
- **Autopilot** (Context Autopilot): Claude writes handoff notes, the context is cleared, and Claude
  carries on in a fresh one, before this one fills up
- **run progress** that survives those handoffs, and an **Activity** view that leads with what
  needs a look
- **answer styles**: brief, Simplified Technical English, mission-control status calls, or a quest
  log with XP for verified progress
- policies for effort, finishing the job, models, subagents, machine load and risky actions, with
  **profiles** that set everything at once

> **Status: 1.1.0.** Control Room is built on Claude Code's function-hooks plugin API ("mods"),
> which is still early access and may change between Claude Code releases. It is verified on
> Claude Code **2.1.289** (the engine bundled with Claude Desktop) and **2.1.292** (CLI) on
> Windows 11. See [Compatibility](#compatibility).

<p align="center">
  <img src="docs/images/cli-status-bar.png" alt="The two-line status bar in a 150-column terminal. On top: Fixing orbitalSpeed, and on the right Milestone 2 of 4. Below: the brand mark, Context at 51% with the handoff tick, Work with one of four milestone squares filled and the current one bright, Checks with Tests failing in red, RAM 88% in amber, the run's cost and the Control Room button">
</p>

---

## Contents

- [Screenshots](#screenshots)
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

## Screenshots

### In the terminal

<table>
  <tr>
    <td width="50%"><img src="docs/images/cli-activity.png" alt="Activity: run progress with all four milestones done, This turn as a strip colored by read, edit, check and failed calls with its legend, five counted lines, and Attention naming a lint script that is missing and a test failure that a later run fixed"></td>
    <td width="50%"><img src="docs/images/cli-activity-checks.png" alt="Activity, further down: Validation with tests passing after one failure (a red dot, then two green) and lint failing, then Changes grouped as code, tests and docs, each file with five diffstat squares"></td>
  </tr>
  <tr>
    <td>Activity leads with the run: its milestones, where the turn's time went, and what needs a look, with the line of output that says why.</td>
    <td>Further down: each check's runs as dots, and every changed file by kind with its diffstat, each opening its diff in place.</td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/images/cli-overview.png" alt="Overview in the terminal: context at 51% with the handoff tick, work four of four, cost and machine readings, the profile, and cards for Context, Behavior and Guardrails"></td>
    <td width="50%"><img src="docs/images/cli-context.png" alt="Context in the terminal: the context meter at 51%, the handoff in three numbered steps with a Hand off now button, Autopilot's settings, and the run's sessions"></td>
  </tr>
  <tr>
    <td>Overview: how the session is doing, then every system with its switch.</td>
    <td>Context: when Claude hands off, and what happens when it does.</td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/images/cli-answer-style.png" alt="Behavior's Answer style card with its choices open in place: Standard, Brief, Plain technical (Simplified Technical English), Mission control (status calls GO, NO-GO, HOLD) and Quest log (XP and levels for verified progress)"></td>
    <td width="50%"><img src="docs/images/cli-quest.png" alt="The Quest card in Activity: Level 4 with its progress line, 340 XP to level 5, the run's awards (full clear 100 XP, three milestones at 50 XP, a comeback at 30 XP), and the achievements First green, Comeback and Full clear earned"></td>
  </tr>
  <tr>
    <td>Answer styles: how Claude writes to you, each with a line on what it means.</td>
    <td>The Quest log: XP only for progress Control Room can count, never for lines or tool calls.</td>
  </tr>
</table>

<p align="center">
  <img src="docs/images/cli-status-bar-done.png" alt="The status bar after the turn: on top, Changed 4 files, Ran tests 3 times, passing after a fix, lint once, failing, and 45s; below, Context 51%, Work four of four in green, Checks with Tests passing and Lint failing, RAM, the run's cost and the Control Room button">
</p>

<sub>Control Room 1.1.0 in a 150-column Windows console (Claude Code 2.1.292), with the panel
docked beside the conversation. The work is a scripted turn played by the development-only
[demo driver](tools/demo/README.md): Claude Code ran every tool call in it for real (a test that
fails and is fixed, new code with its test, a lint script that does not exist), but no model wrote
the words, and the token counts are scripted. Claude Code reports no cost for them, so the cost
reads $0.00.</sub>

### In Claude Desktop

<table>
  <tr>
    <td width="33%"><img src="docs/images/desktop-context.png" alt="Context in Claude Desktop: the context meter at 23% with the handoff tick at 80%, the handoff steps, Autopilot's settings as native buttons, and a run of two sessions with one handoff"></td>
    <td width="33%"><img src="docs/images/desktop-behavior.png" alt="Behavior in Claude Desktop: Frontier Max at extra-high effort, the lazy-exit guard with its strictness and limits, Release check and the model router"></td>
    <td width="33%"><img src="docs/images/desktop-setup.png" alt="Setup in Claude Desktop: the profiles with Normal in use and edited, and the list of what changed from Normal"></td>
  </tr>
  <tr>
    <td>Context, mid-run: one handoff behind it, $115.93 so far.</td>
    <td>Behavior: each system on its own card.</td>
    <td>Setup: exactly what changed since the profile.</td>
  </tr>
</table>

<sub>Control Room 1.0.1 in Claude Desktop's Code tab, from real sessions. On Desktop the controls
are native buttons and popups and the meters are drawn as graphics. The two-line status bar,
Activity's charts and the answer styles of 1.1.0 have not been photographed on Desktop yet.</sub>

## Features

| System | What it does | Default |
| --- | --- | --- |
| **Status bar** | Two lines above the prompt. On top, what Claude is doing right now and where the milestone under way sits ("Milestone 2 of 4"); after a turn, what it did in counted words. Below, the readings, each a name and a graphic: the context meter with Autopilot's handoff tick, the run's progress (one square per milestone), the checks by name, and the run's cost. States show only while they matter: a handoff, calls that need a look, a busy machine, running agents. A handoff that needs you takes the top line, with its buttons. | On |
| **Control Room panel** | Six sections: Overview, Context, Behavior, Guardrails, Activity, Setup. In the terminal: switches, segmented choices, choices that open in place, and − / + steppers. Every control works with a click or with Tab and Enter, and there are no popups to get stuck in. On Desktop: native buttons and popups, plus graphical meters. | `/cr` opens it |
| **Autopilot** (Context Autopilot) | At a threshold (a % of the window, or tokens), Claude finishes the step it is on. Then it runs a handoff: it verifies the state, updates project docs, records unfinished work, runs a minimal validation and writes `NEXT_SESSION_PROMPT.md` in its own words. Control Room then runs `/clear`, seeds the fresh context, and Claude continues on its own. Compaction is only a fallback for when clearing is refused. A reload of the plugin mid-handoff carries the handoff on; it never starts a second one. | Off |
| **Run progress** | The run's objective and milestones, done of total, counted from Claude's own task list and carried across handoffs, so the work meter keeps climbing while the context meter starts over. Where Claude Code offers no task list (its task tools are off by default in 2.1.29x), Control Room gives Claude a small `milestones` tool to keep one. | On |
| **Activity** | The run's milestones, then where this turn's time went (a strip colored by reading, editing, running and checking) and a few counted lines. What needs a look comes next: failures nothing has fixed (with the line of output that says why), refusals, slow calls. Then the checks (tests, build, type-check, lint), each run a dot, and every changed file grouped as code, tests, docs and config, each with its diffstat and its diff. Every tool call is the secondary view. | `/cr`, Activity |
| **Session chain** | Follows a run across context resets: sessions, times, peak context, cost per session as Claude Code reports it, total cost, handoffs. | On |
| **Frontier Max** | Senior-engineer standards in the system prompt (verify, finish, report honestly), plus the strongest reasoning effort the model supports. Models without an effort setting get none, never a fake one. It persists across continuations. | Off |
| **Lazy-exit guard** (No-Lazy-Exit Guard) | Continues the turn when Claude stops before the job is done: work handed back to you, "next steps" it could have taken, unverified claims. It leaves genuinely finished work, real blockers, your decisions and optional ideas alone. It has per-turn and per-session caps and stands down during a handoff. | Off |
| **Release check** | A verification-first policy: test before calling work done, and say plainly what was not checked. | Off |
| **Answer styles** | How Claude writes its messages to you: Standard; Brief (the answer first); Plain technical (Simplified Technical English, after the writing rules of ASD-STE100); Mission control (GO, NO-GO and HOLD calls, GO only for what was verified); Quest log. Never code, files or commit messages. A Claude Code output style you chose outranks them. | Standard |
| **Quest log** | A light game layer for the Quest log style: XP only for outcomes Control Room counts (milestones done, checks turning green, finished plans, verified handoffs), never for lines or tool calls, with levels, achievements and the level in the status bar. Claude is told never to state points itself. | With the style |
| **Model router** | Balanced, Performance, Economy or Custom model choices, for subagents and per turn for the main conversation. It never downgrades under Frontier Max, and no model ids are hard-coded. | Off |
| **Subagents** | No limit, up to *N* at once, ask each time, or off. Live counts are shown. | No limit |
| **Focus view** | Presentation only. Tool calls become one compact line each, results and inline diffs are hidden, and the spinner reads `Working · 27 tools · 6 files changed · tests running`. Activity keeps every call and every diff. Claude still reads everything. | On |
| **Machine load** (Resource Governor) | Advisory CPU and memory ceilings (Low, Medium, High or Custom), from a lightweight machine-wide sampler. Claude is told about pressure mid-task, extra heavy jobs can be held back, and only Claude-started background jobs can be stopped. It is not an OS quota. | Off |
| **Permissions** (Permission Policy) | Default, Allow, Ask or Deny per category: package installs, network, downloads, project edits, edits outside the project, deleting files, commits, push, force push and resets, deploy and publish, and dangerous commands. High-risk categories, deleting files among them, can ask or refuse but never answer for you. It never loosens a deny, plan mode or your organisation's settings. | Safe defaults |
| **Profiles** | Normal, Frontier Max, Low Resource, Release / QA and your own. Setup shows exactly what changed since you applied one. | Normal |

Cost is shown only as Claude Code reports it, and "—" means it was not reported. Progress is
milestones done of the total Claude listed. Nothing is estimated.

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

The run at a glance, in two lines: what is happening on top, the readings below. Settings live
in the panel.

```
▸ Fixing orbitalSpeed                                                                         Milestone 2 of 4
◆   Context ━━━━━━┃─── 51%   Work ■■□□ 1/4   Checks ✗ Tests                RAM 88%   Run $4.18   Control Room
```

| Item | Meaning |
| --- | --- |
| `▸ Fixing orbitalSpeed` | What Claude is doing right now: in its own words when the milestone under way has them, else from the running call (`Running tests`), else `Thinking`. A call running past 20 seconds adds its time. On the right, where the milestone sits (`Milestone 2 of 4`), or its name and place when the line names a call. |
| `✓ Changed 4 files · Ran tests 3×, passing after a fix` | After a turn: what it did, in counted words, and how long it took. The top line appears with the first turn of a context. |
| `Context ━━━━━━┃─── 51%` | How much of the context window is in use: a line, with Autopilot's handoff point as an orange tick. Amber from 85% of the way to the handoff, red at it (with Autopilot off, measured against 90% of the window). It starts over after a handoff. |
| `Work ■■□□ 1/4` | The run's milestones, done of total, from Claude's own task list: one square each, the one under way bright. It carries across handoffs. Shown once Claude has listed milestones. |
| `Checks ✗ Tests` | Each kind of check's latest outcome, by name: `✓` passed, `✗` failed, `▸` running. |
| `Run $4.18` | The whole run's cost as Claude Code reports it, across handoffs. `+` means some session's cost was not reported. This session's own cost is in the panel. |
| States | Only while they matter: `Handoff soon`, `Writing the handoff`, `Starting fresh`, `Resuming`, `Waiting for you`; `▲ 2 issues` (calls that need a look; a failing check is shown under Checks instead); `CPU 91%` or `RAM 92%` near or over a ceiling (calm readings stay in the panel); `2 agents`; `Kept going ×1` when the lazy-exit guard continued the turn; `★ Lv 4` with the Quest log style. |
| `Control Room` | Opens or closes the panel (`Open` or `Close` when the bar is narrow). |

Width decides the detail: the readings take the richest form that shows all of them. Names
(Context, Work, Checks, Run) show from 100 columns (70 on Desktop). Below that the meters stand
alone, then check names go, then the meters shorten, and only then do the least important
readings drop; docked beside the panel, `✓ Tests ✗ Lint` still fits. Desktop draws the meters as
graphics. When a handoff is about to happen, the top line offers **Hand off now** and **Later**;
if a handoff ever waits for you, it offers **Start fresh**.

### The Control Room panel

`/cr` (or `/control-room`) opens or closes it, and so does the status bar's button. In the
fullscreen terminal from 110 columns it docks beside the conversation; otherwise it opens in a
frame above the prompt. A wide frame (a wide terminal, or a Desktop pane at full size) keeps the
page to 80 columns, centred. Opened by you, it seats at any width. If it opens on its own (*Open
at session start*), it waits for 144 columns.

Click anything, or move with **Tab**, choose with **Enter**, and return to the prompt with **Esc**.
Choosing a section starts its page at the top, and every page ends with **↑ Sections**.

| Section | Answers |
| --- | --- |
| **Overview** | How is this session doing? Context, work, cost and the machine at a glance, the profile, then one card per section with its systems, each with its switch and one line of state. Anything that needs you sits on top. |
| **Context** | When does Claude hand off? The Autopilot's state, meter and settings, then the run's sessions and earlier runs. |
| **Behavior** | How does Claude work? The answer style (with a line written in it), Frontier Max, Release check, the lazy-exit guard, the model router and run progress. Finer settings appear only while a system is on. |
| **Guardrails** | What may Claude do, and how hard may it push the machine? Permissions, subagents, machine load with live meters, and Claude's background jobs. |
| **Activity** | How far is the run, and what needs a look? The Quest card with the Quest log style, run progress (objective, milestones, now and next, checks), this turn as a time strip and a few counted lines, Attention, Validation with each check's runs, and the changed files by kind, each with its diffstat and diff. Every tool call, and Focus view's switches, below. |
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
| `/cr style standard\|brief\|ste\|mission\|quest` | How Claude writes to you (no argument lists them) |
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
cost), tool calls as they happen, and machine-wide CPU and memory totals (while the status bar
shows them or a machine-load limit is on). It writes only its own plugin store. Claude, not the
plugin, writes the handoff file. Where Claude Code has no task list of its own, Control Room offers
Claude one small tool, `milestones`, whose answer only records the list for run progress. The
guard's optional smart check sends the last request and answer to your configured model through
Claude Code's own client, as every turn does.

What it observes, what it can change and what it never does is listed in [SECURITY.md](SECURITY.md).

## Compatibility

| | Status |
| --- | --- |
| Claude Code 2.1.292, terminal CLI (Windows 11) | Verified: unit and engine tests, live headless runs, real-terminal rendering at 100–150 columns, mouse and keyboard use, and the full Autopilot chain in the interactive terminal. The 1.1.0 status bar (both lines, at 150 columns and docked at 78), Activity's charts, the answer style picker and the Quest log were checked in a real console during a scripted turn from the demo driver: real tool calls, no model. |
| Claude Code 2.1.289 (bundled with Claude Desktop) | Verified: the test suite run on its engine, type-checked against its declarations, live headless runs in the Desktop host protocol |
| Continuous integration | On every push and pull request: type-check, strict validation of the plugin and the marketplace, and the tests, on Linux, Windows and macOS with the latest Claude Code, and on Linux with 2.1.289 |
| Claude Desktop Code tab, visual | 1.0.1 and 1.0.2 reviewed in the app (the screenshots above are 1.0.1). The 1.1.0 status bar, charts and answer styles are tested on the `desktop` surface in the harness (including that no text trips Desktop's monospace rule) but not yet seen in the app; screenshots are welcome. |
| The `milestones` tool and answer styles with a real model | Tested through the engine only. Whether Claude keeps its milestones and writes in the chosen style as asked has not yet been watched in a live run. |
| macOS and Linux machine-load sampling | Implemented and unit-tested against real `top`, `sysctl` and `/proc` output. Not yet run live. |
| Mobile and VS Code surfaces | Draw (mobile opens choices in place, as in the terminal). Not reviewed visually. |
| Older Claude Code | Loads with a notice below 2.1.289. Features may not work. |

## Limitations

- **Advisory machine load.** Control Room informs Claude and holds back additional heavy commands.
  It does not and cannot enforce an OS-level CPU or memory quota, and it never stops or changes
  other programs.
- **Pattern-based shell classification.** Permissions narrow what Claude may do. They are not a sandbox.
- **Run progress counts what Claude lists.** With no task list (or Behavior → *Run progress* off)
  there is no work meter. A check passed when its command did; a command sent to the background has
  no outcome Control Room can see, and says so.
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
- **No global sidebar and no pinned header.** There is no API to change the Desktop application's
  own sidebar, or to pin a region inside a pane. The docked panel is the supported equivalent, and
  `↑ Sections` brings the section bar back from the end of a page.

## Development

```
plugins/control-room/
  .claude-plugin/plugin.json   manifest
  hooks/hooks.json             { "modules": ["./register.tsx"] }
  hooks/register.tsx           the Host adapter and every hook registration (the only file that touches `$`)
  hooks/app/                   Runtime (composition root), views and status wording, publisher, commands, persistence, monitor
  hooks/core/                  settings schema and defaults, profiles, policy, answer styles, formatting
  hooks/features/              autopilot, chain, guard, router, subagents, activity, plan (run progress),
                               validation (checks), digest (Activity's signal), quest (the Quest log),
                               prompts, permissions/, resources/
  hooks/ui/                    design system (primitives, theme), status bar, Focus view rows, panel sections
  types/index.d.ts             the plugin's $.state contract
  tests/                       claude plugin test suites
tools/
  console/                     Windows only: drive Claude Code in a real console, read the screen, save a PNG
  demo/                        development only: a scripted turn of real tool calls, no model, for screenshots
```

```bash
npm install
```

```bash
npm run check
```

`npm run check` runs `tsc`, `claude plugin validate --strict` (plugin and marketplace) and the test
suites; [CI](.github/workflows/check.yml) runs the same on Linux, Windows and macOS. Claude Code
writes the engine's type declarations into `plugins/control-room/.claude-plugin/types/` whenever a
session loads the folder. Load it once (`claude --plugin-dir plugins/control-room`, then `/exit`)
before running `tsc`. See [CONTRIBUTING.md](CONTRIBUTING.md) for the rules the code follows and
[docs/DESIGN.md](docs/DESIGN.md) for the design system. On Windows,
[tools/console](tools/console/README.md) runs a session in a real console of a given width and
reads the screen back, for checking the terminal UI.

This repository is a Claude Code plugin marketplace (`.claude-plugin/marketplace.json`). It has
not been submitted to any public directory.

## License

[MIT](LICENSE)
