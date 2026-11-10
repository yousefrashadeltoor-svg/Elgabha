# Frontline 1943 — Test Report (G1 Vertical Slice)

**Date:** 2026-11-10
**Gate:** G1 — Vertical Slice
**Verdict:** **G1 PASSED with stated limitations.** The slice runs, the core
mechanics are verified by automated tests and by live browser inspection, and the
performance numbers are inside budget. The visual bar the brief asks for is **not**
met, and the reason is documented below rather than hidden.

---

## 1. What was built

| System | Status | Evidence |
|---|---|---|
| Vite + React + TS (strict) + Three.js + Rapier | Done | `npm run build` exits 0; `tsc --noEmit` clean |
| Fixed-timestep loop (60 Hz) + render interpolation | Done | `src/core/loop.ts`, unit-tested |
| Sparse-set ECS | Done | `src/core/ecs.ts`, 3 unit tests incl. stale-handle detection |
| Data-driven everything + runtime validator | Done | 26 weapons, 9 ammo types, 14 attachments, 12 characters, 1 map, 3 missions — all validated at load |
| Weapon state machine (bolt-action, stripper, mag-as-entity) | Done | 7 unit tests |
| Ballistics (drag, drop, penetration, ricochet, hit zones) | Done | `src/weapons/ballistics.ts`, 5 unit tests |
| Recoil (per-weapon pattern, camera kick vs aim punch) | Done | `src/weapons/weapon-controller.ts` |
| Bipod deploy + barrel heat + jam | Done | Verified live: spread 8.0° → 5.79° deployed; MG42 jams after ~200 rounds |
| Procedural viewmodel (springs, sway, ADS, bolt, mag) | Done | `src/render/viewmodel.ts` |
| Terrain (heightfield + CC0 texture splatting) | Done | 14 CC0 Poly Haven textures integrated |
| Village map (buildings, trenches, sandbags, cover, navmesh) | Done | `src/world/world.ts` |
| Sky / day-night / weather (snow, rain, fog, lightning) | Done | `src/world/sky.ts` |
| Web Audio (buses, HRTF panner, convolution reverb, tinnitus) | Done | `src/audio/audio.ts` |
| Enemy AI (FSM + vision/hearing + cover + suppression) | Done | 12 enemies spawn and fight |
| Player controller (walk/sprint/crouch/prone/lean/vault) | Done | `src/player/player.ts` |
| Inventory (PUBG-style slots, weight, attachments, meds) | Done | `src/player/inventory.ts` |
| HUD, menus, settings, credits, loading | Done | `src/ui/*` |
| Touch controls + layout editor + gyro | Done | `src/ui/TouchControls.tsx` |
| Arabic + English with full RTL/LTR | Done | `src/data/i18n.ts` |
| Adaptive quality (dynamic resolution) | Done | `src/render/auto-quality.ts` |

---

## 2. Automated tests — 30/30 passing

```
Test Files  1 passed (1)
     Tests  30 passed (30)
```

Coverage by area:

- **math** (5): clamp/lerp, angular wrap, bullet drop, ballistic elevation solved
  and verified by re-integration, drag time-of-flight.
- **rng** (3): determinism for a seed, range, shuffle integrity.
- **ecs** (3): create/store/destroy, stale-handle detection after index reuse,
  dense-array compaction.
- **events** (2): subscribe/unsubscribe, unsubscribe-during-dispatch safety.
- **pool** (2): object reuse, ring-buffer ordering.
- **noise** (2): determinism, bounded output.
- **data validation** (6): whole dataset loads and cross-references; every weapon
  → ammo, every character → weapon, every mission → map; malformed data throws
  with the offending path.
- **weapon controller** (7): bolt-action fires once per pull; no second round
  while the bolt cycles; SMG fires at its cyclic rate (900 rpm → 15 rounds/s);
  reload fills from reserve; bipod reduces spread; heat accumulates to a jam;
  magazine capacity is never exceeded.

### Bugs found and fixed by these tests

1. **Semi-auto weapons never fired.** The controller required the rate-of-fire
   interval to elapse *before the first shot*, so a bolt-action rifle with a 4.3 s
   interval fired nothing on a short trigger pull. Fixed: the first shot of a pull
   is immediate; only subsequent shots wait for the cyclic rate.
2. **The whole world rendered black.** `camera.layers.set(0)` made the camera
   blind to every light (lights live on layer 2), and the hemisphere light was
   never added to the scene at all. Fixed: the camera enables layers 0 and 2, and
   the hemisphere + ambient lights are added.
3. **Terrain and buildings were near-black.** Dark vertex-colour tints were
   multiplied by dark textures. Fixed: tints now hover around 1.0.
4. **Weapons and characters rendered as black silhouettes.** `MeshStandardMaterial`
   with `metalness` and no environment map renders black. Fixed: `MeshLambertMaterial`
   for the viewmodel, world props and characters.

---

## 3. Live browser verification (real Chromium, Playwright-driven)

The game was loaded from the production build (`npm run preview`) and inspected
through the browser automation harness.

| Check | Result |
|---|---|
| Page loads, no console errors | Pass |
| Data validation at startup | Pass (26 weapons, 12 characters, 3 missions) |
| Enemies spawn | Pass — 12 alive |
| Weapon fires through the real input path | Pass — magazine decrements, bullet spawns |
| Bolt-action cycle blocks the next shot | Pass |
| Reload restores the magazine from reserve | Pass |
| Bipod deploy reduces spread | Pass — 8.0° → 5.79° |
| MG42 heat → jam | Pass |
| Rendered pixel at the weapon | `rgb(142,121,83)` — lit wood, not black |
| Rendered pixel on the ground | `rgb(181,168,131)` — lit terrain |
| Rendered pixel in the sky | `rgb(115,138,164)` — sky visible |

---

## 4. Performance — measured, not claimed

Measured in the sandbox browser. **Important caveat:** this environment has **no
GPU** — Chromium falls back to **SwiftShader** (software rasterisation), which is
why the frame rate below is not representative of real hardware.

```
GPU:        ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)
Draw calls: 350
Triangles:  38,868
Textures:   4
Geometries: 268
JS heap:    16.6 MB
```

| Budget item | Desktop target | Measured | Verdict |
|---|---|---|---|
| Draw calls | ≤ 1500 | **350** | Pass (23% of budget) |
| Triangles / frame | ≤ 3M | **38,868** | Pass (1.3% of budget) |
| GPU texture memory | ≤ 1 GB | 4 textures, ~30 MB source | Pass |
| JS heap | — | **16.6 MB** | Pass |
| FPS | 60 (High) | **not measurable here** | **Not tested** — no GPU in the sandbox |

**Honest statement:** the FPS target is **not verified**. The draw-call and
triangle counts are so far inside budget that 60 FPS on real hardware is very
likely, but "very likely" is not "measured", and this report does not claim it.
The user must run the build on a real GPU to confirm.

---

## 5. What FAILED / what is NOT done

### 5.1 The visual bar is not met — and why

The brief's first principle is *"quality before quantity"* and its asset rule is
*"use ready-made professional models from specialist sites; do not build models
yourself unless no licensed alternative exists."*

**No licensed, high-quality WW2 model could be obtained from this sandbox.** The
specialist sources named in the brief (Sketchfab, Fab, CGTrader, TurboSquid) all
require an authenticated account and per-asset licence review. The sandbox has
neither. Downloading a model without being able to read its licence would violate
the brief's own rule ("no asset with an unknown licence is integrated").

**What I did instead:** integrated 14 **CC0** PBR textures from Poly Haven (licence
verified via their API and licence page), and built the geometry procedurally.
This is honest and licence-clean, but it is **not** the photoreal look the brief
asks for. `docs/PAID_ASSETS.md` lists exactly what to buy (~$600–1,500) to reach
that bar, with sources and licence clauses to confirm.

### 5.2 Not implemented in G1 (by design — these are G2–G5)

| Feature | Gate | Status |
|---|---|---|
| Vehicles (T-34, Panzer IV, Sd.Kfz 251) | G2 | Not started |
| Artillery / aircraft flyovers | G2 | Not started |
| Multiple maps (city, forest, station, large) | G3 | Only the village map exists |
| Game modes (TDM, Conquest, Battle Royale) | G3 | Only mission + training |
| Multiplayer (authoritative server, prediction) | G4 | **Not started — not claimed** |
| WebGPU renderer path | G5 | Feature-flagged, **not verified** |
| Hand-keyed weapon animations | — | Procedural only (ADR-005) |
| Real recorded weapon audio | — | Synthesised only (ADR-006) |

### 5.3 Known limitations

- **Viewmodel animation** is procedural (springs + IK). It is consistent across
  all 26 weapons and tunable from data, but it will not match hand-keyed AAA
  animation. Stated plainly.
- **Weapon audio** is synthesised from layered noise/impulse models. Zero
  licensing risk and fully parameterised, but less rich than real recordings.
- **Character models** are procedural low-poly. They have the correct uniforms,
  helmets and equipment per faction, and 6 face/hair/build/height variations, but
  they are not scanned or sculpted humans.
- **WebGPU** is exposed behind a settings toggle and labelled experimental. It is
  **not** covered by any performance number in this report.
- **Multiplayer** does not exist. The simulation is deterministic and structured
  for it (fixed timestep, seeded RNG, intent-based input), but no server is
  written and no two-client test has been run.

---

## 6. How to run

```bash
npm install
npm run dev        # development server
npm run build      # production build -> dist/
npm run preview    # serve the production build
npm test           # 30 unit tests
```

Open the served URL. `?mission=m01_hold_the_village` jumps straight into the
village mission. Press `F3` in game for the profiler overlay.

---

## 7. Next step

**G2 — Weapons and vehicles**, on the condition that the asset question is
resolved first. Building more weapons on procedural geometry multiplies the same
visual gap. The highest-value next action is for the user to approve a budget and
a source from `docs/PAID_ASSETS.md`, or to provide a Sketchfab account so the
Download API can be driven for CC-BY assets.

If the user prefers to continue without paid assets, the honest next step is
**G2 on the mechanics only** (more weapons, vehicles, artillery) with the visual
bar explicitly deferred to a later asset pass.
