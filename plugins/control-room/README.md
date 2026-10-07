# Control Room (plugin)

This folder is the Control Room plugin itself, the folder Claude Code loads.

- Try it for one session: `claude --plugin-dir <this folder>`
- Open the Control Centre: `/cr` (or `/control-room`)
- Every command: `/cr help`

Installation, usage, configuration, security notes and limitations are in the repository's
[README](../../README.md), [docs/CONFIGURATION.md](../../docs/CONFIGURATION.md) and
[SECURITY.md](../../SECURITY.md).

Contents:

- `.claude-plugin/plugin.json`: the manifest. Its `types` field names `types/index.d.ts`.
- `hooks/hooks.json`: names the hooks module, `hooks/register.tsx`.
- `hooks/`: the source (TypeScript, loaded directly by Claude Code; no build step).
- `types/index.d.ts`: the plugin's settings schema and `$.state` view models.
- `tests/`: suites for `claude plugin test`.
