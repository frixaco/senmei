import { setupPlaceholderStage } from './shared.ts'
import type { PipelineStage } from './shared.ts'

export function setupStage3(
  _device: GPUDevice,
  inputTexture: GPUTexture,
  _sampler: GPUSampler,
): PipelineStage {
  return setupPlaceholderStage(inputTexture, 'Stage 3 Anime4K_Upscale_CNN_x2_VL')
}
