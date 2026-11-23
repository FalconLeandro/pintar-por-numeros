export function backgroundId(roomId: string) {
  return `bg-${roomId}`
}

export type RoomLayout = 'clasica' | 'ancha' | 'torre'
export type RoomSize = 'chico' | 'mediano' | 'grande'
export type RoomPalette = 'papel' | 'noche' | 'rosa' | 'salvia' | 'mar'
export type FrameStyle = 'tinta' | 'linea' | 'madera' | 'oro'
export type RoomCat = 'negra' | 'blanca' | 'ninguna'

export interface RoomObjects {
  easel: boolean
  drawer: boolean
  player: boolean
  crossword: boolean
}

export interface RoomLook {
  layout: RoomLayout
  size: RoomSize
  background: boolean
  palette: RoomPalette
  frameCount: number
  welcome: string
  objects: RoomObjects
  frameStyle: FrameStyle
  cat: RoomCat
  dedication: string
}

export const DEFAULT_LOOK: RoomLook = {
  layout: 'clasica',
  size: 'mediano',
  background: false,
  palette: 'papel',
  frameCount: 3,
  welcome: 'Un lugar para quedarse un rato.',
  objects: { easel: true, drawer: true, player: true, crossword: true },
  frameStyle: 'tinta',
  cat: 'negra',
  dedication: '',
}

const LAYOUTS = new Set<RoomLayout>(['clasica', 'ancha', 'torre'])
const SIZES = new Set<RoomSize>(['chico', 'mediano', 'grande'])
const PALETTES = new Set<RoomPalette>(['papel', 'noche', 'rosa', 'salvia', 'mar'])
const FRAMES = new Set<FrameStyle>(['tinta', 'linea', 'madera', 'oro'])
const CATS = new Set<RoomCat>(['negra', 'blanca', 'ninguna'])

function text(value: unknown, max: number) {
  if (typeof value !== 'string') return ''
  return value.replace(/\s+/g, ' ').slice(0, max)
}

export function normalizeLook(value: unknown): RoomLook {
  const source = value && typeof value === 'object' ? (value as Partial<RoomLook>) : {}
  const objects = source.objects && typeof source.objects === 'object' ? source.objects : DEFAULT_LOOK.objects
  const count = Number(source.frameCount)
  return {
    layout: LAYOUTS.has(source.layout as RoomLayout) ? (source.layout as RoomLayout) : DEFAULT_LOOK.layout,
    size: SIZES.has(source.size as RoomSize) ? (source.size as RoomSize) : DEFAULT_LOOK.size,
    background: Boolean(source.background),
    palette: PALETTES.has(source.palette as RoomPalette) ? (source.palette as RoomPalette) : DEFAULT_LOOK.palette,
    frameCount: Number.isInteger(count) && count >= 1 && count <= 6 ? count : DEFAULT_LOOK.frameCount,
    welcome: text(source.welcome, 80) || DEFAULT_LOOK.welcome,
    objects: {
      easel: objects.easel !== false,
      drawer: objects.drawer !== false,
      player: objects.player !== false,
      crossword: objects.crossword !== false,
    },
    frameStyle: FRAMES.has(source.frameStyle as FrameStyle) ? (source.frameStyle as FrameStyle) : DEFAULT_LOOK.frameStyle,
    cat: CATS.has(source.cat as RoomCat) ? (source.cat as RoomCat) : DEFAULT_LOOK.cat,
    dedication: text(source.dedication, 120),
  }
}
