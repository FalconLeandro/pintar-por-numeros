import { useEffect, useMemo, useRef, useState } from 'react'
import { CLUES, COLS, ROWS, buildSolution, cellNumber, type Clue } from '../../data/crossword.ts'
import { RoomHeader } from './RoomHeader.tsx'

const STORAGE_KEY = 'atelier-crucigrama'

function loadLetters() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, string>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function CrosswordView() {
  const solution = useMemo(() => buildSolution(), [])
  const [letters, setLetters] = useState<Record<string, string>>(loadLetters)
  const [selected, setSelected] = useState({ row: 0, col: 0 })
  const [direction, setDirection] = useState<Clue['direction']>('across')
  const [checked, setChecked] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(letters))
  }, [letters])

  const wordsAt = (row: number, col: number) => CLUES.filter((clue) => clueOwns(clue, row, col))

  function select(row: number, col: number) {
    if (!solution[row][col]) return
    if (selected.row === row && selected.col === col) {
      const options = wordsAt(row, col)
      if (options.length > 1) setDirection((current) => (current === 'across' ? 'down' : 'across'))
    } else {
      const options = wordsAt(row, col)
      const next = options.find((clue) => clue.direction === direction) ?? options[0]
      if (next) setDirection(next.direction)
    }
    setSelected({ row, col })
    inputRef.current?.focus()
  }

  function move(delta: number, dir: Clue['direction'] = direction) {
    let row = selected.row
    let col = selected.col
    for (let step = 0; step < ROWS * COLS; step += 1) {
      if (dir === 'across') col += delta
      else row += delta
      if (row < 0 || col < 0 || row >= ROWS || col >= COLS) return
      if (solution[row][col]) {
        setSelected({ row, col })
        return
      }
    }
  }

  function write(letter: string) {
    const key = `${selected.row},${selected.col}`
    setLetters((current) => ({ ...current, [key]: letter.toUpperCase() }))
    setChecked(false)
    move(1)
  }

  function erase() {
    const key = `${selected.row},${selected.col}`
    if (letters[key]) {
      setLetters((current) => ({ ...current, [key]: '' }))
      setChecked(false)
      return
    }
    move(-1)
  }

  const filled = solution.flat().filter(Boolean).length
  const correct = solution.every((row, rowIndex) =>
    row.every((letter, colIndex) => !letter || letters[`${rowIndex},${colIndex}`] === letter),
  )
  const written = Object.values(letters).filter(Boolean).length

  return (
    <div className="flex h-dvh flex-col bg-paper">
      <RoomHeader title="Crucigrama" back />
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 overflow-auto px-4 py-6 pb-32">
        <div>
          <h1 className="font-display text-3xl">El crucigrama de la mesa</h1>
          <p className="mt-1 text-sm text-ink-soft">Tocá una casilla y escribí. Si la tocás de nuevo, cambia entre horizontal y vertical.</p>
        </div>
        <div className="relative">
          <input
            ref={inputRef}
            className="absolute h-px w-px opacity-0"
            aria-label="Letra del crucigrama"
            autoCapitalize="characters"
            onChange={(event) => {
              const letter = event.target.value.replace(/[^a-zA-ZáéíóúñÁÉÍÓÚÑ]/g, '').slice(-1)
              event.target.value = ''
              if (letter) write(letter.normalize('NFD').replace(/[\u0300-\u036f]/g, ''))
            }}
            onKeyDown={(event) => {
              if (event.key === 'Backspace') {
                event.preventDefault()
                erase()
              } else if (/^[a-zA-Z]$/.test(event.key)) {
                event.preventDefault()
                write(event.key)
              } else if (event.key === 'ArrowRight') move(1)
              else if (event.key === 'ArrowLeft') move(-1)
              else if (event.key === 'ArrowDown') {
                setDirection('down')
                move(1, 'down')
              } else if (event.key === 'ArrowUp') {
                setDirection('down')
                move(-1, 'down')
              }
            }}
          />
          <div className="grid w-fit gap-1" style={{ gridTemplateColumns: `repeat(${COLS}, 2.4rem)` }}>
            {solution.map((row, rowIndex) =>
              row.map((letter, colIndex) => {
                const key = `${rowIndex},${colIndex}`
                const active = selected.row === rowIndex && selected.col === colIndex
                const wrong = checked && letter && letters[key] && letters[key] !== letter
                return (
                  <button
                    key={key}
                    type="button"
                    disabled={!letter}
                    onClick={() => select(rowIndex, colIndex)}
                    className={`relative h-[2.4rem] rounded-md text-sm font-semibold ${
                      letter ? 'bg-foam text-ink shadow-sm' : 'bg-transparent'
                    } ${active ? 'ring-2 ring-studio' : ''} ${wrong ? 'bg-coral/20 text-coral' : ''}`}
                  >
                    {letter && cellNumber(rowIndex, colIndex) && (
                      <span className="absolute top-0.5 left-1 text-[8px] leading-none text-ink-soft">{cellNumber(rowIndex, colIndex)}</span>
                    )}
                    {letter ? letters[key] : ''}
                  </button>
                )
              }),
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button type="button" className="studio-action" onClick={() => setChecked(true)}>
            Corregir
          </button>
          {checked && correct && <p className="text-sm text-studio">Completo. Quedó en la mesa.</p>}
          {checked && !correct && <p className="text-sm text-ink-soft">{written} de {filled} letras. Las que no cierran quedaron marcadas.</p>}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <ClueList title="Horizontal" direction="across" />
          <ClueList title="Vertical" direction="down" />
        </div>
      </div>
    </div>
  )
}

function clueOwns(clue: Clue, row: number, col: number) {
  if (clue.direction === 'across') return row === clue.row && col >= clue.col && col < clue.col + clue.answer.length
  return col === clue.col && row >= clue.row && row < clue.row + clue.answer.length
}

function ClueList({ title, direction }: { title: string; direction: Clue['direction'] }) {
  return (
    <section>
      <h2 className="font-display text-xl">{title}</h2>
      <ul className="mt-2 space-y-1 text-sm">
        {CLUES.filter((clue) => clue.direction === direction).map((clue) => (
          <li key={`${clue.direction}-${clue.number}`}>
            <span className="font-semibold">{clue.number}.</span> {clue.clue}
          </li>
        ))}
      </ul>
    </section>
  )
}
