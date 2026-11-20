type Ring = Array<[number, number]>
type Point = { x: number; y: number }

interface Cell {
  x: number
  y: number
  h: number
  d: number
  max: number
}

function segmentDistanceSq(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
) {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  if (len2 === 0) {
    const ex = px - ax
    const ey = py - ay
    return ex * ex + ey * ey
  }
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2))
  const qx = ax + t * dx
  const qy = ay + t * dy
  const ex = px - qx
  const ey = py - qy
  return ex * ex + ey * ey
}

function pointToPolygonDistance(px: number, py: number, rings: Ring[]) {
  let inside = false
  let minSq = Infinity
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0]
      const yi = ring[i][1]
      const xj = ring[j][0]
      const yj = ring[j][1]
      if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
        inside = !inside
      }
      const distSq = segmentDistanceSq(px, py, xj, yj, xi, yi)
      if (distSq < minSq) minSq = distSq
    }
  }
  const distance = Math.sqrt(minSq)
  return inside ? distance : -distance
}

function makeCell(x: number, y: number, h: number, rings: Ring[]): Cell {
  const d = pointToPolygonDistance(x, y, rings)
  return { x, y, h, d, max: d + h * Math.SQRT2 }
}

function heapPush(heap: Cell[], cell: Cell) {
  heap.push(cell)
  let index = heap.length - 1
  while (index > 0) {
    const parent = (index - 1) >> 1
    if (heap[parent].max >= heap[index].max) break
    const swap = heap[parent]
    heap[parent] = heap[index]
    heap[index] = swap
    index = parent
  }
}

function heapPop(heap: Cell[]) {
  const top = heap[0]
  const last = heap.pop()
  if (!last || heap.length === 0) return top
  heap[0] = last
  let index = 0
  for (;;) {
    const left = index * 2 + 1
    const right = left + 1
    let best = index
    if (left < heap.length && heap[left].max > heap[best].max) best = left
    if (right < heap.length && heap[right].max > heap[best].max) best = right
    if (best === index) break
    const swap = heap[best]
    heap[best] = heap[index]
    heap[index] = swap
    index = best
  }
  return top
}

function polygonCentroid(ring: Ring, rings: Ring[]) {
  let area = 0
  let x = 0
  let y = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]
    const b = ring[j]
    const factor = a[0] * b[1] - b[0] * a[1]
    x += (a[0] + b[0]) * factor
    y += (a[1] + b[1]) * factor
    area += factor * 3
  }
  if (area === 0) return makeCell(ring[0][0], ring[0][1], 0, rings)
  return makeCell(x / area, y / area, 0, rings)
}

/** Pole of inaccessibility of a polygon ring (Mapbox polylabel). */
export function polylabelRing(ring: Ring, precision = 0.8) {
  if (ring.length < 3) return null
  const rings = [ring]
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [x, y] of ring) {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  const width = maxX - minX
  const height = maxY - minY
  const cellSize = Math.min(width, height)
  if (!(cellSize > 0)) return { x: minX, y: minY, distance: 0 }

  const h0 = cellSize / 2
  const heap: Cell[] = []
  for (let x = minX; x < maxX; x += cellSize) {
    for (let y = minY; y < maxY; y += cellSize) {
      heapPush(heap, makeCell(x + h0, y + h0, h0, rings))
    }
  }

  let best = polygonCentroid(ring, rings)
  const bbox = makeCell(minX + width / 2, minY + height / 2, 0, rings)
  if (bbox.d > best.d) best = bbox

  let probes = 0
  while (heap.length > 0 && probes < 1800) {
    const cell = heapPop(heap)
    if (!cell) break
    probes += 1
    if (cell.d > best.d) best = cell
    if (cell.max - best.d <= precision) continue
    const h = cell.h / 2
    heapPush(heap, makeCell(cell.x - h, cell.y - h, h, rings))
    heapPush(heap, makeCell(cell.x + h, cell.y - h, h, rings))
    heapPush(heap, makeCell(cell.x - h, cell.y + h, h, rings))
    heapPush(heap, makeCell(cell.x + h, cell.y + h, h, rings))
  }

  return { x: best.x, y: best.y, distance: best.d }
}

function cross(origin: Point, a: Point, b: Point) {
  return (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x)
}

function convexHull(points: Point[]) {
  if (points.length <= 2) return points
  const sorted = points.slice().sort((a, b) => a.x - b.x || a.y - b.y)
  const lower: Point[] = []
  for (const point of sorted) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0
    ) {
      lower.pop()
    }
    lower.push(point)
  }
  const upper: Point[] = []
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const point = sorted[index]
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0
    ) {
      upper.pop()
    }
    upper.push(point)
  }
  lower.pop()
  upper.pop()
  return lower.concat(upper)
}

/**
 * Label anchor for every region.
 * The base point is the discrete pole of inaccessibility (multi-source distance
 * from the region boundary). The largest regions are then refined with the
 * geometric polylabel of their convex hull when that point stays inside and is
 * at least as deep as the raster pole.
 */
export function computeLabelPoints(
  regionMap: Uint32Array,
  width: number,
  height: number,
  regionCount: number,
  pixelOffsets: Uint32Array,
  pixelIndices: Uint32Array,
  areas: Uint32Array,
) {
  const n = width * height
  const dist = new Int16Array(n)
  dist.fill(-1)
  const queue = new Int32Array(n)
  let head = 0
  let tail = 0

  const onEdge = (index: number, id: number) => {
    const x = index % width
    const y = (index / width) | 0
    if (x === 0 || y === 0 || x === width - 1 || y === height - 1) return true
    return (
      regionMap[index - 1] !== id ||
      regionMap[index + 1] !== id ||
      regionMap[index - width] !== id ||
      regionMap[index + width] !== id
    )
  }

  for (let index = 0; index < n; index += 1) {
    if (!onEdge(index, regionMap[index])) continue
    dist[index] = 0
    queue[tail] = index
    tail += 1
  }

  const visit = (index: number, id: number, nextDist: number) => {
    if (dist[index] !== -1 || regionMap[index] !== id) return
    dist[index] = nextDist
    queue[tail] = index
    tail += 1
  }

  while (head < tail) {
    const index = queue[head]
    head += 1
    const id = regionMap[index]
    const nextDist = dist[index] + 1
    const x = index % width
    const y = (index / width) | 0
    if (x > 0) visit(index - 1, id, nextDist)
    if (x + 1 < width) visit(index + 1, id, nextDist)
    if (y > 0) visit(index - width, id, nextDist)
    if (y + 1 < height) visit(index + width, id, nextDist)
  }

  const bestD = new Int16Array(regionCount + 1)
  const bestI = new Int32Array(regionCount + 1)
  bestI.fill(-1)
  for (let index = 0; index < n; index += 1) {
    const id = regionMap[index]
    if (dist[index] > bestD[id]) {
      bestD[id] = dist[index]
      bestI[id] = index
    }
  }

  const sumX = new Float64Array(regionCount + 1)
  const sumY = new Float64Array(regionCount + 1)
  const sumN = new Uint32Array(regionCount + 1)
  for (let index = 0; index < n; index += 1) {
    const id = regionMap[index]
    if (dist[index] !== bestD[id]) continue
    sumX[id] += index % width
    sumY[id] += (index / width) | 0
    sumN[id] += 1
  }

  const x = new Float32Array(regionCount + 1)
  const y = new Float32Array(regionCount + 1)
  const radius = new Float32Array(regionCount + 1)

  for (let id = 1; id <= regionCount; id += 1) {
    const anchor = bestI[id]
    if (anchor < 0 || sumN[id] === 0) continue
    let lx = sumX[id] / sumN[id] + 0.5
    let ly = sumY[id] / sumN[id] + 0.5
    const px = Math.floor(lx)
    const py = Math.floor(ly)
    if (px < 0 || py < 0 || px >= width || py >= height || regionMap[py * width + px] !== id) {
      lx = (anchor % width) + 0.5
      ly = ((anchor / width) | 0) + 0.5
    }
    x[id] = lx
    y[id] = ly
    radius[id] = Math.max(bestD[id], areas[id] >= 4 ? 1 : 0.5)
  }

  const ranked: number[] = []
  for (let id = 1; id <= regionCount; id += 1) {
    if (areas[id] >= 80) ranked.push(id)
  }
  ranked.sort((a, b) => areas[b] - areas[a] || a - b)
  const started = performance.now()

  for (const id of ranked.slice(0, 8)) {
    if (performance.now() - started > 80) break
    const points: Point[] = []
    let minPoint = { x: width, y: height }
    let maxPoint = { x: 0, y: 0 }
    let leftPoint = { x: width, y: 0 }
    let topPoint = { x: 0, y: height }
    for (let cursor = pixelOffsets[id]; cursor < pixelOffsets[id + 1]; cursor += 1) {
      const index = pixelIndices[cursor]
      if (!onEdge(index, id)) continue
      const point = { x: index % width, y: (index / width) | 0 }
      points.push(point)
      if (point.x < minPoint.x) minPoint = point
      if (point.x > maxPoint.x) maxPoint = point
      if (point.x < leftPoint.x) leftPoint = point
      if (point.y < topPoint.y) topPoint = point
    }
    if (points.length < 3) continue
    let hullPoints = points
    if (points.length > 5000) {
      const step = Math.ceil(points.length / 5000)
      hullPoints = [minPoint, maxPoint, leftPoint, topPoint]
      for (let index = 0; index < points.length; index += step) hullPoints.push(points[index])
    }
    const hull = convexHull(hullPoints)
    if (hull.length < 3) continue
    const ring: Ring = hull.map((point) => [point.x + 0.5, point.y + 0.5])
    const refined = polylabelRing(ring, 1)
    if (!refined || refined.distance <= 0) continue
    const px = Math.floor(refined.x)
    const py = Math.floor(refined.y)
    if (px < 0 || py < 0 || px >= width || py >= height) continue
    const at = py * width + px
    if (regionMap[at] !== id) continue
    if (dist[at] + 1 < bestD[id]) continue
    x[id] = refined.x
    y[id] = refined.y
    radius[id] = Math.max(radius[id], dist[at])
  }

  return { x, y, radius }
}
