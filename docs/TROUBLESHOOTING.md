# Troubleshooting

Start with `/cr status`, which prints every system's state on one screen. For anything deeper,
run Claude Code with `claude --debug`. The debug log names every Control Room hook that ran,
anything the engine refused, and why.

## Control Room doesn't load

- **Check the version.** Run `claude --version`; 2.1.289 or newer is needed.
- **Validate the folder.** `claude plugin validate /path/to/plugins/control-room` reports what
  the engine would refuse.
- **Installed via a marketplace:** `claude plugin list` should show `control-room@control-room`
  as enabled, with `Read from:` naming your folder. After you pull changes, run `/reload-plugins`
  in the session.
- **Desktop:** the Code tab's local sessions load installed plugins and folders named in
  `CLAUDE_CODE_PLUGIN_DIRS` in the `env` block of `~/.claude/settings.json`. Start a new session
  after changing either.
- **Desktop shows an older version** (for example the 0.1 status bar, `CTX … | AUTO 700k`): the
  Code tab loads the copy recorded in `~/.claude/plugins/installed_plugins.json`, not the folder.
  Run `claude plugin update control-room@control-room`, then start a new session.
- **Organisation policy:** managed settings can disable plugins. Control Room cannot and does not
  work around that.

## `/cr` does nothing, or goes to Claude

- `/cr` is only registered when no other command uses that name. `/control-room` always works.
- In `claude -p "/cr status"`, a plugin's command given as the *initial* prompt is sent to the
  model, because plugin commands register as the session starts. Use an interactive session,
  stream-json input, or the panel.

## The panel doesn't appear

- In the terminal, a pane that opens on its own (*Open at session start*) waits for at least
  144 columns. Type `/cr` and it opens at any width.
- On surfaces without a pane, `/cr` prints the status and points to the sub-commands.
- Pressing **Esc** returns the keyboard to the prompt. `/cr open` or a click focuses the panel again.

## The status bar is missing

- `/cr hud band` (or `both`). The band steps aside while Claude Code shows one of its own
  surveys there, and comes back afterwards.
- With `/cr hud status`, it is on Claude Code's status line instead.

## Context Autopilot

| Symptom | Cause and fix |
| --- | --- |
| Threshold reached but nothing happens | The handoff starts when the current turn ends. Claude is first asked to finish the step it is on (**Handoff soon**). **Hand off now** starts it at once; **Later** postpones it. |
| "Handoff notes were not written, so the context was not cleared" | Control Room only clears after `NEXT_SESSION_PROMPT.md` (or your configured file) was written during the handoff. Claude gets one reminder; after that it waits for you. Check that Claude may write files in the project (permission mode, Permission Policy *Project file changes*). Then run `/cr handoff` again, or `/cr fresh` once the file exists. |
| Waiting for you | `/clear` was refused and compaction was not allowed or also failed, or the continuation is `manual`. Press **Start fresh context** (or `/cr fresh`). |
| The threshold is lower than I set | It is kept below Claude Code's own auto-compact point, so the handoff runs first. The Context section shows the clamp. |
| The fresh context didn't continue by itself | *Auto-continue* is off, or the session was waiting on an approval. Ask Claude to continue from `NEXT_SESSION_PROMPT.md`. Your policies and profile are already active. |

## Permission Policy

- **"Control Room Permission Policy: … is set to Deny"**: change that category in Guardrails →
  Permissions. Deny categories are refused before any dialog, in every permission mode.
- **Unexpected approval prompts in bypass or auto mode:** a category set to **Ask** forces an
  approval even where the mode would allow it. Set it to *Default* to restore Claude Code's own
  behaviour.
- **Headless runs (`claude -p`, CI) failing on installs, deletes or pushes:** with no one to
  answer, Claude Code refuses an Ask. Set those categories to *Default* for headless use.
- **Allow had no effect:** Allow only answers a prompt Claude Code would show. It never lifts a
  deny rule, never acts in plan mode, and is not available for high-risk categories.

## Machine load

- **"Load unavailable" / "Readings unavailable"**: the sampler could not start or stopped. It restarts up to twice.
  On Windows it uses `powershell.exe`. On macOS it uses `/bin/sh`, `top` and `sysctl`. On Linux
  it reads `/proc`. Restricted shells or policies can block these, and the static policy still
  applies.
- **Readings look high:** they are machine-wide totals, including other programs. That is
  intended, because the goal is to keep the machine responsive. Control Room never stops or
  changes other programs.
- **A heavy command was "held back":** over a ceiling, Control Room refuses *additional* heavy
  jobs (tests, builds, installs…). Claude is told why and can wait or run fewer at once. Set
  *When over* to *Just tell Claude* to only notify, or raise the level.

## Model router

- **"not seen answering yet this session"**: the main conversation is only routed to a model id
  Claude Code has already reported in this session (it rejects bare aliases on requests). For
  example, once an Explore subagent has run on Haiku, Economy can route quick turns to Haiku.
- **"was refused — the session model is kept"**: that model isn't available to you (plan,
  organisation allowlist, provider). The Router won't choose it again this session.

## Lazy-exit guard

- **It continued when the work was done:** use strictness *lenient*, or end the work with the
  verification evidence (tests run, results). The guard credits completion evidence.
- **It never triggers:** it only judges turns you started, stands down during handoffs, in plan
  mode and while Claude's background work runs, and has per-turn and per-session caps (Behavior).

## Focus view

It changes presentation only. Press `▸` on a row to expand it, or see everything in Activity
(Tool calls / Changes). `/cr focus off` restores Claude Code's own rows.

## Cost shows "—"

Claude Code didn't report a cost for that session (some hosts or providers don't). Control Room
never estimates. A run total with `+` includes sessions whose cost was not reported.

## Resetting

`/cr reset confirm` restores every setting to the Normal profile and keeps custom profiles. To
start from nothing, uninstall the plugin and delete its store file under
`~/.claude/plugins/store/` (named after the plugin).
