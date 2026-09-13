// MediaRecorder wrapper for voice messages. Kept out of composer.svelte so
// the component stays small and the state machine is testable. Prefers
// ogg/opus, falls back to whatever the browser supports.

export interface VoiceRecorder {
  readonly recording: boolean
  start(): Promise<void>
  // stops and delivers the blob through onStop
  stop(): void
  // stops without delivering
  cancel(): void
}

export function createVoiceRecorder(
  onStop: (blob: Blob, mediaType: string) => void
): VoiceRecorder {
  let recording = $state(false)
  let recorder: MediaRecorder | null = null
  let chunks: Blob[] = []

  function pickMime(): string {
    const preferred = 'audio/ogg;codecs=opus'
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(preferred)) {
      return preferred
    }
    return 'audio/webm'
  }

  return {
    get recording() {
      return recording
    },
    async start() {
      if (recording || !navigator.mediaDevices?.getUserMedia) return
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        const mime = pickMime()
        chunks = []
        recorder = new MediaRecorder(stream, { mimeType: mime })
        recorder.ondataavailable = (e) => chunks.push(e.data)
        recorder.onstop = () => {
          stream.getTracks().forEach((t) => t.stop())
          const blob = new Blob(chunks, { type: mime.split(';')[0] ?? 'audio/ogg' })
          recording = false
          if (chunks.length) onStop(blob, mime)
        }
        recorder.start()
        recording = true
      } catch {
        // permission denied or no mic: stay quiet, input remains usable
        recording = false
      }
    },
    stop() {
      recorder?.stop()
    },
    cancel() {
      if (!recorder) return
      recorder.onstop = null
      try {
        recorder.stop()
      } catch {
        // already stopped
      }
      recording = false
    }
  }
}
