<script lang="ts">
  import { ShieldAlert } from '@lucide/svelte'

  import LL from '$lib/i18n/i18n-svelte'
  import { extensions } from '$lib/state/app/extensions.svelte'
  import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle
  } from '$lib/ui/primitives/alert-dialog'
  import { buttonVariants } from '$lib/ui/primitives/button'

  const prompt = $derived(extensions.trustPrompt)
</script>

<AlertDialog
  open={prompt !== null}
  onOpenChange={(open) => {
    if (!open) extensions.resolveTrust(false)
  }}
>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>
        {#if prompt?.keyChanged}
          {$LL.extensionKeyChangedTitle()}
        {:else}
          {$LL.extensionTrustTitle()}
        {/if}
      </AlertDialogTitle>
      <AlertDialogDescription>
        {#if prompt?.keyChanged}
          {$LL.extensionKeyChangedDescription({ name: prompt.extensionName })}
        {:else}
          {$LL.extensionTrustDescription({ name: prompt?.extensionName ?? '' })}
        {/if}
      </AlertDialogDescription>
    </AlertDialogHeader>
    {#if prompt}
      <div class="flex items-start gap-2 rounded-md border p-3">
        <ShieldAlert class="text-warning mt-0.5 size-4 shrink-0" />
        <div class="min-w-0">
          <p class="truncate text-sm font-medium">{prompt.publisherName}</p>
          <p class="text-muted-foreground font-mono text-xs break-all">{prompt.fingerprint}</p>
        </div>
      </div>
    {/if}
    <AlertDialogFooter>
      <AlertDialogCancel onclick={() => extensions.resolveTrust(false)}>
        {$LL.extensionTrustReject()}
      </AlertDialogCancel>
      <AlertDialogAction
        class={buttonVariants({ variant: prompt?.keyChanged ? 'destructive' : 'default' })}
        onclick={() => extensions.resolveTrust(true)}
      >
        {$LL.extensionTrustAccept()}
      </AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
