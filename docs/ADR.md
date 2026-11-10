# Architecture Decision Records

Each record: context, decision, consequences. Records marked **REVISIT** are the ones
most likely to change as the project grows.

---

## ADR-001 — WebGPU first, WebGL2 as the verified path
**Context.** The brief asks for `WebGPURenderer` with automatic WebGL2 fallback.
Three.js WebGPU support is real but its post-processing stack and some material
features are still moving targets, and WebGPU is unavailable on a large share of
target mobile devices.
**Decision.** Build a renderer abstraction with both backends. Ship **WebGL2 as the
default and the only path covered by the G1 performance numbers**. WebGPU is exposed
behind a settings toggle and is labelled *experimental* in the UI.
**Consequences.** We do not claim WebGPU performance we have not measured. When the
WebGPU post-processing path stabilises we flip the default and re-measure. **REVISIT at G5.**

---

## ADR-002 — Rapier for physics, custom integrator for bullets
**Context.** Rapier is fast and WASM-portable, but simulating thousands of rifle
rounds as rigid bodies is wasteful and gives poor long-range behaviour.
**Decision.** Rapier handles characters, vehicles, props and debris. Bullets use a
custom integrator: analytic drag + gravity, stepped raycasts against the collision
world, with material penetration and ricochet tables.
**Consequences.** Long-range ballistics are cheap and tunable; we own the hit
resolution code and must test it (see `tests/ballistics.test.ts`).

---

## ADR-003 — In-house sparse-set ECS instead of bitECS/miniplex
**Context.** The brief suggests bitECS or miniplex. Both are good, but bitECS's
SoA API is awkward for the mixed data we have, and miniplex allocates objects per
entity which fights our zero-GC hot-path goal.
**Decision.** Write a small sparse-set ECS (~200 lines) with typed component stores.
**Consequences.** Full control over allocation and iteration order; we own the code
and its tests. Cost: no ecosystem tooling. **REVISIT if entity counts exceed ~50k.**

---

## ADR-004 — Data-driven everything, validated at load
**Context.** The brief forbids hard-coded values.
**Decision.** Weapons, ammo, attachments, characters, maps and missions live in
`src/data/*.json`. A hand-written validator (`data/schema.ts`) checks every field at
startup and fails loudly with the offending path. No magic numbers in systems.
**Consequences.** Balance changes are data edits. Cost: a schema to maintain.

---

## ADR-005 — Procedural viewmodel animation over baked animation clips
**Context.** The brief wants per-weapon draw/reload/bolt animations. Sourcing
matching first-person animation sets for a dozen WW2 weapons is expensive and the
licences are messy.
**Decision.** Drive the viewmodel with a spring/IK rig in code: recoil impulse,
sway, bob, ADS blend, bolt cycle, magazine path, bipod fold. Parameters per weapon
in data.
**Consequences.** Every weapon animates consistently and we can tune feel without
re-exporting assets. Cost: it will not match hand-keyed AAA animation quality —
stated plainly in the test report.

---

## ADR-006 — Synthesised weapon audio instead of sampled libraries
**Context.** The brief lists Freesound/Sonniss/etc. Real, well-recorded, correctly
licensed gunshot libraries are either paid or have unclear provenance, and the
sandbox cannot verify a licence it cannot read.
**Decision.** Synthesise gunshots from layered models (mechanical transient, close
crack, body, tail, distant report) using noise bursts, filtered impulses and
convolution reverb. Footsteps, reloads and explosions are synthesised the same way.
**Consequences.** Zero licensing risk, tiny download, fully parameterised per weapon.
Cost: less 