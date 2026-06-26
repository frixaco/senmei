//!DESC Anime4K-v3.2-AutoDownscalePre-x4
//!HOOK MAIN
//!BIND HOOKED
//!BIND NATIVE
//!WHEN OUTPUT.w NATIVE.w / 4.0 < OUTPUT.h NATIVE.h / 4.0 < * OUTPUT.w NATIVE.w / 2.4 > OUTPUT.h NATIVE.h / 2.4 > * *
//!WIDTH OUTPUT.w 2 /
//!HEIGHT OUTPUT.h 2 /
export const whenF: When = ({ native, output }) =>
  output.width / native.width < 4.0 &&
  output.height / native.height < 4.0 &&
  output.width / native.width > 2.4 &&
  output.height / native.height > 2.4;

type Size = {
  width: number;
  height: number;
};

type When = (sizes: { native: Size; output: Size }) => boolean;

const fragShared = /* wgsl */ `
@group(0) @binding(0) var frame: texture_2d<f32>;
@group(0) @binding(1) var frame_sampler: sampler;

fn tex_at(tex: texture_2d<f32>, base_pos: vec4f) -> vec4f {
  let dims = vec2f(textureDimensions(tex));
  let uv = base_pos.xy / dims;
  return textureSampleLevel(tex, frame_sampler, uv, 0.0);
}
`;

export const fragF = /* wgsl */ `
${fragShared}

@fragment
fn f(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  return tex_at(frame, pos);
}
`;
