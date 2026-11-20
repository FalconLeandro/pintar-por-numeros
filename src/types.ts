export interface Rgb {
  r: number
  g: number
  b: number
}

export interface RegionInfo {
  id: number
  colorIndex: number
  pixelCount: number
  labelX: number
  labelY: number
  radius: number
  minX: number
  minY: number
  maxX: number
  maxY: number
  shade: number
}

export interface ProjectData {
  token: number
  name: string
  width: number
  height: number
  colorCount: number
  minRegion: number
  palette: Rgb[]
  regions: RegionInfo[]
  regionMap: Uint32Array
  pixelOffsets: Uint32Array
  pixelIndices: Uint32Array
  edges: Uint8Array
  original: Uint8ClampedArray
  totals: number[]
  pixelCount: number
}

export type WorkerIn =
  | {
      jobId: number
      kind: 'bitmap'
      bitmap: ImageBitmap
      colorCount: number
      minRegion: number
    }
  | {
      jobId: number
      kind: 'pixels'
      buffer: ArrayBuffer
      width: number
      height: number
      colorCount: number
      minRegion: number
    }

export interface WorkerDone {
  jobId: number
  type: 'done'
  elapsedMs: number
  width: number
  height: number
  palette: Rgb[]
  regions: RegionInfo[]
  regionMap: ArrayBuffer
  pixelOffsets: ArrayBuffer
  pixelIndices: ArrayBuffer
  edges: ArrayBuffer
  original: ArrayBuffer
}

export type WorkerOut =
  | { jobId: number; type: 'progress'; pct: number; stage: string }
  | WorkerDone
  | { jobId: number; type: 'error'; message: string }

export type Tool = 'brush' | 'hand'

export type ViewCommand =
  | { type: 'fit'; nonce: number }
  | { type: 'zoom-in'; nonce: number }
  | { type: 'zoom-out'; nonce: number }
  | { type: 'focus'; nonce: number; x: number; y: number }
