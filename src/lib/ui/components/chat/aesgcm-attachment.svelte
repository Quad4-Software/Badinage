<script lang="ts">
  // XEP-0454 attachment: the url is aesgcm: with the AES-256-GCM key in
  // the fragment. The ciphertext is downloaded and decrypted client side,
  // then rendered from a blob url through the same components plain
  // attachments use. The key-bearing url is never linkified or opened.
  import { File, LoaderCircle } from '@lucide/svelte'

  import LL from '$lib/i18n/i18n-svelte'
  import type { Attachment } from '$lib/state/chats.svelte'
  import { fetchAesGcm } from '$lib/utils/aesgcm'
  import { formatSize, mediaKind } from '$lib/utils/media'

  import ChatImage from './chat-image.svelte'
  import VideoPlayer from '../media/video-player.svelte'
  import VoicePlayer from '../media/voice-player.svelte'

  let {
    attachment,
    onViewImage
  }: {
    attachment: Attachment
    onViewImage?: ((src: string, alt: string) => void) | undefined
  } = $props()

  let phase = $state<'pending' | 'error' | 'done'>('pending')
  let blobUrl = $state('')

  const kind = $derived(mediaKind(attachment.url, attachment.mediaType))
  const label = $derived(attachment.name ?? $LL.fileAttachment())

  $effect(() => {
    let cancelled = false
    let objectUrl: string | undefined
    phase = 'pending'
    fetchAesGcm(attachment.url)
      .then((blob) => {
        if (cancelled) return
        // the decrypted blob carries no type; re-tag it so browsers know
        // how to render or save it
        const typed = attachment.mediaType ? new Blob([blob], { type: attachment.mediaType }) : blob
        objectUrl = URL.createObjectURL(typed)
        blobUrl = objectUrl
        phase = 'done'
      })
      .catch(() => {
        if (!cancelled) phase = 'error'
      })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  })
</script>

{#if phase === 'done'}
  {#if kind === 'image'}
    <button
      type="button"
      class="block w-fit cursor-zoom-in"
      aria-label={$LL.viewImage()}
      onclick={() => onViewImage?.(blobUrl, attachment.name ?? $LL.imageAttachment())}
    >
      <ChatImage
        src={blobUrl}
        alt={attachment.name ?? $LL.imageAttachment()}
        mediaType={attachment.mediaType}
        class="max-h-64 max-w-xs rounded-lg object-cover"
      />
    </button>
  {:else if kind === 'video'}
    <VideoPlayer url={blobUrl} name={attachment.name} />
  {:else if kind === 'audio'}
    <VoicePlayer url={blobUrl} duration={attachment.duration} />
  {:else}
    <a
      href={blobUrl}
      download={attachment.name}
      class="bg-card text-card-foreground hover:bg-accent flex w-fit max-w-xs items-center gap-2 rounded-lg border px-3 py-2 text-sm"
    >
      <File class="text-muted-foreground size-4 shrink-0" />
      <span class="min-w-0 truncate">{label}</span>
      {#if attachment.size !== undefined}
        <span class="text-muted-foreground shrink-0 text-xs">{formatSize(attachment.size)}</span>
      {/if}
    </a>
  {/if}
{:else}
  <span
    class="bg-card text-card-foreground flex w-fit max-w-xs items-center gap-2 rounded-lg border px-3 py-2 text-sm"
    role={phase === 'error' ? 'alert' : undefined}
  >
    {#if phase === 'pending'}
      <LoaderCircle class="text-muted-foreground size-4 shrink-0 animate-spin" />
      <span class="min-w-0 truncate">{$LL.decryptingAttachment()}</span>
    {:else}
      <File class="text-destructive size-4 shrink-0" />
      <span class="min-w-0 truncate">{label}</span>
      <span class="text-destructive shrink-0 text-xs">{$LL.attachmentDecryptFailed()}</span>
    {/if}
  </span>
{/if}
