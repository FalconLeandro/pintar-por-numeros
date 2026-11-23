import { create } from 'zustand'
import { loadTracks, type TrackRecord } from '../utils/roomDb.ts'

export type RoomPlace = 'room' | 'paint' | 'drawer' | 'crossword'

interface RoomStore {
  place: RoomPlace
  worksVersion: number
  framesVersion: number
  tracks: TrackRecord[]
  currentId: string | null
  playing: boolean
  playerOpen: boolean
  go: (place: RoomPlace) => void
  bumpWorks: () => void
  bumpFrames: () => void
  setTracks: (tracks: TrackRecord[]) => void
  setCurrent: (videoId: string | null) => void
  setPlaying: (playing: boolean) => void
  setPlayerOpen: (open: boolean) => void
}

export const useRoomStore = create<RoomStore>((set) => ({
  place: 'room',
  worksVersion: 0,
  framesVersion: 0,
  tracks: [],
  currentId: null,
  playing: false,
  playerOpen: false,
  go: (place) => set({ place }),
  bumpWorks: () => set((state) => ({ worksVersion: state.worksVersion + 1 })),
  bumpFrames: () => set((state) => ({ framesVersion: state.framesVersion + 1 })),
  setTracks: (tracks) => set({ tracks }),
  setCurrent: (currentId) => set({ currentId }),
  setPlaying: (playing) => set({ playing }),
  setPlayerOpen: (playerOpen) => set({ playerOpen }),
}))

void loadTracks().then((tracks) => {
  const current = useRoomStore.getState().currentId
  useRoomStore.setState({ tracks, currentId: current ?? tracks[0]?.videoId ?? null })
})
