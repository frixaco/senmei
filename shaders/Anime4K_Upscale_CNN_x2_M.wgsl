struct VSOut {
	@builtin(position) pos: vec4f,
	// @location(0) input: vec2f,
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
	// out.input = p * vec2f(0.5, -0.5) + vec2f(0.5, 0.5);
	return out;
}

@group(0) @binding(0) var frame: texture_2d<f32>;
@group(0) @binding(1) var frame_sampler: sampler;

@fragment
// @location - render target
fn f(input: VSOut) ->  @location(0) vec4f {
	return pass1(input.pos);
}


fn go_0_pass1(frag_pos: vec4f, x_off: i32, y_off: i32) -> vec4f {
	let dims = vec2f(textureDimensions(frame));
	let pt = vec2f(1.0) / dims;
	// Potential inconsistency vs mpv MAIN_texOff: exact border behavior still depends on frame_sampler
        // address/filter mode and whether frag_pos.xy maps to the same pixel-center convention as MAIN_pos.
        let uv = frag_pos.xy * pt + vec2f(f32(x_off), f32(y_off)) * pt;
        return textureSampleLevel(frame, frame_sampler, uv, 0.0);
}

fn go_0_pass2(frag_pos: vec4f, x_off: i32, y_off: i32) -> vec4f {
	let dims = vec2f(textureDimensions(frame));
	let pt = vec2f(1.0) / dims;
	// Potential inconsistency vs mpv MAIN_texOff: exact border behavior still depends on frame_sampler
        // address/filter mode and whether frag_pos.xy maps to the same pixel-center convention as MAIN_pos.
        let uv = frag_pos.xy * pt + vec2f(f32(x_off), f32(y_off)) * pt;
        return textureSampleLevel(frame, frame_sampler, uv, 0.0);
}

fn go_1_pass2(frag_pos: vec4f, x_off: i32, y_off: i32) -> vec4f {
	let dims = vec2f(textureDimensions(frame));
	let pt = vec2f(1.0) / dims;
	// Potential inconsistency vs mpv MAIN_texOff: exact border behavior still depends on frame_sampler
        // address/filter mode and whether frag_pos.xy maps to the same pixel-center convention as MAIN_pos.
        let uv = frag_pos.xy * pt + vec2f(f32(x_off), f32(y_off)) * pt;
        return textureSampleLevel(frame, frame_sampler, uv, 0.0);
}

fn go_0_pass3(frag_pos: vec4f, x_off: i32, y_off: i32) -> vec4f {
	let dims = vec2f(textureDimensions(frame));
	let pt = vec2f(1.0) / dims;
	// Potential inconsistency vs mpv MAIN_texOff: exact border behavior still depends on frame_sampler
        // address/filter mode and whether frag_pos.xy maps to the same pixel-center convention as MAIN_pos.
        let uv = frag_pos.xy * pt + vec2f(f32(x_off), f32(y_off)) * pt;
        return textureSampleLevel(frame, frame_sampler, uv, 0.0);
}

fn go_1_pass3(frag_pos: vec4f, x_off: i32, y_off: i32) -> vec4f {
	let dims = vec2f(textureDimensions(frame));
	let pt = vec2f(1.0) / dims;
	// Potential inconsistency vs mpv MAIN_texOff: exact border behavior still depends on frame_sampler
        // address/filter mode and whether frag_pos.xy maps to the same pixel-center convention as MAIN_pos.
        let uv = frag_pos.xy * pt + vec2f(f32(x_off), f32(y_off)) * pt;
        return textureSampleLevel(frame, frame_sampler, uv, 0.0);
}

fn go_0_pass4(frag_pos: vec4f, x_off: i32, y_off: i32) -> vec4f {
	let dims = vec2f(textureDimensions(frame));
	let pt = vec2f(1.0) / dims;
	// Potential inconsistency vs mpv MAIN_texOff: exact border behavior still depends on frame_sampler
        // address/filter mode and whether frag_pos.xy maps to the same pixel-center convention as MAIN_pos.
        let uv = frag_pos.xy * pt + vec2f(f32(x_off), f32(y_off)) * pt;
        return textureSampleLevel(frame, frame_sampler, uv, 0.0);
}

fn go_1_pass4(frag_pos: vec4f, x_off: i32, y_off: i32) -> vec4f {
	let dims = vec2f(textureDimensions(frame));
	let pt = vec2f(1.0) / dims;
	// Potential inconsistency vs mpv MAIN_texOff: exact border behavior still depends on frame_sampler
        // address/filter mode and whether frag_pos.xy maps to the same pixel-center convention as MAIN_pos.
        let uv = frag_pos.xy * pt + vec2f(f32(x_off), f32(y_off)) * pt;
        return textureSampleLevel(frame, frame_sampler, uv, 0.0);
}

fn go_0_pass5(frag_pos: vec4f, x_off: i32, y_off: i32) -> vec4f {
	let dims = vec2f(textureDimensions(frame));
	let pt = vec2f(1.0) / dims;
	// Potential inconsistency vs mpv MAIN_texOff: exact border behavior still depends on frame_sampler
        // address/filter mode and whether frag_pos.xy maps to the same pixel-center convention as MAIN_pos.
        let uv = frag_pos.xy * pt + vec2f(f32(x_off), f32(y_off)) * pt;
        return textureSampleLevel(frame, frame_sampler, uv, 0.0);
}

fn go_1_pass5(frag_pos: vec4f, x_off: i32, y_off: i32) -> vec4f {
	let dims = vec2f(textureDimensions(frame));
	let pt = vec2f(1.0) / dims;
	// Potential inconsistency vs mpv MAIN_texOff: exact border behavior still depends on frame_sampler
        // address/filter mode and whether frag_pos.xy maps to the same pixel-center convention as MAIN_pos.
        let uv = frag_pos.xy * pt + vec2f(f32(x_off), f32(y_off)) * pt;
        return textureSampleLevel(frame, frame_sampler, uv, 0.0);
}

fn go_0_pass6(frag_pos: vec4f, x_off: i32, y_off: i32) -> vec4f {
	let dims = vec2f(textureDimensions(frame));
	let pt = vec2f(1.0) / dims;
	// Potential inconsistency vs mpv MAIN_texOff: exact border behavior still depends on frame_sampler
        // address/filter mode and whether frag_pos.xy maps to the same pixel-center convention as MAIN_pos.
        let uv = frag_pos.xy * pt + vec2f(f32(x_off), f32(y_off)) * pt;
        return textureSampleLevel(frame, frame_sampler, uv, 0.0);
}

fn go_1_pass6(frag_pos: vec4f, x_off: i32, y_off: i32) -> vec4f {
	let dims = vec2f(textureDimensions(frame));
	let pt = vec2f(1.0) / dims;
	// Potential inconsistency vs mpv MAIN_texOff: exact border behavior still depends on frame_sampler
        // address/filter mode and whether frag_pos.xy maps to the same pixel-center convention as MAIN_pos.
        let uv = frag_pos.xy * pt + vec2f(f32(x_off), f32(y_off)) * pt;
        return textureSampleLevel(frame, frame_sampler, uv, 0.0);
}

fn go_0_pass7(frag_pos: vec4f, x_off: i32, y_off: i32) -> vec4f {
	let dims = vec2f(textureDimensions(frame));
	let pt = vec2f(1.0) / dims;
	// Potential inconsistency vs mpv MAIN_texOff: exact border behavior still depends on frame_sampler
        // address/filter mode and whether frag_pos.xy maps to the same pixel-center convention as MAIN_pos.
        let uv = frag_pos.xy * pt + vec2f(f32(x_off), f32(y_off)) * pt;
        return textureSampleLevel(frame, frame_sampler, uv, 0.0);
}

fn go_1_pass7(frag_pos: vec4f, x_off: i32, y_off: i32) -> vec4f {
	let dims = vec2f(textureDimensions(frame));
	let pt = vec2f(1.0) / dims;
	// Potential inconsistency vs mpv MAIN_texOff: exact border behavior still depends on frame_sampler
        // address/filter mode and whether frag_pos.xy maps to the same pixel-center convention as MAIN_pos.
        let uv = frag_pos.xy * pt + vec2f(f32(x_off), f32(y_off)) * pt;
        return textureSampleLevel(frame, frame_sampler, uv, 0.0);
}

fn pass1(pos: vec4f) -> vec4f {
	var result = mat4x4f(-0.010995803, 0.077095956, -0.043992598, 0.06048717, 0.1164834, -0.11689607, 0.072985925, -0.078805886, 0.01182932, 0.054985743, -0.09018186, 0.044907484, 0.0, 0.0, 0.0, 0.0) * go_0_pass1(pos, -1, -1);
	result = result + mat4x4f(0.1813623, -0.14752422, 0.025720436, -0.17639883, 0.15697388, 0.10445984, -0.1843076, 0.5264643, 0.047516696, -0.097305484, 0.09740847, -0.29619336, 0.0, 0.0, 0.0, 0.0) * go_0_pass1(pos, -1, 0);
	result = result + mat4x4f(-0.014534763, 0.09486465, 0.046173926, 0.039391946, 0.09609376, -0.060574662, 0.042200956, -0.3269777, 0.051006425, 0.059818447, 0.04366627, 0.17699827, 0.0, 0.0, 0.0, 0.0) * go_0_pass1(pos, -1, 1);
	result = result + mat4x4f(0.04268535, -0.08152529, 0.10577459, -0.036936995, -0.051562306, 0.054872766, 0.09194519, 0.0025066638, -0.01073954, 0.00064474024, 0.10038221, 0.02131141, 0.0, 0.0, 0.0, 0.0) * go_0_pass1(pos, 0, -1);
	result = result + mat4x4f(-0.51751363, -0.40028602, 0.3469574, 0.5933738, -0.91357684, -0.67692596, 0.57815677, 0.39809322, -0.16341521, -0.27169713, 0.12232366, 0.4318641, 0.0, 0.0, 0.0, 0.0) * go_0_pass1(pos, 0, 0);
	result = result + mat4x4f(0.12601124, -0.06263236, -0.45907676, -0.41514075, 0.3330334, -0.1929565, -0.6333532, -0.6552794, -0.045809917, 0.046351526, -0.26173338, -0.30252662, 0.0, 0.0, 0.0, 0.0) * go_0_pass1(pos, 0, 1);
	result = result + mat4x4f(0.0030332592, 0.012103107, 0.010537323, -0.02038607, 0.095558085, 0.097704545, 0.083433494, 0.026790185, 0.01943357, -0.061712462, -0.00015703632, -0.032268334, 0.0, 0.0, 0.0, 0.0) * go_0_pass1(pos, 1, -1);
	result = result + mat4x4f(0.016870102, 0.5215812, -0.11525501, 0.027527615, -0.09045733, 0.61310345, -0.1575268, 0.1905386, 0.020172214, 0.3503187, -0.08209157, -0.051328037, 0.0, 0.0, 0.0, 0.0) * go_0_pass1(pos, 1, 0);
	result = result + mat4x4f(0.005494087, -0.010656317, 0.07682753, -0.08116042, -0.03934524, 0.16589017, 0.101483546, -0.066603065, 0.03494657, -0.07885597, 0.074227594, 0.0016264897, 0.0, 0.0, 0.0, 0.0) * go_0_pass1(pos, 1, 1);
	result = result + vec4f(0.014463938, -0.0031906287, 0.007015422, -0.003888468);

	return result;
}


fn pass_2() -> vec4f {
return vec4f(1, 0, 0, 1);
}


fn pass_3() -> vec4f {
	return vec4f(1, 0, 0, 1);
}


fn pass_4() -> vec4f {
	return vec4f(1, 0, 0, 1);
}


fn pass_5() -> vec4f {
	return vec4f(1, 0, 0, 1);
}


fn pass_6() -> vec4f {
	return vec4f(1, 0, 0, 1);
}


fn pass_7() -> vec4f {
	return vec4f(1, 0, 0, 1);
}


fn pass_8() -> vec4f {
	return vec4f(1, 0, 0, 1);
}


fn pass_9() -> vec4f {
	return vec4f(1, 0, 0, 1);
}


fn pass_10() -> vec4f {
	return vec4f(1, 0, 0, 1);
}


fn pass_11() -> vec4f {
	return vec4f(1, 0, 0, 1);
}


fn pass_12() -> vec4f {
	return vec4f(1, 0, 0, 1);
}


fn pass_13() -> vec4f {
	return vec4f(1, 0, 0, 1);
}


fn pass_14() -> vec4f {
	return vec4f(1, 0, 0, 1);
}


fn pass_15() -> vec4f {
	return vec4f(1, 0, 0, 1);
}


fn pass_16() -> vec4f {
	return vec4f(1, 0, 0, 1);
}


fn pass_17() -> vec4f {
	return vec4f(1, 0, 0, 1);
}


fn pass_18() -> vec4f {
	return vec4f(1, 0, 0, 1);
}
