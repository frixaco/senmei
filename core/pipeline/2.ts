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

const bindTextureCounts = [0, 2, 4, 6, 8, 10, 12, 14, 16] as const

const passTextureCounts = [
  0, 0, 2, 2, 4, 4, 6, 6, 8, 8, 10, 10, 12, 12, 14, 14, 16,
] as const

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
  const w = inputTexture.width
  const h = inputTexture.height

  const intermediateTextures = [
    createTexture(device, w, h, `${stageLabel} conv2d_tf`),
    createTexture(device, w, h, `${stageLabel} conv2d_tf1`),
    createTexture(device, w, h, `${stageLabel} conv2d_1_tf`),
    createTexture(device, w, h, `${stageLabel} conv2d_1_tf1`),
    createTexture(device, w, h, `${stageLabel} conv2d_2_tf`),
    createTexture(device, w, h, `${stageLabel} conv2d_2_tf1`),
    createTexture(device, w, h, `${stageLabel} conv2d_3_tf`),
    createTexture(device, w, h, `${stageLabel} conv2d_3_tf1`),
    createTexture(device, w, h, `${stageLabel} conv2d_4_tf`),
    createTexture(device, w, h, `${stageLabel} conv2d_4_tf1`),
    createTexture(device, w, h, `${stageLabel} conv2d_5_tf`),
    createTexture(device, w, h, `${stageLabel} conv2d_5_tf1`),
    createTexture(device, w, h, `${stageLabel} conv2d_6_tf`),
    createTexture(device, w, h, `${stageLabel} conv2d_6_tf1`),
    createTexture(device, w, h, `${stageLabel} conv2d_7_tf`),
    createTexture(device, w, h, `${stageLabel} conv2d_7_tf1`),
  ]

  const outputTexture = createTexture(device, w, h, `${stageLabel} output`)

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
        ...Array.from({ length: numTextures }, (_, index) => ({
          binding: index + 2,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'float' as const },
        })),
      ],
    })

  const bindGroupLayouts = new Map<number, GPUBindGroupLayout>()
  const pipelineLayouts = new Map<number, GPUPipelineLayout>()
  const bindGroups = new Map<number, GPUBindGroup>()

  for (const count of bindTextureCounts) {
    const bindGroupLayout = createBindGroupLayout(count)
    bindGroupLayouts.set(count, bindGroupLayout)
    pipelineLayouts.set(
      count,
      device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
    )
    bindGroups.set(
      count,
      device.createBindGroup({
        label: `${stageLabel} bind group ${count}`,
        layout: bindGroupLayout,
        entries: [
          { binding: 0, resource: inputView },
          { binding: 1, resource: sampler },
          ...intermediateViews.slice(0, count).map((view, index) => ({
            binding: index + 2,
            resource: view,
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
        targets: [{ format: 'rgba8unorm' }],
      },
    })

  const pipelines = fragmentModules.map((fragmentModule, index) =>
    createPipeline(
      fragmentModule,
      pipelineLayouts.get(passTextureCounts[index]!)!,
      `${stageLabel} pass ${index + 1}`,
    ),
  )

  const intermediateRenderPasses = intermediateViews.map((view, index) => ({
    view,
    pipeline: pipelines[index]!,
    bindGroup: bindGroups.get(passTextureCounts[index]!)!,
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
      finalPass.setBindGroup(0, bindGroups.get(16))
      finalPass.draw(3)
      finalPass.end()
    },
  }
}
