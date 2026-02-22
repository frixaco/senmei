# WebGPU Learning Resources

Resources to understand every concept used in `index.html` lines 93–208.

---

## 🏁 Start Here (Tutorials — Read in Order)

1. **Google Codelab: Your First WebGPU App**
   Hands-on walkthrough building Game of Life. Covers device, canvas, pipelines, shaders, buffers, bind groups, command encoding — everything in your code.
   https://codelabs.developers.google.com/your-first-webgpu-app

2. **WebGPU Fundamentals**
   The most comprehensive free tutorial site. Chapter-by-chapter with live examples. Start with "Fundamentals", then "Textures", "Uniforms", "Bind Group Layouts".
   - Fundamentals: https://webgpufundamentals.org/webgpu/lessons/webgpu-fundamentals.html
   - Textures (samplers, filtering, `createTexture`, `copyExternalImageToTexture`): https://webgpufundamentals.org/webgpu/lessons/webgpu-textures.html
   - WGSL overview: https://webgpufundamentals.org/webgpu/lessons/webgpu-wgsl.html
   - Bind Group Layouts: https://webgpufundamentals.org/webgpu/lessons/webgpu-bind-group-layouts.html

3. **Raw WebGPU** — Alain Galvan
   Concise single-page walkthrough of the entire WebGPU rendering pipeline with code. Great "big picture" read.
   https://alain.xyz/blog/raw-webgpu

4. **Surma: WebGPU — All of the cores, none of the canvas**
   Best conceptual explainer. Covers _why_ adapters, devices, command encoders, bind groups, and pipelines exist. Written for web devs, not graphics engineers.
   https://surma.dev/things/webgpu/

---

## 📖 Official Specifications

5. **W3C WebGPU Specification** (the source of truth)
   https://www.w3.org/TR/webgpu/

6. **W3C WGSL Specification** (shader language)
   https://www.w3.org/TR/WGSL/

7. **WebGPU Explainer** (W3C community group — readable overview of spec design decisions)
   https://gpuweb.github.io/gpuweb/explainer/

---

## 📚 MDN API Reference (per-object docs for every API call in your code)

8. **WebGPU API overview**: https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API
9. **GPUDevice**: https://developer.mozilla.org/en-US/docs/Web/API/GPUDevice
10. **GPUCanvasContext** (`getContext('webgpu')`, `configure()`): https://developer.mozilla.org/en-US/docs/Web/API/GPUCanvasContext
11. **GPUShaderModule** (`createShaderModule`): https://developer.mozilla.org/en-US/docs/Web/API/GPUShaderModule
12. **GPURenderPipeline** (`createRenderPipeline`): https://developer.mozilla.org/en-US/docs/Web/API/GPURenderPipeline
13. **GPUDevice.createRenderPipeline()**: https://developer.mozilla.org/en-US/docs/Web/API/GPUDevice/createRenderPipeline
14. **GPUSampler** (`createSampler`, filter modes, address modes): https://developer.mozilla.org/en-US/docs/Web/API/GPUSampler
15. **GPUTexture** (`createTexture`, usage flags): https://developer.mozilla.org/en-US/docs/Web/API/GPUTexture
16. **GPUBuffer** (`createBuffer`, uniform/copy usage): https://developer.mozilla.org/en-US/docs/Web/API/GPUBuffer
17. **GPUBindGroup** (`createBindGroup`, binding resources to shaders): https://developer.mozilla.org/en-US/docs/Web/API/GPUBindGroup
18. **GPUCommandEncoder** (`createCommandEncoder`, `beginRenderPass`, `finish`): https://developer.mozilla.org/en-US/docs/Web/API/GPUCommandEncoder
19. **GPURenderPassEncoder** (`setPipeline`, `setBindGroup`, `draw`, `end`): https://developer.mozilla.org/en-US/docs/Web/API/GPURenderPassEncoder
20. **GPUQueue** (`submit`, `writeBuffer`, `copyExternalImageToTexture`): https://developer.mozilla.org/en-US/docs/Web/API/GPUQueue

---

## 🧪 Samples & Interactive Learning

21. **Official WebGPU Samples** — textured cube, shadow mapping, compute, etc. Read the source.
    https://webgpu.github.io/webgpu-samples/

22. **Tour of WGSL** — Interactive browser-based WGSL playground by Google
    https://google.github.io/tour-of-wgsl/

---

## 🏆 Best Practices & Deep Dives

23. **WebGPU Best Practices** — Toji (Brandon Jones, Chrome WebGPU team)
    Covers bind groups, textures/images, buffer uploads, error handling, device loss. Read after tutorials.
    - Index: https://toji.dev/webgpu-best-practices/
    - Bind Groups: https://toji.dev/webgpu-best-practices/bind-groups.html
    - Textures from images: https://toji.dev/webgpu-best-practices/img-textures.html
    - Buffer uploads: https://toji.dev/webgpu-best-practices/buffer-uploads.html
    - Error handling: https://toji.dev/webgpu-best-practices/error-handling.html

24. **Chrome Developers: Overview of WebGPU**
    https://developer.chrome.com/docs/web-platform/webgpu/overview

25. **Chrome Developers: Build an app with WebGPU**
    https://developer.chrome.com/docs/web-platform/webgpu/build-app

---

## 🧱 Concept-Specific Resources

### Why command encoders & render passes?

Your code creates a `GPUCommandEncoder`, starts a render pass, records draw commands, then submits.
GPU commands are _recorded_ then _submitted_ in batches for efficiency — the GPU never executes commands one-by-one.

- Surma's explainer (Commands section): https://surma.dev/things/webgpu/#commands
- Google Codelab "Clear the Canvas" section: https://codelabs.developers.google.com/your-first-webgpu-app#4

### Why `layout: 'auto'` in `createRenderPipeline`?

Tells WebGPU to infer bind group layouts from shader `@group`/`@binding` declarations. Simpler for single-pipeline apps.

- WebGPU Fundamentals — Bind Group Layouts: https://webgpufundamentals.org/webgpu/lessons/webgpu-bind-group-layouts.html
- Toji best practices — Bind Groups: https://toji.dev/webgpu-best-practices/bind-groups.html

### Why samplers with `nearest` filter + `clamp-to-edge`?

Samplers control how the GPU reads texels. `nearest` = no interpolation (pixel-perfect). `clamp-to-edge` = don't wrap/repeat. Important for image processing shaders that need exact pixel values.

- WebGPU Fundamentals — Textures: https://webgpufundamentals.org/webgpu/lessons/webgpu-textures.html
- MDN GPUSampler: https://developer.mozilla.org/en-US/docs/Web/API/GPUSampler

### Why `draw(3, 1, 0, 0)` — a fullscreen triangle?

Drawing 3 vertices = one triangle that covers the entire screen. The vertex shader generates clip-space positions procedurally (no vertex buffer needed). More efficient than a quad (2 triangles, 6 vertices).

- WebGPU Fundamentals — Large Clip Space Triangle technique: https://webgpufundamentals.org/webgpu/lessons/webgpu-large-triangle-to-cover-clip-space.html

### Why uniform buffers with `ArrayBuffer` + typed array views?

GPU uniform data needs specific memory layout. Using `Float32Array` and `Uint32Array` views over the same `ArrayBuffer` lets you pack mixed types (floats + uints) at exact byte offsets matching the shader struct.

- WebGPU Fundamentals — Uniforms: https://webgpufundamentals.org/webgpu/lessons/webgpu-uniforms.html
- WGSL data layout: https://webgpufundamentals.org/webgpu/lessons/webgpu-memory-layout.html

---

## 📝 Blog Posts & Architecture

26. **The Structure of a WebGPU Renderer** — Ryosuke
    Walks through building a renderer from scratch: vertices, geometry, uniforms, materials, pipelines.
    https://whoisryosuke.com/blog/2025/structure-of-a-webgpu-renderer

27. **Field Guide to TSL and WebGPU** — Maxime Heckel
    Practical guide covering textures, samplers, compute shaders, post-processing with WebGPU.
    https://blog.maximeheckel.com/posts/field-guide-to-tsl-and-webgpu/

---

## 🔗 Curated Lists

28. **awesome-webgpu** — Community-maintained list of WebGPU resources
    https://github.com/mikbry/awesome-webgpu
