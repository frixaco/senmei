import * as autoDownscalePreX2 from "./shaders/Anime4K_AutoDownscalePre_x2.ts";
import * as autoDownscalePreX4 from "./shaders/Anime4K_AutoDownscalePre_x4.ts";
import * as clamp from "./shaders/Anime4K_Clamp_Highlights.ts";
import * as restoreVL from "./shaders/Anime4K_Restore_CNN_VL.ts";
import * as upscaleX2M from "./shaders/Anime4K_Upscale_CNN_x2_M.ts";
import * as upscaleX2VL from "./shaders/Anime4K_Upscale_CNN_x2_VL.ts";

const UPSCALE_NUMBER = 2;

const original = getElementById<HTMLImageElement>("original");
const canvas = getElementById<HTMLCanvasElement>("canvas")!;
const ctx = canvas.getContext("webgpu");

const status = getElementById<HTMLElement>("status");
const benchmarkPopup = getElementById<HTMLElement>("benchmarkPopup");
const benchmarkMeta = getElementById<HTMLElement>("benchmarkMeta");
const benchmarkCloseBtn = getElementById<HTMLButtonElement>("benchmarkCloseBtn");
const processBtn = getElementById<HTMLButtonElement>("processBtn");
const benchmarkBtn = getElementById<HTMLButtonElement>("benchmarkBtn");
const saveBtn = getElementById<HTMLButtonElement>("saveBtn");

const adapter = await navigator.gpu.requestAdapter();
if (!adapter) throw new Error("no gpu adapter");
const device = await adapter.requestDevice();

const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
if (!ctx) throw new Error("No WebGPU canvas context");
ctx.configure({
  device,
  format: canvasFormat,
  alphaMode: "opaque",
});

const sampler = device.createSampler({
  magFilter: "nearest",
  minFilter: "nearest",
  addressModeU: "clamp-to-edge",
  addressModeV: "clamp-to-edge",
});

let selectedFile: File | null = null;

status.textContent = "Pick an image";
setButtonsIdleState();

on("processBtn", "click", async () => {
  if (!selectedFile) {
    status.textContent = "Pick an image";
    return;
  }

  status.textContent = "Processing...";

  await original.decode();
  canvas.width = original.naturalWidth * UPSCALE_NUMBER;
  canvas.height = original.naturalHeight * UPSCALE_NUMBER;

  doWebGPU();

  canvas.classList.remove("hidden");

  status.textContent = `Processed ${selectedFile.name}`;
});

function doWebGPU() {
  if (!ctx) throw new Error("No WebGPU canvas context");

  const imageBitmap = original;
  const sourceSize = {
    width: imageBitmap.naturalWidth,
    height: imageBitmap.naturalHeight,
  };
  const outputSize = {
    width: canvas.width,
    height: canvas.height,
  };
  const sourceTexture = device.createTexture({
    size: sourceSize,
    format: "rgba16float",
    usage:
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.RENDER_ATTACHMENT,
  });

  device.queue.copyExternalImageToTexture(
    { source: imageBitmap },
    { texture: sourceTexture, colorSpace: "srgb", premultipliedAlpha: false },
    [imageBitmap.naturalWidth, imageBitmap.naturalHeight],
  );

  const textures = new Map<string, Texture>([
    ["MAIN", { gpu: sourceTexture, ...sourceSize }],
    ["NATIVE", { gpu: sourceTexture, ...sourceSize }],
  ]);

  for (const pass of passes) {
    if (
      pass.when &&
      !pass.when({
        main: getTexture("MAIN"),
        native: getTexture("NATIVE"),
        output: outputSize,
      })
    ) {
      continue;
    }

    const frameName = pass.textures[0];
    if (!frameName) {
      throw new Error(`Pass ${pass.name} has no binding 0 texture`);
    }

    const frameTexture = getTexture(frameName);
    let targetSize: Size = frameTexture;
    if (pass.size.from === "OUTPUT") {
      targetSize = outputSize;
    } else if (pass.size.from !== "FRAME") {
      targetSize = getTexture(pass.size.from);
    }

    const outputTexture = createOutputTexture({
      width: targetSize.width * pass.size.scale,
      height: targetSize.height * pass.size.scale,
    });

    // NOTE: pass.textures does not include sampler which is at index 1
    const textureBindings = Object.keys(pass.textures).map(Number);
    const bindGroupLayout = createBindGroupLayout(textureBindings);
    const pipeline = createPipeline(pass.shader, "rgba16float", bindGroupLayout);

    const textureEntries = textureBindings.map((binding): GPUBindGroupEntry => {
      const textureName = pass.textures[binding];
      if (!textureName) {
        throw new Error(`Pass ${pass.name} has no texture for binding ${binding}`);
      }

      return {
        binding,
        resource: getTexture(textureName).gpu.createView(),
      };
    });
    const entries: GPUBindGroupEntry[] = [
      {
        binding: 1,
        resource: sampler,
      },
      ...textureEntries,
    ];
    const bindGroup = device.createBindGroup({
      layout: bindGroupLayout,
      entries,
    });

    render(pipeline, bindGroup, outputTexture.gpu.createView());

    if (pass.save) {
      textures.set(pass.save, outputTexture);
    }
  }

  const pipeline = createPipeline(defaultFragmentShader, canvasFormat);
  const mainTexture = getTexture("MAIN");

  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      {
        binding: 0,
        resource: mainTexture.gpu.createView(),
      },
      {
        binding: 1,
        resource: sampler,
      },
    ],
  });

  render(pipeline, bindGroup, ctx.getCurrentTexture().createView());

  function getTexture(name: string): Texture {
    const texture = textures.get(name);
    if (!texture) {
      throw new Error(`Pass ${name} has not been produced yet`);
    }

    return texture;
  };
}

on("inputImg", "change", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) {
    return;
  }

  const file = target.files?.[0] ?? null;
  selectedFile = file;
  // TODO: clear
  benchmarkPopup.classList.add("hidden");
  setButtonsIdleState();

  if (!file) {
    original.removeAttribute("src");
    status.textContent = "Pick an image";
    return;
  }

  const reader = new FileReader();

  reader.onload = (loadEvent) => {
    const result = loadEvent.target?.result;
    if (typeof result !== "string") {
      return;
    }

    original.setAttribute("src", result);
    status.textContent = `Loaded: ${file.name}`;
  };

  reader.onerror = () => {
    original.removeAttribute("src");
    status.textContent = `Failed: ${reader.error?.message ?? "unable to read file"}`;
  };

  reader.readAsDataURL(file);
});

on("benchmarkBtn", "click", () => {
  if (!selectedFile) {
    hideBenchmarkPopup();
    status.textContent = "Pick an image";
    return;
  }

  showBenchmarkPopup(`Benchmark\nFile: ${selectedFile.name}\nStatus: pipeline placeholder`);
});

benchmarkCloseBtn.addEventListener("click", hideBenchmarkPopup);

const passes: Pass[] = [
  {
    name: "clamp-p1",
    textures: { 0: "MAIN" },
    when: clamp.whenP1,
    save: "STATSMAX",
    size: { from: "FRAME", scale: 1 },
    shader: clamp.fragP1,
  },
  {
    name: "clamp-p2",
    textures: { 0: "MAIN", 2: "STATSMAX" },
    when: clamp.whenP2,
    save: "STATSMAX",
    size: { from: "FRAME", scale: 1 },
    shader: clamp.fragP2,
  },
  {
    name: "restore-vl-p1",
    textures: { 0: "MAIN" },
    when: restoreVL.whenP1,
    save: "conv2d_tf",
    size: { from: "FRAME", scale: 1 },
    shader: restoreVL.fragP1,
  },
  {
    name: "restore-vl-p2",
    textures: { 0: "MAIN" },
    when: restoreVL.whenP2,
    save: "conv2d_tf1",
    size: { from: "FRAME", scale: 1 },
    shader: restoreVL.fragP2,
  },
  {
    name: "restore-vl-p3",
    textures: { 0: "conv2d_tf", 2: "conv2d_tf", 3: "conv2d_tf1" },
    when: restoreVL.whenP3,
    save: "conv2d_1_tf",
    size: { from: "FRAME", scale: 1 },
    shader: restoreVL.fragP3,
  },
  {
    name: "restore-vl-p4",
    textures: { 0: "conv2d_tf", 2: "conv2d_tf", 3: "conv2d_tf1" },
    when: restoreVL.whenP4,
    save: "conv2d_1_tf1",
    size: { from: "FRAME", scale: 1 },
    shader: restoreVL.fragP4,
  },
  {
    name: "restore-vl-p5",
    textures: { 0: "conv2d_1_tf", 4: "conv2d_1_tf", 5: "conv2d_1_tf1" },
    when: restoreVL.whenP5,
    save: "conv2d_2_tf",
    size: { from: "FRAME", scale: 1 },
    shader: restoreVL.fragP5,
  },
  {
    name: "restore-vl-p6",
    textures: { 0: "conv2d_1_tf", 4: "conv2d_1_tf", 5: "conv2d_1_tf1" },
    when: restoreVL.whenP6,
    save: "conv2d_2_tf1",
    size: { from: "FRAME", scale: 1 },
    shader: restoreVL.fragP6,
  },
  {
    name: "restore-vl-p7",
    textures: { 0: "conv2d_2_tf", 6: "conv2d_2_tf", 7: "conv2d_2_tf1" },
    when: restoreVL.whenP7,
    save: "conv2d_3_tf",
    size: { from: "FRAME", scale: 1 },
    shader: restoreVL.fragP7,
  },
  {
    name: "restore-vl-p8",
    textures: { 0: "conv2d_2_tf", 6: "conv2d_2_tf", 7: "conv2d_2_tf1" },
    when: restoreVL.whenP8,
    save: "conv2d_3_tf1",
    size: { from: "FRAME", scale: 1 },
    shader: restoreVL.fragP8,
  },
  {
    name: "restore-vl-p9",
    textures: { 0: "conv2d_3_tf", 8: "conv2d_3_tf", 9: "conv2d_3_tf1" },
    when: restoreVL.whenP9,
    save: "conv2d_4_tf",
    size: { from: "FRAME", scale: 1 },
    shader: restoreVL.fragP9,
  },
  {
    name: "restore-vl-p10",
    textures: { 0: "conv2d_3_tf", 8: "conv2d_3_tf", 9: "conv2d_3_tf1" },
    when: restoreVL.whenP10,
    save: "conv2d_4_tf1",
    size: { from: "FRAME", scale: 1 },
    shader: restoreVL.fragP10,
  },
  {
    name: "restore-vl-p11",
    textures: { 0: "conv2d_4_tf", 10: "conv2d_4_tf", 11: "conv2d_4_tf1" },
    when: restoreVL.whenP11,
    save: "conv2d_5_tf",
    size: { from: "FRAME", scale: 1 },
    shader: restoreVL.fragP11,
  },
  {
    name: "restore-vl-p12",
    textures: { 0: "conv2d_4_tf", 10: "conv2d_4_tf", 11: "conv2d_4_tf1" },
    when: restoreVL.whenP12,
    save: "conv2d_5_tf1",
    size: { from: "FRAME", scale: 1 },
    shader: restoreVL.fragP12,
  },
  {
    name: "restore-vl-p13",
    textures: { 0: "conv2d_5_tf", 12: "conv2d_5_tf", 13: "conv2d_5_tf1" },
    when: restoreVL.whenP13,
    save: "conv2d_6_tf",
    size: { from: "FRAME", scale: 1 },
    shader: restoreVL.fragP13,
  },
  {
    name: "restore-vl-p14",
    textures: { 0: "conv2d_5_tf", 12: "conv2d_5_tf", 13: "conv2d_5_tf1" },
    when: restoreVL.whenP14,
    save: "conv2d_6_tf1",
    size: { from: "FRAME", scale: 1 },
    shader: restoreVL.fragP14,
  },
  {
    name: "restore-vl-p15",
    textures: { 0: "conv2d_6_tf", 14: "conv2d_6_tf", 15: "conv2d_6_tf1" },
    when: restoreVL.whenP15,
    save: "conv2d_7_tf",
    size: { from: "FRAME", scale: 1 },
    shader: restoreVL.fragP15,
  },
  {
    name: "restore-vl-p16",
    textures: { 0: "conv2d_6_tf", 14: "conv2d_6_tf", 15: "conv2d_6_tf1" },
    when: restoreVL.whenP16,
    save: "conv2d_7_tf1",
    size: { from: "FRAME", scale: 1 },
    shader: restoreVL.fragP16,
  },
  {
    name: "restore-vl-p17",
    textures: {
      0: "MAIN",
      4: "conv2d_1_tf",
      5: "conv2d_1_tf1",
      6: "conv2d_2_tf",
      7: "conv2d_2_tf1",
      8: "conv2d_3_tf",
      9: "conv2d_3_tf1",
      10: "conv2d_4_tf",
      11: "conv2d_4_tf1",
      12: "conv2d_5_tf",
      13: "conv2d_5_tf1",
      14: "conv2d_6_tf",
      15: "conv2d_6_tf1",
      16: "conv2d_7_tf",
      17: "conv2d_7_tf1",
    },
    when: restoreVL.whenP17,
    save: "MAIN",
    size: { from: "conv2d_1_tf", scale: 1 },
    shader: restoreVL.fragP17,
  },
  {
    name: "upscale-vl-p1",
    textures: { 0: "MAIN" },
    when: upscaleX2VL.whenP1,
    save: "conv2d_tf",
    size: { from: "FRAME", scale: 1 },
    shader: upscaleX2VL.fragP1,
  },
  {
    name: "upscale-vl-p2",
    textures: { 0: "MAIN" },
    when: upscaleX2VL.whenP2,
    save: "conv2d_tf1",
    size: { from: "FRAME", scale: 1 },
    shader: upscaleX2VL.fragP2,
  },
  {
    name: "upscale-vl-p3",
    textures: { 0: "conv2d_tf", 2: "conv2d_tf", 3: "conv2d_tf1" },
    when: upscaleX2VL.whenP3,
    save: "conv2d_1_tf",
    size: { from: "FRAME", scale: 1 },
    shader: upscaleX2VL.fragP3,
  },
  {
    name: "upscale-vl-p4",
    textures: { 0: "conv2d_tf", 2: "conv2d_tf", 3: "conv2d_tf1" },
    when: upscaleX2VL.whenP4,
    save: "conv2d_1_tf1",
    size: { from: "FRAME", scale: 1 },
    shader: upscaleX2VL.fragP4,
  },
  {
    name: "upscale-vl-p5",
    textures: { 0: "conv2d_1_tf", 4: "conv2d_1_tf", 5: "conv2d_1_tf1" },
    when: upscaleX2VL.whenP5,
    save: "conv2d_2_tf",
    size: { from: "FRAME", scale: 1 },
    shader: upscaleX2VL.fragP5,
  },
  {
    name: "upscale-vl-p6",
    textures: { 0: "conv2d_1_tf", 4: "conv2d_1_tf", 5: "conv2d_1_tf1" },
    when: upscaleX2VL.whenP6,
    save: "conv2d_2_tf1",
    size: { from: "FRAME", scale: 1 },
    shader: upscaleX2VL.fragP6,
  },
  {
    name: "upscale-vl-p7",
    textures: { 0: "conv2d_2_tf", 6: "conv2d_2_tf", 7: "conv2d_2_tf1" },
    when: upscaleX2VL.whenP7,
    save: "conv2d_3_tf",
    size: { from: "FRAME", scale: 1 },
    shader: upscaleX2VL.fragP7,
  },
  {
    name: "upscale-vl-p8",
    textures: { 0: "conv2d_2_tf", 6: "conv2d_2_tf", 7: "conv2d_2_tf1" },
    when: upscaleX2VL.whenP8,
    save: "conv2d_3_tf1",
    size: { from: "FRAME", scale: 1 },
    shader: upscaleX2VL.fragP8,
  },
  {
    name: "upscale-vl-p9",
    textures: { 0: "conv2d_3_tf", 8: "conv2d_3_tf", 9: "conv2d_3_tf1" },
    when: upscaleX2VL.whenP9,
    save: "conv2d_4_tf",
    size: { from: "FRAME", scale: 1 },
    shader: upscaleX2VL.fragP9,
  },
  {
    name: "upscale-vl-p10",
    textures: { 0: "conv2d_3_tf", 8: "conv2d_3_tf", 9: "conv2d_3_tf1" },
    when: upscaleX2VL.whenP10,
    save: "conv2d_4_tf1",
    size: { from: "FRAME", scale: 1 },
    shader: upscaleX2VL.fragP10,
  },
  {
    name: "upscale-vl-p11",
    textures: { 0: "conv2d_4_tf", 10: "conv2d_4_tf", 11: "conv2d_4_tf1" },
    when: upscaleX2VL.whenP11,
    save: "conv2d_5_tf",
    size: { from: "FRAME", scale: 1 },
    shader: upscaleX2VL.fragP11,
  },
  {
    name: "upscale-vl-p12",
    textures: { 0: "conv2d_4_tf", 10: "conv2d_4_tf", 11: "conv2d_4_tf1" },
    when: upscaleX2VL.whenP12,
    save: "conv2d_5_tf1",
    size: { from: "FRAME", scale: 1 },
    shader: upscaleX2VL.fragP12,
  },
  {
    name: "upscale-vl-p13",
    textures: { 0: "conv2d_5_tf", 12: "conv2d_5_tf", 13: "conv2d_5_tf1" },
    when: upscaleX2VL.whenP13,
    save: "conv2d_6_tf",
    size: { from: "FRAME", scale: 1 },
    shader: upscaleX2VL.fragP13,
  },
  {
    name: "upscale-vl-p14",
    textures: { 0: "conv2d_5_tf", 12: "conv2d_5_tf", 13: "conv2d_5_tf1" },
    when: upscaleX2VL.whenP14,
    save: "conv2d_6_tf1",
    size: { from: "FRAME", scale: 1 },
    shader: upscaleX2VL.fragP14,
  },
  {
    name: "upscale-vl-p15",
    textures: {
      0: "conv2d_tf",
      2: "conv2d_tf",
      3: "conv2d_tf1",
      4: "conv2d_1_tf",
      5: "conv2d_1_tf1",
      6: "conv2d_2_tf",
      7: "conv2d_2_tf1",
      8: "conv2d_3_tf",
      9: "conv2d_3_tf1",
      10: "conv2d_4_tf",
      11: "conv2d_4_tf1",
      12: "conv2d_5_tf",
      13: "conv2d_5_tf1",
      14: "conv2d_6_tf",
      15: "conv2d_6_tf1",
    },
    when: upscaleX2VL.whenP15,
    save: "conv2d_last_tf",
    size: { from: "FRAME", scale: 1 },
    shader: upscaleX2VL.fragP15,
  },
  {
    name: "upscale-vl-p16",
    textures: {
      0: "conv2d_tf",
      2: "conv2d_tf",
      3: "conv2d_tf1",
      4: "conv2d_1_tf",
      5: "conv2d_1_tf1",
      6: "conv2d_2_tf",
      7: "conv2d_2_tf1",
      8: "conv2d_3_tf",
      9: "conv2d_3_tf1",
      10: "conv2d_4_tf",
      11: "conv2d_4_tf1",
      12: "conv2d_5_tf",
      13: "conv2d_5_tf1",
      14: "conv2d_6_tf",
      15: "conv2d_6_tf1",
    },
    when: upscaleX2VL.whenP16,
    save: "conv2d_last_tf1",
    size: { from: "FRAME", scale: 1 },
    shader: upscaleX2VL.fragP16,
  },
  {
    name: "upscale-vl-p17",
    textures: {
      0: "conv2d_tf",
      2: "conv2d_tf",
      3: "conv2d_tf1",
      4: "conv2d_1_tf",
      5: "conv2d_1_tf1",
      6: "conv2d_2_tf",
      7: "conv2d_2_tf1",
      8: "conv2d_3_tf",
      9: "conv2d_3_tf1",
      10: "conv2d_4_tf",
      11: "conv2d_4_tf1",
      12: "conv2d_5_tf",
      13: "conv2d_5_tf1",
      14: "conv2d_6_tf",
      15: "conv2d_6_tf1",
    },
    when: upscaleX2VL.whenP17,
    save: "conv2d_last_tf2",
    size: { from: "FRAME", scale: 1 },
    shader: upscaleX2VL.fragP17,
  },
  {
    name: "upscale-vl-f",
    textures: { 0: "MAIN", 16: "conv2d_last_tf", 17: "conv2d_last_tf1", 18: "conv2d_last_tf2" },
    when: upscaleX2VL.whenF,
    save: "MAIN",
    size: { from: "conv2d_last_tf", scale: 2 },
    shader: upscaleX2VL.fragF,
  },
  {
    name: "auto-downscale-pre-x2",
    textures: { 0: "MAIN" },
    when: autoDownscalePreX2.whenF,
    save: "MAIN",
    size: { from: "OUTPUT", scale: 1 },
    shader: autoDownscalePreX2.fragF,
  },
  {
    name: "auto-downscale-pre-x4",
    textures: { 0: "MAIN" },
    when: autoDownscalePreX4.whenF,
    save: "MAIN",
    size: { from: "OUTPUT", scale: 0.5 },
    shader: autoDownscalePreX4.fragF,
  },
  {
    name: "upscale-m-p1",
    textures: { 0: "MAIN" },
    when: upscaleX2M.whenP1,
    save: "conv2d_tf",
    size: { from: "FRAME", scale: 1 },
    shader: upscaleX2M.fragP1,
  },
  {
    name: "upscale-m-p2",
    textures: { 0: "conv2d_tf", 2: "conv2d_tf" },
    when: upscaleX2M.whenP2,
    save: "conv2d_1_tf",
    size: { from: "FRAME", scale: 1 },
    shader: upscaleX2M.fragP2,
  },
  {
    name: "upscale-m-p3",
    textures: { 0: "conv2d_1_tf", 3: "conv2d_1_tf" },
    when: upscaleX2M.whenP3,
    save: "conv2d_2_tf",
    size: { from: "FRAME", scale: 1 },
    shader: upscaleX2M.fragP3,
  },
  {
    name: "upscale-m-p4",
    textures: { 0: "conv2d_2_tf", 4: "conv2d_2_tf" },
    when: upscaleX2M.whenP4,
    save: "conv2d_3_tf",
    size: { from: "FRAME", scale: 1 },
    shader: upscaleX2M.fragP4,
  },
  {
    name: "upscale-m-p5",
    textures: { 0: "conv2d_3_tf", 5: "conv2d_3_tf" },
    when: upscaleX2M.whenP5,
    save: "conv2d_4_tf",
    size: { from: "FRAME", scale: 1 },
    shader: upscaleX2M.fragP5,
  },
  {
    name: "upscale-m-p6",
    textures: { 0: "conv2d_4_tf", 6: "conv2d_4_tf" },
    when: upscaleX2M.whenP6,
    save: "conv2d_5_tf",
    size: { from: "FRAME", scale: 1 },
    shader: upscaleX2M.fragP6,
  },
  {
    name: "upscale-m-p7",
    textures: { 0: "conv2d_5_tf", 7: "conv2d_5_tf" },
    when: upscaleX2M.whenP7,
    save: "conv2d_6_tf",
    size: { from: "FRAME", scale: 1 },
    shader: upscaleX2M.fragP7,
  },
  {
    name: "upscale-m-p8",
    textures: {
      0: "conv2d_tf",
      2: "conv2d_tf",
      3: "conv2d_1_tf",
      4: "conv2d_2_tf",
      5: "conv2d_3_tf",
      6: "conv2d_4_tf",
      7: "conv2d_5_tf",
      8: "conv2d_6_tf",
    },
    when: upscaleX2M.whenP8,
    save: "conv2d_last_tf",
    size: { from: "FRAME", scale: 1 },
    shader: upscaleX2M.fragP8,
  },
  {
    name: "upscale-m-f",
    textures: { 0: "MAIN", 9: "conv2d_last_tf" },
    when: upscaleX2M.whenF,
    save: "MAIN",
    size: { from: "conv2d_last_tf", scale: 2 },
    shader: upscaleX2M.fragF,
  },
  {
    name: "clamp-p3",
    textures: { 0: "MAIN", 2: "STATSMAX" },
    when: clamp.whenP3,
    save: "MAIN",
    size: { from: "FRAME", scale: 1 },
    shader: clamp.fragP3,
  },
];

const defaultVertexShader = `
struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vertex(@builtin(vertex_index) i: u32) -> VertexOutput {
  var pos = array<vec2f, 3>(
    vec2f(-1.0, -1.0),
    vec2f( 3.0, -1.0),
    vec2f(-1.0,  3.0)
  );

  var output: VertexOutput;
  output.position = vec4f(pos[i], 0.0, 1.0);
  output.uv = pos[i] * vec2f(0.5, -0.5) + vec2f(0.5);
  return output;
}
`;

const defaultFragmentShader = `
@group(0) @binding(0) var final_texture: texture_2d<f32>;
@group(0) @binding(1) var final_sampler: sampler;

@fragment
fn fragment(@location(0) uv: vec2f) -> @location(0) vec4f {
  return textureSampleLevel(final_texture, final_sampler, uv, 0.0);
}
`;

function createOutputTexture(size: Size): Texture {
  return {
    gpu: device.createTexture({
      size,
      format: "rgba16float",
      usage:
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.RENDER_ATTACHMENT,
    }),
    ...size,
  };
}

function createPipeline(
  fragmentShaderCode: string,
  format: GPUTextureFormat,
  bindGroupLayout?: GPUBindGroupLayout,
) {
  return device.createRenderPipeline({
    layout: bindGroupLayout
      ? device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] })
      : "auto",
    vertex: {
      module: device.createShaderModule({
        code: defaultVertexShader,
      }),
    },
    fragment: {
      module: device.createShaderModule({
        code: fragmentShaderCode,
      }),
      targets: [{ format }],
    },
  });
}

function createBindGroupLayout(textureBindings: number[]): GPUBindGroupLayout {
  const entries: GPUBindGroupLayoutEntry[] = [
    {
      binding: 1,
      visibility: GPUShaderStage.FRAGMENT,
      sampler: { type: "filtering" },
    },
  ];

  for (const binding of textureBindings) {
    entries.push({
      binding,
      visibility: GPUShaderStage.FRAGMENT,
      texture: { sampleType: "float" },
    });
  }

  return device.createBindGroupLayout({ entries });
}

function render(pipeline: GPURenderPipeline, bindGroup: GPUBindGroup, target: GPUTextureView) {
  const encoder = device.createCommandEncoder();
  const renderPass = encoder.beginRenderPass({
    colorAttachments: [
      {
        view: target,
        loadOp: "clear",
        storeOp: "store",
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
      },
    ],
  });

  renderPass.setPipeline(pipeline);
  renderPass.setBindGroup(0, bindGroup);
  renderPass.draw(3);
  renderPass.end();

  device.queue.submit([encoder.finish()]);
}

function getElementById<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing required element: #${id}`);
  }

  return element as T;
}

function on(id: string, eventName: string, handler: (event: Event) => void): void {
  getElementById<HTMLElement>(id).addEventListener(eventName, handler);
}

function setButtonsIdleState(): void {
  processBtn.disabled = false;
  benchmarkBtn.disabled = selectedFile === null;
  saveBtn.disabled = true;
}

function hideBenchmarkPopup(): void {
  benchmarkPopup.classList.add("hidden");
}

function showBenchmarkPopup(message: string): void {
  benchmarkMeta.textContent = message;
  benchmarkPopup.classList.remove("hidden");
}

type Size = {
  width: number;
  height: number;
};

type Texture = Size & {
  gpu: GPUTexture;
};

type PassSizes = {
  main: Size;
  native: Size;
  output: Size;
};

type When = (sizes: PassSizes) => boolean;

type Pass = {
  name: string;
  when: When | null;
  textures: {
    [binding: number]: string;
  };
  save?: string | null;
  size: {
    from: string;
    scale: number;
  };
  shader: string;
};
