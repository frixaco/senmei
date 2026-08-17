//!DESC Anime4K-v4.0-AutoDownscalePre-x2
//!HOOK MAIN
//!BIND HOOKED
//!BIND NATIVE
//!WHEN OUTPUT.w NATIVE.w / 2.0 < OUTPUT.h NATIVE.h / 2.0 < * OUTPUT.w NATIVE.w / 1.2 > OUTPUT.h NATIVE.h / 1.2 > * *
//!WIDTH OUTPUT.w
//!HEIGHT OUTPUT.h
export const whenF: When = ({ native, output }) =>
  output.width / native.width < 2.0 &&
  output.height / native.height < 2.0 &&
  output.width / native.width > 1.2 &&
  output.height / native.height > 1.2;

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
