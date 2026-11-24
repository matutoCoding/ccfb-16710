import { createId, db } from '../core/db'
import { encodeHu } from '../core/synthetic'
import { store } from '../core/store'
import type { CaseRecord } from '../core/types'
import { button, emptyState, formatDateTime, h, toast } from '../ui/dom'
import { createSegmentationPanel } from '../ui/segmentation-panel'

function caseCard(record: CaseRecord) {
  const sizeMb = (record.hu.byteLength / 1024 / 1024).toFixed(1)
  return h('article.case-card', {}, [
    h('div.case-card-head', {}, [
      h('div', {}, [
        h('h3', { text: record.name }),
        h('p', { text: `${record.dims.join(' × ')} · 体素 ${record.spacing.map((v) => v.toFixed(3)).join(' / ')} mm` })
      ]),
      record.builtin ? h('span.badge.badge-accent', { text: '内置合成' }) : h('span.badge.badge-neutral', { text: '导入' })
    ]),
    h('p.case-desc', { text: record.description ?? `来源：${record.sourceName ?? record.sourceFormat ?? 'RAW CT'}` }),
    h('div.case-meta', {}, [h('span', { text: formatDateTime(record.createdAt) }), h('span', { text: `${sizeMb} MB` })]),
    h('div.button-row', {}, [
      button('载入并扫查', async () => {
        await store.loadCase(record)
        location.hash = '#/training'
      }, 'primary'),
      button('删除', async () => {
        if (!confirm(`确定删除病例「${record.name}」？成绩不会删除。`)) return
        await db.deleteCase(record.id)
        await store.refreshCases()
        toast('病例已删除', 'success')
      }, 'danger')
    ])
  ])
}

function builtinCard(size: 256 | 512) {
  const is512 = size === 512
  return h('article.case-card.case-card-builtin', {}, [
    h('div.case-card-head', {}, [
      h('div', {}, [h('h3', { text: `合成腹部 ${size}³` }), h('p', { text: is512 ? '验收分辨率 · 约 256MB GPU 纹理' : '流畅演示分辨率 · 约 32MB' })]),
      h('span.badge.badge-good', { text: '肝/肾/胆/血管/肋骨' })
    ]),
    h('p.case-desc', {
      text: is512
        ? '包含已知 80mm 深强反射标定界面，可在设置页执行深度误差和帧率自检。'
        : '相同解剖公式的快速版本，适合课堂交互和低配设备。'
    }),
    h('div.button-row', {}, [
      button(is512 ? '生成 512³ 并入库' : '快速生成 256³', () => void store.generateSynthetic(size, true), 'primary'),
      button('仅临时载入', () => void store.generateSynthetic(size, false))
    ])
  ])
}

function createImportForm(onImported: () => void) {
  const name = h<HTMLInputElement>('input.input', { value: '导入的 CT 病例' })
  const nx = h<HTMLInputElement>('input.input', { type: 'number', value: 512, min: 1 })
  const ny = h<HTMLInputElement>('input.input', { type: 'number', value: 512, min: 1 })
  const nz = h<HTMLInputElement>('input.input', { type: 'number', value: 300, min: 1 })
  const spacing = h<HTMLInputElement>('input.input', { type: 'number', value: 0.7, step: 0.001, min: 0.01 })
  const format = h<HTMLSelectElement>('select.input', {}, [
    h('option', { value: 'int16', text: 'Signed Int16，真实 HU' }),
    h('option', { value: 'uint16-offset', text: 'Uint16，HU = 存储值 - 1024' })
  ])
  const fileInput = h<HTMLInputElement>('input.input', { type: 'file', accept: '.raw,.bin,.img' })
  let file: File | null = null
  fileInput.addEventListener('change', () => {
    file = fileInput.files?.[0] ?? null
  })

  return h('div.import-form', {}, [
    h('h4', { text: '导入 RAW / BIN CT 体数据' }),
    h('p.help', { text: '当前支持无头原始体数据。DICOM 可先用 Horos/3D Slicer 导出为 Int16 RAW，并按 x/y/z 顺序填写维度。' }),
    h('label.field-row', {}, [h('span', { text: '病例名称' }), name]),
    h('div.input-grid-3', {}, [
      h('label', {}, [h('span', { text: 'X' }), nx]),
      h('label', {}, [h('span', { text: 'Y' }), ny]),
      h('label', {}, [h('span', { text: 'Z' }), nz])
    ]),
    h('label.field-row', {}, [h('span', { text: '各向同性间距 mm' }), spacing]),
    h('label.field-row', {}, [h('span', { text: '像素格式' }), format]),
    fileInput,
    button('解析并保存到 IndexedDB', async () => {
      if (!file) return toast('请先选择 RAW/BIN 文件', 'error')
      try {
        const dims: [number, number, number] = [Number(nx.value), Number(ny.value), Number(nz.value)]
        const voxelCount = dims[0] * dims[1] * dims[2]
        const buffer = await file.arrayBuffer()
        const encoded = new Uint16Array(voxelCount)
        if (format.value === 'int16') {
          const source = new Int16Array(buffer)
          if (source.length < voxelCount) throw new Error(`文件体素数 ${source.length} 小于维度声明 ${voxelCount}`)
          for (let i = 0; i < voxelCount; i++) encoded[i] = encodeHu(source[i])
        } else {
          const source = new Uint16Array(buffer)
          if (source.length < voxelCount) throw new Error(`文件体素数 ${source.length} 小于维度声明 ${voxelCount}`)
          for (let i = 0; i < voxelCount; i++) encoded[i] = Math.max(0, Math.min(4095, source[i]))
        }
        const record: CaseRecord = {
          id: createId('case'),
          name: name.value || file.name,
          description: `RAW 导入：${file.name}`,
          dims,
          spacing: [Number(spacing.value), Number(spacing.value), Number(spacing.value)],
          createdAt: Date.now(),
          hu: encoded.buffer,
          sourceName: file.name,
          sourceFormat: format.value
        }
        await db.putCase(record)
        await store.refreshCases()
        await store.loadCase(record)
        onImported()
        toast('CT 体数据已导入并载入', 'success')
      } catch (error) {
        toast(error instanceof Error ? error.message : '导入失败', 'error')
      }
    }, 'primary')
  ])
}

export function createCasesPage(): HTMLElement {
  const list = h('div.case-list')
  const progress = h('div.progress-card')
  const segmentation = createSegmentationPanel()

  async function renderList() {
    list.replaceChildren(builtinCard(256), builtinCard(512))
    if (!store.state.cases.length) {
      list.append(emptyState('IndexedDB 还没有病例', '可先生成内置合成腹部，或导入 RAW CT 体数据。'))
    }
    for (const record of store.state.cases) list.append(caseCard(record))
  }

  const unsubscribe = store.subscribe(() => {
    progress.replaceChildren()
    if (store.state.volumeLoading) {
      progress.append(
        h('div.progress-head', {}, [h('strong', { text: store.state.volumeProgress }), h('span', { text: `${Math.round(store.state.volumeProgressValue * 100)}%` })]),
        h('div.progress-track', {}, [h('i', { style: `width:${Math.round(store.state.volumeProgressValue * 100)}%` })])
      )
      progress.classList.add('is-visible')
    } else {
      progress.classList.remove('is-visible')
    }
  })

  void store.refreshCases().then(renderList)
  let lastCases = store.state.cases
  const listUnsubscribe = store.subscribe(() => {
    if (store.state.cases === lastCases) return
    lastCases = store.state.cases
    void renderList()
  })

  const element = h('div.page.page-cases', {}, [
    h('header.page-header', {}, [
      h('div', {}, [h('h1', { text: '病例库与 CT 分割' }), h('p', { text: '管理 CT 体数据、HU 到声学参数映射，以及可写回的手动分割。' })]),
      h('div.button-row', {}, [button('前往扫查训练', () => (location.hash = '#/training'), 'primary')])
    ]),
    progress,
    h('div.cases-layout', {}, [
      h('section.case-library.panel', {}, [
        h('div.panel-title', {}, [h('h2', { text: '病例列表' }), h('span.badge.badge-neutral', { text: 'IndexedDB' })]),
        list
      ]),
      h('section.case-import.panel', {}, [createImportForm(() => void renderList())]),
      h('section.segmentation-panel.panel', {}, [
        h('div.panel-title', {}, [h('h2', { text: '分割与声学映射' })]),
        segmentation
      ])
    ])
  ])
  ;(element as unknown as { __dispose?: () => void }).__dispose = () => {
    unsubscribe()
    listUnsubscribe()
    ;(segmentation as unknown as { __unsubscribe?: () => void }).__unsubscribe?.()
  }
  return element
}
