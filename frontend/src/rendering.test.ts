import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement, Fragment } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { markupAttributes, parseInlineStyle } from './rendering.js'

test('dynamic regions retain DOM classes, data attributes and SVG presentation', () => {
  const props = markupAttributes([
    ['class', 'note active'], ['data-id', 'note_123'], ['tabindex', '0'],
    ['aria-label', '选择笔记'], ['style', 'height:144px;--swatch:#22c55e']
  ], 'div')
  const html = renderToStaticMarkup(createElement('div', props, 'Title'))
  assert.equal(html.includes('class="note active"'), true)
  assert.equal(html.includes('data-id="note_123"'), true)
  assert.equal(html.includes('aria-label="选择笔记"'), true)
  assert.equal(html.includes('height:144px;--swatch:#22c55e'), true)
  const svg = renderToStaticMarkup(createElement('svg', markupAttributes([
    ['viewBox', '0 0 24 24'], ['stroke-width', '2'], ['fill-rule', 'evenodd']
  ], 'svg')))
  assert.equal(svg.includes('viewBox="0 0 24 24"'), true)
  assert.equal(svg.includes('stroke-width="2"'), true)
  assert.equal(svg.includes('fill-rule="evenodd"'), true)
})

test('checked note selections are controlled while editor values stay uncontrolled', () => {
  const checked = markupAttributes([['type', 'checkbox'], ['checked', '']], 'input')
  assert.equal(checked.checked, true)
  assert.equal(typeof checked.onChange, 'function')
  const unchecked = markupAttributes([['type', 'checkbox']], 'input')
  assert.equal(unchecked.checked, false)
  const field = markupAttributes([['value', 'keep editing']], 'input')
  assert.equal(field.defaultValue, 'keep editing')
  assert.equal(field.value, undefined)
  assert.equal(renderToStaticMarkup(createElement('input', checked)).includes('checked=""'), true)
})

test('style parsing preserves URLs, custom properties and vendor prefixes', () => {
  assert.deepEqual(parseInlineStyle('background:url("data:image/svg+xml;a;b"); color: red; --swatch: #22c55e; -webkit-line-clamp:2; margin:0 0 13px'), {
    background:'url("data:image/svg+xml;a;b")',color:'red','--swatch':'#22c55e',
    WebkitLineClamp:'2',margin:'0 0 13px'
  })
})

test('fragments add no wrapper and event handler attributes are not executed', () => {
  const props = markupAttributes([['onclick', 'alert(1)'], ['title', 'safe']], 'span')
  assert.equal(props.onclick, undefined)
  const html=renderToStaticMarkup(createElement(Fragment, null, createElement('span', props, 'safe'),createElement('span', null,'next')))
  assert.equal(html,'<span title="safe">safe</span><span>next</span>')
})
