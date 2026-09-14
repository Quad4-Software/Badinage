<script lang="ts">
  import LL from '$lib/i18n/i18n-svelte'
  import { menus } from '$lib/state/app/menus.svelte'
  import { cn } from '$lib/utils/cn'

  let menuEl = $state<HTMLElement | null>(null)

  const open = $derived(menus.opened)

  // clamp the menu into the viewport after it measures itself
  const pos = $derived.by(() => {
    if (!open) return { left: 0, top: 0 }
    const w = menuEl?.offsetWidth ?? 220
    const h = menuEl?.offsetHeight ?? 200
    return {
      left: Math.min(open.x, Math.max(4, window.innerWidth - w - 4)),
      top: Math.min(open.y, Math.max(4, window.innerHeight - h - 4))
    }
  })

  function onKeydown(event: KeyboardEvent) {
    if (!open || !menuEl) return
    const items = [...menuEl.querySelectorAll<HTMLElement>('[role="menuitem"]')]
    const index = items.indexOf(document.activeElement as HTMLElement)
    if (event.key === 'Escape') {
      event.preventDefault()
      // keep the global keymap from seeing this, or Escape would
      // also close the active conversation behind the menu
      event.stopPropagation()
      menus.close()
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const next =
        event.key === 'ArrowDown'
          ? items[(index + 1) % items.length]
          : items[index < 0 ? items.length - 1 : (index - 1 + items.length) % items.length]
      next?.focus()
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      const edge = event.key === 'Home' ? items[0] : items.at(-1)
      edge?.focus()
    }
  }

  function onPointerDown(event: PointerEvent) {
    if (menuEl && !menuEl.contains(event.target as Node)) menus.close()
  }

  $effect(() => {
    if (!open) return
    // capture so a consumed key never reaches the global keymap
    window.addEventListener('keydown', onKeydown, true)
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('resize', menus.close)
    window.addEventListener('blur', menus.close)
    return () => {
      window.removeEventListener('keydown', onKeydown, true)
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('resize', menus.close)
      window.removeEventListener('blur', menus.close)
    }
  })

  // focus the first item once the menu appears
  $effect(() => {
    if (!open) return
    const raf = requestAnimationFrame(() => {
      menuEl?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    })
    return () => cancelAnimationFrame(raf)
  })

  function pick(run: (() => void) | undefined) {
    menus.close()
    run?.()
  }
</script>

{#if open}
  <div
    bind:this={menuEl}
    role="menu"
    aria-label={$LL.contextMenu()}
    class="bg-popover text-popover-foreground fixed z-50 min-w-44 rounded-md border p-1 shadow-md outline-none"
    style:left="{pos.left}px"
    style:top="{pos.top}px"
  >
    {#each open.items as item, i (item.id)}
      {#if item.separator}
        {#if i > 0}
          <div class="bg-border -mx-1 my-1 h-px" role="separator"></div>
        {/if}
      {:else}
        {@const Icon = item.icon}
        <button
          type="button"
          role="menuitem"
          tabindex={i === 0 ? 0 : -1}
          disabled={item.disabled}
          class={cn(
            'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none select-none',
            'focus:bg-accent focus:text-accent-foreground disabled:opacity-50',
            item.danger && 'text-destructive focus:bg-destructive focus:text-destructive-foreground'
          )}
          onclick={() => pick(item.run)}
        >
          {#if Icon}
            <Icon class="size-4 shrink-0" />
          {:else}
            <span class="size-4 shrink-0"></span>
          {/if}
          <span class="flex-1 truncate">{item.label}</span>
        </button>
      {/if}
    {/each}
  </div>
{/if}
