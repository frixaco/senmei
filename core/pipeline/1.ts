import { setupPlaceholderStage } from './shared.ts'
import type { PipelineStage } from './shared.ts'

export function setupStage1(
  _device: GPUDevice,
  inputTexture: GPUTexture,
  _sampler: GPUSampler,
): PipelineStage {
  return setupPlaceholderStage(inputTexture, 'Stage 1 Anime4K_Clamp_Highlights')
}
