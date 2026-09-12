<script lang="ts">
  import { Switch as SwitchPrimitive } from 'bits-ui'

  import { cn } from '$lib/utils/cn'

  let {
    class: className,
    checked = $bindable(false),
    ...rest
  }: SwitchPrimitive.RootProps = $props()
</script>

<SwitchPrimitive.Root
  bind:checked
  class={cn(
    'peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent shadow-xs transition-colors outline-none',
    'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
    'disabled:cursor-not-allowed disabled:opacity-50',
    'data-[state=checked]:bg-primary data-[state=unchecked]:bg-input',
    className
  )}
  {...rest}
>
  <SwitchPrimitive.Thumb
    class="bg-background pointer-events-none block size-4 rounded-full shadow-lg ring-0 transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0"
  />
</SwitchPrimitive.Root>
