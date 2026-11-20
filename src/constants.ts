export const COLOR_OPTIONS = [8, 12, 16, 24, 32] as const

export const DETAIL_STOPS = [
  { pixels: 8, label: 'Muy fino', hint: 'Conserva las manchas chicas' },
  { pixels: 16, label: 'Fino', hint: 'Detalle alto, todavía pintable' },
  { pixels: 25, label: 'Medio', hint: 'Regiones cómodas de rellenar' },
  { pixels: 48, label: 'Suave', hint: 'Fundé el ruido fotográfico' },
  { pixels: 90, label: 'Simple', hint: 'Bloques grandes y claros' },
] as const

export const MAX_EDGE = 800
