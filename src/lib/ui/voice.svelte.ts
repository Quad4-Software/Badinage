// MediaRecorder wrapper for voice messages. Kept out of composer.svelte so
// the component stays small and the state machine is testable. Prefers
// ogg/opus, falls back to whatever the browser supports. While recording it
// also exposes an analyser node for the level meter and an elapsed clock.

export interface VoiceRecorder {
  readonly recording: boolean
  readonly analyser: AnalyserNode | null
  readonly elapsedMs: number
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
  let analyser = $state<AnalyserNode | null>(null)
  let elapsedMs = $state(0)
  let recorder: MediaRecorder | null = null
  let chunks: Blob[] = []
  let stream: MediaStream | null = null
  let audioCtx: AudioContext | null = null
  let elapsedTimer: ReturnType<typeof setInterval> | null = null
  let startedAt = 0

  function pickMime(): string {
    const preferred = 'audio/ogg;codecs=opus'
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(preferred)) {
      return preferred
    }
    return 'audio/webm'
  }

  // release the mic, audio context and clock; safe to call more than once
  function teardown() {
    stream?.getTracks().forEach((track) => track.stop())
    stream = null
    if (audioCtx) {
      void audioCtx.close().catch(() => undefined)
      audioCtx = null
    }
    if (elapsedTimer !== null) {
      clearInterval(elapsedTimer)
      elapsedTimer = null
    }
    analyser = null
    elapsedMs = 0
  }

  return {
    get recording() {
      return recording
    },
    get analyser() {
      return analyser
    },
    get elapsedMs() {
      return elapsedMs
    },
    async start() {
      if (recording || !navigator.mediaDevices?.getUserMedia) return
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        try {
          const ctx = new AudioContext()
          audioCtx = ctx
          const source = ctx.createMediaStreamSource(stream)
          const node = ctx.createAnalyser()
          node.fftSize = 64
          node.smoothingTimeConstant = 0.8
          // never connect to ctx.destination, that loops the mic back out
          source.connect(node)
          analyser = node
        } catch {
          // no usable AudioContext: record anyway, meter falls back to a label
          void audioCtx?.close().catch(() => undefined)
          audioCtx = null
        }
        const mime = pickMime()
        chunks = []
        recorder = new MediaRecorder(stream, { mimeType: mime })
        recorder.ondataavailable = (e) => chunks.push(e.data)
        recorder.onstop = () => {
          teardown()
          const blob = new Blob(chunks, { type: mime.split(';')[0] ?? 'audio/ogg' })
          recording = false
          if (chunks.length) onStop(blob, mime)
        }
        recorder.start()
        startedAt = Date.now()
        elapsedTimer = setInterval(() => {
          elapsedMs = Date.now() - startedAt
        }, 250)
        recording = true
      } catch {
        // permission denied or no mic: stay quiet, input remains usable
        teardown()
        recording = false
      }
    },
    stop() {
      recorder?.stop()
    },
    cancel() {
      if (!recorder) return
      // nulling onstop skips the track cleanup inside it, so tear down
      // directly here instead of relying on the handler
      recorder.onstop = null
      try {
        recorder.stop()
      } catch {
        // already stopped
      }
      teardown()
      recording = false
    }
  }
}
