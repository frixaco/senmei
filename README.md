# Senmei - watch anime in real-time, upscaled to 4K, in your browser

- MKV video player with essential features like play/pause, seek, streaming from URL (potentially, MP4)
  - video: H.264/AVC (8-bit) and HEVC/H.265 (8/10-bit)
  - audio: AAC (potentially, OPUS and FLAC) stereo
- upscaling done with WebGPU using in multi-stage, multi-pass render pipeline (PoC done)
- subtitle support (positioning supported, styling is not supported)

### Dependencies

- [Anime4K](https://github.com/bloc97/Anime4K) - High-End HQ Mode A preset (for now) - confirmed
- Chromium-based browser - confirmed
- [mediabunny](https://github.com/Vanilagy/mediabunny) - demuxing, seeking - not confirmed
- `WebCodecs`, `AudioWorklet`, `Web Worker`
- `WebGPU`, `WGSL/GLSL` shaders
- [typegpu](https://github.com/software-mansion/TypeGPU) - easier to work with WGSL shaders - not confirmed

### TODO

- [x] Port following shaders to WGSL:
  - [x] Anime4K_Clamp_Highlights.glsl
  - [x] Anime4K_Restore_CNN_VL.glsl
  - [x] Anime4K_Upscale_CNN_x2_VL.glsl
  - [x] Anime4K_AutoDownscalePre_x2.glsl
  - [x] Anime4K_AutoDownscalePre_x4.glsl
  - [x] Anime4K_Upscale_CNN_x2_M.glsl
- [ ] Full parity checklist vs Anime4K GLSL `Ctrl+1 (HQ)`:
  - [ ] derive `OUTPUT` from real render target size (canvas/backbuffer), not fixed `input * 2`
  - [ ] rebuild/rebind pipeline stages when `OUTPUT` changes (resize/fullscreen/DPR change)
  - [ ] keep exact stage order: `Clamp -> Restore_VL -> Upscale_x2_VL -> AutoDownscalePre_x2 -> AutoDownscalePre_x4 -> Upscale_x2_M`
  - [ ] enforce stage dimensions from GLSL directives:
    - [ ] `AutoDownscalePre_x2`: `WIDTH OUTPUT.w`, `HEIGHT OUTPUT.h`
    - [ ] `AutoDownscalePre_x4`: `WIDTH OUTPUT.w / 2`, `HEIGHT OUTPUT.h / 2`
  - [ ] evaluate each pass `!WHEN` using GLSL context semantics (`MAIN`, `NATIVE`, `OUTPUT`) at runtime
  - [ ] parity test matrix against mpv pass activation: `1x`, `1.5x`, `2x`, `3x`, `4x`

## Side Quests

### Current project rating: 6/7

You are combining **low-level binary streaming** (Mediabunny), **advanced threading** (Workers + AudioWorklets), **strict memory management** (GC avoidance, backpressure), and **modern GPU graphics programming** (TypeGPU + WGSL Anime4K) into a single, cohesive, dependency-light web app.

It is a perfect showcase of Full-Stack Web Systems engineering.

### Option 1: Lock-Free SharedArrayBuffer + Atomics Pipeline (Zero GC)

Right now, you are passing data between Workers and the Main thread using postMessage(data, [transferable]). This is fast, but it still triggers JavaScript event loop overhead.

- The 7/7 Upgrade: Completely abandon standard message passing for the video stream. Allocate a single 50MB SharedArrayBuffer (SAB) acting as a Ring Buffer.

- How: Your Network Worker writes HTTP chunks directly into the SAB. Your Decoder Worker reads from the exact same memory space using Atomics.wait() and Atomics.add() to synchronize pointers without locking the thread.

- Why it's impressive: This is exactly how AAA game engines handle memory. You are effectively writing a custom memory allocator in JavaScript. V8's Garbage Collector will literally never run because you never allocate a new object after startup. Memory usage becomes mathematically flat.

### Option 2: Client-Side Video Scrub Previews (The "YouTube Hover" effect)

Usually, to show video thumbnails when hovering over the seek bar, a backend server runs FFmpeg to generate a massive JPEG sprite sheet and sends it to the client.

- The Feature: Generate scrubbing thumbnails entirely client-side, on-the-fly, with zero backend processing.

- How you do it: You spawn a second, hidden VideoDecoder in a background worker. When the user's mouse hovers over a timestamp, you use Mediabunny to fetch only the specific I-Frame (keyframe) byte chunk for that timestamp. You decode just that one frame, scale it down using createImageBitmap, and send it to the UI to display above the cursor.

- Why it's a 7/7 flex: It demonstrates absolute mastery over the demuxer and the hardware decoder. You are multiplexing two separate decode pipelines on the same file, utilizing the HTTP Range request beautifully to save bandwidth, and providing a premium UX feature for free.

### Option 3: Custom TCP-Style Network Controller (EWMA Chunking)

Right now, if you stream a file, you might fetch it in arbitrary 2MB chunks. If the user's internet is slow, it buffers. If it's fast, you download way ahead of time, which wastes your VPS bandwidth (egress costs) if the user closes the tab early.

- The Feature: Write an Adaptive Chunking algorithm using an Exponentially Weighted Moving Average (EWMA), just like real video streaming platforms (Netflix/YouTube) use for DASH.

- How you do it: You monitor the exact millisecond duration of every fetch chunk. You calculate the user's real-time bandwidth. If their internet is 500Mbps, you fetch small chunks (e.g., 500KB) right before they are needed (saving you VPS money). If their internet drops to 10Mbps, you dynamically increase the chunk size and buffer aggressively to prevent a stall.

- Why it's a 7/7 flex: Infrastructure engineers will drool over this. It shows you aren't just thinking about the frontend—you are optimizing cloud architecture egress costs and protecting against network volatility using classic networking algorithms.

### Option 4: Perfect 23.976Hz to 60Hz/144Hz Pacing (Telecine Mitigation)

Anime runs at 24000/1001 (23.976) frames per second. Monitors run at 60Hz or 144Hz. 24 does not divide evenly into 60. If you just draw the frame "when it's ready," you get telecine judder (some frames stay on screen for 2 monitor refreshes, some for 3), making panning camera shots in anime look stuttery.

- The Feature: Write a custom WebGPU Presentation Scheduler.

- How you do it: Instead of just relying on requestAnimationFrame, you use the Web Audio clock (which is sample-accurate to the microsecond) combined with the VideoFrame.timestamp. You calculate exactly which V-Sync cycle of the monitor the frame should appear on, and you hold the WebGPU frame in a queue until the exact nanosecond it's required.

- Why it's a 7/7 flex: You have identified and solved a notorious rendering artifact (judder) that plagues even native desktop video players. It proves you understand the relationship between presentation timestamps (PTS), monitor refresh rates, and the browser's render loop.
