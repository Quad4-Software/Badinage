<script lang="ts">
  import type { DataForm, DataFormField } from '$lib/core/xmpp/stanzas'
  import LL from '$lib/i18n/i18n-svelte'
  import { accounts } from '$lib/state/accounts.svelte'
  import { Button } from '$lib/ui/primitives/button'
  import { Checkbox } from '$lib/ui/primitives/checkbox'
  import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
  } from '$lib/ui/primitives/dialog'
  import { Input } from '$lib/ui/primitives/input'
  import { Label } from '$lib/ui/primitives/label'
  import { Skeleton } from '$lib/ui/primitives/skeleton'
  import { Switch } from '$lib/ui/primitives/switch'

  let { open = $bindable(false), room }: { open?: boolean; room: string } = $props()

  const account = $derived(accounts.active)

  let form = $state<DataForm | null>(null)
  let loading = $state(false)
  let failed = $state(false)
  // jid-multi and text-multi edit a joined blob; the lines are split
  // back into values at submit time so trailing newlines stay editable
  let multiText = $state<Record<string, string>>({})

  $effect(() => {
    if (!open || !account) return
    loading = true
    failed = false
    form = null
    multiText = {}
    account.connection.fetchRoomConfig(room, (result) => {
      form = result
      failed = result === null
      loading = false
      if (result) {
        for (const field of result.fields) {
          if (field.type === 'jid-multi' || field.type === 'text-multi') {
            multiText[field.var] = field.values.join('\n')
          }
        }
      }
    })
  })

  function fieldLabel(field: DataFormField): string {
    return field.label ?? field.var
  }

  function boolValue(field: DataFormField): boolean {
    return field.values[0] === '1' || field.values[0] === 'true'
  }

  function submit(event: SubmitEvent) {
    event.preventDefault()
    if (!account || !form) return
    for (const field of form.fields) {
      if (field.type === 'jid-multi' || field.type === 'text-multi') {
        field.values = (multiText[field.var] ?? '')
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.length > 0)
      }
    }
    account.connection.submitRoomConfig(room, form)
    open = false
  }

  // a stable id per field for label association
  const fieldId = (field: DataFormField) => `room-config-${field.var}`
</script>

<Dialog bind:open>
  <DialogContent class="max-h-[85vh] overflow-y-auto">
    <DialogHeader>
      <DialogTitle>{form?.title ?? $LL.roomConfig()}</DialogTitle>
      {#if form?.instructions}
        <DialogDescription>{form.instructions}</DialogDescription>
      {/if}
    </DialogHeader>
    {#if loading}
      <div class="flex flex-col gap-3" role="status" aria-label={$LL.loading()}>
        {#each Array.from({ length: 4 }) as _, i (i)}
          <Skeleton class="h-9 w-full" />
        {/each}
      </div>
    {:else if failed}
      <p class="text-muted-foreground text-sm">{$LL.roomConfigFailed()}</p>
    {:else if form}
      <form onsubmit={submit} class="flex flex-col gap-4">
        {#each form.fields as field (field.var)}
          {#if field.type !== 'hidden'}
            <div class="grid gap-2">
              {#if field.type === 'fixed'}
                <p class="text-muted-foreground text-sm">{field.values.join(' ')}</p>
              {:else if field.type === 'boolean'}
                <div class="flex items-center gap-2">
                  <Switch
                    id={fieldId(field)}
                    checked={boolValue(field)}
                    onCheckedChange={(checked) => (field.values = [checked ? '1' : '0'])}
                  />
                  <Label for={fieldId(field)}>{fieldLabel(field)}</Label>
                </div>
              {:else if field.type === 'list-single'}
                <Label for={fieldId(field)}>{fieldLabel(field)}</Label>
                <select
                  id={fieldId(field)}
                  class="bg-background rounded-md border px-2 py-1.5 text-sm"
                  value={field.values[0] ?? ''}
                  required={field.required}
                  onchange={(e) => (field.values = [e.currentTarget.value])}
                >
                  {#each field.options as option (option.value)}
                    <option value={option.value}>{option.label ?? option.value}</option>
                  {/each}
                </select>
              {:else if field.type === 'list-multi'}
                <span class="text-sm font-medium" id={fieldId(field)}>{fieldLabel(field)}</span>
                <div class="flex flex-col gap-1.5" role="group" aria-labelledby={fieldId(field)}>
                  {#each field.options as option (option.value)}
                    <div class="flex items-center gap-2">
                      <Checkbox
                        id={`${fieldId(field)}-${option.value}`}
                        checked={field.values.includes(option.value)}
                        onCheckedChange={(checked) => {
                          field.values = checked
                            ? [...field.values, option.value]
                            : field.values.filter((v) => v !== option.value)
                        }}
                      />
                      <Label for={`${fieldId(field)}-${option.value}`}>
                        {option.label ?? option.value}
                      </Label>
                    </div>
                  {/each}
                </div>
              {:else if field.type === 'jid-multi' || field.type === 'text-multi'}
                <Label for={fieldId(field)}>{fieldLabel(field)}</Label>
                <textarea
                  id={fieldId(field)}
                  class="border-input min-h-20 rounded-md border bg-transparent px-3 py-2 text-sm"
                  rows={3}
                  required={field.required}
                  value={multiText[field.var] ?? field.values.join('\n')}
                  oninput={(e) => (multiText[field.var] = e.currentTarget.value)}></textarea>
              {:else}
                <Label for={fieldId(field)}>{fieldLabel(field)}</Label>
                <Input
                  id={fieldId(field)}
                  type={field.type === 'text-private' ? 'password' : 'text'}
                  value={field.values[0] ?? ''}
                  required={field.required}
                  oninput={(e) => (field.values = [e.currentTarget.value])}
                />
              {/if}
              {#if field.desc && field.type !== 'fixed'}
                <p class="text-muted-foreground text-xs">{field.desc}</p>
              {/if}
            </div>
          {/if}
        {/each}
        <DialogFooter>
          <Button type="button" variant="ghost" onclick={() => (open = false)}>
            {$LL.cancel()}
          </Button>
          <Button type="submit">{$LL.save()}</Button>
        </DialogFooter>
      </form>
    {/if}
  </DialogContent>
</Dialog>
