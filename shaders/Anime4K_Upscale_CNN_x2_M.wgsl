// WGSL single-pass learning scaffold.
//
// Edit this file to learn porting from Anime4K GLSL to WGSL.
// Start with todo_custom_pass().

struct Params {
  // 1 / image width, 1 / image height
  inv_size: vec2f,

  // 0 = passthrough, 1 = clamp highlights starter, 2 = TODO custom pass
  pass_id: u32,

  // 0 = normal output, 1 = abs(after - before)
  show_diff: u32,

  // Used by clamp_highlights_starter
  clamp_threshold: f32,
  clamp_strength: f32,

  // Uniform padding for 16-byte alignment
  _pad0: vec2f,
};

struct VSOut {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

@group(0) @binding(0) var input_sampler: sampler;
@group(0) @binding(1) var input_tex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: Params;

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> VSOut {
  // Full-screen triangle. Avoids a vertex buffer.
  var pos = array<vec2f, 3>(
    vec2f(-1.0, -1.0),
    vec2f( 3.0, -1.0),
    vec2f(-1.0,  3.0),
  );

  let p = pos[vid];

  var out: VSOut;
  out.position = vec4f(p, 0.0, 1.0);
  out.uv = p * 0.5 + vec2f(0.5, 0.5);
  return out;
}

// Equivalent idea to: MAIN_tex(MAIN_pos)
fn sample_main(uv: vec2f) -> vec4f {
  return textureSample(input_tex, input_sampler, uv);
}

// Equivalent idea to: MAIN_texOff(vec2(dx, dy))
fn sample_main_off(uv: vec2f, dx: f32, dy: f32) -> vec4f {
  let uv_off = uv + vec2f(dx, dy) * params.inv_size;
  return textureSample(input_tex, input_sampler, uv_off);
}

// Not Anime4K-accurate. Just a visible starter effect.
fn clamp_highlights_starter(color: vec4f) -> vec4f {
  let luma = dot(color.rgb, vec3f(0.299, 0.587, 0.114));
  let over = max(luma - params.clamp_threshold, 0.0);
  let new_luma = max(luma - over * params.clamp_strength, 0.0);

  var rgb = color.rgb;
  if (luma > 1e-6) {
    rgb = rgb * (new_luma / luma);
  }

  return vec4f(clamp(rgb, vec3f(0.0), vec3f(1.0)), color.a);
}

// === YOUR PORT SLOT ===
// Put one GLSL pass here.
// Suggested first target: Anime4K_Clamp_Highlights.glsl
//
// Porting map:
// - MAIN_tex(MAIN_pos)              -> sample_main(uv)
// - MAIN_texOff(vec2(dx,dy))        -> sample_main_off(uv, dx, dy)
// - vec4                            -> vec4f
// - mat4                            -> mat4x4f
// - max(a, 0.0)                     -> max(a, 0.0)
//
// If a pass needs bound temp textures, add more @binding slots
// and sample those textures in this function.
fn todo_custom_pass(uv: vec2f, color: vec4f) -> vec4f {
  // Tiny example showing neighbor access:
  // let left = sample_main_off(uv, -1.0, 0.0);
  // return vec4f((color.rgb + left.rgb) * 0.5, color.a);

  // Keep passthrough until you replace with your real port:
  return color;
}

fn run_selected_pass(uv: vec2f, src: vec4f) -> vec4f {
  switch params.pass_id {
    case 0u: {
      return src;
    }
    case 1u: {
      return clamp_highlights_starter(src);
    }
    case 2u: {
      return todo_custom_pass(uv, src);
    }
    default: {
      return src;
    }
  }
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4f {
  let src = sample_main(in.uv);
  let out_color = run_selected_pass(in.uv, src);

  if (params.show_diff == 1u) {
    return vec4f(abs(out_color.rgb - src.rgb), 1.0);
  }

  return out_color;
}
