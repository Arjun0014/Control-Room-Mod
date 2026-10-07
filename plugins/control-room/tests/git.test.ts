import { describe, expect, test } from 'claude-code/testing'

import { Runtime } from '../hooks/app/runtime'
import * as Views from '../hooks/app/views'
import { gitLine, parseStatus } from '../hooks/features/git'
import { fakeHost } from './fixtures/fake-host'

describe('git', () => {
  test('the branch, its distance from upstream and the uncommitted files, from git status', () => {
    const g = parseStatus('## main...origin/main [ahead 2, behind 1]\n M src/a.ts\nA  src/b.ts\n?? notes.md\n')
    expect(g).toEqual({ branch: 'main', isDetached: false, ahead: 2, behind: 1, changed: 2, untracked: 1 })
    expect(gitLine(g!)).toBe('main · 3 uncommitted · 2 ahead · 1 behind')
    expect(gitLine(parseStatus('## feature/x\n')!)).toBe('feature/x · clean')
    expect(gitLine(parseStatus('## HEAD (no branch)\n M a\n')!)).toBe('detached HEAD · 1 uncommitted')
    expect(parseStatus('## No commits yet on main\n?? a\n')?.branch).toBe('main')
    expect(parseStatus('fatal: not a git repository')).toBeNull()
  })

  test('read in the terminal only, inside a repository, after each turn at most every 15 s', async () => {
    const f = fakeHost()
    f.live.repo = '/work'
    f.live.gitStatus = '## main...origin/main\n M src/a.ts\n'
    const rt = new Runtime()
    rt.bind(f.host)
    await rt.onSessionStart({ cwd: '/work', surface: 'terminal', isInteractive: true })
    await f.advance(200)
    expect(Views.hudOf(rt).git).toBe('main · 1 uncommitted')
    expect(f.kept.gitRuns).toBe(1)
    // A turn ending right after does not run git again.
    rt.onTurnStart({ turnId: 't1', text: 'go' })
    await rt.onTurnComplete({ agentId: undefined, reason: 'answer', answer: 'done' })
    expect(f.kept.gitRuns).toBe(1)

    // Desktop shows Git itself: nothing is run there.
    const d = fakeHost()
    d.live.repo = '/work'
    d.host.surfaces = async () => ['desktop']
    const desktop = new Runtime()
    desktop.bind(d.host)
    await desktop.onSessionStart({ cwd: '/work', surface: 'desktop', isInteractive: true })
    await d.advance(200)
    expect(d.kept.gitRuns).toBe(0)
    expect(Views.hudOf(desktop).git).toBeNull()

    // Outside a repository: nothing either.
    const n = fakeHost()
    const outside = new Runtime()
    outside.bind(n.host)
    await outside.onSessionStart({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
    await n.advance(200)
    expect(n.kept.gitRuns).toBe(0)
  })
})
