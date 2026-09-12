import { STORAGE_PREFIX } from '$lib/constants'

import { bareJid } from '$lib/utils/jid'

export function scopedKey(accountJid: string, ...parts: string[]): string {
  return [STORAGE_PREFIX, bareJid(accountJid), ...parts].join(':')
}

export function globalKey(...parts: string[]): string {
  return [STORAGE_PREFIX, ...parts].join(':')
}
