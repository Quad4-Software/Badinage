<script lang="ts">
  import type { Snippet } from 'svelte'

  import LL from '$lib/i18n/i18n-svelte'
  import { cn } from '$lib/utils/cn'
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

  interface Props {
    open?: boolean
    title: string
    // plain-text body. Render children instead when the description needs
    // markup (e.g. a fingerprint code block)
    description?: string
    confirmLabel: string
    cancelLabel?: string
    // styles the action as a destructive operation
    destructive?: boolean
    onConfirm: () => void
    onOpenChange?: ((open: boolean) => void) | undefined
    children?: Snippet
  }

  let {
    open = $bindable(false),
    title,
    description,
    confirmLabel,
    cancelLabel,
    destructive = false,
    onConfirm,
    onOpenChange,
    children
  }: Props = $props()
</script>

<AlertDialog bind:open {...onOpenChange !== undefined ? { onOpenChange } : {}}>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>{title}</AlertDialogTitle>
      <AlertDialogDescription>
        {#if children}
          {@render children()}
        {:else}
          {description ?? ''}
        {/if}
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel class={cn(buttonVariants({ variant: 'outline' }))}>
        {cancelLabel ?? $LL.cancel()}
      </AlertDialogCancel>
      <AlertDialogAction
        class={cn(buttonVariants({ variant: destructive ? 'destructive' : 'default' }))}
        onclick={onConfirm}
      >
        {confirmLabel}
      </AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
