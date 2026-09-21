<script lang="ts">
  import { DropdownMenu } from 'bits-ui'
  import { Image, MapPin, Mic, Paperclip, Plus, Video } from '@lucide/svelte'

  import LL from '$lib/i18n/i18n-svelte'
  import { Button } from '$lib/ui/primitives/button'

  // the desktop attachment menu behind the composer plus button. Mobile
  // uses attach-sheet instead. The accept string filters the native file
  // picker, voice hands off to the recorder
  let {
    locating = false,
    disabled = false,
    onAttach,
    onLocation,
    onVoice
  }: {
    locating?: boolean
    disabled?: boolean
    onAttach: (accept: string) => void
    onLocation: () => void
    onVoice: () => void
  } = $props()

  const itemClass =
    'data-[highlighted]:bg-accent flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none'
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger class="hidden shrink-0 md:inline-flex">
    {#snippet child({ props })}
      <Button {...props} variant="ghost" size="icon" aria-label={$LL.attachFile()} {disabled}>
        <Plus class="size-4" />
      </Button>
    {/snippet}
  </DropdownMenu.Trigger>
  <DropdownMenu.Portal>
    <DropdownMenu.Content
      class="bg-popover text-popover-foreground z-50 min-w-44 rounded-md border p-1 shadow-md"
      side="top"
      sideOffset={4}
      align="start"
    >
      <DropdownMenu.Item class={itemClass} onSelect={() => onAttach('image/*')}>
        <Image class="size-4" />
        {$LL.attachImage()}
      </DropdownMenu.Item>
      <DropdownMenu.Item class={itemClass} onSelect={() => onAttach('video/*')}>
        <Video class="size-4" />
        {$LL.attachVideo()}
      </DropdownMenu.Item>
      <DropdownMenu.Item class={itemClass} onSelect={() => onAttach('')}>
        <Paperclip class="size-4" />
        {$LL.attachFile()}
      </DropdownMenu.Item>
      <DropdownMenu.Item class={itemClass} disabled={locating} onSelect={onLocation}>
        <MapPin class="size-4" />
        {$LL.shareLocation()}
      </DropdownMenu.Item>
      <DropdownMenu.Item class={itemClass} onSelect={onVoice}>
        <Mic class="size-4" />
        {$LL.recordVoice()}
      </DropdownMenu.Item>
    </DropdownMenu.Content>
  </DropdownMenu.Portal>
</DropdownMenu.Root>
