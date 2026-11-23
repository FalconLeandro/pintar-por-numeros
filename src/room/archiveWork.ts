import type { ProjectData } from '../types.ts'
import { useRoomStore } from '../store/useRoomStore.ts'
import { renderPaintingBlob } from '../utils/renderPainting.ts'
import { emitSharedImage } from './events.ts'
import { upsertWork } from '../utils/roomDb.ts'

export function completionPercent(filled: number, total: number) {
  if (total <= 0 || filled <= 0) return 0
  if (filled >= total) return 100
  return Math.min(99, Math.round((filled / total) * 100))
}

export async function archiveWork(project: ProjectData, painted: Uint8Array, percent: number) {
  const blob = await renderPaintingBlob(project, painted, 1)
  const result = await upsertWork({ token: project.token, name: project.name, blob, percent })
  emitSharedImage({ kind: 'work', id: result.id, name: project.name, percent, blob })
  const room = useRoomStore.getState()
  room.bumpWorks()
  if (percent < 100) room.bumpFrames()
  return result
}
