import { useEffect, useRef } from 'react'
import { Check, Hand, Paintbrush } from 'lucide-react'
import { isLight } from '../utils/color.ts'
import { usePaintStore } from '../store/usePaintStore.ts'

export function ColorPalette() {
  const project = usePaintStore((state) => state.project)
  const filled = usePaintStore((state) => state.filled)
  const active = usePaintStore((state) => state.activeColor)
  const mismatch = usePaintStore((state) => state.mismatch)
  const tool = usePaintStore((state) => state.tool)
  const continuous = usePaintStore((state) => state.continuous)
  const setTool = usePaintStore((state) => state.setTool)
  const setContinuous = usePaintStore((state) => state.setContinuous)
  const selectColor = usePaintStore((state) => state.selectColor)
  const rowRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const node = rowRef.current?.querySelector<HTMLElement>(`[data-color="${active}"]`)
    node?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' })
  }, [active])

  return (
    <footer className="flex items-center gap-2 border-t border-line bg-foam/95 px-3 py-2">
      <div className="flex shrink-0 items-center gap-1 pr-1">
        <button
          type="button"
          className={toolButton(tool === 'brush')}
          onClick={() => setTool('brush')}
          aria-pressed={tool === 'brush'}
          title="Pincel (B)"
        >
          <Paintbrush size={16} />
        </button>
        <button
          type="button"
          className={toolButton(tool === 'hand')}
          onClick={() => setTool('hand')}
          aria-pressed={tool === 'hand'}
          title="Mano (H o Espacio)"
        >
          <Hand size={16} />
        </button>
        <button
          type="button"
          className={`h-10 rounded-xl px-2.5 text-xs font-medium ${continuous ? 'bg-ink text-foam' : 'text-ink-soft hover:bg-paper'}`}
          onClick={() => setContinuous(!continuous)}
          aria-pressed={continuous}
          title="Con el pincel continuo, arrastrá para pintar varias regiones del color activo"
        >
          Continuo
        </button>
      </div>

      <div ref={rowRef} className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto py-1">
        {!project && (
          <p className="px-2 text-sm text-ink-soft">La paleta aparece cuando convertís una imagen.</p>
        )}
        {project?.palette.map((color, index) => {
          const total = project.totals[index] ?? 0
          const doneCount = filled[index] ?? 0
          const ratio = total === 0 ? 0 : Math.min(1, doneCount / total)
          const done = total > 0 && doneCount >= total
          const light = isLight(color.r, color.g, color.b)
          const shaking = mismatch?.colorIndex === index
          return (
            <button
              key={colorKey(color, index)}
              type="button"
              data-color={index}
              onClick={() => selectColor(index)}
              aria-pressed={active === index}
              aria-label={`Color ${index + 1}, ${Math.round(ratio * 100)}% pintado`}
              title={`Color ${index + 1} · ${Math.round(ratio * 100)}%`}
              className={`relative grid h-16 w-16 shrink-0 place-items-center rounded-full ${active === index ? 'scale-105' : ''}`}
            >
              <svg viewBox="0 0 40 40" className="absolute inset-0 h-full w-full -rotate-90" aria-hidden>
                <circle cx="20" cy="20" r="16" fill="none" stroke="currentColor" strokeWidth="2.4" className="text-ink/10" />
                <circle
                  cx="20"
                  cy="20"
                  r="16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  pathLength={100}
                  strokeDasharray={`${ratio * 100} 100`}
                  className={done ? 'text-studio' : 'text-coral'}
                />
              </svg>
              <span
                key={shaking ? mismatch.nonce : 'still'}
                className={`grid h-11 w-11 place-items-center rounded-full text-sm font-semibold shadow-sm ${shaking ? 'animate-wiggle' : ''}`}
                style={{
                  backgroundColor: `rgb(${color.r} ${color.g} ${color.b})`,
                  color: light ? '#1d1814' : '#fffaf4',
                }}
              >
                {done ? <Check size={16} strokeWidth={2.6} /> : index + 1}
              </span>
            </button>
          )
        })}
      </div>
    </footer>
  )
}

function toolButton(active: boolean) {
  return `grid h-10 w-10 place-items-center rounded-xl ${active ? 'bg-ink text-foam' : 'text-ink hover:bg-paper'}`
}

function colorKey(color: { r: number; g: number; b: number }, index: number) {
  return `${index}-${color.r}-${color.g}-${color.b}`
}
