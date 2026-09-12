# Linty macOS interface redesign

## Audit and intent

Linty's main task happens outside its window: hold a shortcut, speak, release, and continue working in another app. The window should make readiness understandable, help people recover text, and keep configuration easy to find.

The previous interface gave six destinations equal weight, used promotional copy and four decorative metric colors, and stacked every preference into one long page. Search opened Settings without locating a category. History nested action buttons inside row buttons and copied text when the reading area was clicked. Search and copy shortcuts were advertised without complete handlers. Reset lacked modal semantics and a focus trap. The status bar reported Ready even after errors. Onboarding could overflow short windows. Capsule styling used a separate red palette.

## Information architecture

- Workspace: Overview, History.
- Utilities: Shortcuts, System Check, Settings, About.
- Settings: Dictation, Audio, Speech engine, Language, Appearance, Privacy & storage. Category selection is retained while navigating; search links to the corresponding category.
- Overview: dictation guidance when empty, usage summary, recent dictations, then activity and app statistics. All existing metrics and period filters remain available.
- History: searchable chronological list, explicit selection, a readable detail pane, copy and delete commands, and an Undo action after deletion. The final transcription comes first; a disclosure reveals the original dictated text. Narrow windows use a full detail view with a History back action.

## Design system

System font, 13 px body and controls, 12 px supporting text, 11 px compact metadata, 15 px section titles, 22 px page headings, 28 px data values. Regular body, medium labels, semibold headings; tabular numerals for measurements.

Spacing uses 4, 8, 12, 16, 24, 32, and 40 px. A 56 px toolbar and 212 px sidebar establish the window frame. Controls use 6 px corners, grouped surfaces 10 px, and modest 1 px separators. Content is comfortably constrained on wide windows and scrollable at the existing 640 × 480 minimum.

| Role | Light | Dark |
| --- | --- | --- |
| Background | #faf9f7 | #202122 |
| Secondary / sidebar | #f0efed | #28292b |
| Elevated | #ffffff | #2a2b2d |
| Primary text | #252628 | #f1f1f2 |
| Secondary text | #626367 | #b8b9bd |
| Tertiary text | #68696d | #9b9ca2 |
| Separator | #e3e2df | #3a3b3e |
| Accent | #a94230 | #f0947f |
| Success | #267343 | #77ce96 |
| Warning | #946200 | #e6b85c |
| Error | #bc3440 | #ff8a92 |

Accent communicates selected navigation and interactions. Success, warning, and error pair color with text or symbols. Grouping relies on space, with borders reserved for controls, data rows, and surface boundaries. No decorative gradients or hover elevation on static information. Materials are limited to within-window toolbar layers; this does not pretend that CSS blur is native behind-window vibrancy.

## Interaction decisions

Native macOS window controls, menu commands, system permission panels, clipboard behavior, and popup selects stay in use. The React view layer is retained to avoid replacing the recording architecture. A shared toolbar, collapsible sidebar, native Settings menu command, keyboard navigation, visible focus rings, and semantic HTML controls provide consistent desktop behavior.

History row selection and row actions are sibling elements. Text can be selected normally; copy is explicit. Up/down keys move through records, Command-F searches, Command-C copies a selected record when no text field or text selection owns the command, and Escape clears search or closes detail before leaving the page. Narrow windows move focus into the reading pane and restore it to the selected row on return. Delete offers Undo without overwriting newer dictations, with a retry if restoration cannot be saved.

Reset uses a modal HTML dialog with inert background, initial Cancel focus, Escape dismissal, and focus restoration. Operational errors stay visible and updates never claim to be current before a successful check. Settings use native selects and keyboard-operable segmented controls; descriptive labels remain attached to fields.

Animations last roughly 120–180 ms and communicate state. Reduced Motion suppresses transitions, Increase Contrast strengthens boundaries, and reduced-transparency preferences use solid surfaces. Onboarding uses named steps and scrollable content. The recording capsule keeps its compact overlay role and shares the app's color and motion language.

## References

- https://developer.apple.com/design/human-interface-guidelines/designing-for-macos/
- https://developer.apple.com/design/human-interface-guidelines/toolbars/
- https://developer.apple.com/design/human-interface-guidelines/sidebars/
- https://developer.apple.com/design/human-interface-guidelines/accessibility/

## Validation

Executed checks:

- `npm run build`: strict TypeScript check and Vite production build.
- `npm test`: six existing usage/retention/statistics tests (Node 22.6+ for TypeScript stripping).
- `npm run test:ui`: Chromium integration tests and WCAG A/AA automated checks.
- `UI_BROWSER=webkit npm run test:ui`: the same checks in WebKit, including Mac-specific focus handling.
- `cargo check --features local-stt`: native backend and Settings menu compilation.

Install test browser binaries with `npx playwright install chromium webkit`. The UI suite starts and stops its own local Vite server. It covers all destinations and preference categories in both themes, search and category navigation, settings persistence, keyboard copy and selection, deletion/Undo, recoverable update/download errors, modal focus/Cancel, sidebar visibility, the original 640 × 480 minimum, first-run setup, and capsule states. Screenshots are generated under `artifacts/ui/` and `artifacts/ui-webkit/` (ignored by Git).

Browser fixtures use synthetic data and stubbed Tauri commands; they never access application data or audio. Native menu popup rendering, traffic lights, window dragging, real microphone permissions, VoiceOver, and actual dictation/pasting still require a pass in the packaged application.
