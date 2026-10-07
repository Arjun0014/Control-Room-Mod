/**
 * A small, defensive shell tokenizer for classifying commands (bash, sh,
 * zsh, PowerShell, cmd). It splits a command line into simple commands
 * ("segments") at `&&`, `||`, `;`, `|`, `&` and newlines outside quotes,
 * recurses into `$(...)`, backticks and `bash -c` / `powershell -Command`
 * style wrappers, and strips leading wrappers (`sudo`, `env X=1`, `time`).
 *
 * It is a classifier's tokenizer, not an interpreter: it errs towards
 * finding more segments, never fewer, so a policy sees every command.
 */

export type Operator = 'start' | '&&' | '||' | ';' | '|' | '&' | 'newline' | 'sub'

export type Segment = {
  /** The words with quotes removed. */
  words: string[]
  /** The segment's raw text. */
  text: string
  /** What joined it to the previous segment (`|` means it reads that one's output). */
  op: Operator
}

const WRAPPERS = new Set(['sudo', 'doas', 'env', 'time', 'nohup', 'nice', 'ionice', 'exec', 'command', 'builtin', 'xargs', 'stdbuf', 'timeout', 'caffeinate', 'start', 'call'])

const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'fish', 'pwsh', 'powershell', 'cmd', 'wsl'])

/** `C:\Tools\npm.cmd` → `npm`; `/usr/bin/git` → `git`. */
export function commandName(word: string): string {
  const base = word.replace(/\\/g, '/').split('/').pop() ?? word
  return base.replace(/\.(exe|cmd|bat|ps1|com|sh)$/i, '').toLowerCase()
}

function splitTopLevel(input: string): { text: string; op: Operator; subs: string[] }[] {
  const out: { text: string; op: Operator; subs: string[] }[] = []
  let current = ''
  let op: Operator = 'start'
  let subs: string[] = []
  let quote: '"' | "'" | null = null
  let i = 0
  const push = (next: Operator) => {
    out.push({ text: current, op, subs })
    current = ''
    subs = []
    op = next
  }
  while (i < input.length) {
    const c = input[i]!
    const n = input[i + 1]
    if (quote === "'") {
      current += c
      if (c === "'") quote = null
      i += 1
      continue
    }
    if (c === '\\' && n !== undefined && quote !== null) {
      current += c + n
      i += 2
      continue
    }
    if (c === '\\' && n !== undefined && quote === null && n !== '\n') {
      current += c + n
      i += 2
      continue
    }
    if (quote === '"') {
      if (c === '$' && n === '(') {
        const end = matchParen(input, i + 1)
        subs.push(input.slice(i + 2, end))
        current += input.slice(i, end + 1)
        i = end + 1
        continue
      }
      current += c
      if (c === '"') quote = null
      i += 1
      continue
    }
    if (c === "'" || c === '"') {
      quote = c
      current += c
      i += 1
      continue
    }
    if (c === '$' && n === '(') {
      const end = matchParen(input, i + 1)
      subs.push(input.slice(i + 2, end))
      current += input.slice(i, end + 1)
      i = end + 1
      continue
    }
    if (c === '`') {
      const end = input.indexOf('`', i + 1)
      if (end > i) {
        subs.push(input.slice(i + 1, end))
        current += input.slice(i, end + 1)
        i = end + 1
        continue
      }
    }
    if (c === '&' && n === '&') {
      push('&&')
      i += 2
      continue
    }
    if (c === '|' && n === '|') {
      push('||')
      i += 2
      continue
    }
    if (c === ';') {
      push(';')
      i += 1
      continue
    }
    if (c === '|') {
      push('|')
      i += 1
      continue
    }
    if (c === '&' && n !== '>' && input[i - 1] !== '>' && input[i - 1] !== '<') {
      push('&')
      i += 1
      continue
    }
    if (c === '\n' || c === '\r') {
      push('newline')
      i += 1
      continue
    }
    current += c
    i += 1
  }
  out.push({ text: current, op, subs })
  return out.filter(s => s.text.trim() !== '' || s.subs.length > 0)
}

function matchParen(input: string, open: number): number {
  let depth = 0
  for (let i = open; i < input.length; i++) {
    const c = input[i]
    if (c === '(') depth += 1
    else if (c === ')') {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return input.length
}

/** Words of one simple command, quotes removed, escapes resolved. */
export function wordsOf(text: string): string[] {
  const words: string[] = []
  let current = ''
  let hasWord = false
  let quote: '"' | "'" | null = null
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    if (quote !== null) {
      if (c === quote) quote = null
      else if (c === '\\' && quote === '"' && i + 1 < text.length) current += text[++i]
      else current += c
      continue
    }
    if (c === "'" || c === '"') {
      quote = c
      hasWord = true
      continue
    }
    if (c === '\\' && i + 1 < text.length) {
      current += text[++i]
      hasWord = true
      continue
    }
    if (/\s/.test(c)) {
      if (hasWord || current !== '') words.push(current)
      current = ''
      hasWord = false
      continue
    }
    current += c
    hasWord = true
  }
  if (hasWord || current !== '') words.push(current)
  return words
}

/** Drops leading `VAR=value` assignments and wrappers (`sudo -u x`, `env`, `time`). */
export function stripWrappers(words: string[]): string[] {
  let w = words
  for (let guard = 0; guard < 8 && w.length > 0; guard++) {
    const first = w[0]!
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(first)) {
      w = w.slice(1)
      continue
    }
    const name = commandName(first)
    if (WRAPPERS.has(name)) {
      let rest = w.slice(1)
      // skip the wrapper's own options (and an option's value for sudo -u / timeout 10)
      while (rest.length > 0 && (rest[0]!.startsWith('-') || /^\d+[smh]?$/.test(rest[0]!))) {
        const opt = rest[0]!
        rest = rest.slice(1)
        if ((name === 'sudo' || name === 'doas') && /^-[ugCcDhpRrT]$/.test(opt) && rest.length > 0) rest = rest.slice(1)
      }
      w = rest
      continue
    }
    break
  }
  return w
}

/** The script a shell wrapper runs (`bash -c "..."`, `powershell -Command ...`, `cmd /c ...`). */
export function wrappedScript(words: string[]): string | null {
  if (words.length < 2) return null
  const name = commandName(words[0]!)
  if (!SHELLS.has(name)) return null
  for (let i = 1; i < words.length; i++) {
    const w = words[i]!.toLowerCase()
    if (w === '-c' || w === '/c' || w === '/k' || w === '-command' || w === '-c:' || w === '--command' || w === '-e' || w === '--exec') {
      const rest = words.slice(i + 1)
      return rest.length === 0 ? null : rest.join(' ')
    }
    if (w === '-encodedcommand' || w === '-enc' || w === '-ec') return '<encoded command>'
  }
  return null
}

/** Every simple command in a command line, wrappers unwrapped, recursively. */
export function segmentsOf(command: string, depth = 0): Segment[] {
  if (depth > 4) return [{ words: wordsOf(command), text: command, op: 'start' }]
  const out: Segment[] = []
  for (const part of splitTopLevel(command)) {
    const words = stripWrappers(wordsOf(part.text))
    if (words.length > 0) {
      out.push({ words, text: part.text.trim(), op: part.op })
      const inner = wrappedScript(words)
      if (inner !== null) out.push(...segmentsOf(inner, depth + 1).map(s => (s.op === 'start' ? { ...s, op: 'sub' as const } : s)))
    }
    for (const sub of part.subs) out.push(...segmentsOf(sub, depth + 1).map(s => ({ ...s, op: 'sub' as const })))
  }
  return out
}
