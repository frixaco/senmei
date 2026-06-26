# Anime4K Shader Breakdown

This guide explains two confusing names that show up early in the WebGPU
pipeline:

1. `STATSMAX` from `Anime4K_Clamp_Highlights.ts`
2. `conv2d_tf` from the CNN upscaler shaders

You do not need to understand neural networks or shader math deeply to wire
these up. The most important pipeline rule is this:

```text
A shader pass reads one or more textures and writes one texture.
The name after SAVE is the name of the texture it writes.
The name after BIND is the name of a texture it reads.
```

So when a shader says this:

```text
//!BIND STATSMAX
//!SAVE STATSMAX
```

your TypeScript pipeline should read the old `STATSMAX` texture and then replace
it with the newly written `STATSMAX` texture.

## First: What Is A Saved Texture?

Think of the pipeline as a row of image-processing stations.

```text
source image
  -> station A writes "intermediate result A"
  -> station B reads "intermediate result A" and writes "intermediate result B"
  -> station C reads "intermediate result B" and writes final image
```

In Anime4K, intermediate results have names like:

- `STATSMAX`
- `conv2d_tf`
- `conv2d_1_tf`
- `conv2d_last_tf`

Those are not JavaScript variables by themselves. They are names your pipeline
uses to look up GPU textures.

```ts
const textures = new Map<string, GPUTexture>();

textures.set("MAIN", sourceTexture);
textures.set("STATSMAX", statsMaxTexture);
textures.set("conv2d_tf", conv2dTexture);
```

When you see this in a shader file:

```text
//!SAVE conv2d_tf
```

that means:

```ts
textures.set("conv2d_tf", outputTexture);
```

That is the main trick.

## Shader Group 1: Clamp Highlights And `STATSMAX`

File:

```text
shaders/Anime4K_Clamp_Highlights.ts
```

This shader group exists to reduce bright ringing artifacts around edges.

Ringing is the bright outline or halo that can appear around sharp anime lines
after scaling or sharpening. The clamp pass tries to stop a pixel from becoming
brighter than the local highlight range around it.

### The Goal In Plain English

For every pixel:

1. Look at nearby pixels.
2. Find a local brightness limit.
3. If the current pixel is brighter than that limit, pull it down.
4. Keep the color shape mostly the same, but reduce the too-bright part.

That local brightness limit is stored in `STATSMAX`.

### What `STATSMAX` Means

`STATSMAX` is a helper image. It is not meant to be displayed.

Each pixel in `STATSMAX` stores one useful number:

```text
the brightest nearby luma value
```

`luma` means brightness made from RGB. The shader uses this helper:

```wgsl
fn get_luma(rgba: vec4f) -> f32 {
  return dot(rgba, vec4f(0.299, 0.587, 0.114, 0.0));
}
```

You can read that as:

```text
brightness = red amount + green amount + blue amount
```

Green gets the largest weight because human vision notices green brightness
strongly. You do not need to memorize the numbers.

### Pass P1: Horizontal Brightness Scan

Metadata:

```text
//!DESC Anime4K-v4.0-De-Ring-Compute-Statistics
//!HOOK MAIN
//!BIND HOOKED
//!SAVE STATSMAX
//!COMPONENTS 1
```

Meaning:

```text
read:  current image
write: STATSMAX
size:  same logical size as the hooked image
```

The shader loops across nearby pixels horizontally:

```wgsl
for (var i: i32 = 0; i < KERNELSIZE; i += 1) {
  let g = get_luma(tex_off(frame, pos, i - KERNELHALFSIZE, 0));
  gmax = max(g, gmax);
}
```

Beginner translation:

```text
For this output pixel:
  look 2 pixels left
  look 1 pixel left
  look at this pixel
  look 1 pixel right
  look 2 pixels right
  remember the brightest brightness found
  write that brightness into STATSMAX
```

The output is a one-number-per-pixel helper texture. In WGSL it still returns a
`vec4f`, so the useful number goes in the red channel:

```wgsl
return vec4f(gmax, 0.0, 0.0, 0.0);
```

### Pass P2: Vertical Brightness Scan

Metadata:

```text
//!BIND HOOKED
//!BIND STATSMAX
//!SAVE STATSMAX
//!COMPONENTS 1
```

Meaning:

```text
read:  old STATSMAX from P1
write: new STATSMAX
```

This pass does the same idea vertically:

```wgsl
for (var i: i32 = 0; i < KERNELSIZE; i += 1) {
  let g = tex_off(stats_max, pos, 0, i - KERNELHALFSIZE).x;
  gmax = max(g, gmax);
}
```

Beginner translation:

```text
P1 found horizontal brightness limits.
P2 looks up and down through those P1 results.
Together, P1 + P2 create a small 5x5 neighborhood brightness limit.
```

It is split into two passes because GPUs are fast at doing simple repeated work
over the whole image.

### Pass P3: Clamp The Current Pixel

Metadata:

```text
//!DESC Anime4K-v4.0-De-Ring-Clamp
//!HOOK PREKERNEL
//!BIND HOOKED
//!BIND STATSMAX
```

Meaning:

```text
read:  current image
read:  STATSMAX helper texture
write: clamped image
```

Important lines:

```wgsl
let current = tex_at(frame, pos);
let current_luma = get_luma(current);
let new_luma = min(current_luma, tex_at(stats_max, pos).x);
let delta = current_luma - new_luma;

return current - vec4f(delta);
```

Beginner translation:

```text
current_luma = how bright this pixel is now
stats_max    = how bright this pixel is allowed to be
new_luma     = whichever is lower
delta        = how much brightness needs to be removed
output       = current pixel with that brightness removed
```

If the pixel is already fine, `delta` is zero and the pixel stays the same.

If the pixel is too bright, the shader subtracts the extra brightness.

### What Your TypeScript Pipeline Should Do

At a high level:

```text
run Clamp P1:
  bind MAIN/HOOKED as input
  write output texture
  save output as STATSMAX

run Clamp P2:
  bind MAIN/HOOKED as input
  bind STATSMAX from P1
  write output texture
  replace STATSMAX with this new output

run Clamp P3:
  bind current image
  bind STATSMAX from P2
  write clamped image
  continue pipeline with clamped image
```

The important part is that P2 reads `STATSMAX` and also writes `STATSMAX`.
Do not read and write the same `GPUTexture` in one pass. Create a new output
texture, then update the map after the pass finishes.

## Shader Group 2: CNN Convolution And `conv2d_tf`

Files:

```text
shaders/Anime4K_Upscale_CNN_x2_M.ts
shaders/Anime4K_Upscale_CNN_x2_VL.ts
shaders/Anime4K_Restore_CNN_VL.ts
```

The exact layer count changes by model, but the idea is the same.

### What CNN Means Here

`CNN` means convolutional neural network.

For this project, you can think of it as:

```text
a chain of small image filters whose numbers were learned ahead of time
```

At runtime, Senmei is not training the network. It is only running the fixed
filters that are already baked into the shader source as numbers.

Those big `mat4x4f(...)` blocks are the learned numbers.

### What `conv2d_tf` Means

`conv2d_tf` is the saved output of the first convolution layer.

Name breakdown:

```text
conv2d = 2D convolution layer
tf     = likely inherited from TensorFlow-style layer naming
```

For the WebGPU pipeline, the exact history of the name does not matter. Treat it
as a texture key.

```text
conv2d_tf = first CNN intermediate result texture
```

It is not a normal viewable image. It is a feature map.

### What Is A Feature Map?

A feature map is an image-like texture that stores intermediate clues the neural
network found.

For example, a normal image pixel stores:

```text
red, green, blue, alpha
```

A CNN feature pixel stores:

```text
feature 0, feature 1, feature 2, feature 3
```

Those features might respond to edges, curves, line direction, color changes, or
other patterns. The shader does not name them in human terms. They are just
numbers that later layers know how to use.

That is why these passes usually say:

```text
//!COMPONENTS 4
```

Each pixel stores four feature numbers in one RGBA-like texture.

### First CNN Pass: Write `conv2d_tf`

Example metadata from `Anime4K_Upscale_CNN_x2_M.ts`:

```text
//!DESC Anime4K-v3.2-Upscale-CNN-x2-(M)-Conv-4x3x3x3
//!HOOK MAIN
//!BIND MAIN
//!SAVE conv2d_tf
//!WIDTH MAIN.w
//!HEIGHT MAIN.h
//!COMPONENTS 4
```

Meaning:

```text
read:  MAIN image
write: conv2d_tf
size:  same width and height as MAIN
data:  four feature values per pixel
```

The helper:

```wgsl
fn go_0(pos: vec4f, x_off: f32, y_off: f32) -> vec4f {
  return tex_off(frame, pos, x_off, y_off);
}
```

Beginner translation:

```text
go_0 gets a nearby pixel from the input image.
```

Then the shader does this pattern many times:

```wgsl
result = result + mat4x4f(...) * go_0(pos, -1.0, 0.0);
```

Beginner translation:

```text
sample a nearby pixel
multiply it by learned weights
add it into the result
```

The first CNN pass looks at a 3x3 area around each pixel:

```text
top-left      top      top-right
left          center   right
bottom-left   bottom   bottom-right
```

For each output pixel, it combines those 9 sampled pixels into 4 feature
numbers. Those 4 numbers become the pixel stored in `conv2d_tf`.

### Why The Numbers Can Look Weird

In a normal color image, channel values are usually in a display range like
`0.0..1.0`.

CNN feature maps are different. They can be:

```text
negative
zero
larger than one
not meaningful as visible colors
```

That is why intermediate CNN textures should use a float format such as:

```ts
format: "rgba16float";
```

Do not store CNN feature maps in `rgba8unorm`; that format clamps values to a
display-friendly range and would destroy negative feature values.

### Second CNN Pass: Read `conv2d_tf`

Example metadata:

```text
//!BIND conv2d_tf
//!SAVE conv2d_1_tf
//!WIDTH conv2d_tf.w
//!HEIGHT conv2d_tf.h
//!COMPONENTS 4
```

Meaning:

```text
read:  conv2d_tf
write: conv2d_1_tf
size:  same size as conv2d_tf
```

Important helpers:

```wgsl
fn go_0(pos: vec4f, x_off: f32, y_off: f32) -> vec4f {
  return max(tex_off(conv2d_tf, pos, x_off, y_off), vec4f(0.0));
}

fn go_1(pos: vec4f, x_off: f32, y_off: f32) -> vec4f {
  return max(-tex_off(conv2d_tf, pos, x_off, y_off), vec4f(0.0));
}
```

Beginner translation:

```text
go_0 keeps the positive part of the previous feature.
go_1 keeps the negative part, flipped into a positive number.
```

This is a common way for these converted shaders to handle feature values. The
network wants to know both:

```text
where a feature is strongly present
where the opposite of that feature is strongly present
```

Then the shader combines those values with more learned weights and writes the
next feature texture, `conv2d_1_tf`.

### The CNN Chain

The CNN passes are a sequence of intermediate textures:

```text
MAIN
  -> conv2d_tf
  -> conv2d_1_tf
  -> conv2d_2_tf
  -> conv2d_3_tf
  -> ...
  -> conv2d_last_tf
  -> final reconstructed/upscaled image
```

Each intermediate texture is like a worksheet for the next layer. You usually
do not display these textures. You keep them around only long enough for later
passes to read them.

### What Your TypeScript Pipeline Should Do

At a high level:

```text
run CNN P1:
  bind MAIN
  write output texture
  save as conv2d_tf

run CNN P2:
  bind conv2d_tf
  write output texture
  save as conv2d_1_tf

run CNN P3:
  bind conv2d_1_tf
  write output texture
  save as conv2d_2_tf
```

Continue following each pass's `BIND`, `SAVE`, `WIDTH`, and `HEIGHT` metadata.

The shader comments are the recipe. The TypeScript pipeline is the cook.

## Side-By-Side Summary

| Name        | Kind                | Human meaning                            | Display it? |
| ----------- | ------------------- | ---------------------------------------- | ----------- |
| `STATSMAX`  | helper texture      | local brightness limit for clamp/de-ring | no          |
| `conv2d_tf` | CNN feature texture | first learned feature-map output         | no          |

Both are just GPU textures saved by one pass and read by a later pass.

The difference is what they store:

```text
STATSMAX stores brightness statistics.
conv2d_tf stores neural-network feature values.
```

## Tiny Glossary

### Texture

An image-like block of data on the GPU.

### Channel

One number inside a pixel. Normal images have channels like red, green, blue,
and alpha. Feature maps use the same storage shape but the channels are generic
numbers.

### Luma

Brightness calculated from RGB.

### Kernel

The small neighborhood of pixels a shader looks at. In these examples, the
shader often looks at 5 pixels or a 3x3 block.

### Convolution

A pass that looks at nearby pixels, multiplies them by fixed weights, adds the
results, and writes a new value.

### Feature Map

An intermediate CNN texture. It stores pattern-detection numbers instead of normal
display colors.

### Weights

The fixed learned numbers baked into the shader, usually inside `mat4x4f(...)`
blocks.

## Practical Implementation Notes

When building the pipeline, keep these rules in mind:

1. A pass can read multiple textures but writes one output texture.
2. If a pass says `SAVE NAME`, store its output texture under `NAME`.
3. If a pass says `BIND NAME`, look up `NAME` and bind that texture.
4. If a pass reads and saves the same name, use a new output texture and update
   the map after the pass.
5. Use float formats for CNN intermediates, because feature values can be
   negative.
6. Do not try to preview every intermediate as if it were a normal image.

If the wiring is correct, the names start to feel less mysterious:

```text
STATSMAX is a brightness helper.
conv2d_tf is a CNN helper.
Both are intermediate textures.
```
