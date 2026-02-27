/**
 * WORK IN PROGRESS, NEED TO FIGURE HOW TO DEAL WITH !HOOK DIRECTIVES
 */

export const vertexShader = /* wgsl */`
struct VSOut {
	@builtin(position) pos: vec4f,
}

@vertex
fn v(@builtin(vertex_index) vertexIndex: u32) -> VSOut {
	let pos = array (
		vec2f(-1, 1),
		vec2f(4, 1),
		vec2f(-1, -4),
	);
	let p = pos[vertexIndex];
	var out: VSOut;
	out.pos = vec4f(p, 0, 1);
	return out;
}
`

const fragShared = /* wgsl */`
@group(0) @binding(0) var frame: texture_2d<f32>;
@group(0) @binding(1) var frame_sampler: sampler;

@group(0) @binding(2) var conv2d_tf: texture_2d<f32>;
@group(0) @binding(3) var conv2d_tf_1: texture_2d<f32>;
@group(0) @binding(4) var conv2d_tf_2: texture_2d<f32>;
@group(0) @binding(5) var conv2d_tf_3: texture_2d<f32>;
@group(0) @binding(6) var conv2d_tf_4: texture_2d<f32>;
@group(0) @binding(7) var conv2d_tf_5: texture_2d<f32>;
@group(0) @binding(8) var conv2d_tf_6: texture_2d<f32>;
@group(0) @binding(9) var conv2d_tf_last: texture_2d<f32>;

fn tex_off(tex: texture_2d<f32>, base_pos: vec4f, x_off: f32, y_off: f32) -> vec4f {
	let dims = vec2f(textureDimensions(tex));
	let pt = vec2f(1.0) / dims;
	// Potential inconsistency vs mpv MAIN_texOff: exact border behavior still depends on frame_sampler
	// address/filter mode and whether base_pos.xy maps to the same pixel-center convention as MAIN_pos.
	let uv = base_pos.xy * pt + vec2f(x_off, y_off) * pt;
	return textureSampleLevel(tex, frame_sampler, uv, 0.0);
}
`

//!HOOK MAIN
//!BIND HOOKED
//!BIND NATIVE
//!WHEN OUTPUT.w NATIVE.w / 2.0 < OUTPUT.h NATIVE.h / 2.0 < * OUTPUT.w NATIVE.w / 1.2 > OUTPUT.h NATIVE.h / 1.2 > * *
//!WIDTH OUTPUT.w
//!HEIGHT OUTPUT.h
export const fragF = /* wgsl */`
${fragShared}
@fragment
fn f(@builtin(position) pos: vec4f) -> @location(0) vec4f {
	return HOOKED_tex(HOOKED_pos);
}
`
