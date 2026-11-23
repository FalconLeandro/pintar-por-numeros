import type { ProjectData } from '../types.ts'
import { useRoomStore } from '../store/useRoomStore.ts'
import { renderPaintingBlob } from '../utils/renderPainting.ts'
import { upsertWork } from '../utils/roomDb.ts'

export async function archiveWork(project: ProjectData, painted: Uint8Array) {
  const blob = await renderPaintingBlob(project, painted, 1)
  const result = await upsertWork({ token: project.token, name: project.name, blob })
  useRoomStore.getState().bumpWorks()
  return result
}
