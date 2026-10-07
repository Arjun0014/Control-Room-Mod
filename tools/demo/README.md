# Demo driver (development only)

Not part of the plugin and never installed. It fills Control Room with a short piece of real work
so the status bar and the panel can be captured for the README without a model: the repository's
terminal screenshots come from it.

`/demo` submits a request ("The ISS speed test fails. Fix it, add orbitalPeriod with a test, and
document the helpers.") and answers each model step of that turn from a script, with a
`turn.step` hook that yields the step's text and tool calls itself. So the turn is a genuine
engine turn: Claude Code runs every tool call in it through Control Room's hooks, its own
permission check and the tool itself. In the sample project in `project/` the turn records four
milestones (with Control Room's `milestones` tool where it is offered, else TodoWrite), reads and
searches the code, runs `npm test` (which fails), fixes the bug, runs the tests again (they pass),
writes a new module with its test, runs `npm run lint` (there is no lint script, so it fails) and
edits the README. Every other turn goes to the model as usual.

Only the words and the token counts are scripted: the context reading climbs from 41% to 51% of
the window. Claude Code reports no cost for a step no model answered, so the cost stays $0.00.
No login is needed.

| Command | What it does |
| --- | --- |
| `/demo` | Play the scripted turn, about a second per step |
| `/demo slow` | The same, four seconds per step, to capture the status bar while it runs |
| `/demo calls` | Replay the same work as bare tool calls outside any turn (no top line, no This turn) |

On Windows, with [tools/console](../console/README.md):

```powershell
Copy-Item -Recurse -Force tools\demo\project\* C:\path\to\a\trusted\folder\
.\tools\console\console.ps1 launch -Dir C:\path\to\a\trusted\folder -Cols 150 -Lines 48 -Font 'Cascadia Mono' `
  -Claude 'claude --plugin-dir C:\path\to\Control-Room-Mod\tools\demo --allowedTools "Edit Write Bash(npm test) Bash(npm run lint)"'
.\tools\console\console.ps1 send -Spec 'text:/demo|enter'
```

The launch adds `--plugin-dir plugins/control-room` itself. A turn edits the sample files, so copy
`project/` back before the next one, and empty the folder afterwards.
