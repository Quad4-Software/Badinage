<script lang="ts">
  import { X } from '@lucide/svelte'

  import LL from '$lib/i18n/i18n-svelte'
  import { app } from '$lib/state/app.svelte'
  import { Button } from '$lib/ui/primitives/button'

  export interface SplitChoice {
    jid: string
    room: boolean
    name: string
  }

  let { peer, dms, rooms }: { peer: string | null; dms: SplitChoice[]; rooms: SplitChoice[] } =
    $props()
</script>

<div class="flex items-center gap-2 border-b p-2">
  <select
    class="bg-background min-w-0 flex-1 rounded-md border px-2 py-1.5 text-sm"
    value={peer ?? ''}
    onchange={(e) => {
      const v = (e.target as HTMLSelectElement).value
      app.splitPeer = v || null
    }}
    aria-label={$LL.openInSplit()}
  >
    <option value="">{$LL.pickConversation()}</option>
    {#if dms.length > 0}
      <optgroup label={$LL.conversations()}>
        {#each dms as choice (choice.jid)}
          <option value={choice.jid}>{choice.name}</option>
        {/each}
      </optgroup>
    {/if}
    {#if rooms.length > 0}
      <optgroup label={$LL.rooms()}>
        {#each rooms as choice (choice.jid)}
          <option value={choice.jid}>{choice.name}</option>
        {/each}
      </optgroup>
    {/if}
  </select>
  <Button
    variant="ghost"
    size="icon"
    onclick={() => (app.splitPeer = null)}
    aria-label={$LL.closePane()}
  >
    <X class="size-4" />
  </Button>
</div>
