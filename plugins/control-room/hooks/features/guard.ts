/**
 * No-Lazy-Exit Guard: decides whether Claude stopping now is a premature
 * exit that left feasible, in-scope work for the user.
 *
 * Heuristics first (free, deterministic): weighted signals of deferral and
 * incompleteness, against signals of completion, real blockers and genuine
 * user decisions. Only an uncertain score is worth a model check. The guard
 * never forces infinite continuation: per-turn and per-session caps, the
 * engine's `stop_hook_active`, and stuck detection all end it.
 */

import type { GuardStrictness } from '../core/settings'
import { clean, sentencesOf } from '../core/text'

export type GuardInput = {
  /** The request this turn answers (the person's or the autopilot's prompt). */
  request: string
  /** Claude's final message. */
  answer: string
  toolCount: number
  editCount: number
  strictness: GuardStrictness
  hasBackgroundWork: boolean
  permissionMode: string | undefined
}

export type GuardVerdict = 'allow' | 'block' | 'uncertain'

export type GuardAssessment = {
  verdict: GuardVerdict
  score: number
  /** Why, in short phrases (shown in the UI and in the block message). */
  reasons: string[]
  /** Deferred-work sentences quoted from the answer (at most three). */
  items: string[]
}

type Signal = { re: RegExp; weight: number; reason: string; isItem?: boolean }

const LAZY: readonly Signal[] = [
  {
    re: /\b(you|the user)(?:['’](?:ll|d)|\s+(?:can|could|should|may|might|must|will|would|need to|have to))(?:\s+(?:need to|have to))?\s+(?:now\s+|then\s+|also\s+|still\s+)?(run|test|try|implement|add|create|write|update|fix|install|configure|set up|wire|hook up|replace|complete|finish|deploy|verify|check)\b/i,
    weight: 3,
    reason: 'feasible steps were handed to the user',
    isItem: true,
  },
  { re: /\bleft as an exercise\b/i, weight: 4, reason: 'work was left as an exercise', isItem: true },
  { re: /\b(i('ll| will)|let me|i'm going to)\s+leave\s+(the|this|that|it|those|these)\b/i, weight: 3, reason: 'work was left undone', isItem: true },
  { re: /\bfor you to\s+(implement|complete|run|add|fill|finish|write|wire)\b/i, weight: 3, reason: 'work was left for the user', isItem: true },
  {
    re: /\b(not|isn't|is not|aren't|are not|hasn't been|has not been|haven't been|wasn't|weren't)\s+(yet\s+)?(implemented|wired up|wired|hooked up|tested|verified|connected|finished|completed|handled)\b/i,
    weight: 3,
    reason: 'parts are explicitly not implemented or not verified',
    isItem: true,
  },
  { re: /\b(TODO|FIXME|TBD)\b/, weight: 2, reason: 'TODO markers were left', isItem: true },
  { re: /\b(placeholder|stub(bed|s)?|mock implementation|dummy implementation|not yet supported)\b/i, weight: 2, reason: 'placeholders or stubs remain', isItem: true },
  {
    re: /\bwould you like me to\s+(continue|proceed|implement|add|finish|complete|go ahead|do|keep going|start|fix|write)\b/i,
    weight: 3,
    reason: 'asked permission to continue feasible work',
    isItem: true,
  },
  {
    re: /\b(let me know|tell me)\s+if\s+you('d| would)?\s*(like|want)\s+me\s+to\s+(continue|proceed|implement|add|finish|complete|keep|start|fix|write)\b/i,
    weight: 3,
    reason: 'asked permission to continue feasible work',
    isItem: true,
  },
  { re: /\bshould i\s+(continue|proceed|go ahead|implement|keep going|start|finish)\b/i, weight: 3, reason: 'asked permission to continue feasible work', isItem: true },
  { re: /\b(remaining|outstanding|unfinished)\s+(work|steps|tasks|items|todos|pieces)\b/i, weight: 2, reason: 'remaining work was listed', isItem: true },
  { re: /\b(in|as)\s+an?\s+(future|follow-up|follow up|later|separate|subsequent)\s+(session|step|pr|pull request|task|iteration|pass|change)\b/i, weight: 2, reason: 'work was deferred to later', isItem: true },
  {
    re: /\bi\s+(didn't|did not|haven't|have not|couldn't|could not|wasn't able to|was not able to)\s+(run|test|verify|build|check|execute|try)\b/i,
    weight: 2,
    reason: 'validation was skipped',
    isItem: true,
  },
  { re: /\b(should|ought to)\s+(now\s+)?work\b/i, weight: 1, reason: 'success was claimed without verification' },
  { re: /\b(manually|by hand)\b/i, weight: 1, reason: 'manual steps were suggested' },
  { re: /\b(for now|for the moment|at this point)\b/i, weight: 1, reason: 'the result is described as provisional' },
  { re: /\b(partial(ly)?|first (pass|part|phase|step)|basic version|simplified version|skeleton|scaffold(ed|ing)?|minimal version)\b/i, weight: 1, reason: 'only a partial version exists' },
  { re: /\bnext steps?\s*[:\-—]/i, weight: 1, reason: 'next steps were listed' },
]

/** Announced work at the very end of the message, then stopped. */
const ANNOUNCED = /\b(i('ll| will)|let me|i'm going to|now i('ll| will)|next,? i('ll| will))\s+(now\s+)?(implement|create|add|write|update|fix|start|begin|proceed|run|build|refactor|wire|test|move on)\b[^.!?]*[.!?:]?\s*$/i

const COMPLETE: readonly Signal[] = [
  { re: /\b(all|the)\s+(\d+\s+)?(tests?|checks?|specs?|suites?)\s+(now\s+)?(pass(ed|ing|es)?|are green|succeed(ed)?)\b/i, weight: -3, reason: 'tests pass' },
  { re: /\b(verified|validated|confirmed working|tested end[- ]to[- ]end|smoke[- ]tested)\b/i, weight: -2, reason: 'work was verified' },
  { re: /\b(build|type ?check|lint|tsc)\s+(passes|passed|succeeds|succeeded|is clean|clean)\b/i, weight: -2, reason: 'checks pass' },
  { re: /\b(everything|all of it|the whole thing|all requested)\s+(is\s+)?(done|complete|implemented|working)\b/i, weight: -2, reason: 'work reported complete' },
  { re: /\b(done|completed|finished|implemented)\b/i, weight: -1, reason: 'work reported done' },
]

const BLOCKERS: readonly RegExp[] = [
  /\b(need|require|needs|requires)\s+(your|the user's|you to)\s+(decision|input|confirmation|approval|credentials?|api key|token|password|access|permission|choice|answer)/i,
  /\b(which|what)\s+(option|approach|one|direction|version|behaviou?r)\s+(do|would|should)\s+you\b/i,
  /\bplease\s+(confirm|choose|decide|provide|clarify|let me know which|tell me which)\b/i,
  /\b(missing|no|without|lack(s|ing)?)\s+(the\s+)?(credentials?|api keys?|access tokens?|permissions?|access|license|secrets?)\b/i,
  /\b(blocked|stuck)\s+(by|on)\b/i,
  /\b(permission (was )?denied|was denied|denied by|not authori[sz]ed|forbidden|rate[- ]limit(ed)?|quota exceeded)\b/i,
  /\bi\s+(can't|cannot|am unable to|was unable to|couldn't)\s+(access|reach|connect|authenticate|log ?in|sign in|download|install)\b/i,
  /\brequires?\s+(manual|human|physical|interactive)\s+(action|intervention|step|login|approval)\b/i,
  /\b(outside|beyond)\s+(my|the)\s+(permissions|scope|access)\b/i,
  /\b(waiting|wait)\s+(for|on)\s+(you|your|the user)\b/i,
]

const ACTION_VERBS =
  /\b(implement|build|create|fix|add|write|refactor|update|change|make|set up|setup|migrate|deploy|port|convert|rewrite|integrate|finish|complete|continue|resume|test|debug|optimi[sz]e|design|develop|ship|remove|delete|rename|upgrade)\b/i

const QUESTION_LEAD = /^\s*(what|why|how|when|where|who|which|whose|can you (explain|tell|describe)|could you (explain|tell|describe)|is|are|does|do|did|explain|describe|tell me|summari[sz]e|compare)\b/i

/** A turn that is a question or conversation, not a task. */
export function isConversational(request: string, toolCount: number): boolean {
  const r = request.trim()
  if (r === '') return true
  const words = r.split(/\s+/).length
  const isQuestion = r.endsWith('?') || QUESTION_LEAD.test(r)
  if (isQuestion && !ACTION_VERBS.test(r)) return true
  if (words <= 5 && !ACTION_VERBS.test(r) && toolCount === 0) return true
  return false
}

const THRESHOLDS: Record<GuardStrictness, { block: number; uncertain: number }> = {
  lenient: { block: 6, uncertain: 4 },
  standard: { block: 5, uncertain: 3 },
  strict: { block: 4, uncertain: 2 },
}

export function assessExit(input: GuardInput): GuardAssessment {
  const answer = input.answer.trim()
  const allow = (reason: string): GuardAssessment => ({ verdict: 'allow', score: 0, reasons: [reason], items: [] })

  if (answer === '') return allow('no final message')
  if (input.permissionMode === 'plan') return allow('plan mode')
  if (input.hasBackgroundWork) return allow('background work is still running')
  if (isConversational(input.request, input.toolCount)) return allow('conversational turn')

  const tail = answer.slice(-600)
  if (BLOCKERS.some(re => re.test(answer))) return allow('a real blocker or user decision was stated')
  if (/\?\s*$/.test(tail) && /\b(you|your)\b/i.test(tail.slice(-240)) && !/\b(would you like me to|should i|shall i|want me to)\b/i.test(tail.slice(-240))) {
    return allow('ends with a question for the user')
  }

  let score = 0
  const reasons = new Set<string>()
  const items: string[] = []
  const sentences = sentencesOf(answer)

  for (const signal of LAZY) {
    if (!signal.re.test(answer)) continue
    score += signal.weight
    reasons.add(signal.reason)
    if (signal.isItem && items.length < 3) {
      const sentence = sentences.find(s => signal.re.test(s))
      const quoted = sentence === undefined ? undefined : clean(sentence, 160)
      if (quoted !== undefined && !items.includes(quoted)) items.push(quoted)
    }
  }

  if (ANNOUNCED.test(tail)) {
    score += 3
    reasons.add('announced more work, then stopped')
    const last = sentences.at(-1)
    if (last !== undefined && items.length < 3) items.push(clean(last, 160))
  }

  if (input.toolCount === 0 && input.editCount === 0 && ACTION_VERBS.test(input.request)) {
    score += 1
    reasons.add('a task was requested but no tools were used')
  }

  let credit = 0
  for (const signal of COMPLETE) {
    if (signal.re.test(answer)) credit += signal.weight
  }
  // Completion claims soften the score but never erase explicit deferrals.
  score += Math.max(credit, -Math.floor(score / 2))

  const t = THRESHOLDS[input.strictness]
  const verdict: GuardVerdict = score >= t.block ? 'block' : score >= t.uncertain ? 'uncertain' : 'allow'
  return { verdict, score, reasons: [...reasons], items }
}

/** Two answers that say essentially the same thing (the model is stuck). */
export function isRepeat(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
  const x = norm(a)
  const y = norm(b)
  if (x === '' || y === '') return false
  if (x === y) return true
  const wx = new Set(x.split(' '))
  const wy = new Set(y.split(' '))
  let common = 0
  for (const w of wx) if (wy.has(w)) common += 1
  return common / Math.max(wx.size, wy.size) > 0.85
}
