import type { ProjectData } from '../types.ts'

export function renderPaintingBlob(project: ProjectData, painted: Uint8Array, scale = 1) {
  const source = document.createElement('canvas')
  source.width = project.width
  source.height = project.height
  const sourceCtx = source.getContext('2d')
  if (!sourceCtx) return Promise.reject(new Error('No se pudo preparar la obra'))
  const image = sourceCtx.createImageData(project.width, project.height)
  const buffer = image.data
  for (let index = 0; index < buffer.length; index += 4) {
    buffer[index] = 255
    buffer[index + 1] = 250
    buffer[index + 2] = 244
    buffer[index + 3] = 255
  }
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
  sourceCtx.putImageData(image, 0, 0)

  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(project.width * scale))
  canvas.height = Math.max(1, Math.round(project.height * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) return Promise.reject(new Error('No se pudo preparar la obra'))
  ctx.imageSmoothingEnabled = scale !== 1
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height)

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) reject(new Error('No se pudo preparar la obra'))
      else resolve(blob)
    }, 'image/png')
  })
}
