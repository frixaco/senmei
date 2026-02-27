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
  whenF,
  whenP1,
  whenP2,
  whenP3,
  whenP4,
  whenP5,
  whenP6,
  whenP7,
  whenP8,
} from '../shaders/Anime4K_Upscale_CNN_x2_M.ts'
import {
  buildWhenContext,
  createTexture,
  evaluateWhenExpression,
  vertexShader,
} from './shared.ts'
import type { PipelineStage } from './shared.ts'
import type { WhenReferenceDimensions } from './shared.ts'

interface Anime4KUpscaleShaders {
  fragP1: string
  fragP2: string
  fragP3: string
  fragP4: string
  fragP5: string
  fragP6: string
  fragP7: string
  frag8: string
  fragF: string
  whenP1: string | null
  whenP2: string | null
  whenP3: string | null
  whenP4: string | null
  whenP5: string | null
  whenP6: string | null
  whenP7: string | null
  whenP8: string | null
  whenF: string | null
}

function setupAnime4KUpscaleStage(
  device: GPUDevice,
  inputTexture: GPUTexture,
  sampler: GPUSampler,
  shaders: Anime4KUpscaleShaders,
  stageLabel: string,
  whenReference: WhenReferenceDimensions,
  targetFormat: GPUTextureFormat = 'rgba16float',
): PipelineStage {
  const w = inputTexture.width
  const h = inputTexture.height

  const whenContext = buildWhenContext({ w, h }, whenReference)
  const passEnabled = {
    p1: evaluateWhenExpression(shaders.whenP1, whenContext),
    p2: evaluateWhenExpression(shaders.whenP2, whenContext),
    p3: evaluateWhenExpression(shaders.whenP3, whenContext),
    p4: evaluateWhenExpression(shaders.whenP4, whenContext),
    p5: evaluateWhenExpression(shaders.whenP5, whenContext),
    p6: evaluateWhenExpression(shaders.whenP6, whenContext),
    p7: evaluateWhenExpression(shaders.whenP7, whenContext),
    p8: evaluateWhenExpression(shaders.whenP8, whenContext),
    final: evaluateWhenExpression(shaders.whenF, whenContext),
  }

  if (!passEnabled.final) {
    return {
      outputTexture: inputTexture,
      encode() {},
    }
  }

  if (!passEnabled.p8) {
    throw new Error(`${stageLabel}: final pass requires pass 8 to run`)
  }

  const conv2d_tf = createTexture(device, w, h, `${stageLabel} conv2d_tf`, targetFormat)
  const conv2d_tf_1 = createTexture(
    device,
    w,
    h,
    `${stageLabel} conv2d_tf_1`,
    targetFormat,
  )
  const conv2d_tf_2 = createTexture(
    device,
    w,
    h,
    `${stageLabel} conv2d_tf_2`,
    targetFormat,
  )
  const conv2d_tf_3 = createTexture(
    device,
    w,
    h,
    `${stageLabel} conv2d_tf_3`,
    targetFormat,
  )
  const conv2d_tf_4 = createTexture(
    device,
    w,
    h,
    `${stageLabel} conv2d_tf_4`,
    targetFormat,
  )
  const conv2d_tf_5 = createTexture(
    device,
    w,
    h,
    `${stageLabel} conv2d_tf_5`,
    targetFormat,
  )
  const conv2d_tf_6 = createTexture(
    device,
    w,
    h,
    `${stageLabel} conv2d_tf_6`,
    targetFormat,
  )
  const conv2d_tf_last = createTexture(
    device,
    w,
    h,
    `${stageLabel} conv2d_tf_last`,
    targetFormat,
  )
  const outputTexture = createTexture(
    device,
    w * 2,
    h * 2,
    `${stageLabel} output`,
    targetFormat,
  )

  const inputView = inputTexture.createView()
  const conv2d_tf_view = conv2d_tf.createView()
  const conv2d_tf_1_view = conv2d_tf_1.createView()
  const conv2d_tf_2_view = conv2d_tf_2.createView()
  const conv2d_tf_3_view = conv2d_tf_3.createView()
  const conv2d_tf_4_view = conv2d_tf_4.createView()
  const conv2d_tf_5_view = conv2d_tf_5.createView()
  const conv2d_tf_6_view = conv2d_tf_6.createView()
  const conv2d_tf_last_view = conv2d_tf_last.createView()
  const outputView = outputTexture.createView()

  const moduleV = device.createShaderModule({
    label: `${stageLabel} vertex shader`,
    code: vertexShader,
  })
  const fragmentModules = {
    p1: device.createShaderModule({
      label: `${stageLabel} fragment pass 1`,
      code: shaders.fragP1,
    }),
    p2: device.createShaderModule({
      label: `${stageLabel} fragment pass 2`,
      code: shaders.fragP2,
    }),
    p3: device.createShaderModule({
      label: `${stageLabel} fragment pass 3`,
      code: shaders.fragP3,
    }),
    p4: device.createShaderModule({
      label: `${stageLabel} fragment pass 4`,
      code: shaders.fragP4,
    }),
    p5: device.createShaderModule({
      label: `${stageLabel} fragment pass 5`,
      code: shaders.fragP5,
    }),
    p6: device.createShaderModule({
      label: `${stageLabel} fragment pass 6`,
      code: shaders.fragP6,
    }),
    p7: device.createShaderModule({
      label: `${stageLabel} fragment pass 7`,
      code: shaders.fragP7,
    }),
    p8: device.createShaderModule({
      label: `${stageLabel} fragment pass 8`,
      code: shaders.frag8,
    }),
    f: device.createShaderModule({
      label: `${stageLabel} fragment final pass`,
      code: shaders.fragF,
    }),
  }

  const createBindGroupLayout = (numTextures: number) =>
    device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'float' as const },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: { type: 'filtering' as const },
        },
        ...Array.from({ length: numTextures }, (_, i) => ({
          binding: i + 2,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'float' as const },
        })),
      ],
    })

  const bindGroupLayouts = [
    createBindGroupLayout(0),
    createBindGroupLayout(1),
    createBindGroupLayout(2),
    createBindGroupLayout(3),
    createBindGroupLayout(4),
    createBindGroupLayout(5),
    createBindGroupLayout(6),
    createBindGroupLayout(7),
    createBindGroupLayout(8),
  ]

  const pipelineLayouts = bindGroupLayouts.map((bindGroupLayout) =>
    device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
  )

  const createPipeline = (
    fragmentModule: GPUShaderModule,
    layout: GPUPipelineLayout,
    label: string,
    format: GPUTextureFormat = targetFormat,
  ) =>
    device.createRenderPipeline({
      label,
      layout,
      vertex: {
        entryPoint: 'v',
        module: moduleV,
      },
      fragment: {
        entryPoint: 'f',
        module: fragmentModule,
        targets: [{ format }],
      },
    })

  const pipelines = {
    f_1: createPipeline(fragmentModules.p1, pipelineLayouts[0]!, `${stageLabel} f_1`),
    f_2: createPipeline(fragmentModules.p2, pipelineLayouts[1]!, `${stageLabel} f_2`),
    f_3: createPipeline(fragmentModules.p3, pipelineLayouts[2]!, `${stageLabel} f_3`),
    f_4: createPipeline(fragmentModules.p4, pipelineLayouts[3]!, `${stageLabel} f_4`),
    f_5: createPipeline(fragmentModules.p5, pipelineLayouts[4]!, `${stageLabel} f_5`),
    f_6: createPipeline(fragmentModules.p6, pipelineLayouts[5]!, `${stageLabel} f_6`),
    f_7: createPipeline(fragmentModules.p7, pipelineLayouts[6]!, `${stageLabel} f_7`),
    f_final: createPipeline(
      fragmentModules.p8,
      pipelineLayouts[7]!,
      `${stageLabel} f_final`,
    ),
    f_finish: createPipeline(
      fragmentModules.f,
      pipelineLayouts[8]!,
      `${stageLabel} f_finish`,
      targetFormat,
    ),
  }

  const createBindGroup = (
    layout: GPUBindGroupLayout,
    entries: { binding: number; resource: GPUBindingResource }[],
  ) =>
    device.createBindGroup({
      label: `${stageLabel} bind group`,
      layout,
      entries,
    })

  const bindGroupPass1 = createBindGroup(bindGroupLayouts[0]!, [
    { binding: 0, resource: inputView },
    { binding: 1, resource: sampler },
  ])
  const bindGroupPass2 = createBindGroup(bindGroupLayouts[1]!, [
    { binding: 0, resource: inputView },
    { binding: 1, resource: sampler },
    { binding: 2, resource: conv2d_tf_view },
  ])
  const bindGroupPass3 = createBindGroup(bindGroupLayouts[2]!, [
    { binding: 0, resource: inputView },
    { binding: 1, resource: sampler },
    { binding: 2, resource: conv2d_tf_view },
    { binding: 3, resource: conv2d_tf_1_view },
  ])
  const bindGroupPass4 = createBindGroup(bindGroupLayouts[3]!, [
    { binding: 0, resource: inputView },
    { binding: 1, resource: sampler },
    { binding: 2, resource: conv2d_tf_view },
    { binding: 3, resource: conv2d_tf_1_view },
    { binding: 4, resource: conv2d_tf_2_view },
  ])
  const bindGroupPass5 = createBindGroup(bindGroupLayouts[4]!, [
    { binding: 0, resource: inputView },
    { binding: 1, resource: sampler },
    { binding: 2, resource: conv2d_tf_view },
    { binding: 3, resource: conv2d_tf_1_view },
    { binding: 4, resource: conv2d_tf_2_view },
    { binding: 5, resource: conv2d_tf_3_view },
  ])
  const bindGroupPass6 = createBindGroup(bindGroupLayouts[5]!, [
    { binding: 0, resource: inputView },
    { binding: 1, resource: sampler },
    { binding: 2, resource: conv2d_tf_view },
    { binding: 3, resource: conv2d_tf_1_view },
    { binding: 4, resource: conv2d_tf_2_view },
    { binding: 5, resource: conv2d_tf_3_view },
    { binding: 6, resource: conv2d_tf_4_view },
  ])
  const bindGroupPass7 = createBindGroup(bindGroupLayouts[6]!, [
    { binding: 0, resource: inputView },
    { binding: 1, resource: sampler },
    { binding: 2, resource: conv2d_tf_view },
    { binding: 3, resource: conv2d_tf_1_view },
    { binding: 4, resource: conv2d_tf_2_view },
    { binding: 5, resource: conv2d_tf_3_view },
    { binding: 6, resource: conv2d_tf_4_view },
    { binding: 7, resource: conv2d_tf_5_view },
  ])
  const bindGroupPass8 = createBindGroup(bindGroupLayouts[7]!, [
    { binding: 0, resource: inputView },
    { binding: 1, resource: sampler },
    { binding: 2, resource: conv2d_tf_view },
    { binding: 3, resource: conv2d_tf_1_view },
    { binding: 4, resource: conv2d_tf_2_view },
    { binding: 5, resource: conv2d_tf_3_view },
    { binding: 6, resource: conv2d_tf_4_view },
    { binding: 7, resource: conv2d_tf_5_view },
    { binding: 8, resource: conv2d_tf_6_view },
  ])
  const bindGroupPass9 = createBindGroup(bindGroupLayouts[8]!, [
    { binding: 0, resource: inputView },
    { binding: 1, resource: sampler },
    { binding: 2, resource: conv2d_tf_view },
    { binding: 3, resource: conv2d_tf_1_view },
    { binding: 4, resource: conv2d_tf_2_view },
    { binding: 5, resource: conv2d_tf_3_view },
    { binding: 6, resource: conv2d_tf_4_view },
    { binding: 7, resource: conv2d_tf_5_view },
    { binding: 8, resource: conv2d_tf_6_view },
    { binding: 9, resource: conv2d_tf_last_view },
  ])

  const renderPasses = [
    {
      enabled: passEnabled.p1,
      view: conv2d_tf_view,
      pipeline: pipelines.f_1,
      bindGroup: bindGroupPass1,
    },
    {
      enabled: passEnabled.p2,
      view: conv2d_tf_1_view,
      pipeline: pipelines.f_2,
      bindGroup: bindGroupPass2,
    },
    {
      enabled: passEnabled.p3,
      view: conv2d_tf_2_view,
      pipeline: pipelines.f_3,
      bindGroup: bindGroupPass3,
    },
    {
      enabled: passEnabled.p4,
      view: conv2d_tf_3_view,
      pipeline: pipelines.f_4,
      bindGroup: bindGroupPass4,
    },
    {
      enabled: passEnabled.p5,
      view: conv2d_tf_4_view,
      pipeline: pipelines.f_5,
      bindGroup: bindGroupPass5,
    },
    {
      enabled: passEnabled.p6,
      view: conv2d_tf_5_view,
      pipeline: pipelines.f_6,
      bindGroup: bindGroupPass6,
    },
    {
      enabled: passEnabled.p7,
      view: conv2d_tf_6_view,
      pipeline: pipelines.f_7,
      bindGroup: bindGroupPass7,
    },
    {
      enabled: passEnabled.p8,
      view: conv2d_tf_last_view,
      pipeline: pipelines.f_final,
      bindGroup: bindGroupPass8,
    },
  ]

  return {
    outputTexture,
    encode(encoder, targetView) {
      for (const renderPassConfig of renderPasses) {
        if (!renderPassConfig.enabled) {
          continue
        }

        const pass = encoder.beginRenderPass({
          colorAttachments: [
            {
              view: renderPassConfig.view,
              loadOp: 'clear' as const,
              storeOp: 'store' as const,
            },
          ],
        })
        pass.setPipeline(renderPassConfig.pipeline)
        pass.setBindGroup(0, renderPassConfig.bindGroup)
        pass.draw(3)
        pass.end()
      }

      if (passEnabled.final) {
        const finalPass = encoder.beginRenderPass({
          colorAttachments: [
            {
              view: targetView ?? outputView,
              loadOp: 'clear' as const,
              storeOp: 'store' as const,
            },
          ],
        })
        finalPass.setPipeline(pipelines.f_finish)
        finalPass.setBindGroup(0, bindGroupPass9)
        finalPass.draw(3)
        finalPass.end()
      }
    },
  }
}

export function setupStage6(
  device: GPUDevice,
  inputTexture: GPUTexture,
  sampler: GPUSampler,
  whenReference: WhenReferenceDimensions,
  targetFormat: GPUTextureFormat = 'rgba16float',
): PipelineStage {
  return setupAnime4KUpscaleStage(
    device,
    inputTexture,
    sampler,
    {
      fragP1,
      fragP2,
      fragP3,
      fragP4,
      fragP5,
      fragP6,
      fragP7,
      frag8,
      fragF,
      whenP1,
      whenP2,
      whenP3,
      whenP4,
      whenP5,
      whenP6,
      whenP7,
      whenP8,
      whenF,
    },
    'stage6 Anime4K_Upscale_CNN_x2_M',
    whenReference,
    targetFormat,
  )
}
