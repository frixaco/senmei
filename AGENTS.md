# AGENTS.md

## Scope

Applies to entire repo.
If we add nested `AGENTS.md` later, deeper file wins for that subtree.

## Project Stage

Early WIP.
Current PoC complete: select image -> run full Anime4K pass chain -> get upscaled output in browser.
Favor momentum and clear, reversible changes over heavy process.

## Project Goal (Current)

Build a browser-based anime player with real-time upscaling:
- MKV playback pipeline (demux/decode/render)
- Anime4K parity in WebGPU/WGSL
- Basic subtitles support

## Repo Map (Quick)

- `main.ts`: app entry, UI wiring, GPU orchestration, benchmarking/saving output
- `pipeline/*.ts`: per-stage pipeline setup/encode flow
- `shaders/*.ts` and `shaders/*.wgsl`: WGSL ports and shader sources
- `png16.ts`: 16-bit PNG encode utilities
- `server.ts`: Bun static server + on-the-fly TS transpile for browser load
- `data/`: sample images for local testing
- `Anime4K/`: upstream reference GLSL/docs for parity checks

## Run (Local)

- Install: `bun install`
- Start dev server: `bun run dev`
- Open: `http://localhost:3000`
- Browser: Chromium-based with WebGPU enabled

## Working Norms (Lightweight)

- Keep each task to one logical change when possible.
- Match local code style and patterns in touched files.
- Fix root cause first; avoid patching symptoms.
- Treat error paths as first-class (not happy-path only).
- Avoid adding dependencies unless clearly needed for current milestone.
- Do not over-engineer for future architecture while PoC is still evolving.

## Verification (Right-Sized for WIP)

Use fast manual verification unless task needs more:
- App boots at `localhost:3000`
- Can load an image and process successfully
- Output renders and can be saved when expected

If touching pipeline/shaders, also verify:
- pass order remains:
  `Clamp -> Restore_VL -> Upscale_x2_VL -> AutoDownscalePre_x2 -> AutoDownscalePre_x4 -> Upscale_x2_M`
- stage dimensions/conditions still align with current parity plan in `README.md`

## Near-Term Priorities

- Close parity gaps vs Anime4K GLSL `Ctrl+1 (HQ)` behavior
- Make output sizing/reactivity correct on resize/fullscreen/DPR changes
- Keep pass activation logic faithful to GLSL semantics (`!WHEN`, `MAIN/NATIVE/OUTPUT`)
- Expand from image PoC into full video path

## Handoff Expectations

When finishing a task, report:
- assumptions made
- files changed
- verification performed
- known gaps or follow-ups
