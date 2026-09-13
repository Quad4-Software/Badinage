// Shared search matching for settings rows. Labels are already localized
// when passed in, so search follows the active locale.
export function matchesQuery(q: string, ...labels: string[]): boolean {
  if (!q) return true
  const needle = q.toLowerCase()
  return labels.some((label) => label.toLowerCase().includes(needle))
}
