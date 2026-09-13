// Decides how an attachment should render. The stanza's media type wins;
// when the sender omitted it we guess from the url, covering plain
// out-of-band links and data uris.

export type MediaKind = 'image' | 'video' | 'audio' | 'file'

const EXT_KIND: Record<string, MediaKind> = {
  jpg: 'image',
  jpeg: 'image',
  png: 'image',
  gif: 'image',
  webp: 'image',
  avif: 'image',
  apng: 'image',
  svg: 'image',
  bmp: 'image',
  ico: 'image',
  mp4: 'video',
  webm: 'video',
  mov: 'video',
  m4v: 'video',
  mkv: 'video',
  ogv: 'video',
  mp3: 'audio',
  ogg: 'audio',
  oga: 'audio',
  opus: 'audio',
  wav: 'audio',
  m4a: 'audio',
  flac: 'audio',
  aac: 'audio',
  weba: 'audio'
}

function dataUriType(url: string): string {
  const match = /^data:([^;,]+)/i.exec(url.trim())
  return match?.[1]?.toLowerCase() ?? ''
}

function urlExtension(url: string): string {
  const clean = url.split(/[?#]/, 1)[0] ?? ''
  const name = clean.slice(clean.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return ''
  return name.slice(dot + 1).toLowerCase()
}

export function mediaKind(url: string, mediaType = ''): MediaKind {
  const type = mediaType.toLowerCase() || dataUriType(url)
  if (type.startsWith('image/')) return 'image'
  if (type.startsWith('video/')) return 'video'
  if (type.startsWith('audio/')) return 'audio'
  return EXT_KIND[urlExtension(url)] ?? 'file'
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
