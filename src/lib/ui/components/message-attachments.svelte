<script lang="ts">
  import { File } from '@lucide/svelte'

  import LL from '$lib/i18n/i18n-svelte'
  import type { Attachment } from '$lib/state/chats.svelte'
  import { safeUrl } from '$lib/utils/url'

  import ChatImage from './chat-image.svelte'
  import VoicePlayer from './voice-player.svelte'

  let { attachments }: { attachments: Attachment[] } = $props()

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }
</script>

<div class="flex flex-col gap-1">
  {#each attachments as attachment (attachment.url)}
    {@const url = safeUrl(attachment.url)}
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
    {:else if attachment.mediaType.startsWith('image/')}
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        class="block w-fit"
        aria-label={$LL.imageAttachment()}
      >
        <ChatImage
          src={url}
          alt={attachment.name ?? $LL.imageAttachment()}
          mediaType={attachment.mediaType}
          class="max-h-64 max-w-xs rounded-lg object-cover"
        />
      </a>
    {:else if attachment.mediaType.startsWith('audio/')}
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
