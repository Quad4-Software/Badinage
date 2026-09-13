import { describe, expect, it } from 'vitest'

import { meAction, parseSpoilerCommand } from './message-commands'

describe('meAction', () => {
  it('splits the action off a /me body', () => {
    expect(meAction('/me waves')).toBe('waves')
  })

  it('returns null for non-action bodies', () => {
    expect(meAction('say /me waves')).toBeNull()
    expect(meAction('/me')).toBeNull()
    expect(meAction('/me ')).toBeNull()
    expect(meAction('')).toBeNull()
  })

  it('keeps leading spaces inside the action', () => {
    expect(meAction('/me  double space')).toBe(' double space')
  })
})

describe('parseSpoilerCommand', () => {
  it('parses a bracketed hint', () => {
    expect(parseSpoilerCommand('/spoiler [book ending] the butler did it')).toEqual({
      body: 'the butler did it',
      hint: 'book ending'
    })
  })

  it('sends a hintless spoiler without brackets', () => {
    expect(parseSpoilerCommand('/spoiler the butler did it')).toEqual({
      body: 'the butler did it',
      hint: ''
    })
  })

  it('returns null when there is nothing to send', () => {
    expect(parseSpoilerCommand('/spoiler')).toBeNull()
    expect(parseSpoilerCommand('/spoiler   ')).toBeNull()
  })

  it('returns null for lookalike text', () => {
    expect(parseSpoilerCommand('spoiler alert')).toBeNull()
    expect(parseSpoilerCommand('/spoilers ahead')).toBeNull()
  })

  it('treats an empty bracket pair as no hint', () => {
    expect(parseSpoilerCommand('/spoiler [] text')).toEqual({ body: '[] text', hint: '' })
  })
})
