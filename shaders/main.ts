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

const inputPreview = getElementById<HTMLImageElement>('inputPreview')
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
    inputPreview.removeAttribute('src')
    inputPreview.style.display = 'none'
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

    inputPreview.setAttribute('src', result)
    inputPreview.style.display = 'block'
    original.setAttribute('src', result)
  }

  reader.readAsDataURL(file)
})

on('processBtn', 'click', async () => {
  // if (!selectedFile) {
  //   console.error('Pick an image first.')
  //   return
  // }

  if (!navigator.gpu) {
    console.error('WebGPU not supported in this browser.')
    return
  }

  const adapter = await navigator.gpu.requestAdapter({
    // The powerPreference option is currently ignored when calling requestAdapter() on Windows. See https://crbug.com/369219127
    // Also, there is chrome flag to enable that
    powerPreference: 'high-performance',
  })
  if (!adapter) {
    console.error('No GPU adapter found.')
    return
  }

  const device = await adapter.requestDevice()

  const canvas = getElementById<HTMLCanvasElement>("canvas")
  const context = canvas.getContext("webgpu")!
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({
    device,
    format
  })

  const encoder = device.createCommandEncoder()
  const pass = encoder.beginRenderPass({
    colorAttachments: [{
      view: context.getCurrentTexture().createView(),
      loadOp: "clear",
      clearValue: [0, 0.5, 0.7, 1],
      storeOp: "store"
    }]
  })
  pass.end()

  device.queue.submit([encoder.finish()])

  await fetch('./Anime4K_Upscale_CNN_x2_M.wgsl').then((r) => {
    if (!r.ok) {
      throw new Error('Failed to load Anime4K_Upscale_CNN_x2_M.wgsl')
    }

    return r.text()
  })
})
