// Source rules the engine's own checks do not enforce, kept here because Anthropic's directory reads
// the plugin's source statically and refuses or holds what it cannot follow (`npm run check` runs it;
// `claude plugin test` has no file access, so these cannot be tests of the mod itself).
//
//   node tools/test/source.mjs
//
// 1. No .tsx/.jsx file names a local `h` or `Fragment`: JSX compiles to them, and a local of that name
//    shadows the environment's factory (the directory blocks it: MOD_CAPABILITY_USE_NOT_PLAIN).
// 2. No call whose first argument is a pattern-only string ('!', '?', '*') beside a name: the
//    directory reads `name('!', VALUE)` as a hook registered on a pattern (it flagged `at('!', AMBER)`).
// 3. No `get`/`set` accessors: the directory warns that they run code when merely read.
// 4. No test files and no system files in the plugin folder: the directory scans every file in it.
// 5. Every Client names its surface module with a fixed string in the JSX element itself.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const marketplace = JSON.parse(readFileSync(join(REPO, '.claude-plugin', 'marketplace.json'), 'utf8'))
const PLUGIN = resolve(REPO, marketplace.plugins[0].source)
const IGNORED = new Set(['node_modules', 'types'])

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    // The engine's own declarations (.claude-plugin/types) and the generated tsconfig are git-ignored.
    if (statSync(path).isDirectory()) {
      if (!(IGNORED.has(name) && dir.endsWith('.claude-plugin'))) walk(path, out)
    } else out.push(path)
  }
  return out
}

const files = walk(PLUGIN)
const problems = []
const report = (file, line, text) => problems.push(`${relative(REPO, file)}:${line}: ${text}`)

const lineOf = (source, index) => source.slice(0, index).split('\n').length

for (const file of files) {
  const rel = relative(PLUGIN, file).replace(/\\/g, '/')
  if (/\.test\.(t|j)sx?$/.test(rel) || rel.startsWith('tests/')) report(file, 1, 'a test file inside the plugin folder (tests live in the repository\'s tests/)')
  if (/(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini)$/i.test(rel) || rel.includes('__MACOSX')) report(file, 1, 'a system file inside the plugin folder')
  if (!/\.(ts|tsx|js|jsx|mjs)$/.test(rel) || rel.endsWith('.d.ts')) continue
  const source = readFileSync(file, 'utf8')
  // Comments and strings may say anything; strip comments before looking at bindings.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:'"`\\])\/\/[^\n]*/g, (m, p) => p + m.slice(p.length).replace(/[^\n]/g, ' '))

  if (/\.(tsx|jsx)$/.test(rel)) {
    const binding = /(?:\b(?:const|let|var|function|class)\s+(h|Fragment)\b|\bimport\s+(h|Fragment)\b|\bimport\s*\{[^}]*\b(h|Fragment)\b[^}]*\}|[({,]\s*(h|Fragment)\s*(?:[:,)=]|\?:)|\b(h|Fragment)\s*=>)/g
    for (const m of code.matchAll(binding)) {
      const name = m.slice(1).find(x => x !== undefined)
      // Object keys (`{ h: 1 }`) and member reads (`x.h`) are not bindings: allow `name:` only inside a parameter list.
      const before = code.slice(Math.max(0, m.index - 1), m.index)
      if (before === '.') continue
      report(file, lineOf(code, m.index), `binds the name "${name}", which JSX compiles to`)
    }
  }

  for (const m of code.matchAll(/\b([A-Za-z_$][\w$]*)\(\s*(['"`])([!?*]+)\2\s*,\s*[A-Za-z_$]/g)) {
    report(file, lineOf(code, m.index), `${m[1]}('${m[3]}', …) reads to the directory as a hook on a pattern; pass an object or rename the argument`)
  }

  for (const m of code.matchAll(/^\s*(?:(?:public|private|protected|static|readonly)\s+)*(get|set)\s+[A-Za-z_$][\w$]*\s*\(/gm)) {
    report(file, lineOf(code, m.index), `a ${m[1]} accessor (runs code when merely read); use a method`)
  }

  for (const m of code.matchAll(/<([A-Za-z_$][\w$.]*\b)?Client\b([^>]*)>/g)) {
    if (!/\bmodule\s*=\s*"\.\/[^"]+\.(tsx|ts|jsx|js|mjs)"/.test(m[2])) report(file, lineOf(code, m.index), 'a Client without a fixed module path in the element')
  }
  for (const m of code.matchAll(/\b(?:const|let|var)\s*\{[^}]*\bClient\b[^}]*\}\s*=\s*\$\.ui\.resolve/g)) {
    report(file, lineOf(code, m.index), 'Client taken out of $.ui.resolve(e) into a name: the directory reads that line as a Client with no fixed path; write <ui.Client module="./…" />')
  }
}

if (problems.length > 0) {
  console.error(`Source rules: ${problems.length} problem${problems.length === 1 ? '' : 's'}`)
  for (const p of problems) console.error(`  ${p}`)
  process.exit(1)
}
console.log(`Source rules: ${files.length} files in ${relative(REPO, PLUGIN)}, no problems`)
