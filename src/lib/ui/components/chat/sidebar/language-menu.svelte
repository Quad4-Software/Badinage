<script lang="ts">
  import { DropdownMenu } from 'bits-ui'
  import { Check, Languages } from '@lucide/svelte'
  import { navigatorDetector } from 'typesafe-i18n/detectors'

  import LL from '$lib/i18n/i18n-svelte'
  import { detectLocale } from '$lib/i18n/i18n-util'
  import { settings } from '$lib/state/settings.svelte'
  import { Button } from '$lib/ui/primitives/button'
  import { applyLocale, asLocale, LANGUAGES } from '$lib/i18n/languages'

  // the persisted pick wins, an empty setting follows the browser
  const active = $derived(asLocale(settings.current.locale))

  const itemClass =
    'data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none'

  function pick(code: string) {
    settings.set('locale', code)
    void applyLocale(code === '' ? detectLocale(navigatorDetector) : code)
  }
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger>
    {#snippet child({ props })}
      <Button {...props} variant="ghost" size="icon" aria-label={$LL.language()}>
        <Languages class="size-4" />
      </Button>
    {/snippet}
  </DropdownMenu.Trigger>
  <DropdownMenu.Portal>
    <DropdownMenu.Content
      class="bg-popover text-popover-foreground z-50 rounded-md border p-1 shadow-md"
      side="right"
      sideOffset={8}
      align="end"
    >
      <DropdownMenu.Item class={itemClass} onSelect={() => pick('')}>
        <span class="flex-1">{$LL.languageAuto()}</span>
        {#if !settings.current.locale}
          <Check class="size-4 shrink-0" />
        {/if}
      </DropdownMenu.Item>
      <DropdownMenu.Separator class="bg-border -mx-1 my-1 h-px" />
      {#each LANGUAGES as lang (lang.code)}
        <DropdownMenu.Item class={itemClass} onSelect={() => pick(lang.code)}>
          <span class="flex-1">{lang.name}</span>
          {#if active === lang.code}
            <Check class="size-4 shrink-0" />
          {/if}
        </DropdownMenu.Item>
      {/each}
    </DropdownMenu.Content>
  </DropdownMenu.Portal>
</DropdownMenu.Root>
