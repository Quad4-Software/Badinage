import type { Account } from '$lib/state/accounts.svelte'

export interface ModuleContext {
  account: Account
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
