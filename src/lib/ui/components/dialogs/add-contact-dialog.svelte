<script lang="ts">
  import LL from '$lib/i18n/i18n-svelte'
  import { accounts } from '$lib/state/accounts.svelte'
  import { app } from '$lib/state/app.svelte'
  import { isValidIrcNick } from '$lib/utils/irc'
  import { isValidUserJid, jidDomain } from '$lib/utils/jid'
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

  const account = $derived(accounts.active)
  const isIrc = $derived(account?.options.protocol === 'irc')
  // contacts are nicks on IRC, full jids on XMPP
  const jidValid = $derived(isIrc ? isValidIrcNick(jid.trim()) : isValidUserJid(jid))

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
    if (!account || !jidValid) return
    const address = isIrc ? `${jid.trim()}@${jidDomain(account.jid)}` : jid
    account.addContact(address, name.trim())
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
        <Label for="contact-jid">{isIrc ? $LL.ircNick() : $LL.contactJid()}</Label>
        <Input
          id="contact-jid"
          bind:value={jid}
          placeholder={isIrc ? $LL.ircNickPlaceholder() : $LL.jidPlaceholder()}
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
