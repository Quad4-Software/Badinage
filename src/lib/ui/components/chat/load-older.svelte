<script lang="ts">
  import { LoaderCircle } from '@lucide/svelte'

  import LL from '$lib/i18n/i18n-svelte'
  import { Button } from '$lib/ui/primitives/button'

  interface Props {
    // an archive page is in flight
    loading: boolean
    // the archive is exhausted for this conversation
    complete: boolean
    // the user is scrolled near the top - only then is the button shown
    nearTop: boolean
    onLoad: () => void
  }

  let { loading, complete, nearTop, onLoad }: Props = $props()
</script>

<!--
  Fixed height so swapping between button, spinner and label never shifts
  the scroll position of the messages below.
-->
<div class="flex h-9 shrink-0 items-center justify-center">
  {#if loading}
    <span role="status">
      <LoaderCircle class="text-muted-foreground size-4 animate-spin" aria-hidden="true" />
      <span class="sr-only">{$LL.loadOlder()}</span>
    </span>
  {:else if complete}
    <span class="text-muted-foreground text-xs">{$LL.beginningOfHistory()}</span>
  {:else if nearTop}
    <Button variant="ghost" size="sm" onclick={onLoad}>{$LL.loadOlder()}</Button>
  {/if}
</div>
