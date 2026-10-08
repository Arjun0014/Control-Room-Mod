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
   background command's outcome, a diff no tool reported) says so in words. A figure derived from
   reported ones (the cache's expiry, its hit ratio, why it was rebuilt) is named as derived
   where it is shown.

## Hierarchy and rhythm

| Level | Terminal | Use |
| --- | --- | --- |
| Title | bold | the panel's name |
| Card title | bold small caps in the section's accent | `NETWORK`, `HANDOFF` |
| Value | default color | what a row says or is set to |
| Secondary | dim | details, footnotes, units |
| Brand | Claude orange | the brand mark, a threshold tick |
| Section accent | one theme key per section (`ui/theme.ts` `ACCENT`) | that section's card titles and its tab underline, nothing else |
| Status | green, amber, red | only state that needs a look |

A page is a stack of cards. A card is a small-caps title (with an optional aside or *Open ›* link),
a rounded box of rows, and at most a short footnote under it. Rows that need a group's name get a
card of their own (Guardrails' Project, Network, Git, External and Safety), never a heading inside
a box: on Desktop a heading among rows reads as one more row. What a run of such cards shares (an
action, a footnote) follows the last of them (`footnote`). A row reads like a settings list:
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

Desktop lays the tree out in CSS (read from the app's own renderer): a `Box` is a flex box whose
widths, column gaps and horizontal spacing are `ch` and whose heights are `lh`, while row gaps and
vertical spacing count half lines; a `Text` wraps unless it truncates. A row box that sets no
alignment centers its texts, buttons and images on the row, so a mark beside a block of two lines
sits between them: a mark that belongs to the first line aligns its row to the top and is drawn
one line tall (`stateLine`). Its picker is the app's own, as wide as the value it shows, with no
width to set: pickers in a column line up on the right, as pop-up menus do in a settings list.

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
| `picker` | `Ask ▾`, options open in place with hints | native popup (Select), as wide as its value | options open in place |
| `stepper` | `−  70%  +` | native − and + buttons | native buttons |
| `link` | `No limit ›`, goes to the section that owns it | native button | native button |
| `meterBar` | thin line `━━━━──┃──` with the threshold tick | SVG bar | SVG bar |
| `spark` | `▁▂▄▆█` | SVG area chart with a dashed ceiling | SVG |
| `navBar` | labels with the section's accent underline under the current one | native buttons in one row with an even gap when all fit; otherwise three equal cells per row, each button centred | same as Desktop |
| `workTrack` | a track of milestones, one stop each: `●` done (blue), `◉` the one under way (bold), `○` to come, joined by `─`; scaled past its width, with `4 of 7` beside it. A track of stops, never a filling bar, so it cannot be read as the context meter | SVG circles on a line, the current one pulsing unless *Reduce motion* is on | SVG |
| `cacheClock` | the prompt cache's state as a status line: a dot emptying as its time runs out (`●` `◕` `◑` `◔` `○`) in blue, and its words beside it | the same glyph, as Context's own status reads (a drawn clock face read as a selected radio button there) | same |
| `stateLine` | what the run is doing with its state's mark (the status bar's glyph), wrapping, a dim detail line under it | the status bar's 16-pixel icon, set on the first line | same as Desktop |
| `footnote` | what a run of cards shares, after the last of them: its actions, then a dim note | same, native buttons | same |
| `callout` | rounded border in the status color, title, line, actions | same, drawn natively | same |
| `gauge` | label and %, line meter with ceiling tick, sparkline | label and %, SVG bar | SVG bar |
| `steps` | numbered lines in the accent | same | same |
| `field` | dim label in a 10-cell column, the reading after it | same | same |
| `listItem` | glyph, text, a note at the right edge, and an optional dim second line (why it failed, which command ran) | same | same |
| `timelineStrip` | the turn across the row: `▅` per cell in the color of the kind of work (read, edit, run, check, web, agent), red where a call failed, `▁` where Claude was thinking | SVG strip | SVG strip |
| `legend` | a colored `■` and a dim word per kind, set apart by gaps | a square drawn in the exact color the strip uses (a theme key and an SVG fill are two palettes there) | same as Desktop |
| `columns` | one pair of block glyphs per value (a run's sessions, each its peak context), amber past the handoff line, the current one bright | SVG columns with a dashed handoff line | SVG |
| `diffSquares` | five squares per file, green for lines added and red for removed, dim for the rest | rounded SVG squares | SVG |
| `dots` | one `●` per run of a check, oldest first, in its outcome's color | same | same |
| `levelBadge` | `★ Level 3` | an SVG ring of the way to the next level, and the level | SVG |
| `apart` | a row set a blank line apart from the readings above it, so a switch never sits flush under a meter's figures | no gap (native rows are spaced already) | same as Desktop |
| `card`, `row`, `pair`, `note`, `textRuns`, `spaced` | layout | layout | layout |

The status bar draws its graphics from the same theme (`ui/theme.ts`): `meterCells` and
`svgContextMeter` for Context, `scaleTrack`, `STOP_LOOK` and `svgWorkTrack` for Work, `clockGlyph`
and `svgClock` for Cache, `STATE_MARK` and `svgStateIcon` for the headline's mark.

Every control has a stable `key`. A picker's options are keyed `<picker>:<value>`, a stepper's
buttons `<stepper>-dec` and `<stepper>-inc`. Tests press those keys on every surface.

## The status bar

A mission HUD: one line says what is happening, the line under it carries the run's instruments.

In the terminal (150 columns):

```
◎ Linting · step 3 of 4                                                ▲ RAM 83%    ◆ Control Room
  WORK ●━●━◎─○ 2/4    CONTEXT ▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇█▇▇▇▇▇ 47% · hands off 80%    CACHE ● rebuilt 446k      RUN $4.18
```

On Desktop:

```
(▸) Running tests · step 3 of 10                                         ✗ Lint failing   [ ◆ Control Room ]
Work                       Context · hands off at 70%          Cache                                  Run
●━●━◉─○─○─○  2 of 10       ▬▬▬▬▬▬▬▬▬┃▬▬▬  24%                    ◔ 42m left                         $43.00
```

**The headline** says what the run is doing in words a person would use, with a mark for its
state (`app/headline.ts`), so it never says one thing while another is true:

| State | Mark | Says |
| --- | --- | --- |
| working | `▸` blue | the milestone under way in Claude's words (`Rewriting the scheduler · step 3 of 8`), else the call running; a call past 20 seconds adds its time |
| thinking | `◌` dim | `Thinking`: a turn runs and no call does |
| validating | `◎` blue | a check running (`Running tests`), or a milestone being verified |
| handoff | `↻` orange | Autopilot's step: writing the notes, starting fresh, resuming |
| waiting for a result | `◷` blue | a background job, a scheduled wake-up, a milestone marked *waiting*: `Waiting for the test run · 2 more running`, `Waiting to check back · wakes at 06:12` |
| blocked | `⊘` amber | `Blocked:` what only the person can give |
| waiting for you | `◆` orange | Claude asked something, or a handoff waits to start fresh |
| done, complete | `✓` green | what the last turn did in counted words; `All 6 milestones done` |
| failing | `✗` amber | the same, after a turn that left a check failing; the words stay plain, the mark and a chip carry the color |
| ready | `○` dim | before the first turn: the run's objective as Claude stated it, else `Ready` |

The milestone under way is the one in progress; one being verified counts only when nothing is in
progress.

**On the right, only what needs a look**, as chips, the most pressing first: a failing check by
name (`✗ Lint failing`, red; not counted again as an issue), calls that need a look
(`▲ 2 issues`), the guard keeping Claude going, a busy machine (`▲ RAM 92%`, amber near a ceiling,
red at it), running agents, the Quest log's level. Then the **Control Room** button: in the
terminal a filled chip in the theme's quiet gray, brand orange while the panel is open; on
Desktop the native button, primary while the panel is open.

**The instruments**, each its own shape so they cannot be confused:

- **Work** is a track of milestones with `done/total`: `●` done, `◉` under way, `◎` being
  verified, `◌` waiting or blocked (amber), `○` to come. It carries across handoffs, so it keeps
  climbing while Context saws up and down.
- **Context** is a solid bar: cells filled in its tone (green, amber near the handoff point, red
  past it) over a track in the theme's quietest gray, and the handoff point as a full-height orange
  cell that stands a little proud of the bar. Then the percentage, and Autopilot's point or the
  step under way (`· hands off 80%`, `· Writing the handoff`).
- **Cache** is a clock face emptying as the prompt cache's lifetime runs out (`◕ 42m left`),
  shown in the terminal only while it can matter: when you are away, or for a few minutes after a
  costly rebuild (`● rebuilt 446k`, amber). While Claude works, its requests keep the cache warm.
  On Desktop it keeps its cell: `warm` while Claude works (its time left once it nears the
  expiry, as a long call can let it), the time left while you are away, `—` before anything is
  cached.
- **Run** is the whole run's cost on the right edge, which a fresh context never resets.

Settings (a profile, the threshold) are never shown. A handoff that needs the person takes a line
of its own above, with **Hand off now** and **Later**, or **Start fresh**.

**Quiet grays are theme colors, not dim text.** Terminals draw dim text very differently (one
draws it as plain gray), and a dim block reads as a slab. The empty part of a graphic and the
HUD's top edge use the theme's `subtle` gray, which every terminal draws as the same quiet color.

**Width decides the detail in the terminal.** The instruments take the richest tier that shows
every reading: names (`WORK`, `CONTEXT`, `RUN`) from 72 columns, so they do not come and go as
readings appear, the meter from 24 cells down to 6, the track from 16 stops down to 5 (scaled,
the count beside it exact), the notes only with room. Only then does the least important reading
drop. Docked beside the panel (about 80 columns) the whole line still fits.

**On Desktop the surface lays the row out, not counted cells.** Each reading is a cell of an
equal share of the row: a quiet caption over its graphic and value. The run's cost takes what it
needs at the right edge. The four readings always keep their cells, a dim word standing in for
one with nothing yet (`No milestones yet`, `—`): a row that dropped them collapsed to two readings
with a wide empty middle (1.3.0-rc.5, seen in the app). So the row never overflows, nothing
drifts and its rhythm holds, from 500 pixels to a full window; below 80 columns the cells turn
compact (fewer stops, a shorter meter, `2/10`, `None`). Every
graphic is an image of a fixed size (`Svg` with `width` and `height`), never an interactive
frame: Desktop sizes a frame on its own (300 pixels without a width) and may paint it opaque,
which drew 1.2.0's work track as a white bar.

**Git is Claude Desktop's own.** The Git strip on Desktop belongs to the app. The mod API's render
components (`AskUserQuestion`, `UserMessage`, `AssistantMessage`, `ToolUse`, `ToolResult`,
`ToolGroup`, `ToolProgress`, `CommandOutput`, `Spinner`, `TurnDuration`, `InfoNotice`,
`SessionMode`, `PromptHint`, `AbovePrompt`, `Pane`) include nothing for it, so a plugin can
neither hide nor move it. Control Room draws no Git UI on Desktop; its Git line is terminal-only
(Overview and `/cr status`).

## Kit, the companion

Off by default: a status bar is calm first. Turned on (Setup → *Companion*), Kit, a small
Claude-orange creature (18 × 10 pixels, with ears and expressive eyes), shows by what it does what
the headline says in words. It never carries information the bar does not; it is company, not a
reading.

Fifteen moods: sitting by, glancing now and then (idle); pacing while Claude thinks; busy, a
spark where its arm lands, while it works; a magnifier while it reads or searches; sitting up
watching a check, a spinner beside it; hopping at a green finish; startled, a bead of sweat, by a
failure; a question mark when the run needs you or waits for a result; tired and sweating on a
busy machine or a nearly full context; tending a small fire while Keep warm holds the cache;
dozing and fading as the cache nears its expiry; sleepy, then asleep, when nothing happens; and at
a handoff it carries the notes off and walks back in with the fresh context.

Calm rules: most moods stand or sit still and only blink or glance; walking is slow and pauses. On
a busy machine it plays at two frames a second at most and stops walking; a machine at its limit
holds it still; *Reduce motion* holds one frame. In the terminal it is five rows of half blocks
played by a surface module on its own frame clock (the plugin does no work between frames), and it
stands on the HUD's top edge, a quiet line; a click on it opens Control Room. On Desktop it is a
360 × 68 pixel image that animates itself (each sprite pixel 6 × 6, drawn with crisp edges so no
seam shows between its rows at a display scale like 125%; at 4 × 4 it read as a speck beside the
app's text), above the headline, lined up with its left edge, in a narrower lane in a narrow band. If
its module ever fails to draw, it is left out until the plugin reloads, and the status bar draws
without it.

## Overview

Overview leads with the run: its number and session, its whole cost and its objective, and in
the terminal the Git branch with the uncommitted files (`main · 3 uncommitted · 2 ahead`; Desktop
shows Git itself). Then the three lifecycles as cards, in the order they last: **Work** (the
track; carries across handoffs), **Context** (the meter and Autopilot's switch; starts over at
each handoff) and **Cache** (its state after a dot that empties as its time runs out, what it
holds and Keep warm's switch; starts over with each fresh context and lapses when left idle).
Each card's footnote says how it starts over, which is the one thing that tells the three apart.
Then **Now** (the status bar's headline in full, with its state's mark, and what needs a look; the
machine's readings sit with Guardrails), the profile, and one card per remaining section.

## The prompt cache

Context's **Cache** card: the cache's state in words (`Warm · lapses in about 40 min`), a meter of
the time left, what it holds (`506k tokens cached · 9 requests`, the share read from the cache),
then Keep warm with its next refresh or why there is none, its idle limit, *Ask before a model
switch* and *Keep policies stable*. The lifetime sits in the card's aside, with where it came
from (`1-hour cache · as Claude Code reports it`, or `Lifetime not known yet`). The footnote says
that the expiry, the hit ratio and the causes are derived from the tokens Claude Code reports.

**Cache health** lists the recent rebuilds, one line each (what happened, tokens re-cached, when),
and under it, wrapping, its kind (*Preventable*, *Expected*, *Unexplained*) and what would avoid
the next one. Only a costly rebuild that could have been avoided, or one that keeps happening
with nothing changed, raises its voice (amber, and a toast); compaction is expected and dim.

**Last handoff**, after one: what the handoff left for the fresh context and what the fresh
context picked up, each a `✓`, `✗` or a dim `○` (not needed), with a score (`5 of 6`). It is
counted from tool calls, never from what Claude said, and the footnote says so.

## Activity

Activity is the run in detail, signal before noise. Its summary reads top to bottom:

1. **Quest**, only with the Quest log answer style: the level and the way to the next, the run's
   latest awards with their XP, and the achievements.
2. **Run progress**: the objective (Claude's statement of it, else the person's latest substantial
   request), the milestone track and a window of milestones around the one under way (one being
   verified shows its evidence, a blocked one what it waits for), then *Now*, *Next* and
   *Checks*.
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
