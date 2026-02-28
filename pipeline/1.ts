import {
  fragP1,
  fragP2,
  fragP3,
} from '../shaders/Anime4K_Clamp_Highlights.ts'
import { createTexture, vertexShader } from './shared.ts'
import type { PipelineStage } from './shared.ts'

interface Anime4KClampHighlightsShaders {
  fragP1: string
  fragP2: string
  fragP3: string
}

function createStatsTexture(
  device: GPUDevice,
  width: number,
  height: number,
  label: string,
): GPUTexture {
  return device.createTexture({
    label,
    format: 'r32float',
    size: [width, height],
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
  })
}

function setupAnime4KClampHighlightsStage(
  device: GPUDevice,
  inputTexture: GPUTexture,
  sampler: GPUSampler,
  shaders: Anime4KClampHighlightsShaders,
  stageLabel: string,
): PipelineStage {
  const workingFormat: GPUTextureFormat = 'rgba32float'
  const w = inputTexture.width
  const h = inputTexture.height

  const statsMaxA = createStatsTexture(device, w, h, `${stageLabel} statsMaxA`)
  const statsMaxB = createStatsTexture(device, w, h, `${stageLabel} statsMaxB`)
  const outputTexture = createTexture(device, w, h, `${stageLabel} output`, workingFormat)

  const inputView = inputTexture.createView()
  const statsMaxAView = statsMaxA.createView()
  const statsMaxBView = statsMaxB.createView()
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
  }

  const createBindGroupLayout = (
    numTextures: number,
    statsSampleType: GPUTextureSampleType = 'float',
  ) =>
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
          sampler: { type: 'non-filtering' as const },
        },
        ...Array.from({ length: numTextures }, (_, i) => ({
          binding: i + 2,
          visibility: GPUShaderStage.FRAGMENT,
          texture: {
            sampleType: i === 0 ? statsSampleType : ('float' as const),
          },
        })),
      ],
    })

  const bindGroupLayouts = [
    createBindGroupLayout(0),
    createBindGroupLayout(1, 'unfilterable-float'),
  ]

  const pipelineLayouts = bindGroupLayouts.map((bindGroupLayout) =>
    device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
  )

  const createPipeline = (
    fragmentModule: GPUShaderModule,
    layout: GPUPipelineLayout,
    label: string,
    targetFormat: GPUTextureFormat = workingFormat,
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
        targets: [{ format: targetFormat }],
      },
    })

  const pipelines = {
    p1: createPipeline(
      fragmentModules.p1,
      pipelineLayouts[0]!,
      `${stageLabel} pass 1`,
      'r32float',
    ),
    p2: createPipeline(
      fragmentModules.p2,
      pipelineLayouts[1]!,
      `${stageLabel} pass 2`,
      'r32float',
    ),
    p3: createPipeline(fragmentModules.p3, pipelineLayouts[1]!, `${stageLabel} pass 3`),
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
    { binding: 2, resource: statsMaxAView },
  ])
  const bindGroupPass3 = createBindGroup(bindGroupLayouts[1]!, [
    { binding: 0, resource: inputView },
    { binding: 1, resource: sampler },
    { binding: 2, resource: statsMaxBView },
  ])

  return {
    outputTexture,
    encode(encoder, targetView) {
      const pass1 = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: statsMaxAView,
            loadOp: 'clear' as const,
            storeOp: 'store' as const,
          },
        ],
      })
      pass1.setPipeline(pipelines.p1)
      pass1.setBindGroup(0, bindGroupPass1)
      pass1.draw(3)
      pass1.end()

      const pass2 = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: statsMaxBView,
            loadOp: 'clear' as const,
            storeOp: 'store' as const,
          },
        ],
      })
      pass2.setPipeline(pipelines.p2)
      pass2.setBindGroup(0, bindGroupPass2)
      pass2.draw(3)
      pass2.end()

      const pass3 = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: targetView ?? outputView,
            loadOp: 'clear' as const,
            storeOp: 'store' as const,
          },
        ],
      })
      pass3.setPipeline(pipelines.p3)
      pass3.setBindGroup(0, bindGroupPass3)
      pass3.draw(3)
      pass3.end()
    },
  }
}

export function setupStage1(
  device: GPUDevice,
  inputTexture: GPUTexture,
  sampler: GPUSampler,
): PipelineStage {
  return setupAnime4KClampHighlightsStage(
    device,
    inputTexture,
    sampler,
    {
      fragP1,
      fragP2,
      fragP3,
    },
    'stage1 Anime4K_Clamp_Highlights',
  )
}
