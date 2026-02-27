import { setupPlaceholderStage } from './shared.ts'
import type { PipelineStage } from './shared.ts'

export function setupStage4(
  _device: GPUDevice,
  inputTexture: GPUTexture,
  _sampler: GPUSampler,
): PipelineStage {
  return setupPlaceholderStage(inputTexture, 'Stage 4 Anime4K_AutoDownscalePre_x2')
}
