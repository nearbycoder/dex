// The unknown-word model: letters -> CMUdict phonemes, one forward pass per word (dizione's g2p.py). Letter
// embeddings, residual convolutions, a bidirectional GRU and a CTC output read greedily.

import { ValueError } from "./py.ts"

interface Settings {
  readonly letters: string
  readonly symbols: readonly string[]
  readonly slots: number
  readonly convs: number
  readonly layers: number
}

interface Tensor {
  readonly shape: readonly number[]
  readonly data: Float32Array
}

/** The arrays of an .npz file (a zip of .npy files, stored or deflated). */
export async function readNpz(bytes: Uint8Array): Promise<Map<string, Tensor>> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let directory = -1
  for (let k = bytes.length - 22; k >= Math.max(0, bytes.length - 65_557); k--) {
    if (view.getUint32(k, true) === 0x06054b50) {
      directory = k
      break
    }
  }
  if (directory < 0) throw new Error("g2p.npz is not a zip file")
  const count = view.getUint16(directory + 10, true)
  let offset = view.getUint32(directory + 16, true)
  const out = new Map<string, Tensor>()
  for (let n = 0; n < count; n++) {
    const method = view.getUint16(offset + 10, true)
    let size = view.getUint32(offset + 20, true)
    const nameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    let local = view.getUint32(offset + 42, true)
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength))
    // ZIP64 sizes and offsets live in the extra field when the 32-bit ones are full.
    if (size === 0xffffffff || local === 0xffffffff) {
      let field = offset + 46 + nameLength
      const fieldEnd = field + extraLength
      while (field < fieldEnd) {
        const id = view.getUint16(field, true)
        const length = view.getUint16(field + 2, true)
        if (id === 1) {
          let at = field + 4
          if (view.getUint32(offset + 24, true) === 0xffffffff) at += 8
          if (size === 0xffffffff) {
            size = Number(view.getBigUint64(at, true))
            at += 8
          }
          if (local === 0xffffffff) local = Number(view.getBigUint64(at, true))
        }
        field += 4 + length
      }
    }
    offset += 46 + nameLength + extraLength + commentLength
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true)
    let file = bytes.subarray(start, start + size)
    if (method === 8) file = new Uint8Array(await new Response(new Response(new Uint8Array(file)).body!.pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer())
    else if (method !== 0) throw new Error(`g2p.npz: unsupported compression ${method}`)
    out.set(name.replace(/\.npy$/, ""), readNpy(file, name))
  }
  return out
}

function readNpy(bytes: Uint8Array, name: string): Tensor {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const major = bytes[6]!
  const headerLength = major === 1 ? view.getUint16(8, true) : view.getUint32(8, true)
  const headerStart = major === 1 ? 10 : 12
  const header = new TextDecoder().decode(bytes.subarray(headerStart, headerStart + headerLength))
  if (!/'descr':\s*'<f4'/.test(header) || /'fortran_order':\s*True/.test(header)) throw new Error(`g2p.npz ${name}: expected little-endian float32 in C order`)
  const shape = (/'shape':\s*\(([^)]*)\)/.exec(header)?.[1] ?? "").split(",").map((part) => part.trim()).filter(Boolean).map(Number)
  const length = shape.reduce((a, b) => a * b, 1)
  const start = headerStart + headerLength
  const data = new Float32Array(length)
  new Uint8Array(data.buffer).set(bytes.subarray(start, start + length * 4))
  return { shape, data }
}

const sigmoid = (x: number) => 1.0 / (1.0 + Math.exp(-x))

/** A GRU direction with its weights as float64, transposed for row-major products. */
interface Gru {
  readonly inputs: number
  readonly size: number
  readonly wIh: Float32Array // (3 * size, inputs)
  readonly wHh: Float32Array // (3 * size, size)
  readonly bIh: Float64Array
  readonly bHh: Float64Array
}

export class Model {
  private readonly settings: Settings
  private readonly letters: Map<string, number>
  private readonly symbols: readonly string[]
  private readonly embed: Tensor
  private readonly slot: Tensor
  private readonly convs: { normWeight: Tensor; normBias: Tensor; weight: Tensor; bias: Tensor }[] = []
  private readonly grus: [Gru, Gru][] = []
  private readonly outWeight: Float32Array
  private readonly outBias: Float64Array
  private readonly outSize: number

  constructor(settings: Settings, weights: Map<string, Tensor>) {
    this.settings = settings
    this.letters = new Map([...settings.letters].map((letter, index) => [letter, index + 1]))
    this.symbols = settings.symbols
    const get = (name: string) => {
      const tensor = weights.get(name)
      if (!tensor) throw new Error(`g2p.npz has no ${name}`)
      return tensor
    }
    this.embed = get("embed__weight")
    this.slot = get("slot")
    for (let block = 0; block < settings.convs; block++) {
      this.convs.push({ normWeight: get(`norms__${block}__weight`), normBias: get(`norms__${block}__bias`),
        weight: get(`convs__${block}__weight`), bias: get(`convs__${block}__bias`) })
    }
    for (let layer = 0; layer < settings.layers; layer++) {
      const direction = (suffix: string): Gru => {
        const wIh = get(`gru__weight_ih_l${layer}${suffix}`)
        const wHh = get(`gru__weight_hh_l${layer}${suffix}`)
        return { inputs: wIh.shape[1]!, size: wHh.shape[1]!, wIh: wIh.data, wHh: wHh.data,
          bIh: Float64Array.from(get(`gru__bias_ih_l${layer}${suffix}`).data), bHh: Float64Array.from(get(`gru__bias_hh_l${layer}${suffix}`).data) }
      }
      this.grus.push([direction(""), direction("_reverse")])
    }
    const out = get("out__weight")
    this.outSize = out.shape[0]!
    this.outWeight = out.data
    this.outBias = Float64Array.from(get("out__bias").data)
  }

  /** The word reduced to the letters the model knows (accents removed). */
  spellable(word: string): string {
    const plain = word.toLowerCase().normalize("NFKD")
    let out = ""
    for (const c of plain) if (this.letters.has(c)) out += c
    return out.replace(/^'+|'+$/g, "")
  }

  /** Scores of every label (blank first) for every frame. The argmax of these is the argmax of the original's log
   * probabilities. */
  private logits(word: string): Float64Array[] {
    const slots = this.settings.slots
    const width = this.embed.shape[1]!
    let frames: Float64Array[] = []
    for (const c of word) {
      const id = this.letters.get(c)
      if (id === undefined) throw new ValueError(`unknown letter ${c}`)
      for (let s = 0; s < slots; s++) {
        const row = new Float64Array(width)
        for (let k = 0; k < width; k++) row[k] = Math.fround(this.embed.data[id * width + k]! + this.slot.data[s * width + k]!)
        frames.push(row)
      }
    }
    for (const conv of this.convs) frames = convBlock(frames, conv)
    for (const [forward, backward] of this.grus) {
      const one = gru(frames, forward, false)
      const two = gru(frames, backward, true)
      frames = frames.map((_, t) => {
        const both = new Float64Array(one[t]!.length + two[t]!.length)
        both.set(one[t]!)
        both.set(two[t]!, one[t]!.length)
        return both
      })
    }
    return frames.map((x) => {
      const logits = new Float64Array(this.outSize)
      for (let o = 0; o < this.outSize; o++) logits[o] = dot(this.outWeight, o * x.length, x, x.length) + this.outBias[o]!
      return logits
    })
  }

  /** CMUdict symbols with stress digits for ``word`` (letters and apostrophes). */
  predict(word: string): string[] {
    const spelling = this.spellable(word)
    if (!spelling) return []
    const out: string[] = []
    let previous = 0
    for (const logits of this.logits(spelling)) {
      let label = 0
      for (let k = 1; k < logits.length; k++) if (logits[k]! > logits[label]!) label = k
      if (label !== previous && label !== 0) out.push(this.symbols[label - 1]!)
      previous = label
    }
    return out
  }
}

/** The dot product of ``a`` from ``offset`` and ``b`` from 0, over ``length`` values (four sums, for speed). */
function dot(a: Float32Array, offset: number, b: Float64Array, length: number): number {
  let s0 = 0
  let s1 = 0
  let s2 = 0
  let s3 = 0
  let k = 0
  for (; k + 3 < length; k += 4) {
    s0 += a[offset + k]! * b[k]!
    s1 += a[offset + k + 1]! * b[k + 1]!
    s2 += a[offset + k + 2]! * b[k + 2]!
    s3 += a[offset + k + 3]! * b[k + 3]!
  }
  for (; k < length; k++) s0 += a[offset + k]! * b[k]!
  return s0 + s1 + s2 + s3
}

function gru(x: readonly Float64Array[], g: Gru, reverse: boolean): Float64Array[] {
  const { size, inputs } = g
  const gates = 3 * size
  const projected = x.map((frame) => {
    const input = new Float64Array(gates)
    for (let r = 0; r < gates; r++) input[r] = dot(g.wIh, r * inputs, frame, inputs) + g.bIh[r]!
    return input
  })
  const out: Float64Array[] = new Array(x.length)
  let state = new Float64Array(size)
  const recurrent = new Float64Array(gates)
  for (let n = 0; n < x.length; n++) {
    const t = reverse ? x.length - 1 - n : n
    const input = projected[t]!
    for (let r = 0; r < gates; r++) recurrent[r] = dot(g.wHh, r * size, state, size) + g.bHh[r]!
    const next = new Float64Array(size)
    for (let k = 0; k < size; k++) {
      const reset = sigmoid(input[k]! + recurrent[k]!)
      const update = sigmoid(input[size + k]! + recurrent[size + k]!)
      const candidate = Math.tanh(input[2 * size + k]! + reset * recurrent[2 * size + k]!)
      next[k] = (1.0 - update) * candidate + update * state[k]!
    }
    state = next
    out[t] = next
  }
  return out
}

/** A residual block: layer norm, a zero-padded convolution, ReLU (unused by the shipped model, which has none). */
function convBlock(x: readonly Float64Array[], conv: { normWeight: Tensor; normBias: Tensor; weight: Tensor; bias: Tensor }): Float64Array[] {
  const [outputs, inputs, kernel] = conv.weight.shape as [number, number, number]
  const pad = Math.floor(kernel / 2)
  const normed = x.map((row) => {
    let mean = 0
    for (const v of row) mean += v
    mean /= row.length
    let variance = 0
    for (const v of row) variance += (v - mean) ** 2
    variance /= row.length
    return row.map((v, k) => ((v - mean) / Math.sqrt(variance + 1e-5)) * conv.normWeight.data[k]! + conv.normBias.data[k]!)
  })
  return x.map((row, t) => {
    const out = new Float64Array(outputs)
    for (let o = 0; o < outputs; o++) {
      let total = conv.bias.data[o]!
      for (let k = 0; k < kernel; k++) {
        const source = normed[t + k - pad]
        if (!source) continue
        for (let i = 0; i < inputs; i++) total += source[i]! * conv.weight.data[(o * inputs + i) * kernel + k]!
      }
      out[o] = row[o]! + Math.max(total, 0)
    }
    return out
  })
}
