<script lang="ts">
  import LL from '$lib/i18n/i18n-svelte'
  import { accounts } from '$lib/state/accounts.svelte'
  import type { ChatMessage, Conversation } from '$lib/state/chats.svelte'
  import { Input } from '$lib/ui/primitives/input'

  import ConfirmDialog from '../../dialogs/confirm-dialog.svelte'
  import ChangeNickDialog from '../../dialogs/change-nick-dialog.svelte'
  import InviteUserDialog from '../../dialogs/invite-user-dialog.svelte'
  import RoomConfigDialog from '../../dialogs/room-config-dialog.svelte'
  import SubjectDialog from '../../dialogs/subject-dialog.svelte'

  // the room-scoped dialogs that hang off the chat pane header menu:
  // nick change, subject, invite, owner config and the XEP-0425
  // moderation confirm
  let {
    conversation,
    nickOpen = $bindable(false),
    subjectOpen = $bindable(false),
    inviteOpen = $bindable(false),
    configOpen = $bindable(false),
    moderateTarget = $bindable(null),
    moderateReason = $bindable(''),
    onNickChange,
    onInvite,
    onModerate
  }: {
    conversation: Conversation
    nickOpen: boolean
    subjectOpen: boolean
    inviteOpen: boolean
    configOpen: boolean
    moderateTarget: ChatMessage | null
    moderateReason: string
    onNickChange: (nick: string) => void
    onInvite: (jid: string, reason: string) => void
    onModerate: () => void
  } = $props()

  const account = $derived(accounts.active)
</script>

<ChangeNickDialog
  bind:open={nickOpen}
  currentNick={conversation.ourNick ?? ''}
  onSubmit={onNickChange}
/>
<SubjectDialog
  bind:open={subjectOpen}
  subject={conversation.subject ?? ''}
  onSubmit={(subject) => account?.connection.setRoomSubject(conversation.peerJid, subject)}
/>
<InviteUserDialog bind:open={inviteOpen} onSubmit={onInvite} />
<RoomConfigDialog bind:open={configOpen} room={conversation.peerJid} />

<ConfirmDialog
  open={moderateTarget !== null}
  onOpenChange={(o) => {
    if (!o) moderateTarget = null
  }}
  title={$LL.removeMessageTitle()}
  confirmLabel={$LL.removeMessage()}
  destructive
  onConfirm={onModerate}
>
  <span class="block">{$LL.removeMessageDescription()}</span>
  <Input
    bind:value={moderateReason}
    placeholder={$LL.reasonOptional()}
    aria-label={$LL.reasonOptional()}
    class="mt-2"
  />
</ConfirmDialog>
