# chat-upscale-mkv — condensed summary

## Final project direction (as conversation converged)
- Build Chromium-only MKV player for anime
- Stream from VPS URL with HTTP byte ranges
- Decode with WebCodecs, render with WebGPU, upscale with Anime4K-style WGSL passes
- Keep memory tight (~175MB target mindset)
- Use plain subtitle text overlay (not full ASS renderer)

## What got finalized near the end
- Preferred stack: TypeScript + Vite + Web Workers + WebCodecs + WebGPU + AudioWorklet + vanilla DOM UI
- Practical demux choice for v1: use `mediabunny` (zero-dep TS, lazy reads, seeking helpers)
- Keep runtime deps minimal; focus portfolio value on systems glue (A/V sync, backpressure, seeking, GPU pipeline), not parser reimplementation
- Project rated as high-impressiveness if executed well (especially sync + memory discipline + robust seek)

## Locked v1 scope (tight contract)
- Platform:
  - Chromium only
  - one MKV URL input
  - URL must behave like random-access file (`Range` + `206` + stable `Content-Length`)
- Codec/container limits:
  - video: H.264/AVC 8-bit
  - audio: AAC-LC stereo
  - subtitles: ASS text-only
- Must-have features:
  - play/pause
  - seek + +/-10s jump
  - stable A/V sync over full episode
  - 4K output canvas with bounded Anime4K pass count
  - metrics overlay (network/decode/render/memory basics)
- Subtitle handling:
  - strip ASS style tags `{...}`
  - convert `\N` to newline
  - support default bottom + `\an8` top only
- Explicit non-goals for v1:
  - full ASS styling/fonts/libass behavior
  - track switching
  - playback-rate/pitch correction
  - PiP
  - frame stepping
  - multi-track/multi-codec breadth

## HEVC/10-bit conclusion
- Later addition considered feasible if hardware-gated
- Required pattern:
  - derive accurate codec string from track metadata (`CodecPrivate`/config)
  - gate startup with `VideoDecoder.isConfigSupported(...)`
  - show graceful “not supported on your device” UI when unsupported
- Key warning: Hi10P H.264 usually unsupported in hardware; reject cleanly

## Audio-format expansion conclusion
- Reasonable next codecs: Opus, FLAC, Vorbis (if WebCodecs says supported)
- High pain / out-of-scope for now: AC-3/E-AC-3/DTS/TrueHD (likely needs WASM decoders)
- Hidden complexity mostly channels/sample-rate handling (stereo vs downmix policy), not just codec label

## Complexity + timeline consensus
- Demo band: ~1.5k–4k LoC
- Serious v1 band (your target features): ~5k–12k LoC
- Aggressive effort estimate for tight v1: ~50–70 focused hours
  - biggest risk areas: A/V sync drift, seek state machine/races, memory leaks from unclosed frames

## “7/7” upgrade ideas discussed (post-v1)
- Easiest/high-impact path: SharedArrayBuffer + Atomics lock-free pipeline
- Other advanced directions:
  - zero-main-thread render architecture via OffscreenCanvas
  - custom zero-allocation demuxer
  - client-side hover thumbnail decode pipeline
  - adaptive network chunk controller (EWMA)

## Practical takeaway
- Best execution order implied by conversation:
  1. ship tight v1 with Mediabunny + stable seek/sync + shader pipeline
  2. then add one “systems flex” feature (SAB/Atomics or custom demux) for standout portfolio impact
