import { describe, expect, it, vi } from 'vitest'

import { ModuleRegistry, type Module } from './module'

describe('ModuleRegistry', () => {
  it('registers and initializes modules', async () => {
    const registry = new ModuleRegistry()
    const init = vi.fn()
    registry.register({ id: 'test', init })
    await registry.initAll({} as never)
    expect(init).toHaveBeenCalledOnce()
  })

  it('rejects duplicate ids', () => {
    const registry = new ModuleRegistry()
    const mod: Module = { id: 'x', init: vi.fn() }
    registry.register(mod)
    expect(() => registry.register(mod)).toThrow('already registered')
  })

  it('destroys modules that implement destroy', () => {
    const registry = new ModuleRegistry()
    const destroy = vi.fn()
    registry.register({ id: 'a', init: vi.fn(), destroy })
    registry.register({ id: 'b', init: vi.fn() })
    registry.destroyAll()
    expect(destroy).toHaveBeenCalledOnce()
  })
})
