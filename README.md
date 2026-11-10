# Frontline 1943

A browser-only WW2 Eastern Front tactical FPS. React + Vite + TypeScript (strict)
+ Three.js + Rapier. **G1 vertical slice.**

## Quick start

```bash
npm install
npm run dev        # development server
npm run build      # production build -> dist/
npm run preview    # serve the production build
npm test           # 30 unit tests
```

Open the served URL. Add `?mission=m01_hold_the_village` to jump straight into the
village mission. Press `F3` in game for the profiler overlay.

## Controls

| Action | Keyboard / Mouse | Touch |
|---|---|---|
| Move | `W A S D` | left stick |
| Look | mouse | drag on the right half |
| Fire | left mouse | fire button |
| Aim (ADS) | right mouse | ADS button |
| Reload | `R` | reload button |
| Sprint | `Shift` | sprint button |
| Crouch | `Ctrl` | crouch button |
| Prone | `Z` | prone button |
| Lean | `Q` / `E` | lean buttons |
| Bipod deploy | `B` | bipod button |
| Switch weapon | `1` / `2` / `3` | weapon buttons |
| Grenade | `G` | grenade button |
| Interact | `F` | interact button |
| Profiler | `F3` | — |
| Pause | `Esc` | — |

Touch buttons can be dragged, resized and made transparent in
**Settings → Touch → Layout editor**, and the layout can be saved, loaded and
shared as a file.

## Project layout

```
src/
  core/       engine primitives: loop, ECS, math, rng, events, pools
  data/       ALL tunables as JSON + the runtime validator + i18n
  render/     renderer, viewmodel rig, effects, adaptive quality
  physics/    Rapier wrapper + raycast service
  weapons/    state machine, ballistics, throwables, mesh factory
  audio/      Web Audio graph, buses, procedural synthesis
  ai/         enemy FSM, perception, squad
  world/      terrain, sky/weather, village builder, navmesh
  player/     controller, inventory
  characters/ procedural soldier builder
  ui/         React HUD, menus, settings, touch controls
  game/       orchestrator
docs/         architecture, ADRs, asset registry, risks, budgets, test report
tests/        vitest unit tests
tools/        asset fetch scripts
```

## Documentation

| File | Contents |
|---|---|
| `docs/ARCHITECTURE.md` | system map, data flow, module boundaries |
| `docs/ADR.md` | architecture decision records (incl. what was replaced and why) |
| `docs/ASSET_REGISTRY.md` | every asset, its source, its licence, how it was verified |
| `docs/PAID_ASSETS.md` | what to buy to reach the brief's visual bar, with prices |
| `docs/RISKS.md` | risk register |
| `docs/BUDGETS.md` | performance budgets and how to measure them |
| `docs/TEST_REPORT_G1.md` | **what passed, what failed, what was not tested** |

## Assets and licensing

- **Textures:** 14 CC0 PBR sets from [Poly Haven](https://polyhaven.com), fetched
  by `tools/fetch_textures.py`. CC0 — no attribution required, but credited in
  the in-game Credits screen anyway.
- **Geometry, audio, UI:** original work, generated in-engine.
- **No asset with an unknown licence is included.** See `docs/ASSET_REGISTRY.md`.

## Status

G1 (vertical slice) is complete and tested. Vehicles, additional maps, game modes
and multiplayer are G2–G5 and are **not** implemented. Read
`docs/TEST_REPORT_G1.md` before assuming any feature works — it states plainly
what was verified and what was not.
