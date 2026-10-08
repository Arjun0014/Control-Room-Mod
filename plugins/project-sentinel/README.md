# Project Sentinel

Project Sentinel keeps long Claude Code runs on track. It adds a calm status bar above the prompt
(what the run is doing, its milestones, how full the context is, the prompt cache, machine load
and cost), the **Control Room** panel beside the conversation, and a set of switches you turn on
when you want them: **Context Autopilot** hands a run over to a fresh context before the current
one fills up, **Cache Guardian** keeps the prompt cache in view (and, if you ask, warm while you
are away), **permission categories** ask before or refuse risky kinds of calls, and **Kit** is an
optional pixel companion that shows what Claude is doing. It works in the terminal and in Claude
Desktop's Code tab, needs Claude Code 2.1.289 or newer, and was called Control Room before 1.4.0.

Everything stays on your machine. Project Sentinel sends nothing anywhere itself; the only
requests that leave are Claude Code's own model requests, as listed under
[What it does on your machine](#what-it-does-on-your-machine).

## Examples

1. **See a long run at a glance.** Install it and start a session: the status bar shows the run's
   milestones as a track (`2 of 10`), the context as a bar, the cache's state and the cost. Type
   `/cr` (or `/control-room`) to open the panel: Overview, Context, Behavior, Guardrails, Activity
   and Setup. `/cr status` prints the same summary as text.
2. **Let a run continue past a full context.** Type `/cr autopilot on` (or turn on *Autopilot* in
   Setup). When the context reaches the handoff point (70% by default), Project Sentinel asks
   Claude to write handoff notes to `NEXT_SESSION_PROMPT.md`, checks the file was written, runs
   `/clear`, and asks Claude in the fresh context to read the notes and carry on. The run's
   milestones and objective carry across.
3. **Be asked before risky calls.** Out of the box, installs, downloads, deletions, edits outside
   the project, pushes and deploys are set to *Ask*, and force pushes, resets and dangerous
   commands to *Deny*. So before Claude runs `git push` you are asked, even in a permission mode
   that would not ask (Claude Code's question dialog: *Run it* / *Don't run it*), and
   `git push --force` is refused with a reason Claude can read. Change any category in
   Guardrails; `/cr profile` switches everything at once (Normal, Frontier, Low resource,
   Release QA, or your own).
4. **Keep the cache warm while you step away** (optional, spends usage): `/cr cache keep on`.
   Shortly before the prompt cache would lapse, Project Sentinel re-sends the last request so the
   next one reads from the cache instead of rebuilding it. Off by default; it stops after two idle
   hours.
5. **Meet Kit:** `/cr companion on`. Kit paces while Claude thinks, types while it works, reads
   while it searches, celebrates a green finish and walks off with the notes at a handoff. Click
   it for a reaction. `/cr motion off` holds it still.

`/cr help` lists every command.

## What it does on your machine

Project Sentinel is a Claude Code plugin of function hooks. This is everything it does beyond
drawing its status bar and panel.

**Commands and prompts it sends in your session** (only when the feature is on):

- Context Autopilot (off by default): at the handoff point it submits a prompt asking Claude to
  write handoff notes (it names the notes file, the run and session numbers, how full the context
  is and where the milestones are kept), checks the notes file with a file-status read (size and
  time only), then runs `/clear` (or Claude Code's compaction, if you chose it) and submits a
  continuation prompt (the notes file's path and the session number). A retry prompt asks again
  if the notes were not written. The fresh context's first message carries one more context block,
  `contextAutopilot`: the run and session numbers, the notes file's path, the milestones and the
  objective.
- Short notes added to the conversation for Claude to read: that a handoff is near, that machine
  load is high (and later back to normal), that you changed a setting. Each begins
  *Control Room ·* and says only that.
- The lazy-exit guard (off by default): when Claude stops with work plainly unfinished, it asks
  Claude to continue, at most twice a turn. With its model check on, it asks Claude Code's small
  model whether the stop was premature (your request and the answer's end, as text).
- Keep warm (off by default): sends one short request through Claude Code, the conversation so
  far plus a *keep-alive* line asking for a one-word reply, so Anthropic's prompt cache stays warm;
  only while you are away, shortly before the cache would lapse. It spends usage.
- `TaskStop`, only when you press **Stop** on a background job in Guardrails → Machine load.

**What it adds to Claude's instructions:** a section of plain-language policies for the features
you turned on (Frontier Max, answer styles, subagent limits, machine load, milestones), readable
in the panel. It never hides instructions.

**What it decides about tool calls:**

- Permission categories (installs, network, downloads, edits, edits outside the project,
  deletions, commits, pushes, force pushes and resets, deploys, dangerous commands). *Default*
  leaves the call to Claude Code. *Ask* always asks you first: Claude Code's permission prompt
  does when it would ask anyway; otherwise Project Sentinel asks in Claude Code's question dialog,
  then passes the call on, so your settings rules and other hooks still apply. *Deny* refuses the
  call with a reason. To tell the two cases apart it queries Claude Code's own permission verdict
  (a check that runs nothing). It never answers a permission check, never allows a call Claude
  Code would not, and never loosens a deny.
- The command patterns in its source (for example a download piped into a shell, or a token sent
  to a remote host) exist to recognise risky commands so it can ask or refuse; it never runs them.
- With machine-load limits on, it holds back a new heavy job (a build or test suite) while the
  machine is at its ceiling and others are running, with a reason.
- Subagent limits (off by default) refuse a new subagent past the limit you set; the model router
  (off by default) picks a model and effort per step; Frontier Max (off by default) raises effort.
- It registers one tool for Claude, `milestones`, offered only where Claude Code has no task list
  of its own, to record the run's milestones.

**What it runs:**

- A CPU and memory sampler while *live load* is on (on by default; Setup turns it off),
  machine-wide totals only, every few seconds: on Windows one PowerShell process that calls
  `GetSystemTimes` and `GlobalMemoryStatusEx` (or reads the same totals over CIM where that is
  unavailable), on macOS `top` and `sysctl`, on Linux reads of `/proc/stat` and `/proc/meminfo`.
- In the terminal only: `git status --porcelain=v1 --branch --untracked-files=normal` in the
  project, for the branch and the count of uncommitted files.

**What it reads:** the session's usage and model from Claude Code; your prompts and tool calls in
memory, to show activity and progress; file status (never contents) of the handoff notes and of
paths Claude edits, to place them inside or outside the project; Claude Code's managed policy
settings, to know whether its policy section can be added; and once, after the rename, its own
settings file from when it was called Control Room, which it copies and never changes (the
environment variables `CLAUDE_CONFIG_DIR`, `USERPROFILE` and `HOME` are read only to find it).
In a session that still runs Control Room it reads Control Room's status bar, and stands by
until the session restarts.

**What it stores:** in Claude Code's own plugin store on your machine: your settings, run records
(the objective, in Claude's words or your latest request's, milestone titles and states, session
and handoff counts, token and cost totals, the project folder), the Quest log's XP and the
cache's lifetime once learned. Delete the store file to remove them.

**Privacy.** No telemetry, no analytics, no network calls of its own. Nothing leaves your machine
except through Claude Code's own model requests named above.

## More

Full documentation, configuration, troubleshooting and the source:
[github.com/Arjun0014/Control-Room-Mod](https://github.com/Arjun0014/Control-Room-Mod). MIT
licensed (see `LICENSE`). The engine's function-hooks API ("mods") is early access and may change
between Claude Code releases.
