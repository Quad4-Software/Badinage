// Thin wrappers over the Notification and WebAudio APIs so components
// never hand-roll them and every failure path stays silent. Nothing here
// loads off-origin: the beep is synthesized.

import type { NotifyPermission } from '$lib/utils/notify'

export function notifyPermission(): NotifyPermission {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission
}

// Ask once when still undecided; returns the resulting permission.
// Denied or dismissed requests resolve quietly, never throwing into ui.
export async function requestNotifyPermission(): Promise<NotifyPermission> {
  const current = notifyPermission()
  if (current !== 'default') return current
  try {
    return await Notification.requestPermission()
  } catch {
    return 'denied'
  }
}

let audio: AudioContext | undefined

// Short two-tone blip. Synthesized so no asset ships and the sound toggle
// never depends on a network fetch.
export function playBeep(): void {
  try {
    audio ??= new AudioContext()
    const at = audio.currentTime
    for (const [freq, offset] of [
      [880, 0],
      [660, 0.09]
    ] as const) {
      const osc = audio.createOscillator()
      const gain = audio.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, at + offset)
      gain.gain.exponentialRampToValueAtTime(0.06, at + offset + 0.015)
      gain.gain.exponentialRampToValueAtTime(0.0001, at + offset + 0.09)
      osc.connect(gain)
      gain.connect(audio.destination)
      osc.start(at + offset)
      osc.stop(at + offset + 0.1)
    }
  } catch {
    // no audio device or autoplay blocked: stay silent
  }
}

// tag replaces a still-visible notification from the same conversation on
// platforms that support it, which stacks with the time-window coalescing
// done by the caller.
export function showNotification(
  title: string,
  body: string,
  tag: string,
  onClick: () => void
): void {
  try {
    const notification = new Notification(title, {
      body,
      tag,
      icon: `${import.meta.env.BASE_URL}icons/icon-192.png`
    })
    notification.onclick = () => {
      window.focus()
      onClick()
    }
  } catch {
    // constructing a Notification can throw on platforms that only
    // support service-worker notifications; fail silent
  }
}
