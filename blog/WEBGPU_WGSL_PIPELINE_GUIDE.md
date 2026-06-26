# WebGPU and WGSL Pipeline Guide

This guide is for rebuilding Senmei's Anime4K WebGPU pipeline while learning the
concepts behind each piece. It assumes you already have the manually converted
WGSL shader strings in `shaders/`, but you are new to WebGPU and WGSL.

The short version:

1. WebGPU gives JavaScript a controlled way to talk to the GPU.
2. WGSL is the shader language that runs on the GPU.
3. Each Anime4K pass reads one or more textures, runs a shader over every output
   pixel, and writes a new texture.
4. The whole upscaler is just a carefully ordered chain of those passes.

For a slower explanation of `STATSMAX`, `conv2d_tf`, and the first Anime4K
shader groups, see [Anime4K Shader Breakdown](./ANIME4K_SHADER_BREAKDOWN.md).

## The Big Picture

Senmei eventually wants this flow:

```text
MKV bytes
  -> demux packets
  -> decode video frames
  -> upload frame to GPU texture
  -> Anime4K pass chain
  -> draw final texture to canvas
```

For the current image PoC, the front of the flow is simpler:

```text
image file
  -> ImageBitmap / HTMLImageElement
  -> upload image to GPU texture
  -> Anime4K pass chain
  -> draw final texture to canvas
```

The WebGPU part starts once you have pixels and want the GPU to process them.

## Core Terms

### Adapter

An adapter represents a physical or logical GPU available to the browser.

```ts
const adapter = await navigator.gpu.requestAdapter();
```

Think: "Which GPU can I use?"

### Device

A device is your app's connection to that adapter. You create almost every GPU
object from the device: textures, samplers, buffers, shader modules, pipelines,
bind groups, and command encoders.

```ts
const device = await adapter.requestDevice();
```

Think: "My handle for creating and submitting GPU work."

### Canvas Context

The canvas context is the bridge between WebGPU and the visible `<canvas>`.

```ts
const context = canvas.getContext("webgpu");
context.configure({
  device,
  format: navigator.gpu.getPreferredCanvasFormat(),
  alphaMode: "opaque",
});
```

Think: "Where the final pixels appear."

### Texture

A texture is an image on the GPU. In this project, textures are the main data
structure.

Examples:

- the original uploaded source frame
- `STATSMAX` from clamp highlights
- `conv2d_tf` from a CNN layer
- the final upscaled output
- the canvas texture for presentation

Most Anime4K passes are texture-in, texture-out.

### Texture View

A texture view is how a shader or render pass sees a texture.

A shader is a small program that runs on the GPU. In this project, most shaders
answer one question for one output pixel: "What value should this pixel become?"
The same shader runs many times in parallel, once for each pixel covered by the
draw.

A render pass is one recorded GPU operation that writes into one or more output
textures. For Anime4K, each render pass usually means:

```text
bind input textures
choose one output texture
draw a fullscreen triangle
run the fragment shader for every output pixel
store the result
```

The shader reads texture views. The render pass writes to a texture view. That
is why views show up on both sides of the pipeline.

```ts
const view = texture.createView();
```

Think: "A usable view into the texture."

### Sampler

A sampler controls how texture coordinates are sampled: nearest or linear
filtering, clamp or repeat addressing, mipmaps, and so on.

A sampler does not contain pixels. It contains the rules for reading pixels from
a texture.

Sampling means asking the GPU for a texture value at a coordinate. Shader code
usually samples with normalized UV coordinates:

```text
u = 0.0 is the left edge
u = 1.0 is the right edge
v = 0.0 is the top edge
v = 1.0 is the bottom edge
```

The sampler decides what happens when the coordinate lands between pixels or
outside the texture. With nearest filtering, the GPU picks the closest pixel.
With linear filtering, it blends neighboring pixels. With clamp-to-edge
addressing, coordinates outside the image use the nearest edge pixel instead of
wrapping around.

For Anime4K parity, start conservative:

```ts
const sampler = device.createSampler({
  magFilter: "nearest",
  minFilter: "nearest",
  addressModeU: "clamp-to-edge",
  addressModeV: "clamp-to-edge",
});
```

The converted shaders use calls like:

```wgsl
textureSampleLevel(frame, frame_sampler, uv, 0.0)
```

That means the shader needs both a texture binding and a sampler binding.

### Shader Module

A shader module is compiled WGSL code.

```ts
const module = device.createShaderModule({ code: wgslSource });
```

Your files in `shaders/` currently export WGSL strings such as `fragP1`,
`fragP2`, and `fragF`. Each string becomes a shader module.

### Pipeline

A pipeline is the GPU's prepared recipe for a draw or compute operation.

For the current Anime4K ports, use render pipelines. Each pass draws a
fullscreen triangle/quad, runs a fragment shader once per output pixel, and
writes to a texture.

Think: "This shader plus this render setup."

### Bind Group Layout

A bind group layout describes what resources a shader expects.

Example from current shaders:

```wgsl
@group(0) @binding(0) var frame: texture_2d<f32>;
@group(0) @binding(1) var frame_sampler: sampler;
@group(0) @binding(2) var stats_max: texture_2d<f32>;
```

That means group `0` has:

- binding `0`: sampled texture
- binding `1`: sampler
- binding `2`: another sampled texture

The JavaScript side must create a matching bind group layout and bind group.

### Bind Group

A bind group is the actual set of resources passed to the shader for one draw.

Think: "For this pass, binding 0 is the current frame, binding 1 is this
sampler, binding 2 is `STATSMAX`."

### Command Encoder

WebGPU does not execute calls immediately. You record GPU work into a command
encoder, finish it into a command buffer, then submit it.

```ts
const encoder = device.createCommandEncoder();
// record render passes here
device.queue.submit([encoder.finish()]);
```

Think: "Build the GPU todo list, then submit it."

## WGSL Mental Model

WGSL code runs on the GPU. JavaScript cannot call a WGSL function directly.
JavaScript creates resources, binds them, and asks the GPU to run a shader over
many pixels.

The converted Anime4K shaders are fragment shaders:

```wgsl
@fragment
fn f(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  return tex_at(frame, pos);
}
```

Important pieces:

- `@fragment`: this function runs during rasterization for each output pixel.
- `@builtin(position) pos`: the pixel position of the fragment in output texture
  coordinates.
- `@location(0) vec4f`: the color written to color attachment `0`.
- `texture_2d<f32>`: a sampled texture resource.
- `sampler`: the sampling rules for that texture.
- `vec4f`: four `f32` values, usually RGBA or CNN channels.
- `textureDimensions(tex)`: returns the width and height of a texture.
- `textureSampleLevel(...)`: samples a texture at UV coordinates.

In the current conversion, helper functions often turn pixel positions into UVs:

```wgsl
let dims = vec2f(textureDimensions(tex));
let uv = base_pos.xy / dims;
return textureSampleLevel(tex, frame_sampler, uv, 0.0);
```

That means `pos.xy` is treated as pixel space, and `uv` is normalized `0.0..1.0`
space.

## Why Fullscreen Render Passes Work

A fragment shader only runs where geometry exists. To run it for every output
pixel, you draw a fullscreen triangle.

The vertex shader can be tiny and shared by every pass:

```wgsl
@vertex
fn v(@builtin(vertex_index) vertex_index: u32) -> @builtin(position) vec4f {
  let x = f32((vertex_index << 1u) & 2u);
  let y = f32(vertex_index & 2u);
  return vec4f(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);
}
```

Then each pass uses:

```ts
pass.draw(3);
```

No vertex buffers are needed. The three generated vertices cover the whole
output texture.

## Mapping Anime4K GLSL Metadata To WebGPU

Anime4K GLSL files use mpv-style metadata comments. Your WGSL files preserve
those comments above each exported fragment shader.

Example:

```text
//!HOOK MAIN
//!BIND HOOKED
//!BIND STATSMAX
//!SAVE STATSMAX
//!WIDTH MAIN.w
//!HEIGHT MAIN.h
//!COMPONENTS 1
```

In mpv, these comments tell mpv how to run the pass. In Senmei, your TypeScript
pipeline must do that job.

### `HOOK`

`HOOK` says which logical image the pass attaches to.

Useful mental model:

- `MAIN`: the current main image at that stage.
- `PREKERNEL`: the image just before an upscaling kernel in mpv's pipeline.
- `HOOKED`: usually the texture being processed by this pass.

In WebGPU, `HOOK` is less magical. It mostly tells us which current texture
should become binding `0` when the shader declares:

```wgsl
@group(0) @binding(0) var frame: texture_2d<f32>;
```

### `BIND`

`BIND` lists extra textures the shader reads.

Example:

```text
//!BIND HOOKED
//!BIND STATSMAX
```

In WGSL, that appears as bindings:

```wgsl
@group(0) @binding(0) var frame: texture_2d<f32>;
@group(0) @binding(1) var frame_sampler: sampler;
@group(0) @binding(2) var stats_max: texture_2d<f32>;
```

The JavaScript side must make sure `STATSMAX` points to the texture saved by an
earlier pass.

### `SAVE`

`SAVE` names the texture produced by this pass.

Example:

```text
//!SAVE conv2d_tf
```

In the pipeline registry, after this pass runs:

```ts
textures.set("conv2d_tf", outputTexture);
```

Later passes can bind `conv2d_tf` as an input.

### `WIDTH` and `HEIGHT`

These define the output texture size for a pass.

Examples:

```text
//!WIDTH MAIN.w
//!HEIGHT MAIN.h
```

or:

```text
//!WIDTH OUTPUT.w
//!HEIGHT OUTPUT.h
```

Your pass builder should compute dimensions before creating the output texture.

### `COMPONENTS`

`COMPONENTS 1` means the shader only cares about one output channel. For the
first implementation, it is okay to store everything in `rgba16float` and use
`.x` for one-channel passes. That is simpler and keeps momentum.

Later, this can be optimized to single-channel formats.

### `WHEN`

`WHEN` controls whether a pass should run.

Example from `Anime4K_AutoDownscalePre_x2.ts`:

```text
OUTPUT.w NATIVE.w / 2.0 < OUTPUT.h NATIVE.h / 2.0 < * OUTPUT.w NATIVE.w / 1.2 > OUTPUT.h NATIVE.h / 1.2 > * *
```

This is reverse Polish notation. Read it as stack math:

- push `OUTPUT.w`
- push `NATIVE.w`
- divide
- push `2.0`
- compare `<`
- etc.

Operators such as `<`, `>`, `/`, and `*` pop values from the stack and push a
result. For boolean logic, `*` acts like AND because true is `1` and false is
`0`.

In TypeScript, a small evaluator can turn this into a boolean using runtime
dimensions:

```ts
type ShaderVars = {
  MAIN: { w: number; h: number };
  NATIVE: { w: number; h: number };
  OUTPUT: { w: number; h: number };
};
```

## Senmei's Current Anime4K Pass Order

Keep this order from `README.md`:

```text
Clamp
  -> Restore_VL
  -> Upscale_x2_VL
  -> AutoDownscalePre_x2
  -> AutoDownscalePre_x4
  -> Upscale_x2_M
```

At a high level:

1. `Clamp` reduces highlight ringing and saves `STATSMAX`.
2. `Restore_VL` runs a CNN restoration network at source size.
3. `Upscale_x2_VL` runs a light x2 CNN upscaler when output is large enough.
4. `AutoDownscalePre_x2` and `AutoDownscalePre_x4` handle mpv-style automatic
   pre-downscale behavior.
5. `Upscale_x2_M` runs another x2 CNN upscaler when still needed.

The CNN passes are many small passes because each shader writes intermediate
feature maps like `conv2d_tf`, `conv2d_1_tf`, and `conv2d_last_tf`.

## Recommended First Implementation Shape

Do not start by trying to abstract everything. Build the smallest render-pass
engine that can run one shader, then grow it.

### 1. Initialize WebGPU

Create a function that returns:

```ts
type GpuState = {
  adapter: GPUAdapter;
  device: GPUDevice;
  context: GPUCanvasContext;
  canvasFormat: GPUTextureFormat;
  sampler: GPUSampler;
};
```

Responsibilities:

- check `navigator.gpu`
- request adapter
- request device
- configure canvas context
- create a shared sampler
- report clear errors if WebGPU is unsupported

### 2. Upload The Source Image

For image PoC:

```ts
device.queue.copyExternalImageToTexture({ source: imageBitmap }, { texture: sourceTexture }, [
  imageBitmap.width,
  imageBitmap.height,
]);
```

For video later, the source can be a `VideoFrame` instead of an `ImageBitmap`.

### 3. Create A Texture Registry

Use a map for named pass outputs:

```ts
const textures = new Map<string, GPUTexture>();
textures.set("MAIN", sourceTexture);
textures.set("NATIVE", sourceTexture);
```

Useful names:

- `MAIN`: current logical main texture
- `NATIVE`: original source-size texture
- `OUTPUT`: desired final output dimensions, not necessarily a texture name
- `STATSMAX`, `conv2d_tf`, etc.: saved pass outputs

### 4. Describe Passes In TypeScript

Eventually, each exported shader should become metadata like:

```ts
type Anime4KPass = {
  name: string;
  shader: string;
  when: string | null;
  binds: string[];
  save: string | null;
  width: DimensionExpr;
  height: DimensionExpr;
};
```

At first, this metadata can be handwritten near the pass list. Later, if useful,
it can be generated from the preserved `//!` comments.

### 5. Create One Render Pipeline Per Shader

Each pass needs:

- shared fullscreen vertex shader
- pass-specific fragment shader
- bind group layout matching that shader's resources
- render target format

Use an intermediate texture format that can hold CNN feature values:

```ts
const intermediateFormat: GPUTextureFormat = "rgba16float";
```

Anime4K CNN intermediate values can be negative, so avoid `rgba8unorm` for
intermediate passes.

### 6. Run One Pass

The basic render-pass loop is:

```ts
const encoder = device.createCommandEncoder();
const renderPass = encoder.beginRenderPass({
  colorAttachments: [
    {
      view: outputTexture.createView(),
      loadOp: "clear",
      storeOp: "store",
      clearValue: { r: 0, g: 0, b: 0, a: 0 },
    },
  ],
});

renderPass.setPipeline(pipeline);
renderPass.setBindGroup(0, bindGroup);
renderPass.draw(3);
renderPass.end();

device.queue.submit([encoder.finish()]);
```

Then save the output:

```ts
textures.set(pass.save ?? "MAIN", outputTexture);
textures.set("MAIN", outputTexture);
```

Whether every `SAVE` should also become current `MAIN` depends on the pass's
Anime4K semantics. For the first hand-built version, be explicit in the pass
metadata.

### 7. Present The Final Texture

The canvas texture changes every frame:

```ts
const canvasTexture = context.getCurrentTexture();
```

Render one final fullscreen pass from the final Anime4K texture into
`canvasTexture.createView()`.

Keep this separate from the Anime4K passes. Presentation is not the same job as
upscaling.

## How Bindings Relate To The Current Shaders

Most current shader files follow this pattern:

```wgsl
@group(0) @binding(0) var frame: texture_2d<f32>;
@group(0) @binding(1) var frame_sampler: sampler;
```

Then extra textures start at binding `2`.

Example from clamp pass 3:

```wgsl
@group(0) @binding(2) var stats_max: texture_2d<f32>;
```

That means the bind group entries should look like:

```ts
[
  { binding: 0, resource: currentFrame.createView() },
  { binding: 1, resource: sampler },
  { binding: 2, resource: statsMax.createView() },
];
```

For larger CNN shaders, the binding list can get long:

```wgsl
@group(0) @binding(2) var conv2d_tf: texture_2d<f32>;
@group(0) @binding(3) var conv2d_tf1: texture_2d<f32>;
```

The order must match exactly.

## Texture Sizes: Source, Output, CSS, And DPR

Keep four ideas separate:

### Source size

The actual decoded frame size, for example `1920x1080`.

This is `NATIVE`.

### Pipeline size

The size of the texture currently being processed. This changes as upscaling and
downscaling passes run.

This is usually `MAIN`.

### Desired output size

The target render size for the upscaled image. For example, if the display wants
4K from 1080p, this may be `3840x2160`.

This is `OUTPUT` in `WHEN` expressions.

### Canvas display size

The CSS size on the page. This is layout, not shader math.

The canvas backing size should be CSS pixels times `devicePixelRatio`.

Do not let CSS size silently become the source size or Anime4K will make wrong
pass decisions.

## Fragment Shader Or Compute Shader?

Anime4K can be implemented either way, but this repo's current ports are
fragment shaders. That is a good starting point.

Fragment render passes are natural when:

- each output pixel computes one color
- the shader samples neighboring pixels
- you want to write to textures
- you already have GLSL fragment shader source

Compute shaders are useful later for:

- custom tiling
- shared memory
- non-image data
- tighter control over workgroups

For now, use render pipelines. It maps closest to the original mpv GLSL
behavior.

## Important Parity Risks

These are the places most likely to cause "it runs but does not match Anime4K."

### Pixel Center Mapping

mpv helpers like `MAIN_texOff(...)` have exact coordinate semantics. The current
WGSL helpers use:

```wgsl
let uv = base_pos.xy * pt + vec2f(x_off, y_off) * pt;
```

If output looks shifted, blurry, or slightly wrong, inspect whether `pos.xy`
needs a `- 0.5` or `+ 0.5` adjustment.

### Sampler Filtering

Nearest vs linear filtering changes results. Start with nearest/clamp for
CNN/intermediate passes unless a pass explicitly expects linear.

### Intermediate Texture Format

CNN layers produce values outside `0.0..1.0`, including negative values.
`rgba8unorm` will clamp and destroy the network.

Use `rgba16float` for intermediate pass outputs first.

### Color Space

Browser image and video upload paths can apply color conversion unless
controlled. This matters for parity and is already called out in `README.md`.

When uploading, prefer explicit options where available and test carefully:

```ts
device.queue.copyExternalImageToTexture({ source, colorSpace: "srgb" }, { texture }, size);
```

Exact handling differs between source types, so treat this as a verification
item.

### `WHEN` Logic

If `WHEN` evaluation is wrong, the pipeline may run too many or too few passes.
That can look like bad shader math even when the shader is fine.

Log pass activation with dimensions:

```text
run Upscale_x2_VL.P1 because OUTPUT.w / MAIN.w = 2.0
skip AutoDownscalePre_x4 because condition = false
```

## Suggested Build Order

Use this as the learning path and implementation path.

### Milestone 1: WebGPU Boot

Goal: clear the canvas using WebGPU.

Learn:

- adapter
- device
- canvas context
- command encoder
- render pass

Done when:

- app reports a friendly WebGPU unsupported error when needed
- canvas clears to a known color through WebGPU

### Milestone 2: Show Source Texture

Goal: upload the selected image and draw it to the canvas.

Learn:

- texture creation
- `copyExternalImageToTexture`
- sampler
- bind group
- fullscreen triangle

Done when:

- selected image appears through WebGPU, not 2D canvas

### Milestone 3: One Anime4K Pass

Goal: run `Anime4K_AutoDownscalePre_x2.fragF` or clamp pass 1.

Learn:

- shader module compilation errors
- render target textures
- sampling from one texture while writing another

Done when:

- one pass writes to an intermediate texture
- final presentation pass displays that intermediate texture

### Milestone 4: Named Texture Registry

Goal: run all three clamp passes.

Learn:

- `SAVE STATSMAX`
- binding a texture produced by an earlier pass
- one-channel output stored in `.x`

Done when:

- `Clamp.P1 -> Clamp.P2 -> Clamp.P3` runs without validation errors

### Milestone 5: Pass Metadata

Goal: make pass definitions data-driven enough to avoid copy-paste mistakes.

Learn:

- pass descriptors
- dimension expressions
- bind group layout generation
- pipeline caching

Done when:

- adding a pass mostly means adding metadata plus shader import

### Milestone 6: `WHEN` Evaluator

Goal: activate/skip passes according to Anime4K conditions.

Learn:

- reverse Polish notation
- runtime dimensions
- pass logging

Done when:

- current pass order matches `README.md`
- skipped passes are visible in debug logs

### Milestone 7: Full Image Pipeline

Goal: run the whole current pass order on a still image.

Learn:

- texture lifetime
- output sizing
- GPU error scopes
- parity screenshots

Done when:

- image input produces a final upscaled canvas output
- process button no longer reports only the placeholder

## Debugging Tools And Habits

Use WebGPU error scopes around shader/pipeline creation:

```ts
device.pushErrorScope("validation");
const pipeline = device.createRenderPipeline({...});
const error = await device.popErrorScope();
if (error) {
  console.error(error.message);
}
```

Add labels to GPU objects:

```ts
const texture = device.createTexture({
  label: "Anime4K Clamp STATSMAX",
  size: [width, height],
  format: "rgba16float",
  usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
});
```

Labels make browser validation messages much easier to understand.

Log each pass:

```text
[Anime4K] run Clamp.P1 -> STATSMAX 1920x1080
[Anime4K] run Clamp.P2 -> STATSMAX 1920x1080
[Anime4K] run Clamp.P3 -> MAIN 1920x1080
```

This is not noise while the pipeline is young. It is a map.

## Common WebGPU Validation Errors

### "Texture usage does not include RENDER_ATTACHMENT"

You are trying to render into a texture that was not created with:

```ts
GPUTextureUsage.RENDER_ATTACHMENT;
```

### "Texture usage does not include TEXTURE_BINDING"

You are trying to sample from a texture that was not created with:

```ts
GPUTextureUsage.TEXTURE_BINDING;
```

Intermediate Anime4K textures usually need both.

### "Binding type mismatch"

Your bind group layout does not match WGSL declarations.

If WGSL says:

```wgsl
@binding(1) var frame_sampler: sampler;
```

then JavaScript binding `1` must be a sampler binding, not a texture binding.

### "Shader output format mismatch"

The render pipeline's target format must match the texture format you render
into.

If the pass writes to `rgba16float`, the pipeline target must also be
`rgba16float`.

If the pass presents to the canvas, the pipeline target must use the canvas
format.

## Practical Architecture For This Repo

A small starting structure could look like:

```text
main.ts
  UI events and high-level flow

webgpu/
  context.ts
    initWebGpu(canvas)

  texture.ts
    createRenderTexture(...)
    uploadImageBitmap(...)

  fullscreen.ts
    shared vertex shader
    final presentation shader

  anime4kPasses.ts
    ordered pass descriptors

  anime4kPipeline.ts
    runAnime4KPipeline(...)
```

Keep it boring at first. The goal is understanding plus a running pipeline, not
a perfect framework.

## A Good First Pass Descriptor

A descriptor for `Anime4K_AutoDownscalePre_x2.fragF` might look like:

```ts
{
  id: "AutoDownscalePre_x2.F",
  shader: fragF,
  when: whenF,
  bindNames: ["MAIN"],
  saveName: "MAIN",
  width: { source: "OUTPUT", axis: "w" },
  height: { source: "OUTPUT", axis: "h" },
}
```

Clamp pass 3 might look like:

```ts
{
  id: "Clamp.P3",
  shader: clamp.fragP3,
  when: clamp.whenP3,
  bindNames: ["MAIN", "STATSMAX"],
  saveName: "MAIN",
  width: { source: "MAIN", axis: "w" },
  height: { source: "MAIN", axis: "h" },
}
```

Notice how `bindNames` maps directly to WGSL bindings:

- first texture -> `@binding(0) var frame`
- sampler -> `@binding(1) var frame_sampler`
- second texture -> `@binding(2)`
- third texture -> `@binding(3)`

## What To Understand Before Touching Video

Before wiring MKV/WebCodecs into the GPU path, make sure the image path teaches
you these ideas:

- how source pixels become a GPU texture
- how a shader samples that texture
- how one pass writes another texture
- how named intermediate textures feed later passes
- how output size affects `WHEN`
- how final presentation differs from processing

Once those are solid, replacing `ImageBitmap` with `VideoFrame` is much less
mysterious. The GPU pipeline does not care whether the source pixels came from
an image or a decoder, as long as you upload them into the expected source
texture.

## Mental Checklist For Every Pass

For each Anime4K pass, ask:

1. Should this pass run for the current `MAIN`, `NATIVE`, and `OUTPUT` sizes?
2. What textures does it read?
3. What sampler behavior does it need?
4. What size is its output?
5. What format should the output texture use?
6. What name should the output be saved under?
7. Does this output become the new current `MAIN`?

If you can answer those seven questions, the WebGPU implementation is mostly
mechanical.
