import { setupStage1 } from './pipeline/1.ts'
import { setupStage2 } from './pipeline/2.ts'
import { setupStage3 } from './pipeline/3.ts'
import { setupStage4 } from './pipeline/4.ts'
import { setupStage5 } from './pipeline/5.ts'
import { setupStage6 } from './pipeline/6.ts'

const presentVertexShader = /* wgsl */ `
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
`

const presentFragmentShader = /* wgsl */ `
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var srcSampler: sampler;

@fragment
fn f(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let dims = vec2f(textureDimensions(src));
  let uv = pos.xy / dims;
  let color = textureSampleLevel(src, srcSampler, uv, 0.0);
  return vec4f(color.rgb, 1.0);
}
`

function getElementById<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id)
  if (!element) {
    throw new Error(`Missing required element: #${id}`)
  }

  return element as T
}

function on(
  id: string,
  eventName: string,
  handler: (event: Event) => void,
): void {
  getElementById<HTMLElement>(id).addEventListener(eventName, handler)
}

const original = getElementById<HTMLImageElement>('original')
const qualityMeta = getElementById<HTMLElement>('qualityMeta')

function toFixed(value: number, digits = 2): string {
  if (!Number.isFinite(value)) {
    return 'inf'
  }
  return value.toFixed(digits)
}

let selectedFile: File | null = null

on('inputImg', 'change', (event) => {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) {
    return
  }

  const file = target.files?.[0] ?? null
  if (!file) {
    selectedFile = null
    original.removeAttribute('src')
    qualityMeta.textContent = 'No run yet.'
    return
  }

  selectedFile = file
  const reader = new FileReader()

  reader.onload = (loadEvent) => {
    const result = loadEvent.target?.result
    if (typeof result !== 'string') {
      return
    }

    original.setAttribute('src', result)
  }

  reader.readAsDataURL(file)
})

on('processBtn', 'click', async () => {
  if (!selectedFile) {
    console.error('Pick an image first.')
    return
  }

  qualityMeta.textContent = 'Running pipeline...'

  if (!('gpu' in navigator)) {
    console.error('WebGPU not supported in this browser.')
    return
  }

  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: 'high-performance',
  })
  if (!adapter) {
    console.error('No GPU adapter found.')
    return
  }

  const device = await adapter.requestDevice()
  const format = navigator.gpu.getPreferredCanvasFormat()

  const bitmap = await createImageBitmap(selectedFile, {
    colorSpaceConversion: 'none',
  })

  const initialTexture = device.createTexture({
    label: 'initial frame texture',
    format: 'rgba8unorm',
    size: [bitmap.width, bitmap.height],
    usage:
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.RENDER_ATTACHMENT,
  })
  device.queue.copyExternalImageToTexture(
    { source: bitmap, flipY: false },
    { texture: initialTexture },
    { width: bitmap.width, height: bitmap.height },
  )

  const frameSampler = device.createSampler({
    magFilter: 'nearest',
    minFilter: 'nearest',
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
  })

  const whenReference = {
    native: { w: bitmap.width, h: bitmap.height },
    output: { w: bitmap.width * 2, h: bitmap.height * 2 },
  }

  const stage1 = setupStage1(device, initialTexture, frameSampler)
  const stage2 = setupStage2(device, stage1.outputTexture, frameSampler)
  const stage3 = setupStage3(
    device,
    stage2.outputTexture,
    frameSampler,
    whenReference,
  )
  const stage4 = setupStage4(
    device,
    stage3.outputTexture,
    frameSampler,
    whenReference,
  )
  const stage5 = setupStage5(
    device,
    stage4.outputTexture,
    frameSampler,
    whenReference,
  )
  const stage6 = setupStage6(
    device,
    stage5.outputTexture,
    frameSampler,
    whenReference,
  )
  const finalStage = stage6

  const canvas = getElementById<HTMLCanvasElement>('canvas')
  canvas.width = finalStage.outputTexture.width
  canvas.height = finalStage.outputTexture.height
  canvas.style.width = `${bitmap.width}px`
  canvas.style.height = `${bitmap.height}px`

  console.log('Upscale dimensions', {
    input: `${bitmap.width}x${bitmap.height}`,
    output: `${canvas.width}x${canvas.height}`,
  })

  const context = canvas.getContext('webgpu')
  if (!context) {
    console.error('Unable to acquire webgpu context.')
    return
  }
  context.configure({ device, format })

  const pipelineStart = performance.now()
  const encoder = device.createCommandEncoder({ label: 'pipeline encoder' })
  stage1.encode(encoder)
  stage2.encode(encoder)
  stage3.encode(encoder)
  stage4.encode(encoder)
  stage5.encode(encoder)
  finalStage.encode(encoder)

  const presentBindGroupLayout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: 'float' },
      },
      {
        binding: 1,
        visibility: GPUShaderStage.FRAGMENT,
        sampler: { type: 'filtering' },
      },
    ],
  })
  const presentPipelineLayout = device.createPipelineLayout({
    bindGroupLayouts: [presentBindGroupLayout],
  })
  const presentPipeline = device.createRenderPipeline({
    label: 'present final texture',
    layout: presentPipelineLayout,
    vertex: {
      module: device.createShaderModule({
        label: 'present vertex shader',
        code: presentVertexShader,
      }),
      entryPoint: 'v',
    },
    fragment: {
      module: device.createShaderModule({
        label: 'present fragment shader',
        code: presentFragmentShader,
      }),
      entryPoint: 'f',
      targets: [{ format }],
    },
  })
  const presentBindGroup = device.createBindGroup({
    label: 'present bind group',
    layout: presentBindGroupLayout,
    entries: [
      {
        binding: 0,
        resource: finalStage.outputTexture.createView(),
      },
      {
        binding: 1,
        resource: frameSampler,
      },
    ],
  })

  const presentPass = encoder.beginRenderPass({
    colorAttachments: [
      {
        view: context.getCurrentTexture().createView(),
        loadOp: 'clear',
        storeOp: 'store',
      },
    ],
  })
  presentPass.setPipeline(presentPipeline)
  presentPass.setBindGroup(0, presentBindGroup)
  presentPass.draw(3)
  presentPass.end()

  device.queue.submit([encoder.finish()])
  await device.queue.onSubmittedWorkDone()
  const runtimeMs = performance.now() - pipelineStart
  qualityMeta.textContent =
    `Upscale complete: ${bitmap.width}x${bitmap.height} -> ` +
    `${canvas.width}x${canvas.height} in ${toFixed(runtimeMs, 1)} ms.`
})
