<script lang="ts">
  import { Checkbox as CheckboxPrimitive } from 'bits-ui'
  import { Check } from '@lucide/svelte'

  import { cn } from '$lib/utils/cn'

  let {
    class: className,
    checked = $bindable(false),
    ...rest
  }: CheckboxPrimitive.RootProps = $props()
</script>

<CheckboxPrimitive.Root
  bind:checked
  class={cn(
    'peer border-input flex size-6 shrink-0 items-center justify-center rounded-sm border shadow-xs outline-none',
    'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
    'disabled:cursor-not-allowed disabled:opacity-50',
    'data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground',
    className
  )}
  {...rest}
>
  {#snippet children({ checked })}
    {#if checked}
      <Check class="size-4" strokeWidth={3} />
    {/if}
  {/snippet}
</CheckboxPrimitive.Root>
