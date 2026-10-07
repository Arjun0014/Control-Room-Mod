# Design

Control Room sits beside someone's work, all day. It has to be glanceable, quiet and obvious.
This page records the decisions behind the UI, so later changes keep it that way.

## Principles

1. **Calm by default.** Show what is happening, not every switch. The status bar carries live
   readings and events only; settings live in the panel. Color appears only when something needs a
   look.
2. **Plain words.** "Hands off at 70%", "Watching for early stops", "Memory 91%". No internal
   names, codes or all-caps labels in the UI. The same helpers (`app/views.ts`) give the status
   bar, the panel, the status line and `/cr status` one voice.
3. **One question per section.** Overview: how is this session doing? Context: when does Claude
   hand off? Behavior: how does Claude work? Guardrails: what may it do? Activity: what did it just
   do? Setup: profiles, display, about.
4. **Progressive disclosure.** A system is one switch; its finer settings appear only while it is
   on. A choice shows its value, and its options open in place, each with one line on what it means.
5. **Direct manipulation.** Every control takes one click or one Enter. There are no popups in the
   terminal: Claude Code's terminal Select cannot be picked or closed with the pointer, so choices
   open in place instead.
6. **Same tree, native look.** One element tree per view. The design system draws it natively on
   each surface.

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
flush under text. A page is at most 80 columns wide: in the frame above the prompt in a wide
terminal it is centred, because a label and its control drift apart past that. That frame is
short, so its tabs sit right under the title.

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
| `navBar` | labels with the section's accent underline under the current one | native buttons in an even grid (one row when wide, three per row when narrow) | same as Desktop |
| `callout` | rounded border in the status color, title, line, actions | same, drawn natively | same |
| `gauge` | label and %, line meter with ceiling tick, sparkline | label and %, SVG bar | SVG bar |
| `steps` | numbered lines in the accent | same | same |
| `field` | dim label in a 10-cell column, the reading after it | same | same |
| `card`, `row`, `pair`, `listItem`, `note`, `textRuns` | layout | layout | layout |

Every control has a stable `key`. A picker's options are keyed `<picker>:<value>`, a stepper's
buttons `<stepper>-dec` and `<stepper>-inc`. Tests press those keys on every surface.

## The status bar

```
◆   Context ━━━━━━──── 69%   $78.35   CPU ▂▃▅▃ 23%   RAM ▇▇▇▇ 79%   2 agents        Control Room
```

Live readings and events only, from most to least important:

1. The brand mark.
2. Context, with a meter from 76 columns.
3. Events as they happen: an Autopilot handoff in progress, or waiting for you.
4. Cost.
5. CPU and RAM. From 110 columns they show their last six readings once there are six (so the bar
   never shifts sample by sample), are amber near a ceiling and red at it.
6. Running agents, and the guard keeping Claude going.
7. The run total once a run spans sessions.

Settings (Frontier Max, a profile, the handoff threshold) are never shown here. Items drop from
the least important end as the width shrinks. A second line appears only for a handoff about to
happen, a handoff waiting for you, or a machine under heavy load.

## Copy

Sentence case. Verbs for actions ("Hand off now", "Start fresh context", "Restore safe
defaults"). Footnotes say what a system does for you, not how it is built, in one or two lines.
Numbers carry units ("700k", "70%", "$4.18"); unknowns read "—". Nothing is estimated.

## Checking a change

Unit tests check that every section draws on every surface, and that controls change settings.
They cannot judge looks. Before shipping a UI change, open it in a real terminal at 80, 120 and
150+ columns, use it with the mouse and the keyboard, and look at Desktop.
