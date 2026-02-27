//!HOOK MAIN
//!BIND HOOKED
//!BIND NATIVE
//!WHEN OUTPUT.w NATIVE.w / 2.0 < OUTPUT.h NATIVE.h / 2.0 < * OUTPUT.w NATIVE.w / 1.2 > OUTPUT.h NATIVE.h / 1.2 > * *
//!WIDTH OUTPUT.w
//!HEIGHT OUTPUT.h
const fragShared = /* wgsl */ `
@group(0) @binding(0) var frame: texture_2d<f32>;
@group(0) @binding(1) var frame_sampler: sampler;

fn tex_at(tex: texture_2d<f32>, base_pos: vec4f) -> vec4f {
  let dims = vec2f(textureDimensions(tex));
  let uv = base_pos.xy / dims;
  return textureSampleLevel(tex, frame_sampler, uv, 0.0);
}
`

export const fragF = /* wgsl */ `
${fragShared}

@fragment
fn f(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  return tex_at(frame, pos);
}
`
