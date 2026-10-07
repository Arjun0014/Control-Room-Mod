import { describe, expect, test } from 'claude-code/testing'

import { ActivityTracker, capHunks, changesOf, labelOf } from '../hooks/features/activity'

const editResult = {
  filePath: '/p/src/a.ts',
  oldString: 'a',
  newString: 'b',
  originalFile: 'a',
  structuredPatch: [{ oldStart: 1, oldLines: 2, newStart: 1, newLines: 3, lines: [' keep', '-old', '+new', '+added'] }],
  userModified: false,
  replaceAll: false,
}

describe('activity', () => {
  test('labels are compact and safe', () => {
    expect(labelOf('Bash', { command: 'npm test\nsecond line' })).toBe('npm test')
    expect(labelOf('Read', { file_path: '/very/long/path/to/src/components/App.tsx' })).toBe('…/components/App.tsx')
    expect(labelOf('WebFetch', { url: 'https://docs.example.com/a/b?q=1' })).toBe('docs.example.com/a/b')
    expect(labelOf('mcp__github__create_issue', {})).toBe('github · create_issue')
    expect(labelOf('Bash', { command: 'echo \u001b[31mred' })).toBe('echo [31mred')
  })

  test('edits become file changes with line counts and hunks', () => {
    expect(changesOf('Edit', editResult)).toHaveLength(1)
    expect(changesOf('Edit', { ...editResult, staged: true })).toHaveLength(0)
    expect(changesOf('Write', { type: 'create', filePath: '/p/new.ts', content: 'x', structuredPatch: [], originalFile: null })[0]!.isCreated).toBe(true)
    expect(changesOf('Bash', { stdout: '', stderr: '', interrupted: false, bashEditDiff: { files: [{ filePath: '/p/x', hunks: [], deleted: true }], moreFiles: 0 } })[0]!.isDeleted).toBe(true)
    expect(changesOf('Read', editResult)).toHaveLength(0)
  })

  test('the tracker counts a turn and keeps the change list', () => {
    const t = new ActivityTracker()
    t.turnStarted(0)
    t.started({ id: 't1', tool: 'Edit', input: { file_path: '/p/src/a.ts' }, agentId: undefined, now: 1 })
    t.finished({ id: 't1', status: 'ok', result: editResult, now: 2 })
    t.started({ id: 't2', tool: 'Bash', input: { command: 'npm test' }, agentId: undefined, now: 3 })
    expect(t.summaryLine({ subagentsRunning: 1 })).toBe('Working · 2 tools · 1 file changed · tests running · 1 agent running')
    t.finished({ id: 't2', status: 'error', result: 'boom', now: 4 })
    expect(t.summaryLine({ subagentsRunning: 0 })).toBe('Working · 2 tools · 1 file changed · 1 error')
    const change = t.changes.get('/p/src/a.ts')!
    expect([change.added, change.removed, change.edits]).toEqual([2, 1, 1])
    expect(change.hunks.startsWith('@@ -1,2 +1,3 @@')).toBe(true)
    t.reset()
    expect(t.items).toHaveLength(0)
    expect(t.changes.size).toBe(1)
  })

  test('background shell tasks are tracked until stopped', () => {
    const t = new ActivityTracker()
    t.turnStarted(0)
    t.started({ id: 'b1', tool: 'Bash', input: { command: 'npm run dev', run_in_background: true }, agentId: undefined, now: 1 })
    t.finished({ id: 'b1', status: 'ok', result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'bg_1' }, now: 2 })
    expect([...t.background.keys()]).toEqual(['bg_1'])
    expect(t.runningHeavy().map(i => i.id)).toEqual(['b1'])
    t.backgroundEnded('bg_1')
    expect(t.background.size).toBe(0)
  })

  test('hunks are capped on hunk boundaries so the diff still parses', () => {
    const one = '@@ -1,1 +1,1 @@\n-a\n+b'
    const text = [one, one.replace('-a', '-c'), one.replace('-a', '-d')].join('\n')
    const capped = capHunks(text, one.length * 2 + 2)
    expect(capped.split('\n@@').length).toBe(2)
    expect(capped.startsWith('@@')).toBe(true)
  })
})
