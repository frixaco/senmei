//!HOOK MAIN
//!BIND HOOKED
//!SAVE STATSMAX
//!COMPONENTS 1
const fragSharedP1 = /* wgsl */`
@group(0) @binding(0) var frame: texture_2d<f32>;
@group(0) @binding(1) var frame_sampler: sampler;

const KERNELSIZE: i32 = 5;
const KERNELHALFSIZE: i32 = 2;

fn tex_off(tex: texture_2d<f32>, base_pos: vec4f, x_off: i32, y_off: i32) -> vec4f {
  let dims = vec2f(textureDimensions(tex));
  let pt = vec2f(1.0) / dims;
  let uv = base_pos.xy * pt + vec2f(f32(x_off), f32(y_off)) * pt;
  return textureSampleLevel(tex, frame_sampler, uv, 0.0);
}

fn get_luma(rgba: vec4f) -> f32 {
  return dot(rgba, vec4f(0.299, 0.587, 0.114, 0.0));
}
`

export const fragP1 = /* wgsl */`
${fragSharedP1}

@fragment
fn f(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  var gmax = 0.0;

  for (var i: i32 = 0; i < KERNELSIZE; i += 1) {
    let g = get_luma(tex_off(frame, pos, i - KERNELHALFSIZE, 0));
    gmax = max(g, gmax);
  }

  return vec4f(gmax, 0.0, 0.0, 0.0);
}
`

//!HOOK MAIN
//!BIND HOOKED
//!BIND STATSMAX
//!SAVE STATSMAX
//!COMPONENTS 1
const fragSharedP2P3 = /* wgsl */`
@group(0) @binding(0) var frame: texture_2d<f32>;
@group(0) @binding(1) var frame_sampler: sampler;
@group(0) @binding(2) var stats_max: texture_2d<f32>;

const KERNELSIZE: i32 = 5;
const KERNELHALFSIZE: i32 = 2;

fn tex_off(tex: texture_2d<f32>, base_pos: vec4f, x_off: i32, y_off: i32) -> vec4f {
  let dims = vec2f(textureDimensions(tex));
  let pt = vec2f(1.0) / dims;
  let uv = base_pos.xy * pt + vec2f(f32(x_off), f32(y_off)) * pt;
  return textureSampleLevel(tex, frame_sampler, uv, 0.0);
}

fn tex_at(tex: texture_2d<f32>, base_pos: vec4f) -> vec4f {
  let dims = vec2f(textureDimensions(tex));
  let uv = base_pos.xy / dims;
  return textureSampleLevel(tex, frame_sampler, uv, 0.0);
}

fn get_luma(rgba: vec4f) -> f32 {
  return dot(rgba, vec4f(0.299, 0.587, 0.114, 0.0));
}
`

export const fragP2 = /* wgsl */`
${fragSharedP2P3}

@fragment
fn f(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  var gmax = 0.0;

  for (var i: i32 = 0; i < KERNELSIZE; i += 1) {
    let g = tex_off(stats_max, pos, 0, i - KERNELHALFSIZE).x;
    gmax = max(g, gmax);
  }

  return vec4f(gmax, 0.0, 0.0, 0.0);
}
`

//!HOOK PREKERNEL
//!BIND HOOKED
//!BIND STATSMAX
export const fragP3 = /* wgsl */`
${fragSharedP2P3}

@fragment
fn f(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let current = tex_at(frame, pos);
  let current_luma = get_luma(current);
  let new_luma = min(current_luma, tex_at(stats_max, pos).x);
  let delta = current_luma - new_luma;

  return current - vec4f(delta);
}
`
