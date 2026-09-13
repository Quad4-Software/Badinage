// Intl.DateTimeFormat construction is expensive and these run once per
// rendered message, so formatters are cached per locale
const formatters = new Map<string, Intl.DateTimeFormat>()

function getFormatter(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}:${JSON.stringify(options)}`
  let fmt = formatters.get(key)
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(locale, options)
    formatters.set(key, fmt)
  }
  return fmt
}

export function formatTime(timestamp: number, locale: string): string {
  return getFormatter(locale, { hour: '2-digit', minute: '2-digit' }).format(timestamp)
}

export function formatDay(timestamp: number, locale: string): string {
  return getFormatter(locale, { dateStyle: 'medium' }).format(timestamp)
}

export function isSameDay(a: number, b: number): boolean {
  const da = new Date(a)
  const db = new Date(b)
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  )
}
