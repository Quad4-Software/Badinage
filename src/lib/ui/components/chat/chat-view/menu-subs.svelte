<script lang="ts">
  import { DropdownMenu } from 'bits-ui'
  import { Bell, Check, Lock, LockOpen, ShieldCheck, Timer } from '@lucide/svelte'

  import LL from '$lib/i18n/i18n-svelte'
  import type { NotifySetting } from '$lib/core/xmpp/stanzas'
  import type { Conversation, EncryptionPreference } from '$lib/state/chats.svelte'

  import { EPHEMERAL_OPTIONS } from './ephemeral'

  const itemClass =
    'data-[highlighted]:bg-accent flex cursor-pointer items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none'

  const subTriggerClass =
    'data-[highlighted]:bg-accent flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none'

  let {
    conversation,
    e2ee = false,
    onSetNotify,
    onSetEphemeral,
    onSetEncryption
  }: {
    conversation: Conversation
    e2ee?: boolean
    onSetNotify: (level: NotifySetting | undefined) => void
    onSetEphemeral: (seconds: number) => void
    onSetEncryption: (preference: EncryptionPreference) => void
  } = $props()
</script>

<DropdownMenu.Sub>
  <DropdownMenu.SubTrigger class={subTriggerClass}>
    <Bell class="size-4" />
    {$LL.notifyChat()}
  </DropdownMenu.SubTrigger>
  <DropdownMenu.Portal>
    <DropdownMenu.SubContent
      class="bg-popover text-popover-foreground z-50 min-w-40 rounded-md border p-1 shadow-md"
      sideOffset={4}
    >
      {#each [['always', $LL.notifyAlways()], ['on-mention', $LL.notifyMentions()], ['never', $LL.notifyNever()]] as const as [level, label] (level)}
        <DropdownMenu.Item class={itemClass} onSelect={() => onSetNotify(level)}>
          {label}
          {#if conversation.notify === level}
            <Check class="size-4" />
          {/if}
        </DropdownMenu.Item>
      {/each}
    </DropdownMenu.SubContent>
  </DropdownMenu.Portal>
</DropdownMenu.Sub>
{#if e2ee}
  <DropdownMenu.Sub>
    <DropdownMenu.SubTrigger class={subTriggerClass}>
      <Lock class="size-4" />
      {$LL.encryption()}
    </DropdownMenu.SubTrigger>
    <DropdownMenu.Portal>
      <DropdownMenu.SubContent
        class="bg-popover text-popover-foreground z-50 min-w-40 rounded-md border p-1 shadow-md"
        sideOffset={4}
      >
        {#each [['auto', $LL.encryptionAuto(), ShieldCheck], ['omemo', 'OMEMO', Lock], ['none', $LL.off(), LockOpen]] as const as [preference, label, Icon] (preference)}
          <DropdownMenu.Item class={itemClass} onSelect={() => onSetEncryption(preference)}>
            <span class="flex items-center gap-2">
              <Icon class="size-4" />
              {label}
            </span>
            {#if (conversation.encryption ?? 'auto') === preference}
              <Check class="size-4" />
            {/if}
          </DropdownMenu.Item>
        {/each}
      </DropdownMenu.SubContent>
    </DropdownMenu.Portal>
  </DropdownMenu.Sub>
{/if}
<DropdownMenu.Sub>
  <DropdownMenu.SubTrigger class={subTriggerClass}>
    <Timer class="size-4" />
    {$LL.disappearing()}
  </DropdownMenu.SubTrigger>
  <DropdownMenu.Portal>
    <DropdownMenu.SubContent
      class="bg-popover text-popover-foreground z-50 min-w-40 rounded-md border p-1 shadow-md"
      sideOffset={4}
    >
      <DropdownMenu.Item class={itemClass} onSelect={() => onSetEphemeral(0)}>
        {$LL.timerOff()}
        {#if !conversation.ephemeralTimer}
          <Check class="size-4" />
        {/if}
      </DropdownMenu.Item>
      {#each EPHEMERAL_OPTIONS as option (option.seconds)}
        <DropdownMenu.Item class={itemClass} onSelect={() => onSetEphemeral(option.seconds)}>
          {option.label()}
          {#if conversation.ephemeralTimer === option.seconds}
            <Check class="size-4" />
          {/if}
        </DropdownMenu.Item>
      {/each}
    </DropdownMenu.SubContent>
  </DropdownMenu.Portal>
</DropdownMenu.Sub>
