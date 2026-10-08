// Makes a frozen copy of the plugin under another name, for live tests in a real session:
//
//   node tools/test/snapshot.mjs <destination folder> [name]
//
// The copy is called `cr-test` (or the name given): its own plugin store, its own milestones tool
// (`mcp__cr-test__milestones`) and its own policy section, so a test session never reads or writes
// the store the person's own sessions use. It never carries over a former store either (the
// one-time copy from Control Room's), so it starts from defaults. A frozen copy, unlike the working
// folder, does not reload when a file is saved during a long test. Load it with
// `claude --plugin-dir <destination>` (or the console driver's `-Plugin`).

import { cpSync, existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const marketplace = JSON.parse(readFileSync(join(REPO, '.claude-plugin', 'marketplace.json'), 'utf8'))
const PLUGIN = resolve(REPO, marketplace.plugins[0].source)
const NAME = JSON.parse(readFileSync(join(PLUGIN, '.claude-plugin', 'plugin.json'), 'utf8')).name

const destination = process.argv[2]
const name = process.argv[3] ?? 'cr-test'
if (destination === undefined || !/^[a-z][a-z0-9-]*$/.test(name)) {
  console.error('usage: node tools/test/snapshot.mjs <destination folder> [name: kebab-case]')
  process.exit(2)
}
const target = resolve(destination)
const inside = relative(PLUGIN, target)
if (inside === '' || (!inside.startsWith('..') && !isAbsolute(inside))) {
  console.error('The destination must not be the plugin folder or inside it.')
  process.exit(2)
}
if (existsSync(target)) rmSync(target, { recursive: true, force: true })
cpSync(PLUGIN, target, { recursive: true, filter: src => !src.split(/[\\/]/).includes('node_modules') })

const swaps = [
  [`'${NAME}'`, `'${name}'`],
  [`mcp__${NAME}__`, `mcp__${name}__`],
  [`${NAME}:policies`, `${name}:policies`],
  // The former store: a test copy must not read the person's Control Room settings and runs.
  ["FORMER_NAME = 'control-room'", `FORMER_NAME = '${name}-former'`],
]
let changed = 0
const walk = dir => {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) walk(path)
    else if (/\.(ts|tsx|json)$/.test(entry)) {
      const before = readFileSync(path, 'utf8')
      const after = swaps.reduce((text, [from, to]) => text.split(from).join(to), before)
      if (after !== before) {
        writeFileSync(path, after)
        changed += 1
      }
    }
  }
}
// The hooks and the plugin's own type contract (types/index.d.ts declares its $.state under its name).
walk(join(target, 'hooks'))
walk(join(target, 'types'))
const manifest = join(target, '.claude-plugin', 'plugin.json')
const json = JSON.parse(readFileSync(manifest, 'utf8'))
json.name = name
json.displayName = `${json.displayName ?? NAME} (${name})`
writeFileSync(manifest, `${JSON.stringify(json, null, 2)}\n`)
console.log(`${relative(REPO, PLUGIN)} -> ${target} as ${name} (${changed} files renamed)`)
