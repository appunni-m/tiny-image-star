# Responsive editing UX

Research and layout decisions recorded 2026-09-27. This is a product and
implementation guide for the current browser editor, not a claim of physical
device or accessibility certification.

## What the guidance says

- Adapt to the available window, not a device label. Material 3 uses layout
  breakpoints where pane count or navigation needs to change; Apple calls out
  freely resizable iPad windows and recommends testing several widths. See
  [Material adaptive layout guidance](https://m3.material.io/foundations/layout/canonical-examples/overview)
  and [Apple layout guidance](https://developer.apple.com/design/human-interface-guidelines/layout).
- Give the work surface room. Apple recommends moving secondary information
  away from the primary content when space is tight. For an image editor, that
  means keeping the image visible while controls open in a contextual sheet.
- Make touch targets comfortably large. Apple recommends 44 pt; Android
  recommends 48 dp. WCAG 2.2's minimum is 24 CSS px with defined exceptions.
  This app keeps compact-shell controls at 44 CSS px or larger, while retaining
  larger targets for the editing dock. See [Apple button guidance](https://developer.apple.com/design/human-interface-guidelines/buttons),
  [Android accessibility guidance](https://developer.android.com/guide/topics/ui/accessibility/views/apps-views),
  and [WCAG 2.2 target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum).
- Give colors roles, not one-off values. Material 3 maps semantic color tokens
  to primary actions and neutral surfaces, then assigns separate light and dark
  schemes. WCAG AA requires 4.5:1 text contrast for normal text. See [Android
  color roles](https://developer.android.com/design/ui/mobile/guides/styles/color)
  and [WCAG contrast minimum](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum).
- Preserve recognition and state when the layout changes. The editor moves the
  same DOM controls into native dialogs and restores their desktop locations on
  resize, so listeners, edit state, labels, and keyboard behavior stay attached
  to the same controls.

## Layout decisions

The wide editor uses an image tray, central canvas, and contextual inspector.
That arrangement needs roughly 964 CSS px for its smallest intended three-pane
configuration (220 px tray + 420 px canvas + 300 px inspector + two 12 px gaps),
before the outer page margins. The earlier 650/980 px breakpoints left a gap:
at 768 px the app stacked the tray above the canvas, clipped the tray at 170 px,
then put the tools and inspector below the fold.

Widths through 1000 px now use the compact shell: a full-width canvas, a
horizontal image strip, a six-tool dock, and contextual More, Batch, and
Inspector sheets. The same recipe, format, and job state remains in the moved
controls. A short window (800 px tall or less) also uses the compact shell up to
1200 px wide, keeping enough vertical room for the canvas in landscape tablet
and small desktop windows. Otherwise the three-pane workspace returns above
1000 px.

The refreshed palette uses cool neutral surfaces and a focused indigo accent;
each color stays assigned by role across light and dark modes. The design
tokens in `styles.css` also own panel and control radii, the focus ring, and
compact touch-target size. The browser theme check measures seven semantic
foreground/background pairs against 4.5:1. Feature components should use these
shared tokens; operation-specific state belongs in the existing inspector,
not in a second copy of the control.

## Verification matrix

Browser checks cover 320, 375, 390, 768, 900, 1000, 1024, and 1440 CSS px,
plus the short 1024×768 landscape layout.
Widths through 1000 px must keep the canvas-first shell and move batch and
inspector controls into their sheets; 1024 px must restore the three-pane
workspace. The browser smoke suite also checks theme contrast, reduced motion,
focus containment, sheet dismissal, preserved edits across resize, no horizontal
overflow, and readable controls at 200% text.

Browser emulation cannot certify safe areas on hardware, landscape with the
keyboard open, platform Back, VoiceOver/TalkBack, or end-to-end touch gestures.
Those remain part of physical-device release testing.
