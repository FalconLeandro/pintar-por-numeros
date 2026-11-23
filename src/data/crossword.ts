export interface Clue {
  number: number
  direction: 'across' | 'down'
  row: number
  col: number
  answer: string
  clue: string
}

export const ROWS = 6
export const COLS = 7

export const CLUES: Clue[] = [
  { number: 1, direction: 'across', row: 0, col: 0, answer: 'PINTAR', clue: 'Lo que se hace en el caballete.' },
  { number: 1, direction: 'down', row: 0, col: 0, answer: 'PALETA', clue: 'Los colores, cada uno con su número.' },
  { number: 2, direction: 'down', row: 0, col: 4, answer: 'ARTE', clue: 'Lo que queda colgado cuando la obra está lista.' },
  { number: 3, direction: 'across', row: 4, col: 0, answer: 'TAZA', clue: 'Se apoya en la mesa, cerca del tocadiscos.' },
]

export function buildSolution() {
  const grid: (string | null)[][] = Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => null))
  for (const clue of CLUES) {
    for (let index = 0; index < clue.answer.length; index += 1) {
      const row = clue.row + (clue.direction === 'down' ? index : 0)
      const col = clue.col + (clue.direction === 'across' ? index : 0)
      const letter = clue.answer[index]
      const current = grid[row]?.[col]
      if (current && current !== letter) throw new Error('El crucigrama tiene letras en conflicto')
      grid[row][col] = letter
    }
  }
  return grid
}

export function cellNumber(row: number, col: number) {
  const clue = CLUES.find((item) => item.row === row && item.col === col)
  return clue?.number
}
