# AGENTS.md

## Scope

Applies to entire repo.
Nested `AGENTS.md` files take precedence for their subtree.

## Project Standard

Senmei is built as a complete browser anime player with a hand-authored WebGPU
Anime4K pipeline. Favor clear, reversible changes over heavy process.

## Project Goal

Build a browser-based anime player with real-time upscaling:

- MKV playback pipeline (demux/decode/render)
- Anime4K parity in WebGPU/WGSL
- Basic subtitles support

## Repo Map (Quick)

- `main.ts`: app entry and minimal UI wiring
- `shaders/*.ts`: WGSL ports embedded as TypeScript string exports
- `vite.config.ts`: Vite dev/build config with Tailwind CSS plugin
- `data/`: sample images for local testing
- `Anime4K/`: upstream reference GLSL/docs for parity checks

## Run (Local)

- Install/cache deps: `deno install`
- Start dev server: `deno task dev`
- Open: `http://localhost:3000`
- Browser: Chromium-based with WebGPU enabled

## Working Norms (Lightweight)

- Keep each task to one logical change when possible.
- Match local code style and patterns in touched files.
- Fix root cause first; avoid patching symptoms.
- Treat error paths as first-class (not happy-path only).
- Avoid adding dependencies unless they are clearly needed for the current task.
- Keep architecture practical and directly tied to the player and upscaler.

## Verification

Use fast manual verification unless task needs more:

- App boots at `localhost:3000`
- Can load an image preview
- Process button runs the WebGPU pipeline for image input

If rebuilding pipeline/shaders, also verify:

- pass order remains:
  `Clamp -> Restore_VL -> Upscale_x2_VL -> AutoDownscalePre_x2 -> AutoDownscalePre_x4 -> Upscale_x2_M`
- stage dimensions/conditions still align with the Anime4K parity plan in `README.md`

## Project Priorities

- Maintain the WebGPU setup and shader pipeline by hand
- Close parity gaps vs Anime4K GLSL `Ctrl+1 (HQ)` behavior
- Make output sizing/reactivity correct on resize/fullscreen/DPR changes
- Keep pass activation logic faithful to GLSL semantics (`!WHEN`, `MAIN/NATIVE/OUTPUT`)
- Connect the image and video paths through the same WebGPU pipeline

## Handoff Expectations

When finishing a task, report:

- assumptions made
- files changed
- verification performed
- known gaps or follow-ups
