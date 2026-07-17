# Black Hole Lab

Interactive Kerr black-hole visualization: TypeScript + WebGL2, no engine,
per-pixel geodesic ray marching. Geometrized units (G = c = M = 1) throughout.

**Full architecture, physics, and file map:** see `README.md` — read it before
touching `src/kerr.ts`, `src/shaders.ts`, or anything geodesic-related.

**Why the code is the way it is:** see `docs/DESIGN.md` for the per-slice
rationale — the artistic knobs and what they cost, and the decisions behind
compare mode. Read it before changing behaviour a slice argued its way into.

**Current work:** none. The roadmap (slices 1–7) is complete; ask what to work
on rather than inferring a next slice. `docs/archive/` holds finished plans —
historical, and their physics prose is known wrong in places, so trust the code,
the shader and the `kerr.ts` oracles over anything written there.

## Commands

```
npm install
npm run dev     # dev server
npm test        # physics unit tests (vitest)
npm run build   # tsc --noEmit + vite build
```

## Conventions

- Pure physics/math → tested modules (`src/*.ts` mirrored by `test/*.test.ts`).
  DOM/canvas/WebGL wiring is untested, kept in `main.ts`/`hud.ts`. Layout math
  counts as pure: it belongs in a tested module (`compare.ts`, `insets.ts`)
  even though only the DOM half ever calls it.
- No new npm dependencies without asking.
- Comments explain *why* (physics choice, approximation, workaround), never
  *what* the next line does.
- After finishing a slice, update `README.md`'s roadmap and file map; put the
  rationale in `docs/DESIGN.md` rather than growing the README's prose.
