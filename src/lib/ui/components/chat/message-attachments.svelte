<script lang="ts">
  import { File } from '@lucide/svelte'

  import LL from '$lib/i18n/i18n-svelte'
  import type { Attachment } from '$lib/state/chats.svelte'
  import { formatSize, mediaKind } from '$lib/utils/media'
  import { safeUrl } from '$lib/utils/url'

  import ChatImage from './chat-image.svelte'
  import ImageLightbox from '../media/image-lightbox.svelte'
  import VideoPlayer from '../media/video-player.svelte'
  import VoicePlayer from '../media/voice-player.svelte'

  let { attachments }: { attachments: Attachment[] } = $props()

  let lightbox = $state<{ src: string; alt: string } | null>(null)
</script>

<div class="flex flex-col gap-1">
  {#each attachments as attachment (attachment.url)}
    {@const url = safeUrl(attachment.url)}
    {@const kind = url ? mediaKind(attachment.url, attachment.mediaType) : 'file'}
    {#if url === null}
      <!-- scheme is not on the allow-list: show a name chip, never a link -->
      <span
        class="bg-card text-card-foreground flex w-fit max-w-xs items-center gap-2 rounded-lg border px-3 py-2 text-sm"
      >
        <File class="text-muted-foreground size-4 shrink-0" />
        <span class="min-w-0 truncate">{attachment.name ?? $LL.fileAttachment()}</span>
        {#if attachment.size !== undefined}
          <span class="text-muted-foreground shrink-0 text-xs">{formatSize(attachment.size)}</span>
        {/if}
      </span>
    {:else if kind === 'image'}
      <button
        type="button"
        class="block w-fit cursor-zoom-in"
        aria-label={$LL.viewImage()}
        onclick={() => (lightbox = { src: url, alt: attachment.name ?? $LL.imageAttachment() })}
      >
        <ChatImage
          src={url}
          alt={attachment.name ?? $LL.imageAttachment()}
          mediaType={attachment.mediaType}
          class="max-h-64 max-w-xs rounded-lg object-cover"
        />
      </button>
    {:else if kind === 'video'}
      <VideoPlayer {url} name={attachment.name} />
    {:else if kind === 'audio'}
      <VoicePlayer {url} duration={attachment.duration} />
    {:else}
      <a
        href={url}
        download={attachment.name}
        class="bg-card text-card-foreground hover:bg-accent flex w-fit max-w-xs items-center gap-2 rounded-lg border px-3 py-2 text-sm"
      >
        <File class="text-muted-foreground size-4 shrink-0" />
        <span class="min-w-0 truncate">{attachment.name ?? $LL.fileAttachment()}</span>
        {#if attachment.size !== undefined}
          <span class="text-muted-foreground shrink-0 text-xs">{formatSize(attachment.size)}</span>
        {/if}
      </a>
    {/if}
  {/each}
</div>

{#if lightbox}
  <ImageLightbox src={lightbox.src} alt={lightbox.alt} onClose={() => (lightbox = null)} />
{/if}
