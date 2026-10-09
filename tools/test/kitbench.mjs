// What Kit costs per frame: the model's step, the pose, and the drawing (Desktop's SVG, the
// terminal's half blocks), over seeded ten-minute runs of each mood, on this machine.
//   node tools/test/kitbench.mjs [plugin hooks folder]
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from '../../node_modules/typescript/lib/typescript.js'

const hooks = path.resolve(process.argv[2] ?? path.join(import.meta.dirname, '..', '..', 'plugins', 'project-sentinel', 'hooks'))
const src = fs.readFileSync(path.join(hooks, 'kit.client.tsx'), 'utf8')
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, jsxFactory: 'h' } }).outputText
const out = path.join(import.meta.dirname, 'kit.bench.mjs')
fs.writeFileSync(out, js.replace(/^import .*$/gm, ''))
const kit = await import(pathToFileURL(out).href)

const MOODS = ['idle', 'think', 'work', 'search', 'test', 'celebrate', 'worried', 'waiting', 'wake', 'sleepy', 'dim', 'sleep', 'tend', 'tired']
const props = mood => ({ surface: 'desktop', mood, caption: 'Kit', isReduced: false, isBusy: false, isStrained: false, isWorking: ['think', 'work', 'search', 'test', 'tired'].includes(mood), hour: 14, contextStartedAt: 1, isFresh: false, done: 0, greenAt: null, fails: 0, refreshAt: null })
const px = 1500
const units = kit.desktopLaneUnits(px)
const TICK = 100
const FRAMES = 6000 // ten minutes at ten a second
const rows = []
let all = { step: 0, svg: 0, term: 0, frames: 0, changed: 0, svgChars: 0 }
for (const mood of MOODS) {
  const p = props(mood)
  let s = kit.createKit(p, { lane: units, home: 2, seed: 7, isEntering: false })
  let step = 0, svg = 0, term = 0, changed = 0, chars = 0, last = ''
  for (let i = 0; i < FRAMES; i++) {
    let t0 = performance.now()
    s = kit.stepKit(s, p, TICK)
    const d = kit.drawableOf(s, p)
    step += performance.now() - t0
    // A frame is drawn only when it differs from the last (the module compares a key first).
    const key = JSON.stringify([d.pose, d.particles.map(q => [q.kind, Math.round(q.x * 2), Math.round(q.y * 2), q.frame]), d.x, d.isGone])
    if (key === last) continue
    last = key
    changed++
    t0 = performance.now()
    const image = kit.desktopSvg(d, px)
    svg += performance.now() - t0
    chars += image.length
    t0 = performance.now()
    kit.terminalLane(d, 120)
    term += performance.now() - t0
  }
  rows.push({ mood, stepUs: (step / FRAMES) * 1000, svgUs: (svg / Math.max(1, changed)) * 1000, termUs: (term / Math.max(1, changed)) * 1000, drawnPerSec: changed / (FRAMES / 10), svgChars: Math.round(chars / Math.max(1, changed)) })
  all.step += step; all.svg += svg; all.term += term; all.frames += FRAMES; all.changed += changed; all.svgChars += chars
}
for (const r of rows) console.log(`${r.mood.padEnd(10)} step ${r.stepUs.toFixed(1).padStart(6)} µs/tick · svg ${r.svgUs.toFixed(0).padStart(5)} µs/drawn frame · terminal ${r.termUs.toFixed(0).padStart(4)} µs · ${r.drawnPerSec.toFixed(1).padStart(4)} drawn frames/s · svg ${r.svgChars} chars`)
const perSecDesktop = (all.step / all.frames) * 10 + (all.svg / all.changed) * (all.changed / (all.frames / 10))
console.log(`all moods: step ${((all.step / all.frames) * 1000).toFixed(1)} µs/tick, svg ${((all.svg / all.changed) * 1000).toFixed(0)} µs/drawn frame, ${(all.changed / (all.frames / 10)).toFixed(1)} drawn frames/s → about ${perSecDesktop.toFixed(2)} ms of CPU per second on Desktop (${(perSecDesktop / 10).toFixed(2)}% of one core)`)
fs.rmSync(out)
