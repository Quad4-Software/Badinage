<script lang="ts">
  import LL from '$lib/i18n/i18n-svelte'
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
    currentNick,
    onSubmit
  }: {
    open?: boolean
    currentNick: string
    onSubmit: (newNick: string) => void
  } = $props()

  let nick = $state('')
  const canSubmit = $derived(nick.trim().length > 0 && nick.trim() !== currentNick)

  $effect(() => {
    if (open) nick = currentNick
  })

  function submit(event: SubmitEvent) {
    event.preventDefault()
    if (!canSubmit) return
    onSubmit(nick.trim())
    open = false
  }
</script>

<Dialog bind:open>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>{$LL.changeNickname()}</DialogTitle>
    </DialogHeader>
    <form onsubmit={submit} class="flex flex-col gap-4">
      <div class="grid gap-2">
        <Label for="change-nick">{$LL.nickname()}</Label>
        <Input
          id="change-nick"
          bind:value={nick}
          placeholder={$LL.nicknamePlaceholder()}
          required
        />
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" onclick={() => (open = false)}>
          {$LL.cancel()}
        </Button>
        <Button type="submit" disabled={!canSubmit}>{$LL.save()}</Button>
      </DialogFooter>
    </form>
  </DialogContent>
</Dialog>
