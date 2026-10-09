/**
 * What Claude Desktop's page takes from a surface module (`Client`): the check its engine surface
 * runs on each tree a module returns before drawing it, read from the app's bundle (Claude Desktop
 * 2.26454, `ion-dist/assets/v1`, the Client instance's render). A tree it refuses is not drawn at
 * all: the region shows "returned a tree the page cannot draw (malformed or past its bounds)".
 *
 * The page's own rules, in order: the tree as JSON is at most 262144 characters; at most 2000
 * nodes (elements and string children), 32 elements deep, 66 objects nested; then its schema:
 *
 * - a string; or
 * - `Box`, `Text`, `div`, `span` or `b`, whose props are strings, numbers or booleans, with children;
 * - `Svg` with `source` (1 to 131072 characters), `alt` (not blank), `width` and `height` (each a
 *   positive number of pixels, at most 4096: both required, unlike the hooks module's own tree),
 *   and optionally `isInteractive`;
 * - `Button` (`key` 1 to 256 characters, `label`, optional `plain`, and the `held` id the runtime
 *   adds), `Input` and `Select` likewise.
 *
 * Unknown props of an `Svg` or a control are dropped, as the page's schema drops them.
 */

const BLOCKS = new Set(['Box', 'Text', 'div', 'span', 'b'])
const MAX_JSON = 262_144
const MAX_NODES = 2000
const MAX_DEPTH = 32
const MAX_NESTING = 66
const MAX_SOURCE = 131_072
const MAX_PX = 4096
const MAX_VALUE = 16_384

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const isScalar = (v: unknown): boolean => typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))
const isPx = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= MAX_PX
const isKey = (v: unknown): boolean => typeof v === 'string' && v.length >= 1 && v.length <= 256

/** The page's bounds walk: node count, element depth and object nesting. */
function withinBounds(tree: unknown): string | null {
  const stack: { value: unknown; depth: number; nesting: number; isChild: boolean }[] = [{ value: tree, depth: 0, nesting: 0, isChild: true }]
  let nodes = 0
  for (let e = stack.pop(); e !== undefined; e = stack.pop()) {
    const v = e.value
    const isO = typeof v === 'object' && v !== null
    const isElement = isO && 'type' in (v as object)
    const isText = e.isChild && typeof v === 'string'
    const depth = isElement ? e.depth + 1 : e.depth
    const nesting = isO ? e.nesting + 1 : e.nesting
    nodes += isElement || isText ? 1 : 0
    if (nodes > MAX_NODES) return `more than ${MAX_NODES} nodes`
    if (depth > MAX_DEPTH) return `deeper than ${MAX_DEPTH} elements`
    if (nesting > MAX_NESTING) return `nested deeper than ${MAX_NESTING} objects`
    if (isO) {
      const isArray = Array.isArray(v)
      for (const child of Object.values(v as object)) stack.push({ value: child, depth, nesting, isChild: isArray })
    }
  }
  return null
}

function element(n: unknown, path: string): string | null {
  if (typeof n === 'string') return null
  if (!isObj(n)) return `${path}: not an element or a string`
  const type = n.type
  if (typeof type === 'string' && BLOCKS.has(type)) {
    if (n.props !== undefined) {
      if (!isObj(n.props)) return `${path} ${type}: props not an object`
      for (const [k, v] of Object.entries(n.props)) if (!isScalar(v)) return `${path} ${type}: prop ${k} is not a string, number or boolean`
    }
    if (n.children !== undefined) {
      if (!Array.isArray(n.children)) return `${path} ${type}: children not a list`
      for (let i = 0; i < n.children.length; i++) {
        const fault = element(n.children[i], `${path}/${i}`)
        if (fault !== null) return fault
      }
    }
    return null
  }
  const p = isObj(n.props) ? n.props : null
  if (p === null) return `${path} ${String(type)}: no props`
  if (type === 'Svg') {
    if (typeof p.source !== 'string' || p.source.length < 1 || p.source.length > MAX_SOURCE) return `${path} Svg: source missing or past ${MAX_SOURCE} characters`
    if (typeof p.alt !== 'string' || p.alt.trim().length < 1) return `${path} Svg: alt missing or blank`
    if (!isPx(p.width)) return `${path} Svg: width missing, not positive or past ${MAX_PX}`
    if (!isPx(p.height)) return `${path} Svg: height missing, not positive or past ${MAX_PX}`
    if (p.isInteractive !== undefined && typeof p.isInteractive !== 'boolean') return `${path} Svg: isInteractive not a boolean`
    return null
  }
  const held = n.held
  const isHeld = typeof held === 'number' && Number.isInteger(held) && held > 0
  if (type === 'Button') {
    if (!isKey(p.key) || typeof p.label !== 'string') return `${path} Button: key or label`
    return isHeld ? null : `${path} Button: no held id`
  }
  if (type === 'Input') {
    if (!isKey(p.key)) return `${path} Input: key`
    if (p.value !== undefined && (typeof p.value !== 'string' || p.value.length > MAX_VALUE)) return `${path} Input: value`
    return isHeld ? null : `${path} Input: no held id`
  }
  if (type === 'Select') {
    if (!isKey(p.key) || !Array.isArray(p.options) || p.options.length < 1) return `${path} Select: key or options`
    return isHeld ? null : `${path} Select: no held id`
  }
  return `${path}: ${String(type)} is not drawn in a surface module`
}

/** Why Desktop's page would refuse this tree from a surface module, or null when it draws it. */
export function desktopClientFault(tree: unknown): string | null {
  const json = JSON.stringify(tree ?? null)
  if (json.length > MAX_JSON) return `the tree is ${json.length} characters as JSON, past ${MAX_JSON}`
  return withinBounds(JSON.parse(json)) ?? element(JSON.parse(json), 'tree')
}
