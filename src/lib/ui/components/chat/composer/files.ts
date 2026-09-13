// File sends for the composer: the picker change handler and the paste
// path both funnel into sendFileMessage. Extracted for the size gate.

import { get } from 'svelte/store'

import LL from '$lib/i18n/i18n-svelte'
import type { Account } from '$lib/state/accounts.svelte'
import type { ConversationKind } from '$lib/state/chats.svelte'
import { sendFileMessage } from '$lib/state/upload'
import { toast } from '$lib/ui/primitives/sonner'

export interface FileDeps {
  account: () => Account | undefined
  peer: () => string
  kind: () => ConversationKind
}

export function createFileSend(deps: FileDeps): {
  sendFile: (file: Blob, name: string, mediaType: string, duration?: number) => void
  onFiles: (event: Event) => Promise<void>
  onPaste: (event: ClipboardEvent) => void
} {
  function sendFile(file: Blob, name: string, mediaType: string, duration?: number): void {
    const account = deps.account()
    if (!account) return
    sendFileMessage(
      account,
      deps.peer(),
      deps.kind() === 'muc' ? 'groupchat' : 'chat',
      file,
      name,
      mediaType,
      () => toast.error(get(LL).uploadFailed()),
      duration
    )
  }

  async function onFiles(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (!file || !deps.account()) return
    sendFile(file, file.name, file.type || 'application/octet-stream')
  }

  // pasted files ride the same upload path as picked ones; nameless
  // clipboard blobs get a generated name with an extension from the type
  function onPaste(event: ClipboardEvent): void {
    const files = event.clipboardData?.files
    if (!files?.length) return
    event.preventDefault()
    for (const file of files) {
      const name = file.name || `pasted-${Date.now()}.${file.type.split('/')[1] ?? 'bin'}`
      sendFile(file, name, file.type || 'application/octet-stream')
    }
  }

  return { sendFile, onFiles, onPaste }
}
