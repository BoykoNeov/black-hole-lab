# Black Hole Lab

Interactive Kerr black-hole visualization: TypeScript + WebGL2, no engine,
per-pixel geodesic ray marching. Geometrized units (G = c = M = 1) throughout.

**Full architecture, physics, and file map:** see `README.md` — read it before
touching `src/kerr.ts`, `src/shaders.ts`, or anything geodesic-related.

**Current work (slice 6, educational overlays):** see `PLAN-slice-6.md` for
the full sub-slice breakdown (6a–6g), ground rules, and per-sub-slice specs.
Read that file's "Ground rules" and "Shared reference" sections once before
starting any sub-slice work; do sub-slices in order (6a first).

## Commands

```
npm install
npm run dev     # dev server
npm test        # physics unit tests (vitest)
npm run build   # tsc --noEmit + vite build
```

## Conventions (apply beyond slice 6 too)

- Pure physics/math → tested modules (`src/*.ts` mirrored by `test/*.test.ts`).
  DOM/canvas/WebGL wiring is untested, kept in `main.ts`/`hud.ts`.
- No new npm dependencies without asking.
- Comments explain *why* (physics choice, approximation, workaround), never
  *what* the next line does.
- After finishing a sub-slice/slice, update `README.md`'s roadmap and file map.
