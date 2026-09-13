// Turn a picked image file into a bounded data uri suitable for a
// vcard-temp PHOTO. The image is downscaled to a small square so even a
// multi-megabyte phone photo fits under the wire limit.

import { AVATAR_MAX_BYTES } from '$lib/constants'

const AVATAR_SIDE = 192

// data uri payload bytes are roughly base64 length times 3/4
function fitsLimit(dataUri: string): boolean {
  return (dataUri.length - dataUri.indexOf(',') - 1) * 0.75 <= AVATAR_MAX_BYTES
}

export function fileToAvatar(file: File): Promise<string | null> {
  if (!file.type.startsWith('image/')) return Promise.resolve(null)
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      const scale = Math.min(1, AVATAR_SIDE / Math.max(img.width, img.height, 1))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(img.width * scale))
      canvas.height = Math.max(1, Math.round(img.height * scale))
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        resolve(null)
        return
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      // png keeps transparency. Fall back to jpeg when it still busts
      // the byte budget (photos with no alpha)
      const png = canvas.toDataURL('image/png')
      resolve(fitsLimit(png) ? png : canvas.toDataURL('image/jpeg', 0.85))
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(null)
    }
    img.src = url
  })
}
