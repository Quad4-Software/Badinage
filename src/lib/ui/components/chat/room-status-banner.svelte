<script lang="ts">
  import LL from '$lib/i18n/i18n-svelte'
  import { app } from '$lib/state/app.svelte'
  import type { Conversation, JoinError } from '$lib/state/conversation.svelte'
  import { Button } from '$lib/ui/primitives/button'
  import { Input } from '$lib/ui/primitives/input'

  let { conversation }: { conversation: Conversation } = $props()

  // inline retry affordances for the two recoverable failures: a
  // missing password (401/407) and a taken nickname (409)
  let retryNick = $state('')
  let retryPassword = $state('')

  type ErrorKind = 'password' | 'banned' | 'missing' | 'nick' | 'other'

  // RFC 6120 numeric codes are legacy but still common. Fall back to
  // the stanza error condition when the code is absent
  function classify(error: JoinError): ErrorKind {
    const condition = error.condition ?? ''
    if (error.code === '401' || error.code === '407') return 'password'
    if (error.code === '403') return 'banned'
    if (error.code === '404') return 'missing'
    if (error.code === '409') return 'nick'
    if (condition === 'not-authorized' || condition === 'registration-required') return 'password'
    if (condition === 'forbidden') return 'banned'
    if (condition === 'item-not-found') return 'missing'
    if (condition === 'conflict') return 'nick'
    return 'other'
  }

  const joinError = $derived(conversation.joinError)
  const kind = $derived(joinError ? classify(joinError) : null)

  function rejoin(nick?: string, password?: string) {
    const useNick = nick ?? conversation.ourNick ?? ''
    if (!useNick) return
    // noteJoin inside app.joinRoom clears the error banner
    app.joinRoom(conversation.peerJid, useNick, password ?? conversation.password)
  }
</script>

{#if conversation.banned || kind === 'banned'}
  <div class="bg-destructive/10 text-destructive px-4 py-2 text-sm" role="alert">
    <p>{$LL.bannedFromRoom()}</p>
    {#if conversation.kickReason}
      <p class="text-xs opacity-80">{conversation.kickReason}</p>
    {/if}
  </div>
{:else if conversation.kicked}
  <div
    class="bg-muted text-muted-foreground flex items-center gap-3 px-4 py-2 text-sm"
    role="status"
  >
    <p class="min-w-0 flex-1">
      {$LL.kickedFromRoom()}{conversation.kickReason ? ` · ${conversation.kickReason}` : ''}
    </p>
    <Button size="sm" variant="outline" onclick={() => rejoin()}>{$LL.rejoin()}</Button>
  </div>
{:else if joinError && kind === 'password'}
  <div class="bg-muted px-4 py-2 text-sm" role="alert">
    <p class="mb-1.5">{$LL.joinNeedsPassword()}</p>
    <form
      class="flex items-center gap-2"
      onsubmit={(e) => {
        e.preventDefault()
        rejoin(undefined, retryPassword)
      }}
    >
      <Input
        bind:value={retryPassword}
        type="password"
        class="h-8 flex-1"
        aria-label={$LL.password()}
        required
      />
      <Button size="sm" type="submit">{$LL.rejoin()}</Button>
    </form>
  </div>
{:else if joinError && kind === 'nick'}
  <div class="bg-muted px-4 py-2 text-sm" role="alert">
    <p class="mb-1.5">{$LL.joinNickTaken()}</p>
    <form
      class="flex items-center gap-2"
      onsubmit={(e) => {
        e.preventDefault()
        rejoin(retryNick.trim() || undefined)
      }}
    >
      <Input
        bind:value={retryNick}
        class="h-8 flex-1"
        placeholder={$LL.nicknamePlaceholder()}
        aria-label={$LL.nickname()}
        required
      />
      <Button size="sm" type="submit">{$LL.rejoin()}</Button>
    </form>
  </div>
{:else if joinError}
  <div
    class="bg-muted text-muted-foreground flex items-center gap-3 px-4 py-2 text-sm"
    role="alert"
  >
    <p class="min-w-0 flex-1">
      {kind === 'missing' ? $LL.joinMissing() : $LL.joinFailed()}
      {#if joinError.text}
        · {joinError.text}
      {/if}
    </p>
    {#if kind === 'other'}
      <Button size="sm" variant="outline" onclick={() => rejoin()}>{$LL.rejoin()}</Button>
    {/if}
  </div>
{/if}
