import { useEffect, useRef, useState } from 'react'
import { Maximize2, Minus, Plus } from 'lucide-react'
import type { ProjectData } from '../types.ts'
import { usePaintStore } from '../store/usePaintStore.ts'
import { WelcomeScreen } from './WelcomeScreen.tsx'

const MIN_SCALE = 0.15
const MAX_SCALE = 14

interface Camera {
  x: number
  y: number
  scale: number
}

interface Gesture {
  type: 'none' | 'pan' | 'paint' | 'pinch'
  id: number
  lx: number
  ly: number
  startDist: number
  startScale: number
  worldX: number
  worldY: number
}

function clampScale(scale: number) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))
}

function fitCamera(viewW: number, viewH: number, imgW: number, imgH: number): Camera {
  const pad = Math.min(72, Math.max(24, Math.min(viewW, viewH) * 0.08))
  const scale = clampScale(Math.min((viewW - pad * 2) / imgW, (viewH - pad * 2) / imgH))
  return {
    scale,
    x: (viewW - imgW * scale) / 2,
    y: (viewH - imgH * scale) / 2,
  }
}

function grain(x: number, y: number) {
  let n = Math.imul(x, 374761393) + Math.imul(y, 668265263)
  n = Math.imul(n ^ (n >>> 13), 1274126177)
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296
}

function paintMask(image: ImageData, project: ProjectData, painted: Uint8Array | null) {
  const buffer = image.data
  buffer.fill(0)
  if (!painted) return
  for (let id = 1; id < project.regions.length; id += 1) {
    if (!painted[id]) continue
    const color = project.palette[project.regions[id].colorIndex]
    const start = project.pixelOffsets[id]
    const end = project.pixelOffsets[id + 1]
    for (let cursor = start; cursor < end; cursor += 1) {
      const pixel = project.pixelIndices[cursor] * 4
      buffer[pixel] = color.r
      buffer[pixel + 1] = color.g
      buffer[pixel + 2] = color.b
      buffer[pixel + 3] = 255
    }
  }
}

function paintHighlight(image: ImageData, project: ProjectData, painted: Uint8Array, active: number) {
  const buffer = image.data
  buffer.fill(0)
  const { regionMap, regions, width, height } = project
  const total = width * height
  for (let index = 0; index < total; index += 1) {
    const id = regionMap[index]
    const region = regions[id]
    if (!region || region.colorIndex !== active || painted[id]) continue
    const stripe = ((index % width) + ((index / width) | 0)) & 7
    if (stripe > 1) continue
    const pixel = index * 4
    buffer[pixel] = 28
    buffer[pixel + 1] = 22
    buffer[pixel + 2] = 16
    buffer[pixel + 3] = stripe === 0 ? 120 : 64
  }
}

export function CanvasWorkspace() {
  const wrapRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<HTMLCanvasElement>(null)
  const cameraRef = useRef<Camera>({ x: 40, y: 40, scale: 1 })
  const viewSizeRef = useRef({ w: 0, h: 0 })
  const dprRef = useRef(1)
  const paperRef = useRef<HTMLCanvasElement | null>(null)
  const paintRef = useRef<HTMLCanvasElement | null>(null)
  const paintImageRef = useRef<ImageData | null>(null)
  const edgeRef = useRef<HTMLCanvasElement | null>(null)
  const highlightRef = useRef<HTMLCanvasElement | null>(null)
  const highlightImageRef = useRef<ImageData | null>(null)
  const originalRef = useRef<HTMLCanvasElement | null>(null)
  const paintDirty = useRef(false)
  const highlightDirty = useRef(false)
  const spaceRef = useRef(false)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const gesture = useRef<Gesture>({
    type: 'none',
    id: -1,
    lx: 0,
    ly: 0,
    startDist: 1,
    startScale: 1,
    worldX: 0,
    worldY: 0,
  })
  const zoomText = useRef('100%')
  const reduceMotion = useRef(false)

  const token = usePaintStore((state) => state.project?.token ?? 0)
  const activeColor = usePaintStore((state) => state.activeColor)
  const historyEpoch = usePaintStore((state) => state.historyEpoch)
  const commandNonce = usePaintStore((state) => state.command?.nonce ?? 0)
  const compareHeld = usePaintStore((state) => state.compareHeld)
  const processing = usePaintStore((state) => state.processing)
  const tool = usePaintStore((state) => state.tool)
  const spaceHeld = usePaintStore((state) => state.spaceHeld)
  const [zoomLabel, setZoomLabel] = useState('100%')
  const [grabbing, setGrabbing] = useState(false)

  function resizeView() {
    const canvas = viewRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    dprRef.current = dpr
    canvas.width = Math.max(1, Math.floor(wrap.clientWidth * dpr))
    canvas.height = Math.max(1, Math.floor(wrap.clientHeight * dpr))
    const viewW = canvas.clientWidth
    const viewH = canvas.clientHeight
    const previous = viewSizeRef.current
    const project = usePaintStore.getState().project
    if (project && viewW >= 2 && previous.w > 0) {
      const widthRatio = viewW / previous.w
      const heightRatio = viewH / previous.h
      const jumped = widthRatio < 0.8 || widthRatio > 1.25 || heightRatio < 0.8 || heightRatio > 1.25
      const centerX = cameraRef.current.x + (project.width * cameraRef.current.scale) / 2
      const centerY = cameraRef.current.y + (project.height * cameraRef.current.scale) / 2
      const lost = centerX < 24 || centerY < 24 || centerX > viewW - 24 || centerY > viewH - 24
      if (jumped || lost) {
        cameraRef.current = fitCamera(viewW, viewH, project.width, project.height)
      } else {
        clampPan()
      }
    }
    viewSizeRef.current = { w: viewW, h: viewH }
  }

  function clampPan() {
    const project = usePaintStore.getState().project
    const canvas = viewRef.current
    if (!project || !canvas) return
    const camera = cameraRef.current
    const viewW = canvas.clientWidth
    const viewH = canvas.clientHeight
    const imgW = project.width * camera.scale
    const imgH = project.height * camera.scale
    const margin = 72
    camera.x = Math.min(viewW - margin, Math.max(margin - imgW, camera.x))
    camera.y = Math.min(viewH - margin, Math.max(margin - imgH, camera.y))
  }

  function worldFromClient(clientX: number, clientY: number) {
    const canvas = viewRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    const sx = clientX - rect.left
    const sy = clientY - rect.top
    const camera = cameraRef.current
    return {
      sx,
      sy,
      wx: (sx - camera.x) / camera.scale,
      wy: (sy - camera.y) / camera.scale,
    }
  }

  function zoomAt(clientX: number, clientY: number, nextScale: number) {
    const point = worldFromClient(clientX, clientY)
    if (!point) return
    const camera = cameraRef.current
    const scale = clampScale(nextScale)
    camera.x = point.sx - point.wx * scale
    camera.y = point.sy - point.wy * scale
    camera.scale = scale
    clampPan()
  }

  function fit() {
    const canvas = viewRef.current
    const project = usePaintStore.getState().project
    if (!canvas || !project || canvas.clientWidth < 2) return
    cameraRef.current = fitCamera(canvas.clientWidth, canvas.clientHeight, project.width, project.height)
  }

  function regionAt(wx: number, wy: number) {
    const project = usePaintStore.getState().project
    if (!project) return 0
    const x = Math.floor(wx)
    const y = Math.floor(wy)
    if (x < 0 || y < 0 || x >= project.width || y >= project.height) return 0
    return project.regionMap[y * project.width + x]
  }

  function blitRegion(id: number) {
    const project = usePaintStore.getState().project
    const paintImage = paintImageRef.current
    const highlightImage = highlightImageRef.current
    if (!project || !paintImage) return
    const region = project.regions[id]
    const color = project.palette[region.colorIndex]
    const start = project.pixelOffsets[id]
    const end = project.pixelOffsets[id + 1]
    const indices = project.pixelIndices
    const paint = paintImage.data
    const highlight = highlightImage?.data
    for (let cursor = start; cursor < end; cursor += 1) {
      const pixel = indices[cursor] * 4
      paint[pixel] = color.r
      paint[pixel + 1] = color.g
      paint[pixel + 2] = color.b
      paint[pixel + 3] = 255
      if (highlight) highlight[pixel + 3] = 0
    }
    paintDirty.current = true
    highlightDirty.current = true
  }

  function tryPaint(wx: number, wy: number) {
    const id = regionAt(wx, wy)
    if (!id) return
    if (usePaintStore.getState().paintRegion(id)) blitRegion(id)
  }

  function rebuildHighlight() {
    const project = usePaintStore.getState().project
    const painted = usePaintStore.getState().painted
    const image = highlightImageRef.current
    if (!project || !painted || !image) return
    paintHighlight(image, project, painted, usePaintStore.getState().activeColor)
    highlightDirty.current = true
  }

  useEffect(() => {
    reduceMotion.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    spaceRef.current = usePaintStore.getState().spaceHeld
    return usePaintStore.subscribe((state) => {
      spaceRef.current = state.spaceHeld
    })
  }, [])

  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    resizeView()
    const observer = new ResizeObserver(() => resizeView())
    observer.observe(wrap)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const canvas = viewRef.current
    if (!canvas) return
    const onWheel = (event: WheelEvent) => {
      if (!usePaintStore.getState().project) return
      event.preventDefault()
      let delta = event.deltaY
      if (event.deltaMode === 1) delta *= 16
      else if (event.deltaMode === 2) delta *= 120
      zoomAt(event.clientX, event.clientY, cameraRef.current.scale * Math.exp(-delta * 0.0015))
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [])

  useEffect(() => {
    const project = usePaintStore.getState().project
    if (!project) {
      paperRef.current = null
      paintRef.current = null
      paintImageRef.current = null
      edgeRef.current = null
      highlightRef.current = null
      highlightImageRef.current = null
      originalRef.current = null
      return
    }

    const { width, height } = project
    const paper = document.createElement('canvas')
    paper.width = width
    paper.height = height
    const paperCtx = paper.getContext('2d')
    if (!paperCtx) return
    const paperImage = paperCtx.createImageData(width, height)
    const paperBuffer = paperImage.data
    for (let index = 0; index < width * height; index += 1) {
      const shade = project.regions[project.regionMap[index]]?.shade ?? 230
      const x = index % width
      const y = (index / width) | 0
      const value = Math.max(206, Math.min(246, Math.round(shade + (grain(x, y) - 0.5) * 8)))
      const pixel = index * 4
      paperBuffer[pixel] = Math.min(255, value + 8)
      paperBuffer[pixel + 1] = value
      paperBuffer[pixel + 2] = Math.max(0, value - 12)
      paperBuffer[pixel + 3] = 255
    }
    paperCtx.putImageData(paperImage, 0, 0)
    paperRef.current = paper

    const paint = document.createElement('canvas')
    paint.width = width
    paint.height = height
    const paintCtx = paint.getContext('2d', { willReadFrequently: true })
    if (!paintCtx) return
    const paintImage = paintCtx.createImageData(width, height)
    paintMask(paintImage, project, usePaintStore.getState().painted)
    paintCtx.putImageData(paintImage, 0, 0)
    paintRef.current = paint
    paintImageRef.current = paintImage

    const edge = document.createElement('canvas')
    edge.width = width
    edge.height = height
    const edgeCtx = edge.getContext('2d')
    if (!edgeCtx) return
    const edgeImage = edgeCtx.createImageData(width, height)
    const edgeBuffer = edgeImage.data
    for (let index = 0; index < project.edges.length; index += 1) {
      if (!project.edges[index]) continue
      const pixel = index * 4
      edgeBuffer[pixel] = 36
      edgeBuffer[pixel + 1] = 30
      edgeBuffer[pixel + 2] = 26
      edgeBuffer[pixel + 3] = 215
    }
    edgeCtx.putImageData(edgeImage, 0, 0)
    edgeRef.current = edge

    const highlight = document.createElement('canvas')
    highlight.width = width
    highlight.height = height
    const highlightCtx = highlight.getContext('2d', { willReadFrequently: true })
    if (!highlightCtx) return
    const highlightImage = highlightCtx.createImageData(width, height)
    highlightRef.current = highlight
    highlightImageRef.current = highlightImage
    const painted = usePaintStore.getState().painted
    if (painted) paintHighlight(highlightImage, project, painted, usePaintStore.getState().activeColor)
    highlightCtx.putImageData(highlightImage, 0, 0)

    const original = document.createElement('canvas')
    original.width = width
    original.height = height
    const originalCtx = original.getContext('2d')
    if (!originalCtx) return
    originalCtx.putImageData(new ImageData(new Uint8ClampedArray(project.original), width, height), 0, 0)
    originalRef.current = original

    resizeView()
    const canvas = viewRef.current
    if (canvas && canvas.clientWidth > 2) {
      cameraRef.current = fitCamera(canvas.clientWidth, canvas.clientHeight, width, height)
    } else {
      requestAnimationFrame(() => fit())
    }
  }, [token])

  useEffect(() => {
    const project = usePaintStore.getState().project
    const painted = usePaintStore.getState().painted
    const image = paintImageRef.current
    const canvas = paintRef.current
    if (!project || !painted || !image || !canvas) return
    paintMask(image, project, painted)
    paintDirty.current = true
    rebuildHighlight()
  }, [historyEpoch])

  useEffect(() => {
    rebuildHighlight()
  }, [activeColor, token])

  useEffect(() => {
    const command = usePaintStore.getState().command
    const canvas = viewRef.current
    const project = usePaintStore.getState().project
    if (!command || !canvas || !project) return
    if (command.type === 'fit') {
      fit()
      return
    }
    if (command.type === 'zoom-in' || command.type === 'zoom-out') {
      const rect = canvas.getBoundingClientRect()
      const factor = command.type === 'zoom-in' ? 1.2 : 1 / 1.2
      zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, cameraRef.current.scale * factor)
      return
    }
    const scale = clampScale(Math.max(cameraRef.current.scale, 2.5))
    cameraRef.current.scale = scale
    cameraRef.current.x = canvas.clientWidth / 2 - command.x * scale
    cameraRef.current.y = canvas.clientHeight / 2 - command.y * scale
    clampPan()
  }, [commandNonce])

  useEffect(() => {
    if (!token) return
    let frame = 0
    const canvas = viewRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    const drawNumbers = (project: ProjectData, scale: number) => {
      const painted = usePaintStore.getState().painted
      if (!painted) return
      const viewW = canvas.clientWidth
      const viewH = canvas.clientHeight
      const camera = cameraRef.current
      const x0 = -camera.x / scale
      const y0 = -camera.y / scale
      const x1 = x0 + viewW / scale
      const y1 = y0 + viewH / scale
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      for (let id = 1; id < project.regions.length; id += 1) {
        if (painted[id]) continue
        const region = project.regions[id]
        if (region.maxX < x0 || region.minX > x1 || region.maxY < y0 || region.minY > y1) continue
        const digits = region.colorIndex + 1 >= 10 ? 2 : 1
        const diameter = Math.max(1, region.radius * 2)
        if (diameter * scale < (digits === 2 ? 22 : 14)) continue
        const fontPx = Math.min(24, diameter * (digits === 2 ? 0.58 : 0.74))
        ctx.font = `600 ${fontPx}px Outfit, sans-serif`
        const label = String(region.colorIndex + 1)
        ctx.lineWidth = Math.max(fontPx * 0.16, 0.8)
        ctx.strokeStyle = 'rgba(255,250,244,0.92)'
        ctx.strokeText(label, region.labelX, region.labelY)
        ctx.fillStyle = '#1d1814'
        ctx.fillText(label, region.labelX, region.labelY)
      }
    }

    const loop = (time: number) => {
      const project = usePaintStore.getState().project
      const dpr = dprRef.current
      if (paintDirty.current && paintRef.current && paintImageRef.current) {
        paintRef.current.getContext('2d')?.putImageData(paintImageRef.current, 0, 0)
        paintDirty.current = false
      }
      if (highlightDirty.current && highlightRef.current && highlightImageRef.current) {
        highlightRef.current.getContext('2d')?.putImageData(highlightImageRef.current, 0, 0)
        highlightDirty.current = false
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      if (project && paperRef.current && paintRef.current) {
        const camera = cameraRef.current
        ctx.setTransform(camera.scale * dpr, 0, 0, camera.scale * dpr, camera.x * dpr, camera.y * dpr)
        const darkDesk = document.documentElement.classList.contains('dark')
        ctx.fillStyle = darkDesk ? 'rgba(0, 0, 0, 0.55)' : 'rgba(78, 52, 28, 0.08)'
        ctx.fillRect(8 / camera.scale, 12 / camera.scale, project.width, project.height)
        const compare = usePaintStore.getState().compareHeld && originalRef.current
        ctx.imageSmoothingEnabled = compare ? true : camera.scale < 1.35
        if (compare && originalRef.current) {
          ctx.drawImage(originalRef.current, 0, 0)
        } else {
          ctx.imageSmoothingEnabled = camera.scale < 1.35
          ctx.drawImage(paperRef.current, 0, 0)
          ctx.drawImage(paintRef.current, 0, 0)
          if (edgeRef.current) ctx.drawImage(edgeRef.current, 0, 0)
          if (highlightRef.current) {
            const pulse = reduceMotion.current ? 0.72 : 0.48 + 0.32 * Math.sin(time / 280)
            ctx.globalAlpha = pulse
            ctx.drawImage(highlightRef.current, 0, 0)
            ctx.globalAlpha = 1
          }
          ctx.imageSmoothingEnabled = true
          drawNumbers(project, camera.scale)
        }
        const nextZoom = `${Math.round(camera.scale * 100)}%`
        if (nextZoom !== zoomText.current) {
          zoomText.current = nextZoom
          setZoomLabel(nextZoom)
        }
      }
      frame = requestAnimationFrame(loop)
    }
    frame = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(frame)
  }, [token])

  function onPointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = viewRef.current
    if (!canvas || !usePaintStore.getState().project) return
    canvas.setPointerCapture(event.pointerId)
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (event.button === 1 || event.button === 2) event.preventDefault()

    if (pointers.current.size >= 2) {
      if (gesture.current.type === 'paint') usePaintStore.getState().endStroke()
      const pts = [...pointers.current.values()]
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1
      const midX = (pts[0].x + pts[1].x) / 2
      const midY = (pts[0].y + pts[1].y) / 2
      const world = worldFromClient(midX, midY)
      gesture.current = {
        type: 'pinch',
        id: -1,
        lx: 0,
        ly: 0,
        startDist: dist,
        startScale: cameraRef.current.scale,
        worldX: world?.wx ?? 0,
        worldY: world?.wy ?? 0,
      }
      setGrabbing(true)
      return
    }

    const pan =
      event.button === 1 ||
      event.button === 2 ||
      spaceRef.current ||
      usePaintStore.getState().tool === 'hand'
    if (pan) {
      gesture.current = {
        type: 'pan',
        id: event.pointerId,
        lx: event.clientX,
        ly: event.clientY,
        startDist: 1,
        startScale: 1,
        worldX: 0,
        worldY: 0,
      }
      setGrabbing(true)
      return
    }
    if (event.button !== 0) return
    gesture.current = {
      type: 'paint',
      id: event.pointerId,
      lx: event.clientX,
      ly: event.clientY,
      startDist: 1,
      startScale: 1,
      worldX: 0,
      worldY: 0,
    }
    usePaintStore.getState().beginStroke()
    const world = worldFromClient(event.clientX, event.clientY)
    if (world) tryPaint(world.wx, world.wy)
  }

  function onPointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    const point = pointers.current.get(event.pointerId)
    if (point) {
      point.x = event.clientX
      point.y = event.clientY
    }
    const current = gesture.current
    if (current.type === 'pinch' && pointers.current.size >= 2) {
      const pts = [...pointers.current.values()]
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1
      const midX = (pts[0].x + pts[1].x) / 2
      const midY = (pts[0].y + pts[1].y) / 2
      const rect = viewRef.current?.getBoundingClientRect()
      if (!rect) return
      const scale = clampScale(current.startScale * (dist / current.startDist))
      cameraRef.current.scale = scale
      cameraRef.current.x = midX - rect.left - current.worldX * scale
      cameraRef.current.y = midY - rect.top - current.worldY * scale
      clampPan()
      return
    }
    if (current.type === 'pan' && current.id === event.pointerId) {
      cameraRef.current.x += event.clientX - current.lx
      cameraRef.current.y += event.clientY - current.ly
      current.lx = event.clientX
      current.ly = event.clientY
      clampPan()
      return
    }
    if (current.type === 'paint' && current.id === event.pointerId) {
      if (!usePaintStore.getState().continuous) return
      const samples = event.nativeEvent.getCoalescedEvents?.() ?? [event.nativeEvent]
      for (const sample of samples) {
        const world = worldFromClient(sample.clientX, sample.clientY)
        if (world) tryPaint(world.wx, world.wy)
      }
    }
  }

  function finishPointer(event: React.PointerEvent<HTMLCanvasElement>) {
    pointers.current.delete(event.pointerId)
    const current = gesture.current
    if (current.type === 'paint' && current.id === event.pointerId) {
      usePaintStore.getState().endStroke()
      gesture.current = { ...current, type: 'none' }
    } else if (current.type === 'pan' && current.id === event.pointerId) {
      gesture.current = { ...current, type: 'none' }
      setGrabbing(false)
    } else if (current.type === 'pinch') {
      if (pointers.current.size === 1) {
        const entry = [...pointers.current.entries()][0]
        gesture.current = {
          type: 'pan',
          id: entry[0],
          lx: entry[1].x,
          ly: entry[1].y,
          startDist: 1,
          startScale: 1,
          worldX: 0,
          worldY: 0,
        }
      } else if (pointers.current.size === 0) {
        gesture.current = { ...current, type: 'none' }
        setGrabbing(false)
      }
    }
  }

  const cursor = grabbing ? 'grabbing' : spaceHeld || tool === 'hand' ? 'grab' : 'crosshair'

  return (
    <div ref={wrapRef} className="relative min-h-0 flex-1 overflow-hidden">
      <canvas
        ref={viewRef}
        className="h-full w-full touch-none"
        style={{ cursor }}
        role="img"
        aria-label="Lienzo de pintar por números"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishPointer}
        onPointerCancel={finishPointer}
        onDoubleClick={() => fit()}
        onContextMenu={(event) => event.preventDefault()}
      />
      {token > 0 && (
        <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
          {compareHeld && (
            <span className="rounded-full bg-ink/80 px-3 py-1 text-xs tracking-wide text-foam">
              Foto original
            </span>
          )}
        </div>
      )}
      {token > 0 && (
        <div className="absolute bottom-3 left-3 flex items-center gap-1 rounded-2xl border border-line bg-foam/95 p-1 shadow-sm">
          <button
            type="button"
            className="grid h-9 w-9 place-items-center rounded-xl text-ink hover:bg-paper"
            onClick={() => {
              const canvas = viewRef.current
              if (!canvas) return
              const rect = canvas.getBoundingClientRect()
              zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, cameraRef.current.scale / 1.2)
            }}
            aria-label="Alejar"
            title="Alejar"
          >
            <Minus size={16} />
          </button>
          <span className="w-14 text-center text-xs font-medium tabular-nums text-ink-soft">{zoomLabel}</span>
          <button
            type="button"
            className="grid h-9 w-9 place-items-center rounded-xl text-ink hover:bg-paper"
            onClick={() => {
              const canvas = viewRef.current
              if (!canvas) return
              const rect = canvas.getBoundingClientRect()
              zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, cameraRef.current.scale * 1.2)
            }}
            aria-label="Acercar"
            title="Acercar"
          >
            <Plus size={16} />
          </button>
          <button
            type="button"
            className="grid h-9 w-9 place-items-center rounded-xl text-ink hover:bg-paper"
            onClick={() => fit()}
            aria-label="Encajar lienzo"
            title="Encajar (F)"
          >
            <Maximize2 size={16} />
          </button>
        </div>
      )}
      {!token && !processing && (
        <div className="absolute inset-0 z-10">
          <WelcomeScreen />
        </div>
      )}
    </div>
  )
}
