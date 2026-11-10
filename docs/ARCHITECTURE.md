# Frontline 1943 — Architecture (G0)

Browser-only WW2 Eastern Front tactical FPS. React + Vite + TypeScript (strict) + Three.js + Rapier.

## 1. Module map

```
src/
  core/      engine primitives: loop, ECS, time, events, math, rng, object pools
  data/      ALL tunables as data: weapons, ammo, attachments, characters, maps, missions, i18n
  render/    renderer abstraction, materials, terrain, sky, weather, post-fx, viewmodel
  physics/   Rapier world, character controller, raycast service, collision layers
  weapons/   state machine, ballistics, recoil, attachment resolution, bipod/deploy
  audio/     Web Audio graph, buses, procedural synthesis, spatialisation
  ai/        behaviour tree, perception (vision/hearing), squad coordination, difficulty
  world/     map builder, navmesh, cover points, destruction, streaming
  ui/        React: HUD, menus, settings, touch controls, credits
  net/       (G4) authoritative client, prediction, reconciliation
  game/      game modes, mission scripting, spawning, scoring
```

**Hard rule:** `ui/` never imports from `render/` or `physics/` directly. It reads a
read-only snapshot published by the simulation each tick. React re-renders at most
~10 Hz for HUD values; the 3D loop never touches React state.

## 2. Data flow

```
Input (pointer/keyboard/gamepad/touch/gyro)
   -> Intent  (plain struct: move vector, look delta, action flags)
   -> Simulation @ fixed 60 Hz  (ECS systems, Rapier step, weapon state machines)
   -> EventBus (shot fired, hit, reloaded, died, exploded)
   -> Presentation @ display rate (renderer interpolation, audio, HUD snapshot)
```

Simulation is deterministic given (seed, intent stream). This is what makes G4
netcode possible without rewriting the game: the server runs the same systems.

## 3. Fixed timestep + interpolation

- Accumulator loop, `DT = 1/60`. Max 5 catch-up steps per frame (spiral-of-death guard).
- Every transform has `prev` and `curr`; the renderer lerps by `alpha = acc/DT`.
- Physics steps inside the fixed step, never in the render callback.

## 4. ECS

Sparse-set ECS written in-house (`core/ecs.ts`). Rationale in ADR-003.
- Components are plain typed arrays / struct-of-arrays per component type.
- Systems are pure functions over queries; no allocation in the hot path.
- Entity ids are `{index, generation}` packed into a number to catch stale handles.

## 5. Rendering

`render/renderer.ts` exposes one interface with two backends:
- **WebGL2** (verified path for G1) — `THREE.WebGLRenderer`.
- **WebGPU** (opt-in, feature-flagged) — `THREE.WebGPURenderer` + TSL nodes.

Quality tiers (Low/Medium/High/Ultra) drive: shadow map size, shadow cascades,
render scale, texture anisotropy, particle budget, decal budget, LOD bias.
Dynamic resolution scales render target between 0.6x and 1.0x to hold the FPS target.

## 6. Physics

Rapier 3D (WASM, `rapier3d-compat`). Collision groups:
`WORLD | PLAYER | ENEMY | PROJECTILE | DEBRIS | TRIGGER | VEHICLE`.
Bullets are **not** Rapier bodies — a custom ballistic integrator raycasts per step
(ADR-004). Character uses a kinematic capsule controller with slope/step handling.

## 7. Weapons

Data-driven. `data/weapons/*.json` -> validated by `data/schema.ts` at load.
State machine: `Holstered -> Drawing -> Idle -> Firing -> Cycling -> Reloading -> Holstering`.
Bolt-action, stripper-clip and magazine-as-entity reloads are first-class.

## 8. Audio

Single `AudioContext`. Graph:
`source -> [panner(HRTF)] -> busGain -> [convolver per environment] -> masterGain -> destination`.
Buses: weapons, environment, dialogue, music, ui. Ducking + tinnitus on explosions.
Gunshots are **synthesised** from layered noise/impulse models (ADR-006) so the build
ships with zero third-party audio licensing risk.

## 9. Persistence

`localStorage` for settings/progress in the browser. No server dependency for G1.

## 10. Build & deploy

Vite build -> static `dist/`. Assets hashed, Brotli, long cache. Service worker caches
assets after first load (offline-resilient). No secrets in the client bundle.
