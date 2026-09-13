<script lang="ts">
  import LL from '$lib/i18n/i18n-svelte'
  import { isValidBareJid } from '$lib/utils/jid'
  import { Button } from '$lib/ui/primitives/button'
  import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle
  } from '$lib/ui/primitives/dialog'
  import { Input } from '$lib/ui/primitives/input'
  import { Label } from '$lib/ui/primitives/label'

  let {
    open = $bindable(false),
    onSubmit
  }: {
    open?: boolean
    onSubmit: (jid: string, reason: string) => void
  } = $props()

  let jid = $state('')
  let reason = $state('')

  const jidValid = $derived(isValidBareJid(jid))

  function submit(event: SubmitEvent) {
    event.preventDefault()
    if (!jidValid) return
    onSubmit(jid.trim(), reason.trim())
    open = false
    jid = ''
    reason = ''
  }
</script>

<Dialog bind:open>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>{$LL.inviteToRoom()}</DialogTitle>
    </DialogHeader>
    <form onsubmit={submit} class="flex flex-col gap-4">
      <div class="grid gap-2">
        <Label for="invite-jid">{$LL.inviteAddress()}</Label>
        <Input
          id="invite-jid"
          bind:value={jid}
          placeholder={$LL.jidPlaceholder()}
          aria-invalid={jid.length > 0 && !jidValid}
          required
        />
      </div>
      <div class="grid gap-2">
        <Label for="invite-reason">{$LL.reasonOptional()}</Label>
        <Input id="invite-reason" bind:value={reason} />
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" onclick={() => (open = false)}>
          {$LL.cancel()}
        </Button>
        <Button type="submit" disabled={!jidValid}>{$LL.sendInvite()}</Button>
      </DialogFooter>
    </form>
  </DialogContent>
</Dialog>
