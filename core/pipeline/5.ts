import { setupPlaceholderStage } from './shared.ts'
import type { PipelineStage } from './shared.ts'

export function setupStage5(
  _device: GPUDevice,
  inputTexture: GPUTexture,
  _sampler: GPUSampler,
): PipelineStage {
  return setupPlaceholderStage(inputTexture, 'Stage 5 Anime4K_AutoDownscalePre_x4')
}
