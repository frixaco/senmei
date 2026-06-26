# Senmei - watch anime in real-time, upscaled to 4K, in your browser

- MKV video player with essential features like play/pause, seek, and streaming from URL
  - video: H.264/AVC (8-bit) and HEVC/H.265 (8/10-bit)
  - audio: AAC stereo
- upscaling with WebGPU using a multi-stage, multi-pass render pipeline
- subtitle support with positioning and plain text rendering

### Dependencies

- [Anime4K](https://github.com/bloc97/Anime4K) - High-End HQ Mode A preset
- Chromium-based browser
- [mediabunny](https://github.com/Vanilagy/mediabunny) - demuxing, seeking
- `WebCodecs`, `AudioWorklet`, `Web Worker`
- `WebGPU`, `WGSL/GLSL` shaders
- [typegpu](https://github.com/software-mansion/TypeGPU) - WGSL authoring utilities

### Implementation Scope

- Port these Anime4K shaders to WGSL:
  - Anime4K_Clamp_Highlights.glsl
  - Anime4K_Restore_CNN_VL.glsl
  - Anime4K_Upscale_CNN_x2_VL.glsl
  - Anime4K_AutoDownscalePre_x2.glsl
  - Anime4K_AutoDownscalePre_x4.glsl
  - Anime4K_Upscale_CNN_x2_M.glsl
- Maintain the WebGPU setup and Anime4K shader pipeline by hand
- Current pipeline uses `rgba16float` intermediates throughout; future parity and
  performance work may map `//!COMPONENTS 1/2` passes to narrower texture formats.
- Write the Matroska parser with an API tuned for video players
- Handle color space conversion explicitly: https://x.com/wrennly_dev/status/2039326806260748757

### Learning Notes

- [WebGPU and WGSL Pipeline Guide](docs/WEBGPU_WGSL_PIPELINE_GUIDE.md) -
  project-specific mental model for implementing the Anime4K pipeline.

### Canvas sizing tip

Rendering sizing keeps the real source frame dimensions and the display box separate:
use `ResizeObserver` to watch the canvas container, multiply CSS pixels by `devicePixelRatio` for the canvas backing size, set CSS `aspect-ratio` from the current video frame or image dimensions, and rerun the sizing function on resize, fullscreen changes, and DPR changes.

## Advanced Capabilities

### Option 1: Lock-Free SharedArrayBuffer + Atomics Pipeline (Zero GC)

Worker communication can use `postMessage(data, [transferable])`, which is fast but still triggers JavaScript event loop overhead.

- The capability: use a single 50MB SharedArrayBuffer (SAB) as a ring buffer for the video stream.

- How: Your Network Worker writes HTTP chunks directly into the SAB. Your Decoder Worker reads from the exact same memory space using Atomics.wait() and Atomics.add() to synchronize pointers without locking the thread.

- Why it's impressive: This is exactly how AAA game engines handle memory. You are effectively writing a custom memory allocator in JavaScript. V8's Garbage Collector will literally never run because you never allocate a new object after startup. Memory usage becomes mathematically flat.

### Option 2: Client-Side Video Scrub Previews (The "YouTube Hover" effect)

Usually, to show video thumbnails when hovering over the seek bar, a backend server runs FFmpeg to generate a massive JPEG sprite sheet and sends it to the client.

- The capability: generate scrubbing thumbnails entirely client-side, on-the-fly, with zero backend processing.

- How you do it: You spawn a second, hidden VideoDecoder in a background worker. When the user's mouse hovers over a timestamp, you use Mediabunny to fetch only the specific I-Frame (keyframe) byte chunk for that timestamp. You decode just that one frame, scale it down using createImageBitmap, and send it to the UI to display above the cursor.

- Why it's a 7/7 flex: It demonstrates absolute mastery over the demuxer and the hardware decoder. You are multiplexing two separate decode pipelines on the same file, utilizing the HTTP Range request beautifully to save bandwidth, and providing a premium UX feature for free.

### Option 3: Custom TCP-Style Network Controller (EWMA Chunking)

Streaming fetches should avoid arbitrary chunk sizes. If the user's internet is slow, fixed chunks can buffer; if it is fast, fixed chunks can download too far ahead and waste bandwidth when the user closes the tab early.

- The capability: use an adaptive chunking algorithm with an Exponentially Weighted Moving Average (EWMA), just like real video streaming platforms (Netflix/YouTube) use for DASH.

- How you do it: You monitor the exact millisecond duration of every fetch chunk. You calculate the user's real-time bandwidth. If their internet is 500Mbps, you fetch small chunks (e.g., 500KB) right before they are needed (saving you VPS money). If their internet drops to 10Mbps, you dynamically increase the chunk size and buffer aggressively to prevent a stall.

- Why it's a 7/7 flex: Infrastructure engineers will drool over this. It shows you aren't just thinking about the frontend—you are optimizing cloud architecture egress costs and protecting against network volatility using classic networking algorithms.

### Option 4: Perfect 23.976Hz to 60Hz/144Hz Pacing (Telecine Mitigation)

Anime runs at 24000/1001 (23.976) frames per second. Monitors run at 60Hz or 144Hz. 24 does not divide evenly into 60. If you just draw the frame "when it's ready," you get telecine judder (some frames stay on screen for 2 monitor refreshes, some for 3), making panning camera shots in anime look stuttery.

- The capability: use a custom WebGPU presentation scheduler.

- How you do it: Instead of just relying on requestAnimationFrame, you use the Web Audio clock (which is sample-accurate to the microsecond) combined with the VideoFrame.timestamp. You calculate exactly which V-Sync cycle of the monitor the frame should appear on, and you hold the WebGPU frame in a queue until the exact nanosecond it's required.

- Why it's a 7/7 flex: You have identified and solved a notorious rendering artifact (judder) that plagues even native desktop video players. It proves you understand the relationship between presentation timestamps (PTS), monitor refresh rates, and the browser's render loop.
