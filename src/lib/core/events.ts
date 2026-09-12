export type EventHandler<T> = (payload: T) => void

export class Emitter<Events extends Record<string, unknown>> {
  private handlers = new Map<keyof Events, Set<EventHandler<never>>>()

  on<K extends keyof Events>(event: K, handler: EventHandler<Events[K]>): () => void {
    let set = this.handlers.get(event)
    if (!set) {
      set = new Set()
      this.handlers.set(event, set)
    }
    set.add(handler as EventHandler<never>)
    return () => this.off(event, handler)
  }

  off<K extends keyof Events>(event: K, handler: EventHandler<Events[K]>): void {
    this.handlers.get(event)?.delete(handler as EventHandler<never>)
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    for (const handler of this.handlers.get(event) ?? []) {
      ;(handler as EventHandler<Events[K]>)(payload)
    }
  }

  clear(): void {
    this.handlers.clear()
  }
}
