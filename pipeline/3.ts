import {
  fragF,
  fragP1,
  fragP10,
  fragP11,
  fragP12,
  fragP13,
  fragP14,
  fragP15,
  fragP16,
  fragP17,
  fragP2,
  fragP3,
  fragP4,
  fragP5,
  fragP6,
  fragP7,
  fragP8,
  fragP9,
  whenF,
  whenP1,
  whenP10,
  whenP11,
  whenP12,
  whenP13,
  whenP14,
  whenP15,
  whenP16,
  whenP17,
  whenP2,
  whenP3,
  whenP4,
  whenP5,
  whenP6,
  whenP7,
  whenP8,
  whenP9,
} from '../shaders/Anime4K_Upscale_CNN_x2_VL.ts'
import {
  buildWhenContext,
  createTexture,
  evaluateWhenExpression,
  vertexShader,
} from './shared.ts'
import type { PipelineStage, WhenReferenceDimensions } from './shared.ts'

interface Anime4KUpscaleVLShaders {
  fragP1: string
  fragP2: string
  fragP3: string
  fragP4: string
  fragP5: string
  fragP6: string
  fragP7: string
  fragP8: string
  fragP9: string
  fragP10: string
  fragP11: string
  fragP12: string
  fragP13: string
  fragP14: string
  fragP15: string
  fragP16: string
  fragP17: string
  fragF: string
  whenP1: string | null
  whenP2: string | null
  whenP3: string | null
  whenP4: string | null
  whenP5: string | null
  whenP6: string | null
  whenP7: string | null
  whenP8: string | null
  whenP9: string | null
  whenP10: string | null
  whenP11: string | null
  whenP12: string | null
  whenP13: string | null
  whenP14: string | null
  whenP15: string | null
  whenP16: string | null
  whenP17: string | null
  whenF: string | null
}

const passTextureCounts = [
  0, 0, 2, 2, 4, 4, 6, 6, 8, 8, 10, 10, 12, 12, 14, 14, 14,
] as const

const makeBindingRange = (start: number, end: number) =>
  Array.from({ length: end - start + 1 }, (_, index) => start + index)

const passBindingIndices = passTextureCounts.map((count) =>
  makeBindingRange(2, count + 1),
)

const finalPassBindingIndices = [16, 17, 18] as const

function setupAnime4KUpscaleVLStage(
  device: GPUDevice,
  inputTexture: GPUTexture,
  sampler: GPUSampler,
  shaders: Anime4KUpscaleVLShaders,
  stageLabel: string,
  whenReference: WhenReferenceDimensions,
  targetFormat: GPUTextureFormat = 'rgba32float',
): PipelineStage {
  const w = inputTexture.width
  const h = inputTexture.height
  const whenContext = buildWhenContext({ w, h }, whenReference)

  const passEnabled = [
    evaluateWhenExpression(shaders.whenP1, whenContext),
    evaluateWhenExpression(shaders.whenP2, whenContext),
    evaluateWhenExpression(shaders.whenP3, whenContext),
    evaluateWhenExpression(shaders.whenP4, whenContext),
    evaluateWhenExpression(shaders.whenP5, whenContext),
    evaluateWhenExpression(shaders.whenP6, whenContext),
    evaluateWhenExpression(shaders.whenP7, whenContext),
    evaluateWhenExpression(shaders.whenP8, whenContext),
    evaluateWhenExpression(shaders.whenP9, whenContext),
    evaluateWhenExpression(shaders.whenP10, whenContext),
    evaluateWhenExpression(shaders.whenP11, whenContext),
    evaluateWhenExpression(shaders.whenP12, whenContext),
    evaluateWhenExpression(shaders.whenP13, whenContext),
    evaluateWhenExpression(shaders.whenP14, whenContext),
    evaluateWhenExpression(shaders.whenP15, whenContext),
    evaluateWhenExpression(shaders.whenP16, whenContext),
    evaluateWhenExpression(shaders.whenP17, whenContext),
  ]

  const finalPassEnabled = evaluateWhenExpression(shaders.whenF, whenContext)

  if (!finalPassEnabled) {
    return {
      outputTexture: inputTexture,
      encode() {},
    }
  }

  for (let passIndex = 0; passIndex < passEnabled.length; passIndex += 1) {
    if (!passEnabled[passIndex]) {
      continue
    }

    const dependenciesCount = passTextureCounts[passIndex]!
    for (let dependencyIndex = 0; dependencyIndex < dependenciesCount; dependencyIndex += 1) {
      if (!passEnabled[dependencyIndex]) {
        throw new Error(
          `${stageLabel}: pass ${passIndex + 1} requires pass ${dependencyIndex + 1} to run`,
        )
      }
    }
  }

  const finalDependencies = [14, 15, 16]
  for (const dependencyIndex of finalDependencies) {
    if (!passEnabled[dependencyIndex]) {
      throw new Error(
        `${stageLabel}: final pass requires pass ${dependencyIndex + 1} to run`,
      )
    }
  }

  const intermediateTextures = [
    createTexture(device, w, h, `${stageLabel} conv2d_tf`, targetFormat),
    createTexture(device, w, h, `${stageLabel} conv2d_tf1`, targetFormat),
    createTexture(device, w, h, `${stageLabel} conv2d_1_tf`, targetFormat),
    createTexture(device, w, h, `${stageLabel} conv2d_1_tf1`, targetFormat),
    createTexture(device, w, h, `${stageLabel} conv2d_2_tf`, targetFormat),
    createTexture(device, w, h, `${stageLabel} conv2d_2_tf1`, targetFormat),
    createTexture(device, w, h, `${stageLabel} conv2d_3_tf`, targetFormat),
    createTexture(device, w, h, `${stageLabel} conv2d_3_tf1`, targetFormat),
    createTexture(device, w, h, `${stageLabel} conv2d_4_tf`, targetFormat),
    createTexture(device, w, h, `${stageLabel} conv2d_4_tf1`, targetFormat),
    createTexture(device, w, h, `${stageLabel} conv2d_5_tf`, targetFormat),
    createTexture(device, w, h, `${stageLabel} conv2d_5_tf1`, targetFormat),
    createTexture(device, w, h, `${stageLabel} conv2d_6_tf`, targetFormat),
    createTexture(device, w, h, `${stageLabel} conv2d_6_tf1`, targetFormat),
    createTexture(device, w, h, `${stageLabel} conv2d_last_tf`, targetFormat),
    createTexture(device, w, h, `${stageLabel} conv2d_last_tf1`, targetFormat),
    createTexture(device, w, h, `${stageLabel} conv2d_last_tf2`, targetFormat),
  ]

  const outputTexture = createTexture(
    device,
    w * 2,
    h * 2,
    `${stageLabel} output`,
    targetFormat,
  )
  const inputView = inputTexture.createView()
  const intermediateViews = intermediateTextures.map((texture) => texture.createView())
  const outputView = outputTexture.createView()

  const moduleV = device.createShaderModule({
    label: `${stageLabel} vertex shader`,
    code: vertexShader,
  })

  const fragmentModules = [
    shaders.fragP1,
    shaders.fragP2,
    shaders.fragP3,
    shaders.fragP4,
    shaders.fragP5,
    shaders.fragP6,
    shaders.fragP7,
    shaders.fragP8,
    shaders.fragP9,
    shaders.fragP10,
    shaders.fragP11,
    shaders.fragP12,
    shaders.fragP13,
    shaders.fragP14,
    shaders.fragP15,
    shaders.fragP16,
    shaders.fragP17,
  ].map((code, index) =>
    device.createShaderModule({
      label: `${stageLabel} fragment pass ${index + 1}`,
      code,
    }),
  )

  const finalFragmentModule = device.createShaderModule({
    label: `${stageLabel} fragment final pass`,
    code: shaders.fragF,
  })

  const createBindGroupLayout = (bindingIndices: readonly number[]) =>
    device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'unfilterable-float' as const },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: { type: 'non-filtering' as const },
        },
        ...bindingIndices.map((binding) => ({
          binding,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'unfilterable-float' as const },
        })),
      ],
    })

  const bindGroupLayouts = new Map<string, GPUBindGroupLayout>()
  const pipelineLayouts = new Map<string, GPUPipelineLayout>()
  const bindGroups = new Map<string, GPUBindGroup>()

  const allBindingSets: readonly (readonly number[])[] = [
    ...passBindingIndices,
    finalPassBindingIndices,
  ]

  for (const bindingIndices of allBindingSets) {
    const key = bindingIndices.join(',')
    if (bindGroupLayouts.has(key)) {
      continue
    }

    const bindGroupLayout = createBindGroupLayout(bindingIndices)
    bindGroupLayouts.set(key, bindGroupLayout)
    pipelineLayouts.set(
      key,
      device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
    )
    bindGroups.set(
      key,
      device.createBindGroup({
        label: `${stageLabel} bind group ${key || 'base'}`,
        layout: bindGroupLayout,
        entries: [
          { binding: 0, resource: inputView },
          { binding: 1, resource: sampler },
          ...bindingIndices.map((binding) => ({
            binding,
            resource: intermediateViews[binding - 2]!,
          })),
        ],
      }),
    )
  }

  const createPipeline = (
    fragmentModule: GPUShaderModule,
    pipelineLayout: GPUPipelineLayout,
    label: string,
    format: GPUTextureFormat = targetFormat,
  ) =>
    device.createRenderPipeline({
      label,
      layout: pipelineLayout,
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

  const pipelines = fragmentModules.map((fragmentModule, index) =>
    createPipeline(
      fragmentModule,
      pipelineLayouts.get(passBindingIndices[index]!.join(','))!,
      `${stageLabel} pass ${index + 1}`,
    ),
  )

  const finalPipeline = createPipeline(
    finalFragmentModule,
    pipelineLayouts.get(finalPassBindingIndices.join(','))!,
    `${stageLabel} final pass`,
    targetFormat,
  )

  const intermediateRenderPasses = intermediateViews.map((view, index) => ({
    enabled: passEnabled[index]!,
    view,
    pipeline: pipelines[index]!,
    bindGroup: bindGroups.get(passBindingIndices[index]!.join(','))!,
  }))

  return {
    outputTexture,
    encode(encoder, targetView) {
      for (const renderPassConfig of intermediateRenderPasses) {
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

      const finalPass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: targetView ?? outputView,
            loadOp: 'clear' as const,
            storeOp: 'store' as const,
          },
        ],
      })
      finalPass.setPipeline(finalPipeline)
      finalPass.setBindGroup(0, bindGroups.get(finalPassBindingIndices.join(','))!)
      finalPass.draw(3)
      finalPass.end()
    },
  }
}

export function setupStage3(
  device: GPUDevice,
  inputTexture: GPUTexture,
  sampler: GPUSampler,
  whenReference: WhenReferenceDimensions,
  targetFormat: GPUTextureFormat = 'rgba32float',
): PipelineStage {
  return setupAnime4KUpscaleVLStage(
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
      fragP8,
      fragP9,
      fragP10,
      fragP11,
      fragP12,
      fragP13,
      fragP14,
      fragP15,
      fragP16,
      fragP17,
      fragF,
      whenP1,
      whenP2,
      whenP3,
      whenP4,
      whenP5,
      whenP6,
      whenP7,
      whenP8,
      whenP9,
      whenP10,
      whenP11,
      whenP12,
      whenP13,
      whenP14,
      whenP15,
      whenP16,
      whenP17,
      whenF,
    },
    'stage3 Anime4K_Upscale_CNN_x2_VL',
    whenReference,
    targetFormat,
  )
}
