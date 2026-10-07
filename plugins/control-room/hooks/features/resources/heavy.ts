/**
 * Heavy local work: commands that load the machine (builds, test suites,
 * installs, containers, compilers, benchmarks). Used by the Resource
 * Governor to pace Claude and by the activity line ("tests running").
 * Best-effort pattern matching over the command text; not a sandbox.
 */

export type HeavyKind = 'test' | 'build' | 'install' | 'container' | 'compile' | 'bench' | 'server'

const RULES: readonly { kind: HeavyKind; re: RegExp }[] = [
  {
    kind: 'test',
    re: /\b(npm|pnpm|yarn|bun)\s+(run\s+)?(test|tests|e2e|test:\S+)\b|\b(jest|vitest|mocha|ava|tap|playwright\s+test|cypress\s+run|pytest|py\.test|nose2|tox|nox|rspec|phpunit|ctest)\b|\b(go|cargo|dotnet|swift|mix|gradle(w)?|\.\/gradlew|mvn|mvnw|sbt|lein|stack|cabal|deno|bazel|bazelisk|zig)\s+(test|check)\b|\bpython3?\s+-m\s+(pytest|unittest)\b|\bInvoke-Pester\b|\bclaude\s+plugin\s+test\b/i,
  },
  {
    kind: 'build',
    re: /\b(npm|pnpm|yarn|bun)\s+(run\s+)?(build|bundle|compile|dist|package)\b|\b(webpack|vite\s+build|rollup|esbuild|parcel\s+build|next\s+build|nuxt\s+build|tsc\b(?!\s+--version)|turbo\s+(run\s+)?build|nx\s+(run|build)|lerna\s+run)\b|\b(cargo|go|dotnet|swift|mix|gradle(w)?|\.\/gradlew|mvn|mvnw|sbt|stack|cabal|zig|bazel|bazelisk|msbuild|xcodebuild)\s+(build|install|package|publish|assemble|compile)\b|\bmake\b(\s+-j\s*\d*)?|\bcmake\s+--build\b|\bninja\b/i,
  },
  {
    kind: 'install',
    re: /\b(npm|pnpm|bun)\s+(i|install|ci|add)\b|\byarn(\s+(install|add))?\s*($|&&|;|\|)|\b(pip3?|uv\s+pip|pipx|poetry|conda|mamba)\s+(install|add|sync|update)\b|\buv\s+(sync|add)\b|\b(cargo|go)\s+(install|get|fetch)\b|\b(gem|bundle|composer|brew|apt(-get)?|dnf|yum|pacman|zypper|apk|choco|winget|scoop)\s+(install|add|update|upgrade|require)\b/i,
  },
  { kind: 'container', re: /\b(docker|podman|nerdctl)\s+(build|compose|run|buildx)\b|\bdocker-compose\b|\bkind\s+create\b|\bminikube\s+start\b/i },
  { kind: 'compile', re: /\b(gcc|g\+\+|clang(\+\+)?|rustc|javac|kotlinc|scalac|ghc|nvcc)\b/i },
  { kind: 'bench', re: /\b(bench(mark)?s?|hyperfine|wrk|ab\s+-n|k6\s+run|locust|stress(-ng)?)\b/i },
  { kind: 'server', re: /\b(npm|pnpm|yarn|bun)\s+(run\s+)?(dev|start|serve|watch)\b|\b(vite|next\s+dev|nodemon|webpack\s+serve|rails\s+s(erver)?|flask\s+run|uvicorn|gunicorn|python3?\s+-m\s+http\.server)\b|--watch\b/i },
]

/** The command with quoted strings emptied, so `git commit -m "make it"` is not a build. */
export function withoutQuoted(command: string): string {
  return command.replace(/'[^']*'/g, "''").replace(/"(?:\\.|[^"\\])*"/g, '""')
}

/** The heavy kinds a shell command contains (empty when it is light). */
export function heavyKinds(command: string): HeavyKind[] {
  const text = withoutQuoted(command)
  const kinds: HeavyKind[] = []
  for (const rule of RULES) if (rule.re.test(text)) kinds.push(rule.kind)
  return kinds
}

export const isHeavy = (command: string): boolean => heavyKinds(command).length > 0

const LABEL: Record<HeavyKind, string> = {
  test: 'tests running',
  build: 'building',
  install: 'installing',
  container: 'containers',
  compile: 'compiling',
  bench: 'benchmarking',
  server: 'server running',
}

export const heavyLabel = (kind: HeavyKind): string => LABEL[kind]
