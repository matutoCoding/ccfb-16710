import './styles.css'
import { store } from './core/store'
import type { PageKey } from './core/types'
import { createCasesPage } from './pages/cases-page'
import { createExamPage } from './pages/exam-page'
import { createImagingPage } from './pages/imaging-page'
import { createScoresPage } from './pages/scores-page'
import { createSettingsPage } from './pages/settings-page'
import { createTrainingPage } from './pages/training-page'
import { h } from './ui/dom'
import { iconSvg } from './ui/icons'

const NAV: Array<{ key: PageKey; label: string; icon: string; desc: string }> = [
  { key: 'cases', label: '病例库', icon: 'case', desc: 'CT 导入 / 分割' },
  { key: 'training', label: '扫查训练', icon: 'probe', desc: '自由操作' },
  { key: 'exam', label: '切面考核', icon: 'exam', desc: '冻结评分' },
  { key: 'imaging', label: '图像参数', icon: 'imaging', desc: '增益 TGC 焦点' },
  { key: 'scores', label: '成绩统计', icon: 'scores', desc: '统计 / 回放' },
  { key: 'settings', label: '设置验收', icon: 'settings', desc: '深度 / FPS' }
]

function pageFromHash(): PageKey {
  const hash = location.hash.replace('#/', '') as PageKey
  return NAV.some((item) => item.key === hash) ? hash : 'cases'
}

function render() {
  const page = pageFromHash()
  store.state.page = page
  const root = document.querySelector<HTMLElement>('#page-root')
  if (!root) return
  const previous = root.firstElementChild as (HTMLElement & { __dispose?: () => void }) | null
  previous?.__dispose?.()
  previous?.querySelectorAll<HTMLElement>('[class]').forEach((element) => {
    ;(element as HTMLElement & { __controlDispose?: () => void }).__controlDispose?.()
  })
  root.replaceChildren()

  const factory = {
    cases: createCasesPage,
    training: createTrainingPage,
    exam: createExamPage,
    imaging: createImagingPage,
    scores: createScoresPage,
    settings: createSettingsPage
  }[page]
  root.append(factory())
  root.scrollTop = 0

  document.querySelectorAll('.nav-item').forEach((item) => {
    item.classList.toggle('is-active', item.getAttribute('data-page') === page)
  })
}

function bootstrap() {
  const app = document.querySelector<HTMLDivElement>('#app')
  if (!app) return
  const nav = h('nav.sidebar-nav', {}, NAV.map((item) =>
    h(`a.nav-item`, {
      href: `#/${item.key}`,
      'data-page': item.key
    }, [
      h('span.nav-icon', { html: iconSvg(item.icon) }),
      h('span.nav-text', {}, [h('strong', { text: item.label }), h('small', { text: item.desc })])
    ])
  ))

  app.append(
    h('div.shell', {}, [
      h('aside.sidebar', {}, [
        h('div.brand', {}, [
          h('div.brand-mark', { text: '声' }),
          h('div', {}, [h('strong', { text: 'UltraSound Sim' }), h('small', { text: 'CT → WebGPU B-Mode' })])
        ]),
        nav,
        h('div.sidebar-foot', {}, [
          h('span.status-dot'),
          h('span', { text: store.state.webgpuAvailable ? 'WebGPU 设备可用' : '等待 WebGPU / 将显示错误提示' })
        ])
      ]),
      h('main#page-root.page-root')
    ])
  )

  window.addEventListener('hashchange', render)
  if (!location.hash) location.hash = '#/cases'
  render()
  document.documentElement.dataset.appReady = 'true'
  app.dataset.ready = 'true'

  void store.loadPersistedStudent()
  void store.refreshCases()
  if (!store.state.volume) {
    void store.generateSynthetic(256, false).catch((error) => console.error('合成体数据失败', error))
  }
}

bootstrap()
