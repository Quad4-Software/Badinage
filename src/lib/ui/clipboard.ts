// Clipboard writes that report the outcome. A silent failure leaves the
// user believing text is on the clipboard when it is not, so failures
// toast. Success stays quiet for callers that already show feedback.

import { get } from 'svelte/store'

import LL from '$lib/i18n/i18n-svelte'
import { toast } from '$lib/ui/primitives/sonner'

export async function copyText(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard?.writeText) throw new Error('clipboard api unavailable')
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    toast.error(get(LL).copyFailed())
    return false
  }
}
