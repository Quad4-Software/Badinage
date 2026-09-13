// Display names for a reaction pill's tooltip. Sender keys are bare jids
// in dms and nick-or-occupant-id keys in mucs. NameFor maps a key to its
// display name so the aggregation layer can stay key-agnostic. Names
// dedupe after mapping (two keys can resolve to the same display name),
// then the list caps and reports the remainder for a "+N more" tail.
export function reactionSenderNames(
  senders: string[],
  nameFor: (sender: string) => string,
  cap: number
): { names: string[]; extra: number } {
  const deduped: string[] = []
  for (const sender of senders) {
    const name = nameFor(sender)
    if (!deduped.includes(name)) deduped.push(name)
  }
  return { names: deduped.slice(0, cap), extra: Math.max(0, deduped.length - cap) }
}
