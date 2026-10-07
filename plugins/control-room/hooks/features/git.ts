/**
 * The project's Git state in a line, for the terminal: the branch, how far it
 * is ahead of or behind its upstream, and how many files have uncommitted
 * changes. Desktop shows Git natively beside the session, and no plugin API
 * reaches that strip, so Control Room shows this only in the terminal.
 *
 * Pure: parses `git status --porcelain=v1 --branch`.
 */

export type GitState = { branch: string | null; isDetached: boolean; ahead: number; behind: number; changed: number; untracked: number }

/** `## main...origin/main [ahead 2, behind 1]` and one line per changed or untracked file. */
export function parseStatus(stdout: string): GitState | null {
  const lines = stdout.replace(/\r/g, '').split('\n').filter(l => l !== '')
  const head = lines[0]
  if (head === undefined || !head.startsWith('## ')) return null
  const info = head.slice(3)
  const isDetached = info.startsWith('HEAD (no branch)')
  const isNew = info.startsWith('No commits yet on ') || info.startsWith('Initial commit on ')
  const name = isDetached ? null : isNew ? info.replace(/^(No commits yet on |Initial commit on )/, '') : (info.split('...')[0] ?? '').split(' ')[0] ?? ''
  const ahead = Number(/ahead (\d+)/.exec(info)?.[1] ?? 0)
  const behind = Number(/behind (\d+)/.exec(info)?.[1] ?? 0)
  const files = lines.slice(1)
  return {
    branch: name === null || name === '' ? null : name,
    isDetached,
    ahead,
    behind,
    changed: files.filter(l => !l.startsWith('??') && !l.startsWith('!!')).length,
    untracked: files.filter(l => l.startsWith('??')).length,
  }
}

/** "main · 3 uncommitted · 2 ahead", or "main · clean". */
export function gitLine(g: GitState): string {
  const parts = [g.isDetached ? 'detached HEAD' : (g.branch ?? 'no branch')]
  const dirty = g.changed + g.untracked
  parts.push(dirty === 0 ? 'clean' : `${dirty} uncommitted`)
  if (g.ahead > 0) parts.push(`${g.ahead} ahead`)
  if (g.behind > 0) parts.push(`${g.behind} behind`)
  return parts.join(' · ')
}
