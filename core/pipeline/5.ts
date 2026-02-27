import { fragF, whenF } from '../shaders/Anime4K_AutoDownscalePre_x4.ts'
import {
  buildWhenContext,
  createTexture,
  evaluateWhenExpression,
  vertexShader,
} from './shared.ts'
import type { PipelineStage } from './shared.ts'
import type { WhenReferenceDimensions } from './shared.ts'

export function setupStage5(
  device: GPUDevice,
  inputTexture: GPUTexture,
  sampler: GPUSampler,
  whenReference: WhenReferenceDimensions,
): PipelineStage {
  const workingFormat: GPUTextureFormat = 'rgba16float'
  const shouldRun = evaluateWhenExpression(
    whenF,
    buildWhenContext(
      { w: inputTexture.width, h: inputTexture.height },
      whenReference,
    ),
  )

  if (!shouldRun) {
    return {
      outputTexture: inputTexture,
      encode() {},
    }
  }

  const outputTexture = createTexture(
    device,
    Math.max(1, Math.floor(inputTexture.width / 2)),
    Math.max(1, Math.floor(inputTexture.height / 2)),
    'stage5 Anime4K_AutoDownscalePre_x4 output',
    workingFormat,
  )

  const moduleV = device.createShaderModule({
    label: 'stage5 vertex shader',
    code: vertexShader,
  })
  const moduleF = device.createShaderModule({
    label: 'stage5 fragment shader',
    code: fragF,
  })

  const bindGroupLayout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: 'float' },
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
    label: 'stage5 Anime4K_AutoDownscalePre_x4',
    layout: pipelineLayout,
    vertex: {
      module: moduleV,
      entryPoint: 'v',
    },
    fragment: {
      module: moduleF,
      entryPoint: 'f',
      targets: [{ format: workingFormat }],
    },
  })

  const bindGroup = device.createBindGroup({
    label: 'stage5 bind group',
    layout: bindGroupLayout,
    entries: [
      {
        binding: 0,
        resource: inputTexture.createView(),
      },
      {
        binding: 1,
        resource: sampler,
      },
    ],
  })

  const outputView = outputTexture.createView()

  return {
    outputTexture,
    encode(encoder) {
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: outputView,
            loadOp: 'clear',
            storeOp: 'store',
          },
        ],
      })
      pass.setPipeline(pipeline)
      pass.setBindGroup(0, bindGroup)
      pass.draw(3)
      pass.end()
    },
  }
}
