<script lang="ts">
  import { Hash } from '@lucide/svelte'
  import { tick } from 'svelte'

  import LL from '$lib/i18n/i18n-svelte'
  import { accounts } from '$lib/state/accounts.svelte'
  import { app } from '$lib/state/app.svelte'
  import type { Conversation } from '$lib/state/chats.svelte'
  import type { SharePayload } from '$lib/state/links'
  import { sendFileMessage } from '$lib/state/upload'
  import { formatSize } from '$lib/utils/media'
  import { Button } from '$lib/ui/primitives/button'
  import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle
  } from '$lib/ui/primitives/dialog'
  import { ScrollArea } from '$lib/ui/primitives/scroll-area'
  import { toast } from '$lib/ui/primitives/sonner'

  let { open = $bindable(false), payload }: { open?: boolean; payload: SharePayload } = $props()

  const account = $derived(accounts.active)
  const conversations = $derived(
    account ? [...app.chatsFor(account.jid).conversations.values()] : []
  )
  const rosterNames = $derived(new Map((account?.roster ?? []).map((c) => [c.jid, c.name])))

  // share sheets commonly repeat the title inside the text. Dedupe so
  // the draft is not doubled up
  const sharedText = $derived(
    [
      ...new Set(
        [payload.title, payload.text, payload.url].map((part) => part.trim()).filter(Boolean)
      )
    ].join('\n')
  )
  const hasContent = $derived(payload.files.length > 0 || sharedText.length > 0)

  let listEl = $state<HTMLUListElement>()

  // move focus into the picker when the dialog opens
  $effect(() => {
    if (open) void tick().then(() => listEl?.querySelector('button')?.focus())
  })

  function displayName(conversation: Conversation): string {
    if (conversation.kind === 'muc') {
      return conversation.peerJid.split('@')[0] ?? conversation.peerJid
    }
    return rosterNames.get(conversation.peerJid) || conversation.peerJid
  }

  // files upload and send right away, shared text lands in the draft so
  // the user can review or edit before it goes out
  function pick(conversation: Conversation) {
    const current = account
    if (!current) return
    const peer = conversation.peerJid
    const chatType = conversation.kind === 'muc' ? 'groupchat' : 'chat'
    for (const file of payload.files) {
      sendFileMessage(
        current,
        peer,
        chatType,
        file,
        file.name || 'file',
        file.type || 'application/octet-stream',
        () => toast.error($LL.uploadFailed())
      )
    }
    if (sharedText) app.setDraft(peer, sharedText)
    app.selectPeer(peer)
    toast.success($LL.sharedQueued())
    open = false
  }
</script>

<Dialog bind:open>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>{$LL.shareTitle()}</DialogTitle>
    </DialogHeader>
    <div class="flex flex-col gap-4">
      {#if hasContent}
        <div class="rounded-md border p-3 text-sm">
          {#if payload.title}
            <p class="font-medium break-words">{payload.title}</p>
          {/if}
          {#if payload.text}
            <p class="break-words whitespace-pre-wrap">{payload.text}</p>
          {/if}
          {#if payload.url}
            <p class="text-muted-foreground break-all">{payload.url}</p>
          {/if}
          {#if payload.files.length > 0}
            <p class="text-muted-foreground mt-2 text-xs">
              {$LL.shareFiles({ count: payload.files.length })}
            </p>
            <ul class="mt-1 flex flex-col gap-1">
              {#each payload.files as file (file.name + file.size)}
                <li class="flex items-center justify-between gap-2">
                  <span class="min-w-0 truncate">{file.name}</span>
                  <span class="text-muted-foreground shrink-0 text-xs">
                    {formatSize(file.size)}
                  </span>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
        <p class="text-muted-foreground text-sm">{$LL.sharePickHint()}</p>
        {#if conversations.length === 0}
          <p class="text-muted-foreground px-2 py-4 text-sm">{$LL.shareEmpty()}</p>
        {:else}
          <ScrollArea class="max-h-64">
            <ul
              bind:this={listEl}
              class="flex flex-col gap-0.5"
              aria-label={$LL.pickConversation()}
            >
              {#each conversations as conversation (conversation.peerJid)}
                <li>
                  <button
                    type="button"
                    class="hover:bg-accent focus-visible:ring-ring flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm focus-visible:ring-2 focus-visible:outline-none"
                    aria-label="{$LL.send()} {displayName(conversation)}"
                    onclick={() => pick(conversation)}
                  >
                    {#if conversation.kind === 'muc'}
                      <Hash class="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
                    {/if}
                    <span class="min-w-0 flex-1">
                      <span class="block truncate font-medium">{displayName(conversation)}</span>
                      <span class="text-muted-foreground block truncate text-xs">
                        {conversation.peerJid}
                      </span>
                    </span>
                    {#if conversation.unread > 0}
                      <span
                        class="bg-primary text-primary-foreground shrink-0 rounded-full px-1.5 text-xs"
                      >
                        {conversation.unread}
                      </span>
                    {/if}
                  </button>
                </li>
              {/each}
            </ul>
          </ScrollArea>
        {/if}
      {:else}
        <p class="text-muted-foreground px-2 py-4 text-sm">{$LL.shareEmpty()}</p>
      {/if}
      <DialogFooter>
        <Button type="button" variant="ghost" onclick={() => (open = false)}>
          {$LL.cancel()}
        </Button>
      </DialogFooter>
    </div>
  </DialogContent>
</Dialog>
