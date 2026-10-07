# Security and privacy

Claude Code plugins with function hooks ("mods") are highly privileged: they see what Claude
does and can change it. Control Room is written to be conservative. This page lists everything
it can observe, everything it can change, what it never does, and how it fails.

## In one paragraph

Control Room runs inside Claude Code's plugin environment. It has no DOM, no Node.js and no
direct filesystem or network APIs; every action goes through Claude Code's plugin interface
(`$`), which validates and logs it. It makes **no network requests** and sends **no telemetry**.
It hooks none of Claude Code's telemetry streams and collects no analytics. It never reads
environment variables, secrets, or the contents of your project's files. It persists only its
own settings and run records in Claude Code's per-plugin store. Run
`claude plugin validate plugins/control-room` to see every engine call the code can make.

## What it observes

| Data | Used for | Kept |
| --- | --- | --- |
| Session figures: context tokens, window and percent, cost in USD *as Claude Code reports it*, the model id, the session id, the Claude Code version, the attached surfaces | HUD, Context Autopilot threshold, Session Chain | Run records (see [Data at rest](#data-at-rest)) |
| The prompts you submit, and Claude's final message when a turn stops | Model Router task class (keyword match). No-Lazy-Exit Guard comparison of the request with the final answer. The first sentence of your latest substantial request is the run's *objective* in Activity. | The objective: in the run record. The rest: memory only, for the current turn |
| Tool calls as they happen: tool name, and input such as a shell command or file path; whether each succeeded, and for a failed or refused call the first line of its answer | Permission Policy classification, the heavy-command check, Activity (Attention, Validation), Focus View rows | Memory only (last 300 calls) |
| Edit/Write results (the structured patch Claude Code returns; for a file written whole, its content as the added lines) | The Changes view's per-file diffs | Memory only (200 files, hunks capped) |
| Claude's own task list: the inputs and results of TodoWrite, TaskCreate, TaskUpdate and TaskList, or of Control Room's `milestones` tool where it is offered (subjects, statuses, the "doing" form) | Run progress in Activity and the status bar; after a handoff, the open milestones are named in the fresh context so its task list carries on | In the run record (at most 60 tasks) |
| The names of the tools Claude is offered (`$.tool.list`), once per session | Only to see whether Claude Code offers a task list, so the `milestones` tool is added only where none exists | Nothing |
| File *metadata* only (`stat`): the handoff file's modification time; the real path of a file Claude is about to edit | Verifying that the handoff was written; detecting edits outside the project, including through links | Nothing |
| The running subagents list (type, status, description) | Subagent counts and limits | Memory only |
| The names of registered slash commands | Only so as not to take `/cr` if something else uses it | Nothing |
| Whether managed (organisation) policy settings exist (only whether any key is set) | Choosing how to deliver policies (system prompt, or prompt context where a managed guard skips user plugins' prompt sections) | Nothing |
| Machine-wide CPU busy % and memory used % (while *Live CPU and memory* or a machine-load limit is on) | Pressure levels, meters, notices | Memory only (a short sliding window) |

**How the machine metrics are read.** One long-lived sampler process runs only while the
the status bar shows live CPU and memory (Setup → *Live CPU and memory*, on by default) or a machine-load limit is set. It stops when both are off or the session ends:

- **Windows:** `powershell.exe -NoProfile -NonInteractive` running a fixed script that calls
  `GetSystemTimes` and `GlobalMemoryStatusEx`, with a CIM fallback.
- **macOS:** `/bin/sh -c` running `top -l 0` (CPU line) and `sysctl kern.memorystatus_level`.
- **Linux:** no process. It reads `/proc/stat` and `/proc/meminfo`.

It reads totals only: no per-process data, no process names, nothing about other users.

## What it can change

| Change | When |
| --- | --- |
| Add a section to the system prompt (or, on managed machines, prompt context) with the active policies | Frontier Max, Release check, machine load, subagent limits or Autopilot are on, or the `milestones` tool is offered ("Run progress": record the run's steps with it) |
| Offer Claude one tool, `milestones` (`mcp__control-room__milestones`, `$.tool.register`). Its answer only records the list in the run plan; it reads and writes nothing else | Only where Claude Code offers no task list of its own (TodoWrite or the Task tools) and Behavior → *Run progress* is on (the default) |
| Add short hidden notes to the conversation, which Claude reads at its next request | Autopilot pending, resource pressure, or you changed a setting mid-session |
| Submit prompts in the session: the handoff prompt, one corrective retry, the continuation prompt | Only with the Context Autopilot on, or when you ask for a handoff |
| Run `/clear`; run `/compact` as a fallback | Only after a handoff whose file was verified as freshly written (`/compact` only if `/clear` fails and the fallback is allowed) |
| Set the reasoning effort or model of a request | Frontier Max (the maximum the model supports; never invented for models without effort), Model Router |
| Refuse a tool call; require approval; or answer an approval prompt with *allow* | Permission Policy and heavy-job gating (see the rules below) |
| Hide, refuse or ask about a subagent | Subagent Control |
| Continue a turn that stopped early, with a short message | No-Lazy-Exit Guard (capped per turn and per session) |
| Stop a background job that Claude started | Only when you press Stop in Guardrails → Machine load |
| Draw UI: the status bar above the prompt, the panel, compact tool rows, spinner text, status line, toasts; scroll its own pane back to the top (`$.ui.scroll`) | Always (Focus view and the status bar can be turned off). The scroll happens when you change section or press *↑ Sections* |
| Keep the Autopilot step under way in `$.state` (`autopilot`) | While a handoff is under way or waiting, so a reload of the plugin carries it on instead of starting a second one |
| Write its own store | Settings changes, run records |

**Permission rules that always hold:**

- A deny is never loosened, whether it comes from your rules, your organisation's managed
  settings or Claude Code.
- Plan mode is never overridden.
- *Allow* only answers a prompt Claude Code would otherwise show. It is not offered for edits
  outside the project, deleting files, push, force push or destructive Git, deploys, or dangerous
  commands. A saved *allow* for one of those (deleting files allowed it before 1.0.2, and a
  hand-edited store may) reads as *ask*, and the panel names it once.
- *Ask* forces an approval even where a rule or the permission mode would allow.
- Shell commands are tokenised and each segment is classified. The strictest finding wins. This
  is pattern-based and narrows what Claude may do. It is not a sandbox.

## What it never does

- No network requests, telemetry or analytics, and no hidden model calls. The guard's optional
  check is one small classification through Claude Code's own client, made only when the
  heuristics are unsure. Turn it off in Behavior → *Smart check*.
- It never reads your project's file contents or environment variables.
- It never writes your files. Claude writes `NEXT_SESSION_PROMPT.md` with its normal,
  permission-checked tools.
- It never terminates or modifies programs other than its own sampler, and never stops a task
  you did not ask it to stop.
- It never bypasses organisation or managed restrictions.
- It never estimates or invents costs ("—" means Claude Code did not report one).
- It never claims or attempts an OS-level CPU or RAM quota.

## How it fails

- Every gating hook has a fallback. If Control Room's tool-call check itself fails, obviously
  dangerous shell commands are still refused, and everything else falls back to Claude Code's own
  behaviour. A failed approval check defers to Claude Code. A failed subagent check refuses the
  subagent while subagents are set to Off.
- A corrupt or hand-edited store falls back to defaults or repaired values, with a one-time notice.
- If the sampler fails, machine load shows "Readings unavailable", restarts up to twice, and the
  static policy still applies.
- The Autopilot never clears a context without a verified, freshly written handoff file. If the
  file is missing it asks once more, then waits for you.

## Data at rest

Claude Code keeps each plugin's store as JSON under `~/.claude/plugins/store/`. Control Room uses:

- `settings.v1`: your settings and custom profiles.
- `run.v1.<id>`, `runs.index.v1`, `runs.counter.v1`: run records. Each holds the project root
  path, session ids, start and end times, peak and last context, reported cost, turn counts, model
  ids, end reasons and transitions, and for run progress the run's objective (the first sentence
  of your latest substantial request, at most 140 characters) and Claude's task list (subjects and
  statuses, at most 60). At most 30 runs and 60 sessions per run are kept; older ones are pruned.

Beyond that objective and the task subjects, no prompt text, answer text, tool input, diff or file
content is persisted. `/cr reset confirm` clears the settings; uninstalling the plugin removes the
plugin itself.

## Reporting a vulnerability

Please report security issues privately with GitHub's *Report a vulnerability* (the repository's
Security tab), not in a public issue. Include the Claude Code version (`claude --version`), your
platform, and steps to reproduce. You will get an acknowledgement, and a fix or mitigation plan
will be tracked in the advisory.
