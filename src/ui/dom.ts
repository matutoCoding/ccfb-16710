export type Child = Node | string | number | false | null | undefined

type Props = Record<string, unknown> & {
  class?: string
  text?: string
  html?: string
}

export function h<T extends HTMLElement = HTMLDivElement>(tag: string, props: Props = {}, children: Child[] = []): T {
  const selectorTokens = tag.split(/(?=[#.])/)
  let tagName = 'div'
  let selectorId: string | undefined
  const selectorClasses: string[] = []
  for (const token of selectorTokens) {
    if (token.startsWith('#')) selectorId = token.slice(1)
    else if (token.startsWith('.')) selectorClasses.push(...token.slice(1).split(/\s+/).filter(Boolean))
    else if (token) tagName = token
  }
  const element = document.createElement(tagName) as T
  if (selectorId) element.id = selectorId
  if (selectorClasses.length) element.classList.add(...selectorClasses)

  for (const [key, rawValue] of Object.entries(props)) {
    if (rawValue === undefined || rawValue === null || rawValue === false) continue
    if (key === 'class') {
      element.classList.add(...String(rawValue).split(/\s+/).filter(Boolean))
    } else if (key === 'text') {
      element.textContent = String(rawValue)
    } else if (key === 'html') {
      element.innerHTML = String(rawValue)
    } else if (key.startsWith('on') && typeof rawValue === 'function') {
      const eventName = key.slice(2).toLowerCase()
      element.addEventListener(eventName, rawValue as EventListener)
    } else if (key === 'dataset' && typeof rawValue === 'object') {
      Object.assign(element.dataset, rawValue)
    } else if (key in element && key !== 'list') {
      try {
        ;(element as unknown as Record<string, unknown>)[key] = rawValue
      } catch {
        element.setAttribute(key, String(rawValue))
      }
    } else {
      element.setAttribute(key, String(rawValue))
    }
  }

  for (const child of children.flat()) {
    if (child === false || child === null || child === undefined) continue
    element.append(child instanceof Node ? child : document.createTextNode(String(child)))
  }
  return element
}

export function clear(element: HTMLElement) {
  element.replaceChildren()
}

export function button(label: string, onClick: () => void, variant: 'primary' | 'ghost' | 'danger' = 'ghost') {
  return h<HTMLButtonElement>('button.btn', {
    class: variant === 'primary' ? 'btn-primary' : variant === 'danger' ? 'btn-danger' : '',
    type: 'button',
    onclick: onClick,
    text: label
  })
}

export function sliderRow(options: {
  label: string
  value: number
  min: number
  max: number
  step: number
  unit?: string
  disabled?: boolean
  format?: (value: number) => string
  onInput: (value: number) => void
}): HTMLLabelElement {
  const output = h('span.slider-value', {
    text: options.format ? options.format(options.value) : `${options.value}${options.unit ?? ''}`
  })
  const input = h<HTMLInputElement>('input', {
    type: 'range',
    min: options.min,
    max: options.max,
    step: options.step,
    value: options.value,
    disabled: options.disabled ?? false,
    oninput: () => {
      const value = Number(input.value)
      output.textContent = options.format ? options.format(value) : `${value}${options.unit ?? ''}`
      options.onInput(value)
    }
  })
  return h<HTMLLabelElement>('label.slider-row', {}, [
    h('span.slider-label', { text: options.label }),
    input,
    output
  ])
}

export function selectRow<T extends string>(options: {
  label: string
  value: T
  entries: Array<{ value: T; label: string }>
  onChange: (value: T) => void
}) {
  const select = h<HTMLSelectElement>(
    'select.input',
    {
      onchange: () => options.onChange(select.value as T)
    },
    options.entries.map((entry) => h('option', { value: entry.value, text: entry.label, selected: entry.value === options.value }))
  )
  select.value = options.value
  return h('label.field-row', {}, [h('span', { text: options.label }), select])
}

export function textInputRow(options: { label: string; value: string; placeholder?: string; onInput: (value: string) => void }) {
  const input = h<HTMLInputElement>('input.input', {
    type: 'text',
    value: options.value,
    placeholder: options.placeholder ?? '',
    oninput: () => options.onInput(input.value)
  })
  return h('label.field-row', {}, [h('span', { text: options.label }), input])
}

export function badge(text: string, tone: 'neutral' | 'good' | 'warn' | 'bad' | 'accent' = 'neutral') {
  return h('span.badge', { class: `badge-${tone}`, text })
}

export function statCard(label: string, value: string, sub = '') {
  return h('div.stat-card', {}, [
    h('div.stat-label', { text: label }),
    h('div.stat-value', { text: value }),
    sub ? h('div.stat-sub', { text: sub }) : null
  ])
}

export function emptyState(title: string, description: string, action?: Node) {
  return h('div.empty-state', {}, [
    h('div.empty-icon', { html: '◎' }),
    h('h3', { text: title }),
    h('p', { text: description }),
    action ? h('div.empty-action', {}, [action]) : null
  ])
}

export function toast(message: string, tone: 'info' | 'success' | 'error' = 'info') {
  const existing = document.querySelector<HTMLDivElement>('#toast-host')
  const host = existing ?? h<HTMLDivElement>('div', { id: 'toast-host' })
  if (!existing) document.body.append(host)
  const item = h('div.toast', { class: `toast-${tone}`, text: message })
  host.append(item)
  setTimeout(() => {
    item.classList.add('toast-leave')
    setTimeout(() => item.remove(), 220)
  }, 3200)
}

export function formatDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN', { hour12: false })
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  const m = Math.floor(s / 60)
  return `${m.toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`
}
