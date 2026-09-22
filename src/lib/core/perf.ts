// Runtime performance monitor: observes paint, layout-shift and longtask
// entries plus a periodic JS heap sample, keeps a small rolling picture,
// and warns in dev when budgets are exceeded. The e2e suite reads the
// same snapshot through a window hook, so budgets tested in CI are the
// budgets monitored in production.
//
// Everything here is optional-capability: no PerformanceObserver, no
// performance.memory, no problem. The module never throws and never
// reports to telemetry - crash reporting owns its own opt-in pipeline.

// user-facing budgets. Loose enough for slow hardware, tight enough to
// catch a regression that doubles input latency or paints late
const LCP_WARN_MS = 2500
const CLS_WARN = 0.1
const LONGTASK_WARN_MS = 200
const HEAP_SAMPLE_MS = 5_000
// keep the last few longtasks so a report can name the worst offenders
const LONGTASK_BUF = 8

interface PerfSnapshot {
  fcpMs: number | undefined
  lcpMs: number | undefined
  cls: number
  longtasks: { count: number; maxMs: number; totalMs: number; recent: number[] }
  // performance.memory is chromium-only. Undefined elsewhere
  heapUsedBytes: number | undefined
  heapPeakBytes: number | undefined
  violations: string[]
}

export interface PerfMonitor {
  snapshot(): PerfSnapshot
  reset(): void
  stop(): void
}

interface MemoryInfo {
  usedJSHeapSize: number
}

function heapUsed(): number | undefined {
  const memory = (performance as { memory?: MemoryInfo }).memory
  return memory?.usedJSHeapSize
}

export function startPerfMonitor(): PerfMonitor {
  const state: PerfSnapshot = {
    fcpMs: undefined,
    lcpMs: undefined,
    cls: 0,
    longtasks: { count: 0, maxMs: 0, totalMs: 0, recent: [] },
    heapUsedBytes: undefined,
    heapPeakBytes: undefined,
    violations: []
  }

  const warn = (what: string) => {
    state.violations.push(what)
    if (import.meta.env.DEV) console.warn(`[perf] ${what}`)
  }

  const observers: PerformanceObserver[] = []
  const observe = (type: string, onEntry: (entry: PerformanceEntry) => void) => {
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) onEntry(entry)
      })
      observer.observe({ type, buffered: true })
      observers.push(observer)
    } catch {
      // entry type unsupported in this engine. Monitoring is best-effort
    }
  }

  observe('paint', (entry) => {
    if (entry.name === 'first-contentful-paint') state.fcpMs = entry.startTime
  })

  // lcp re-fires as larger candidates paint, the last entry wins
  observe('largest-contentful-paint', (entry) => {
    state.lcpMs = entry.startTime
    if (entry.startTime > LCP_WARN_MS && !state.violations.some((v) => v.startsWith('lcp'))) {
      warn(`lcp ${Math.round(entry.startTime)}ms exceeds ${LCP_WARN_MS}ms budget`)
    }
  })

  observe('layout-shift', (entry) => {
    const shift = entry as PerformanceEntry & { hadRecentInput?: boolean; value?: number }
    if (shift.hadRecentInput) return
    state.cls += shift.value ?? 0
    if (state.cls > CLS_WARN && !state.violations.some((v) => v.startsWith('cls'))) {
      warn(`cls ${state.cls.toFixed(3)} exceeds ${CLS_WARN} budget`)
    }
  })

  observe('longtask', (entry) => {
    const tasks = state.longtasks
    tasks.count += 1
    tasks.totalMs += entry.duration
    tasks.maxMs = Math.max(tasks.maxMs, entry.duration)
    tasks.recent.push(Math.round(entry.duration))
    if (tasks.recent.length > LONGTASK_BUF) tasks.recent.shift()
    if (entry.duration > LONGTASK_WARN_MS) {
      warn(`longtask ${Math.round(entry.duration)}ms exceeds ${LONGTASK_WARN_MS}ms budget`)
    }
  })

  const sample = () => {
    const used = heapUsed()
    if (used === undefined) return
    state.heapUsedBytes = used
    state.heapPeakBytes = Math.max(state.heapPeakBytes ?? 0, used)
  }
  sample()
  const heapTimer = setInterval(sample, HEAP_SAMPLE_MS)

  return {
    snapshot: () => ({
      ...state,
      cls: state.cls,
      longtasks: { ...state.longtasks, recent: [...state.longtasks.recent] },
      violations: [...state.violations]
    }),
    reset: () => {
      state.cls = 0
      state.longtasks = { count: 0, maxMs: 0, totalMs: 0, recent: [] }
      state.violations = []
      state.heapPeakBytes = heapUsed()
    },
    stop: () => {
      for (const observer of observers) observer.disconnect()
      clearInterval(heapTimer)
    }
  }
}

// The e2e suite and the devtools console read metrics through this hook.
// Installed only when explicitly requested so production users get the
// monitor without a reachable debug surface.
export function installPerfHook(monitor: PerfMonitor): void {
  ;(globalThis as Record<string, unknown>).__badinagePerf = {
    snapshot: () => monitor.snapshot(),
    reset: () => monitor.reset()
  }
}
