<script lang="ts">
  import type { DeviceFingerprint } from '$lib/core/omemo'
  import LL from '$lib/i18n/i18n-svelte'

  import ConfirmDialog from '../../dialogs/confirm-dialog.svelte'

  let {
    verifyTarget = $bindable(null),
    distrustTarget = $bindable(null),
    verifyAllTarget = $bindable(null),
    onVerify,
    onDistrust,
    onVerifyAll
  }: {
    verifyTarget: DeviceFingerprint | null
    distrustTarget: DeviceFingerprint | null
    verifyAllTarget: string | null
    onVerify: (device: DeviceFingerprint) => void
    onDistrust: (device: DeviceFingerprint) => void
    onVerifyAll: (jid: string) => void
  } = $props()
</script>

<ConfirmDialog
  open={verifyTarget !== null}
  onOpenChange={(o) => !o && (verifyTarget = null)}
  title={$LL.verifyFingerprintTitle()}
  confirmLabel={$LL.verify()}
  onConfirm={() => {
    if (verifyTarget) onVerify(verifyTarget)
    verifyTarget = null
  }}
>
  {$LL.verifyFingerprintDescription({ jid: verifyTarget?.jid ?? '' })}
  <code class="mt-2 block font-mono text-xs break-all select-all"
    >{verifyTarget?.fingerprint ?? ''}</code
  >
</ConfirmDialog>

<ConfirmDialog
  open={distrustTarget !== null}
  onOpenChange={(o) => !o && (distrustTarget = null)}
  title={$LL.distrustTitle()}
  description={$LL.distrustDescription({ jid: distrustTarget?.jid ?? '' })}
  confirmLabel={$LL.distrust()}
  destructive
  onConfirm={() => {
    if (distrustTarget) onDistrust(distrustTarget)
    distrustTarget = null
  }}
/>

<ConfirmDialog
  open={verifyAllTarget !== null}
  onOpenChange={(o) => !o && (verifyAllTarget = null)}
  title={$LL.verifyAll()}
  description={$LL.verifyAllDescription({ jid: verifyAllTarget ?? '' })}
  confirmLabel={$LL.verifyAll()}
  onConfirm={() => {
    if (verifyAllTarget) onVerifyAll(verifyAllTarget)
    verifyAllTarget = null
  }}
/>
