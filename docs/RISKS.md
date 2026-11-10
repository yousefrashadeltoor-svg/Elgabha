# Risk Register

| # | Risk | Likelihood | Impact | Mitigation | Status |
|---|---|---|---|---|---|
| R1 | **No licensed high-quality WW2 weapon/character models obtainable from this sandbox.** Sketchfab/Fab/CGTrader downloads need an authenticated account and per-asset licence review; the sandbox has neither. | High | High | Ship G1 with procedural geometry; publish a concrete paid-asset shopping list (`PAID_ASSETS.md`) for the user to approve. Do **not** silently substitute unlicensed rips. | **Realised** — see TEST_REPORT_G1 |
| R2 | WebGPU path unstable for post-processing | Medium | Medium | WebGL2 is the verified default (ADR-001) | Mitigated |
| R3 | Rapier WASM bundle size hurts first load | Medium | Medium | `rapier3d-compat` is ~1.5 MB gz; lazy-load it behind the loading screen; measure | Open |
| R4 | Procedural viewmodel animation looks worse than hand-keyed | High | Medium | Tune springs per weapon; state the gap honestly | Accepted |
| R5 | Synthesised gunshots sound less rich than real recordings | High | Medium | Layer 5 elements + per-environment convolution; offer the paid library list | Accepted |
| R6 | Mobile thermal throttling breaks the 30 FPS floor | Medium | High | Dynamic resolution, quality tiers, particle budgets | Open |
| R7 | Scope: 26 sections cannot all reach AAA depth in one pass | Certain | High | Gate discipline: G1 must be excellent before G2+. Report honestly per gate. | Accepted |
| R8 | Netcode (G4) untestable without two real clients | Medium | High | Do not claim multiplayer works until two real clients are tested | Open |
