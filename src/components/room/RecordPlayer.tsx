import { memo, useEffect, useRef, useState, type RefObject } from 'react'
import { Pause, Play, SkipBack, SkipForward, X } from 'lucide-react'
import { beginRemoteFollow, remotePlayback } from '../../room/live.ts'
import { useLiveStore } from '../../room/live.ts'
import { useRoomStore } from '../../store/useRoomStore.ts'
import { saveTracks, type TrackRecord } from '../../utils/roomDb.ts'
import { videoIdFromInput, videoTitle } from '../../utils/youtube.ts'

interface YtPlayer {
  loadVideoById: (id: string) => void
  playVideo: () => void
  pauseVideo: () => void
  unMute: () => void
  setVolume: (volume: number) => void
  getCurrentTime: () => number
  seekTo: (seconds: number, allowSeekAhead: boolean) => void
  destroy: () => void
}

interface YtEvent {
  data: number
  target: YtPlayer
}

declare global {
  interface Window {
    YT?: {
      Player: new (
        element: HTMLElement,
        options: {
          events?: {
            onReady?: (event: YtEvent) => void
            onStateChange?: (event: YtEvent) => void
            onError?: (event: YtEvent) => void
            onAutoplayBlocked?: () => void
          }
        },
      ) => YtPlayer
    }
    onYouTubeIframeAPIReady?: () => void
  }
}

let apiPromise: Promise<void> | null = null

function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve()
  apiPromise ??= new Promise((resolve) => {
    const previous = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      previous?.()
      resolve()
    }
    const existing = document.querySelector<HTMLScriptElement>('script[src="https://www.youtube.com/iframe_api"]')
    if (existing) return
    const script = document.createElement('script')
    script.src = 'https://www.youtube.com/iframe_api'
    document.head.appendChild(script)
  })
  return apiPromise
}

function errorCopy(code: number) {
  if (code === 101 || code === 150) return 'Ese video no permite reproducirse acá.'
  if (code === 100 || code === 2) return 'No encontré ese video.'
  if (code === 153) return 'YouTube bloqueó el reproductor. Recargá la página.'
  return 'No se pudo reproducir.'
}

function PlayerHost({ hostRef }: { hostRef: RefObject<HTMLDivElement | null> }) {
  return <div ref={hostRef} className="h-full w-full" />
}

const StableHost = memo(PlayerHost)

export function RecordPlayer() {
  const hostRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<YtPlayer | null>(null)
  const readyRef = useRef(false)
  const pendingRef = useRef<string | null>(null)
  const bootingRef = useRef(false)
  const generationRef = useRef(0)
  const skipRef = useRef(0)
  const tracks = useRoomStore((state) => state.tracks)
  const currentId = useRoomStore((state) => state.currentId)
  const playing = useRoomStore((state) => state.playing)
  const open = useRoomStore((state) => state.playerOpen)
  const place = useRoomStore((state) => state.place)
  const setTracks = useRoomStore((state) => state.setTracks)
  const setCurrent = useRoomStore((state) => state.setCurrent)
  const setPlaying = useRoomStore((state) => state.setPlaying)
  const setTransport = useRoomStore((state) => state.setTransport)
  const followNonce = useLiveStore((state) => state.followNonce)

  useEffect(() => {
    if (!followNonce) return
    const remote = remotePlayback()
    beginRemoteFollow()
    if (!remote.videoId) {
      playerRef.current?.pauseVideo()
      return
    }
    if (!readyRef.current || useRoomStore.getState().currentId !== remote.videoId) play(remote.videoId, false, true)
    window.setTimeout(() => {
      const player = playerRef.current
      if (!player || !readyRef.current) return
      if (!remote.playing) player.pauseVideo()
      else if (Math.abs(player.getCurrentTime() - remote.expected) > 2.5) player.seekTo(remote.expected, true)
      else player.playVideo()
    }, 600)
  }, [followNonce])
  const setPlayerOpen = useRoomStore((state) => state.setPlayerOpen)
  const [draft, setDraft] = useState('')
  const [message, setMessage] = useState('')
  const [problem, setProblem] = useState(false)
  const currentIndex = tracks.findIndex((track) => track.videoId === currentId)
  const current = currentIndex >= 0 ? tracks[currentIndex] : null

  function hear(player: YtPlayer, videoId: string) {
    player.unMute()
    player.setVolume(100)
    player.loadVideoById(videoId)
    player.playVideo()
  }

  function bindPlayer(iframe: HTMLIFrameElement, generation: number) {
    if (playerRef.current || bootingRef.current || !window.YT || generation !== generationRef.current) return
    bootingRef.current = true
    playerRef.current = new window.YT.Player(iframe, {
      events: {
        onReady: (event) => {
          if (generation !== generationRef.current) {
            event.target.destroy()
            return
          }
          readyRef.current = true
          bootingRef.current = false
          playerRef.current = event.target
          pendingRef.current = null
          event.target.unMute()
          event.target.setVolume(100)
          event.target.playVideo()
        },
        onStateChange: (event) => {
          if (event.data === 1) useRoomStore.getState().setPlaying(true)
          if (event.data === 2) useRoomStore.getState().setPlaying(false)
          if (event.data === 0) advance(1, false)
        },
        onError: (event) => {
          const blocked = event.data === 101 || event.data === 150
          const state = useRoomStore.getState()
          const index = state.tracks.findIndex((track) => track.videoId === state.currentId)
          const next = state.tracks[index + 1]
          if (blocked && next && skipRef.current < state.tracks.length) {
            skipRef.current += 1
            setProblem(true)
            setMessage('Ese tema no se puede poner acá. Sigo con el siguiente.')
            play(next.videoId, false)
            return
          }
          setPlaying(false)
          setProblem(true)
          setMessage(errorCopy(event.data))
        },
        onAutoplayBlocked: () => {
          setPlaying(false)
          setProblem(true)
          setMessage('El navegador frenó el sonido. Tocá reproducir otra vez.')
        },
      },
    })
  }

  function play(videoId: string, fromUser = true, quiet = false) {
    if (fromUser) {
      skipRef.current = 0
      setProblem(false)
      setMessage('')
    }
    if (!quiet) {
      setCurrent(videoId)
      setPlaying(true)
      setTransport({ startedAt: Date.now(), position: 0 })
    }
    setPlayerOpen(true)
    const host = hostRef.current
    const shell = host?.parentElement
    if (shell) {
      shell.classList.remove('h-16')
      shell.classList.add('aspect-video')
    }
    const player = playerRef.current
    if (player && readyRef.current) {
      hear(player, videoId)
      return
    }
    pendingRef.current = videoId
    if (!host) return
    const generation = generationRef.current + 1
    generationRef.current = generation
    readyRef.current = false
    playerRef.current?.destroy()
    playerRef.current = null
    bootingRef.current = false
    const params = new URLSearchParams({
      autoplay: '1',
      enablejsapi: '1',
      playsinline: '1',
      rel: '0',
      modestbranding: '1',
      origin: location.origin,
    })
    const iframe = document.createElement('iframe')
    iframe.className = 'h-full w-full'
    iframe.style.border = '0'
    iframe.allow = 'autoplay; encrypted-media; picture-in-picture'
    iframe.referrerPolicy = 'strict-origin-when-cross-origin'
    iframe.title = 'Tocadiscos'
    iframe.src = `https://www.youtube.com/embed/${videoId}?${params}`
    host.replaceChildren(iframe)
    void loadYouTubeApi().then(() => {
      if (generation === generationRef.current && iframe.isConnected) bindPlayer(iframe, generation)
    })
  }

  function advance(direction: 1 | -1, fromClick: boolean) {
    const state = useRoomStore.getState()
    if (state.tracks.length === 0) return
    const index = state.tracks.findIndex((track) => track.videoId === state.currentId)
    const nextIndex = (index < 0 ? 0 : index) + direction
    const next = state.tracks[nextIndex]
    if (!next) {
      if (!fromClick) state.setPlaying(false)
      return
    }
    if (fromClick || readyRef.current) play(next.videoId)
  }

  function toggle() {
    if (!currentId) {
      if (tracks[0]) play(tracks[0].videoId)
      else setPlayerOpen(true)
      return
    }
    if (playing && playerRef.current && readyRef.current) {
      setTransport({ position: playerRef.current.getCurrentTime() })
      playerRef.current.pauseVideo()
      setPlaying(false)
      return
    }
    play(currentId)
  }

  async function remember(event: { preventDefault: () => void }, andPlay: boolean) {
    event.preventDefault()
    const videoId = videoIdFromInput(draft)
    if (!videoId) {
      setProblem(true)
      setMessage('Pegá un link de YouTube.')
      return
    }
    const existing = useRoomStore.getState().tracks.some((track) => track.videoId === videoId)
    if (!existing) {
      const title = await videoTitle(videoId)
      const next: TrackRecord[] = [...useRoomStore.getState().tracks, { videoId, title }]
      setTracks(next)
      await saveTracks(next)
    }
    setDraft('')
    if (andPlay) {
      setProblem(false)
      setMessage('')
      play(videoId)
      return
    }
    setProblem(existing)
    setMessage(existing ? 'Ese tema ya está en la discoteca.' : 'Quedó guardado en la discoteca.')
  }

  async function remove(videoId: string) {
    const next = tracks.filter((track) => track.videoId !== videoId)
    setTracks(next)
    await saveTracks(next)
    if (currentId !== videoId) return
    playerRef.current?.pauseVideo()
    setPlaying(false)
    setCurrent(next[0]?.videoId ?? null)
  }

  return (
    <section className={`fixed right-3 z-30 w-[min(22rem,calc(100vw-1.5rem))] ${place === 'paint' ? 'bottom-24' : 'bottom-3'}`}>
      <div className="overflow-hidden rounded-3xl border border-line bg-foam/95 shadow-xl backdrop-blur">
        <div className="flex items-center gap-2 px-3 py-2">
          <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ink text-[10px] text-foam ${playing ? 'vinyl-on' : ''}`}>
            ●
          </span>
          <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setPlayerOpen(!open)}>
            <p className="text-[11px] tracking-wide text-ink-soft uppercase">Tocadiscos</p>
            <p className="truncate text-sm">{current?.title ?? 'Sin música'}</p>
          </button>
          <button type="button" className="icon-action" onClick={() => advance(-1, true)} disabled={tracks.length < 2} aria-label="Tema anterior">
            <SkipBack size={16} />
          </button>
          <button type="button" className="icon-action" onClick={toggle} aria-label={playing ? 'Pausar' : 'Reproducir'}>
            {playing ? <Pause size={16} /> : <Play size={16} />}
          </button>
          <button type="button" className="icon-action" onClick={() => advance(1, true)} disabled={tracks.length < 2} aria-label="Tema siguiente">
            <SkipForward size={16} />
          </button>
        </div>
        <div className="px-3">
          <div className={`overflow-hidden rounded-2xl bg-ink ${open ? 'aspect-video' : 'h-16'}`}>
            <StableHost hostRef={hostRef} />
          </div>
          {open && (
            <>
              <form onSubmit={(event) => void remember(event, false)} className="mt-3 flex gap-2">
                <input
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="Link de YouTube"
                  aria-label="Link de YouTube"
                  className="min-w-0 flex-1 rounded-full border border-line bg-paper px-3 py-2 text-sm outline-none"
                />
                <button type="submit" className="studio-action">
                  Guardar
                </button>
                <button type="button" className="studio-action" onClick={(event) => void remember(event, true)}>
                  Poner
                </button>
              </form>
              {message && <p className={`mt-2 text-xs ${problem ? 'text-coral' : 'text-ink-soft'}`}>{message}</p>}
              <div className="mt-3 flex items-center justify-between gap-2">
                <p className="text-[11px] tracking-wide text-ink-soft uppercase">
                  Discoteca{tracks.length > 0 ? ` · ${currentIndex >= 0 ? currentIndex + 1 : 0}/${tracks.length}` : ''}
                </p>
                <button type="button" className="text-xs text-studio disabled:text-ink-soft" disabled={tracks.length === 0} onClick={() => tracks[0] && play(tracks[0].videoId)}>
                  Reproducir discoteca
                </button>
              </div>
              <ul className="mt-2 max-h-36 space-y-1 overflow-auto pb-3">
                {tracks.map((track, index) => (
                  <li key={track.videoId} className="flex items-center gap-2">
                    <button type="button" className="min-w-0 flex-1 truncate text-left text-sm hover:text-studio" onClick={() => play(track.videoId)}>
                      {track.videoId === currentId ? '● ' : `${index + 1}. `}
                      {track.title}
                    </button>
                    <button type="button" className="text-ink-soft" aria-label={`Quitar ${track.title}`} onClick={() => void remove(track.videoId)}>
                      <X size={14} />
                    </button>
                  </li>
                ))}
                {tracks.length === 0 && (
                  <li className="pb-2 text-xs text-ink-soft">Guardá temas de YouTube. Después se escuchan en orden, como una playlist.</li>
                )}
              </ul>
            </>
          )}
        </div>
      </div>
    </section>
  )
}
