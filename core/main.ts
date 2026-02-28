import { setupStage1 } from './pipeline/1.ts'
import { setupStage2 } from './pipeline/2.ts'
import { setupStage3 } from './pipeline/3.ts'
import { setupStage4 } from './pipeline/4.ts'
import { setupStage5 } from './pipeline/5.ts'
import { setupStage6 } from './pipeline/6.ts'
import { convertRgba16FloatBitsToUint16, encodeRgba16Png } from './png16.ts'
import type { PipelineStage } from './pipeline/shared.ts'

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
const processBtn = getElementById<HTMLButtonElement>('processBtn')
const benchmarkBtn = getElementById<HTMLButtonElement>('benchmarkBtn')
const saveBtn = getElementById<HTMLButtonElement>('saveBtn')

const BENCHMARK_WARMUP_FRAMES = 40
const BENCHMARK_SAMPLE_FRAMES = 180
const FPS_24_FRAME_BUDGET_MS = 1000 / 24
const FPS_60_FRAME_BUDGET_MS = 1000 / 60

interface SavedOutput {
  device: GPUDevice
  texture: GPUTexture
  sampler: GPUSampler
  width: number
  height: number
  sourceName: string
}

interface UpscaleRuntime {
  inputWidth: number
  inputHeight: number
  device: GPUDevice
  inputTexture: GPUTexture
  inputBitmap: ImageBitmap
  stageChain: PipelineStage[]
  finalTexture: GPUTexture
  frameSampler: GPUSampler
  context: GPUCanvasContext
  presentPipeline: GPURenderPipeline
  presentBindGroup: GPUBindGroup
}

interface BenchmarkSummary {
  avgMs: number
  p50Ms: number
  p95Ms: number
  p99Ms: number
}

interface ThroughputSummary {
  avgMs: number
  fps: number
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

function setButtonsIdleState(): void {
  processBtn.disabled = false
  benchmarkBtn.disabled = selectedFile === null
  saveBtn.disabled = !hasOutput
}

function ensureWebGpuAvailable(): void {
  if (!('gpu' in navigator)) {
    throw new Error('WebGPU not supported in this browser.')
  }
}

function encodeUpscalePasses(
  encoder: GPUCommandEncoder,
  stageChain: PipelineStage[],
): void {
  for (const stage of stageChain) {
    stage.encode(encoder)
  }
}

function encodePresentPass(
  encoder: GPUCommandEncoder,
  runtime: UpscaleRuntime,
): void {
  const presentPass = encoder.beginRenderPass({
    colorAttachments: [
      {
        view: runtime.context.getCurrentTexture().createView(),
        loadOp: 'clear',
        storeOp: 'store',
      },
    ],
  })
  presentPass.setPipeline(runtime.presentPipeline)
  presentPass.setBindGroup(0, runtime.presentBindGroup)
  presentPass.draw(3)
  presentPass.end()
}

function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) {
    return Number.NaN
  }

  const index = (sortedValues.length - 1) * p
  const lo = Math.floor(index)
  const hi = Math.ceil(index)
  if (lo === hi) {
    return sortedValues[lo]!
  }

  const weight = index - lo
  return sortedValues[lo]! * (1 - weight) + sortedValues[hi]! * weight
}

function summarizeBenchmarkSamples(samples: number[]): BenchmarkSummary {
  if (samples.length === 0) {
    throw new Error('No benchmark samples were recorded.')
  }

  const sorted = [...samples].sort((a, b) => a - b)
  const avgMs = samples.reduce((sum, value) => sum + value, 0) / samples.length
  return {
    avgMs,
    p50Ms: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    p99Ms: percentile(sorted, 0.99),
  }
}

function formatBenchmarkSummary(label: string, summary: BenchmarkSummary): string {
  const avgFps = summary.avgMs > 0 ? 1000 / summary.avgMs : Number.POSITIVE_INFINITY
  return (
    `${label}: avg ${toFixed(summary.avgMs, 2)} ms (${toFixed(avgFps, 1)} fps), ` +
    `p50 ${toFixed(summary.p50Ms, 2)} ms, ` +
    `p95 ${toFixed(summary.p95Ms, 2)} ms, ` +
    `p99 ${toFixed(summary.p99Ms, 2)} ms`
  )
}

function formatThroughputSummary(label: string, summary: ThroughputSummary): string {
  return (
    `${label}: avg ${toFixed(summary.avgMs, 2)} ms ` +
    `(${toFixed(summary.fps, 1)} fps sustained)`
  )
}

function benchmarkBudgetVerdict(label: string, avgMs: number): string {
  const fps24Verdict = avgMs <= FPS_24_FRAME_BUDGET_MS ? 'PASS' : 'FAIL'
  const fps60Verdict = avgMs <= FPS_60_FRAME_BUDGET_MS ? 'PASS' : 'FAIL'
  return `${label}: 24fps ${fps24Verdict}, 60fps ${fps60Verdict}`
}

function uploadRuntimeInputFrame(runtime: UpscaleRuntime): void {
  runtime.device.queue.copyExternalImageToTexture(
    { source: runtime.inputBitmap, flipY: false },
    { texture: runtime.inputTexture },
    { width: runtime.inputWidth, height: runtime.inputHeight },
  )
}

async function createUpscaleRuntime(file: File): Promise<UpscaleRuntime> {
  ensureWebGpuAvailable()

  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: 'high-performance',
  })
  if (!adapter) {
    throw new Error('No GPU adapter found.')
  }

  const device = await adapter.requestDevice()
  const format = navigator.gpu.getPreferredCanvasFormat()
  const bitmap = await createImageBitmap(file, {
    colorSpaceConversion: 'none',
  })
  const inputWidth = bitmap.width
  const inputHeight = bitmap.height

  const inputTexture = device.createTexture({
    label: 'initial frame texture',
    format: 'rgba8unorm',
    size: [inputWidth, inputHeight],
    usage:
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.RENDER_ATTACHMENT,
  })
  device.queue.copyExternalImageToTexture(
    { source: bitmap, flipY: false },
    { texture: inputTexture },
    { width: inputWidth, height: inputHeight },
  )

  const frameSampler = device.createSampler({
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
  })

  const whenReference = {
    native: { w: inputWidth, h: inputHeight },
    output: { w: inputWidth * 2, h: inputHeight * 2 },
  }

  const stage1 = setupStage1(device, inputTexture, frameSampler)
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
  const stageChain = [stage1, stage2, stage3, stage4, stage5, stage6]
  const finalTexture = stage6.outputTexture

  const canvas = getElementById<HTMLCanvasElement>('canvas')
  canvas.width = finalTexture.width
  canvas.height = finalTexture.height
  canvas.style.width = `${inputWidth}px`
  canvas.style.height = `${inputHeight}px`

  const context = canvas.getContext('webgpu')
  if (!context) {
    throw new Error('Unable to acquire webgpu context.')
  }
  context.configure({ device, format })

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
        resource: finalTexture.createView(),
      },
      {
        binding: 1,
        resource: frameSampler,
      },
    ],
  })

  return {
    inputWidth,
    inputHeight,
    device,
    inputTexture,
    inputBitmap: bitmap,
    stageChain,
    finalTexture,
    frameSampler,
    context,
    presentPipeline,
    presentBindGroup,
  }
}

async function benchmarkRuntime(
  runtime: UpscaleRuntime,
  includePresentPass: boolean,
  includeFrameUpload: boolean,
  warmupFrames: number,
  sampleFrames: number,
): Promise<number[]> {
  const samples: number[] = []
  const totalFrames = warmupFrames + sampleFrames

  for (let frame = 0; frame < totalFrames; frame += 1) {
    const start = performance.now()
    if (includeFrameUpload) {
      uploadRuntimeInputFrame(runtime)
    }
    const encoder = runtime.device.createCommandEncoder({
      label: includePresentPass ? 'benchmark end-to-end frame' : 'benchmark core frame',
    })
    encodeUpscalePasses(encoder, runtime.stageChain)
    if (includePresentPass) {
      encodePresentPass(encoder, runtime)
    }
    runtime.device.queue.submit([encoder.finish()])
    await runtime.device.queue.onSubmittedWorkDone()
    const elapsed = performance.now() - start
    if (frame >= warmupFrames) {
      samples.push(elapsed)
    }
  }

  return samples
}

async function benchmarkRuntimeThroughput(
  runtime: UpscaleRuntime,
  includePresentPass: boolean,
  includeFrameUpload: boolean,
  warmupFrames: number,
  sampleFrames: number,
): Promise<ThroughputSummary> {
  if (sampleFrames <= 0) {
    throw new Error('Sample frame count must be greater than 0.')
  }

  for (let frame = 0; frame < warmupFrames; frame += 1) {
    if (includeFrameUpload) {
      uploadRuntimeInputFrame(runtime)
    }
    const encoder = runtime.device.createCommandEncoder({
      label: includePresentPass
        ? 'benchmark throughput warmup end-to-end frame'
        : 'benchmark throughput warmup core frame',
    })
    encodeUpscalePasses(encoder, runtime.stageChain)
    if (includePresentPass) {
      encodePresentPass(encoder, runtime)
    }
    runtime.device.queue.submit([encoder.finish()])
  }
  await runtime.device.queue.onSubmittedWorkDone()

  const start = performance.now()
  for (let frame = 0; frame < sampleFrames; frame += 1) {
    if (includeFrameUpload) {
      uploadRuntimeInputFrame(runtime)
    }
    const encoder = runtime.device.createCommandEncoder({
      label: includePresentPass
        ? 'benchmark throughput end-to-end frame'
        : 'benchmark throughput core frame',
    })
    encodeUpscalePasses(encoder, runtime.stageChain)
    if (includePresentPass) {
      encodePresentPass(encoder, runtime)
    }
    runtime.device.queue.submit([encoder.finish()])
  }
  await runtime.device.queue.onSubmittedWorkDone()
  const elapsed = performance.now() - start
  const avgMs = elapsed / sampleFrames
  const fps = (sampleFrames * 1000) / elapsed
  return { avgMs, fps }
}

async function exportSavedOutputToBlob(output: SavedOutput): Promise<Blob> {
  const { device, texture, sampler, width, height } = output

  const exportTexture = device.createTexture({
    label: 'export texture rgba16float',
    format: 'rgba16float',
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
      targets: [{ format: 'rgba16float' }],
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

  const bytesPerPixel = 8
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
  const mapped = new Uint16Array(readbackBuffer.getMappedRange())
  const paddedWordsPerRow = paddedBytesPerRow / 2
  const unpaddedWordsPerRow = unpaddedBytesPerRow / 2
  const packedHalfFloat = new Uint16Array(unpaddedWordsPerRow * height)

  for (let y = 0; y < height; y += 1) {
    const srcOffset = y * paddedWordsPerRow
    const dstOffset = y * unpaddedWordsPerRow
    packedHalfFloat.set(
      mapped.subarray(srcOffset, srcOffset + unpaddedWordsPerRow),
      dstOffset,
    )
  }

  readbackBuffer.unmap()
  readbackBuffer.destroy()
  exportTexture.destroy()
  const png16Rgba = convertRgba16FloatBitsToUint16(packedHalfFloat)
  return encodeRgba16Png(width, height, png16Rgba)
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
    original.removeAttribute('src')
    qualityMeta.textContent = 'No run yet.'
    setButtonsIdleState()
    return
  }

  selectedFile = file
  hasOutput = false
  savedOutput = null
  setButtonsIdleState()
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

on('benchmarkBtn', 'click', async () => {
  const file = selectedFile
  if (!file) {
    qualityMeta.textContent = 'Pick an image first.'
    return
  }

  processBtn.disabled = true
  benchmarkBtn.disabled = true
  saveBtn.disabled = true
  qualityMeta.textContent = 'Preparing benchmark runtime...'

  try {
    const runtime = await createUpscaleRuntime(file)
    console.log('Benchmark dimensions', {
      input: `${runtime.inputWidth}x${runtime.inputHeight}`,
      output: `${runtime.finalTexture.width}x${runtime.finalTexture.height}`,
      warmupFrames: BENCHMARK_WARMUP_FRAMES,
      sampleFrames: BENCHMARK_SAMPLE_FRAMES,
    })

    qualityMeta.textContent = 'Benchmarking core (no present)...'
    const coreSamples = await benchmarkRuntime(
      runtime,
      false,
      false,
      BENCHMARK_WARMUP_FRAMES,
      BENCHMARK_SAMPLE_FRAMES,
    )

    qualityMeta.textContent = 'Benchmarking video latency (upload + present)...'
    const endToEndSamples = await benchmarkRuntime(
      runtime,
      true,
      true,
      BENCHMARK_WARMUP_FRAMES,
      BENCHMARK_SAMPLE_FRAMES,
    )

    qualityMeta.textContent = 'Benchmarking video throughput (upload + pipeline)...'
    const throughputSummary = await benchmarkRuntimeThroughput(
      runtime,
      false,
      true,
      BENCHMARK_WARMUP_FRAMES,
      BENCHMARK_SAMPLE_FRAMES,
    )

    const coreSummary = summarizeBenchmarkSamples(coreSamples)
    const endToEndSummary = summarizeBenchmarkSamples(endToEndSamples)
    qualityMeta.textContent = [
      `Benchmark ${runtime.inputWidth}x${runtime.inputHeight} -> ` +
        `${runtime.finalTexture.width}x${runtime.finalTexture.height}`,
      `Warmup: ${BENCHMARK_WARMUP_FRAMES} frames, sample: ${BENCHMARK_SAMPLE_FRAMES} frames`,
      formatBenchmarkSummary('Core', coreSummary),
      formatBenchmarkSummary('Video latency (upload + present)', endToEndSummary),
      formatThroughputSummary('Video throughput (upload + pipeline)', throughputSummary),
      benchmarkBudgetVerdict('Video latency p95 budget', endToEndSummary.p95Ms),
      benchmarkBudgetVerdict('Video throughput avg budget', throughputSummary.avgMs),
    ].join('\n')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    qualityMeta.textContent = `Benchmark failed: ${message}`
  } finally {
    setButtonsIdleState()
  }
})

on('processBtn', 'click', async () => {
  const file = selectedFile
  if (!file) {
    qualityMeta.textContent = 'Pick an image first.'
    return
  }

  processBtn.disabled = true
  benchmarkBtn.disabled = true
  saveBtn.disabled = true
  hasOutput = false
  savedOutput = null
  qualityMeta.textContent = 'Running pipeline...'

  try {
    const runtime = await createUpscaleRuntime(file)
    console.log('Upscale dimensions', {
      input: `${runtime.inputWidth}x${runtime.inputHeight}`,
      output: `${runtime.finalTexture.width}x${runtime.finalTexture.height}`,
    })

    const pipelineStart = performance.now()
    const encoder = runtime.device.createCommandEncoder({
      label: 'pipeline encoder',
    })
    encodeUpscalePasses(encoder, runtime.stageChain)
    encodePresentPass(encoder, runtime)

    runtime.device.queue.submit([encoder.finish()])
    await runtime.device.queue.onSubmittedWorkDone()
    const runtimeMs = performance.now() - pipelineStart

    hasOutput = true
    savedOutput = {
      device: runtime.device,
      texture: runtime.finalTexture,
      sampler: runtime.frameSampler,
      width: runtime.finalTexture.width,
      height: runtime.finalTexture.height,
      sourceName: sourceNameFromFile(file),
    }
    qualityMeta.textContent =
      `Upscale complete: ${runtime.inputWidth}x${runtime.inputHeight} -> ` +
      `${runtime.finalTexture.width}x${runtime.finalTexture.height} in ${toFixed(runtimeMs, 1)} ms.`
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    qualityMeta.textContent = `Upscale failed: ${message}`
  } finally {
    setButtonsIdleState()
  }
})
