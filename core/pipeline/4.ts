import { fragF, whenF } from '../shaders/Anime4K_AutoDownscalePre_x2.ts'
import {
  buildWhenContext,
  createTexture,
  evaluateWhenExpression,
  vertexShader,
} from './shared.ts'
import type { PipelineStage } from './shared.ts'
import type { WhenReferenceDimensions } from './shared.ts'

export function setupStage4(
  device: GPUDevice,
  inputTexture: GPUTexture,
  sampler: GPUSampler,
  whenReference: WhenReferenceDimensions,
): PipelineStage {
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
    inputTexture.width,
    inputTexture.height,
    'stage4 Anime4K_AutoDownscalePre_x2 output',
  )

  const moduleV = device.createShaderModule({
    label: 'stage4 vertex shader',
    code: vertexShader,
  })
  const moduleF = device.createShaderModule({
    label: 'stage4 fragment shader',
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
        sampler: { type: 'filtering' },
      },
    ],
  })
  const pipelineLayout = device.createPipelineLayout({
    bindGroupLayouts: [bindGroupLayout],
  })

  const pipeline = device.createRenderPipeline({
    label: 'stage4 Anime4K_AutoDownscalePre_x2',
    layout: pipelineLayout,
    vertex: {
      module: moduleV,
      entryPoint: 'v',
    },
    fragment: {
      module: moduleF,
      entryPoint: 'f',
      targets: [{ format: 'rgba8unorm' }],
    },
  })

  const bindGroup = device.createBindGroup({
    label: 'stage4 bind group',
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
    encode(encoder, targetView) {
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: targetView ?? outputView,
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
