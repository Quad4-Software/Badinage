<script lang="ts">
  import LL from '$lib/i18n/i18n-svelte'
  import type { Conversation } from '$lib/state/chats.svelte'
  import { parseJid } from '$lib/utils/jid'

  import PeerAvatar from '../peer-avatar.svelte'
  import TypingIndicator from '../typing-indicator.svelte'

  interface Props {
    conversation: Conversation
  }

  let { conversation }: Props = $props()

  // muc typers are nicks keyed room/nick for the avatar lookup, capped
  // so a flood of typers does not grow the row
  const typerAvatars = $derived(
    [...conversation.typers].slice(0, 3).map((nick) => ({
      nick,
      jid: `${conversation.peerJid}/${nick}`
    }))
  )
</script>

{#if conversation.kind === 'muc'}
  <span class="flex shrink-0 -space-x-1.5">
    {#each typerAvatars as typer (typer.jid)}
      <PeerAvatar
        jid={typer.jid}
        fallback={typer.nick.slice(0, 2)}
        class="ring-background size-5 ring-2"
      />
    {/each}
  </span>
{:else}
  <PeerAvatar
    jid={conversation.peerJid}
    fallback={(parseJid(conversation.peerJid).local ?? conversation.peerJid).slice(0, 2)}
    force
    class="size-6 shrink-0"
  />
{/if}
<span class="bg-muted inline-flex items-center rounded-2xl rounded-bl-sm px-3 py-2">
  <TypingIndicator class="text-muted-foreground" />
</span>
{#if conversation.kind === 'muc'}
  <span class="text-muted-foreground text-xs">
    {$LL.typingNames({ names: [...conversation.typers].join(', ') })}
  </span>
{/if}
