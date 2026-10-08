# Troubleshooting

Start with `/cr status`, which prints every system's state on one screen. For anything deeper,
run Claude Code with `claude --debug`. The debug log names every Project Sentinel hook that ran,
anything the engine refused, and why.

## Project Sentinel doesn't load

- **Check the version.** Run `claude --version`; 2.1.289 or newer is needed.
- **Validate the folder.** `claude plugin validate /path/to/plugins/project-sentinel` reports what
  the engine would refuse.
- **Installed via a marketplace:** `claude plugin list` should show
  `project-sentinel@control-room` as enabled, with `Read from:` naming your folder. After you pull
  changes, run `/reload-plugins` in the session.
- **Still `control-room@control-room` after 1.4.0** (the plugin was renamed): run
  `claude plugin marketplace update control-room`. The marketplace maps the old name to the new
  one, so the update moves your install over (your `enabledPlugins` entry included), and the next
  session loads Project Sentinel and copies your settings and run history over once.
- **An open session still shows Control Room after the update:** Claude Desktop hands a session
  its plugins when the session starts, so a session open during the update keeps Control Room.
  Project Sentinel stands by in it (one note: *Project Sentinel is installed. Control Room keeps
  this session until it restarts.*) and takes over in the next session.
- **Desktop:** the Code tab's local sessions load installed plugins and folders named in
  `CLAUDE_CODE_PLUGIN_DIRS` in the `env` block of `~/.claude/settings.json`. Start a new session
  after changing either.
- **Desktop shows an older version** (for example the 0.1 status bar, `CTX … | AUTO 700k`): the
  Code tab loads the copy recorded in `~/.claude/plugins/installed_plugins.json`, not the folder.
  Run `claude plugin update project-sentinel@control-room`, then start a new session.
- **Organisation policy:** managed settings can disable plugins. Project Sentinel cannot and does
  not work around that.
- **Settings or runs missing after the rename:** they are carried over once, when Project Sentinel
  first loads outside a session that still runs Control Room, from the store written last in
  Claude Code's configuration folder (`CLAUDE_CONFIG_DIR`, else `.claude` in your home folder), and
  only into an empty store. The old file (`~/.claude/plugins/store/control-room_<source>-<id>.json`)
  is never changed, so nothing is lost; `claude --debug` names what was carried
  (`carried … keys over from control-room_…`).

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

## Work progress is missing, or reads oddly

- **No Work meter:** progress comes from Claude's own task list (TodoWrite or the Task tools).
  Until Claude keeps one for the run, there is nothing to count, so nothing is shown. Asking for a
  task list ("plan this as a checklist first") gives it one.
- **The total changed after a handoff:** the fresh context is handed the run's whole list and its
  objective and asked to carry them on under the same titles. If it still lists its open work
  differently, its list replaces the earlier context's open work; finished milestones always stay
  counted.
- **The headline names a milestone being verified:** only when none is in progress. The one in
  progress is the work under way.
- **CPU and RAM left the status bar:** calm readings stay in the panel (Overview, Guardrails).
  The status bar names them only near a ceiling.
- **The cost in the status bar is higher than this session's:** it is the whole run's total, which a
  handoff never resets. Each session's own cost is in Context → Run.
- **The names went from the readings:** below 72 columns the instruments stand alone, and the
  meter and the track shorten before a reading is dropped. Widen the terminal, or close the docked
  panel, to see them again. On Desktop each reading keeps its caption at every width.
- **The headline reads `Ready`, or the objective, dim:** no turn has run in this context yet. It
  says what Claude is doing once a turn starts.
- **The headline reads `Waiting for …` after the turn ended:** Claude left a background job
  running or scheduled a wake-up, so the run will come back by itself; or a milestone is marked
  waiting. `Waiting for your answer` means Claude's last message asked you something.
- **A white bar in the middle of the status bar on Desktop:** that was 1.2.0, whose animated work
  track Desktop drew in a frame of its own default size. 1.3.0 draws every graphic as an image.
  Update (`claude plugin update project-sentinel@control-room`) and start a new session.
- **No Cache reading:** it appears once Claude has answered in this context, and only for a prompt
  of 4,096 tokens or more.
- **Kit is missing:** see [Kit](#kit-the-companion).

## Answer styles and the Quest log

- **Claude doesn't write in the chosen style:** one of Claude Code's own output styles (`/config`)
  is in charge, and Behavior reads *Paused*. Set it back to Default. A change mid-session reaches
  Claude at its next request.
- **No XP:** XP is earned only while the Quest log style is chosen, and only for outcomes Control
  Room can count: a milestone done (Claude must keep a task list), a check passing, a finished plan,
  a verified handoff. Each milestone pays once per run, and a check's first pass once per turn.
- **Claude names points or levels:** it is asked not to. The numbers in Activity and the status bar
  are Project Sentinel's own.

## The prompt cache

Claude Code reports how many tokens each request read from the cache and wrote to it. The rest
(the expiry, the hit ratio, why it was rebuilt) is derived from those, and the panel says so.

- **"Lifetime not known yet"**: Claude Code reports the cache's lifetime only at a model switch.
  Otherwise Project Sentinel learns it: a request that still reads the cache after more than five
  idle minutes proves the one-hour cache, and with Keep warm on, one refresh six minutes after the
  last request tells. On a claude.ai plan it starts at the one-hour cache (*1-hour cache, the
  plan's default*) until a request shows otherwise. Until it is known the status bar reads `warm`,
  then `lapsed?` once you have been away five minutes; never while Claude is working. Once learned,
  it is remembered across sessions.
- **It said `lapsed?` while a long command ran** (before 1.4.0): Claude Code's own requests keep
  the cache warm during a turn, so now it stays `warm` until the turn ends, unless the five-minute
  lifetime is known.
- **"Cache rebuilt: 446k tokens · Model changed"**: the request after a change had to write the
  conversation to the cache again, at a higher price than reading it. Context → Cache health says
  what happened and what would avoid it. The usual causes: switching models or effort in the
  middle of a context, the model router switching models, a setting changed with *Keep policies
  stable* off, an MCP server or plugin connected mid-session, or a long break. Compaction always
  rebuilds it, and reads *Expected*.
- **"Unexplained"**: nothing Project Sentinel saw changed. Once is usually the server evicting the
  cache. If it keeps happening, check for a proxy or gateway between Claude Code and the API that
  does not keep the cache.
- **A model switch asks first**: *Ask before a model switch* (on by default) confirms a switch that
  would re-send 100k or more warm tokens. Switch at the start of a fresh context instead, or turn it
  off (`/cr cache guard off`).
- **"Effort changes rebuild the prompt cache on …"**: Project Sentinel saw an effort change rebuild the
  cache on that model before, so it says so before the next request.

### Keep warm

- **It does not refresh**: the line under *Keep warm while you are away* says why. It refreshes
  only while you are away (Claude's own requests keep the cache warm while it works), while the
  context holds at least 20k tokens, while no handoff is about to clear the context, and until the
  idle limit (*Stop after*; 45 minutes at most for the five-minute cache, past which refreshing
  costs more than a rebuild). If the machine slept past the expiry, the cache lapsed and the next
  request rebuilds it.
- **"Retrying in 2 min"**: a refresh failed (the API refused it, or no reply came). It tries again
  while the cache can still be saved.
- **"It did not keep the cache warm here, so it stopped"**: a refresh must carry the cache past
  its old expiry, and here it did not, or two refreshes sent in time found the cache gone.
  Something between Claude Code and the API (a proxy, a gateway, another provider) may not keep
  the cache alive. Turn Keep warm off and on again to let it try afresh.
- **What it costs**: each refresh re-sends the conversation as cache reads (a tenth of the input
  price) plus a one-word reply. Context → Cache counts the refreshes.

## Kit, the companion

- **Kit doesn't appear**: it is off by default (Setup → *Companion*, or `/cr companion on`). It
  lives in a lane above the status bar, so not with `/cr hud status`, and not on mobile. VS Code
  shows it still, in its mood's pose.
- **Kit appeared, then went away**: its drawing failed on this surface, so Project Sentinel left it
  out and the status bar draws without it. `/reload-plugins` tries again; `claude --debug` names
  the reason.
- **It moves too much**: Setup → *Reduce motion* (or `/cr motion off`) holds it in one pose. On a
  busy machine (the processor near its ceiling) it draws two frames a second and stops walking; at
  the machine's limit it holds still.
- **It is tired all the time**: the processor is near the ceiling set in Guardrails → Machine load,
  or the context is nearly full. Memory alone does not tire it.
- **A click does nothing much**: a click is a reaction (a purr, a hop, a spin…; several clicks in a
  row make it dizzy). While Claude works it only looks up; asleep, it is startled. It never opens
  anything: the status bar's *Control Room* button opens the panel.
- **It walked off and did not come back**: it carries the notes off at a handoff and stays away
  until the handoff ends; then it walks back in from the left.

## Git

The Git line (Overview's run header and `/cr status`) is terminal only: Desktop shows Git beside
the session. It needs a Git repository and `git` on the `PATH`, and it is read at session start and
after each turn, at most every 15 seconds, so a change you make by hand shows after the next turn.

## Context Autopilot

| Symptom | Cause and fix |
| --- | --- |
| Threshold reached but nothing happens | The handoff starts when the current turn ends. Claude is first asked to finish the step it is on (**Handoff soon**). **Hand off now** starts it at once; **Later** postpones it. |
| "Handoff notes were not written, so the context was not cleared" | Project Sentinel only clears after `NEXT_SESSION_PROMPT.md` (or your configured file) was written during the handoff. Claude gets one reminder; after that it waits for you. Check that Claude may write files in the project (permission mode, Permission Policy *Project file changes*). Then run `/cr handoff` again, or `/cr fresh` once the file exists. |
| Waiting for you | `/clear` was refused and compaction was not allowed or also failed, or the continuation is `manual`. Press **Start fresh context** (or `/cr fresh`). |
| The threshold is lower than I set | It is kept below Claude Code's own auto-compact point, so the handoff runs first. The Context section shows the clamp. |
| The fresh context didn't continue by itself | *Auto-continue* is off, or the session was waiting on an approval. Ask Claude to continue from `NEXT_SESSION_PROMPT.md`. Your policies and profile are already active. |
| "This fresh context started working at 66k, close to the 64k handoff point, so it hands off at 86k" | A context after a handoff starts with the system prompt and tools, then reads the notes, the docs and the code before it works. With a threshold close to that, every context would hand off after a step or less. So it gets room to work from where it started working (20k, or a tenth of the threshold). Raise the handoff point (Context → *Hands off at*) so each context has room. |
| "The fresh context filled up before work began" (waiting for you) | It passed the handoff point and its room while still reading itself in: handing off again would only repeat that. Raise the handoff point, then **Start fresh** or carry on. |
| The handoff seems stuck at "Handing off" | Every step moves on when its turn starts or ends. `claude --debug-file <path>` traces each step (`autopilot: … → …`, `turn … started (handoff)`) to see where it stopped. A turn you queued runs first; the `/clear` waits for it. |
| *Last handoff* shows items missing | It counts what it saw in tool calls: *Project docs updated* needs a documentation file edited in the handoff turn, *Validation recorded* a check run in that context, and *Project docs read* a documentation file opened by the fresh context. `○` marks an item that was not needed (no milestones to save, CLAUDE.md left alone). The handoff itself went ahead; the list says what the fresh context may lack. |
| "Control Room reloaded in the middle of a handoff" | The plugin was reloaded (`/reload-plugins`, an update) while a handoff was under way. Autopilot picks up where it was; only when it cannot tell whether a step already happened (the handoff prompt was about to go out, or a compaction) does it wait for you, so nothing runs twice. Press **Hand off now** or **Start fresh**. |

## Permission Policy

- **"Control Room Permission Policy: … is set to Deny"**: change that category in Guardrails →
  Permissions. Deny categories are refused before any dialog, in every permission mode.
- **A question "Run it / Don't run it" in bypass or auto mode:** a category set to **Ask** asks
  you even where the mode would allow the call: Project Sentinel asks in Claude Code's question
  dialog, and the status bar reads *Waiting for you to approve*. Set the category to *Default* to
  leave it to Claude Code's own behaviour.
- **Headless runs (`claude -p`, CI) failing on installs, deletes or pushes:** with no one to
  answer, a call set to Ask is refused. Set those categories to *Default* for headless use.
- **Allow is gone (1.4.0):** answering permission prompts is left to Claude Code: add an allow
  rule (`/permissions`) or use one of its permission modes. A saved Allow reads as *Default*; a toast
  says so once, and Guardrails for that session. In Bypass permissions mode nothing changes.

## Machine load

- **"Load unavailable" / "Readings unavailable"**: the sampler could not start or stopped. It restarts up to twice.
  On Windows it uses `powershell.exe`. On macOS it uses `/bin/sh`, `top` and `sysctl`. On Linux
  it reads `/proc`. Restricted shells or policies can block these, and the static policy still
  applies.
- **Readings look high:** they are machine-wide totals, including other programs. That is
  intended, because the goal is to keep the machine responsive. Project Sentinel never stops or
  changes other programs.
- **A heavy command was "held back":** over a ceiling, Project Sentinel refuses *additional* heavy
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
(the summary, or *All tool calls*). `/cr focus off` restores Claude Code's own rows.

## Activity

- **A check is not under Validation:** checks are recognised by their runner (`npm test`, `pytest`,
  `cargo build`, `tsc`, `eslint`, `npm run check`, a script named for a simulation, …). A custom
  script with another name shows under *All tool calls* only.
- **"in the background"**: a check sent to the background has no outcome Project Sentinel can see.
- **"diff unavailable"**: no tool reported the lines (a file a shell command created, or a diff
  Claude Code skipped). Project Sentinel never shows `+0 −0` for an unknown change.
- **A file I care about is under "Generated and temporary"**: files in temp, cache and build
  folders (`dist`, `target`, `coverage`, …), in `.claude`, outside the project, and the handoff
  notes are grouped there. Press the row to open it.

## Cost shows "—"

Claude Code didn't report a cost for that session (some hosts or providers don't). Project Sentinel
never estimates. A run total with `+` includes sessions whose cost was not reported.

## Resetting

`/cr reset confirm` restores every setting to the Normal profile and keeps custom profiles. To
start from nothing, uninstall the plugin and delete its store file under
`~/.claude/plugins/store/` (named after the plugin).
