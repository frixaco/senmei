# Anime4K_Upscale_CNN_x2_VL.glsl Explained (Very Concrete, No Jargon)

This guide explains `glsl/Upscale/Anime4K_Upscale_CNN_x2_VL.glsl` in plain words.

Main goal:

- you can open the file
- you can point to each step
- you can say what that step does in normal words

---

## 0) Promise for this document

No "jargon soup".

When a code word must appear, I give plain meaning right next to it.

---

## 1) Only two assumptions

Assume only this:

- an image is a grid of pixels
- each pixel holds color numbers

That is enough.

---

## 2) Old words -> plain words (use this map)

I will mostly use plain words. If you see old terms elsewhere:

- `feature` -> temporary number used during calculation
- `two branches` -> two temporary-image name lines: `_tf` line and `_tf1` line
- `dual-branch refinement` -> six rounds where each round reads one `_tf` + one `_tf1`, then writes next `_tf` + next `_tf1`
- `fusion head` -> big combine step near the end
- `depth-to-space` -> unpack stored values into a 2x2 block in bigger image
- `residual add` -> `final = original + correction`

---

## 3) What this shader does in one plain sentence

It takes a smaller image, computes many temporary numbers, turns those numbers into a 2x bigger pixel grid, then uses those numbers as color changes (add or subtract) to the original color.

---

## 4) What is stored where

This file uses many image-sized buffers.

- input image: `MAIN`
- temporary outputs: `conv2d_tf`, `conv2d_tf1`, `conv2d_1_tf`, and so on

Each temporary output pixel stores 4 numbers (because `//!COMPONENTS 4`).

Important:

- these temporary numbers are not final RGB color
- they are intermediate math values used by later steps

---

## 5) Why file is long

Because this is generated math code from trained weights:

- lots of constants
- same pattern repeated many times
- loops expanded by generator for speed

So the file looks scary, but the structure repeats.

---

## 6) `//!` lines: pipeline instructions

These lines tell the shader runner how to wire passes.

- `//!BIND X` -> read texture `X`
- `//!SAVE Y` -> write output texture `Y`
- `//!WIDTH ...` / `//!HEIGHT ...` -> output size for this pass
- `//!COMPONENTS 4` -> output has 4 numbers per pixel
- `//!WHEN ...` -> run only if condition is true

In this shader, `//!WHEN` checks that real upscaling is needed.

---

## 6.1) What the `/ 1.200` part means

Good catch: it is **`1.200`** (same as `1.2`), not `1200`.

The real line in source is:

```text
//!WHEN OUTPUT.w MAIN.w / 1.200 > OUTPUT.h MAIN.h / 1.200 > *
```

Plain meaning:

- compute width ratio: `OUTPUT.w / MAIN.w`
- compute height ratio: `OUTPUT.h / MAIN.h`
- check width ratio > `1.2`
- check height ratio > `1.2`
- run only if both checks are true

So this pass runs only when both width and height are at least 20% larger than input.

Quick examples:

- `1.10x` width and `1.10x` height -> do not run
- `1.30x` width and `1.30x` height -> run
- `1.30x` width and `1.05x` height -> do not run

Why this check exists:

- avoids heavy CNN work when scaling change is small
- lets a simpler resize method handle tiny resize cases

---

## 7) GLSL syntax used here (only what you need)

### 8.1 Function form

```glsl
vec4 hook() {
    ...
    return outColor;
}
```

- `vec4` before `hook` means function returns 4 numbers
- `return` gives final 4-number output for current pixel

### 8.2 Common types

- `float` = decimal number
- `int` = whole number
- `vec2` = 2 numbers
- `vec4` = 4 numbers
- `ivec2` = 2 whole numbers
- `mat4` = 4x4 matrix of numbers

### 8.3 Constructors

```glsl
vec2(1.0, -1.0)
vec4(c0, c1, c2, c3)
ivec2(0, 1)
```

This means "create that type with these values".

### 8.4 Accessing one value from `vec4`

- by name: `.x`, `.y`, `.z`, `.w`
- by index: `[0]`, `[1]`, `[2]`, `[3]`

Both mean pick one of the 4 stored numbers.

### 8.5 Sampling helpers (provided by framework)

```glsl
MAIN_tex(MAIN_pos)
MAIN_texOff(vec2(dx, dy))
```

- first reads current pixel value
- second reads neighbor offset `(dx,dy)` from current pixel

### 8.6 Macros

```glsl
#define go_0(x, y) max(conv2d_tf_texOff(vec2(x, y)), vec4(0.0))
```

`#define` creates a text shortcut before compile.

### 8.7 Math used all over

- `a + b`, `a - b`, `a * b`
- `max(v, 0.0)`
- `mat4 * vec4`

---

## 8) 18-step map of this file

Outputs in order:

1. `conv2d_tf`
2. `conv2d_tf1`
3. `conv2d_1_tf`
4. `conv2d_1_tf1`
5. `conv2d_2_tf`
6. `conv2d_2_tf1`
7. `conv2d_3_tf`
8. `conv2d_3_tf1`
9. `conv2d_4_tf`
10. `conv2d_4_tf1`
11. `conv2d_5_tf`
12. `conv2d_5_tf1`
13. `conv2d_6_tf`
14. `conv2d_6_tf1`
15. `conv2d_last_tf`
16. `conv2d_last_tf1`
17. `conv2d_last_tf2`
18. final `MAIN`

Grouped meaning:

- steps 1-2: first extraction from input image
- steps 3-14: six rounds, each round reads one `_tf` + one `_tf1` and writes the next pair
- steps 15-17: big combine at each pixel
- step 18: build 2x output grid and add original color

---

## 9) Steps 1-2: first extraction from input image

Starts at:

- `glsl/Upscale/Anime4K_Upscale_CNN_x2_VL.glsl:24`
- `glsl/Upscale/Anime4K_Upscale_CNN_x2_VL.glsl:46`

Both steps read `MAIN` using a 3x3 neighborhood.

3x3 means each output pixel uses this neighbor set:

```text
(-1,-1) (0,-1) (1,-1)
(-1, 0) (0, 0) (1, 0)
(-1, 1) (0, 1) (1, 1)
```

The two steps use different weights, so they create two different temporary outputs.

---

## 10) What exactly happens in the six repeated rounds (steps 3-14)?

From step 3 to step 14:

- there are two name lines of temporary images:
  - line A: names ending in `_tf`
  - line B: names ending in `_tf1`
- each round does the same pattern:
  1. read previous A and B textures
  2. read neighbor pixels (3x3)
  3. use `max(x,0)` and `max(-x,0)` split
  4. write new A texture and new B texture

Exact round-by-round mapping:

- round 1: read `conv2d_tf`, `conv2d_tf1` -> write `conv2d_1_tf`, `conv2d_1_tf1`
- round 2: read `conv2d_1_tf`, `conv2d_1_tf1` -> write `conv2d_2_tf`, `conv2d_2_tf1`
- round 3: read `conv2d_2_tf`, `conv2d_2_tf1` -> write `conv2d_3_tf`, `conv2d_3_tf1`
- round 4: read `conv2d_3_tf`, `conv2d_3_tf1` -> write `conv2d_4_tf`, `conv2d_4_tf1`
- round 5: read `conv2d_4_tf`, `conv2d_4_tf1` -> write `conv2d_5_tf`, `conv2d_5_tf1`
- round 6: read `conv2d_5_tf`, `conv2d_5_tf1` -> write `conv2d_6_tf`, `conv2d_6_tf1`

So "repeated cleanup/update" means exactly this repeated read-old-pair -> compute -> write-new-pair loop.

---

## 11) The `max(x,0)` and `max(-x,0)` pattern

You see this pattern a lot.

For one value `x`:

- `pos = max(x, 0)`
- `neg = max(-x, 0)`

Example with `x = -0.7`:

- `pos = 0`
- `neg = 0.7`

Why do this?

- later math can weight positive and negative evidence separately
- this gives more control than using raw `x` directly

You can rebuild the original value:

- `x = pos - neg`

---

## 12) Why labels like `Conv-4x3x3x16` appear

Read `Conv-4x3x3x16` as:

- output has 4 numbers per pixel
- neighborhood size is 3x3
- logic inside effectively uses 16 input channels

Where 16 comes from in these middle steps:

- 2 textures x 4 channels = 8
- split into positive and negative parts = 16

---

## 13) Steps 15-17: big combine near the end

Starts around:

- `glsl/Upscale/Anime4K_Upscale_CNN_x2_VL.glsl:704`
- `glsl/Upscale/Anime4K_Upscale_CNN_x2_VL.glsl:785`
- `glsl/Upscale/Anime4K_Upscale_CNN_x2_VL.glsl:866`

These steps use `1x1`.

`1x1` means:

- no neighbor pixels used
- only current pixel location used
- but many channels from many textures are mixed

So this is a per-pixel "big combine".

Why `112` in `Conv-4x1x1x112`:

- 14 input textures are bound
- each texture gives 4 channels -> `14 x 4 = 56`
- positive/negative split doubles logic -> `112`

Outputs from these three steps:

- `conv2d_last_tf`
- `conv2d_last_tf1`
- `conv2d_last_tf2`

---

## 14) Step 18: where 2x image is actually built

Starts at `glsl/Upscale/Anime4K_Upscale_CNN_x2_VL.glsl:947`.

This step sets output size to:

- width x 2
- height x 2

So this is the first step that writes the larger image grid.

Why this is true (hard proof in code):

- `//!WIDTH conv2d_last_tf.w 2 *`
- `//!HEIGHT conv2d_last_tf.h 2 *`

Example:

- if input is `1280 x 720`
- this step writes `2560 x 1440`

All earlier steps keep old size.

So:

- earlier steps = compute color-change numbers
- this final step = actual pixel-count increase (real upscaling)

If pixel count does not increase, that is sharpening only.
Here pixel count does increase in this final step.

### Concrete picture

One low-res pixel at `(x, y)` maps to four high-res pixels:

- `(2x, 2y)`
- `(2x+1, 2y)`
- `(2x, 2y+1)`
- `(2x+1, 2y+1)`

The step chooses which of these four positions it is writing now, then picks matching stored value from the last temporary outputs.

This unpacking process is what people call "depth-to-space".

---

## 15) Why there are three `conv2d_last_*` outputs

Final assembly reads:

- `conv2d_last_tf`
- `conv2d_last_tf1`
- `conv2d_last_tf2`

Then makes `c0`, `c1`, `c2`, `c3`.

In this file, `c3` is set equal to `c2`.

See near `glsl/Upscale/Anime4K_Upscale_CNN_x2_VL.glsl:960`.

---

## 16) Final add-back step

Final line is:

```glsl
return vec4(c0, c1, c2, c3) + MAIN_tex(MAIN_pos);
```

Read this literally:

- left side = predicted correction values
- right side = original sampled color
- result = original + correction

This add-back process is what people call "residual add".

---

## 17) Full file in short pseudocode

```text
input = MAIN

// first two outputs
a0 = Step3x3(input)
b0 = Step3x3(input)

// six repeated rounds: read previous pair, write next pair
(a1, b1) = UpdateBoth(a0, b0)
(a2, b2) = UpdateBoth(a1, b1)
(a3, b3) = UpdateBoth(a2, b2)
(a4, b4) = UpdateBoth(a3, b3)
(a5, b5) = UpdateBoth(a4, b4)
(a6, b6) = UpdateBoth(a5, b5)

// three big combine steps
u0 = CombineAtSamePixel(all previous outputs)
u1 = CombineAtSamePixel(all previous outputs)
u2 = CombineAtSamePixel(all previous outputs)

// build bigger grid and add original color
output = UnpackTo2x2(u0, u1, u2) + input
```

---

## 18) How to read the source file without getting lost

Use this exact order:

1. Read only `//!DESC`, `//!BIND`, `//!SAVE` lines.
2. Draw arrow graph of outputs feeding next steps.
3. Mark which steps are `3x3` and which are `1x1`.
4. Mark where `max(x,0)` and `max(-x,0)` pattern appears.
5. Read final step (`:947` onward) last.
6. Ignore giant constants until structure is clear.

---

## 19) Very short "am I understanding this right?" check

If these statements feel true, you got it:

- Most steps do not change image size.
- Only last step writes the 2x bigger grid.
- Middle steps mostly keep re-writing temporary outputs.
- End does `original + correction`.

---

## 20) Useful anchors in the original shader

- First step header: `glsl/Upscale/Anime4K_Upscale_CNN_x2_VL.glsl:24`
- Second first-step header: `glsl/Upscale/Anime4K_Upscale_CNN_x2_VL.glsl:46`
- First repeated-update block: `glsl/Upscale/Anime4K_Upscale_CNN_x2_VL.glsl:68`
- First big-combine block: `glsl/Upscale/Anime4K_Upscale_CNN_x2_VL.glsl:704`
- Final 2x build step: `glsl/Upscale/Anime4K_Upscale_CNN_x2_VL.glsl:947`
- Final return line: `glsl/Upscale/Anime4K_Upscale_CNN_x2_VL.glsl:968`

---

## 21) One-line recap

This file is an 18-step math pipeline: make temporary numbers, update them many times, unpack them into a 2x bigger pixel grid, then change original color by adding signed correction values.
