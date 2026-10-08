// Assembles the mod the tests run against, then type-checks or tests it.
//
// The plugin folder ships only what the plugin needs: Anthropic's directory scans every file in it,
// and tests are not part of the plugin. The tests live in the repository's `tests/` folder instead,
// written as if they sat beside `hooks/` (`import ... from '../hooks/...'`). This script copies the
// plugin folder (with the type declarations Claude Code lays beside it) and `tests/` into one scratch
// folder, `.build/mod`, in that layout, and runs the tool on it:
//
//   node tools/test/mod.mjs assemble    writes .build/mod and prints its path
//   node tools/test/mod.mjs typecheck   assembles, then `tsc -p .build/mod`
//   node tools/test/mod.mjs test        assembles, then `claude plugin test .build/mod`
//
// The plugin folder is the one the marketplace names (`.claude-plugin/marketplace.json`).

import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SCRATCH = join(REPO, '.build', 'mod')

function pluginFolder() {
  const marketplace = JSON.parse(readFileSync(join(REPO, '.claude-plugin', 'marketplace.json'), 'utf8'))
  const source = marketplace.plugins?.[0]?.source
  if (typeof source !== 'string') throw new Error('marketplace.json names no plugin folder')
  return resolve(REPO, source)
}

function assemble() {
  const plugin = pluginFolder()
  rmSync(SCRATCH, { recursive: true, force: true })
  mkdirSync(dirname(SCRATCH), { recursive: true })
  cpSync(plugin, SCRATCH, { recursive: true })
  cpSync(join(REPO, 'tests'), join(SCRATCH, 'tests'), { recursive: true })
  return SCRATCH
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', cwd: REPO })
  if (result.error !== undefined) {
    console.error(`${command}: ${result.error.message}`)
    return 1
  }
  return result.status ?? 1
}

const what = process.argv[2]
if (what === 'assemble') {
  console.log(assemble())
} else if (what === 'typecheck') {
  const mod = assemble()
  if (!existsSync(join(mod, '.claude-plugin', 'types', 'claude-code', 'index.d.ts'))) {
    console.error('No type declarations beside the plugin: load it once with `claude --plugin-dir <plugin folder>` (see CONTRIBUTING.md).')
    process.exit(1)
  }
  process.exit(run(process.execPath, [join(REPO, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', mod]))
} else if (what === 'test') {
  process.exit(run('claude', ['plugin', 'test', assemble()]))
} else {
  console.error('usage: node tools/test/mod.mjs assemble | typecheck | test')
  process.exit(2)
}
