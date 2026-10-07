# Design

Control Room sits beside someone's work, all day. It has to be glanceable, quiet and obvious.
This page records the decisions behind the UI, so later changes keep it that way.

## Principles

1. **Calm by default.** Show what is happening, not every switch. In the status bar an off system
   takes no room; color appears only when something needs a look.
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
| Section | dim, bold, small caps | `SYSTEMS`, `PERMISSIONS` |
| Value | default color | what a row says or is set to |
| Secondary | dim | details, footnotes, units |
| Accent | Claude orange | the brand mark, the current section, a threshold tick |
| Status | green, amber, red | only state that needs a look |

A section is its title, its rows, and at most a short footnote. Sections are separated by one
blank line. Rows use a label column of about 38% of the width (never more than half), so values
line up down the page. A detail sits beside its control when the line holds it, else under it.

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
| `navBar` | labels with an accent underline under the current one | native buttons, current one primary | native buttons |
| `callout` | rounded border in the status color, title, line, actions | same, drawn natively | same |
| `section`, `row`, `stat`, `pair`, `listItem`, `note` | layout | layout | layout |

Every control has a stable `key`. A picker's options are keyed `<picker>:<value>`, a stepper's
buttons `<stepper>-dec` and `<stepper>-inc`. Tests press those keys on every surface.

## The status bar

```
◆   Context ━━━━━━──── 31%   $4.18   Frontier Max   Hands off at 70%   Memory 79%        Control Room
```

Items, from most to least important:

1. The brand mark.
2. Context, with a meter from 76 columns.
3. Cost.
4. Frontier Max or a non-default profile.
5. The Autopilot's state.
6. Machine load, only near a ceiling.
7. Running agents.
8. Guard activity.
9. The session number once a run has handed off.

Items drop from the least important end as the width shrinks. A second line appears only for a
handoff that is about to happen, a handoff waiting for you, or a machine under heavy load.

## Copy

Sentence case. Verbs for actions ("Hand off now", "Start fresh context", "Restore safe
defaults"). Footnotes say what a system does for you, not how it is built, in one or two lines.
Numbers carry units ("700k", "70%", "$4.18"); unknowns read "—". Nothing is estimated.

## Checking a change

Unit tests check that every section draws on every surface, and that controls change settings.
They cannot judge looks. Before shipping a UI change, open it in a real terminal at 80, 120 and
150+ columns, use it with the mouse and the keyboard, and look at Desktop.
