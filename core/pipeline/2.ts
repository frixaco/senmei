import {
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
} from '../shaders/Anime4K_Restore_CNN_VL.ts'
import { createTexture, vertexShader } from './shared.ts'
import type { PipelineStage } from './shared.ts'

const passTextureCounts = [
  0, 0, 2, 2, 4, 4, 6, 6, 8, 8, 10, 10, 12, 12, 14, 14, 16,
] as const

const makeBindingRange = (start: number, end: number) =>
  Array.from({ length: end - start + 1 }, (_, index) => start + index)

const passBindingIndices = passTextureCounts.map((count, passIndex) => {
  // Pass 17 only uses conv2d_tf_1..conv2d_tf_7_1 (bindings 4..17).
  if (passIndex === 16) {
    return makeBindingRange(4, 17)
  }

  return makeBindingRange(2, count + 1)
})

const fragmentShaders = [
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
]

export function setupStage2(
  device: GPUDevice,
  inputTexture: GPUTexture,
  sampler: GPUSampler,
): PipelineStage {
  const stageLabel = 'stage2 Anime4K_Restore_CNN_VL'
  const workingFormat: GPUTextureFormat = 'rgba16float'
  const w = inputTexture.width
  const h = inputTexture.height

  const intermediateTextures = [
    createTexture(device, w, h, `${stageLabel} conv2d_tf`, workingFormat),
    createTexture(device, w, h, `${stageLabel} conv2d_tf1`, workingFormat),
    createTexture(device, w, h, `${stageLabel} conv2d_1_tf`, workingFormat),
    createTexture(device, w, h, `${stageLabel} conv2d_1_tf1`, workingFormat),
    createTexture(device, w, h, `${stageLabel} conv2d_2_tf`, workingFormat),
    createTexture(device, w, h, `${stageLabel} conv2d_2_tf1`, workingFormat),
    createTexture(device, w, h, `${stageLabel} conv2d_3_tf`, workingFormat),
    createTexture(device, w, h, `${stageLabel} conv2d_3_tf1`, workingFormat),
    createTexture(device, w, h, `${stageLabel} conv2d_4_tf`, workingFormat),
    createTexture(device, w, h, `${stageLabel} conv2d_4_tf1`, workingFormat),
    createTexture(device, w, h, `${stageLabel} conv2d_5_tf`, workingFormat),
    createTexture(device, w, h, `${stageLabel} conv2d_5_tf1`, workingFormat),
    createTexture(device, w, h, `${stageLabel} conv2d_6_tf`, workingFormat),
    createTexture(device, w, h, `${stageLabel} conv2d_6_tf1`, workingFormat),
    createTexture(device, w, h, `${stageLabel} conv2d_7_tf`, workingFormat),
    createTexture(device, w, h, `${stageLabel} conv2d_7_tf1`, workingFormat),
  ]

  const outputTexture = createTexture(device, w, h, `${stageLabel} output`, workingFormat)

  const inputView = inputTexture.createView()
  const intermediateViews = intermediateTextures.map((texture) =>
    texture.createView(),
  )
  const outputView = outputTexture.createView()

  const moduleV = device.createShaderModule({
    label: `${stageLabel} vertex shader`,
    code: vertexShader,
  })

  const fragmentModules = fragmentShaders.map((code, index) =>
    device.createShaderModule({
      label: `${stageLabel} fragment pass ${index + 1}`,
      code,
    }),
  )

  const createBindGroupLayout = (bindingIndices: readonly number[]) =>
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
        ...bindingIndices.map((binding) => ({
          binding,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'float' as const },
        })),
      ],
    })

  const bindGroupLayouts = new Map<string, GPUBindGroupLayout>()
  const pipelineLayouts = new Map<string, GPUPipelineLayout>()
  const bindGroups = new Map<string, GPUBindGroup>()

  for (const bindingIndices of passBindingIndices) {
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
        targets: [{ format: workingFormat }],
      },
    })

  const pipelines = fragmentModules.map((fragmentModule, index) =>
    createPipeline(
      fragmentModule,
      pipelineLayouts.get(passBindingIndices[index]!.join(','))!,
      `${stageLabel} pass ${index + 1}`,
    ),
  )

  const intermediateRenderPasses = intermediateViews.map((view, index) => ({
    view,
    pipeline: pipelines[index]!,
    bindGroup: bindGroups.get(passBindingIndices[index]!.join(','))!,
  }))

  return {
    outputTexture,
    encode(encoder, targetView) {
      for (const renderPassConfig of intermediateRenderPasses) {
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
      finalPass.setPipeline(pipelines[16]!)
      finalPass.setBindGroup(0, bindGroups.get(passBindingIndices[16]!.join(','))!)
      finalPass.draw(3)
      finalPass.end()
    },
  }
}
