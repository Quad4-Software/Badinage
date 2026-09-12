<script lang="ts">
  import { File } from '@lucide/svelte'

  import LL from '$lib/i18n/i18n-svelte'
  import type { Attachment } from '$lib/state/chats.svelte'

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
    {#if attachment.mediaType.startsWith('image/')}
      <a
        href={attachment.url}
        target="_blank"
        rel="noopener noreferrer"
        class="block w-fit"
        aria-label={$LL.imageAttachment()}
      >
        <img
          src={attachment.url}
          alt={attachment.name ?? $LL.imageAttachment()}
          loading="lazy"
          class="max-h-64 max-w-xs rounded-lg object-cover"
        />
      </a>
    {:else if attachment.mediaType.startsWith('audio/')}
      <VoicePlayer url={attachment.url} duration={attachment.duration} />
    {:else}
      <a
        href={attachment.url}
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
