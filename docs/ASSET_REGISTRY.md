# Asset Registry

Rule: **no asset is integrated with an unknown licence.** Every row records source,
licence, and the verification method used.

## Integrated in G1

| Asset | Type | Source | Licence | Verified | Notes |
|---|---|---|---|---|---|
| brown_mud, snow_02, withered_grass, gravel, dirt, brick_wall_001, damaged_plaster, wood_planks, concrete, rusty_metal, dark_rock, clay_roof_tiles, forest_floor, rubble | PBR textures (diffuse/normal/ARM, 1K JPG) | Poly Haven | **CC0** | API metadata + licence page read | Downloaded via `tools/fetch_textures.py`; registry written to `public/assets/textures/registry.json` |
| Terrain, buildings, trenches, sandbags, props | Procedural geometry | Generated in-engine | Original work | n/a | Built from primitives + the CC0 textures above |
| Weapon audio, footsteps, explosions, ambience | Procedural synthesis | Generated in-engine (Web Audio) | Original work | n/a | See ADR-006 |
| UI icons, fonts | Inline SVG + system font stack | Original work | Original work | n/a | No third-party icon font |

## Evaluated and NOT integrated

| Asset | Source | Licence | Why not |
|---|---|---|---|
| Kar98k / PPSh-41 / MG42 models | Sketchfab (various authors) | Mostly **CC-BY-NC** or 