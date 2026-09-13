// Shared search matching for settings rows. Labels are already localized
// when passed in, so search follows the active locale. The query is split
// into tokens and every token must appear in at least one term, so tokens
// can match across a label, its keywords and its hint text.
export function matchesQuery(q: string, ...terms: string[]): boolean {
  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return true
  const haystacks = terms.map((term) => term.toLowerCase())
  return tokens.every((token) => haystacks.some((text) => text.includes(token)))
}
