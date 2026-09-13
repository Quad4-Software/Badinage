<script lang="ts">
  import { Image, MapPin, Paperclip, Video } from '@lucide/svelte'

  import LL from '$lib/i18n/i18n-svelte'
  import { Sheet } from '$lib/ui/primitives/sheet'

  // the mobile attachment menu behind the composer plus button. The
  // accept string filters the native file picker
  let {
    open = $bindable(false),
    locating = false,
    onAttach,
    onLocation
  }: {
    open?: boolean
    locating?: boolean
    onAttach: (accept: string) => void
    onLocation: () => void
  } = $props()

  const rowClass =
    'hover:bg-accent hover:text-accent-foreground flex h-11 w-full items-center gap-3 rounded-md px-3 text-left text-sm'

  function pick(accept: string) {
    open = false
    onAttach(accept)
  }
</script>

<Sheet bind:open title={$LL.attachFile()}>
  <div class="flex flex-col">
    <button type="button" class={rowClass} onclick={() => pick('image/*')}>
      <Image class="size-4" />
      {$LL.attachImage()}
    </button>
    <button type="button" class={rowClass} onclick={() => pick('video/*')}>
      <Video class="size-4" />
      {$LL.attachVideo()}
    </button>
    <button type="button" class={rowClass} onclick={() => pick('')}>
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
