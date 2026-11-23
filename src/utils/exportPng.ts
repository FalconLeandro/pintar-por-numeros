import type { ProjectData } from '../types.ts'
import { renderPaintingBlob } from './renderPainting.ts'

function slug(name: string) {
  const clean = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return clean || 'atelier'
}

export async function exportPainting(project: ProjectData, painted: Uint8Array) {
  const blob = await renderPaintingBlob(project, painted, 2)
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${slug(project.name)}-pintura.png`
  link.click()
  URL.revokeObjectURL(url)
}
