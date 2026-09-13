<script lang="ts">
  import LL from '$lib/i18n/i18n-svelte'
  import { currentPrompt, resolvePrompt } from '$lib/state/app/prompts.svelte'
  import { SAMPLE_REPORT } from '$lib/ui/sample-report'
  import { Button } from '$lib/ui/primitives/button'
  import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
  } from '$lib/ui/primitives/dialog'

  // the prompt closes through resolvePrompt so Escape and backdrop
  // clicks count as a decline rather than re-asking next launch
  const open = $derived(currentPrompt()?.id === 'crash-reporting')
</script>

<Dialog
  {open}
  onOpenChange={(v) => {
    if (!v) resolvePrompt(false)
  }}
>
  <DialogContent class="max-h-[85dvh] overflow-y-auto">
    <DialogHeader>
      <DialogTitle>{$LL.crashPromptTitle()}</DialogTitle>
      <DialogDescription>{$LL.crashPromptBody()}</DialogDescription>
    </DialogHeader>
    <p class="text-muted-foreground text-xs">{$LL.crashPromptNever()}</p>
    <details class="group text-xs">
      <summary
        class="text-primary cursor-pointer font-medium select-none [&::-webkit-details-marker]:hidden"
      >
        {$LL.crashPromptSample()}
      </summary>
      <pre
        class="bg-muted text-muted-foreground mt-2 max-h-48 overflow-auto rounded-md p-3 text-[11px] leading-snug break-all whitespace-pre-wrap">{SAMPLE_REPORT}</pre>
    </details>
    <DialogFooter>
      <Button variant="outline" onclick={() => resolvePrompt(false)}>
        {$LL.crashPromptDecline()}
      </Button>
      <Button onclick={() => resolvePrompt(true)}>{$LL.crashPromptEnable()}</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
