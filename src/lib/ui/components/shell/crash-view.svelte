<script lang="ts">
  import { COPY_FEEDBACK_MS } from '$lib/constants'
  import LL from '$lib/i18n/i18n-svelte'
  import { copyText } from '$lib/ui/clipboard'
  import { Button } from '$lib/ui/primitives/button'

  let { error, reset }: { error: unknown; reset: () => void } = $props()

  const message = $derived(error instanceof Error ? error.message : String(error))
  const copied = $state({ value: false })

  function copyError() {
    void copyText(message).then((ok) => {
      if (!ok) return
      copied.value = true
      setTimeout(() => (copied.value = false), COPY_FEEDBACK_MS)
    })
  }

  function reload() {
    location.reload()
  }
</script>

<div class="flex h-full items-center justify-center p-6" role="alert">
  <div class="bg-card flex w-full max-w-md flex-col gap-4 rounded-lg border p-6 shadow-sm">
    <h1 class="text-lg font-semibold">{$LL.crashTitle()}</h1>
    <p class="text-muted-foreground text-sm">{$LL.crashDescription()}</p>
    <pre
      class="bg-muted max-h-40 overflow-auto rounded-md p-3 text-xs break-all whitespace-pre-wrap">{message}</pre>
    <div class="flex flex-wrap gap-2">
      <Button onclick={reset}>{$LL.crashRetry()}</Button>
      <Button variant="outline" onclick={reload}>{$LL.crashReload()}</Button>
      <Button variant="ghost" onclick={copyError}>
        {copied.value ? $LL.copied() : $LL.copyError()}
      </Button>
    </div>
  </div>
</div>
