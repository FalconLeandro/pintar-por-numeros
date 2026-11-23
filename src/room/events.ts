interface SharedImage {
  kind: 'work' | 'photo'
  id: string
  name: string
  percent: number
  blob: Blob
}

let imageListener: ((image: SharedImage) => void) | null = null

export function onSharedImage(listener: (image: SharedImage) => void) {
  imageListener = listener
  return () => {
    if (imageListener === listener) imageListener = null
  }
}

export function emitSharedImage(image: SharedImage) {
  imageListener?.(image)
}
