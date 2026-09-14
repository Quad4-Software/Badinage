<script lang="ts">
  import type { InstalledExt } from '$lib/core/extensions/types'
  import LL from '$lib/i18n/i18n-svelte'
  import { extApi } from '$lib/state/app/ext-api.svelte'
  import { extensions } from '$lib/state/app/extensions.svelte'
  import { Checkbox } from '$lib/ui/primitives/checkbox'
  import { Dialog, DialogContent, DialogHeader, DialogTitle } from '$lib/ui/primitives/dialog'
  import { Input } from '$lib/ui/primitives/input'
  import { Label } from '$lib/ui/primitives/label'

  let {
    ext,
    open = $bindable(false),
    onOpenChange
  }: {
    ext: InstalledExt
    open?: boolean
    onOpenChange?: ((open: boolean) => void) | undefined
  } = $props()

  const fields = $derived(extApi.settingFields.get(ext.id) ?? [])
  const values = $derived(extApi.settingValues.get(ext.id) ?? {})

  function valueOf(key: string, fallback: unknown): unknown {
    return key in values ? values[key] : fallback
  }

  function set(key: string, value: unknown) {
    extensions.setSettingValue(ext.id, key, value)
  }
</script>

<Dialog bind:open {...onOpenChange !== undefined ? { onOpenChange } : {}}>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>{ext.name}</DialogTitle>
    </DialogHeader>
    {#if fields.length === 0}
      <p class="text-muted-foreground text-xs">{$LL.extensionNoSettings()}</p>
    {/if}
    <div class="grid gap-4 py-2">
      {#each fields as field (field.key)}
        {@const value = valueOf(field.key, field.default)}
        {#if field.type === 'checkbox'}
          <label class="flex items-center gap-2 text-sm">
            <Checkbox
              checked={value === true}
              onCheckedChange={(v) => set(field.key, v === true)}
            />
            {field.label}
          </label>
        {:else if field.type === 'select'}
          <div class="grid gap-2">
            <Label for="ext-set-{field.key}">{field.label}</Label>
            <select
              id="ext-set-{field.key}"
              class="bg-background w-full rounded-md border px-2 py-1.5 text-sm"
              value={String(value ?? '')}
              onchange={(e) => set(field.key, e.currentTarget.value)}
            >
              {#each field.options ?? [] as option (option)}
                <option value={option}>{option}</option>
              {/each}
            </select>
          </div>
        {:else}
          <div class="grid gap-2">
            <Label for="ext-set-{field.key}">{field.label}</Label>
            <Input
              id="ext-set-{field.key}"
              type={field.type === 'number' ? 'number' : 'text'}
              value={String(value ?? '')}
              oninput={(e) =>
                set(
                  field.key,
                  field.type === 'number' ? e.currentTarget.valueAsNumber : e.currentTarget.value
                )}
            />
          </div>
        {/if}
      {/each}
    </div>
  </DialogContent>
</Dialog>
