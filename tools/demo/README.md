# Demo driver (development only)

Not part of the plugin and never installed. It fills Control Room with a short piece of real work
so the panel and the status bar can be captured for the README without a model turn: the
repository's screenshots of Activity come from it.

`/demo` replays the work through genuine tool calls (`$.tool.call`), which run through Control
Room's hooks, Claude Code's permission check and the tools themselves. In the sample project in
`project/` it records four milestones (with Control Room's `milestones` tool where it is offered,
else Claude Code's Task tools, else TodoWrite), reads and searches the code, runs `npm test`
(which fails), fixes the bug, runs the tests again (they pass), writes a new module with its test,
runs `npm run lint` (there is no lint script, so it fails), edits the README and writes handoff
notes.

What it cannot show is a model turn: the context reading and the "now" line in the status bar
need one.

On Windows, with [tools/console](../console/README.md):

```powershell
Copy-Item -Recurse -Force tools\demo\project\* C:\path\to\a\trusted\folder\
.\tools\console\console.ps1 launch -Dir C:\path\to\a\trusted\folder -Cols 150 -Lines 48 -Font 'Cascadia Mono' `
  -Claude 'claude --plugin-dir C:\path\to\Control-Room-Mod\tools\demo --allowedTools "Edit Write Bash(npm test) Bash(npm run lint)"'
.\tools\console\console.ps1 send -Spec 'text:/demo|enter'
```

The launch adds `--plugin-dir plugins/control-room` itself. Empty the folder afterwards: the demo
changes the files it was given.
