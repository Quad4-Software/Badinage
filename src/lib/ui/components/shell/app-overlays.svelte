<script lang="ts">
  // Every always-mounted overlay: dialogs, palette, context menus, the
  // call overlay, toasts and prompt hosts. Kept out of App.svelte so the
  // root component stays a wiring layer under the size gate.

  import { ModeWatcher } from 'mode-watcher'

  import { accounts } from '$lib/state/accounts.svelte'
  import { app } from '$lib/state/app.svelte'
  import { deployment } from '$lib/state/status/status.svelte'
  import CallOverlay from '$lib/ui/components/call/call-overlay.svelte'
  import ContextMenuHost from '$lib/ui/components/context-menu/host.svelte'
  import AddContactDialog from '$lib/ui/components/dialogs/add-contact-dialog.svelte'
  import ExploreRoomsDialog from '$lib/ui/components/dialogs/explore-rooms-dialog.svelte'
  import JoinRoomDialog from '$lib/ui/components/dialogs/join-room-dialog.svelte'
  import ProfileDialog from '$lib/ui/components/dialogs/profile-dialog.svelte'
  import ShareDialog from '$lib/ui/components/dialogs/share-dialog.svelte'
  import PeerProfileDialog from '$lib/ui/components/presence/peer-profile-dialog.svelte'
  import PromptHost from '$lib/ui/components/prompts/prompt-host.svelte'
  import SettingsDialog from '$lib/ui/components/settings/settings-dialog.svelte'
  import AddAccountDialog from '$lib/ui/components/shell/login-form/dialog.svelte'
  import CommandPalette from '$lib/ui/components/shell/command-palette.svelte'
  import DemoBadge from '$lib/ui/components/shell/demo-badge.svelte'
  import Keyboard from '$lib/ui/components/shell/keyboard.svelte'
  import Notifications from '$lib/ui/components/shell/notifications.svelte'
  import StatusToasts from '$lib/ui/components/shell/status-toasts.svelte'
  import { Sonner } from '$lib/ui/primitives/sonner'
</script>

<ModeWatcher />
<Sonner />
<Keyboard />
<StatusToasts />
<Notifications />
{#if !deployment.blocking}
  {#if accounts.active?.options.demo}
    <DemoBadge />
  {/if}
  <SettingsDialog />
  <JoinRoomDialog />
  <ProfileDialog />
  <PeerProfileDialog />
  <AddContactDialog />
  <ExploreRoomsDialog />
  <PromptHost />
  {#if app.sharePayload}
    <ShareDialog
      bind:open={
        () => app.sharePayload !== null,
        (open) => {
          if (!open) app.sharePayload = null
        }
      }
      payload={app.sharePayload}
    />
  {/if}
  <CommandPalette />
  <ContextMenuHost />
  <CallOverlay />
  <AddAccountDialog />
{/if}
