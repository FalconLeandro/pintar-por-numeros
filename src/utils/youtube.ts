export function videoIdFromInput(input: string) {
  const value = input.trim()
  if (/^[\w-]{11}$/.test(value)) return value
  try {
    const url = new URL(value)
    if (url.hostname === 'youtu.be') {
      const id = url.pathname.split('/').filter(Boolean)[0]
      return id && /^[\w-]{11}$/.test(id) ? id : null
    }
    if (url.hostname.endsWith('youtube.com') || url.hostname.endsWith('youtube-nocookie.com')) {
      const watch = url.searchParams.get('v')
      if (watch && /^[\w-]{11}$/.test(watch)) return watch
      const parts = url.pathname.split('/').filter(Boolean)
      const marker = parts.findIndex((part) => part === 'embed' || part === 'shorts' || part === 'live')
      const id = marker >= 0 ? parts[marker + 1] : ''
      return id && /^[\w-]{11}$/.test(id) ? id : null
    }
  } catch {
    return null
  }
  return null
}

export async function videoTitle(videoId: string) {
  try {
    const response = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`)
    if (!response.ok) return 'Pista de YouTube'
    const data = (await response.json()) as { title?: string }
    return data.title?.trim() || 'Pista de YouTube'
  } catch {
    return 'Pista de YouTube'
  }
}
