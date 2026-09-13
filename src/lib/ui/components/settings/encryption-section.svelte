<script lang="ts">
  import { ChevronDown, Copy, ShieldAlert, ShieldCheck, ShieldQuestion } from '@lucide/svelte'

  import type { DeviceFingerprint, TrustLevel } from '$lib/core/omemo'
  import LL from '$lib/i18n/i18n-svelte'
  import { accounts } from '$lib/state/accounts.svelte'
  import { settings } from '$lib/state/settings.svelte'
  import { cn } from '$lib/utils/cn'
  import { Button } from '$lib/ui/primitives/button'
  import { Switch } from '$lib/ui/primitives/switch'

  import FingerprintDialogs from './encryption/fingerprint-dialogs.svelte'
  import { matchesQuery } from './match'
  import { settingsSearch } from './search-state.svelte'
  import SettingSection from './setting-section.svelte'

  let { q }: { q: string } = $props()

  const account = $derived(accounts.active)
  const service = $derived(account?.omemo)

  let ownFingerprint = $state('')
  // loaded lazily per contact: jid -> devices
  let devices = $state<Record<string, DeviceFingerprint[]>>({})
  let expanded = $state<Record<string, boolean>>({})

  let verifyTarget = $state<DeviceFingerprint | null>(null)
  let distrustTarget = $state<DeviceFingerprint | null>(null)
  // verifyAllTarget is the jid whose device list is bulk-verified
  let verifyAllTarget = $state<string | null>(null)

  async function verifyAll(jid: string) {
    if (!service) return
    for (const device of devices[jid] ?? []) {
      if (device.level !== 'trusted') await service.setTrust(jid, device.deviceId, 'trusted')
    }
    await reload(jid)
  }

  $effect(() => {
    if (!service) return
    void service.ownFingerprint().then((fp) => (ownFingerprint = fp))
    // trust changes come from observe() during fetches too, so reload the
    // expanded lists instead of tracking a tick
    return service.trust.events.on('changed', () => {
      for (const jid of Object.keys(expanded)) {
        if (expanded[jid]) void reload(jid)
      }
    })
  })

  const contacts = $derived(
    (account?.roster ?? []).filter((c) =>
      matchesQuery(q, c.name, c.jid, $LL.encryption(), $LL.fingerprint(), 'omemo security verify')
    )
  )

  const showDevice = $derived(
    matchesQuery(q, $LL.yourDevice(), $LL.fingerprint(), 'omemo security verify', $LL.encryption())
  )
  const showBlindTrust = $derived(
    matchesQuery(
      q,
      $LL.omemoBlindTrust(),
      $LL.omemoBlindTrustHint(),
      'btbv trust on first use tofu',
      $LL.encryption()
    )
  )
  const hits = $derived((showDevice ? 1 : 0) + (showBlindTrust ? 1 : 0) + contacts.length)
  const visible = $derived(hits > 0)

  $effect(() => {
    settingsSearch.hits.encryption = hits
    return () => {
      delete settingsSearch.hits.encryption
    }
  })

  async function toggleContact(jid: string) {
    expanded[jid] = !expanded[jid]
    if (expanded[jid] && devices[jid] === undefined && service) {
      devices[jid] = await service.fingerprints(jid)
    }
  }

  async function reload(jid: string) {
    if (!service) return
    devices[jid] = await service.fingerprints(jid)
  }

  const LEVEL_LABELS: Record<TrustLevel, () => string> = {
    trusted: () => $LL.trustVerified(),
    blind: () => $LL.trustBlind(),
    undecided: () => $LL.trustUndecided(),
    distrusted: () => $LL.trustDistrusted()
  }

  const levelClass = (level: TrustLevel) =>
    level === 'trusted'
      ? 'text-success'
      : level === 'distrusted'
        ? 'text-destructive'
        : level === 'undecided'
          ? 'text-warning'
          : 'text-muted-foreground'
</script>

<SettingSection id="encryption" title={$LL.encryption()} forceOpen={q !== ''} {visible}>
  {#if account?.omemoError}
    <p role="alert" class="text-destructive text-xs">{account.omemoError}</p>
  {/if}
  {#if !service}
    <p class="text-muted-foreground text-xs">{$LL.omemoUnavailable()}</p>
  {:else}
    {#if service.secureStorage === false}
      <p class="text-warning flex items-center gap-1.5 text-xs">
        <ShieldAlert class="size-3.5 shrink-0" />
        {$LL.omemoInsecureStorage()}
      </p>
    {/if}
    {#if showDevice}
      <div class="flex flex-col gap-1">
        <span class="text-xs font-medium">{$LL.yourDevice()}</span>
        <div class="flex items-center gap-2">
          <code class="text-muted-foreground flex-1 font-mono text-xs break-all select-all">
            {ownFingerprint || '…'}
          </code>
          <Button
            variant="ghost"
            size="icon"
            class="size-7 shrink-0"
            aria-label={$LL.copyFingerprint()}
            onclick={() => void navigator.clipboard.writeText(ownFingerprint)}
          >
            <Copy class="size-3.5" />
          </Button>
        </div>
      </div>
    {/if}

    {#if showBlindTrust}
      <div class="flex flex-col gap-1">
        <label class="flex items-center justify-between gap-4 text-sm">
          {$LL.omemoBlindTrust()}
          <Switch
            checked={settings.current.omemoBlindTrust}
            onCheckedChange={(v) => account?.setOmemoBlindTrust(v)}
          />
        </label>
        <p class="text-muted-foreground text-xs">{$LL.omemoBlindTrustHint()}</p>
      </div>
    {/if}

    <ul class="flex flex-col">
      {#each contacts as contact (contact.jid)}
        <li>
          <button
            type="button"
            class="hover:bg-accent flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left"
            onclick={() => void toggleContact(contact.jid)}
            aria-expanded={expanded[contact.jid] === true}
          >
            <ChevronDown
              class={cn(
                'text-muted-foreground size-4 shrink-0 transition-transform',
                expanded[contact.jid] !== true && '-rotate-90'
              )}
            />
            <span class="min-w-0 flex-1 truncate text-sm">{contact.name || contact.jid}</span>
          </button>
          {#if expanded[contact.jid] === true}
            {@const list = devices[contact.jid]}
            <div class="flex flex-col gap-2 py-1 pl-6">
              {#if !list}
                <p class="text-muted-foreground text-xs">{$LL.loading()}</p>
              {:else if list.length === 0}
                <p class="text-muted-foreground text-xs">{$LL.noOmemoDevices()}</p>
              {:else}
                {#if list.length > 1 && list.some((d) => d.level !== 'trusted')}
                  <Button
                    variant="outline"
                    size="sm"
                    class="h-6 self-start px-2 text-xs"
                    onclick={() => (verifyAllTarget = contact.jid)}
                  >
                    {$LL.verifyAll()}
                  </Button>
                {/if}
                {#each list as device (device.deviceId)}
                  <div class="border-border flex flex-col gap-1 rounded-md border p-2">
                    <div class="flex items-center justify-between gap-2">
                      <span class="text-muted-foreground text-xs">
                        {$LL.deviceId({ id: device.deviceId })}
                      </span>
                      <span class={cn('flex items-center gap-1 text-xs', levelClass(device.level))}>
                        {#if device.level === 'trusted'}
                          <ShieldCheck class="size-3.5" />
                        {:else if device.level === 'distrusted'}
                          <ShieldAlert class="size-3.5" />
                        {:else}
                          <ShieldQuestion class="size-3.5" />
                        {/if}
                        {LEVEL_LABELS[device.level]()}
                      </span>
                    </div>
                    {#if device.changed}
                      <span class="text-destructive text-xs">{$LL.keyChanged()}</span>
                    {/if}
                    <code
                      class="text-muted-foreground font-mono text-[0.65rem] break-all select-all"
                    >
                      {device.fingerprint}
                    </code>
                    <div class="flex gap-1">
                      {#if device.level !== 'trusted'}
                        <Button
                          variant="outline"
                          size="sm"
                          class="h-6 px-2 text-xs"
                          onclick={() => (verifyTarget = device)}
                        >
                          {$LL.verify()}
                        </Button>
                      {/if}
                      {#if device.level === 'distrusted'}
                        <Button
                          variant="outline"
                          size="sm"
                          class="h-6 px-2 text-xs"
                          onclick={() =>
                            void service.setTrust(contact.jid, device.deviceId, 'undecided')}
                        >
                          {$LL.trustAgain()}
                        </Button>
                      {:else}
                        <Button
                          variant="outline"
                          size="sm"
                          class="h-6 px-2 text-xs"
                          onclick={() => (distrustTarget = device)}
                        >
                          {$LL.distrust()}
                        </Button>
                      {/if}
                    </div>
                  </div>
                {/each}
              {/if}
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</SettingSection>

<FingerprintDialogs
  bind:verifyTarget
  bind:distrustTarget
  bind:verifyAllTarget
  onVerify={(device) => {
    if (service) void service.setTrust(device.jid, device.deviceId, 'trusted')
  }}
  onDistrust={(device) => {
    if (service) void service.setTrust(device.jid, device.deviceId, 'distrusted')
  }}
  onVerifyAll={(jid) => void verifyAll(jid)}
/>
