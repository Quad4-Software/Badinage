import { describe, expect, it } from 'vitest'

import { meAction, parseSlashCommand, parseSpoilerCommand } from './message-commands'

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

describe('parseSlashCommand', () => {
  it('splits name and args', () => {
    expect(parseSlashCommand('/nick New Nick')).toEqual({ name: 'nick', args: 'New Nick' })
    expect(parseSlashCommand('/clear')).toEqual({ name: 'clear', args: '' })
  })

  it('lowercases the name and trims args', () => {
    expect(parseSlashCommand('/TOPIC   hello  ')).toEqual({ name: 'topic', args: 'hello' })
  })

  it('keeps multi-line args for /topic', () => {
    expect(parseSlashCommand('/topic line one\nline two')?.args).toBe('line one\nline two')
  })

  it('returns null for ordinary text', () => {
    expect(parseSlashCommand('hello world')).toBeNull()
    expect(parseSlashCommand('a /nick thing')).toBeNull()
    expect(parseSlashCommand('')).toBeNull()
  })

  it('returns null when no word follows the slash', () => {
    expect(parseSlashCommand('/')).toBeNull()
    expect(parseSlashCommand('// comment')).toBeNull()
    expect(parseSlashCommand('/1st')).toBeNull()
  })
})
