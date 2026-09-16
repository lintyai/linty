# Linty website

Static landing page for [linty.ai](https://linty.ai). No build step or runtime dependencies.

```bash
python3 -m http.server 4173 --bind 127.0.0.1 --directory website
# http://127.0.0.1:4173
```

Deploy this directory with an existing static host.

- `index.html` — product tour, illustrated workflow, privacy choices, setup answers
- `styles.css` — responsive layout using the application's color and type tokens
- `theme.js` — saved/system theme, applied before paint
- `main.js` — explicit light/dark choices, product screen switching, example playback, download resolution
- `motion.css` / `motion.js` — animated voice motifs and bounded pointer response on Linty marks
- `images/` — actual application screenshots with synthetic example data; real macOS app icons

## Shared branding

Icons, background motifs, and `brand/theme.css` are generated from
`src/assets/linty-mark.svg`, `src/assets/brand-artwork.json`, and
`src/styles/tokens.css`. Use `yarn icons:generate` after changing a source,
and `yarn icons:check` before deploying. See [Brand icons](../docs/BRAND-ICONS.md).
The feature-strip CPU and Command icons are rendered from the same Lucide
components used by the application, not redrawn for the website.
The page initially follows the system theme. A visitor's explicit light/dark
choice stays in browser storage on their device.

## Decorative motion

The hero's voice lines and the workflow/download contour rings use the same
geometry as the application's `BackgroundArtwork` and `SoundPattern` components.
They are vector masks, so they stay sharp at any display density. Only transforms
and opacity animate; backgrounds never intercept clicks or affect layout.

CSS motion pauses offscreen and when the document is hidden. Pointer response
only runs on hover-capable fine pointers and uses stable link bounds. Small marks
get one light sweep; the download icon has a bounded four-degree tilt, two-pixel
lift, directional highlight, and press feedback. Frame-rate-independent damping
stops requesting frames once settled, including the eased return on exit. It
resets immediately on scrolling, blur, hidden tabs, or disabled motion.
The footer's motion control remembers the visitor's choice; system reduced-motion
settings always take precedence and leave the artwork static.

## Product screenshots

Run the application Vite server and open
`http://127.0.0.1:1420/scripts/website-preview.html?theme=light` (or `dark`).
This development-only page renders the actual app using the existing in-memory
UI bridge and `scripts/website-preview-data.mjs`. It does not read native history.
Run `node scripts/capture-website.mjs` while that server is running. The exporter
renders the actual interface at a 1200 × 800 logical viewport and 2× device
scale, producing lossless **2400 × 1600 PNGs**, without a browser frame. No
existing image is enlarged. The landing page caps the display size below the
logical width, reserves the aspect ratio, and links to the full-size image:

- `overview-{light,dark}.png` — initial Overview
- `history-{light,dark}.png` — History with the latest email reply selected
- `engines-{light,dark}.png` — Settings → Speech engine

The example week has 69 dictations and 3,048 words. Word counts come from the
example text; illustrative audio durations and processing times feed the app's
normal estimate calculation (about 52 minutes saved at a 40 wpm typing baseline).
These are demonstration figures, not user outcomes or benchmark claims. Screens
are explicitly labelled as example data. Never capture personal dictations.

`mail-icon.png`, `notes-icon.png`, and `safari-icon.png` are the actual application
icons exported from their installed macOS bundles for accurate product screenshots.
They identify compatible applications; they are not Linty logos or endorsements.

The on-page workflow plays a clearly labelled illustration. It does not request
microphone access or substitute the browser's speech engine for Linty's engines.
