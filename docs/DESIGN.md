# Design

Control Room sits beside someone's work, all day. It has to be glanceable, quiet and obvious.
This page records the decisions behind the UI, so later changes keep it that way.

## Principles

1. **Calm by default.** Show what is happening, not every switch. The status bar carries the run
   at a glance and states only while they matter; settings live in the panel. Color appears only
   when something needs a look.
2. **Plain words.** "Hands off at 70%", "Watching for early stops", "Memory 91%". No internal
   names, codes or all-caps labels in the UI. The same helpers (`app/views.ts`) give the status
   bar, the panel, the status line and `/cr status` one voice.
3. **One question per section.** Overview: how is this session doing? Context: when does Claude
   hand off? Behavior: how does Claude work? Guardrails: what may it do? Activity: how far is the
   run, and what needs a look? Setup: profiles, display, about.
4. **Progressive disclosure.** A system is one switch; its finer settings appear only while it is
   on. A choice shows its value, and its options open in place, each with one line on what it means.
5. **Direct manipulation.** Every control takes one click or one Enter. There are no popups in the
   terminal: Claude Code's terminal Select cannot be picked or closed with the pointer, so choices
   open in place instead.
6. **Same tree, native look.** One element tree per view. The design system draws it natively on
   each surface.
7. **Counted, never guessed.** Progress is milestones done of the total Claude listed, cost is
   what Claude Code reports, a check passed when its command did. A fact that cannot be known (a
   background command's outcome, a diff no tool reported) says so in words.

## Hierarchy and rhythm

| Level | Terminal | Use |
| --- | --- | --- |
| Title | bold | the panel's name |
| Card title | bold small caps in the section's accent | `PERMISSIONS`, `AUTOPILOT` |
| Value | default color | what a row says or is set to |
| Secondary | dim | details, footnotes, units |
| Brand | Claude orange | the brand mark, a threshold tick |
| Section accent | one theme key per section (`ui/theme.ts` `ACCENT`) | that section's card titles and its tab underline, nothing else |
| Status | green, amber, red | only state that needs a look |

A page is a stack of cards. A card is a small-caps title (with an optional aside or *Open ›* link),
a rounded box of rows, and at most a short footnote under it. A row reads like a settings list:
the label, with a one-line dim description under it, on the left; the control on the right edge,
at every width. A wide control (a segmented choice) moves under the label when it would take over
half the row, or when the label or description would no longer fit beside it, so text never wraps
into a narrow column. Switches, steppers and pickers always stay on the right. On Desktop rows are
spaced so native buttons never touch.

A row never repeats its card's title. The title names the system ("FRONTIER MAX"); the first row
says what it does ("Hold Claude to senior-engineer standards") and holds its switch. A group of
one row that needs no name (Overview's profile) has no title. Live readings are not rows: they are
fields, a dim label in a fixed column and the reading after it, so a block of them reads as one
calm table (the top of Overview).

In the terminal an action row (`[ Hand off now ]`) keeps a blank line above it, so it never sits
flush under text. A page is at most 80 columns wide: in a wider frame (the frame above the prompt
in a wide terminal, a Desktop pane at full size) it is centred, because a label and its control
drift apart past that. The frame above the prompt is short, so its tabs sit right under the
title.

On Desktop a line that cuts short (a tool call, a file name, a card's aside) sits in a box allowed
to narrow below its text (`clip`). A browser keeps a flex item at least as wide as its content, so
without it the line pushes past its card instead of ending in an ellipsis. Native controls are
wider than their labels: a text field moves under its label sooner than the terminal's does.

Desktop draws a text in a monospace face, as if it were a table or a diagram, when its strings
hold box-drawing characters (U+2500 to U+259F), a rule such as `---`, two or more runs of two
spaces, or any run of three. So on Desktop the parts of one line are never set apart with
padding: `spaced()` joins them with three spaces in the terminal and ` · ` elsewhere, and layout
gaps come from boxes (`columnGap`), never from blanks inside a text. A test walks every page and
the status bar on the `desktop` surface and fails on any text that would trip the rule.

Section accents: Overview orange (`claude`), Context blue (`ide`), Behavior purple (`autoAccept`),
Guardrails teal (`planMode`), Activity periwinkle (`suggestion`), Setup gray (`inactive`).
Overview repeats them on its per-section cards, so color tells you where a setting lives.

## Components (`hooks/ui/primitives.tsx`)

| Component | Terminal | Desktop / VS Code | Mobile |
| --- | --- | --- | --- |
| `switchControl` | `● On` / `○ Off` | native button, primary when on | native button |
| `segmented` | `● Standard  ○ Strict` | native buttons, the chosen one primary | native buttons |
| `picker` | `Ask ▾`, options open in place with hints | native popup (Select) | options open in place |
| `stepper` | `−  70%  +` | native − and + buttons | native buttons |
| `link` | `No limit ›`, goes to the section that owns it | native button | native button |
| `meterBar` | thin line `━━━━──┃──` with the threshold tick | SVG bar | SVG bar |
| `spark` | `▁▂▄▆█` | SVG area chart with a dashed ceiling | SVG |
| `navBar` | labels with the section's accent underline under the current one | native buttons in one row with an even gap when all fit; otherwise three equal cells per row, each button centred | same as Desktop |
| `workStrip` | one square per milestone: `■` done (blue), the current one bright, `□` to come; scaled past its width, with `4 of 7` beside it | rounded SVG segments | SVG segments |
| `callout` | rounded border in the status color, title, line, actions | same, drawn natively | same |
| `gauge` | label and %, line meter with ceiling tick, sparkline | label and %, SVG bar | SVG bar |
| `steps` | numbered lines in the accent | same | same |
| `field` | dim label in a 10-cell column, the reading after it | same | same |
| `listItem` | glyph, text, a note at the right edge, and an optional dim second line (why it failed, which command ran) | same | same |
| `timelineStrip` | the turn across the row: `▅` per cell in the color of the kind of work (read, edit, run, check, web, agent), red where a call failed, `▁` where Claude was thinking | SVG strip | SVG strip |
| `legend` | a colored `■` and a dim word per kind, set apart by gaps | same | same |
| `columns` | one pair of block glyphs per value (a run's sessions, each its peak context), amber past the handoff line, the current one bright | SVG columns with a dashed handoff line | SVG |
| `diffSquares` | five squares per file, green for lines added and red for removed, dim for the rest | rounded SVG squares | SVG |
| `dots` | one `●` per run of a check, oldest first, in its outcome's color | same | same |
| `levelBadge` | `★ Level 3` | an SVG ring of the way to the next level, and the level | SVG |
| `card`, `row`, `pair`, `note`, `textRuns`, `spaced` | layout | layout | layout |

Every control has a stable `key`. A picker's options are keyed `<picker>:<value>`, a stepper's
buttons `<stepper>-dec` and `<stepper>-inc`. Tests press those keys on every surface.

## The status bar

```
▸ Fixing orbitalSpeed                                                                         Milestone 2 of 4
◆   Context ━━━━━━┃─── 51%   Work ■■□□ 1/4   Checks ✗ Tests                RAM 86%   Run $4.18   Control Room
```

The run at a glance, in two layers: what is happening on top, the readings below.

**The top line** says what Claude is doing while a turn runs (`▸ Fixing orbitalSpeed`): in its
own words when the milestone under way has them, else from the running call (`Running tests`),
else `Thinking`. A call running past 20 seconds adds its time (`· 4m 51s`). On the right, where
the milestone sits: `Milestone 2 of 4` when the line already names it, or its name and place when
the line names a call. Once the turn ends, the line says what it did in counted words
(`✓ Changed 4 files · Ran tests 3×, passing after a fix`) and how long it took. It appears with
the first turn of a context. A handoff that needs the person takes its place, with **Hand off
now** and **Later**, or **Start fresh**; so does a machine under heavy load while a machine-load
limit is on.

**The readings line** holds the readings, each a name and a graphic. Two meters cannot be
confused, by shape, color and number:

- **Context** is a continuous line with the orange handoff tick and a percentage: how much of the
  reasoning window is used. It starts over after a handoff.
- **Work** is one square per milestone with `done/total`: how much of the run's objective is
  finished, from Claude's own task list. It carries across handoffs, so it keeps climbing while the
  context meter saws up and down.

Then **Checks**, each kind's latest outcome by name (`✓ Tests ✗ Lint`). On the right, states only
while they matter: a handoff under way, calls that need a look (`▲ 2 issues`; a failing check is
not counted again, Checks shows it), a busy machine (`RAM 92%`, amber near a ceiling and red at
it; calm readings stay in the panel), running agents, the guard keeping Claude going, and the
Quest log's level when that style is chosen. Last, the **run's** total cost, which a fresh
context never resets. A session's own cost stays in the panel. Settings (a profile, the
threshold) are never shown.

Width decides the detail: the line takes the richest form that shows every reading. Names
(Context, Work, Checks, Run) need 100 columns in the terminal and 70 on Desktop, so they do not
come and go as states appear. Below that the meters stand alone, then check names go, then the
meters shorten, and only then do the least important readings drop. Docked beside the panel (about
80 columns), `◆ ━━━━━┃── 51%  ■■■□ 2/4  ✓ Tests ✗ Lint  $4.18  Control Room` still fits. Desktop
draws the meters as SVG.

## Activity

Activity is the run in detail, signal before noise. Its summary reads top to bottom:

1. **Quest**, only with the Quest log answer style: the level and the way to the next, the run's
   latest awards with their XP, and the achievements.
2. **Run progress**: the objective (Claude's statement of it, else the person's latest substantial
   request), the milestone strip and a window of milestones around the one under way, then *Now*,
   *Next* and *Checks*.
3. **This turn**: where the turn's time went, as a strip across the turn colored by the kind of
   work (read, edit, run, check, web, agent; red where a call failed; blank where Claude was
   thinking) with its legend, then a few counted lines ("Changed 4 files · 3 in code, 1 in tests",
   "Ran tests twice, passing after a fix"). No model writes them.
4. **Attention**, only when something needs a look: failures nothing has fixed (with the first
   line of the error and how many tries), refusals, calls the Resource Governor held back,
   long-running and unusually slow calls, then failures a later attempt recovered from, dimmed.
5. **Validation**: one row per kind of check (tests, build, type-check, lint, checks, simulation),
   the latest run deciding its state, with its command and duration, and its runs as dots when it
   ran more than once (`●●●`, red then green: passing after a fix).
6. **Changes**: code, tests, docs, config and other, each a short list of files that open their
   diff in place, with five diffstat squares and `+n −n`. Generated and temporary files (temp and
   build folders, `.claude`, the handoff notes, anything outside the project) fold into one row. A
   file with no reported diff says `diff unavailable`, never `+0 −0`.

Every tool call, newest first, is the secondary view (*All tool calls*).

Context draws the run's sessions as columns, each its peak context against the handoff line, once
a run has two or more: the sawtooth of a long run, at a glance.

## Answer styles

Behavior's first card sets how Claude writes to the person: *Standard* (Claude Code's own way),
*Brief* (the answer first), *Plain technical* (after the writing rules of ASD-STE100), *Mission
control* (GO, NO-GO and HOLD calls) and *Quest log*. Each option says in one line what it means,
and the card shows a line written in the chosen style ("GO · tests pass, 3 of 3"), so the choice
is made by example. A style governs Claude's messages only, never code, files or commit
messages. Claude Code's own output style, when the person chose one, outranks it: the card then
reads *Paused* and says why.

The Quest log is a game layer kept honest. XP comes only from outcomes Control Room counts itself
(a milestone done, once per run; a check's first pass in a turn, or passing again after failing;
a plan of three or more finished; a handoff with verified notes), never from lines, files or tool
calls, which would reward churn, and never from what Claude says. Claude is told never to state
points itself. Levels need more XP each time (50·n·(n−1)), so they mark real runs, not single
edits.

## Moving around

The section bar sits at the top of the pane, which scrolls as one. Choosing a section starts the
new page at its top, and every page ends with a quiet `↑ Sections` that brings the bar back. The
mod API has no pinned region inside a pane; drawing one over the scroll position would fight the
engine's own scrolling and keyboard focus, so it is not done.

## Copy

Sentence case. Verbs for actions ("Hand off now", "Start fresh context", "Restore safe
defaults"). Footnotes say what a system does for you, not how it is built, in one or two lines.
Numbers carry units ("700k", "70%", "$4.18"); unknowns read "—". Nothing is estimated.

## Checking a change

Unit tests check that every section draws on every surface, and that controls change settings.
They cannot judge looks. Before shipping a UI change, open it in a real terminal at 80, 120 and
150+ columns, use it with the mouse and the keyboard, and look at Desktop.
