import { create } from 'zustand'
import type { ProjectData, Tool, ViewCommand, WorkerDone, WorkerIn, WorkerOut } from '../types.ts'
import { clearProject, loadProject, projectToSave, saveProject } from '../utils/idb.ts'

interface ProcessingState {
  pct: number
  stage: string
}

interface Mismatch {
  colorIndex: number
  nonce: number
}

interface PendingJob {
  name: string
  colorCount: number
  minRegion: number
}

interface PaintStore {
  hydrated: boolean
  project: ProjectData | null
  painted: Uint8Array | null
  filled: number[]
  globalFilled: number
  activeColor: number
  tool: Tool
  continuous: boolean
  spaceHeld: boolean
  compareHeld: boolean
  modalOpen: boolean
  collectionOpen: boolean
  pendingFile: File | null
  processing: ProcessingState | null
  error: string | null
  notice: string | null
  restored: boolean
  canUndo: boolean
  canRedo: boolean
  paintedVersion: number
  historyEpoch: number
  command: ViewCommand | null
  mismatch: Mismatch | null
  openModal: () => void
  closeModal: () => void
  openCollection: () => void
  closeCollection: () => void
  queueFile: (file: File) => void
  clearPendingFile: () => void
  setTool: (tool: Tool) => void
  setContinuous: (value: boolean) => void
  setSpaceHeld: (value: boolean) => void
  setCompareHeld: (value: boolean) => void
  selectColor: (index: number) => void
  nudgeColor: (direction: number) => void
  dismissError: () => void
  dismissNotice: () => void
  dismissRestored: () => void
  setError: (message: string) => void
  processBitmap: (bitmap: ImageBitmap, name: string, colorCount: number, minRegion: number) => void
  reprocess: (colorCount: number, minRegion: number) => void
  cancelProcessing: () => void
  beginStroke: () => void
  paintRegion: (id: number) => boolean
  endStroke: () => void
  undo: () => void
  redo: () => void
  discard: () => void
  requestHint: () => void
  issueCommand: (type: 'fit' | 'zoom-in' | 'zoom-out') => void
}

let history: Uint8Array[] = []
let future: Uint8Array[] = []
let strokeActive = false
let strokeChanged = false
let worker: Worker | null = null
let activeJob = 0
let tokenSeq = 1
let commandNonce = 0
let noticeTimer = 0
let saveTimer = 0
let lastMismatchAt = 0
let pending: PendingJob = { name: 'Sin título', colorCount: 16, minRegion: 25 }

function nextNonce() {
  commandNonce += 1
  return commandNonce
}

function nextIncomplete(filled: number[], totals: number[], from: number) {
  for (let step = 1; step <= totals.length; step += 1) {
    const index = (from + step) % totals.length
    if (filled[index] < totals[index]) return index
  }
  return from
}

function recompute(project: ProjectData, painted: Uint8Array) {
  const filled = Array.from({ length: project.palette.length }, () => 0)
  let globalFilled = 0
  for (let id = 1; id < project.regions.length; id += 1) {
    if (!painted[id]) continue
    const region = project.regions[id]
    filled[region.colorIndex] += region.pixelCount
    globalFilled += region.pixelCount
  }
  return { filled, globalFilled }
}

function flash(notice: string) {
  window.clearTimeout(noticeTimer)
  usePaintStore.setState({ notice })
  noticeTimer = window.setTimeout(() => {
    if (usePaintStore.getState().notice === notice) usePaintStore.setState({ notice: null })
  }, 4600)
}

function scheduleSave() {
  window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    const { project, painted, activeColor } = usePaintStore.getState()
    if (!project || !painted) return
    void saveProject(projectToSave(project, painted, activeColor)).catch(() => {
      // The painting stays in memory even if the browser refuses the write.
    })
  }, 700)
}

function resetHistory(painted: Uint8Array) {
  history = []
  future = []
  strokeActive = false
  strokeChanged = false
  return painted
}

function projectFromDone(data: WorkerDone, meta: PendingJob): ProjectData {
  const regionMap = new Uint32Array(data.regionMap)
  const pixelOffsets = new Uint32Array(data.pixelOffsets)
  const pixelIndices = new Uint32Array(data.pixelIndices)
  const edges = new Uint8Array(data.edges)
  const original = new Uint8ClampedArray(data.original)
  const totals = Array.from({ length: data.palette.length }, () => 0)
  let pixelCount = 0
  for (let id = 1; id < data.regions.length; id += 1) {
    const region = data.regions[id]
    totals[region.colorIndex] += region.pixelCount
    pixelCount += region.pixelCount
  }
  tokenSeq += 1
  return {
    token: tokenSeq,
    name: meta.name,
    width: data.width,
    height: data.height,
    colorCount: meta.colorCount,
    minRegion: meta.minRegion,
    palette: data.palette,
    regions: data.regions,
    regionMap,
    pixelOffsets,
    pixelIndices,
    edges,
    original,
    totals,
    pixelCount,
  }
}

function adoptProject(project: ProjectData, painted = new Uint8Array(project.regions.length), activeColor = 0) {
  resetHistory(painted)
  const progress = recompute(project, painted)
  usePaintStore.setState({
    project,
    painted,
    filled: progress.filled,
    globalFilled: progress.globalFilled,
    activeColor,
    processing: null,
    error: null,
    modalOpen: false,
    collectionOpen: false,
    canUndo: false,
    canRedo: false,
    paintedVersion: usePaintStore.getState().paintedVersion + 1,
    historyEpoch: usePaintStore.getState().historyEpoch + 1,
    restored: false,
  })
  scheduleSave()
}

function onWorkerMessage(data: WorkerOut) {
  if (data.jobId !== activeJob) return
  if (data.type === 'progress') {
    usePaintStore.setState({ processing: { pct: data.pct, stage: data.stage } })
    return
  }
  if (data.type === 'error') {
    usePaintStore.setState({ processing: null, error: data.message })
    return
  }
  const project = projectFromDone(data, pending)
  adoptProject(project)
  const seconds = (data.elapsedMs / 1000).toFixed(1)
  const regions = Math.max(0, data.regions.length - 1).toLocaleString('es-AR')
  flash(`Listo en ${seconds} s · ${regions} regiones`)
}

function startJob(message: WorkerIn, transfer: Transferable[]) {
  worker?.terminate()
  worker = new Worker(new URL('../workers/imageProcessor.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (event: MessageEvent<WorkerOut>) => onWorkerMessage(event.data)
  worker.onerror = () => {
    usePaintStore.setState({
      processing: null,
      error: 'El procesador de imagen se detuvo antes de terminar.',
    })
  }
  worker.postMessage(message, transfer)
}

function applySnapshot(snapshot: Uint8Array) {
  const { project, painted } = usePaintStore.getState()
  if (!project || !painted || snapshot.length !== painted.length) return
  painted.set(snapshot)
  const progress = recompute(project, painted)
  usePaintStore.setState({
    filled: progress.filled,
    globalFilled: progress.globalFilled,
    paintedVersion: usePaintStore.getState().paintedVersion + 1,
    historyEpoch: usePaintStore.getState().historyEpoch + 1,
    canUndo: history.length > 0,
    canRedo: future.length > 0,
  })
  scheduleSave()
}

export const usePaintStore = create<PaintStore>((set, get) => ({
  hydrated: false,
  project: null,
  painted: null,
  filled: [],
  globalFilled: 0,
  activeColor: 0,
  tool: 'brush',
  continuous: true,
  spaceHeld: false,
  compareHeld: false,
  modalOpen: false,
  collectionOpen: false,
  pendingFile: null,
  processing: null,
  error: null,
  notice: null,
  restored: false,
  canUndo: false,
  canRedo: false,
  paintedVersion: 0,
  historyEpoch: 0,
  command: null,
  mismatch: null,

  openModal: () => set({ modalOpen: true, collectionOpen: false }),
  closeModal: () => set({ modalOpen: false }),
  openCollection: () => set({ collectionOpen: true, modalOpen: false }),
  closeCollection: () => set({ collectionOpen: false }),
  queueFile: (file) => set({ pendingFile: file, modalOpen: true, error: null }),
  clearPendingFile: () => set({ pendingFile: null }),
  setTool: (tool) => set({ tool }),
  setContinuous: (continuous) => set({ continuous }),
  setSpaceHeld: (spaceHeld) => set({ spaceHeld }),
  setCompareHeld: (compareHeld) => set({ compareHeld }),
  selectColor: (activeColor) => set({ activeColor }),
  nudgeColor: (direction) => {
    const { project, activeColor } = get()
    if (!project || project.palette.length === 0) return
    const count = project.palette.length
    set({ activeColor: (activeColor + direction + count) % count })
  },
  dismissError: () => set({ error: null }),
  dismissNotice: () => set({ notice: null }),
  dismissRestored: () => set({ restored: false }),
  setError: (error) => set({ error }),

  processBitmap: (bitmap, name, colorCount, minRegion) => {
    const jobId = ++activeJob
    pending = { name: name.trim() || 'Sin título', colorCount, minRegion }
    set({ processing: { pct: 4, stage: 'Preparando imagen' }, error: null, modalOpen: false, collectionOpen: false })
    const message: WorkerIn = { jobId, kind: 'bitmap', bitmap, colorCount, minRegion }
    startJob(message, [bitmap])
  },

  reprocess: (colorCount, minRegion) => {
    const project = get().project
    if (!project) return
    const copy = new Uint8Array(project.original)
    const buffer = copy.buffer as ArrayBuffer
    const jobId = ++activeJob
    pending = { name: project.name, colorCount, minRegion }
    set({ processing: { pct: 4, stage: 'Preparando imagen' }, error: null, modalOpen: false, collectionOpen: false })
    const message: WorkerIn = {
      jobId,
      kind: 'pixels',
      buffer,
      width: project.width,
      height: project.height,
      colorCount,
      minRegion,
    }
    startJob(message, [buffer])
  },

  cancelProcessing: () => {
    activeJob += 1
    worker?.terminate()
    worker = null
    set({ processing: null })
  },

  beginStroke: () => {
    const painted = get().painted
    if (!painted || strokeActive) return
    history.push(painted.slice())
    if (history.length > 40) history.shift()
    future = []
    strokeActive = true
    strokeChanged = false
    set({ canUndo: true, canRedo: false })
  },

  paintRegion: (id) => {
    const { project, painted, activeColor, filled, globalFilled, paintedVersion } = get()
    if (!project || !painted || id <= 0) return false
    const region = project.regions[id]
    if (!region || painted[id]) return false
    if (region.colorIndex !== activeColor) {
      const now = performance.now()
      if (now - lastMismatchAt > 450) {
        lastMismatchAt = now
        set({ mismatch: { colorIndex: region.colorIndex, nonce: now } })
      }
      return false
    }
    painted[id] = 1
    strokeChanged = true
    const nextFilled = filled.slice()
    nextFilled[region.colorIndex] += region.pixelCount
    set({
      filled: nextFilled,
      globalFilled: globalFilled + region.pixelCount,
      paintedVersion: paintedVersion + 1,
    })
    return true
  },

  endStroke: () => {
    if (!strokeActive) return
    strokeActive = false
    if (!strokeChanged) {
      history.pop()
      set({ canUndo: history.length > 0 })
      return
    }
    const { project, filled, activeColor, globalFilled } = get()
    if (!project) return
    let nextColor = activeColor
    if (filled[activeColor] >= project.totals[activeColor]) {
      nextColor = nextIncomplete(filled, project.totals, activeColor)
    }
    set({ activeColor: nextColor, canUndo: history.length > 0, canRedo: false })
    if (globalFilled >= project.pixelCount && project.pixelCount > 0) {
      flash('Paleta completa. Ya podés exportar la obra.')
    }
    scheduleSave()
  },

  undo: () => {
    const { project, painted } = get()
    if (!project || !painted) return
    if (strokeActive) {
      strokeActive = false
      if (!strokeChanged) history.pop()
    }
    const snapshot = history.pop()
    if (!snapshot) {
      set({ canUndo: false })
      return
    }
    future.push(painted.slice())
    applySnapshot(snapshot)
  },

  redo: () => {
    const { project, painted } = get()
    if (!project || !painted || strokeActive) return
    const snapshot = future.pop()
    if (!snapshot) return
    history.push(painted.slice())
    applySnapshot(snapshot)
  },

  discard: () => {
    history = []
    future = []
    strokeActive = false
    set({
      project: null,
      painted: null,
      filled: [],
      globalFilled: 0,
      activeColor: 0,
      restored: false,
      canUndo: false,
      canRedo: false,
      notice: null,
      command: null,
    })
    void clearProject().catch(() => undefined)
  },

  requestHint: () => {
    const { project, painted, activeColor } = get()
    if (!project || !painted) return
    const matches = []
    for (let id = 1; id < project.regions.length; id += 1) {
      const region = project.regions[id]
      if (region.colorIndex === activeColor && !painted[id]) matches.push(region)
    }
    if (matches.length === 0) {
      flash('Ese color ya está completo')
      return
    }
    matches.sort((a, b) => b.pixelCount - a.pixelCount || a.id - b.id)
    const cursor = nextNonce()
    const region = matches[cursor % matches.length]
    set({ command: { type: 'focus', nonce: cursor, x: region.labelX, y: region.labelY } })
  },

  issueCommand: (type) => {
    set({ command: { type, nonce: nextNonce() } })
  },
}))

void (async () => {
  try {
    const save = await loadProject()
    if (!save) return
    const pixels = save.width * save.height
    if (
      save.regionMap.byteLength !== pixels * 4 ||
      save.original.byteLength !== pixels * 4 ||
      save.edges.byteLength !== pixels ||
      save.pixelIndices.byteLength !== pixels * 4
    ) {
      return
    }
    const regions = save.regions
    const painted = new Uint8Array(save.painted)
    if (painted.length < regions.length) return
    const totals = Array.from({ length: save.palette.length }, () => 0)
    let pixelCount = 0
    for (let id = 1; id < regions.length; id += 1) {
      totals[regions[id].colorIndex] += regions[id].pixelCount
      pixelCount += regions[id].pixelCount
    }
    tokenSeq += 1
    const project: ProjectData = {
      token: tokenSeq,
      name: save.name,
      width: save.width,
      height: save.height,
      colorCount: save.colorCount,
      minRegion: save.minRegion,
      palette: save.palette,
      regions,
      regionMap: new Uint32Array(save.regionMap),
      pixelOffsets: new Uint32Array(save.pixelOffsets),
      pixelIndices: new Uint32Array(save.pixelIndices),
      edges: new Uint8Array(save.edges),
      original: new Uint8ClampedArray(save.original),
      totals,
      pixelCount,
    }
    const progress = recompute(project, painted)
    usePaintStore.setState({
      project,
      painted,
      filled: progress.filled,
      globalFilled: progress.globalFilled,
      activeColor: Math.min(save.activeColor, Math.max(0, save.palette.length - 1)),
      restored: true,
      historyEpoch: 1,
    })
  } catch {
    // A broken save should not block the studio.
  } finally {
    usePaintStore.setState({ hydrated: true })
  }
})()
