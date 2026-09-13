<script lang="ts">
  import { tick } from 'svelte'

  import type { ChannelSearchItem, DataFormField } from '$lib/core/xmpp/stanzas'
  import LL from '$lib/i18n/i18n-svelte'
  import { accounts } from '$lib/state/accounts.svelte'
  import { app } from '$lib/state/app.svelte'
  import { explore, fallbackSearchForm } from '$lib/state/explore'
  import { jidDomain } from '$lib/utils/jid'
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

  let query = $state('')
  let queryRef = $state<HTMLInputElement | null>(null)

  const canSearch = $derived(explore.service.trim().length > 0 && !explore.loading)

  // on open: reset, focus the query box, and resolve the search service
  // for the active account. A discovery miss still prefills the
  // conventional conference.<domain> address so the user can point the
  // search at another service by hand.
  $effect(() => {
    if (!explore.open) return
    const account = accounts.active
    if (!account) {
      explore.open = false
      return
    }
    explore.reset()
    query = ''
    void tick().then(() => queryRef?.focus())
    explore.discoverSearchService(account, (service) => {
      if (!explore.open) return
      if (service) {
        explore.service = service
        explore.fetchForm(service)
      } else {
        explore.service = `conference.${jidDomain(account.jid)}`
        explore.form = fallbackSearchForm()
        explore.error = 'missing'
      }
    })
  })

  const fieldId = (field: DataFormField) => `explore-field-${field.var}`

  function boolValue(field: DataFormField): boolean {
    return field.values[0] === 'true' || field.values[0] === '1'
  }

  function submit(event: SubmitEvent) {
    event.preventDefault()
    const service = explore.service.trim()
    if (!service) return
    explore.search(service, query.trim())
  }

  // hand the picked room to the join-room dialog through joinPrefill.
  // that dialog prefills its room field from the slot and clears it
  function join(item: ChannelSearchItem) {
    explore.joinPrefill = { room: item.address }
    explore.open = false
    app.joinRoomOpen = true
  }
</script>

<Dialog bind:open={explore.open}>
  <DialogContent class="flex max-h-[85vh] flex-col">
    <DialogHeader>
      <DialogTitle>{$LL.exploreRooms()}</DialogTitle>
      <DialogDescription>{$LL.exploreHint()}</DialogDescription>
    </DialogHeader>
    <form onsubmit={submit} class="flex flex-col gap-4">
      <div class="grid gap-2">
        <Label for="explore-service">{$LL.searchService()}</Label>
        <Input
          id="explore-service"
          bind:value={explore.service}
          placeholder={$LL.searchServicePlaceholder()}
          required
        />
      </div>
      <div class="grid gap-2">
        <Label for="explore-query">{$LL.searchChannels()}</Label>
        <Input
          id="explore-query"
          bind:ref={queryRef}
          bind:value={query}
          placeholder={$LL.searchQueryPlaceholder()}
        />
      </div>
      {#each explore.fields as field (field.var)}
        <div class="grid gap-2">
          {#if field.type === 'boolean'}
            <div class="flex items-center gap-2">
              <Checkbox
                id={fieldId(field)}
                checked={boolValue(field)}
                onCheckedChange={(checked) => (field.values = [checked ? '1' : '0'])}
              />
              <Label for={fieldId(field)} class="text-sm font-normal">
                {field.label ?? field.var}
              </Label>
            </div>
          {:else if field.type === 'list-single'}
            <Label for={fieldId(field)}>{field.label ?? field.var}</Label>
            <select
              id={fieldId(field)}
              class="bg-background rounded-md border px-2 py-1.5 text-sm"
              value={field.values[0] ?? ''}
              required={field.required}
              onchange={(e) => (field.values = [e.currentTarget.value])}
            >
              {#if !field.required}
                <option value=""></option>
              {/if}
              {#each field.options as option (option.value)}
                <option value={option.value}>{option.label ?? option.value}</option>
              {/each}
            </select>
          {:else if field.type === 'fixed'}
            <p class="text-muted-foreground text-sm">{field.values.join(' ')}</p>
          {:else}
            <Label for={fieldId(field)}>{field.label ?? field.var}</Label>
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
      {/each}
      {#if explore.error === 'missing'}
        <p class="text-muted-foreground text-sm">{$LL.searchServiceMissing()}</p>
      {/if}
      <DialogFooter>
        <Button type="button" variant="ghost" onclick={() => (explore.open = false)}>
          {$LL.close()}
        </Button>
        <Button type="submit" disabled={!canSearch}>{$LL.searchChannels()}</Button>
      </DialogFooter>
    </form>
    <div class="min-h-6 shrink overflow-y-auto" aria-busy={explore.loading} aria-live="polite">
      {#if explore.error === 'failed'}
        <p class="text-muted-foreground text-sm">{$LL.searchFailed()}</p>
      {:else if explore.results.length > 0}
        <ul class="flex flex-col gap-2">
          {#each explore.results as item (item.address)}
            <li class="flex items-start justify-between gap-3 rounded-md border px-3 py-2">
              <div class="min-w-0">
                <p class="truncate text-sm font-medium">{item.name ?? item.address}</p>
                {#if item.name}
                  <p class="text-muted-foreground truncate text-xs">{item.address}</p>
                {/if}
                {#if item.description}
                  <p class="text-muted-foreground mt-0.5 line-clamp-2 text-xs">
                    {item.description}
                  </p>
                {/if}
                {#if item.nusers !== undefined}
                  <p class="text-muted-foreground mt-0.5 text-xs">
                    {$LL.channelUsers({ count: item.nusers })}
                  </p>
                {/if}
              </div>
              <Button size="sm" variant="outline" onclick={() => join(item)}>
                {$LL.join()}
              </Button>
            </li>
          {/each}
        </ul>
      {:else if explore.searched && !explore.loading}
        <p class="text-muted-foreground text-sm">{$LL.searchEmpty()}</p>
      {/if}
    </div>
  </DialogContent>
</Dialog>
