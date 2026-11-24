import { encodeHu } from '../core/synthetic'
import { db } from '../core/db'
import { store } from '../core/store'
import { h, toast } from './dom'
import type { TissueBand, Vec3 } from '../core/types'

type Axis = 0 | 1 | 2

function targetHu(band: TissueBand): number {
  if (band.id === 'air') return -1000
  if (band.id === 'metal') return 3000
  return Math.round((band.lowHu + band.highHu) / 2)
}

export function createSegmentationPanel() {
  const root = h('div.segmentation')
  const brushState = { axis: 2 as Axis, slice: 256, radius: 5, bandId: 'soft', painting: false }

  const brushCanvas = h<HTMLCanvasElement>('canvas.slice-canvas', { width: 512, height: 512 })
  const sliceSlider = h<HTMLInputElement>('input', { type: 'range', min: 0, max: 511, value: 256 })
  const axisSelect = h<HTMLSelectElement>('select.input', {}, [
    h('option', { value: '2', text: '轴状面 XY（Z 层）' }),
    h('option', { value: '1', text: '冠状面 XZ（Y 层）' }),
    h('option', { value: '0', text: '矢状面 YZ（X 层）' })
  ]) as HTMLSelectElement
  axisSelect.value = '2'

  function sliceDimensions(): [number, number] {
    const dims = store.state.volume?.dims ?? [512, 512, 512]
    if (brushState.axis === 2) return [dims[0], dims[1]]
    if (brushState.axis === 1) return [dims[0], dims[2]]
    return [dims[1], dims[2]]
  }

  function voxelIndex(u: number, v: number): number | null {
    const volume = store.state.volume
    if (!volume) return null
    const [sliceWidth, sliceHeight] = sliceDimensions()
    if (u < 0 || v < 0 || u >= sliceWidth || v >= sliceHeight) return null
    const [nx, ny] = volume.dims
    if (brushState.axis === 2) return u + nx * (v + ny * brushState.slice)
    if (brushState.axis === 1) return u + nx * (brushState.slice + ny * v)
    return brushState.slice + nx * (u + ny * v)
  }

  function paintSlice() {
    const volume = store.state.volume
    if (!volume) return
    const [width, height] = sliceDimensions()
    brushCanvas.width = width
    brushCanvas.height = height
    const ctx = brushCanvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return
    const image = ctx.createImageData(width, height)
    for (let v = 0; v < height; v++) {
      for (let u = 0; u < width; u++) {
        const idx = voxelIndex(u, v)
        const stored = idx === null ? encodeHu(-1000) : volume.hu[idx]
        const hu = stored - 1024
        const gray = Math.max(0, Math.min(255, ((hu + 180) / 520) * 255))
        const p = (v * width + u) * 4
        image.data[p] = gray
        image.data[p + 1] = gray
        image.data[p + 2] = Math.min(255, gray + 14)
        image.data[p + 3] = 255
      }
    }
    ctx.putImageData(image, 0, 0)
  }

  function paintAt(clientX: number, clientY: number) {
    const volume = store.state.volume
    if (!volume) return
    const rect = brushCanvas.getBoundingClientRect()
    const [width, height] = sliceDimensions()
    const u = Math.floor(((clientX - rect.left) / rect.width) * width)
    const v = Math.floor(((clientY - rect.top) / rect.height) * height)
    const band = store.state.bands.find((item) => item.id === brushState.bandId) ?? store.state.bands[4]
    const hu = targetHu(band)
    const r = brushState.radius
    for (let dv = -r; dv <= r; dv++) {
      for (let du = -r; du <= r; du++) {
        if (du * du + dv * dv > r * r) continue
        const idx = voxelIndex(u + du, v + dv)
        if (idx !== null) volume.hu[idx] = encodeHu(hu)
      }
    }
    paintSlice()
  }

  brushCanvas.addEventListener('pointerdown', (event) => {
    brushState.painting = true
    brushCanvas.setPointerCapture(event.pointerId)
    paintAt(event.clientX, event.clientY)
  })
  brushCanvas.addEventListener('pointermove', (event) => {
    if (brushState.painting) paintAt(event.clientX, event.clientY)
  })
  brushCanvas.addEventListener('pointerup', async () => {
    if (!brushState.painting) return
    brushState.painting = false
    store.notifyVolumePixelsChanged()
    await persistEdits()
  })

  async function persistEdits() {
    const volume = store.state.volume
    if (!volume?.id || !store.state.cases.some((item) => item.id === volume.id)) return
    const existing = await db.getCase(volume.id)
    if (!existing) return
    const record = { ...existing, hu: volume.hu.buffer.slice(0) as ArrayBuffer }
    await db.putCase(record)
    toast('分割笔刷修改已写回 IndexedDB 病例', 'success')
  }

  axisSelect.addEventListener('change', () => {
    brushState.axis = Number(axisSelect.value) as Axis
    const max = store.state.volume?.dims[brushState.axis] ?? 512
    brushState.slice = Math.floor(max / 2)
    sliceSlider.max = String(max - 1)
    sliceSlider.value = String(brushState.slice)
    paintSlice()
  })
  sliceSlider.addEventListener('input', () => {
    brushState.slice = Number(sliceSlider.value)
    paintSlice()
  })

  const bandSelect = h<HTMLSelectElement>('select.input', {}, store.state.bands.map((band) => h('option', { value: band.id, text: band.name })))
  bandSelect.value = brushState.bandId
  bandSelect.addEventListener('change', () => {
    brushState.bandId = bandSelect.value
  })
  const radiusSlider = h<HTMLInputElement>('input', { type: 'range', min: 1, max: 18, value: 5 })
  radiusSlider.addEventListener('input', () => {
    brushState.radius = Number(radiusSlider.value)
  })

  const brushPanel = h('div.control-block', {}, [
    h('h4', { text: '手动分割笔刷' }),
    h('p.help', { text: '在 CT 切面上直接把体素改写为所选组织的代表 HU；松手后写回当前病例。' }),
    h('div.field-row', {}, [h('span', { text: '切面方向' }), axisSelect]),
    h('div.field-row', {}, [h('span', { text: '组织' }), bandSelect]),
    h('label.slider-row', {}, [h('span.slider-label', { text: `笔刷半径：${brushState.radius} 体素` }), radiusSlider]),
    h('div.slice-wrap', {}, [brushCanvas]),
    h('label.slider-row', {}, [h('span.slider-label', { text: '层号' }), sliceSlider])
  ])

  const bandList = h('div.band-list')
  function renderBands() {
    bandList.replaceChildren()
    for (const band of store.state.bands) {
      const low = h<HTMLInputElement>('input.input.input-number', { type: 'number', value: band.lowHu })
      const high = h<HTMLInputElement>('input.input.input-number', { type: 'number', value: band.highHu })
      const z = h<HTMLInputElement>('input', { type: 'range', min: 0, max: 35, step: 0.01, value: band.impedance })
      const atten = h<HTMLInputElement>('input', { type: 'range', min: 0, max: 20, step: 0.05, value: band.attenuation })
      const scatter = h<HTMLInputElement>('input', { type: 'range', min: 0, max: 1, step: 0.01, value: band.scatter })
      low.addEventListener('change', () => store.updateBand(band.id, { lowHu: Number(low.value) }))
      high.addEventListener('change', () => store.updateBand(band.id, { highHu: Number(high.value) }))
      const zLabel = h('span', { text: `声阻抗 ${band.impedance.toFixed(2)}` })
      const attenLabel = h('span', { text: `衰减 ${band.attenuation.toFixed(2)}` })
      const scatterLabel = h('span', { text: `散射 ${band.scatter.toFixed(2)}` })
      z.addEventListener('input', () => {
        store.updateBand(band.id, { impedance: Number(z.value) })
        zLabel.textContent = `声阻抗 ${Number(z.value).toFixed(2)}`
      })
      atten.addEventListener('input', () => {
        store.updateBand(band.id, { attenuation: Number(atten.value) })
        attenLabel.textContent = `衰减 ${Number(atten.value).toFixed(2)}`
      })
      scatter.addEventListener('input', () => {
        store.updateBand(band.id, { scatter: Number(scatter.value) })
        scatterLabel.textContent = `散射 ${Number(scatter.value).toFixed(2)}`
      })
      bandList.append(
        h('details.band-item', {}, [
          h('summary', {}, [
            h('i.band-swatch', { style: `background:${band.color}` }),
            h('strong', { text: band.name }),
            h('span.band-hu', { text: `${band.lowHu} ~ ${band.highHu} HU` })
          ]),
          h('div.band-grid', {}, [
            h('label', {}, [h('span', { text: 'HU 下限' }), low]),
            h('label', {}, [h('span', { text: 'HU 上限' }), high]),
            h('label', {}, [zLabel, z]),
            h('label', {}, [attenLabel, atten]),
            h('label.band-full', {}, [scatterLabel, scatter])
          ])
        ])
      )
    }
  }
  renderBands()

  root.append(
    h('div.control-block', {}, [
      h('div.panel-title', {}, [
        h('h4', { text: 'CT 值 → 声学参数映射' }),
        h('button.btn.btn-ghost', { type: 'button', onclick: () => store.resetBands(), text: '恢复默认' })
      ]),
      h('p.help', { text: '分段控制点按 HU 线性插值为声阻抗、衰减系数和散射强度；修改后下一帧 B 超立即生效。' }),
      bandList
    ]),
    brushPanel
  )

  setTimeout(paintSlice, 0)
  let lastVolume = store.state.volume
  const unsubscribe = store.subscribe(() => {
    if (store.state.volume !== lastVolume) {
      lastVolume = store.state.volume
      const max = store.state.volume?.dims[brushState.axis] ?? 512
      brushState.slice = Math.floor(max / 2)
      sliceSlider.max = String(max - 1)
      sliceSlider.value = String(brushState.slice)
      setTimeout(paintSlice, 0)
    }
  })
  root.dataset.unsubscribe = 'true'
  ;(root as unknown as { __unsubscribe?: () => void }).__unsubscribe = unsubscribe
  return root
}
