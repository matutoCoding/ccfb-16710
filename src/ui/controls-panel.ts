import { store } from '../core/store'
import type { ImagingParams, ProbeKind } from '../core/types'
import { h, sliderRow } from './dom'

interface BoundSlider {
  row: HTMLLabelElement
  sync: (value: number) => void
}

function boundSlider(options: Parameters<typeof sliderRow>[0]): BoundSlider {
  const row = sliderRow(options) as HTMLLabelElement
  const input = row.querySelector('input') as HTMLInputElement
  const output = row.querySelector('.slider-value') as HTMLSpanElement
  return {
    row,
    sync: (value: number) => {
      if (document.activeElement !== input) input.value = String(value)
      output.textContent = options.format ? options.format(value) : `${value}${options.unit ?? ''}`
    }
  }
}

export function createProbeSelector() {
  const kinds: Array<{ value: ProbeKind; label: string; desc: string }> = [
    { value: 'linear', label: '线阵', desc: '矩形声场' },
    { value: 'convex', label: '凸阵', desc: '扇形宽带' },
    { value: 'phased', label: '相控阵', desc: '小接触面扇扫' }
  ]
  const buttons = kinds.map((kind) =>
    h('button.segment-btn', {
      type: 'button',
      dataset: { probe: kind.value },
      onclick: () => store.patchParams({ probe: kind.value })
    }, [h('strong', { text: kind.label }), h('small', { text: kind.desc })])
  )
  const element = h('div.segmented', { role: 'tablist', 'aria-label': '探头类型' }, buttons)
  const sync = () => {
    buttons.forEach((button) => button.classList.toggle('is-active', button.dataset.probe === store.state.params.probe))
  }
  const unsubscribe = store.subscribe(sync)
  ;(element as HTMLElement & { __controlDispose?: () => void }).__controlDispose = unsubscribe
  sync()
  return element
}

export function createImagingControls(options: { compact?: boolean } = {}) {
  const container = h('div.control-stack')
  const sliders = new Map<keyof ImagingParams, BoundSlider>()

  const configs: Array<{ key: keyof ImagingParams; label: string; min: number; max: number; step: number; unit?: string; format?: (v: number) => string }> = [
    { key: 'gain', label: '总增益', min: -10, max: 50, step: 1, unit: ' dB' },
    { key: 'frequency', label: '频率', min: 2, max: 7.5, step: 0.1, format: (v) => `${v.toFixed(1)} MHz` },
    { key: 'depth', label: '扫查深度', min: 60, max: 180, step: 5, unit: ' mm' },
    { key: 'focus', label: '焦点深度', min: 20, max: 180, step: 5, unit: ' mm' },
    { key: 'dynamicRange', label: '动态范围', min: 40, max: 100, step: 1, unit: ' dB' },
    { key: 'sectorAngle', label: '扇面夹角', min: 35, max: 90, step: 1, unit: '°' },
    { key: 'speckle', label: '散斑强度', min: 0, max: 1.4, step: 0.02, format: (v) => `${Math.round(v * 100)}%` }
  ]

  const basic = h('div.control-block', {}, [h('h4', { text: '探头' }), createProbeSelector(), h('h4', { class: 'mt-4', text: '基础图像参数' })])
  for (const config of configs) {
    const slider = boundSlider({
      ...config,
      value: store.state.params[config.key] as number,
      onInput: (value) => store.patchParams({ [config.key]: value } as Partial<ImagingParams>)
    })
    sliders.set(config.key, slider)
    basic.append(slider.row)
  }
  container.append(basic)

  let tgcSliders: BoundSlider[] = []
  if (!options.compact) {
    const tgcGrid = h('div.tgc-grid')
    tgcSliders = store.state.params.tgc.map((value, index) => {
      const slider = boundSlider({
        label: `TGC ${index + 1}`,
        value,
        min: -20,
        max: 34,
        step: 1,
        unit: ' dB',
        onInput: (v) => store.setTgc(index, v)
      })
      tgcGrid.append(slider.row)
      return slider
    })
    container.append(h('div.control-block', {}, [h('h4', { text: '八段时间增益补偿' }), tgcGrid]))
  }

  container.append(
    h('div.button-row', {}, [
      h('button.btn.btn-ghost', {
        type: 'button',
        onclick: () =>
          store.patchParams({
            gain: 30,
            tgc: [0, 2, 5, 9, 14, 19, 25, 30],
            depth: 160,
            focus: 80,
            dynamicRange: 72
          }),
        text: '恢复推荐参数'
      })
    ])
  )

  const unsubscribe = store.subscribe(() => {
    const p = store.state.params
    for (const config of configs) {
      const slider = sliders.get(config.key)
      if (slider) slider.sync(p[config.key] as number)
    }
    const angleInput = sliders.get('sectorAngle')?.row.querySelector('input')
    if (angleInput) angleInput.disabled = p.probe === 'linear'
    p.tgc.forEach((value, i) => tgcSliders[i]?.sync(value))
  })
  ;(container as HTMLElement & { __controlDispose?: () => void }).__controlDispose = unsubscribe

  return container
}

export function createPoseControls() {
  const container = h('div.control-stack')
  const fields: Array<{ key: 'position' | 'tiltX' | 'tiltZ' | 'spin'; index?: 0 | 1 | 2; label: string; min: number; max: number; step: number; unit: string }> = [
    { key: 'position', index: 0, label: '位置 X', min: 18, max: 302, step: 0.5, unit: ' mm' },
    { key: 'position', index: 1, label: '位置 Y（前后）', min: 38, max: 205, step: 0.5, unit: ' mm' },
    { key: 'position', index: 2, label: '位置 Z（头足）', min: 42, max: 288, step: 0.5, unit: ' mm' },
    { key: 'tiltX', label: '倾头/倾足角', min: -45, max: 45, step: 0.5, unit: '°' },
    { key: 'tiltZ', label: '左右倾角', min: -80, max: 80, step: 0.5, unit: '°' },
    { key: 'spin', label: '切面旋转', min: -180, max: 180, step: 1, unit: '°' }
  ]

  function currentValue(field: (typeof fields)[number]) {
    const pose = store.state.pose
    if (field.key === 'position' && field.index !== undefined) return pose.position[field.index]
    return pose[field.key as 'tiltX'] as number
  }

  const bound: Array<{ field: (typeof fields)[number]; slider: BoundSlider }> = []
  for (const field of fields) {
    const slider = boundSlider({
      label: field.label,
      value: currentValue(field),
      min: field.min,
      max: field.max,
      step: field.step,
      unit: field.unit,
      onInput: (value) => {
        if (field.key === 'position' && field.index !== undefined) {
          const position = [...store.state.pose.position] as [number, number, number]
          position[field.index] = value
          store.patchPose({ position })
        } else {
          store.patchPose({ [field.key]: value } as Partial<typeof store.state.pose>)
        }
      }
    })
    bound.push({ field, slider })
    container.append(slider.row)
  }

  const unsubscribe = store.subscribe(() => {
    for (const item of bound) item.slider.sync(currentValue(item.field))
  })
  ;(container as HTMLElement & { __controlDispose?: () => void }).__controlDispose = unsubscribe
  return container
}
