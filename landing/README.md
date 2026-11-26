# Ark landing page

The public presentation site for Ark. A static Vite + React + Tailwind app, separate from the Electron app: it has its own
`package.json` and lockfile, and the root `npm run lint` skips it.

```sh
cd landing
npm install
npm run dev        # http://localhost:5173
npm run typecheck
npm run build      # output in landing/dist
```

## Deploy on Vercel

Import the repository and set **Root Directory** to `landing`. Vercel detects Vite: build command `npm run build`,
output directory `dist`. No `vercel.json` is needed.

## Notes

- Colors, fonts, radii and spacing come from `../brand-guidelines.md` (tokens in `src/index.css`). Fonts are bundled
  with `@fontsource`, so the page loads nothing from a CDN.
- Motion uses the `motion` package with the app's own easing and durations (`src/motion.tsx`). The hero thread plays once and
  stops; everything stops under `prefers-reduced-motion`.
- The agent faces (`src/faces.tsx`) are a copy of `src/renderer/components/faces.tsx`. Keep them in step by hand.
- Copy claims only what `../README.md` says. Usage figures are examples, and the page says so.
- `src/content.ts` holds the repository link and the build steps. No release is published yet, so the page points to the
  repository; when one exists, link the download there.
