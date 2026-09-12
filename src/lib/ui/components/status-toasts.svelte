<script lang="ts">
  import { toast } from 'svelte-sonner'

  import LL from '$lib/i18n/i18n-svelte'
  import { accounts } from '$lib/state/accounts.svelte'

  let lastStatus = $state(new Map<string, string>())

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
  })
</script>
