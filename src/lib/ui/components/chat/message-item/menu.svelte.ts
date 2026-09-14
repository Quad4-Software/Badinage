// Right click menu for a message bubble. Mirrors the hover action bar
// and the touch sheet, plus copy. Retract and moderate sit behind a
// separator as destructive entries. Kept out of message-item.svelte
// because that file is at its size ceiling.

import { Copy, Pencil, Reply, SmilePlus, Trash2, X } from '@lucide/svelte'
import type { Attachment } from 'svelte/attachments'
import { get } from 'svelte/store'

import LL from '$lib/i18n/i18n-svelte'
import type { ChatMessage } from '$lib/state/chats.svelte'
import type { MenuItem } from '$lib/state/app/menus.svelte'
import { copyText } from '$lib/ui/clipboard'

import { contextArea } from '../../context-menu/area'

export interface MessageMenuHandlers {
  onReply?: ((message: ChatMessage) => void) | undefined
  onEdit?: ((message: ChatMessage) => void) | undefined
  onRetract?: ((message: ChatMessage) => void) | undefined
  onModerate?: ((message: ChatMessage) => void) | undefined
  onDismiss?: ((message: ChatMessage) => void) | undefined
}

export function messageMenu(
  message: ChatMessage,
  canModerate: boolean,
  el: () => HTMLElement | null,
  openPicker: (anchor: 'top' | 'bottom', trigger: HTMLElement) => void,
  cb: MessageMenuHandlers
): Attachment {
  return contextArea({
    section: 'chat.message',
    payload: {
      id: message.id,
      peerJid: message.peerJid,
      outgoing: message.outgoing,
      body: message.body
    },
    items: () => buildItems(message, canModerate, el, openPicker, cb)
  })
}

function buildItems(
  message: ChatMessage,
  canModerate: boolean,
  el: () => HTMLElement | null,
  openPicker: (anchor: 'top' | 'bottom', trigger: HTMLElement) => void,
  cb: MessageMenuHandlers
): MenuItem[] {
  if (message.retracted || message.pending) return []
  const items: MenuItem[] = [
    {
      id: 'react',
      label: get(LL).react(),
      icon: SmilePlus,
      run: () => {
        const target = el()
        if (target) openPicker('top', target)
      }
    },
    { id: 'reply', label: get(LL).reply(), icon: Reply, run: () => cb.onReply?.(message) }
  ]
  if (message.body) {
    items.push({
      id: 'copy',
      label: get(LL).copyMessage(),
      icon: Copy,
      run: () => void copyText(message.body)
    })
  }
  const tail: MenuItem[] = []
  if (message.outgoing) {
    tail.push(
      { id: 'edit', label: get(LL).editMessage(), icon: Pencil, run: () => cb.onEdit?.(message) },
      {
        id: 'retract',
        label: get(LL).retractMessage(),
        icon: Trash2,
        danger: true,
        run: () => cb.onRetract?.(message)
      }
    )
  }
  if (canModerate) {
    tail.push({
      id: 'moderate',
      label: get(LL).removeMessage(),
      icon: Trash2,
      danger: true,
      run: () => cb.onModerate?.(message)
    })
  }
  if (message.undecryptable && cb.onDismiss) {
    tail.push({
      id: 'dismiss',
      label: get(LL).dismissMessage(),
      icon: X,
      run: () => cb.onDismiss?.(message)
    })
  }
  if (tail.length > 0) items.push({ id: 'sep-tail', label: '', separator: true }, ...tail)
  return items
}
