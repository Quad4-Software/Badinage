<script lang="ts">
  import { toast } from 'svelte-sonner'

  import LL from '$lib/i18n/i18n-svelte'
  import { accounts } from '$lib/state/accounts.svelte'
  import { extensions } from '$lib/state/app/extensions.svelte'

  let lastStatus = $state(new Map<string, string>())
  // object identity marks a fresh decline. Null is ignored. A plain
  // record is enough, this bookkeeping never needs reactivity
  let lastDeclines: Record<string, object> = {}

  $effect(() => {
    for (const account of accounts.list) {
      const previous = lastStatus.get(account.jid)
      const current = account.status
      if (previous === current) continue
      lastStatus.set(account.jid, current)
      if (!previous) continue
      if (current === 'connected') toast.success($LL.toastConnected({ jid: account.jid }))
      if (current === 'error' || current === 'authfail')
        toast.error($LL.toastConnectionError({ jid: account.jid }))
      if (current === 'disconnected' && previous === 'connected')
        toast.warning($LL.toastDisconnected({ jid: account.jid }))
    }
    for (const account of accounts.list) {
      const decline = account.lastDecline
      if (!decline || lastDeclines[account.jid] === decline) continue
      lastDeclines[account.jid] = decline
      toast.info(
        $LL.inviteDeclined({ from: decline.from, room: decline.room }) +
          (decline.reason ? `: ${decline.reason}` : '')
      )
    }
    // extension-originated notices: worker toasts and host warnings
    for (const note of extensions.notices) {
      if (note.kind === 'error') toast.error(note.text)
      else if (note.kind === 'warning') toast.warning(note.text)
      else toast.info(note.text)
      extensions.drainNotice(note.id)
    }
  })
</script>
