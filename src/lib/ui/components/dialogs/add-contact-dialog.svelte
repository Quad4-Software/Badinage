<script lang="ts">
  import LL from '$lib/i18n/i18n-svelte'
  import { accounts } from '$lib/state/accounts.svelte'
  import { app } from '$lib/state/app.svelte'
  import { isValidUserJid } from '$lib/utils/jid'
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

  let jid = $state('')
  let name = $state('')

  const jidValid = $derived(isValidUserJid(jid))

  // an xmpp:...?roster or bare xmpp:jid deep link prefills the dialog
  $effect(() => {
    if (app.addContactOpen && app.pendingLink?.kind === 'roster') {
      jid = app.pendingLink.jid
      if (app.pendingLink.name) name = app.pendingLink.name
      app.pendingLink = null
    }
  })

  function submit(event: SubmitEvent) {
    event.preventDefault()
    const account = accounts.active
    if (!account || !jidValid) return
    account.addContact(jid, name.trim())
    app.addContactOpen = false
    jid = ''
    name = ''
  }
</script>

<Dialog bind:open={app.addContactOpen}>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>{$LL.addContact()}</DialogTitle>
    </DialogHeader>
    <form onsubmit={submit} class="flex flex-col gap-4">
      <div class="grid gap-2">
        <Label for="contact-jid">{$LL.contactJid()}</Label>
        <Input
          id="contact-jid"
          bind:value={jid}
          placeholder={$LL.jidPlaceholder()}
          aria-invalid={jid.length > 0 && !jidValid}
          required
        />
      </div>
      <div class="grid gap-2">
        <Label for="contact-name">{$LL.contactName()}</Label>
        <Input id="contact-name" bind:value={name} />
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" onclick={() => (app.addContactOpen = false)}>
          {$LL.cancel()}
        </Button>
        <Button type="submit" disabled={!jidValid}>{$LL.add()}</Button>
      </DialogFooter>
    </form>
  </DialogContent>
</Dialog>
