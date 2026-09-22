<script lang="ts">
  import LL from '$lib/i18n/i18n-svelte'

  import PeerAvatar from '../peer-avatar.svelte'

  interface Props {
    // false on continuation rows: the spacer keeps the column aligned
    show: boolean
    jid: string
    fallback: string
    force?: boolean
    // display name for the button label
    name?: string
    // opens the sender profile. Absent, the avatar stays decorative
    onClick?: (() => void) | undefined
  }

  let { show, jid, fallback, force = false, name = '', onClick }: Props = $props()
</script>

{#if show}
  {#if onClick}
    <button
      type="button"
      class="focus-visible:ring-ring size-7 shrink-0 cursor-pointer rounded-full transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:outline-none"
      aria-label={$LL.viewProfileOf({ name })}
      onclick={onClick}
    >
      <PeerAvatar {jid} {fallback} {force} class="size-7" />
    </button>
  {:else}
    <PeerAvatar {jid} {fallback} {force} class="size-7" />
  {/if}
{:else}
  <!-- keeps continuation bubbles aligned under the avatar column -->
  <span class="size-7 shrink-0" aria-hidden="true"></span>
{/if}
