# Security and privacy

Claude Code plugins with function hooks ("mods") are highly privileged: they see what Claude
does and can change it. Project Sentinel (called Control Room until 1.4.0; its panel still is) is
written to be conservative. This page lists everything it can observe, everything it can change,
what it never does, and how it fails.

## In one paragraph

Project Sentinel runs inside Claude Code's plugin environment. It has no DOM, no Node.js and no
direct filesystem or network APIs; every action goes through Claude Code's plugin interface
(`$`), which validates and logs it. It makes **no network requests** of its own and sends **no
telemetry**. It hooks none of Claude Code's telemetry streams and collects no analytics. It never
reads environment variables, secrets, or the contents of your project's files. It persists only
its own settings, run records and what it learned about the prompt cache in Claude Code's
per-plugin store. Two features ask Claude Code to send a request to your model, and both are
visible in the panel: the guard's optional smart check, and **Keep warm** (off by default), which
re-sends the conversation's last request so the prompt cache stays warm. Run
`claude plugin validate plugins/project-sentinel` to see every engine call the code can make.

## Privacy

Project Sentinel collects nothing for anyone but you. It has no server, no account, no telemetry
and no analytics, and makes no network request of its own: the only requests that leave your
machine are Claude Code's own model requests, including the ones it asks Claude Code to make
(listed under [What it can change](#what-it-can-change): Autopilot's prompts, the guard's optional
check, Keep warm's refreshes). What it reads stays in memory, and what it keeps (your settings and
run records, [Data at rest](#data-at-rest)) stays in Claude Code's plugin store on your machine
until you delete it. It is not directed at children. Questions: open an issue on the repository.

## What it observes

| Data | Used for | Kept |
| --- | --- | --- |
| Session figures: context tokens, window and percent, cost in USD *as Claude Code reports it*, the model id, the session id, the Claude Code version, the attached surfaces | HUD, Context Autopilot threshold, Session Chain | Run records (see [Data at rest](#data-at-rest)) |
| The prompts you submit, and Claude's final message when a turn stops | Model Router task class (keyword match). No-Lazy-Exit Guard comparison of the request with the final answer. The first sentence of your latest substantial request is the run's *objective* in Activity. | The objective: in the run record. The rest: memory only, for the current turn |
| Tool calls as they happen: tool name, and input such as a shell command or file path; whether each succeeded, and for a failed or refused call the first line of its answer | Permission Policy classification, the heavy-command check, Activity (Attention, Validation), Focus View rows | Memory only (last 300 calls) |
| Edit/Write results (the structured patch Claude Code returns; for a file written whole, its content as the added lines) | The Changes view's per-file diffs | Memory only (200 files, hunks capped) |
| Claude's own task list: the inputs and results of TodoWrite, TaskCreate, TaskUpdate and TaskList, or of Project Sentinel's `milestones` tool where it is offered (subjects, statuses, the "doing" form) | Run progress in Activity and the status bar; after a handoff, the open milestones are named in the fresh context so its task list carries on | In the run record (at most 60 tasks) |
| The names of the tools Claude is offered (`$.tool.list`), at session start and at the start of each turn | To see whether Claude Code offers a task list, so the `milestones` tool is added only where none exists; and to see a tool added or removed, which rebuilds the prompt cache | Nothing |
| Each main-conversation request's token counts as Claude Code reports them (sent uncached, read from the cache, written to it), its model and its effort; the name of Claude Code's output style | Cache Guardian: what the cache holds, how long it stays warm, why it was rebuilt | Memory only, for the current context (totals and the last 20 rebuilds). In `cache.v1`: the cache's lifetime and the short names of models on which an effort change rebuilt it |
| A model switch as Claude Code reports it (`classic.PreModelSwitch`, `classic.PostModelSwitch`): from and to which model, who made it, whether the cache is warm, its lifetime, the context's tokens, Claude Code's estimate of the cost of re-caching | *Ask before a model switch*; the cache's lifetime | The lifetime, in `cache.v1` |
| In the terminal only: whether the project is a Git repository (`$.session.repo`) and the output of `git status --porcelain=v1 --branch` | The branch, how far it is ahead or behind, and how many files are uncommitted, in Overview and `/cr status` | Memory only: the branch name and the counts. The file paths in the output are not kept |
| From the tool calls above: which documentation files the handoff turn changed and the fresh context read, whether the notes and CLAUDE.md were written, which checks ran | Handoff Health and Continuity (Context → *Last handoff*) | In the run record (`lastHandoff`): at most two file names per item (more as a count) and the subject of the milestone under way, as the run's plan already holds it |
| File *metadata* only (`stat`): the handoff file's modification time; the real path of a file Claude is about to edit | Verifying that the handoff was written; detecting edits outside the project, including through links | Nothing |
| The running subagents list (type, status, description) | Subagent counts and limits | Memory only |
| When a turn stops (`classic.Stop`): the background jobs still running (their description, else their command, cut to 80 characters) and the scheduled wake-ups (their schedule and whether they recur), and whether Claude's final message ends with a question | The status bar's headline between turns: *Waiting for the test run*, *Waiting to check back · wakes at 06:12*, *Waiting for your answer* | Memory only, until the next turn (at most 8 of each) |
| The names of registered slash commands | Only so as not to take `/cr` if something else uses it | Nothing |
| Whether managed (organisation) policy settings exist (only whether any key is set) | Choosing how to deliver policies (system prompt, or prompt context where a managed guard skips user plugins' prompt sections) | Nothing |
| Claude Code's own verdict on a call set to *Ask* (`$.tool.check`: allow, ask or deny, from your rules and the permission mode; the check runs nothing) | Asking you itself only where Claude Code would not | Nothing |
| Once, when it first loads after the rename: the store file it kept as Control Room (`plugins/store/control-room_<source>-<id>.json` in Claude Code's configuration folder, found from the environment variables `CLAUDE_CONFIG_DIR`, `USERPROFILE` or `HOME`, or from the session's transcript path; of several, the one written last, by its modification time) | Carrying your settings, runs, Quest log and cache memory over | What it copied, in its own store; the old file is never changed |
| When it loads: whether Control Room (the former name) published its status bar in this session (`$.state`, `control-room` `hud`) | Standing by, passing every event on, while Control Room still runs in the session | Nothing |
| With Kit on: where you click in Kit's lane (the cell, in the lane's own coordinates) | Kit's reaction | Nothing |
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
| Add a section to the system prompt (or, on managed machines, prompt context) with the active policies | Frontier Max, Release check, machine load, subagent limits or Autopilot are on, the `milestones` tool is offered ("Run progress": record the run's steps with it), or an answer style other than Standard is chosen (how to write messages to you, never code, files or commit messages; it stands down while you use one of Claude Code's own output styles) |
| Offer Claude one tool, `milestones` (`mcp__project-sentinel__milestones`, `$.tool.register`). Its answer only records the list in the run plan; it reads and writes nothing else | Only where Claude Code offers no task list of its own (TodoWrite or the Task tools) and Behavior → *Run progress* is on (the default) |
| Add short hidden notes to the conversation, which Claude reads at its next request | Autopilot pending, resource pressure, or you changed a setting mid-session (while *Keep policies stable* holds a warm cache, the note carries the policies now in force) |
| Keep its own system-prompt section as it was while the prompt cache is warm | *Keep policies stable* (on by default): a setting changed mid-context reaches Claude as a note instead of rebuilding the cache |
| Ask Claude Code to re-send the main conversation's last request with one short message, `Control Room cache keep-alive (automatic, not from the user): reply with the single word ok and nothing else.` (`$.model.fork`). The request and its answer are never added to the transcript | Only with *Keep warm* on (off by default), while you are away, shortly before the cache would lapse, up to the idle limit you set. Each refresh costs tokens, mostly cache reads. The panel shows the next refresh and how many were made |
| Ask you to confirm a model switch, with the reason (answers Claude Code's model-switch check with *ask*) | A switch you make that would re-send 100k or more warm tokens, while *Ask before a model switch* is on (the default). It never refuses one |
| Run `git status --porcelain=v1 --branch --untracked-files=normal` (`$.process.run`, read-only, 10-second timeout) | In the terminal, inside a Git repository: at session start and after a turn, at most every 15 seconds |
| Draw Kit with a surface module (`hooks/kit.client.tsx`), which runs on the surface's drawing thread (in the terminal, and in Desktop's own page) with no access to `$`: it gets only Kit's mood, a caption, the calm switches, the local hour, when the context began, and four counts or times (milestones done, a green finish, failed checks, a Keep warm refresh); a click on it is only a reaction; it posts only `{ fault }` if it cannot draw, which leaves Kit out | Only with the companion on (off by default). VS Code, which draws no surface module, gets a still image instead |
| Submit prompts in the session: the handoff prompt, one corrective retry, the continuation prompt | Only with the Context Autopilot on, or when you ask for a handoff |
| Add one block to a fresh context's first message (`prompt.context`, named `contextAutopilot`): the run and session numbers, the handoff notes' path, the run's milestones and its objective | Only once, in the fresh context after its own handoff |
| Run `/clear`; run `/compact` as a fallback | Only after a handoff whose file was verified as freshly written (`/compact` only if `/clear` fails and the fallback is allowed) |
| Set the reasoning effort or model of a request | Frontier Max (the maximum the model supports; never invented for models without effort), Model Router |
| Refuse a tool call; or, before a call set to *Ask* goes on, ask you in Claude Code's question dialog (`$.ui.ask`, *Run it* / *Don't run it*) | Permission Policy and heavy-job gating (see the rules below). It never answers a permission check |
| Hide, refuse or ask about a subagent | Subagent Control |
| Continue a turn that stopped early, with a short message | No-Lazy-Exit Guard (capped per turn and per session) |
| Stop a background job that Claude started | Only when you press Stop in Guardrails → Machine load |
| Draw UI: the status bar above the prompt, the panel, compact tool rows, spinner text, status line, toasts; scroll its own pane back to the top (`$.ui.scroll`) | Always (Focus view and the status bar can be turned off). The scroll happens when you change section or press *↑ Sections* |
| Write a line to Claude Code's debug log (`$.ui.log` with `to: 'debug'`): each turn's start and end and whose turn it is (yours, the handoff, the continuation), each Autopilot step, and where the handoff notes stand. Never on screen: the log exists only when you start Claude Code with `--debug` or `--debug-file` | At those moments. A line holds no prompt or answer text: only turn ids, step names, the handoff file's path, its size and age |
| Keep the Autopilot step under way in `$.state` (`autopilot`) | While a handoff is under way or waiting, so a reload of the plugin carries it on instead of starting a second one |
| Keep in `$.state` (`standby`) whether it told you it stands by | In a session that still runs Control Room, so the note shows once per session, not at every reload |
| Write its own store | Settings changes, run records; once, what it carried over from the store it kept as Control Room (never over what its own store holds), with a marker, `migrated.v1` |

**Permission rules that always hold:**

- A deny is never loosened, whether it comes from your rules, your organisation's managed
  settings or Claude Code.
- Plan mode is never overridden.
- It never answers a permission check, and there is no *Allow* (removed in 1.4.0): only Claude
  Code and you approve a call. A saved *Allow* reads as *Default*; a toast says so once, and Guardrails for that session.
- *Ask* always asks. Where Claude Code would ask anyway, its own prompt does. Where it would not
  (an allow rule, auto mode, Bypass permissions), Project Sentinel asks in Claude Code's question
  dialog first and passes the call on only after *Run it*, so your rules and other hooks still
  apply to it. Which case it is comes from Claude Code's own verdict (`$.tool.check`).
- Shell commands are tokenised and each segment is classified. The strictest finding wins. This
  is pattern-based and narrows what Claude may do. It is not a sandbox.

## What it never does

- No network requests of its own, no telemetry or analytics, and no model calls you cannot see.
  The guard's optional check is one small classification through Claude Code's own client, made
  only when the heuristics are unsure. Turn it off in Behavior → *Smart check*. Keep warm's
  refreshes go through Claude Code's own client too, only while you turned it on, and the panel
  lists them.
- It never reads your project's file contents or environment variables. `git status` says which
  files changed, not what is in them, and Project Sentinel keeps only the counts.
- It never writes your files. Claude writes `NEXT_SESSION_PROMPT.md` with its normal,
  permission-checked tools.
- It never terminates or modifies programs other than its own sampler, and never stops a task
  you did not ask it to stop.
- It never bypasses organisation or managed restrictions.
- It never estimates or invents costs ("—" means Claude Code did not report one).
- It never claims or attempts an OS-level CPU or RAM quota.

## How it fails

- Every gating hook has a fallback. If Project Sentinel's tool-call check itself fails, obviously
  dangerous shell commands are still refused, and everything else falls back to Claude Code's own
  behaviour. If Claude Code's verdict cannot be read for a call set to *Ask*, it asks you; if the
  question cannot be shown or is not answered, the call is refused. A failed subagent check refuses
  the subagent while subagents are set to Off.
- A corrupt or hand-edited store falls back to defaults or repaired values, with a one-time notice.
- If the sampler fails, machine load shows "Readings unavailable", restarts up to twice, and the
  static policy still applies.
- The Autopilot never clears a context without a verified, freshly written handoff file. If the
  file is missing it asks once more, then waits for you.
- A Keep warm refresh that fails is tried again in two minutes while the cache can still be
  saved. If refreshes do not hold the cache, Keep warm says so and stops itself until you turn it
  on again.
- If `git status` fails or takes longer than 10 seconds, the Git line is left out. If Kit's module
  fails to draw, it says so and Kit is left out until the plugin reloads; the status bar draws
  without it.
- If the store it kept as Control Room cannot be found or read, nothing is carried over and it
  starts from defaults; it does not try again.

## Data at rest

Claude Code keeps each plugin's store as JSON under `~/.claude/plugins/store/`, one file per
plugin name and source (`project-sentinel_<source>-<id>.json`). Project Sentinel uses:

- `settings.v1`: your settings and custom profiles.
- `run.v1.<id>`, `runs.index.v1`, `runs.counter.v1`: run records. Each holds the project root
  path, session ids, start and end times, peak and last context, reported cost, turn counts, model
  ids, end reasons and transitions, and for run progress the run's objective (Claude's statement
  of it through the `milestones` tool, or the first sentence of your latest substantial request; at
  most 140 characters) and Claude's task list (subjects and statuses, at most 60). With the Quest
  log style, a run also keeps its XP and the milestones already paid for (their subjects in lower
  case, at most 200). At most 30 runs and 60 sessions per run are kept; older ones are pruned.
- `quest.v1`, only once the Quest log style has earned something: the total XP, when each
  achievement was unlocked, and the last 8 award lines, which may name a milestone ("Milestone:
  Fix orbitalSpeed") or a kind of check ("Tests pass").
- `cache.v1`, once the prompt cache taught it something: the cache's lifetime (`5m` or `1h`) and
  how it was learned, Keep warm's verdict on itself and when it was reached, and the short names
  of models on which an effort change rebuilt the cache (`opus-5-5`; at most 12).
- In a run record, `lastHandoff` after a handoff: when it happened, from and to which session, and
  the Handoff Health and Continuity items with a short detail each, which may name up to two
  documentation files ("README.md, DESIGN.md +1"), the handoff file, a check's outcome ("Tests
  passed"), and the milestone under way then (its subject, as the run's plan already holds it).

- `migrated.v1`: when it looked for the store it kept as Control Room, which file it read, and
  how many keys it copied. That old file (`control-room_<source>-<id>.json`) stays as it was;
  delete it once you no longer want Control Room's copy.

Beyond that objective, the task subjects, those award lines and those handoff details, no prompt
text, answer text, tool input, diff or file content is persisted. `/cr reset confirm` clears the
settings; deleting the store file removes everything; uninstalling the plugin removes the plugin
itself.

## Reporting a vulnerability

Please report security issues privately with GitHub's *Report a vulnerability* (the repository's
Security tab), not in a public issue. Include the Claude Code version (`claude --version`), your
platform, and steps to reproduce. You will get an acknowledgement, and a fix or mitigation plan
will be tracked in the advisory.
