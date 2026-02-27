export interface PipelineStage {
  outputTexture: GPUTexture
  encode: (encoder: GPUCommandEncoder, targetView?: GPUTextureView) => void
}

export const vertexShader = /* wgsl */ `
struct VSOut {
  @builtin(position) pos: vec4f,
}

@vertex
fn v(@builtin(vertex_index) vertexIndex: u32) -> VSOut {
  let pos = array(
    vec2f(-1, 1),
    vec2f(4, 1),
    vec2f(-1, -4),
  );
  var out: VSOut;
  out.pos = vec4f(pos[vertexIndex], 0, 1);
  return out;
}
`

export function createTexture(
  device: GPUDevice,
  width: number,
  height: number,
  label: string,
): GPUTexture {
  return device.createTexture({
    label,
    format: 'rgba8unorm',
    size: [width, height],
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
  })
}

export function setupPlaceholderStage(
  inputTexture: GPUTexture,
  stageName: string,
): PipelineStage {
  return {
    outputTexture: inputTexture,
    encode() {
      console.warn(
        `${stageName} is a placeholder stage and is currently bypassed.`,
      )
    },
  }
}
