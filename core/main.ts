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
const saveBtn = getElementById<HTMLButtonElement>('saveBtn')

interface SavedOutput {
  device: GPUDevice
  texture: GPUTexture
  sampler: GPUSampler
  width: number
  height: number
  sourceName: string
}

function toFixed(value: number, digits = 2): string {
  if (!Number.isFinite(value)) {
    return 'inf'
  }
  return value.toFixed(digits)
}

let selectedFile: File | null = null
let hasOutput = false
let savedOutput: SavedOutput | null = null

function sourceNameFromFile(file: File | null): string {
  return file?.name.replace(/\.[^/.]+$/, '') ?? 'image'
}

async function exportSavedOutputToBlob(output: SavedOutput): Promise<Blob> {
  const { device, texture, sampler, width, height } = output

  const exportTexture = device.createTexture({
    label: 'export texture rgba8',
    format: 'rgba8unorm',
    size: [width, height],
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  })

  const bindGroupLayout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: 'unfilterable-float' },
      },
      {
        binding: 1,
        visibility: GPUShaderStage.FRAGMENT,
        sampler: { type: 'non-filtering' },
      },
    ],
  })
  const pipelineLayout = device.createPipelineLayout({
    bindGroupLayouts: [bindGroupLayout],
  })
  const pipeline = device.createRenderPipeline({
    label: 'export texture pipeline',
    layout: pipelineLayout,
    vertex: {
      module: device.createShaderModule({
        label: 'export vertex shader',
        code: presentVertexShader,
      }),
      entryPoint: 'v',
    },
    fragment: {
      module: device.createShaderModule({
        label: 'export fragment shader',
        code: presentFragmentShader,
      }),
      entryPoint: 'f',
      targets: [{ format: 'rgba8unorm' }],
    },
  })
  const bindGroup = device.createBindGroup({
    label: 'export bind group',
    layout: bindGroupLayout,
    entries: [
      { binding: 0, resource: texture.createView() },
      { binding: 1, resource: sampler },
    ],
  })

  const bytesPerPixel = 4
  const unpaddedBytesPerRow = width * bytesPerPixel
  const paddedBytesPerRow = Math.ceil(unpaddedBytesPerRow / 256) * 256
  const readbackSize = paddedBytesPerRow * height

  const readbackBuffer = device.createBuffer({
    label: 'export readback buffer',
    size: readbackSize,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  })

  const encoder = device.createCommandEncoder({ label: 'export encoder' })

  const pass = encoder.beginRenderPass({
    colorAttachments: [
      {
        view: exportTexture.createView(),
        loadOp: 'clear',
        storeOp: 'store',
      },
    ],
  })
  pass.setPipeline(pipeline)
  pass.setBindGroup(0, bindGroup)
  pass.draw(3)
  pass.end()

  encoder.copyTextureToBuffer(
    { texture: exportTexture },
    {
      buffer: readbackBuffer,
      bytesPerRow: paddedBytesPerRow,
      rowsPerImage: height,
    },
    { width, height, depthOrArrayLayers: 1 },
  )

  device.queue.submit([encoder.finish()])
  await device.queue.onSubmittedWorkDone()

  await readbackBuffer.mapAsync(GPUMapMode.READ)
  const mapped = new Uint8Array(readbackBuffer.getMappedRange())
  const packed = new Uint8ClampedArray(unpaddedBytesPerRow * height)

  for (let y = 0; y < height; y += 1) {
    const srcOffset = y * paddedBytesPerRow
    const dstOffset = y * unpaddedBytesPerRow
    packed.set(
      mapped.subarray(srcOffset, srcOffset + unpaddedBytesPerRow),
      dstOffset,
    )
  }

  readbackBuffer.unmap()
  readbackBuffer.destroy()
  exportTexture.destroy()

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('Failed to create export canvas context')
  }
  const imageData = new ImageData(packed, width, height)
  context.putImageData(imageData, 0, 0)

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/png')
  })
  if (!blob) {
    throw new Error('Failed to encode PNG')
  }

  return blob
}

on('inputImg', 'change', (event) => {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) {
    return
  }

  const file = target.files?.[0] ?? null
  if (!file) {
    selectedFile = null
    hasOutput = false
    savedOutput = null
    saveBtn.disabled = true
    original.removeAttribute('src')
    qualityMeta.textContent = 'No run yet.'
    return
  }

  selectedFile = file
  hasOutput = false
  savedOutput = null
  saveBtn.disabled = true
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

on('saveBtn', 'click', async () => {
  const canvas = getElementById<HTMLCanvasElement>('canvas')
  if (!hasOutput || !savedOutput || canvas.width === 0 || canvas.height === 0) {
    qualityMeta.textContent = 'Run Process before saving output.'
    return
  }
  qualityMeta.textContent = 'Saving PNG...'

  try {
    const blob = await exportSavedOutputToBlob(savedOutput)
    const fileName = `${savedOutput.sourceName}-upscaled-${savedOutput.width}x${savedOutput.height}.png`
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = fileName
    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)
    URL.revokeObjectURL(url)
    qualityMeta.textContent = `Saved ${fileName}`
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    qualityMeta.textContent = `Save failed: ${message}`
  }
})

on('processBtn', 'click', async () => {
  if (!selectedFile) {
    console.error('Pick an image first.')
    return
  }

  qualityMeta.textContent = 'Running pipeline...'
  hasOutput = false
  savedOutput = null
  saveBtn.disabled = true

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
        texture: { sampleType: 'unfilterable-float' },
      },
      {
        binding: 1,
        visibility: GPUShaderStage.FRAGMENT,
        sampler: { type: 'non-filtering' },
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
  hasOutput = true
  savedOutput = {
    device,
    texture: finalStage.outputTexture,
    sampler: frameSampler,
    width: canvas.width,
    height: canvas.height,
    sourceName: sourceNameFromFile(selectedFile),
  }
  saveBtn.disabled = false
  qualityMeta.textContent =
    `Upscale complete: ${bitmap.width}x${bitmap.height} -> ` +
    `${canvas.width}x${canvas.height} in ${toFixed(runtimeMs, 1)} ms.`
})
