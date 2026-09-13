<script lang="ts">
  import { MapPin, Paperclip } from '@lucide/svelte'

  import LL from '$lib/i18n/i18n-svelte'
  import { Sheet } from '$lib/ui/primitives/sheet'

  // the mobile attachment menu behind the composer plus button
  let {
    open = $bindable(false),
    locating = false,
    onAttach,
    onLocation
  }: {
    open?: boolean
    locating?: boolean
    onAttach: () => void
    onLocation: () => void
  } = $props()

  const rowClass =
    'hover:bg-accent hover:text-accent-foreground flex h-11 w-full items-center gap-3 rounded-md px-3 text-left text-sm'
</script>

<Sheet bind:open title={$LL.attachFile()}>
  <div class="flex flex-col">
    <button
      type="button"
      class={rowClass}
      onclick={() => {
        open = false
        onAttach()
      }}
    >
      <Paperclip class="size-4" />
      {$LL.attachFile()}
    </button>
    <button
      type="button"
      class={rowClass}
      disabled={locating}
      onclick={() => {
        open = false
        onLocation()
      }}
    >
      <MapPin class="size-4" />
      {$LL.shareLocation()}
    </button>
  </div>
</Sheet>
