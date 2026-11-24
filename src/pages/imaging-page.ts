import { store } from '../core/store'
import { createImagingControls } from '../ui/controls-panel'
import { h } from '../ui/dom'
import { UltrasoundPanel } from '../ui/ultrasound-panel'

const PRESETS = [
  {
    id: 'abdomen',
    label: '腹部通用',
    params: { probe: 'convex' as const, frequency: 3.5, gain: 30, depth: 160, focus: 82, dynamicRange: 72, sectorAngle: 62, tgc: [0, 2, 5, 9, 14, 19, 25, 30] }
  },
  {
    id: 'gallbladder',
    label: '胆囊/浅表',
    params: { probe: 'linear' as const, frequency: 6.2, gain: 26, depth: 110, focus: 55, dynamicRange: 66, sectorAngle: 55, tgc: [2, 4, 7, 10, 13, 16, 18, 20] }
  },
  {
    id: 'kidney',
    label: '肾脏深部',
    params: { probe: 'convex' as const, frequency: 2.8, gain: 36, depth: 180, focus: 112, dynamicRange: 78, sectorAngle: 66, tgc: [0, 4, 9, 15, 22, 29, 34, 34] }
  },
  {
    id: 'phased',
    label: '相控阵大夹角',
    params: { probe: 'phased' as const, frequency: 3.2, gain: 32, depth: 150, focus: 78, dynamicRange: 70, sectorAngle: 82, tgc: [0, 3, 7, 12, 17, 22, 27, 31] }
  }
]

export function createImagingPage(): HTMLElement {
  const ultrasound = new UltrasoundPanel()
  const presetBar = h('div.preset-bar', {}, PRESETS.map((preset) =>
    h('button.btn.btn-ghost', {
      type: 'button',
      onclick: () => store.patchParams(structuredClone(preset.params)),
      text: preset.label
    })
  ))

  const element = h('div.page.page-imaging', {}, [
    h('header.page-header', {}, [
      h('div', {}, [h('h1', { text: '图像参数调优' }), h('p', { text: '增益、TGC、焦点、深度和动态范围直接作用于扫描转换；声学追踪参数保持物理一致。' })]),
      presetBar
    ]),
    h('div.imaging-grid', {}, [
      h('section.panel.imaging-screen-panel', {}, [
        h('div.panel-title', {}, [h('h2', { text: '实时参数预览' }), h('span.badge.badge-accent', { text: '调整立即生效' })]),
        ultrasound.element,
        h('div.parameter-cards', {}, [
          h('div.mini-card', {}, [h('strong', { text: '增益 / TGC' }), h('span', { text: '对数压缩前补偿声程衰减' })]),
          h('div.mini-card', {}, [h('strong', { text: '焦点' }), h('span', { text: '改变深度相关横向声束宽度' })]),
          h('div.mini-card', {}, [h('strong', { text: '动态范围' }), h('span', { text: '控制弱回声到强回声的灰度映射' })]),
          h('div.mini-card', {}, [h('strong', { text: '探头几何' }), h('span', { text: '线阵矩形、凸阵弧面、相控阵原点扇扫' })])
        ])
      ]),
      h('aside.panel.params-panel.imaging-controls', {}, [
        h('div.panel-title', {}, [h('h2', { text: '控制台' })]),
        createImagingControls()
      ])
    ])
  ])
  ;(element as unknown as { __dispose?: () => void }).__dispose = () => ultrasound.dispose()
  return element
}
