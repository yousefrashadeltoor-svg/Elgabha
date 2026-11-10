# Performance Budgets

Measured with the in-game profiler (`F3`) and recorded in `TEST_REPORT_G1.md`.

| Item | Desktop target | Mid mobile target | G1 measured (desktop, WebGL2) |
|---|---|---|---|
| FPS | 60 (High) | 30–60 (auto) | see report |
| Draw calls | <= 1500 | <= 400 | see report |
| Triangles / frame | <= 3M | <= 700K | see report |
| GPU texture memory | <= 1 GB | <= 300 MB | see report |
| First load to menu | <= 25 MB | <= 25 MB | see report |
| First-person viewmodel | 40–80K tri | 25–40K tri | procedural, see report |
| World weapon model | 4–10K + LOD | 2–5K | procedural, see report |
| Character LOD0/1/2 | 30K / 10K / 3K | 15K / 6K / 2K | procedural, see report |
| Tank LOD0 | 80–150K | 40–70K | not in G1 |

## How to measure
1. `npm run build && npm run preview`
2. Open the game, press `F3` for the profiler overlay.
3. Record: FPS (1% low), draw calls, triangles, JS heap, GPU memory estimate.
4. Numbers go in the test report verbatim — no rounding up.
