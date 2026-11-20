export type DemoId = 'costa' | 'bodegon' | 'dalia'

export const DEMOS: Array<{
  id: DemoId
  title: string
  subtitle: string
  colors: number
  minRegion: number
}> = [
  {
    id: 'costa',
    title: 'Costa al atardecer',
    subtitle: 'Cielo en bandas, mar y una isla',
    colors: 12,
    minRegion: 25,
  },
  {
    id: 'bodegon',
    title: 'Bodegón',
    subtitle: 'Fruta, botella y mantel',
    colors: 16,
    minRegion: 20,
  },
  {
    id: 'dalia',
    title: 'Dalia',
    subtitle: 'Pétalos listos para numerar',
    colors: 12,
    minRegion: 18,
  },
]

function leaf(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  ry: number,
  rotation: number,
) {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(rotation)
  ctx.beginPath()
  ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

function drawCosta(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const skyH = h * 0.58
  const sky = ['#f8dcc0', '#f4b48a', '#e88468', '#d25d72', '#7a4d86', '#2c335c']
  sky.forEach((color, index) => {
    ctx.fillStyle = color
    ctx.fillRect(0, (skyH / sky.length) * index, w, skyH / sky.length + 1)
  })

  ctx.fillStyle = '#f6eee4'
  ctx.beginPath()
  ctx.ellipse(w * 0.22, h * 0.16, w * 0.11, h * 0.055, 0, 0, Math.PI * 2)
  ctx.ellipse(w * 0.31, h * 0.15, w * 0.07, h * 0.04, 0, 0, Math.PI * 2)
  ctx.fill()

  ctx.fillStyle = '#ffe7a6'
  ctx.beginPath()
  ctx.arc(w * 0.72, skyH * 0.72, Math.min(w, h) * 0.085, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#fff6d4'
  ctx.beginPath()
  ctx.arc(w * 0.72, skyH * 0.72, Math.min(w, h) * 0.045, 0, Math.PI * 2)
  ctx.fill()

  const seaTop = skyH
  const sea = ['#1a4c66', '#1e6c76', '#2d948c', '#8fcec6']
  sea.forEach((color, index) => {
    ctx.fillStyle = color
    ctx.fillRect(0, seaTop + ((h - seaTop) / sea.length) * index, w, (h - seaTop) / sea.length + 1)
  })

  ctx.fillStyle = '#f0d29a'
  ctx.fillRect(w * 0.705, seaTop, w * 0.03, (h - seaTop) * 0.72)

  ctx.fillStyle = '#1b2a33'
  ctx.beginPath()
  ctx.moveTo(w * 0.16, seaTop + 4)
  ctx.lineTo(w * 0.4, seaTop + 4)
  ctx.lineTo(w * 0.3, seaTop - h * 0.16)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = '#314652'
  ctx.beginPath()
  ctx.moveTo(w * 0.24, seaTop - h * 0.02)
  ctx.lineTo(w * 0.36, seaTop + 4)
  ctx.lineTo(w * 0.3, seaTop - h * 0.16)
  ctx.closePath()
  ctx.fill()

  ctx.fillStyle = '#e7c48c'
  ctx.beginPath()
  ctx.ellipse(w * 0.3, h * 0.93, w * 0.24, h * 0.09, 0, Math.PI, 0, true)
  ctx.fill()
}

function drawBodegon(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = '#f4e6d4'
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = '#e7d3ba'
  ctx.fillRect(0, 0, w * 0.08, h)
  ctx.fillStyle = '#d8c3a4'
  ctx.fillRect(0, h * 0.62, w, h * 0.06)

  ctx.fillStyle = '#8a4634'
  ctx.fillRect(0, h * 0.68, w, h * 0.32)
  ctx.fillStyle = '#f7f2e8'
  ctx.beginPath()
  ctx.moveTo(w * 0.08, h * 0.7)
  ctx.lineTo(w * 0.92, h * 0.66)
  ctx.lineTo(w * 0.96, h)
  ctx.lineTo(0, h)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = '#e7dccb'
  ctx.beginPath()
  ctx.moveTo(w * 0.62, h * 0.67)
  ctx.lineTo(w * 0.78, h * 0.78)
  ctx.lineTo(w * 0.58, h * 0.84)
  ctx.closePath()
  ctx.fill()

  ctx.fillStyle = '#d5dee4'
  ctx.beginPath()
  ctx.ellipse(w * 0.46, h * 0.74, w * 0.2, h * 0.045, -0.1, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#f8fbfd'
  ctx.beginPath()
  ctx.ellipse(w * 0.46, h * 0.73, w * 0.15, h * 0.03, -0.1, 0, Math.PI * 2)
  ctx.fill()

  ctx.fillStyle = '#c7372d'
  ctx.beginPath()
  ctx.arc(w * 0.38, h * 0.62, Math.min(w, h) * 0.075, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#f0e2d2'
  ctx.beginPath()
  ctx.ellipse(w * 0.36, h * 0.59, w * 0.012, h * 0.02, -0.4, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#2f6a3a'
  ctx.beginPath()
  ctx.ellipse(w * 0.4, h * 0.55, w * 0.02, h * 0.012, 0.6, 0, Math.PI * 2)
  ctx.fill()

  ctx.fillStyle = '#ef8b28'
  ctx.beginPath()
  ctx.arc(w * 0.52, h * 0.64, Math.min(w, h) * 0.07, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#f6d7a4'
  ctx.beginPath()
  ctx.ellipse(w * 0.5, h * 0.61, w * 0.012, h * 0.018, 0.2, 0, Math.PI * 2)
  ctx.fill()

  ctx.fillStyle = '#d6c44a'
  ctx.beginPath()
  ctx.ellipse(w * 0.62, h * 0.66, w * 0.055, h * 0.042, 0.4, 0, Math.PI * 2)
  ctx.fill()

  ctx.fillStyle = '#1f6d62'
  ctx.fillRect(w * 0.7, h * 0.38, w * 0.07, h * 0.3)
  ctx.fillStyle = '#174e47'
  ctx.fillRect(w * 0.715, h * 0.3, w * 0.04, h * 0.09)
  ctx.fillStyle = '#f2e2c8'
  ctx.fillRect(w * 0.724, h * 0.33, w * 0.022, h * 0.04)
  ctx.fillStyle = '#d7eee8'
  ctx.beginPath()
  ctx.ellipse(w * 0.735, h * 0.48, w * 0.012, h * 0.04, 0, 0, Math.PI * 2)
  ctx.fill()

  ctx.fillStyle = 'rgba(90, 52, 32, 0.18)'
  ctx.beginPath()
  ctx.ellipse(w * 0.5, h * 0.78, w * 0.28, h * 0.03, 0, 0, Math.PI * 2)
  ctx.fill()
}

function drawDalia(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = '#f6f0e6'
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = '#e5f0e6'
  ctx.beginPath()
  ctx.arc(w * 0.5, h * 0.46, Math.min(w, h) * 0.36, 0, Math.PI * 2)
  ctx.fill()

  ctx.strokeStyle = '#24603d'
  ctx.lineWidth = Math.max(8, w * 0.016)
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(w * 0.5, h * 0.5)
  ctx.lineTo(w * 0.5, h * 0.94)
  ctx.stroke()

  ctx.fillStyle = '#2d6a44'
  leaf(ctx, w * 0.4, h * 0.74, w * 0.09, h * 0.035, -0.9)
  ctx.fillStyle = '#3e8a56'
  leaf(ctx, w * 0.62, h * 0.7, w * 0.1, h * 0.038, 0.7)
  ctx.fillStyle = '#245538'
  leaf(ctx, w * 0.58, h * 0.82, w * 0.07, h * 0.028, 0.4)

  const cx = w * 0.5
  const cy = h * 0.44
  const drawPetals = (count: number, distance: number, rx: number, ry: number, colors: [string, string]) => {
    for (let index = 0; index < count; index += 1) {
      ctx.save()
      ctx.translate(cx, cy)
      ctx.rotate((index / count) * Math.PI * 2)
      ctx.fillStyle = colors[index % 2]
      ctx.beginPath()
      ctx.ellipse(0, -distance, rx, ry, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }
  }

  drawPetals(14, h * 0.17, w * 0.032, h * 0.11, ['#e15d7c', '#f3a8b8'])
  drawPetals(10, h * 0.1, w * 0.028, h * 0.07, ['#c83b5d', '#ffd5de'])

  ctx.fillStyle = '#f2c14e'
  ctx.beginPath()
  ctx.arc(cx, cy, Math.min(w, h) * 0.055, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#e39a2d'
  ctx.beginPath()
  ctx.arc(cx, cy, Math.min(w, h) * 0.028, 0, Math.PI * 2)
  ctx.fill()
}

export function paintDemo(ctx: CanvasRenderingContext2D, id: DemoId, width: number, height: number) {
  ctx.clearRect(0, 0, width, height)
  if (id === 'costa') drawCosta(ctx, width, height)
  else if (id === 'bodegon') drawBodegon(ctx, width, height)
  else drawDalia(ctx, width, height)
}

export function renderDemo(id: DemoId, width = 900, height = 640) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('No se pudo dibujar el ejemplo')
  paintDemo(ctx, id, width, height)
  return canvas
}
