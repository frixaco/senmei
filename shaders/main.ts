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

  const shaderCode = await fetch('./Anime4K_Upscale_CNN_x2_M.wgsl').then(
    (r) => {
      if (!r.ok) {
        throw new Error('Failed to load Anime4K_Upscale_CNN_x2_M.wgsl')
      }

      return r.text()
    },
  )

  const module = device.createShaderModule({
    label: 'updscaler shaders',
    code: shaderCode,
  })

  const pipeline = device.createRenderPipeline({
    label: 'upscaler pipeline',
    layout: 'auto',
    vertex: {
      entryPoint: 'v',
      module,
    },
    fragment: {
      entryPoint: 'f',
      module,
      targets: [{ format }], // first element - @location(0)
    },
  })

  // IMAGE TO BITMAP TO TEXTURE
  const bitmap = await createImageBitmap(selectedFile, {
    colorSpaceConversion: 'none',
  })

  canvas.width = bitmap.width
  canvas.height = bitmap.height

  const texture = device.createTexture({
    label: 'anime frame',
    format: 'rgba8unorm',
    size: [bitmap.width, bitmap.height],
    usage:
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.RENDER_ATTACHMENT,
  })
  device.queue.copyExternalImageToTexture(
    { source: bitmap, flipY: false }, // TODO: what if `true`?
    { texture },
    { width: bitmap.width, height: bitmap.height },
  )
  const sampler = device.createSampler({
    magFilter: 'nearest',
    minFilter: 'nearest',
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
  })
  const bindGroup = device.createBindGroup({
    label: 'upscaler bind group',
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: texture.createView() },
      { binding: 1, resource: sampler },
    ],
  })

  // describe which textured we want to draw to and how to use them
  const renderPassDescriptor: GPURenderPassDescriptor = {
    label: 'canvas render pass',
    // @ts-ignore
    colorAttachments: [
      {
        clearValue: [0.3, 0.3, 0.3, 1],
        loadOp: 'clear',
        storeOp: 'store',
      },
    ],
  }

  function render() {
    // @ts-ignore
    renderPassDescriptor.colorAttachments[0].view = context
      .getCurrentTexture()
      .createView()

    const encoder = device.createCommandEncoder({ label: 'command encoder' })
    const pass = encoder.beginRenderPass(renderPassDescriptor)
    pass.setPipeline(pipeline)
    pass.setBindGroup(0, bindGroup)
    pass.draw(3)
    pass.end()

    const commandBuffer = encoder.finish()
    device.queue.submit([commandBuffer])
  }

  render()

  // // square vertice coords
  // const vertices = new Float32Array([
  //   -0.8, -0.8, 0.8, -0.8, 0.8, 0.8, 0.8, 0.8, -0.8, 0.8, -0.8, -0.8,
  // ])
  //
  // const vertexBuffer = device.createBuffer({
  //   label: 'Cell vertices',
  //   size: vertices.byteLength,
  //   usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  // })
  //
  // device.queue.writeBuffer(vertexBuffer, /* bufferOffset = */ 0, vertices)
  //
  // const vertexBufferLayout: GPUVertexBufferLayout = {
  //   arrayStride: 8,
  //   attributes: [
  //     {
  //       format: 'float32x2',
  //       offset: 0,
  //       shaderLocation: 0, // Position, see vertex shader
  //     },
  //   ],
  // }
  //
  //
  // // Create the bind group layout and pipeline layout.
  // const bindGroupLayout = device.createBindGroupLayout({
  //   label: 'Cell Bind Group Layout',
  //   entries: [
  //     {
  //       binding: 0,
  //       visibility:
  //         GPUShaderStage.VERTEX |
  //         GPUShaderStage.FRAGMENT |
  //         GPUShaderStage.COMPUTE,
  //       buffer: {}, // Grid uniform buffer
  //     },
  //     {
  //       binding: 1,
  //       visibility: GPUShaderStage.VERTEX | GPUShaderStage.COMPUTE,
  //       buffer: { type: 'read-only-storage' }, // Cell state input buffer
  //     },
  //     {
  //       binding: 2,
  //       visibility: GPUShaderStage.COMPUTE,
  //       buffer: { type: 'storage' }, // Cell state output buffer
  //     },
  //   ],
  // })
  //
  // const pipelineLayout = device.createPipelineLayout({
  //   label: 'Cell Pipeline Layout',
  //   bindGroupLayouts: [bindGroupLayout],
  // })
  //
  // const cellPipeline = device.createRenderPipeline({
  //   label: 'Cell pipeline',
  //   layout: pipelineLayout,
  //   vertex: {
  //     module: cellShaderModule,
  //     entryPoint: 'vertexMain',
  //     buffers: [vertexBufferLayout],
  //   },
  //   fragment: {
  //     module: cellShaderModule,
  //     entryPoint: 'fragmentMain',
  //     targets: [
  //       {
  //         format,
  //       },
  //     ],
  //   },
  // })
  //
  // const UPDATE_INTERVAL = 200 // Update every 200ms (5 times/sec)
  // let step = 0 // Track how many simulation steps have been run
  //
  // const GRID_SIZE = 32
  // const WORKGROUP_SIZE = 8
  //
  // // Create a uniform buffer that describes the grid.
  // const uniformArray = new Float32Array([GRID_SIZE, GRID_SIZE])
  // const uniformBuffer = device.createBuffer({
  //   label: 'Grid Uniforms',
  //   size: uniformArray.byteLength,
  //   usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  // })
  // device.queue.writeBuffer(uniformBuffer, 0, uniformArray)
  //
  // const cellStateArray = new Uint32Array(GRID_SIZE * GRID_SIZE)
  // const cellStateStorage = [
  //   device.createBuffer({
  //     label: 'Cell State A',
  //     size: cellStateArray.byteLength,
  //     usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  //   }),
  //   device.createBuffer({
  //     label: 'Cell State B',
  //     size: cellStateArray.byteLength,
  //     usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  //   }),
  // ]
  // // Mark every third cell of the first grid as active.
  // for (let i = 0; i < cellStateArray.length; i += 3) {
  //   cellStateArray[i] = 1
  // }
  // device.queue.writeBuffer(cellStateStorage[0]!, 0, cellStateArray)
  //
  // // Mark every other cell of the second grid as active.
  // for (let i = 0; i < cellStateArray.length; i++) {
  //   cellStateArray[i] = i % 2
  // }
  // device.queue.writeBuffer(cellStateStorage[1]!, 0, cellStateArray)
  //
  // // Create a bind group to pass the grid uniforms into the pipeline
  // const bindGroups = [
  //   device.createBindGroup({
  //     label: 'Cell renderer bind group A',
  //     layout: bindGroupLayout, // Updated Line
  //     entries: [
  //       {
  //         binding: 0,
  //         resource: { buffer: uniformBuffer },
  //       },
  //       {
  //         binding: 1,
  //         resource: { buffer: cellStateStorage[0]! },
  //       },
  //       {
  //         binding: 2, // New Entry
  //         resource: { buffer: cellStateStorage[1]! },
  //       },
  //     ],
  //   }),
  //   device.createBindGroup({
  //     label: 'Cell renderer bind group B',
  //     layout: bindGroupLayout, // Updated Line
  //
  //     entries: [
  //       {
  //         binding: 0,
  //         resource: { buffer: uniformBuffer },
  //       },
  //       {
  //         binding: 1,
  //         resource: { buffer: cellStateStorage[1]! },
  //       },
  //       {
  //         binding: 2, // New Entry
  //         resource: { buffer: cellStateStorage[0]! },
  //       },
  //     ],
  //   }),
  // ]
  //
  // // Create a compute pipeline that updates the game state.
  // const simulationPipeline = device.createComputePipeline({
  //   label: 'Simulation pipeline',
  //   layout: pipelineLayout,
  //   compute: {
  //     module: cellShaderModule,
  //     entryPoint: 'computeMain',
  //   },
  // })
  //
  // function updateGrid() {
  //   step++
  //
  //   const encoder = device.createCommandEncoder()
  //   const computePass = encoder.beginComputePass()
  //   computePass.setPipeline(simulationPipeline)
  //   computePass.setBindGroup(0, bindGroups[step % 2])
  //   const workgroupCount = Math.ceil(GRID_SIZE / WORKGROUP_SIZE)
  //   computePass.dispatchWorkgroups(workgroupCount, workgroupCount)
  //   computePass.end()
  //
  //   const pass = encoder.beginRenderPass({
  //     colorAttachments: [
  //       {
  //         view: context.getCurrentTexture().createView(),
  //         loadOp: 'clear',
  //         clearValue: [0, 0.5, 0.7, 1],
  //         storeOp: 'store',
  //       },
  //     ],
  //   })
  //
  //   pass.setPipeline(cellPipeline)
  //   pass.setVertexBuffer(0, vertexBuffer)
  //   pass.setBindGroup(0, bindGroups[step % 2])
  //   pass.draw(vertices.length / 2, GRID_SIZE * GRID_SIZE)
  //   pass.end()
  //
  //   device.queue.submit([encoder.finish()])
  // }
  //
  // setInterval(updateGrid, UPDATE_INTERVAL)
})
