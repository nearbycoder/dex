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

const UTF8 = new TextDecoder()

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new DecompressionStream("deflate-raw")
  const writer = stream.writable.getWriter()
  const writing = writer.write(data as BufferSource).then(() => writer.close())
  const [buffer] = await Promise.all([new Response(stream.readable).arrayBuffer(), writing])
  return new Uint8Array(buffer)
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
  const entries: { name: string; method: number; file: Uint8Array }[] = []
  for (let n = 0; n < count; n++) {
    const method = view.getUint16(offset + 10, true)
    let size = view.getUint32(offset + 20, true)
    const nameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    let local = view.getUint32(offset + 42, true)
    const name = UTF8.decode(bytes.subarray(offset + 46, offset + 46 + nameLength))
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
    if (method !== 0 && method !== 8) throw new Error(`g2p.npz: unsupported compression ${method}`)
    entries.push({ name, method, file: bytes.subarray(start, start + size) })
  }
  const tensors = await Promise.all(
    entries.map(async ({ name, method, file }) => {
      const inflated = method === 8 ? await inflateRaw(file) : file
      return [name.replace(/\.npy$/, ""), readNpy(inflated, name)] as const
    })
  )
  return new Map(tensors)
}

function readNpy(bytes: Uint8Array, name: string): Tensor {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const major = bytes[6]!
  const headerLength = major === 1 ? view.getUint16(8, true) : view.getUint32(8, true)
  const headerStart = major === 1 ? 10 : 12
  const header = UTF8.decode(bytes.subarray(headerStart, headerStart + headerLength))
  if (!/'descr':\s*'<f4'/.test(header) || /'fortran_order':\s*True/.test(header)) throw new Error(`g2p.npz ${name}: expected little-endian float32 in C order`)
  const shape = (/'shape':\s*\(([^)]*)\)/.exec(header)?.[1] ?? "").split(",").map((part) => part.trim()).filter(Boolean).map(Number)
  const length = shape.reduce((a, b) => a * b, 1)
  const start = headerStart + headerLength
  const data = new Float32Array(length)
  new Uint8Array(data.buffer).set(bytes.subarray(start, start + length * 4))
  return { shape, data }
}

const sigmoid = (x: number) => 1.0 / (1.0 + Math.exp(-x))

/** Pack `(rows, cols)` into 4-row interleaved float64 blocks for sequential 4-way matvec/matmul, plus remaining tail rows. */
interface Packed4 {
  readonly rows: number
  readonly cols: number
  readonly blocks: number
  readonly main: Float64Array // length = blocks * cols * 4
  readonly tail: Float64Array // length = (rows - blocks * 4) * cols
}

function pack4(w: Float32Array, rows: number, cols: number): Packed4 {
  const blocks = rows >> 2
  const main = new Float64Array(blocks * cols * 4)
  let p = 0
  for (let b = 0; b < blocks; b++) {
    const r0 = (b << 2) * cols
    const r1 = r0 + cols
    const r2 = r1 + cols
    const r3 = r2 + cols
    for (let k = 0; k < cols; k++) {
      main[p++] = w[r0 + k]!
      main[p++] = w[r1 + k]!
      main[p++] = w[r2 + k]!
      main[p++] = w[r3 + k]!
    }
  }
  const rem = rows - (blocks << 2)
  const tail = new Float64Array(rem * cols)
  const base = (blocks << 2) * cols
  for (let i = 0; i < tail.length; i++) tail[i] = w[base + i]!
  return { rows, cols, blocks, main, tail }
}

/** Pack `(rows, cols)` into 2-row interleaved float64 blocks for 4-frame × 2-row tiled matmul. */
interface Packed2 {
  readonly rows: number
  readonly cols: number
  readonly pairs: number
  readonly main: Float64Array // length = pairs * cols * 2
  readonly tail: Float64Array // length = (rows & 1) * cols
}

function pack2(w: Float32Array, rows: number, cols: number): Packed2 {
  const pairs = rows >> 1
  const main = new Float64Array(pairs * cols * 2)
  let p = 0
  for (let b = 0; b < pairs; b++) {
    const r0 = (b << 1) * cols
    const r1 = r0 + cols
    for (let k = 0; k < cols; k++) {
      main[p++] = w[r0 + k]!
      main[p++] = w[r1 + k]!
    }
  }
  const rem = rows & 1
  const tail = new Float64Array(rem * cols)
  if (rem) {
    const base = (pairs << 1) * cols
    for (let k = 0; k < cols; k++) tail[k] = w[base + k]!
  }
  return { rows, cols, pairs, main, tail }
}

/** A GRU direction with packed float64 weights for cache-friendly matvec/matmul. */
interface Gru {
  readonly inputs: number
  readonly size: number
  readonly wIh: Packed2
  readonly wHh: Packed4
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
  private readonly outWeight: Packed4
  private readonly outBias: Float64Array
  private readonly outSize: number
  /** Precomputed Layer-0 `wIh @ fround(embed[id] + slot[s]) + bIh` for forward and reverse when convs === 0. */
  private readonly l0Proj: readonly [Float64Array, Float64Array] | null = null
  // Reusable scratch buffers (safe: predict() is synchronous and non-reentrant).
  private scratchA = new Float64Array(0)
  private scratchB = new Float64Array(0)
  private scratchProj = new Float64Array(0)
  private scratchState = new Float64Array(0)
  private scratchNext = new Float64Array(0)
  private scratchRec = new Float64Array(0)

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
    let maxSize = 0
    for (let layer = 0; layer < settings.layers; layer++) {
      const direction = (suffix: string): Gru => {
        const wIh = get(`gru__weight_ih_l${layer}${suffix}`)
        const wHh = get(`gru__weight_hh_l${layer}${suffix}`)
        const inputs = wIh.shape[1]!
        const size = wHh.shape[1]!
        if (size > maxSize) maxSize = size
        return {
          inputs,
          size,
          wIh: pack2(wIh.data, 3 * size, inputs),
          wHh: pack4(wHh.data, 3 * size, size),
          bIh: Float64Array.from(get(`gru__bias_ih_l${layer}${suffix}`).data),
          bHh: Float64Array.from(get(`gru__bias_hh_l${layer}${suffix}`).data)
        }
      }
      this.grus.push([direction(""), direction("_reverse")])
    }
    this.scratchState = new Float64Array(maxSize)
    this.scratchNext = new Float64Array(maxSize)
    this.scratchRec = new Float64Array(maxSize * 3)
    const out = get("out__weight")
    this.outSize = out.shape[0]!
    this.outWeight = pack4(out.data, this.outSize, out.shape[1]!)
    this.outBias = Float64Array.from(get("out__bias").data)

    // When there are no conv blocks (the shipped model), layer 0's input is always `fround(embed[id] + slot[s])`.
    // Precomputing `wIh @ input + bIh` for every (letterId, slot) eliminates all layer-0 input matmuls at runtime.
    if (this.convs.length === 0 && this.grus.length > 0) {
      const vocab = this.embed.shape[0]!
      const width = this.embed.shape[1]!
      const slots = settings.slots
      const [fwd, rev] = this.grus[0]!
      const gates = 3 * fwd.size
      const tableFwd = new Float64Array(vocab * slots * gates)
      const tableRev = new Float64Array(vocab * slots * gates)
      const vec = new Float64Array(width)
      const wFwd = get("gru__weight_ih_l0").data
      const wRev = get("gru__weight_ih_l0_reverse").data
      for (let id = 0; id < vocab; id++) {
        const idOff = id * width
        for (let s = 0; s < slots; s++) {
          const slotOff = s * width
          for (let k = 0; k < width; k++) vec[k] = Math.fround(this.embed.data[idOff + k]! + this.slot.data[slotOff + k]!)
          const base = (id * slots + s) * gates
          for (let r = 0; r < gates; r++) {
            const wOff = r * width
            let sf = fwd.bIh[r]!
            let sr = rev.bIh[r]!
            for (let k = 0; k < width; k++) {
              const v = vec[k]!
              sf += wFwd[wOff + k]! * v
              sr += wRev[wOff + k]! * v
            }
            tableFwd[base + r] = sf
            tableRev[base + r] = sr
          }
        }
      }
      this.l0Proj = [tableFwd, tableRev]
    }
  }

  /** The word reduced to the letters the model knows (accents removed). */
  spellable(word: string): string {
    const plain = word.toLowerCase().normalize("NFKD")
    let out = ""
    for (const c of plain) if (this.letters.has(c)) out += c
    return out.replace(/^'+|'+$/g, "")
  }

  private ensureBuf(which: "A" | "B" | "P", size: number): Float64Array {
    if (which === "A") {
      if (this.scratchA.length < size) this.scratchA = new Float64Array(size)
      return this.scratchA
    }
    if (which === "B") {
      if (this.scratchB.length < size) this.scratchB = new Float64Array(size)
      return this.scratchB
    }
    if (this.scratchProj.length < size) this.scratchProj = new Float64Array(size)
    return this.scratchProj
  }

  /** Flat frame buffer `(T, dim)` after embedding, convs, and BiGRU layers. */
  private encode(word: string): { frames: Float64Array; count: number; dim: number } {
    const slots = this.settings.slots
    const width = this.embed.shape[1]!
    const count = word.length * slots

    // Fast path: no conv blocks -> use precomputed layer-0 input projections directly.
    let startLayer = 0
    let frames: Float64Array
    let dim: number
    if (this.l0Proj !== null) {
      const [fwd, rev] = this.grus[0]!
      const [tableFwd, tableRev] = this.l0Proj
      const size = fwd.size
      const gates = 3 * size
      const nextDim = size * 2
      frames = this.ensureBuf("A", count * nextDim)
      const proj = this.ensureBuf("P", count * gates)
      // Gather precomputed forward projections and run forward GRU.
      let t = 0
      for (let cIdx = 0; cIdx < word.length; cIdx++) {
        const c = word[cIdx]!
        const id = this.letters.get(c)
        if (id === undefined) throw new ValueError(`unknown letter ${c}`)
        const srcBase = id * slots * gates
        proj.set(tableFwd.subarray(srcBase, srcBase + slots * gates), t * gates)
        t += slots
      }
      gruRecur(proj, count, fwd, false, frames, nextDim, 0, this.scratchState, this.scratchNext, this.scratchRec)
      // Gather precomputed backward projections and run backward GRU.
      t = 0
      for (let cIdx = 0; cIdx < word.length; cIdx++) {
        const id = this.letters.get(word[cIdx]!)!
        const srcBase = id * slots * gates
        proj.set(tableRev.subarray(srcBase, srcBase + slots * gates), t * gates)
        t += slots
      }
      gruRecur(proj, count, rev, true, frames, nextDim, size, this.scratchState, this.scratchNext, this.scratchRec)
      dim = nextDim
      startLayer = 1
    } else {
      frames = this.ensureBuf("A", count * width)
      dim = width
      const embedData = this.embed.data
      const slotData = this.slot.data
      let rowIdx = 0
      for (let cIdx = 0; cIdx < word.length; cIdx++) {
        const c = word[cIdx]!
        const id = this.letters.get(c)
        if (id === undefined) throw new ValueError(`unknown letter ${c}`)
        const idOff = id * width
        for (let s = 0; s < slots; s++) {
          const slotOff = s * width
          const dstOff = rowIdx * width
          for (let k = 0; k < width; k++) frames[dstOff + k] = Math.fround(embedData[idOff + k]! + slotData[slotOff + k]!)
          rowIdx++
        }
      }
      if (this.convs.length) {
        let rows: Float64Array[] = new Array(count)
        for (let t = 0; t < count; t++) rows[t] = frames.subarray(t * dim, (t + 1) * dim)
        for (const conv of this.convs) rows = convBlock(rows, conv)
        dim = rows[0]?.length ?? dim
        frames = this.ensureBuf("B", count * dim)
        for (let t = 0; t < count; t++) frames.set(rows[t]!, t * dim)
      }
    }

    for (let layer = startLayer; layer < this.grus.length; layer++) {
      const [forward, backward] = this.grus[layer]!
      const size = forward.size
      const gates = 3 * size
      const nextDim = size * 2
      const combined = frames === this.scratchA ? this.ensureBuf("B", count * nextDim) : this.ensureBuf("A", count * nextDim)
      const proj = this.ensureBuf("P", count * gates)
      projectAll(frames, count, dim, forward.wIh, forward.bIh, proj)
      gruRecur(proj, count, forward, false, combined, nextDim, 0, this.scratchState, this.scratchNext, this.scratchRec)
      projectAll(frames, count, dim, backward.wIh, backward.bIh, proj)
      gruRecur(proj, count, backward, true, combined, nextDim, size, this.scratchState, this.scratchNext, this.scratchRec)
      frames = combined
      dim = nextDim
    }
    return { frames, count, dim }
  }

  /** CMUdict symbols with stress digits for ``word`` (letters and apostrophes). */
  predict(word: string, alreadySpellable = false): string[] {
    const spelling = alreadySpellable ? word : this.spellable(word)
    if (!spelling) return []
    const { frames, count, dim } = this.encode(spelling)
    const out: string[] = []
    let previous = 0
    const { blocks, main, tail } = this.outWeight
    const outBias = this.outBias
    const outSize = this.outSize
    for (let t = 0; t < count; t++) {
      const fOff = t * dim
      let bestLabel = 0
      let bestScore = -Infinity
      let p = 0
      for (let b = 0; b < blocks; b++) {
        const o = b << 2
        let s0 = outBias[o]!
        let s1 = outBias[o + 1]!
        let s2 = outBias[o + 2]!
        let s3 = outBias[o + 3]!
        for (let k = 0; k < dim; k++) {
          const fv = frames[fOff + k]!
          s0 += main[p]! * fv
          s1 += main[p + 1]! * fv
          s2 += main[p + 2]! * fv
          s3 += main[p + 3]! * fv
          p += 4
        }
        if (s0 > bestScore) { bestScore = s0; bestLabel = o }
        if (s1 > bestScore) { bestScore = s1; bestLabel = o + 1 }
        if (s2 > bestScore) { bestScore = s2; bestLabel = o + 2 }
        if (s3 > bestScore) { bestScore = s3; bestLabel = o + 3 }
      }
      const tailStart = blocks << 2
      for (let o = tailStart; o < outSize; o++) {
        const tOff = (o - tailStart) * dim
        let s = outBias[o]!
        for (let k = 0; k < dim; k++) s += tail[tOff + k]! * frames[fOff + k]!
        if (s > bestScore) { bestScore = s; bestLabel = o }
      }
      if (bestLabel !== previous && bestLabel !== 0) out.push(this.symbols[bestLabel - 1]!)
      previous = bestLabel
    }
    return out
  }
}

/** Tiled 4-frame × 2-row projection: `proj[t, r] = w[r] · x[t] + b[r]`, quartering weight bandwidth. */
function projectAll(x: Float64Array, count: number, cols: number, w: Packed2, bias: Float64Array, proj: Float64Array): void {
  const { rows, pairs, main, tail } = w
  let t = 0
  for (; t + 3 < count; t += 4) {
    const x0 = t * cols
    const x1 = x0 + cols
    const x2 = x1 + cols
    const x3 = x2 + cols
    const p0 = t * rows
    const p1 = p0 + rows
    const p2 = p1 + rows
    const p3 = p2 + rows
    let m = 0
    for (let b = 0; b < pairs; b++) {
      const r = b << 1
      const br0 = bias[r]!
      const br1 = bias[r + 1]!
      let a0 = br0, a1 = br1
      let b0 = br0, b1 = br1
      let c0 = br0, c1 = br1
      let d0 = br0, d1 = br1
      for (let k = 0; k < cols; k++) {
        const w0 = main[m]!
        const w1 = main[m + 1]!
        m += 2
        const v0 = x[x0 + k]!
        const v1 = x[x1 + k]!
        const v2 = x[x2 + k]!
        const v3 = x[x3 + k]!
        a0 += w0 * v0; a1 += w1 * v0
        b0 += w0 * v1; b1 += w1 * v1
        c0 += w0 * v2; c1 += w1 * v2
        d0 += w0 * v3; d1 += w1 * v3
      }
      proj[p0 + r] = a0; proj[p0 + r + 1] = a1
      proj[p1 + r] = b0; proj[p1 + r + 1] = b1
      proj[p2 + r] = c0; proj[p2 + r + 1] = c1
      proj[p3 + r] = d0; proj[p3 + r + 1] = d1
    }
    if (rows & 1) {
      const r = rows - 1
      const br = bias[r]!
      let a = br, b = br, c = br, d = br
      for (let k = 0; k < cols; k++) {
        const wv = tail[k]!
        a += wv * x[x0 + k]!
        b += wv * x[x1 + k]!
        c += wv * x[x2 + k]!
        d += wv * x[x3 + k]!
      }
      proj[p0 + r] = a
      proj[p1 + r] = b
      proj[p2 + r] = c
      proj[p3 + r] = d
    }
  }
  for (; t < count; t++) {
    const x0 = t * cols
    const p0 = t * rows
    let m = 0
    for (let b = 0; b < pairs; b++) {
      const r = b << 1
      let s0 = bias[r]!
      let s1 = bias[r + 1]!
      for (let k = 0; k < cols; k++) {
        const v = x[x0 + k]!
        s0 += main[m]! * v
        s1 += main[m + 1]! * v
        m += 2
      }
      proj[p0 + r] = s0
      proj[p0 + r + 1] = s1
    }
    if (rows & 1) {
      const r = rows - 1
      let s = bias[r]!
      for (let k = 0; k < cols; k++) s += tail[k]! * x[x0 + k]!
      proj[p0 + r] = s
    }
  }
}

/** 4-row interleaved recurrent matvec + GRU cell update over `count` steps. */
function gruRecur(
  projected: Float64Array,
  count: number,
  g: Gru,
  reverse: boolean,
  dest: Float64Array,
  destStride: number,
  destOffset: number,
  stateBuf: Float64Array,
  nextBuf: Float64Array,
  recurrent: Float64Array
): void {
  const { size, wHh, bHh } = g
  const gates = 3 * size
  const { blocks, main, tail } = wHh
  const tailStart = blocks << 2
  let state = stateBuf
  let next = nextBuf
  state.fill(0, 0, size)
  for (let n = 0; n < count; n++) {
    const t = reverse ? count - 1 - n : n
    const pOff = t * gates
    // First step has state === 0, so recurrent === bHh (skip the entire matvec!).
    if (n === 0) {
      for (let r = 0; r < gates; r++) recurrent[r] = bHh[r]!
    } else {
      let p = 0
      for (let b = 0; b < blocks; b++) {
        const r = b << 2
        let s0 = bHh[r]!
        let s1 = bHh[r + 1]!
        let s2 = bHh[r + 2]!
        let s3 = bHh[r + 3]!
        for (let k = 0; k < size; k++) {
          const sv = state[k]!
          s0 += main[p]! * sv
          s1 += main[p + 1]! * sv
          s2 += main[p + 2]! * sv
          s3 += main[p + 3]! * sv
          p += 4
        }
        recurrent[r] = s0
        recurrent[r + 1] = s1
        recurrent[r + 2] = s2
        recurrent[r + 3] = s3
      }
      for (let r = tailStart; r < gates; r++) {
        const tOff = (r - tailStart) * size
        let s = bHh[r]!
        for (let k = 0; k < size; k++) s += tail[tOff + k]! * state[k]!
        recurrent[r] = s
      }
    }
    const dOff = t * destStride + destOffset
    const size2 = size << 1
    for (let k = 0; k < size; k++) {
      const reset = sigmoid(projected[pOff + k]! + recurrent[k]!)
      const update = sigmoid(projected[pOff + size + k]! + recurrent[size + k]!)
      const candidate = Math.tanh(projected[pOff + size2 + k]! + reset * recurrent[size2 + k]!)
      const val = (1.0 - update) * candidate + update * state[k]!
      next[k] = val
      dest[dOff + k] = val
    }
    const tmp = state
    state = next
    next = tmp
  }
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
