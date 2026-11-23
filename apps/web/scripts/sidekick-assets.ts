// Draws the sidekick pictures the iPhone and Android apps bundle, with the agent's own renderer (src/agent/sidekick-face.ts)
// and Open Bot Avatar's fluffy WebGL2 shaders (in headless Chrome), into assets/sidekicks and both apps' copies of it.
// Run it whenever SHAPES, SKINS, LOOK_PRESETS, or open-bot-avatar's fluffy look changes:
//   npm run sidekicks:assets -w @dex/web
//
//   presets.json, <preset>.png     the ready-made looks: key, name, accent color, look, and its picture
//   shapes.json                    the colors, dye ramps (for dyeing fluffy coats), and each shape's eye band (for blinking)
//   shapes/<shape>-body.png, shapes/<shape>-eyes.png
//                                  each shape's flat body in white (for the apps to tint any color) and its eyes
//   shapes/<shape>-fluffy-body.png, shapes/<shape>-fluffy-eyes.png
//                                  each shape's fluffy coat as exposure + alpha (grayscale+alpha PNG, dyed via shapes.json's
//                                  ramps so any skin matches WebGL2) and its glossy eye beads (to lay over it and blink)
import { execFile } from "node:child_process"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { deflateSync } from "node:zlib"
import { build } from "esbuild"
import { DYE_RAMP_RANGE, DYE_RAMP_SIZE, dyeRamp } from "../../../node_modules/open-bot-avatar/dist/dom/fluffy/dye.js"
import { encodePng, faceOutlines, facePng, faceRgba } from "../src/agent/sidekick-face.ts"
import { EYE_INK, LOOK_PRESETS, lookDefinition, makeLook, SHAPES, SKINS } from "../src/shared/sidekick-look.ts"

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
const targets = [
  join(root, "assets/sidekicks"),
  join(root, "apps/ios/DexKit/Sources/DexCore/Resources/Sidekicks"),
  join(root, "apps/android/core/model/src/main/resources/dev/trydex/core/model/sidekicks")
]
const SIZE = 256

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (bytes: Uint8Array) => {
  let c = 0xffffffff
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** Grayscale + alpha (2 bytes/pixel, PNG color type 4) with Sub filter and max zlib compression. */
function encodeGrayAlphaPng(ga: Uint8Array, width: number, height: number): Uint8Array {
  const rowLen = width * 2
  const raw = new Uint8Array(height * (rowLen + 1))
  for (let y = 0; y < height; y++) {
    const rowOut = y * (rowLen + 1)
    const rowIn = y * rowLen
    raw[rowOut] = 1 // Sub filter
    for (let x = 0; x < rowLen; x++) {
      const prev = x >= 2 ? ga[rowIn + x - 2]! : 0
      raw[rowOut + 1 + x] = (ga[rowIn + x]! - prev) & 0xff
    }
  }
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length)
    const view = new DataView(out.buffer)
    view.setUint32(0, data.length)
    out.set(new TextEncoder().encode(type), 4)
    out.set(data, 8)
    view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
    return out
  }
  const header = new Uint8Array(13)
  const view = new DataView(header.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  header.set([8, 4, 0, 0, 0], 8) // 8-bit grayscale + alpha
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", new Uint8Array())]
  const png = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
  let at = 0
  for (const part of parts) {
    png.set(part, at)
    at += part.length
  }
  return png
}

/**
 * A skin's 96-entry RGB dye ramp (288 bytes), matching Open Bot Avatar's fluffy shader (`dyeRamp` plus its yellow-hue
 * fiber-scatter curve so lemon stays golden on bright tips instead of turning cream).
 */
function skinRamp(hex: string): Uint8Array {
  const rgb: [number, number, number] = [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]
  const base = dyeRamp(rgb)
  const out = new Uint8Array(DYE_RAMP_SIZE * 3)
  const r0 = rgb[0] / 255
  const g0 = rgb[1] / 255
  const b0 = rgb[2] / 255
  const val = Math.max(r0, g0, b0)
  const dye = [r0 / Math.max(val, 0.001), g0 / Math.max(val, 0.001), b0 / Math.max(val, 0.001)]
  const weakest = Math.min(dye[0]!, dye[1]!, dye[2]!)
  const yellow = base[3]! / 255
  for (let i = 0; i < DYE_RAMP_SIZE; i++) {
    let r = base[i * 4]! / 255
    let g = base[i * 4 + 1]! / 255
    let b = base[i * 4 + 2]! / 255
    if (yellow > 0) {
      const exposure = ((i + 0.5) * DYE_RAMP_RANGE) / DYE_RAMP_SIZE
      const diffuse = Math.min(1.02, Math.sqrt(exposure / 0.92))
      const fiber = Math.max(0, (exposure - 0.92) / 1.45)
      const brightness = Math.min(1, val * diffuse + (0.35 + 0.65 * val) * fiber)
      const scatter = Math.min(1, 1.85 * fiber)
      const yr = (dye[0]! + (1 - dye[0]!) * (0.09 + 0.91 * (dye[0]! - weakest)) * scatter) * brightness
      const yg = (dye[1]! + (1 - dye[1]!) * (0.09 + 0.91 * (dye[1]! - weakest)) * scatter) * brightness
      const yb = (dye[2]! + (1 - dye[2]!) * (0.09 + 0.91 * (dye[2]! - weakest)) * scatter) * brightness
      r = r + (yr - r) * yellow
      g = g + (yg - g) * yellow
      b = b + (yb - b) * yellow
    }
    out[i * 3] = Math.round(Math.max(0, Math.min(1, r)) * 255)
    out[i * 3 + 1] = Math.round(Math.max(0, Math.min(1, g)) * 255)
    out[i * 3 + 2] = Math.round(Math.max(0, Math.min(1, b)) * 255)
  }
  return out
}

function findChrome(): string {
  const candidates = [
    process.env.CHROME,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium"
  ].filter(Boolean) as string[]
  for (const path of candidates) if (existsSync(path)) return path
  throw new Error("Headless Chrome is needed to bake fluffy sidekick layers (set CHROME=/path/to/chrome).")
}

/**
 * Renders every shape's fluffy coat (exposure + alpha) and glossy eyes in one headless Chrome WebGL2 run using
 * Open Bot Avatar's own shaders and meshes.
 */
async function bakeFluffyLayers(): Promise<Map<string, { body: Uint8Array; eyes: Uint8Array }>> {
  const harness = `
import { liveFrame, preparedVolume } from "../../node_modules/open-bot-avatar/dist/render.js";
import { fragmentShader, vertexShader, PASS } from "../../node_modules/open-bot-avatar/dist/dom/fluffy/shaders.js";
import { buildMesh, halfDepth, ROOT_PASSES, rootsIn } from "../../node_modules/open-bot-avatar/dist/dom/fluffy/mesh.js";
import { SOCKET_TILE, exposedHeight, socketRegion, socketTile } from "../../node_modules/open-bot-avatar/dist/dom/fluffy/socket.js";
import { DYE_RAMP_RANGE } from "../../node_modules/open-bot-avatar/dist/dom/fluffy/dye.js";

const bodyFrag = fragmentShader
  .replace("if (pass == BODY && d < 3.7) {", "if (false && pass == BODY && d < 3.7) {")
  .replace("result = vec4(base, 1.);", "float u = clamp(exposure / " + DYE_RAMP_RANGE + ", 0., 1.); result = vec4(u, u, u, 1.);");

const eyeFrag = fragmentShader.replace(
  "result = vec4(base, 1.);",
  \`if (pass != BODY || d >= 1.0) discard;
  vec2 curve2 = local.xy * .94;
  vec3 dome2 = normalize(vec3(curve2, sqrt(max(.02, 1. - dot(curve2, curve2)))));
  vec3 beadNormal2 = normalize(view * dome2);
  vec2 key2 = beadNormal2.xy - vec2(.59, -.865);
  key2 = vec2(key2.x - .76 * key2.y, key2.y) / vec2(.55, .70);
  vec2 fill2 = beadNormal2.xy - vec2(.61, -.195);
  fill2 = vec2(fill2.x - .37 * fill2.y, fill2.y) / vec2(.47, 1.01);
  float stripLight2 = .38 * exp(-dot(key2, key2));
  float sideLight2 = .13 * exp(-dot(fill2, fill2));
  float inkValue2 = max(ink.r, max(ink.g, ink.b));
  vec3 bead2 = ink * sqrt(inkValue2) * (.40 + .24 * beadNormal2.z + .24 * inkValue2);
  vec3 refl2 = vec3(1.) * (stripLight2 * 0.85 + sideLight2 * 0.45);
  bead2 += refl2 * smoothstep(-.12, .55, -d);
  float aa2 = max(.15, fwidth(d));
  float a2 = 1. - smoothstep(-aa2 * .5, aa2 * .5, d);
  if (a2 <= 0.001) discard;
  result = vec4(bead2 * a2, a2);\`
);

function randomFrom(seed) {
  return () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
}
function fiberTile() {
  const s = 128;
  const tile = document.createElement("canvas");
  tile.width = tile.height = s;
  const g = tile.getContext("2d");
  g.fillStyle = "#252525";
  g.fillRect(0, 0, s, s);
  g.lineCap = "round";
  const random = randomFrom(9213);
  for (let i = 0; i < 1400; i++) {
    const x = random() * s, y = random() * s;
    const angle = 2.4 * Math.sin((y * Math.PI) / 32) + 1.4 * Math.cos((x * Math.PI) / 32) + (random() - 0.5) * 3.3;
    const dx = Math.cos(angle), dy = Math.sin(angle), length = 3 + random() * 8, curl = (random() - 0.5) * length;
    const grey = Math.round(55 + 200 * random());
    g.strokeStyle = "rgb(" + grey + " " + grey + " " + grey + ")";
    g.lineWidth = 0.8 + random() * 1.5;
    for (const ox of [-s, 0, s]) for (const oy of [-s, 0, s]) {
      if (x + ox < -12 || x + ox > s + 12 || y + oy < -12 || y + oy > s + 12) continue;
      g.beginPath();
      g.moveTo(x + ox, y + oy);
      g.quadraticCurveTo(x + ox + dx * length * 0.5 - dy * curl, y + oy + dy * length * 0.5 + dx * curl, x + ox + dx * length, y + oy + dy * length);
      g.stroke();
    }
  }
  return tile;
}
function rootVolume(side) {
  const roots = new Uint8Array(side ** 3);
  let seed = 73021;
  for (let i = 0; i < roots.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    roots[i] = seed >>> 24;
  }
  return roots;
}
function toBase64(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
}

function makeRenderer(fragSrc) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 512;
  const gl = canvas.getContext("webgl2", { alpha: true, antialias: true, premultipliedAlpha: true, preserveDrawingBuffer: true });
  if (!gl) throw new Error("WebGL2 unavailable");
  const prog = gl.createProgram();
  for (const [k, src] of [[gl.VERTEX_SHADER, vertexShader], [gl.FRAGMENT_SHADER, fragSrc]]) {
    const sh = gl.createShader(k);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
    gl.attachShader(prog, sh);
  }
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);
  const u = (n) => gl.getUniformLocation(prog, n);
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);
  const tex = (unit, name, target) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(target, gl.createTexture());
    gl.uniform1i(u(name), unit);
  };
  const clampLinear = () => {
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  };
  tex(0, "pile", gl.TEXTURE_2D);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, fiberTile());
  gl.generateMipmap(gl.TEXTURE_2D);
  tex(2, "brushedPile", gl.TEXTURE_3D);
  gl.texImage3D(gl.TEXTURE_3D, 0, gl.R8, 64, 64, 64, 0, gl.RED, gl.UNSIGNED_BYTE, rootVolume(64));
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.generateMipmap(gl.TEXTURE_3D);
  tex(3, "dyeRamp", gl.TEXTURE_2D);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, 96, 1);
  clampLinear();
  tex(1, "eyeField", gl.TEXTURE_2D);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R8, 2 * SOCKET_TILE, SOCKET_TILE);
  clampLinear();

  const scratch = document.createElement("canvas");
  scratch.width = scratch.height = SOCKET_TILE;
  const sctx = scratch.getContext("2d", { willReadFrequently: true });
  const out = document.createElement("canvas");
  out.width = out.height = ${SIZE};
  const octx = out.getContext("2d", { willReadFrequently: true });

  return (def, eyesOnly) => {
    const vol = preparedVolume(def).vol;
    const mesh = buildMesh(vol);
    const b = vol.bounds, rx = (b.maxX - b.minX) / 2, ry = (b.maxY - b.minY) / 2, rz = halfDepth(vol);
    const cx = b.minX + rx, cy = b.minY + ry;
    const radius = Math.ceil(Math.hypot(rx, ry, rz) + 4);
    const frame = liveFrame(def, { color: "#ff6a1a", eyeColor: "${EYE_INK}", reducedMotion: true, size: ${SIZE} });
    const { view, scale: bodyScale, eyes } = frame.surface;
    const scale = ${SIZE} / 100;
    const pixels = Math.min(1024, Math.max(32, Math.ceil(2 * radius * scale)));
    if (canvas.width < pixels) canvas.width = canvas.height = pixels;

    const surface = gl.createVertexArray();
    gl.bindVertexArray(surface);
    const vb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.vertices, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);

    const strands = gl.createVertexArray();
    gl.bindVertexArray(strands);
    const rb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, rb);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.roots, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 32, 0); gl.vertexAttribDivisor(0, 1);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 32, 12); gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 32, 24); gl.vertexAttribDivisor(2, 1);

    const regions = new Float32Array(8), sizes = new Float32Array(4);
    gl.activeTexture(gl.TEXTURE1);
    eyes.forEach(({ mark, dx, dy }, slot) => {
      const reg = socketRegion(mark);
      regions.set([reg.cx + dx, reg.cy + dy, reg.span, vol.eyeZ[slot] + 0.8], 4 * slot);
      sizes.set([reg.w, reg.h * exposedHeight(reg.w, reg.h)], 2 * slot);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, slot * SOCKET_TILE, 0, SOCKET_TILE, SOCKET_TILE, gl.RED, gl.UNSIGNED_BYTE, socketTile(sctx, mark));
    });
    gl.uniform4fv(u("eyeRegion[0]"), regions);
    gl.uniform2fv(u("eyeSize[0]"), sizes);
    gl.uniform3f(u("color"), 1, 1, 1);
    gl.uniform3f(u("ink"), 0x15 / 255, 0x15 / 255, 0x15 / 255);
    gl.uniform3f(u("pivot"), cx, cy, 0);
    gl.uniform3fv(u("extent"), [rx, ry, rz]);
    gl.uniform1f(u("radius"), radius);
    gl.uniformMatrix3fv(u("view"), false, [view.cY, view.sY * view.sP, -view.sY * view.cP, 0, view.cP, view.sP, view.sY, -view.cY * view.sP, view.facing]);

    gl.viewport(0, 0, pixels, pixels);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.bindVertexArray(surface);
    gl.uniform1i(u("pass"), PASS.body);
    gl.drawElements(gl.TRIANGLES, mesh.fine.count, gl.UNSIGNED_INT, 4 * mesh.fine.start);
    if (!eyesOnly) {
      gl.uniform1i(u("pass"), PASS.shell);
      for (let l = 1; l <= 5; l++) {
        gl.uniform1f(u("shell"), l / 5);
        gl.drawElements(gl.TRIANGLES, mesh.fine.count, gl.UNSIGNED_INT, 4 * mesh.fine.start);
      }
      gl.bindVertexArray(strands);
      gl.uniform1i(u("pass"), PASS.strand);
      gl.uniform1f(u("strandWidth"), 1);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 8, rootsIn(mesh.roots.length / 8, ROOT_PASSES));
    }

    gl.deleteVertexArray(surface);
    gl.deleteVertexArray(strands);
    gl.deleteBuffer(vb);
    gl.deleteBuffer(ib);
    gl.deleteBuffer(rb);

    octx.setTransform(1, 0, 0, 1, 0, 0);
    octx.clearRect(0, 0, ${SIZE}, ${SIZE});
    const [a, b0, c, d, e, f] = frame.root;
    octx.setTransform(scale * a, scale * b0, scale * c, scale * d, scale * e, scale * f);
    const rScaled = radius * bodyScale;
    octx.drawImage(canvas, 0, canvas.height - pixels, pixels, pixels, cx - rScaled, cy - rScaled, 2 * rScaled, 2 * rScaled);
    if (eyesOnly) return out.toDataURL("image/png");
    const rgba = octx.getImageData(0, 0, ${SIZE}, ${SIZE}).data;
    const ga = new Uint8Array(${SIZE} * ${SIZE} * 2);
    for (let i = 0, j = 0; i < rgba.length; i += 4, j += 2) {
      ga[j] = rgba[i];
      ga[j + 1] = rgba[i + 3];
    }
    return toBase64(ga);
  };
}

window.bakeAll = (defs) => {
  const renderBody = makeRenderer(bodyFrag);
  const renderEyes = makeRenderer(eyeFrag);
  const out = {};
  for (const def of defs) out[def.id] = { ga: renderBody(def, false), eyes: renderEyes(def, true) };
  return out;
};
`
  const bundle = await build({
    stdin: { contents: harness, resolveDir: join(root, "apps/web"), loader: "js" },
    bundle: true,
    write: false,
    format: "iife"
  })
  const defs = SHAPES.map((shape) => lookDefinition(makeLook(shape.key, "peach")))
  const html = `<!doctype html><html><body><script>${bundle.outputFiles[0]!.text}</script><script>
try {
  const out = window.bakeAll(${JSON.stringify(defs)});
  const el = document.createElement("pre");
  el.id = "out";
  el.textContent = JSON.stringify(out);
  document.body.appendChild(el);
} catch (e) {
  const el = document.createElement("pre");
  el.id = "err";
  el.textContent = String(e && e.stack || e);
  document.body.appendChild(el);
}
</script></body></html>`

  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" })
    res.end(html)
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address() as { port: number }
  const dom = await new Promise<string>((resolve, reject) => {
    execFile(
      findChrome(),
      [
        "--headless",
        "--disable-gpu-sandbox",
        "--enable-unsafe-swiftshader",
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--window-size=400,400",
        "--virtual-time-budget=60000",
        "--dump-dom",
        `http://127.0.0.1:${address.port}/`
      ],
      { maxBuffer: 128 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) reject(new Error(`${error.message}\n${stderr}`))
        else resolve(stdout)
      }
    )
  })
  server.close()

  const match = /<pre id="(out|err)">([\s\S]*?)<\/pre>/.exec(dom)
  if (!match) throw new Error(`Chrome returned no output: ${dom.slice(0, 500)}`)
  const text = match[2]!.replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">")
  if (match[1] === "err") throw new Error(`Chrome error:\n${text}`)
  const parsed = JSON.parse(text) as Record<string, { ga: string; eyes: string }>
  const layers = new Map<string, { body: Uint8Array; eyes: Uint8Array }>()
  for (const [key, { ga, eyes }] of Object.entries(parsed)) {
    const rawGa = Uint8Array.from(Buffer.from(ga, "base64"))
    const eyePng = Uint8Array.from(Buffer.from(eyes.slice(eyes.indexOf(",") + 1), "base64"))
    layers.set(key, { body: encodeGrayAlphaPng(rawGa, SIZE, SIZE), eyes: eyePng })
  }
  return layers
}

const files = new Map<string, Uint8Array | string>()
const png = (url: string) => Uint8Array.from(Buffer.from(url.slice(url.indexOf(",") + 1), "base64"))

files.set(
  "presets.json",
  JSON.stringify(
    LOOK_PRESETS.map((preset) => ({ key: preset.key, name: preset.name, color: preset.color, look: preset.look, image: `${preset.key}.png` })),
    null,
    2
  ) + "\n"
)
for (const preset of LOOK_PRESETS) files.set(`${preset.key}.png`, png(await facePng(preset.look, SIZE)))

const fluffy = await bakeFluffyLayers()
const ramps = Object.fromEntries(Object.entries(SKINS).map(([skin, hex]) => [skin, Buffer.from(skinRamp(hex)).toString("base64")]))

const shapes = []
for (const shape of SHAPES) {
  const look = makeLook(shape.key, "peach")
  files.set(`shapes/${shape.key}-body.png`, await encodePng(faceRgba(look, SIZE, "body"), SIZE, SIZE))
  files.set(`shapes/${shape.key}-eyes.png`, await encodePng(faceRgba(look, SIZE, "eyes"), SIZE, SIZE))
  const coat = fluffy.get(shape.key)!
  files.set(`shapes/${shape.key}-fluffy-body.png`, coat.body)
  files.set(`shapes/${shape.key}-fluffy-eyes.png`, coat.eyes)
  // Where the eyes are, as fractions of the picture: they close toward their middle to blink.
  const points = faceOutlines(look).eyes.flatMap((outline) => outline.polygons.flat())
  const ys = points.map(([, y]) => y / 100)
  shapes.push({ key: shape.key, name: shape.name, eyes: { top: Math.min(...ys), bottom: Math.max(...ys) } })
}
files.set("shapes.json", JSON.stringify({ skins: SKINS, ink: EYE_INK, ramps, shapes }, null, 2) + "\n")

for (const target of targets) {
  // Everything here is generated; the README is kept.
  for (const name of ["shapes", ...LOOK_PRESETS.map((preset) => `${preset.key}.png`)]) rmSync(join(target, name), { recursive: true, force: true })
  mkdirSync(join(target, "shapes"), { recursive: true })
  for (const [name, data] of files) writeFileSync(join(target, name), data)
}
const totalBytes = [...files.values()].reduce((sum, data) => sum + (typeof data === "string" ? Buffer.byteLength(data) : data.byteLength), 0)
console.log(`Wrote ${files.size} files (${Math.round(totalBytes / 1024)} KB) to ${targets.length} places.`)
