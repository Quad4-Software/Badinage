import { describe, expect, it, vi } from 'vitest'

import { Emitter } from './events'

type TestEvents = {
  ping: number
  pong: string
}

describe('Emitter', () => {
  it('delivers events to subscribers', () => {
    const emitter = new Emitter<TestEvents>()
    const handler = vi.fn()
    emitter.on('ping', handler)
    emitter.emit('ping', 42)
    expect(handler).toHaveBeenCalledWith(42)
  })

  it('unsubscribes via the returned function', () => {
    const emitter = new Emitter<TestEvents>()
    const handler = vi.fn()
    const off = emitter.on('ping', handler)
    off()
    emitter.emit('ping', 1)
    expect(handler).not.toHaveBeenCalled()
  })

  it('supports multiple handlers and clear', () => {
    const emitter = new Emitter<TestEvents>()
    const a = vi.fn()
    const b = vi.fn()
    emitter.on('pong', a)
    emitter.on('pong', b)
    emitter.emit('pong', 'x')
    emitter.clear()
    emitter.emit('pong', 'y')
    expect(a).toHaveBeenCalledWith('x')
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
  })
})
