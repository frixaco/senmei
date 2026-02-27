# Senmei - watch anime upscaled to 4K in your browser

A no-slop, hardware-accelerated MKV player with real-time WebGPU Anime4K upscaling.

### TODO

- [ ] Port following shaders to WGSL:
  - [ ] Anime4K_Clamp_Highlights.glsl
  - [ ] Anime4K_Restore_CNN_VL.glsl
  - [ ] Anime4K_Upscale_CNN_x2_VL.glsl
  - [ ] Anime4K_AutoDownscalePre_x2.glsl
  - [ ] Anime4K_AutoDownscalePre_x4.glsl
  - [ ] Anime4K_Upscale_CNN_x2_M.glsl
- [ ] handle !WHEN checks

**Core Pipeline (Native Browser APIs)**

- **WebCodecs:** for hardware-accelerated H.264/HEVC/AAC/H.265/10-bit decoding.
- **WebGPU:** for running ported WGSL Anime4K shaders
- **Web Audio API (`AudioWorklet`):** for audio playback and serving as the master clock for A/V sync.
- **Web Workers:** To move all network fetching and binary demuxing off the main UI thread.

**Dependencies**

- **`mediabunny`:** For lazy, chunked MKV/EBML parsing and seeking. Extracts encoded packets without loading the whole file into memory.
- (not sure) **`typegpu`:** To construct the Anime4K WebGPU render graph in a heavily typed, developer-friendly way (replacing raw WGSL string concatenation with TypeScript safety).

**Build & UI**

- **TypeScript:** - Rust + WASM wasn't an option, unfortunately.
- (not sure, might go for vanilla JS/CSS) **Tanstack Start:** Custom video controls, seek bar, and subtitle overlays.

---

### Scope

**1. Input & Streaming**

- Accepts a direct file URL or stream URL.
- **Must** support HTTP `Range` requests (`206 Partial Content`) to allow Mediabunny to lazily fetch chunks and seek without downloading the whole 1.5GB file.

**2. Video & Audio Support**

- **Video:** H.264 (AVC) 8-bit, and HEVC 8-bit / 10-bit.
  - _Hardware-Check:_ Player will query `VideoDecoder.isConfigSupported()` before playback. If the GPU doesn't support the codec (e.g., software-only 10-bit), it gracefully shows a "Hardware Not Supported" error.
- **Audio:** AAC Stereo.
- **Sync:** Custom A/V sync engine using the audio track as the master clock, dropping late video frames to maintain sync.

**3. Subtitles (The "Plain Text" Hack)**

- Extracts ASS subtitle packets via Mediabunny.
- Strips all `{...}` styling tags.
- Renders English text in a plain DOM `<div>` overlayed on the canvas.
- Supports basic positioning: Default is bottom-center; `\an8` tags place text at top-center.

**4. Anime4K Upscaling Pipeline**

- Takes decoded 1080p `VideoFrame` objects.
- Uses `typegpu` to run a 2-to-4 pass Anime4K WGSL shader pipeline.
- Outputs the finalized, upscaled frame to a 4K (`3840x2160`) WebGPU `<canvas>`.

**5. Playback Controls**

- Play / Pause / Volume.
- Scrub bar with seeking.
- +/- 10-second quick jump buttons.
- (Seeking architecture flushes WebCodecs, finds nearest keyframe via Mediabunny, and decodes forward to the target timestamp).

**6. "Nerd Stats" Overlay (UI Metrics)**

- Render FPS vs Video FPS.
- Network Buffer Health (MB/s).
- Video frames dropped / decoded.
- Approximate memory usage (`performance.memory` tracking the 175MB target).

---

### Out of Scope

- **No Software Decoding Fallback:** If the GPU can't play it, the player doesn't play it.
- **No 10-bit H.264 (Hi10P):** Instantly rejected by the hardware checker.
- **No ASS Styling Engine:** No fonts, colors, karaoke, or vector shapes.
- **No Playback Rate/Pitch Shifting:** 1.0x speed only.
- **No Track Switching:** Auto-selects the first video, first (JP) audio.

---

### Memory goal: under 175MB

1.  **Network Worker:** Mediabunny requests `Range: bytes=0-1000000` from the VPS.
2.  **Demux Layer:** Mediabunny parses the MKV Cluster and yields `EncodedPacket` objects.
3.  **Backpressure Check:** If the WebCodecs queue has > 10 frames, pause fetching.
4.  **Hardware Decode:** Packets are fed to `VideoDecoder`.
5.  **Thread Transfer:** The decoder yields a `VideoFrame`. It is instantly transferred (`postMessage({ frame }, [frame])`) to the Main Thread (zero-copy).
6.  **GPU Render (TypeGPU):** Main Thread binds the `VideoFrame` to an `external_texture`. TypeGPU dispatches the Anime4K compute passes.
7.  **The Golden Rule:** The exact millisecond `device.queue.submit()` is called, you execute `frame.close()`. _If you miss this step, memory spikes to 1GB in 5 seconds._

## IDEAS

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
