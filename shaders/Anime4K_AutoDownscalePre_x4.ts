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
`;

export const fragF = /* wgsl */ `
${fragShared}

@fragment
fn f(@location(0) uv: vec2f) -> @location(0) vec4f {
  return textureSampleLevel(frame, frame_sampler, uv, 0.0);
}
`;
