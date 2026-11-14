import { createElement, Fragment, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'

type RegionState = {
  root: Root
  revision: number
  markup: string
  children: Set<ChildNode>
}

declare global {
  interface Window {
    LNReactUI: {
      renderRegion: typeof renderRegion
      clearRegion: typeof clearRegion
    }
  }
}

const regions = new WeakMap<Element, RegionState>()
const booleanAttributes = new Set([
  'allowfullscreen', 'async', 'autofocus', 'autoplay', 'checked', 'controls',
  'default', 'defer', 'disabled', 'formnovalidate', 'hidden', 'ismap', 'loop',
  'multiple', 'muted', 'nomodule', 'novalidate', 'open', 'playsinline', 'readonly',
  'required', 'reversed', 'scoped', 'seamless', 'selected'
])
const attributeNames: Record<string, string> = {
  class: 'className', for: 'htmlFor', tabindex: 'tabIndex', readonly: 'readOnly',
  autofocus: 'autoFocus', autocomplete: 'autoComplete', spellcheck: 'spellCheck',
  contenteditable: 'contentEditable', crossorigin: 'crossOrigin', srcset: 'srcSet',
  srcdoc: 'srcDoc', usemap: 'useMap', maxlength: 'maxLength', minlength: 'minLength',
  acceptcharset: 'acceptCharset', 'accept-charset': 'acceptCharset',
  cellpadding: 'cellPadding', cellspacing: 'cellSpacing', colspan: 'colSpan',
  rowspan: 'rowSpan', datetime: 'dateTime', allowfullscreen: 'allowFullScreen',
  formnovalidate: 'formNoValidate', novalidate: 'noValidate', playsinline: 'playsInline',
  viewbox: 'viewBox', preserveaspectratio: 'preserveAspectRatio',
  gradientunits: 'gradientUnits', gradienttransform: 'gradientTransform',
  markerwidth: 'markerWidth', markerheight: 'markerHeight', refx: 'refX', refy: 'refY',
  markerunits: 'markerUnits', patternunits: 'patternUnits',
  patterncontentunits: 'patternContentUnits', patterntransform: 'patternTransform',
  clippathunits: 'clipPathUnits', 'xlink:href': 'xlinkHref', 'xmlns:xlink': 'xmlnsXlink',
  'xml:space': 'xmlSpace', 'xml:lang': 'xmlLang'
}

function styleName(name: string): string {
  if (name.startsWith('--')) return name
  const camel = name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())
  return camel.startsWith('Ms') ? 'ms' + camel.slice(2) : camel
}

// CSS declarations may contain semicolons in quoted strings or url(...).
export function parseInlineStyle(source: string): Record<string, string> {
  const declarations: string[] = []
  let start = 0, depth = 0, quote = '', escaped = false
  for (let index = 0; index < source.length; index++) {
    const char = source[index]
    if (escaped) { escaped = false; continue }
    if (char === '\\') { escaped = true; continue }
    if (quote) { if (char === quote) quote = ''; continue }
    if (char === '"' || char === "'") { quote = char; continue }
    if (char === '(') depth++
    if (char === ')') depth--
    if (char === ';' && depth === 0) {
      declarations.push(source.slice(start, index))
      start = index + 1
    }
  }
  declarations.push(source.slice(start))
  const style: Record<string, string> = {}
  for (const declaration of declarations) {
    const colon = declaration.indexOf(':')
    if (colon < 0) continue
    const property = declaration.slice(0, colon).trim()
    if (property) style[styleName(property)] = declaration.slice(colon + 1).trim()
  }
  return style
}

export function markupAttributes(attributes: Iterable<readonly [string, string]>, tagName: string): Record<string, unknown> {
  const props: Record<string, unknown> = {}
  const tag = tagName.toLowerCase()
  for (const [name, value] of attributes) {
    const lower = name.toLowerCase()
    // Generated regions never need inline JavaScript; interactions remain in
    // the existing delegated handlers and explicitly attached listeners.
    if (lower.startsWith('on') || lower === 'selected') continue
    if (lower === 'style') { props.style = parseInlineStyle(value); continue }
    if (lower === 'value' && ['input', 'select', 'textarea'].includes(tag)) {
      props.defaultValue = value
      continue
    }
    const prop = attributeNames[lower] || (name.includes('-') && !name.startsWith('data-') && !name.startsWith('aria-')
      ? name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase()) : name)
    props[prop] = booleanAttributes.has(lower) ? true : value
  }
  if (tag === 'input' && (props.type === 'checkbox' || props.type === 'radio')) {
    props.checked = props.checked === true
    props.onChange = () => {}
  }
  return props
}

function reactNode(node: Node, position: number): ReactNode {
  if (node.nodeType === 3) return node.textContent
  if (node.nodeType !== 1) return null
  const element = node as Element
  const tag = element.localName
  if (tag === 'script') return null
  const props = markupAttributes(Array.from(element.attributes, item => [item.name, item.value] as const), tag)
  props.key = element.getAttribute('data-id') || element.id || tag + ':' + position
  let children: ReactNode[] | undefined = Array.from(element.childNodes, reactNode)
  if (tag === 'textarea') {
    props.defaultValue = element.textContent || ''
    children = undefined
  } else if (tag === 'select') {
    const selected = Array.from(element.querySelectorAll('option[selected]')).map(option => option.getAttribute('value') ?? option.textContent ?? '')
    if (selected.length) props.defaultValue = props.multiple ? selected : selected[0]
  } else if (['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'].includes(tag)) {
    children = undefined
  }
  return createElement(tag, props, children)
}

// The outer JSX shell owns these containers, while each region owns only its
// children. flushSync preserves existing controller code that queries/binds a
// generated child immediately after rendering it.
export function renderRegion(element: Element, markup: string): void {
  let region = regions.get(element)
  if (!region) {
    region = { root: createRoot(element), revision: 0, markup: '', children: new Set() }
    regions.set(element, region)
  }
  const list = element.id === 'rows'
  if (list && region.markup === markup && region.revision > 0) return
  for (const child of Array.from(element.childNodes)) {
    if (!region.children.has(child)) child.remove()
  }
  const template = element.ownerDocument.createElement('template')
  template.innerHTML = markup
  const nodes = Array.from(template.content.childNodes, reactNode)
  const revision = ++region.revision
  flushSync(() => region.root.render(
    createElement(Fragment, { key: list ? 'list' : revision }, nodes)
  ))
  region.markup = markup
  region.children = new Set(Array.from(element.childNodes))
}

export function clearRegion(element: Element): void {
  const region = regions.get(element)
  if (region) {
    flushSync(() => region.root.unmount())
    regions.delete(element)
  }
  element.replaceChildren()
}

export function installReactRendering(): void {
  window.LNReactUI = { renderRegion, clearRegion }
}
