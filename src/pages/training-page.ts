import { createId, db } from '../core/db'
import { PoseRecorder } from '../core/recorder'
import { store } from '../core/store'
import { BodyScene } from '../ui/body-scene'
import { createImagingControls, createPoseControls } from '../ui/controls-panel'
import { h, toast } from '../ui/dom'
import { UltrasoundPanel } from '../ui/ultrasound-panel'

export function createTrainingPage(): HTMLElement {
  const ultrasound = new UltrasoundPanel()
  const bodyCanvas = h<HTMLCanvasElement>('canvas.body-canvas')
  const bodyScene = new BodyScene(bodyCanvas, store.state.pose)
  bodyScene.setParams(store.state.params)
  bodyScene.onPoseChange = (pose) => store.setPose(pose)

  const recorder = new PoseRecorder()
  let recording = false
  let recordStartedAt = 0
  const recordButton = h('button.btn.btn-primary', { type: 'button', text: '开始录制轨迹' })
  const recordState = h('span.badge.badge-neutral', { text: '未录制' })
  const recordTime = h('span.record-time', { text: '00:00.0' })
  let timer = 0

  recordButton.addEventListener('click', () => {
    if (!recording) {
      recording = true
      recordStartedAt = performance.now()
      recorder.start(() => store.state.pose)
      recordButton.textContent = '停止并保存'
      recordButton.classList.add('btn-danger')
      recordState.textContent = 'REC'
      recordState.className = 'badge badge-bad'
      timer = window.setInterval(() => {
        const ms = performance.now() - recordStartedAt
        recordTime.textContent = `${(ms / 60000).toFixed(0).padStart(2, '0')}:${((ms % 60000) / 1000).toFixed(1).padStart(4, '0')}`
      }, 100)
    } else {
      const result = recorder.stop()
      window.clearInterval(timer)
      recording = false
      recordButton.textContent = '开始录制轨迹'
      recordButton.classList.remove('btn-danger')
      recordState.textContent = '未录制'
      recordState.className = 'badge badge-neutral'
      recordTime.textContent = '00:00.0'
      const record = {
        id: createId('rec'),
        student: store.state.student || '未填写学生',
        title: '开放扫查训练',
        caseId: store.state.activeCaseId,
        createdAt: Date.now(),
        durationMs: result.durationMs,
        frames: result.frames
      }
      void db.putRecording(record).then(() => {
        toast(`轨迹已保存：${result.frames.length} 个采样点，可在成绩统计页回放`, 'success')
        void store.refreshRecordings()
      })
    }
  })

  const modeProbe = h('button.segment-btn.is-active', { type: 'button', text: '拖动探头' })
  const modeOrbit = h('button.segment-btn', { type: 'button', text: '旋转视角' })
  modeProbe.addEventListener('click', () => {
    bodyScene.setMode('probe')
    modeProbe.classList.add('is-active')
    modeOrbit.classList.remove('is-active')
  })
  modeOrbit.addEventListener('click', () => {
    bodyScene.setMode('orbit')
    modeOrbit.classList.add('is-active')
    modeProbe.classList.remove('is-active')
  })

  const posePanel = h('div.control-block', {}, [h('h4', { text: '位置 / 倾角 / 旋转' }), createPoseControls()])
  const imaging = createImagingControls()

  const element = h('div.page.page-workbench', {}, [
    h('header.page-header.workbench-header', {}, [
      h('div', {}, [
        h('h1', { text: '扫查训练' }),
        h('p', { text: '在三维腹部体表拖动探头，或用滑杆精确控制六个自由度；B 超由 CT 体数据逐声线计算。' })
      ]),
      h('div.record-bar', {}, [recordState, recordTime, recordButton])
    ]),
    h('div.workbench-grid', {}, [
      h('section.panel.body-panel', {}, [
        h('div.panel-title', {}, [
          h('h2', { text: '三维人体与探头' }),
          h('div.segmented.segmented-small', {}, [modeProbe, modeOrbit])
        ]),
        h('div.body-canvas-wrap', {}, [bodyCanvas]),
        posePanel
      ]),
      h('section.panel.us-panel', {}, [
        h('div.panel-title', {}, [h('h2', { text: '实时 B 超' }), h('span.badge.badge-neutral', { text: store.state.volume?.name ?? '等待体数据' })]),
        ultrasound.element,
        h('div.us-legend', {}, [
          h('span', {}, [h('i.legend-dot.shadow'), '声影：骨/空气高衰减']),
          h('span', {}, [h('i.legend-dot.enhance'), '增强：液体低衰减']),
          h('span', {}, [h('i.legend-dot.reverb'), '混响：强界面重复回波']),
          h('span', {}, [h('i.legend-dot.speckle'), '世界锁定散斑'])
        ])
      ]),
      h('aside.panel.params-panel', {}, [h('div.panel-title', {}, [h('h2', { text: '图像参数' })]), imaging])
    ])
  ])

  const unsubscribe = store.subscribe(() => {
    bodyScene.setPose(store.state.pose)
    bodyScene.setParams(store.state.params)
  })

  ;(element as unknown as { __dispose?: () => void }).__dispose = () => {
    unsubscribe()
    ultrasound.dispose()
    bodyScene.dispose()
    window.clearInterval(timer)
    if (recording) {
      const result = recorder.stop()
      void db.putRecording({
        id: createId('rec'),
        student: store.state.student || '未填写学生',
        title: '开放扫查训练（离开页面自动保存）',
        caseId: store.state.activeCaseId,
        createdAt: Date.now(),
        durationMs: result.durationMs,
        frames: result.frames
      })
    }
  }
  return element
}
