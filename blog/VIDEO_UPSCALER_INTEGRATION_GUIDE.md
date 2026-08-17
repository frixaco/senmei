# Video → Upscaler Integration Guide (Teaching Reference)

This guide is the assistant's crib sheet for teaching the wiring of the MKV
player (`mkv.ts`) into the Anime4K WebGPU upscaler (`main.ts` / `upscaler.ts`).
The implementer builds it themselves; this document is not handed to them as a
tutorial.

It captures what was learned while getting the wiring working, the mechanics
worth teaching, and the failure modes worth probing. It pairs with
[WEBGPU_WGSL_PIPELINE_GUIDE.md](./WEBGPU_WGSL_PIPELINE_GUIDE.md) (the GPU
concepts) and [MKV_PARSER_GUIDE.md](./MKV_PARSER_GUIDE.md) (the demux concepts).

## How To Answer (Teaching Mode)

These rules govern every reply while guiding the implementer.

- Never give a ready-made solution, answer, or complete code block. The
  implementer owns the build; a pasted fix transfers that ownership back to you.
- Lead with explanation, first principles, and reasoning. Teach "why" before
  "what".
- Prefer questions over statements. Ask the implementer to reason about the next
  step; give them the pieces, not the answer.
- Teach mechanics as patterns with a name and a rationale (producer/consumer,
  bounded buffer, pull-based generator, timestamp pacing, queue ordering,
  texture reuse). When they hit a mechanic, name it and explain the invariant,
  not the code.
- Give checkpoints, invariants, and failure modes, not copy-paste. Mirror the
  style of `MKV_PARSER_GUIDE.md`: "here is the property that must hold; here is
  what breaks if it does not."
- When they are stuck, ask one diagnostic question that points at the wrong
  assumption, instead of stating the bug.
- Do not narrate ownership ("I already know this", "you own this"). Just teach.
  The implementer is the one writing every line.
- Escalate only to correct a claim that is wrong or a plan that hides real risk;
  otherwise let their implementation proceed and verify.

## The Big Picture

Two flows must meet at one point:

```text
video:  MKV bytes -> demux chunks -> decode VideoFrames -> ??? -> canvas
image:  image     -> upload to texture        -> passes  -> canvas
```

The image path already does the full GPU half: upload pixels to a texture, run
the Anime4K pass chain, draw the result. The video path already does the decode
half: turn clusters into `VideoFrame`s. The `???` is the single seam between
them.

## The Seam

The two modules meet at exactly one operation: copying pixels into a GPU
texture.

- `mkv.ts` today copies each `VideoFrame` straight into the canvas swapchain
  (`ctx.getCurrentTexture()`) and is done.
- `main.ts` copies an `<img>` into an `rgba16float` source texture, then runs the
  pass chain, then draws.

Wiring means: make the video frame land in that same `rgba16float` source
texture, then run the same pass chain. No shader changes, no new GPU concepts.

Teaching question to open with: "What does each file already own? What is the
single point where they must agree?"

## Three Facts That Make It Legal

These are the concepts the implementer must arrive at (guide them, do not state
all three up front).

### Fact A — a `VideoFrame` is already a valid copy source

`copyExternalImageToTexture` accepts `ImageBitmap | HTMLImageElement | ... |
VideoFrame` as its source. The image path uses one union member; the video path
uses another. There is no intermediate conversion texture needed. The only real
difference is which member you hand it.

### Fact B — the pass chain self-activates from a size ratio, not a hardcoded scale

Each pass has a `when` predicate fed `{ main, native, output }` sizes:

- `Upscale_CNN_x2` runs when `output / main > 1.2` on both axes.
- `AutoDownscalePre_x2` runs when `1.2 < output / native < 2.0`.
- `AutoDownscalePre_x4` runs when `2.4 < output / native < 4.0`.
- `Clamp` and `Restore_VL` have `when = null` and always run.

Consequence: you never hardcode a scale factor for video. You feed the correct
`native` (source size, 1×) and `output` (canvas size) and the chain decides. At
exactly 2× output the upscale passes run and the auto-downscale pre-passes are
skipped (2.0 is not `< 2.0`, and 2.0 is not in `(2.4, 4.0)`).

Failure mode: setting `output` from the wrong source (e.g. `naturalWidth`
instead of the frame's display size), which makes the ratios wrong and
activates the wrong passes.

### Fact C — the pipeline expects `rgba16float`

Every bind-group layout uses `sampleType: "float"` and every intermediate
texture is `rgba16float`. The video source texture must match, or the views and
bindings are the wrong format.

## The Mechanics

These are the reusable patterns worth teaching by name. Each has an invariant
and a failure mode.

### 1. Async generator = pull-based demux

`getVideoData` is an `async *` generator. It holds its cluster-iteration state
(`cursor`, the current cluster, `timestampScale`) in closure variables and
`yield`s one chunk descriptor at a time.

- The consumer pulls with `.next()`.
- Each `yield` suspends the generator; the next `.next()` resumes it right after
  the yield.
- Block bytes are fetched lazily inside the loop (`await reader.read(...)`), so
  nothing is read before it is needed.

Invariant: the demux only parses a cluster and reads a block when the decoder
asks for it. This is the pull model from `MKV_PARSER_GUIDE.md` applied to
playback: control is inverted — the decoder decides how fast the demux runs.

Failure mode: thinking the generator "pushes" frames. It does not; it waits at
each `yield`.

### 2. Bounded buffer + park/wakeUp = backpressure

Two independent loops run: a producer (the decode queue) and a consumer (the
render loop). They meet at a bounded array of `VideoFrame`s with a cap.

- Producer: before decoding more, if the buffer is at cap, `await park()`.
- Consumer: after taking a frame off, call `wakeUp()`.
- `park()` returns a fresh Promise and stores its resolver in `wakeUp`;
  `wakeUp()` invokes the latest stored resolver.

Invariant: the producer never runs more than the cap ahead of the consumer. This
bounds memory (decoded frames are not free) and decouples decode rate from
render rate.

Failure modes:

- consuming without waking → producer sleeps forever → buffer drains → freeze.
- waking when nothing is parked → harmless no-op, but signals a bookkeeping bug
  worth noticing.
- a single-slot signal: `park()` re-captures the resolver each call, so only the
  most recent park is woken. Multiple pending producers would need a different
  shape.

### 3. Timestamp-paced rAF render loop

The render loop is a scheduler, not a "draw as fast as possible" loop. It runs
every `requestAnimationFrame` and decides whether the current frame is due.

- An anchor (`startedAt`) is set from the first frame's timestamp.
- Each tick computes elapsed time and compares it to the frame's timestamp.
- If the frame is in the future, re-schedule and return without presenting.

Invariant: frames are presented on the media clock, not the vsync clock. The
timestamps are microseconds — the elapsed computation must be in the same unit,
or everything presents instantly (or never).

Failure mode: a unit mismatch in the µs conversion flips pacing into "all frames
immediately" or "no frames ever".

### 4. GPU queue ordering + frame lifecycle

The GPU queue is FIFO. Enqueue the copy first, then the pass submissions, then
`frame.close()`.

- `copyExternalImageToTexture` captures the frame's pixel data when enqueued, so
  closing the frame after the copy is safe.
- The render passes are submitted after the copy on the same queue, so they read
  the freshly written source texture.

Invariant: copy → run passes → close, never close before the copy is enqueued.

Failure mode: closing the frame before the copy enqueues invalidates the source.

### 5. Texture reuse vs one-shot allocation

The image path allocates everything per call: roughly thirty intermediate
textures and roughly forty pipelines/bind-group layouts. That is fine once. At
24–60 calls per second it is the difference between "keeps up" and "crawls".

The split to teach:

- **One-time setup** — pipelines and bind-group layouts depend only on shader
  code and binding counts (both static). Compile once.
- **Per-frame work** — only bind groups (cheap) and the source copy.
- **Intermediate texture cache** — each pass gets its own output texture, reused
  across frames, reallocated only when the computed size changes.

Why per-pass (not per-name) reuse is the correct shape: a pass that reads "MAIN"
and writes "MAIN" would read and write the _same_ texture if you reused by name,
which is a render-pass self-dependency. Giving each pass its own dedicated
output texture means the read source and the write destination are always
different objects.

Also teach: the name→texture map must be reset each frame (fresh `MAIN`/`NATIVE`
= the source). Otherwise a name read before it is written this frame silently
reads last frame's value instead of failing loudly — the original one-shot code
guaranteed "every read is of a name produced earlier in the same run", and a
per-frame map preserves that invariant.

## The Architecture Trap

The single biggest wrong turn is dropping the image path's `doWebGPU` body into
the per-frame loop unchanged. It recompiles and reallocates everything every
call. Teach the setup-vs-run split (Mechanic 5) before any code is written, and
have the implementer name what is static and what is per-frame.

A good framing question: "Which of these objects could be created once and
reused forever, and which must change every frame? What tells you which is
which?"

## Gotchas And Failure Modes

These are real findings from getting the wiring working.

- **Color is approximate.** Video SDR is BT.709 transfer and limited range
  (16–235), not sRGB full range. Tagging the copy `colorSpace: "srgb"` matches
  the image path and is close enough to start, but dark scenes may be slightly
  off. Verify visually; do not chase exact color in the first pass. HDR
  (BT.2020/PQ) is out of scope for this pipeline.
- **Output sizing uses the frame's display size**, not `naturalWidth`.
  `native` = the frame's display size (1×), `output` = the canvas size you
  target.
- **The parser is picky about mux layout.** A plain ffmpeg-muxed MKV failed in
  `init()` because the `SEEK_HEAD` handling assumes every child has a
  `SEEK_POSITION`; ffmpeg writes a different SeekHead shape (the lookup returns
  undefined and a `.dataStart` read throws). Lesson: test against a known-good
  file (`data/fate08.mkv`, the same shape the parser was written for), and do
  not assume "any MKV" parses.
- **Range serving is a hard requirement.** The HTTP backend probes with
  `Range: bytes=0-0` and reads `fileSize` from the `206` response. If the server
  returns `200` instead, `fileSize` stays `0`, every read returns empty, and the
  parser throws EOF. A same-origin dev server that honors `206` is required.
- **`duration` is not yielded** by the current demux, so `chunk.duration` is
  `undefined`. Harmless for wiring; relevant later for A/V sync.

## Performance Measurement Methodology

This is how "can the upscaler keep up" was actually answered, and it is worth
teaching as a mechanic.

- The render loop is wall-clock paced, so counting _enqueued_ frames alone is
  misleading — it would read ~24 fps even if the GPU were falling behind.
- The honest signal is GPU-side completion: `device.queue.onSubmittedWorkDone()`
  resolves when the queued work drains. Count two rates per second:
  - **presented** = frames enqueued (draw calls),
  - **completed** = `onSubmittedWorkDone` resolutions.
- If presented == completed, no backlog. If completed < presented, the GPU is
  falling behind and the gap grows.
- Also record **avg GPU latency** = submit-to-resolve time per frame, and compare
  it to the frame budget (`1000 / fps`).

Measured result (1080p24 → 2× / 4K, on the M4 Pro):

- presented ≈ 24/s, completed ≈ 24/s — no backlog.
- avg GPU latency ≈ 30 ms steady state, vs a 41.7 ms budget at 23.976 fps.
- First frame ≈ 142 ms (warmup: allocation + first uploads). Ignore the first
  sample.

Conclusion the implementer should reach: the upscaler keeps up with headroom at
1080p24 → 2×.

## Checkpoints (Socratic Ladder)

Walk the implementer through these in order; each is a "does this property hold"
check, not a code dump.

1. Identify the seam: name the one operation both paths share.
2. State what `rgba16float` means for the source texture, and why it must match.
3. Explain how `native` and `output` sizes drive pass activation, and what
   happens at exactly 2×.
4. Explain the generator's pull model: where it suspends, where it resumes, when
   bytes are read.
5. Explain the bounded buffer: who parks, who wakes, and what breaks if either
   half is wrong.
6. Explain the timestamp-paced loop and the µs unit requirement.
7. Explain queue ordering and why the frame can be closed after the copy.
8. Name what is one-time (static) vs per-frame in the pass runner, and justify
   each.
9. Explain why per-pass output textures avoid a read/write alias.
10. Measure presented vs completed and read the result against the frame budget.
