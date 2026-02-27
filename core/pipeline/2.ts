import { setupPlaceholderStage } from './shared.ts'
import type { PipelineStage } from './shared.ts'

export function setupStage2(
  _device: GPUDevice,
  inputTexture: GPUTexture,
  _sampler: GPUSampler,
): PipelineStage {
  return setupPlaceholderStage(inputTexture, 'Stage 2 Anime4K_Restore_CNN_VL')
}
