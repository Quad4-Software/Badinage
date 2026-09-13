import type { ChatConnection } from '$lib/core/xmpp/connection'

// The surface a module sees of its owning account. core/ must not import
// the state-layer Account class (dependencies point inward only), so
// modules program against this minimal interface instead. Account in
// src/lib/state/accounts.svelte.ts satisfies it structurally.
interface ModuleAccount {
  initOmemo(): Promise<void>
}

export interface ModuleContext {
  account: ModuleAccount
  connection: ChatConnection
}

export interface Module {
  id: string
  init(ctx: ModuleContext): void | Promise<void>
  destroy?(): void
}

export class ModuleRegistry {
  private modules = new Map<string, Module>()

  register(module: Module): void {
    if (this.modules.has(module.id)) {
      throw new Error(`module already registered: ${module.id}`)
    }
    this.modules.set(module.id, module)
  }

  async initAll(ctx: ModuleContext): Promise<void> {
    for (const module of this.modules.values()) {
      await module.init(ctx)
    }
  }

  destroyAll(): void {
    for (const module of this.modules.values()) {
      module.destroy?.()
    }
  }
}
