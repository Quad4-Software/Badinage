// Shared settings-search state. Each section reports how many rows it is
// currently showing under its own key, so the dialog can show an empty
// state when a query matches nothing anywhere. Sections delete their key
// on unmount so remounts start clean.
export const settingsSearch = $state<{ hits: Record<string, number> }>({ hits: {} })
