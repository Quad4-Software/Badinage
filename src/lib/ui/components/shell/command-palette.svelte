<script lang="ts">
  import { Search } from '@lucide/svelte'
  import { Command } from 'bits-ui'

  import LL from '$lib/i18n/i18n-svelte'
  import { app } from '$lib/state/app.svelte'
  import { Dialog, DialogContent, DialogTitle } from '$lib/ui/primitives/dialog'

  import PeerAvatar from '../chat/peer-avatar.svelte'
  import { paletteResults } from './command-palette/items'

  let query = $state('')
  const results = $derived(paletteResults(query))

  // fresh query on every open
  $effect(() => {
    if (app.paletteOpen) query = ''
  })
</script>

<Dialog bind:open={app.paletteOpen}>
  <DialogContent class="top-[20%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-2xl">
    <DialogTitle class="sr-only">{$LL.palettePlaceholder()}</DialogTitle>
    <Command.Root shouldFilter={false} loop label={$LL.palettePlaceholder()}>
      <div class="flex items-center gap-2 border-b px-3">
        <Search class="text-muted-foreground size-4 shrink-0" />
        <Command.Input
          bind:value={query}
          autofocus
          placeholder={$LL.palettePlaceholder()}
          class="placeholder:text-muted-foreground flex h-11 w-full bg-transparent text-sm outline-none"
        />
      </div>
      <Command.List class="max-h-72 overflow-x-hidden overflow-y-auto p-1.5">
        <!-- the viewport registers itself with the root so the input's
          aria-controls resolves; without it the combobox violates
          aria-required-attr -->
        <Command.Viewport>
          <Command.Empty class="text-muted-foreground py-6 text-center text-sm">
            {$LL.paletteEmpty()}
          </Command.Empty>
          {#each results as group (group.id)}
            <Command.Group value={group.id}>
              <Command.GroupHeading class="text-muted-foreground px-2 py-1.5 text-xs font-medium">
                {group.heading}
              </Command.GroupHeading>
              <Command.GroupItems>
                {#each group.items as item (item.id)}
                  <Command.Item
                    value={item.id}
                    class="data-[selected]:bg-accent data-[selected]:text-accent-foreground flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm select-none"
                    onSelect={item.run}
                  >
                    {#if item.avatar}
                      <PeerAvatar
                        jid={item.avatar.jid}
                        account={item.avatar.account}
                        force={item.avatar.force ?? false}
                        fallback={item.avatar.fallback}
                        class="size-5 shrink-0"
                      />
                    {:else}
                      <item.icon class="size-4 shrink-0" />
                    {/if}
                    <span class="min-w-0 flex-1 truncate">{item.label}</span>
                    {#if item.detail}
                      <!-- text-foreground/70 clears the 4.5:1 floor that
                        muted-foreground misses on the popover surface -->
                      <span class="text-foreground/70 max-w-[45%] truncate text-xs">
                        {item.detail}
                      </span>
                    {/if}
                  </Command.Item>
                {/each}
              </Command.GroupItems>
            </Command.Group>
          {/each}
        </Command.Viewport>
      </Command.List>
    </Command.Root>
  </DialogContent>
</Dialog>
