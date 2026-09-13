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
    subject,
    onSubmit
  }: {
    open?: boolean
    subject: string
    onSubmit: (subject: string) => void
  } = $props()

  let text = $state('')

  $effect(() => {
    if (open) text = subject
  })

  function submit(event: SubmitEvent) {
    event.preventDefault()
    onSubmit(text.trim())
    open = false
  }
</script>

<Dialog bind:open>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>{$LL.editSubject()}</DialogTitle>
    </DialogHeader>
    <form onsubmit={submit} class="flex flex-col gap-4">
      <div class="grid gap-2">
        <Label for="room-subject">{$LL.roomSubject()}</Label>
        <Input id="room-subject" bind:value={text} />
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" onclick={() => (open = false)}>
          {$LL.cancel()}
        </Button>
        <Button type="submit">{$LL.save()}</Button>
      </DialogFooter>
    </form>
  </DialogContent>
</Dialog>
