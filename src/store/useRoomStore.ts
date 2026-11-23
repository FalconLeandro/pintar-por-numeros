import { create } from 'zustand'
import type { TrackRecord } from '../utils/roomDb.ts'

export type RoomPlace = 'room' | 'paint' | 'drawer' | 'crossword'

interface RoomStore {
  place: RoomPlace
  worksVersion: number
  framesVersion: number
  tracks: TrackRecord[]
  currentId: string | null
  playing: boolean
  startedAt: number
  position: number
  playerOpen: boolean
  go: (place: RoomPlace) => void
  bumpWorks: () => void
  bumpFrames: () => void
  setTracks: (tracks: TrackRecord[]) => void
  setCurrent: (videoId: string | null) => void
  setPlaying: (playing: boolean) => void
  setTransport: (patch: { startedAt?: number; position?: number }) => void
  setPlayerOpen: (open: boolean) => void
}

export const useRoomStore = create<RoomStore>((set) => ({
  place: 'room',
  worksVersion: 0,
  framesVersion: 0,
  tracks: [],
  currentId: null,
  playing: false,
  startedAt: 0,
  position: 0,
  playerOpen: false,
  go: (place) => set({ place }),
  bumpWorks: () => set((state) => ({ worksVersion: state.worksVersion + 1 })),
  bumpFrames: () => set((state) => ({ framesVersion: state.framesVersion + 1 })),
  setTracks: (tracks) => set({ tracks }),
  setCurrent: (currentId) => set({ currentId }),
  setPlaying: (playing) => set({ playing }),
  setTransport: (patch) => set(patch),
  setPlayerOpen: (playerOpen) => set({ playerOpen }),
}))
