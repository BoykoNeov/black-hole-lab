# Black Hole Lab

Interactive Kerr black-hole visualization: TypeScript + WebGL2, no engine,
per-pixel geodesic ray marching. Geometrized units (G = c = M = 1) throughout.

**Full architecture, physics, and file map:** see `README.md` — read it before
touching `src/kerr.ts`, `src/shaders.ts`, or anything geodesic-related.

**Why the code is the way it is:** see `docs/DESIGN.md` for the per-slice
rationale — the artistic knobs and what they cost, and the decisions behind
compare mode. Read it before changing behaviour a slice argued its way into.

**Plan and open problems:** `docs/ROADMAP.md` — the slices landed (1–9), the
register of open scientific hurdles with the path to each, and what is queued.
Start there rather than inferring a next slice; the queued items are argued, so
prefer them to a new idea unless the user asks. `docs/archive/` holds finished
plans — historical, and their physics prose is known wrong in places, so trust
the code, the shader and the `kerr.ts` oracles over anything written there.

## Commands

```
npm install
npm run dev     # dev server
npm test        # physics unit tests (vitest)
npm run build   # tsc --noEmit + vite build
npm run shot    # visual harness smoke run (needs `npm run dev` already up;
                # finds its port itself — vite climbs past other projects)
npm run pol     # slice 10: the drawn polarization ticks vs the CPU oracle
npm run band    # slices 11-14: the drawn ladder vs the CPU oracle, the
                # tripwire colour that must read zero pixels, the disk light
                # the continuation carries, and the exponents printed around
                # the ring (also needs `npm run dev` up)
```

## Conventions

- Pure physics/math → tested modules (`src/*.ts` mirrored by `test/*.test.ts`).
  DOM/canvas/WebGL wiring is untested, kept in `main.ts`/`hud.ts`. Layout math
  counts as pure: it belongs in a tested module (`compare.ts`, `insets.ts`)
  even though only the DOM half ever calls it.
- Don't eyeball an overlay claim — measure it with `tools/visual/harness.mjs`,
  which drives the app headless and compares pixels within one run. Overlapping
  faint HUD lines are genuinely hard to read by eye, and the overlays live on a
  separate canvas that a scene-only capture doesn't show at all.
- No new npm dependencies without asking.
- Comments explain *why* (physics choice, approximation, workaround), never
  *what* the next line does.
- After finishing a slice, update `docs/ROADMAP.md` (the slice list and the
  hurdles register) and `README.md`'s file map; put the rationale in
  `docs/DESIGN.md` rather than growing the README's prose.
