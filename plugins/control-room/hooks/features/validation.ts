/**
 * Validation: the shell commands that check the work (tests, builds,
 * type-checks, linters, project checks, simulations), recognised from the
 * command text so Activity can show what passed, what failed and what is
 * running. Best-effort pattern matching over the runner's own words; quoted
 * text is ignored, so `git commit -m "fix the tests"` is not a test run.
 */

import { withoutQuoted } from './resources/heavy'

export type ValidationKind = 'tests' | 'sim' | 'build' | 'typecheck' | 'lint' | 'check'

/** Strongest first: a command that runs several is named after the strongest. */
const ORDER: readonly ValidationKind[] = ['tests', 'sim', 'build', 'typecheck', 'lint', 'check']

export const VALIDATION_LABEL: Record<ValidationKind, string> = {
  tests: 'Tests',
  sim: 'Simulation',
  build: 'Build',
  typecheck: 'Type-check',
  lint: 'Lint',
  check: 'Checks',
}

/** What the work line says while one runs ("Running tests"). */
export const VALIDATION_DOING: Record<ValidationKind, string> = {
  tests: 'Running tests',
  sim: 'Running the simulation',
  build: 'Building',
  typecheck: 'Type-checking',
  lint: 'Linting',
  check: 'Running checks',
}

const PM = String.raw`(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?`

const RULES: Record<ValidationKind, RegExp> = {
  tests: new RegExp(
    [
      String.raw`\b${PM}(?:test|tests|e2e|test:\S+)\b`,
      String.raw`\b(?:jest|vitest|mocha|ava|playwright\s+test|cypress\s+run|pytest|py\.test|nose2|tox|nox|rspec|phpunit|ctest)\b`,
      String.raw`\b(?:go|cargo|dotnet|swift|mix|gradlew?|\.\/gradlew|mvnw?|sbt|lein|stack|cabal|deno|bazel|bazelisk|zig|bun)\s+test\b`,
      String.raw`\bpython3?\s+-m\s+(?:pytest|unittest)\b`,
      String.raw`\bnode\s+--test\b`,
      String.raw`\bInvoke-Pester\b`,
      String.raw`\bclaude\s+plugin\s+test\b`,
      String.raw`\bmake\s+test\b`,
      String.raw`\s-runTests\b`,
    ].join('|'),
    'i',
  ),
  sim: new RegExp(
    [
      String.raw`\b${PM}sim\S*`,
      String.raw`\bmake\s+sim\w*`,
      // A script or binary named for a simulation, run by an interpreter or directly.
      String.raw`^(?:(?:python3?|node|deno\s+run|bun|tsx|ts-node|npx|bash|sh|pwsh|powershell|ruby|dotnet\s+run|cargo\s+run|go\s+run)\b.*)?(?:^|[\s/\\])\.?\/?(?:sim|sims|simulat\w*)(?:\.\w+)?(?=[\s/\\]|$)`,
      String.raw`--(?:project|bin)[=\s]+\S*sim\w*`,
    ].join('|'),
    'i',
  ),
  build: new RegExp(
    [
      String.raw`\b${PM}(?:build|bundle|compile|dist|package)\b`,
      String.raw`\b(?:webpack|vite\s+build|rollup|esbuild|parcel\s+build|next\s+build|nuxt\s+build|turbo\s+(?:run\s+)?build)\b`,
      String.raw`\b(?:cargo|go|dotnet|swift|gradlew?|\.\/gradlew|mvnw?|sbt|stack|cabal|zig|bazel|bazelisk|msbuild|xcodebuild)\s+(?:build|package|assemble|compile)\b`,
      String.raw`\bmake\b(?!\s+(?:test|check|lint|clean)\b)`,
      String.raw`\bcmake\s+--build\b`,
      String.raw`\bninja\b`,
    ].join('|'),
    'i',
  ),
  typecheck: new RegExp(
    [String.raw`\b(?:vue-)?tsc\b(?!\s+--version)`, String.raw`\b(?:mypy|pyright|basedpyright)\b`, String.raw`\b${PM}(?:typecheck|type-check|types|check-types|tsc)\b`, String.raw`\bflow\s+check\b`].join('|'),
    'i',
  ),
  lint: new RegExp(
    [
      String.raw`\b(?:eslint|ruff|flake8|pylint|stylelint|golangci-lint|rubocop|shellcheck|markdownlint|oxlint|ktlint|swiftlint)\b`,
      String.raw`\bbiome\s+(?:check|lint|ci)\b`,
      String.raw`\b${PM}lint\S*`,
      String.raw`\bprettier\b.*\s--check\b`,
      String.raw`\bcargo\s+clippy\b`,
      String.raw`\bdotnet\s+format\b.*--verify-no-changes`,
      String.raw`\bmake\s+lint\b`,
    ].join('|'),
    'i',
  ),
  check: new RegExp(
    [
      String.raw`\b${PM}(?:check|verify|validate|ci)\b`,
      String.raw`\bclaude\s+plugin\s+validate\b`,
      String.raw`\bmake\s+check\b`,
      String.raw`\bpre-commit\s+run\b`,
      String.raw`\bcargo\s+check\b`,
      String.raw`\bgo\s+vet\b`,
    ].join('|'),
    'i',
  ),
}

/** Programs that only read or print: `grep jest`, `cat simulation.log` run no check. */
const READERS = new Set([
  'grep', 'rg', 'ag', 'cat', 'bat', 'less', 'more', 'head', 'tail', 'ls', 'dir', 'find', 'fd', 'echo', 'printf', 'sed', 'awk', 'wc',
  'which', 'where', 'type', 'file', 'stat', 'code', 'open', 'get-content', 'select-string', 'get-childitem', 'write-host', 'write-output',
])

/** The kind of check a shell command runs, or null when it runs none. */
export function validationKindOf(command: string): ValidationKind | null {
  const segments = withoutQuoted(command)
    .split(/&&|\|\||;|\||\n/)
    .map(s => s.trim().replace(/^(?:\w+=\S*\s+)+/, ''))
    .filter(s => s !== '' && !READERS.has((s.split(/\s+/)[0] ?? '').toLowerCase()))
  let best: number | null = null
  for (const segment of segments) {
    const i = ORDER.findIndex(kind => RULES[kind].test(segment))
    if (i !== -1 && (best === null || i < best)) best = i
  }
  return best === null ? null : (ORDER[best] ?? null)
}

export type ValidationStatus = 'passed' | 'failed' | 'running' | 'blocked' | 'background' | 'stopped'

export type ValidationRun = {
  kind: ValidationKind
  command: string
  status: ValidationStatus
  startedAt: number
  endedAt: number | null
  turn: number
}

export type ValidationSummary = {
  kind: ValidationKind
  label: string
  /** The latest run's command, as drawn. */
  command: string
  status: ValidationStatus
  durationMs: number | null
  runs: number
  failures: number
  /** The latest run failed and none of that kind has passed since. */
  isFailing: boolean
  /** It failed earlier and the latest run passed. */
  isRecovered: boolean
  at: number
}

/** One line per kind of check, the latest run deciding its state, strongest kind first. */
export function summarize(runs: readonly ValidationRun[], now: number): ValidationSummary[] {
  const out: ValidationSummary[] = []
  for (const kind of ORDER) {
    const own = runs.filter(r => r.kind === kind)
    const last = own.at(-1)
    if (last === undefined) continue
    const failures = own.filter(r => r.status === 'failed').length
    out.push({
      kind,
      label: VALIDATION_LABEL[kind],
      command: last.command,
      status: last.status,
      durationMs: last.endedAt === null ? now - last.startedAt : last.endedAt - last.startedAt,
      runs: own.length,
      failures,
      isFailing: last.status === 'failed',
      isRecovered: last.status === 'passed' && failures > 0,
      at: last.endedAt ?? last.startedAt,
    })
  }
  return out
}
