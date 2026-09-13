<script lang="ts">
  import { X } from '@lucide/svelte'

  import LL from '$lib/i18n/i18n-svelte'
  import { app } from '$lib/state/app.svelte'
  import type { ComposerContext } from '$lib/state/composer.svelte'
  import { Button } from '$lib/ui/primitives/button'
  import { bareJid } from '$lib/utils/jid'

  // the reply/edit context strip above the input row
  let { peerJid, ctx }: { peerJid: string; ctx: ComposerContext } = $props()
</script>

{#if ctx.replyTo || ctx.editing}
  <div class="bg-muted/60 flex items-center gap-2 px-3 py-1.5 text-xs">
    <span class="border-primary min-w-0 flex-1 truncate border-l-2 pl-2">
      {#if ctx.replyTo}
        {$LL.replyingTo({ name: ctx.replyTo.nick ?? bareJid(ctx.replyTo.peerJid) })}:
        {ctx.replyTo.body}
      {:else if ctx.editing}
        {$LL.editingMessage()}: {ctx.editing.body}
      {/if}
    </span>
    <Button
      variant="ghost"
      size="icon"
      class="size-6 shrink-0"
      onclick={() => app.setComposer(peerJid, {})}
      aria-label={$LL.cancelEdit()}
    >
      <X class="size-3.5" />
    </Button>
  </div>
{/if}
