To keep things simple and avoid over-engineering, you should use a **Factory Pattern** for your pipeline stages. 

Instead of dumping all WebGPU creation code into `main.ts`, each file in `pipeline/` will export a single `setupStage` function. This function will take the **Input Texture** from the previous step, set up its own shaders/bind groups, and return two things:
1. Its **Output Texture** (which becomes the input for the next stage).
2. An **encode()** function to actually record the drawing commands.

Here is the concrete approach to organize your code.

### 1. Create a `pipeline/shared.ts`
First, extract the common stuff (like the vertex shader and types) so you don't repeat them 6 times.

```typescript
// pipeline/shared.ts

export interface PipelineStage {
  outputTexture: GPUTexture;
  // targetView is optional. If provided, the stage renders its final pass 
  // directly into this view (e.g., the Canvas). Otherwise, it renders to outputTexture.
  encode: (encoder: GPUCommandEncoder, targetView?: GPUTextureView) => void;
}

export const vertexShader = /* wgsl */`
struct VSOut {
  @builtin(position) pos: vec4f,
}

@vertex
fn v(@builtin(vertex_index) vertexIndex: u32) -> VSOut {
  let pos = array(
    vec2f(-1, 1),
    vec2f(4, 1),
    vec2f(-1, -4),
  );
  var out: VSOut;
  out.pos = vec4f(pos[vertexIndex], 0, 1);
  return out;
}
`;

export function createTexture(device: GPUDevice, width: number, height: number): GPUTexture {
  return device.createTexture({
    format: 'rgba8unorm',
    size: [width, height],
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
  });
}
```

### 2. Wrap your first shader in `pipeline/1.ts`
Move the massive initialization logic out of `main.ts` and wrap it in a factory function. 

```typescript
// pipeline/1.ts
import { PipelineStage, createTexture, vertexShader } from './shared.ts';
import { fragF, fragP1, fragP2, fragP3, fragP4, fragP5, fragP6, fragP7, frag8 } from '../shaders/Anime4K_Upscale_CNN_x2_M.ts';

export function setupStage1(
  device: GPUDevice, 
  inputTexture: GPUTexture, 
  sampler: GPUSampler, 
  targetFormat: GPUTextureFormat = 'rgba8unorm' // Allows writing directly to canvas format if this is the last step
): PipelineStage {
  const w = inputTexture.width;
  const h = inputTexture.height;

  // 1. Create intermediate textures
  const conv2d_tf = createTexture(device, w, h);
  const conv2d_tf_1 = createTexture(device, w, h);
  const conv2d_tf_2 = createTexture(device, w, h);
  const conv2d_tf_3 = createTexture(device, w, h);
  const conv2d_tf_4 = createTexture(device, w, h);
  const conv2d_tf_5 = createTexture(device, w, h);
  const conv2d_tf_6 = createTexture(device, w, h);
  const conv2d_tf_last = createTexture(device, w, h);
  
  // This specific pass scales 2x!
  const outputTexture = createTexture(device, w * 2, h * 2);

  // 2. Setup Modules & Pipelines (Copy pasted from your current main.ts)
  const moduleV = device.createShaderModule({ code: vertexShader });
  // ... create all fragment modules (fragP1 through fragF)
  // ... create bindGroupLayouts
  // ... create pipelines (NOTE: For the very last pipeline `f_finish`, use `format: targetFormat` instead of hardcoding)

  // 3. Create Bind Groups
  // IMPORTANT: For bindGroupPass1, use inputTexture.createView() instead of the old frame.createView()
  /*
  const bindGroupPass1 = device.createBindGroup({
    layout: bindGroupLayouts[0]!,
    entries:[
      { binding: 0, resource: inputTexture.createView() },
      { binding: 1, resource: sampler },
    ]
  });
  */
  // ... create the rest of the bind groups

  return {
    outputTexture,
    encode(encoder: GPUCommandEncoder, targetView?: GPUTextureView) {
      // Pass 1 to 8 
      // ... pass.beginRenderPass(...) pass.draw(3) pass.end() ...

      // Pass 9 (Final pass of this stage)
      // If targetView is provided (e.g. the canvas), render to it. Otherwise render to our outputTexture to pass to Stage 2.
      const finalPass = encoder.beginRenderPass({
        colorAttachments:[{
          view: targetView ?? outputTexture.createView(),
          loadOp: 'clear',
          storeOp: 'store',
        }],
      });
      finalPass.setPipeline(pipelines.f_finish); // Use your actual pipeline reference
      finalPass.setBindGroup(0, bindGroupPass9); // Use your actual bind group reference
      finalPass.draw(3);
      finalPass.end();
    }
  };
}
```

### 3. Connect everything cleanly in `main.ts`
Now `main.ts` only cares about loading the image, calling the 6 setup functions in a chain, and executing the encoder.

```typescript
// main.ts
import { setupStage1 } from './pipeline/1.ts';
import { setupStage2 } from './pipeline/2.ts';
// import { setupStage3 } from './pipeline/3.ts'; ...

// ... (HTML element lookups & file reading logic remain the same) ...

on('processBtn', 'click', async () => {
  if (!selectedFile || !navigator.gpu) return;

  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  const device = await adapter!.requestDevice();
  const format = navigator.gpu.getPreferredCanvasFormat();

  // 1. Prepare initial image texture
  const bitmap = await createImageBitmap(selectedFile, { colorSpaceConversion: 'none' });
  const initialTexture = device.createTexture({
    format: 'rgba8unorm',
    size: [bitmap.width, bitmap.height],
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
  });
  device.queue.copyExternalImageToTexture({ source: bitmap }, { texture: initialTexture }, { width: bitmap.width, height: bitmap.height });

  // Share a single sampler across all stages
  const frameSampler = device.createSampler({
    magFilter: 'nearest',
    minFilter: 'nearest',
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
  });

  // 2. Wire up the pipeline sequentially!
  // Output of stage 1 becomes input of stage 2, and so on.
  const stage1 = setupStage1(device, initialTexture, frameSampler);
  
  // NOTE: Pass the targetFormat ONLY to the final stage in the chain
  const stage2 = setupStage2(device, stage1.outputTexture, frameSampler, format); 
  
  // const stage3 = setupStage3(device, stage2.outputTexture, frameSampler);
  // const stage4 = setupStage4(device, stage3.outputTexture, frameSampler);
  // const stage5 = setupStage5(device, stage4.outputTexture, frameSampler);
  // const stage6 = setupStage6(device, stage5.outputTexture, frameSampler, format); // Pass format here when 6 stages exist

  // 3. Configure canvas to match the size of the FINAL stage's output
  const finalStage = stage2; // Change to stage6 eventually
  const canvas = getElementById<HTMLCanvasElement>('canvas');
  canvas.width = finalStage.outputTexture.width;
  canvas.height = finalStage.outputTexture.height;
  canvas.style.width = `${bitmap.width}px`;
  canvas.style.height = `${bitmap.height}px`;

  const context = canvas.getContext('webgpu')!;
  context.configure({ device, format });

  // 4. Encode and Execute!
  const encoder = device.createCommandEncoder();
  
  stage1.encode(encoder);
  
  // For the absolute final stage, pass the Canvas Context View so it renders to the screen
  finalStage.encode(encoder, context.getCurrentTexture().createView());

  device.queue.submit([encoder.finish()]);
});
```

### Why this is the best approach for you:
1. **Low Boilerplate**: You don't need a complex Node-based graph orchestrator.
2. **Encapsulation**: `main.ts` shrinks from 400 lines to ~50 lines. Every shader configuration lives in its own `.ts` file without leaking variables to the global scope.
3. **Flexible Resizing**: Because WebGPU requires exact dimensions, dynamically passing the output texture of Stage 1 to the input of Stage 2 safely propagates the `w*2`, `h*2` resizing implicitly.
4. **Reusable Canvas Rendering**: The `targetView` parameter perfectly solves the WebGPU quirk where intermediate textures are `rgba8unorm` but the final canvas view might be `bgra8unorm`.