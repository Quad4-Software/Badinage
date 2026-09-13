import { describe, expect, it } from 'vitest'

import { tokenizeStyling, type BlockToken, type SpanToken } from './message-styling'

// shorthand builders keep the expectations readable
const text = (t: string): SpanToken => ({ type: 'text', text: t })
const strong = (...children: SpanToken[]): SpanToken => ({ type: 'strong', children })
const emphasis = (...children: SpanToken[]): SpanToken => ({ type: 'emphasis', children })
const strike = (...children: SpanToken[]): SpanToken => ({ type: 'strike', children })
const code = (t: string): SpanToken => ({ type: 'code', text: t })
const line = (...texts: string[]): BlockToken => ({
  type: 'line',
  spans: texts.map((t) => text(t))
})
const lineSpans = (...spans: SpanToken[]): BlockToken => ({ type: 'line', spans })

describe('tokenizeStyling spans', () => {
  it('passes plain text through as one line block', () => {
    expect(tokenizeStyling('hello')).toEqual([line('hello')])
  })

  it('parses strong, emphasis, strike and code spans', () => {
    expect(tokenizeStyling('*bold*')).toEqual([lineSpans(strong(text('bold')))])
    expect(tokenizeStyling('_em_')).toEqual([lineSpans(emphasis(text('em')))])
    expect(tokenizeStyling('~strike~')).toEqual([lineSpans(strike(text('strike')))])
    expect(tokenizeStyling('`mono`')).toEqual([lineSpans(code('mono'))])
  })

  it('keeps surrounding text around a styled span', () => {
    expect(tokenizeStyling('a *bold* c')).toEqual([
      lineSpans(text('a '), strong(text('bold')), text(' c'))
    ])
  })

  it('nests styled spans inside each other', () => {
    expect(tokenizeStyling('_em *strong*_')).toEqual([
      lineSpans(emphasis(text('em '), strong(text('strong'))))
    ])
  })

  it('treats an unmatched marker as literal text', () => {
    expect(tokenizeStyling('not *closed')).toEqual([line('not *closed')])
    expect(tokenizeStyling('a*b*')).toEqual([line('a*b*')])
    expect(tokenizeStyling('**')).toEqual([line('**')])
  })

  it('rejects openers followed by whitespace and closers preceded by it', () => {
    expect(tokenizeStyling('* spaced*')).toEqual([line('* spaced*')])
    expect(tokenizeStyling('*spaced *')).toEqual([line('*spaced *')])
    expect(tokenizeStyling('*a *b*')).toEqual([lineSpans(text('*a '), strong(text('b')))])
  })

  it('keeps markers inside code spans literal', () => {
    expect(tokenizeStyling('`*not strong*`')).toEqual([lineSpans(code('*not strong*'))])
  })
})

describe('tokenizeStyling blocks', () => {
  it('splits a body into one line block per line', () => {
    expect(tokenizeStyling('one\ntwo')).toEqual([line('one'), line('two')])
  })

  it('parses a fenced pre block up to its closing fence', () => {
    expect(tokenizeStyling('```\ncode *literal*\n```\nafter')).toEqual([
      { type: 'pre', text: 'code *literal*' },
      line('after')
    ])
  })

  it('closes an unterminated pre block at the end of input', () => {
    expect(tokenizeStyling('```\ncode')).toEqual([{ type: 'pre', text: 'code' }])
  })

  it('parses consecutive quote lines as one quotation', () => {
    expect(tokenizeStyling('> a\n> b\nplain')).toEqual([
      { type: 'quote', children: [line('a'), line('b')] },
      line('plain')
    ])
  })

  it('nests quotations on doubled markers', () => {
    expect(tokenizeStyling('>> deep')).toEqual([
      { type: 'quote', children: [{ type: 'quote', children: [line('deep')] }] }
    ])
  })

  it('only treats block directives at line start', () => {
    expect(tokenizeStyling('a > b')).toEqual([line('a > b')])
    expect(tokenizeStyling(' ```\nx')).toEqual([line(' ```'), line('x')])
  })

  it('yields a single empty line block for an empty body', () => {
    expect(tokenizeStyling('')).toEqual([{ type: 'line', spans: [] }])
  })
})
