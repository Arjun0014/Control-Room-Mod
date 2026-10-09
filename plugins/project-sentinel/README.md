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
   while it searches, celebrates a green finish and walks off with the notes at a handoff, and
   wanders the whole status bar in between. Pat its head, boop its nose or pet it: it reacts to
   where you touch it. `/cr motion off` holds it still.

`/cr help` lists every command.

## What it does on your machine

Project Sentinel is a Claude Code plugin of function hooks. This is everything it does beyond
drawing its status bar and panel. Each part answers one question Anthropic's plugin directory asks
of a plugin like this one.

### Prompts it submits, and what is in them

Only Context Autopilot (off by default) submits prompts, at most three per handoff, each as if you
had typed it, to the model your session already uses. They carry the text below and nothing read
from your files or copied from the conversation:

- **The handoff prompt.** How full the context is (tokens used of the window), the run and session
  numbers, and the request: verify the work; update the run's milestones (with its `milestones`
  tool or Claude Code's task list), the project's own documentation and, for durable instructions
  only, CLAUDE.md; write handoff notes to `NEXT_SESSION_PROMPT.md` at the project root; start no
  new work.
- **The retry prompt**, only when the notes file was not written: asks once more for it.
- **The continuation prompt**, in the fresh context after `/clear`: the notes file's path and the
  session number, asking Claude to read the notes and carry on. That first message also carries
  one context block, `contextAutopilot`: the run and session numbers, the notes file's path, the
  names of the policies that are on, the milestones' titles and states, and the run's objective
  (in Claude's words, or your latest request's).

It also adds short notes to the conversation for Claude to read, each beginning *Control Room ·*:
that a handoff is near, that machine load is high (and later back to normal), that you changed a
setting, or that a policy was held or restored.

### Commands it runs

Only `/clear`, at a Context Autopilot handoff, once the notes file is written (or Claude Code's
compaction instead, if you chose it). No other command.

### Tools it calls

Only `TaskStop`, for a background job Claude started, when you press **Stop** on that job in
Guardrails → Machine load. No other tool.

### What its tool-call hook does with the calls it sees

Every tool call passes through one hook. It reads the tool's name and input, in memory, to sort
the call into the permission categories, to recognise a heavy job (a build, a test suite, an
install) for machine load, to place an edited path inside or outside the project, and to count
activity. Then it does one of three things:

- passes the call on unchanged, which is what happens to nearly every call;
- asks you first, in Claude Code's question dialog, when its category is set to **Ask** and Claude
  Code would not ask anyway (*Run it* / *Don't run it*), then passes it on unchanged;
- refuses it with a reason Claude reads: its category is set to **Deny**; it is a new heavy job
  while machine-load limits are on, the machine is at its ceiling and other heavy jobs are running;
  or, should its classifier fail, it is an obviously destructive command.

It never changes a call's input, never answers a permission check, never allows a call Claude Code
would not, and never loosens a deny. To tell whether Claude Code would ask, it queries Claude
Code's own verdict, a check that runs nothing. The command patterns in its source (a download
piped into a shell, a token sent to a remote host) are there to recognise such commands so it can
ask or refuse; it never runs them.

### The one tool it answers itself

`milestones` (`mcp__project-sentinel__milestones`) is its own tool, offered to Claude only where
Claude Code has no task list of its own. Its hook answers the call by recording the run's
milestones (their titles and states) in memory and in the plugin's store. It answers no other tool
in that tool's place.

### Subagents

Its hook on starting a subagent does one of three things. With subagent limits on (off by default)
it refuses a new subagent while subagents are turned off, past your limit, or when you decline it
in the **Ask** dialog. With the model router's subagent routing on (the router is off by default)
it changes the **model** of the subagent being started, and nothing else. Otherwise it passes the
start on unchanged. It never changes a subagent's permission mode, tools, prompt or description,
and never starts one itself.

### Programs it runs

No shell. Each is one program, named with fixed arguments written out where it is started;
nothing from your session is passed to it, and what it prints stays in memory for the status bar:

- **Windows:** `typeperf "\Processor(_Total)\% Processor Time" "\Memory\Available Bytes" -si 2`
  (Windows' own performance-counter reader, one process while live load is on) and, once,
  `systeminfo /fo csv /nh` for the machine's total memory.
- **macOS:** `top -l 0 -s 2 -n 0` (one process while live load is on) and
  `sysctl -n kern.memorystatus_level` at each reading.
- **Linux:** no program; it reads `/proc/stat` and `/proc/meminfo`.
- **In the terminal only:** `git status --porcelain=v1 --branch --untracked-files=normal` in the
  project, for the branch and the count of uncommitted files.

Live load (machine-wide CPU and memory, every few seconds) is on by default; Setup turns it off.
On a Windows installed in a language other than English the counters have other names, so
`typeperf` finds none and the readings show as unavailable.

### What it reads

The session's usage and model from Claude Code; your prompts and tool calls in memory, to show
activity and progress; file status (never contents) of the handoff notes and of paths Claude
edits, to place them inside or outside the project; Claude Code's managed policy settings, to know
whether its policy section can be added; and the output of the programs above. In a session that
still runs Control Room it reads Control Room's status bar, and stands by until the session
restarts.

### Credentials

It reads no credentials: no API keys, tokens, passwords or login files. Once, after its rename,
it reads the store it kept when it was called Control Room (its own settings and run records, a
JSON file in Claude Code's plugin store) and copies them into its new store; it never writes,
moves or deletes that file. The environment variables `CLAUDE_CONFIG_DIR`, `USERPROFILE` and `HOME`
are read only to find it.

### What it sends, and where

Nothing it reads leaves your machine through the plugin. It makes no network requests of its own,
the programs above get only their fixed arguments, and its records stay in Claude Code's plugin
store on this machine. What leaves goes through Claude Code's own model requests, to the model
your session uses:

- the prompts and notes above;
- **Keep warm** (off by default; it spends usage): shortly before the prompt cache would lapse
  while you are away, one request of the conversation so far plus a *keep-alive* line asking for a
  one-word reply, so Anthropic's prompt cache stays warm; it stops after two idle hours (by default);
- the **lazy-exit guard** (off by default): when Claude stops with work plainly unfinished it asks
  Claude to continue, at most twice a turn; with its model check on, it first asks Claude Code's
  small model whether the stop was premature, sending your request and the end of Claude's answer.

### What it adds to Claude's instructions

A section of plain-language policies for the features you turned on (Frontier Max, answer styles,
subagent limits, machine load, milestones), readable in the panel. It never hides instructions.
The model router (off by default) picks a model and effort per step; Frontier Max (off by default)
raises effort.

### What it stores

In Claude Code's own plugin store on your machine: your settings, run records (the objective, in
Claude's words or your latest request's, milestone titles and states, session and handoff counts,
token and cost totals, the project folder), the Quest log's XP and the cache's lifetime once
learned. Delete the store file to remove them.

### Files it ships

Its hooks as readable TypeScript, its type declarations, this README, `LICENSE`, and
`.claude-plugin/icon.png`, the directory listing's icon: no code reads, loads or runs that image.

**Privacy.** No telemetry, no analytics, no network calls of its own. Nothing leaves your machine
except through Claude Code's own model requests named above.

## More

Full documentation, configuration, troubleshooting and the source:
[github.com/Arjun0014/project-sentinel](https://github.com/Arjun0014/project-sentinel). MIT
licensed (see `LICENSE`). The engine's function-hooks API ("mods") is early access and may change
between Claude Code releases.
