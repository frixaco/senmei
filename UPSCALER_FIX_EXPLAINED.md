# Upscaler Fix Explained (Beginner Friendly)

## Short version

The upscaler network was doing math in many passes, but we were saving those pass results into an **8-bit color texture** (`rgba8unorm`).

That format can only store values from `0` to `1` (after normalization), with low precision.

Anime4K CNN passes need more range and precision, including negative numbers during intermediate math.

So important data got clipped/lost between passes.

Result: image size became 2x, but detail enhancement was weak or looked like normal upscale.

## What was the actual problem?

Inside CNN stages, intermediate textures were created/rendered as:

- `rgba8unorm`

This is okay for final display image, but bad for neural-network-like intermediate feature maps.

Feature maps are not normal image pixels. They are temporary math values.

When those values are forced into 8-bit normalized format:

- negative values get crushed
- small differences get quantized away
- network signal quality collapses

So next pass receives damaged input.

## Why did that kill quality?

Think of it like this:

- CNN pass A writes notes for pass B
- but notebook only allows tiny whole numbers and no minus sign
- half the notes become wrong
- pass B, C, D keep building on bad notes

You still get an output image at 2x size.
But network cannot reconstruct fine anime lines/details correctly.

## Concrete examples

### Example 1: value clipping

Suppose one CNN pass outputs this feature value for a pixel:

- `-0.35`

If stored in `rgba8unorm`, negative is not representable, so it becomes:

- `0.0`

Next pass expects `-0.35` (important for edge direction), but receives `0.0`.
That changes its output math.

Another one:

- real value: `0.503`
- `rgba8unorm` stores only 8-bit steps (roughly `1/255`)
- stored value becomes approx `0.502` or `0.506`

One tiny error is fine.
But this happens across many channels, many pixels, many passes, so error stacks up.

### Example 1b: tiny visual for clipping

What we wanted to keep:

```text
-0.35   0.12   0.78   1.40
```

What `rgba8unorm` can keep:

```text
 0.00   0.12   0.78   1.00
```

Lost info:

- negative value was crushed (`-0.35` -> `0.00`)
- value above 1 got capped (`1.40` -> `1.00`)

### Example 2: pass chain damage

Your active 2x path is effectively:

- Stage1 (Clamp)
- Stage2 (Restore CNN)
- Stage3 (Upscale CNN VL)

Stage2 and Stage3 each have many internal passes.
If pass 1..N write clipped data, pass N+1 starts from damaged input.

So by final pass, output can be different from bicubic but still not truly sharper.

Simple visual:

```text
Pass A -> Pass B -> Pass C -> Final
  OK      bad in    worse in   weak detail
```

If each pass gets slightly broken input, final output quality drops a lot.

### Example 3: why stats looked weird

You had:

- changed pixels vs bicubic: high
- detail gain vs bicubic: very low/negative

This means output was different, but difference was not useful edge detail.
That matches clipped/quantized feature-map behavior.

### Example 4: edge detail in plain numbers

Imagine one line edge (dark -> bright):

```text
Ideal sharp edge:   0   0   0   1   1   1
Bicubic-like edge:  0  0.2 0.4 0.6 0.8  1
Broken CNN output:  0  0.1 0.4 0.6 0.7 0.9
```

Broken CNN is different from bicubic, but not sharper.
So "changed pixels" can be high while "detail gain" stays low.

### Example 5: bucket analogy (very beginner)

Think each pass writes water levels into buckets:

- real math needs bucket range from about `-2` to `+2`
- `rgba8unorm` bucket range is only `0` to `1`

So:

- water below 0 is thrown away
- water above 1 spills away

Next pass uses wrong water levels.

### Example 6: pipeline sketch

```text
Input image
   |
   v
Stage1 Clamp
   |
   v
Stage2 Restore CNN  (many internal textures)
   |
   v
Stage3 Upscale CNN  (many internal textures)
   |
   v
Output 2x
```

Bug was inside the "many internal textures" boxes:

- before: `rgba8unorm` (too limited)
- after:  `rgba16float` (enough range/precision)

### Example 7: simple before/after expectation

Before fix:

- lines may look "bigger but soft"
- texture detail unstable
- metrics can say "near baseline"

After fix:

- lines cleaner/more defined
- less fake blur from internal clipping
- stronger chance of positive detail gain

## How was it fixed?

Changed CNN working textures and pass targets to **half-float**:

- `rgba16float`

That preserves range + precision much better for intermediate CNN math.

Files updated:

- `pipeline/shared.ts` (texture helper now accepts format)
- `pipeline/2.ts` (Restore CNN VL uses float working format)
- `pipeline/3.ts` (Upscale CNN x2 VL uses float working format)
- `pipeline/4.ts` (AutoDownscalePre x2 uses float working format)
- `pipeline/5.ts` (AutoDownscalePre x4 uses float working format)
- `pipeline/6.ts` (Upscale CNN x2 M uses float working format)

## Why this works

Now each pass keeps meaningful values instead of clipping them to 8-bit normalized color.

So later passes receive correct feature-map data.

Network behavior matches intended Anime4K math much more closely.

That is why you now see actual quality improvement, not just bigger resolution.

## One extra note (not the main bug)

At exact 2x upscale, some stages are skipped by Anime4K `!WHEN` rules.
That is expected logic, not the bug fixed here.

Main bug was precision/range loss from using `rgba8unorm` for CNN internals.
