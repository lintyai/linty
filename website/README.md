# Linty website

Static landing page for [linty.ai](https://linty.ai). No build step, no dependencies.

```bash
# Preview locally
python3 -m http.server 4173 --directory website
# → http://localhost:4173
```

Deploy by pointing any static host (Firebase Hosting, Cloudflare Pages, GitHub Pages, Vercel) at this directory.

- `index.html` — single-page layout
- `styles.css` — design tokens + all styles
- `main.js` — custom cursor, typewriter, hold-fn demo, scroll reveals
