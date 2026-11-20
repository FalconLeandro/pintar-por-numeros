export interface Lab {
  l: number
  a: number
  b: number
}

function linearize(channel: number) {
  const s = channel / 255
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

export function rgbToLab(r: number, g: number, b: number): Lab {
  const red = linearize(r)
  const green = linearize(g)
  const blue = linearize(b)
  const x = red * 0.4124564 + green * 0.3575761 + blue * 0.1804375
  const y = red * 0.2126729 + green * 0.7151522 + blue * 0.072175
  const z = red * 0.0193339 + green * 0.119192 + blue * 0.9503041
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787037 * t + 16 / 116)
  const fx = f(x / 0.95047)
  const fy = f(y)
  const fz = f(z / 1.08883)
  return {
    l: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  }
}

export function labDistance2(p: Lab, q: Lab) {
  const dl = p.l - q.l
  const da = p.a - q.a
  const db = p.b - q.b
  return dl * dl + da * da + db * db
}

export function isLight(r: number, g: number, b: number) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 168
}

export function clampByte(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)))
}
