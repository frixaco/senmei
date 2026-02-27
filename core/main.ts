import { setupStage1 } from './pipeline/1.ts'
import { setupStage2 } from './pipeline/2.ts'
import { setupStage3 } from './pipeline/3.ts'
import { setupStage4 } from './pipeline/4.ts'
import { setupStage5 } from './pipeline/5.ts'
import { setupStage6 } from './pipeline/6.ts'

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

  if (!navigator.gpu) {
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

  const stage1 = setupStage1(device, initialTexture, frameSampler)
  const stage2 = setupStage2(device, stage1.outputTexture, frameSampler)
  const stage3 = setupStage3(device, stage2.outputTexture, frameSampler)
  const stage4 = setupStage4(device, stage3.outputTexture, frameSampler)
  const stage5 = setupStage5(device, stage4.outputTexture, frameSampler)
  const stage6 = setupStage6(device, stage5.outputTexture, frameSampler, format)
  const finalStage = stage6

  const canvas = getElementById<HTMLCanvasElement>('canvas')
  canvas.width = finalStage.outputTexture.width
  canvas.height = finalStage.outputTexture.height
  canvas.style.width = `${bitmap.width}px`
  canvas.style.height = `${bitmap.height}px`

  const context = canvas.getContext('webgpu')
  if (!context) {
    console.error('Unable to acquire webgpu context.')
    return
  }
  context.configure({ device, format })

  const encoder = device.createCommandEncoder({ label: 'pipeline encoder' })
  stage1.encode(encoder)
  stage2.encode(encoder)
  stage3.encode(encoder)
  stage4.encode(encoder)
  stage5.encode(encoder)
  finalStage.encode(encoder, context.getCurrentTexture().createView())
  device.queue.submit([encoder.finish()])
})
