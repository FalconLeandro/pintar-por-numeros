import { MAX_EDGE } from '../constants.ts'
import type { RegionInfo, Rgb, WorkerIn, WorkerOut } from '../types.ts'
import { clampByte, rgbToLab } from '../utils/color.ts'
import { computeLabelPoints } from '../utils/polylabel.ts'

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerIn>) => void) | null
  postMessage: (data: WorkerOut, transfer?: Transferable[]) => void
}

const yieldToUi = () => new Promise((resolve) => setTimeout(resolve, 0))

function flattenAlpha(pixels: Uint8ClampedArray) {
  for (let index = 0; index < pixels.length; index += 4) {
    const alpha = pixels[index + 3]
    if (alpha >= 250) {
      pixels[index + 3] = 255
      continue
    }
    const cover = alpha / 255
    pixels[index] = clampByte(pixels[index] * cover + 255 * (1 - cover))
    pixels[index + 1] = clampByte(pixels[index + 1] * cover + 255 * (1 - cover))
    pixels[index + 2] = clampByte(pixels[index + 2] * cover + 255 * (1 - cover))
    pixels[index + 3] = 255
  }
}

function rasterize(bitmap: ImageBitmap) {
  const maxSide = Math.max(bitmap.width, bitmap.height)
  const scale = maxSide > MAX_EDGE ? MAX_EDGE / maxSide : 1
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = new OffscreenCanvas(width, height)
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('No se pudo preparar el lienzo de conversión')
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()
  return { width, height, rgba: context.getImageData(0, 0, width, height).data }
}

/** Light bilateral smooth. Range weights are integers so a full 800px pass stays cheap. */
function bilateral(src: Uint8ClampedArray, width: number, height: number) {
  const count = width * height
  const red = new Uint8Array(count)
  const green = new Uint8Array(count)
  const blue = new Uint8Array(count)
  for (let index = 0, pixel = 0; index < count; index += 1, pixel += 4) {
    red[index] = src[pixel]
    green[index] = src[pixel + 1]
    blue[index] = src[pixel + 2]
  }

  const dst = new Uint8ClampedArray(src.length)
  for (let y = 0; y < height; y += 1) {
    const row = y * width
    const up = y > 0 ? -width : 0
    const down = y + 1 < height ? width : 0
    for (let x = 0; x < width; x += 1) {
      const index = row + x
      const cr = red[index]
      const cg = green[index]
      const cb = blue[index]
      const left = x > 0 ? -1 : 0
      const right = x + 1 < width ? 1 : 0
      let rs = 0
      let gs = 0
      let bs = 0
      let weightSum = 0
      for (let offsetY = up; offsetY <= down; offsetY += width) {
        for (let offsetX = left; offsetX <= right; offsetX += 1) {
          const neighbor = index + offsetY + offsetX
          const dr = red[neighbor] - cr
          const dg = green[neighbor] - cg
          const db = blue[neighbor] - cb
          const distance = dr * dr + dg * dg + db * db
          if (distance > 6800) continue
          const spatial = offsetX === 0 && offsetY === 0 ? 5 : offsetX === 0 || offsetY === 0 ? 3 : 2
          const weight = spatial * (64 - Math.min(63, distance >> 7))
          rs += red[neighbor] * weight
          gs += green[neighbor] * weight
          bs += blue[neighbor] * weight
          weightSum += weight
        }
      }
      const pixel = index * 4
      dst[pixel] = rs / weightSum
      dst[pixel + 1] = gs / weightSum
      dst[pixel + 2] = bs / weightSum
      dst[pixel + 3] = 255
    }
  }
  return dst
}

interface Quantized {
  palette: Rgb[]
  colorMap: Uint8Array
}

function quantize(src: Uint8ClampedArray, width: number, height: number, colorCount: number): Quantized {
  const n = width * height
  const stride = Math.max(1, Math.floor(n / 7000))
  let sampleCount = 0
  for (let index = 0; index < n; index += stride) sampleCount += 1

  const sR = new Uint8Array(sampleCount)
  const sG = new Uint8Array(sampleCount)
  const sB = new Uint8Array(sampleCount)
  const sL = new Float32Array(sampleCount)
  const sA = new Float32Array(sampleCount)
  const sBb = new Float32Array(sampleCount)
  let cursor = 0
  let meanR = 0
  let meanG = 0
  let meanB = 0
  for (let index = 0; index < n; index += stride) {
    const p = index * 4
    sR[cursor] = src[p]
    sG[cursor] = src[p + 1]
    sB[cursor] = src[p + 2]
    const lab = rgbToLab(src[p], src[p + 1], src[p + 2])
    sL[cursor] = lab.l
    sA[cursor] = lab.a
    sBb[cursor] = lab.b
    meanR += src[p]
    meanG += src[p + 1]
    meanB += src[p + 2]
    cursor += 1
  }
  meanR /= sampleCount
  meanG /= sampleCount
  meanB /= sampleCount

  const k = Math.min(colorCount, sampleCount)
  const cR = new Float64Array(k)
  const cG = new Float64Array(k)
  const cB = new Float64Array(k)
  const cL = new Float64Array(k)
  const cA = new Float64Array(k)
  const cBb = new Float64Array(k)

  const writeCentroid = (slot: number, sample: number) => {
    cR[slot] = sR[sample]
    cG[slot] = sG[sample]
    cB[slot] = sB[sample]
    cL[slot] = sL[sample]
    cA[slot] = sA[sample]
    cBb[slot] = sBb[sample]
  }

  let first = 0
  let firstDist = Infinity
  for (let sample = 0; sample < sampleCount; sample += 1) {
    const dr = sR[sample] - meanR
    const dg = sG[sample] - meanG
    const db = sB[sample] - meanB
    const dist = dr * dr + dg * dg + db * db
    if (dist < firstDist) {
      firstDist = dist
      first = sample
    }
  }
  writeCentroid(0, first)

  const minDist = new Float64Array(sampleCount)
  minDist.fill(Number.POSITIVE_INFINITY)
  let actualK = 1
  for (let slot = 1; slot < k; slot += 1) {
    let far = -1
    let farDist = -1
    const last = slot - 1
    for (let sample = 0; sample < sampleCount; sample += 1) {
      const dl = sL[sample] - cL[last]
      const da = sA[sample] - cA[last]
      const db = sBb[sample] - cBb[last]
      const dist = dl * dl + da * da + db * db
      if (dist < minDist[sample]) minDist[sample] = dist
      if (minDist[sample] > farDist) {
        farDist = minDist[sample]
        far = sample
      }
    }
    if (far < 0 || farDist < 1) break
    writeCentroid(slot, far)
    actualK = slot + 1
  }

  const assign = new Uint8Array(sampleCount)
  for (let iteration = 0; iteration < 12; iteration += 1) {
    const sumR = new Float64Array(actualK)
    const sumG = new Float64Array(actualK)
    const sumB = new Float64Array(actualK)
    const counts = new Int32Array(actualK)
    for (let sample = 0; sample < sampleCount; sample += 1) {
      let best = 0
      let bestDist = Infinity
      for (let slot = 0; slot < actualK; slot += 1) {
        const dl = sL[sample] - cL[slot]
        const da = sA[sample] - cA[slot]
        const db = sBb[sample] - cBb[slot]
        const dist = dl * dl + da * da + db * db
        if (dist < bestDist) {
          bestDist = dist
          best = slot
        }
      }
      assign[sample] = best
      sumR[best] += sR[sample]
      sumG[best] += sG[sample]
      sumB[best] += sB[sample]
      counts[best] += 1
    }

    for (let slot = 0; slot < actualK; slot += 1) {
      if (counts[slot] !== 0) continue
      let far = -1
      let farDist = -1
      for (let sample = 0; sample < sampleCount; sample += 1) {
        const owner = assign[sample]
        const dl = sL[sample] - cL[owner]
        const da = sA[sample] - cA[owner]
        const db = sBb[sample] - cBb[owner]
        const dist = dl * dl + da * da + db * db
        if (dist > farDist) {
          farDist = dist
          far = sample
        }
      }
      if (far < 0 || farDist < 0.5) continue
      const owner = assign[far]
      sumR[owner] -= sR[far]
      sumG[owner] -= sG[far]
      sumB[owner] -= sB[far]
      counts[owner] -= 1
      assign[far] = slot
      sumR[slot] = sR[far]
      sumG[slot] = sG[far]
      sumB[slot] = sB[far]
      counts[slot] = 1
    }

    let moved = 0
    for (let slot = 0; slot < actualK; slot += 1) {
      if (counts[slot] === 0) continue
      const nr = sumR[slot] / counts[slot]
      const ng = sumG[slot] / counts[slot]
      const nb = sumB[slot] / counts[slot]
      const lab = rgbToLab(nr, ng, nb)
      moved = Math.max(
        moved,
        Math.abs(lab.l - cL[slot]),
        Math.abs(lab.a - cA[slot]),
        Math.abs(lab.b - cBb[slot]),
      )
      cR[slot] = nr
      cG[slot] = ng
      cB[slot] = nb
      cL[slot] = lab.l
      cA[slot] = lab.a
      cBb[slot] = lab.b
    }
    if (moved < 0.35) break
  }

  const lastCounts = new Int32Array(actualK)
  for (let sample = 0; sample < sampleCount; sample += 1) {
    let best = 0
    let bestDist = Infinity
    for (let slot = 0; slot < actualK; slot += 1) {
      const dl = sL[sample] - cL[slot]
      const da = sA[sample] - cA[slot]
      const db = sBb[sample] - cBb[slot]
      const dist = dl * dl + da * da + db * db
      if (dist < bestDist) {
        bestDist = dist
        best = slot
      }
    }
    lastCounts[best] += 1
  }
  const used: number[] = []
  for (let slot = 0; slot < actualK; slot += 1) {
    if (lastCounts[slot] > 0) used.push(slot)
  }
  if (used.length === 0) used.push(0)

  const order = used.slice().sort((a, b) => {
    const ha = Math.atan2(cBb[a], cA[a])
    const hb = Math.atan2(cBb[b], cA[b])
    if (ha !== hb) return ha - hb
    if (cL[a] !== cL[b]) return cL[b] - cL[a]
    return a - b
  })
  const remap = new Uint8Array(actualK)
  const palette: Rgb[] = []
  order.forEach((old, newIndex) => {
    remap[old] = newIndex
    palette.push({
      r: clampByte(cR[old]),
      g: clampByte(cG[old]),
      b: clampByte(cB[old]),
    })
  })

  const lut = new Uint8Array(32 * 32 * 32)
  for (let r = 0; r < 32; r += 1) {
    const red = r * 8 + 4
    for (let g = 0; g < 32; g += 1) {
      const green = g * 8 + 4
      for (let b = 0; b < 32; b += 1) {
        const blue = b * 8 + 4
        let best = used[0]
        let bestDist = Infinity
        for (let slot = 0; slot < used.length; slot += 1) {
          const old = used[slot]
          const dr = red - cR[old]
          const dg = green - cG[old]
          const db = blue - cB[old]
          const dist = dr * dr * 2 + dg * dg * 4 + db * db
          if (dist < bestDist) {
            bestDist = dist
            best = old
          }
        }
        lut[(r << 10) | (g << 5) | b] = remap[best]
      }
    }
  }

  const colorMap = new Uint8Array(n)
  for (let index = 0; index < n; index += 1) {
    const p = index * 4
    colorMap[index] = lut[((src[p] >> 3) << 10) | ((src[p + 1] >> 3) << 5) | (src[p + 2] >> 3)]
  }
  return { palette, colorMap }
}

function majorityPass(src: Uint8Array, width: number, height: number) {
  const dst = new Uint8Array(src.length)
  const count = new Int16Array(32)
  const touched = new Int16Array(9)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x
      let seen = 0
      for (let ky = -1; ky <= 1; ky += 1) {
        const yy = y + ky
        if (yy < 0 || yy >= height) continue
        const row = yy * width
        for (let kx = -1; kx <= 1; kx += 1) {
          const xx = x + kx
          if (xx < 0 || xx >= width) continue
          const color = src[row + xx]
          if (count[color] === 0) {
            touched[seen] = color
            seen += 1
          }
          count[color] += 1
        }
      }
      const current = src[i]
      let best = current
      let bestCount = -1
      for (let t = 0; t < seen; t += 1) {
        const color = touched[t]
        const hits = count[color]
        if (hits > bestCount || (hits === bestCount && color === current)) {
          best = color
          bestCount = hits
        }
      }
      dst[i] = best
      for (let t = 0; t < seen; t += 1) count[touched[t]] = 0
    }
  }
  return dst
}

function labelComponents(colorMap: Uint8Array, width: number, height: number) {
  const n = width * height
  const labels = new Uint32Array(n)
  const queue = new Int32Array(n)
  let nextId = 1
  for (let index = 0; index < n; index += 1) {
    if (labels[index] !== 0) continue
    const color = colorMap[index]
    let head = 0
    let tail = 0
    labels[index] = nextId
    queue[tail] = index
    tail += 1
    while (head < tail) {
      const current = queue[head]
      head += 1
      const x = current % width
      const y = (current / width) | 0
      if (x > 0) {
        const neighbor = current - 1
        if (labels[neighbor] === 0 && colorMap[neighbor] === color) {
          labels[neighbor] = nextId
          queue[tail] = neighbor
          tail += 1
        }
      }
      if (x + 1 < width) {
        const neighbor = current + 1
        if (labels[neighbor] === 0 && colorMap[neighbor] === color) {
          labels[neighbor] = nextId
          queue[tail] = neighbor
          tail += 1
        }
      }
      if (y > 0) {
        const neighbor = current - width
        if (labels[neighbor] === 0 && colorMap[neighbor] === color) {
          labels[neighbor] = nextId
          queue[tail] = neighbor
          tail += 1
        }
      }
      if (y + 1 < height) {
        const neighbor = current + width
        if (labels[neighbor] === 0 && colorMap[neighbor] === color) {
          labels[neighbor] = nextId
          queue[tail] = neighbor
          tail += 1
        }
      }
    }
    nextId += 1
  }
  return { labels, count: nextId - 1 }
}

function mergeSmallRegions(
  labels: Uint32Array,
  count: number,
  colorMap: Uint8Array,
  width: number,
  height: number,
  minRegion: number,
  allowEqual: boolean,
) {
  const size = new Uint32Array(count + 1)
  const colorOf = new Uint8Array(count + 1)
  for (let index = 0; index < labels.length; index += 1) {
    const id = labels[index]
    size[id] += 1
    colorOf[id] = colorMap[index]
  }

  if (count > 25000) {
    const next = new Uint8Array(colorMap)
    let changed = false
    const n = width * height
    for (let index = 0; index < n; index += 1) {
      const id = labels[index]
      if (size[id] === 0 || size[id] >= minRegion) continue
      const x = index % width
      const y = (index / width) | 0
      let bestColor = colorMap[index]
      let bestSize = -1
      const consider = (neighbor: number) => {
        const nid = labels[neighbor]
        if (size[nid] > bestSize) {
          bestSize = size[nid]
          bestColor = colorMap[neighbor]
        }
      }
      if (x > 0) consider(index - 1)
      if (x + 1 < width) consider(index + 1)
      if (y > 0) consider(index - width)
      if (y + 1 < height) consider(index + width)
      if (bestColor !== colorMap[index]) {
        next[index] = bestColor
        changed = true
      }
    }
    if (changed) colorMap.set(next)
    return changed
  }

  const stride = count + 1
  const weights = new Map<number, number>()
  const bump = (from: number, to: number) => {
    if (size[from] === 0 || size[from] >= minRegion) return
    if (size[to] < size[from]) return
    if (size[to] === size[from] && (!allowEqual || to >= from)) return
    const key = from * stride + to
    weights.set(key, (weights.get(key) ?? 0) + 1)
  }

  const n = width * height
  for (let index = 0; index < n; index += 1) {
    const x = index % width
    const y = (index / width) | 0
    const id = labels[index]
    if (x + 1 < width) {
      const other = labels[index + 1]
      if (other !== id) {
        bump(id, other)
        bump(other, id)
      }
    }
    if (y + 1 < height) {
      const other = labels[index + width]
      if (other !== id) {
        bump(id, other)
        bump(other, id)
      }
    }
  }

  const bestN = new Int32Array(count + 1)
  const bestW = new Int32Array(count + 1)
  for (const [key, weight] of weights) {
    const from = Math.floor(key / stride)
    const to = key % stride
    const better =
      weight > bestW[from] ||
      (weight === bestW[from] &&
        (size[to] > size[bestN[from]] || (size[to] === size[bestN[from]] && to < bestN[from])))
    if (better) {
      bestW[from] = weight
      bestN[from] = to
    }
  }

  const replacement = new Int16Array(count + 1)
  replacement.fill(-1)
  let changed = false
  for (let id = 1; id <= count; id += 1) {
    const to = bestN[id]
    if (!to || colorOf[to] === colorOf[id]) continue
    replacement[id] = colorOf[to]
    changed = true
  }
  if (!changed) return false
  for (let index = 0; index < n; index += 1) {
    const next = replacement[labels[index]]
    if (next >= 0) colorMap[index] = next
  }
  return true
}

function buildResult(
  colorMap: Uint8Array,
  original: Uint8ClampedArray,
  labels: Uint32Array,
  count: number,
  width: number,
  height: number,
) {
  const n = width * height
  const size = new Uint32Array(count + 1)
  const minX = new Uint32Array(count + 1)
  const minY = new Uint32Array(count + 1)
  const maxX = new Uint32Array(count + 1)
  const maxY = new Uint32Array(count + 1)
  const sumLum = new Float64Array(count + 1)
  const colorOf = new Uint8Array(count + 1)
  minX.fill(width)
  minY.fill(height)

  for (let index = 0; index < n; index += 1) {
    const id = labels[index]
    const x = index % width
    const y = (index / width) | 0
    size[id] += 1
    if (x < minX[id]) minX[id] = x
    if (y < minY[id]) minY[id] = y
    if (x > maxX[id]) maxX[id] = x
    if (y > maxY[id]) maxY[id] = y
    colorOf[id] = colorMap[index]
    const p = index * 4
    sumLum[id] += 0.2126 * original[p] + 0.7152 * original[p + 1] + 0.0722 * original[p + 2]
  }

  let covered = 0
  for (let id = 1; id <= count; id += 1) covered += size[id]
  if (covered !== n) throw new Error('El mapa de regiones quedó incompleto')

  const pixelOffsets = new Uint32Array(count + 2)
  for (let id = 0; id <= count; id += 1) pixelOffsets[id + 1] = pixelOffsets[id] + size[id]
  const pixelIndices = new Uint32Array(n)
  const cursor = pixelOffsets.slice()
  for (let index = 0; index < n; index += 1) {
    const id = labels[index]
    pixelIndices[cursor[id]] = index
    cursor[id] += 1
  }

  const poles = computeLabelPoints(labels, width, height, count, pixelOffsets, pixelIndices, size)
  const edges = new Uint8Array(n)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x
      const id = labels[index]
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
        edges[index] = 1
        continue
      }
      if (labels[index + 1] !== id || labels[index + width] !== id) edges[index] = 1
    }
  }

  const regions: RegionInfo[] = new Array(count + 1)
  regions[0] = {
    id: 0,
    colorIndex: 0,
    pixelCount: 0,
    labelX: 0,
    labelY: 0,
    radius: 0,
    minX: 0,
    minY: 0,
    maxX: 0,
    maxY: 0,
    shade: 230,
  }
  for (let id = 1; id <= count; id += 1) {
    const average = sumLum[id] / size[id]
    regions[id] = {
      id,
      colorIndex: colorOf[id],
      pixelCount: size[id],
      labelX: poles.x[id],
      labelY: poles.y[id],
      radius: poles.radius[id],
      minX: minX[id],
      minY: minY[id],
      maxX: maxX[id],
      maxY: maxY[id],
      shade: clampByte(220 + (average / 255) * 22),
    }
  }

  return { regions, pixelOffsets, pixelIndices, edges }
}

async function processImage(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  colorCount: number,
  minRegion: number,
  jobId: number,
) {
  const report = (pct: number, stage: string) => {
    const message: WorkerOut = { jobId, type: 'progress', pct, stage }
    scope.postMessage(message)
  }

  flattenAlpha(rgba)
  const original = rgba.slice()
  report(18, 'Suavizando la imagen')
  await yieldToUi()
  const smooth = bilateral(rgba, width, height)

  report(40, 'Extrayendo la paleta')
  await yieldToUi()
  const quantized = quantize(smooth, width, height, colorCount)
  let colorMap = majorityPass(quantized.colorMap, width, height)

  report(68, 'Detectando regiones')
  await yieldToUi()
  const safeMin = Math.max(1, Math.round(minRegion))
  let labels = labelComponents(colorMap, width, height)
  for (let pass = 0; pass < 4; pass += 1) {
    const changed = mergeSmallRegions(
      labels.labels,
      labels.count,
      colorMap,
      width,
      height,
      safeMin,
      pass === 3,
    )
    if (!changed) break
    labels = labelComponents(colorMap, width, height)
  }

  report(86, 'Calculando números')
  await yieldToUi()
  const built = buildResult(colorMap, original, labels.labels, labels.count, width, height)
  return { original, palette: quantized.palette, labels: labels.labels, ...built }
}

scope.onmessage = (event) => {
  void (async () => {
    const message = event.data
    const started = performance.now()
    try {
      scope.postMessage({ jobId: message.jobId, type: 'progress', pct: 8, stage: 'Redimensionando' })
      await yieldToUi()
      const raster =
        message.kind === 'bitmap'
          ? rasterize(message.bitmap)
          : {
              width: message.width,
              height: message.height,
              rgba: new Uint8ClampedArray(message.buffer),
            }
      const result = await processImage(
        raster.rgba,
        raster.width,
        raster.height,
        message.colorCount,
        message.minRegion,
        message.jobId,
      )
      const regionMap = result.labels.buffer as ArrayBuffer
      const pixelOffsets = result.pixelOffsets.buffer as ArrayBuffer
      const pixelIndices = result.pixelIndices.buffer as ArrayBuffer
      const edges = result.edges.buffer as ArrayBuffer
      const original = result.original.buffer as ArrayBuffer
      const done: WorkerOut = {
        jobId: message.jobId,
        type: 'done',
        elapsedMs: performance.now() - started,
        width: raster.width,
        height: raster.height,
        palette: result.palette,
        regions: result.regions,
        regionMap,
        pixelOffsets,
        pixelIndices,
        edges,
        original,
      }
      scope.postMessage(done, [regionMap, pixelOffsets, pixelIndices, edges, original])
    } catch (error) {
      const text = error instanceof Error ? error.message : 'No se pudo convertir la imagen'
      scope.postMessage({ jobId: message.jobId, type: 'error', message: text })
    }
  })()
}
