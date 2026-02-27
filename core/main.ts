import {
  fragF,
  fragP1,
  fragP2,
  fragP3,
  fragP4,
  fragP5,
  fragP6,
  fragP7,
  frag8,
  vertexShader,
} from './shaders/Anime4K_Upscale_CNN_x2_M.ts'

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
    // The powerPreference option is currently ignored when calling requestAdapter() on Windows. See https://crbug.com/369219127
    // Also, there is chrome flag to enable that
    powerPreference: 'high-performance',
  })
  if (!adapter) {
    console.error('No GPU adapter found.')
    return
  }

  const device = await adapter.requestDevice()

  const canvas = getElementById<HTMLCanvasElement>('canvas')
  const context = canvas.getContext('webgpu')!
  const format = navigator.gpu.getPreferredCanvasFormat()
  context.configure({
    device,
    format,
  })

  const moduleV = device.createShaderModule({
    label: 'updscaler vertex shader',
    code: vertexShader,
  })
  const fragmentModules = {
    p1: device.createShaderModule({
      label: 'upscaler fragment pass 1',
      code: fragP1,
    }),
    p2: device.createShaderModule({
      label: 'upscaler fragment pass 2',
      code: fragP2,
    }),
    p3: device.createShaderModule({
      label: 'upscaler fragment pass 3',
      code: fragP3,
    }),
    p4: device.createShaderModule({
      label: 'upscaler fragment pass 4',
      code: fragP4,
    }),
    p5: device.createShaderModule({
      label: 'upscaler fragment pass 5',
      code: fragP5,
    }),
    p6: device.createShaderModule({
      label: 'upscaler fragment pass 6',
      code: fragP6,
    }),
    p7: device.createShaderModule({
      label: 'upscaler fragment pass 7',
      code: fragP7,
    }),
    p8: device.createShaderModule({
      label: 'upscaler fragment pass 8',
      code: frag8,
    }),
    f: device.createShaderModule({
      label: 'upscaler fragment final pass',
      code: fragF,
    }),
  }

  // IMAGE TO BITMAP TO TEXTURE
  const bitmap = await createImageBitmap(selectedFile, {
    colorSpaceConversion: 'none',
  })

  canvas.width = bitmap.width * 2
  canvas.height = bitmap.height * 2
  // Keep internal render target at 2x, but display at source size for side-by-side comparison.
  canvas.style.width = `${bitmap.width}px`
  canvas.style.height = `${bitmap.height}px`

  const w = bitmap.width
  const h = bitmap.height

  const frame = device.createTexture({
    label: 'anime frame',
    format: 'rgba8unorm',
    size: [w, h],
    usage:
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.RENDER_ATTACHMENT,
  })
  device.queue.copyExternalImageToTexture(
    { source: bitmap, flipY: false },
    { texture: frame },
    { width: w, height: h },
  )

  const frameSampler = device.createSampler({
    magFilter: 'nearest',
    minFilter: 'nearest',
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
  })

  const createTex = (label: string, width = w, height = h) =>
    device.createTexture({
      label,
      format: 'rgba8unorm',
      size: [width, height],
      usage:
        GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
    })

  const conv2d_tf = createTex('conv2d_tf')
  const conv2d_tf_1 = createTex('conv2d_tf_1')
  const conv2d_tf_2 = createTex('conv2d_tf_2')
  const conv2d_tf_3 = createTex('conv2d_tf_3')
  const conv2d_tf_4 = createTex('conv2d_tf_4')
  const conv2d_tf_5 = createTex('conv2d_tf_5')
  const conv2d_tf_6 = createTex('conv2d_tf_6')
  // Keep last feature map at source resolution; f_finish does the 2x pixel shuffle.
  const conv2d_tf_last = createTex('conv2d_tf_last')

  const createBindGroupLayout = (numTextures: number) =>
    device.createBindGroupLayout({
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
        ...Array.from({ length: numTextures }, (_, i) => ({
          binding: i + 2,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'float' as const },
        })),
      ],
    })

  const bindGroupLayouts = [
    createBindGroupLayout(0), // Pass 1: only frame
    createBindGroupLayout(1), // Pass 2: frame + conv2d_tf
    createBindGroupLayout(2), // Pass 3: frame + conv2d_tf + conv2d_tf_1
    createBindGroupLayout(3), // Pass 4
    createBindGroupLayout(4), // Pass 5
    createBindGroupLayout(5), // Pass 6
    createBindGroupLayout(6), // Pass 7
    createBindGroupLayout(7), // Pass 8
    createBindGroupLayout(8), // Pass 9
  ]

  const createPipeline = (
    fragmentModule: GPUShaderModule,
    layout: GPUPipelineLayout,
    label: string,
    targetFormat?: GPUTextureFormat,
  ) =>
    device.createRenderPipeline({
      label,
      layout,
      vertex: { entryPoint: 'v', module: moduleV },
      fragment: {
        entryPoint: 'f',
        module: fragmentModule,
        targets: [{ format: targetFormat ?? 'rgba8unorm' }],
      },
    })

  const pipelineLayouts = bindGroupLayouts.map((bgl) =>
    device.createPipelineLayout({ bindGroupLayouts: [bgl] }),
  )

  const pipelines = {
    f_1: createPipeline(
      fragmentModules.p1,
      pipelineLayouts[0]!,
      'pipeline f_1',
    ),
    f_2: createPipeline(
      fragmentModules.p2,
      pipelineLayouts[1]!,
      'pipeline f_2',
    ),
    f_3: createPipeline(
      fragmentModules.p3,
      pipelineLayouts[2]!,
      'pipeline f_3',
    ),
    f_4: createPipeline(
      fragmentModules.p4,
      pipelineLayouts[3]!,
      'pipeline f_4',
    ),
    f_5: createPipeline(
      fragmentModules.p5,
      pipelineLayouts[4]!,
      'pipeline f_5',
    ),
    f_6: createPipeline(
      fragmentModules.p6,
      pipelineLayouts[5]!,
      'pipeline f_6',
    ),
    f_7: createPipeline(
      fragmentModules.p7,
      pipelineLayouts[6]!,
      'pipeline f_7',
    ),
    f_final: createPipeline(
      fragmentModules.p8,
      pipelineLayouts[7]!,
      'pipeline f_final',
    ),
    f_finish: createPipeline(
      fragmentModules.f,
      pipelineLayouts[8]!,
      'pipeline f_finish',
      format,
    ),
  }

  const createBindGroup = (
    layout: GPUBindGroupLayout,
    entries: { binding: number; resource: GPUBindingResource }[],
  ) =>
    device.createBindGroup({
      label: `bind group for pass`,
      layout,
      entries,
    })

  const bindGroupPass1 = createBindGroup(bindGroupLayouts[0]!, [
    { binding: 0, resource: frame.createView() },
    { binding: 1, resource: frameSampler },
  ])

  const bindGroupPass2 = createBindGroup(bindGroupLayouts[1]!, [
    { binding: 0, resource: frame.createView() },
    { binding: 1, resource: frameSampler },
    { binding: 2, resource: conv2d_tf.createView() },
  ])

  const bindGroupPass3 = createBindGroup(bindGroupLayouts[2]!, [
    { binding: 0, resource: frame.createView() },
    { binding: 1, resource: frameSampler },
    { binding: 2, resource: conv2d_tf.createView() },
    { binding: 3, resource: conv2d_tf_1.createView() },
  ])

  const bindGroupPass4 = createBindGroup(bindGroupLayouts[3]!, [
    { binding: 0, resource: frame.createView() },
    { binding: 1, resource: frameSampler },
    { binding: 2, resource: conv2d_tf.createView() },
    { binding: 3, resource: conv2d_tf_1.createView() },
    { binding: 4, resource: conv2d_tf_2.createView() },
  ])

  const bindGroupPass5 = createBindGroup(bindGroupLayouts[4]!, [
    { binding: 0, resource: frame.createView() },
    { binding: 1, resource: frameSampler },
    { binding: 2, resource: conv2d_tf.createView() },
    { binding: 3, resource: conv2d_tf_1.createView() },
    { binding: 4, resource: conv2d_tf_2.createView() },
    { binding: 5, resource: conv2d_tf_3.createView() },
  ])

  const bindGroupPass6 = createBindGroup(bindGroupLayouts[5]!, [
    { binding: 0, resource: frame.createView() },
    { binding: 1, resource: frameSampler },
    { binding: 2, resource: conv2d_tf.createView() },
    { binding: 3, resource: conv2d_tf_1.createView() },
    { binding: 4, resource: conv2d_tf_2.createView() },
    { binding: 5, resource: conv2d_tf_3.createView() },
    { binding: 6, resource: conv2d_tf_4.createView() },
  ])

  const bindGroupPass7 = createBindGroup(bindGroupLayouts[6]!, [
    { binding: 0, resource: frame.createView() },
    { binding: 1, resource: frameSampler },
    { binding: 2, resource: conv2d_tf.createView() },
    { binding: 3, resource: conv2d_tf_1.createView() },
    { binding: 4, resource: conv2d_tf_2.createView() },
    { binding: 5, resource: conv2d_tf_3.createView() },
    { binding: 6, resource: conv2d_tf_4.createView() },
    { binding: 7, resource: conv2d_tf_5.createView() },
  ])

  const bindGroupPass8 = createBindGroup(bindGroupLayouts[7]!, [
    { binding: 0, resource: frame.createView() },
    { binding: 1, resource: frameSampler },
    { binding: 2, resource: conv2d_tf.createView() },
    { binding: 3, resource: conv2d_tf_1.createView() },
    { binding: 4, resource: conv2d_tf_2.createView() },
    { binding: 5, resource: conv2d_tf_3.createView() },
    { binding: 6, resource: conv2d_tf_4.createView() },
    { binding: 7, resource: conv2d_tf_5.createView() },
    { binding: 8, resource: conv2d_tf_6.createView() },
  ])

  const bindGroupPass9 = createBindGroup(bindGroupLayouts[8]!, [
    { binding: 0, resource: frame.createView() },
    { binding: 1, resource: frameSampler },
    { binding: 2, resource: conv2d_tf.createView() },
    { binding: 3, resource: conv2d_tf_1.createView() },
    { binding: 4, resource: conv2d_tf_2.createView() },
    { binding: 5, resource: conv2d_tf_3.createView() },
    { binding: 6, resource: conv2d_tf_4.createView() },
    { binding: 7, resource: conv2d_tf_5.createView() },
    { binding: 8, resource: conv2d_tf_6.createView() },
    { binding: 9, resource: conv2d_tf_last.createView() },
  ])

  function render() {
    const encoder = device.createCommandEncoder({ label: 'command encoder' })

    // Pass 1: f_1 → conv2d_tf
    let pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: conv2d_tf.createView(),
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    })
    pass.setPipeline(pipelines.f_1)
    pass.setBindGroup(0, bindGroupPass1)
    pass.draw(3)
    pass.end()

    // Pass 2: f_2 → conv2d_tf_1
    pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: conv2d_tf_1.createView(),
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    })
    pass.setPipeline(pipelines.f_2)
    pass.setBindGroup(0, bindGroupPass2)
    pass.draw(3)
    pass.end()

    // Pass 3: f_3 → conv2d_tf_2
    pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: conv2d_tf_2.createView(),
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    })
    pass.setPipeline(pipelines.f_3)
    pass.setBindGroup(0, bindGroupPass3)
    pass.draw(3)
    pass.end()

    // Pass 4: f_4 → conv2d_tf_3
    pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: conv2d_tf_3.createView(),
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    })
    pass.setPipeline(pipelines.f_4)
    pass.setBindGroup(0, bindGroupPass4)
    pass.draw(3)
    pass.end()

    // Pass 5: f_5 → conv2d_tf_4
    pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: conv2d_tf_4.createView(),
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    })
    pass.setPipeline(pipelines.f_5)
    pass.setBindGroup(0, bindGroupPass5)
    pass.draw(3)
    pass.end()

    // Pass 6: f_6 → conv2d_tf_5
    pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: conv2d_tf_5.createView(),
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    })
    pass.setPipeline(pipelines.f_6)
    pass.setBindGroup(0, bindGroupPass6)
    pass.draw(3)
    pass.end()

    // Pass 7: f_7 → conv2d_tf_6
    pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: conv2d_tf_6.createView(),
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    })
    pass.setPipeline(pipelines.f_7)
    pass.setBindGroup(0, bindGroupPass7)
    pass.draw(3)
    pass.end()

    // Pass 8: f_final → conv2d_tf_last (2x size)
    pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: conv2d_tf_last.createView(),
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    })
    pass.setPipeline(pipelines.f_final)
    pass.setBindGroup(0, bindGroupPass8)
    pass.draw(3)
    pass.end()

    // Pass 9: f_finish → canvas (2x size)
    const finalPass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: context.getCurrentTexture().createView(),
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    })
    finalPass.setPipeline(pipelines.f_finish)
    finalPass.setBindGroup(0, bindGroupPass9)
    finalPass.draw(3)
    finalPass.end()

    const commandBuffer = encoder.finish()
    device.queue.submit([commandBuffer])
  }

  render()

  console.log(canvas.width, canvas.height)
})
