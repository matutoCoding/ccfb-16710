import { EXAM_TASKS } from '../core/anatomy'
import { createId, db } from '../core/db'
import { PoseRecorder } from '../core/recorder'
import { scorePose, type PoseScore } from '../core/scoring'
import { store } from '../core/store'
import type { ExamTask, ScoreRecord } from '../core/types'
import { BodyScene } from '../ui/body-scene'
import { createImagingControls, createPoseControls } from '../ui/controls-panel'
import { h, formatDuration, toast } from '../ui/dom'
import { UltrasoundPanel } from '../ui/ultrasound-panel'

export function createExamPage(): HTMLElement {
  const ultrasound = new UltrasoundPanel()
  const bodyCanvas = h<HTMLCanvasElement>('canvas.body-canvas.body-canvas-exam')
  const bodyScene = new BodyScene(bodyCanvas, store.state.pose)
  bodyScene.setParams(store.state.params)
  bodyScene.setGhostPose(EXAM_TASKS[0].targetPose)
  bodyScene.onPoseChange = (pose) => store.setPose(pose)

  let task: ExamTask = EXAM_TASKS[0]
  let startedAt = performance.now()
  let elapsedBeforeFreeze = 0
  let frozen = false
  let lastResult: PoseScore | null = null
  const recorder = new PoseRecorder()
  recorder.start(() => store.state.pose)

  const timerValue = h('strong.exam-timer', { text: '00:00' })
  let timerHandle = window.setInterval(() => {
    if (!frozen) timerValue.textContent = formatDuration((performance.now() - startedAt) / 1000)
  }, 250)

  const resultBox = h('div.result-box.is-empty', {}, [h('h3', { text: '尚未冻结' }), h('p', { text: '找到目标切面后按“冻结并评分”。' })])

  const taskInstruction = h('div.task-instruction')
  function selectTask(next: ExamTask) {
    task = next
    startedAt = performance.now()
    frozen = false
    ultrasound.frozen = false
    lastResult = null
    bodyScene.setGhostPose(task.targetPose)
    resultBox.className = 'result-box is-empty'
    resultBox.replaceChildren(h('h3', { text: '尚未冻结' }), h('p', { text: task.instruction }))
    timerValue.textContent = '00:00'
    taskInstruction.replaceChildren(
      h('h3', { text: task.title }),
      h('p', { text: task.instruction }),
      h('p.reference-hint', { text: task.referenceHint }),
      h('div.tolerance', {}, [
        h('span.badge.badge-neutral', { text: `位置容差 ${task.toleranceMm} mm` }),
        h('span.badge.badge-neutral', { text: `角度容差 ${task.toleranceDeg}°` })
      ])
    )
    taskList.querySelectorAll('.task-item').forEach((item) => item.classList.toggle('is-active', item.id === `task-${task.id}`))
  }

  const taskList = h('div.task-list', {}, EXAM_TASKS.map((item) =>
    h('button.task-item', {
      id: `task-${item.id}`,
      type: 'button',
      onclick: () => selectTask(item)
    }, [h('strong', { text: item.title }), h('small', { text: item.referenceHint })])
  ))

  const studentInput = h<HTMLInputElement>('input.input', { value: store.state.student, placeholder: '学号 / 姓名' })
  studentInput.addEventListener('change', () => void store.setStudent(studentInput.value.trim() || '未命名学生'))

  const freezeButton = h('button.btn.btn-primary.btn-large', { type: 'button', text: '冻结并评分' })
  freezeButton.addEventListener('click', async () => {
    if (frozen) {
      frozen = false
      ultrasound.frozen = false
      startedAt = performance.now() - elapsedBeforeFreeze * 1000
      freezeButton.textContent = '冻结并评分'
      resultBox.classList.remove('is-frozen')
      return
    }

    frozen = true
    ultrasound.frozen = true
    elapsedBeforeFreeze = (performance.now() - startedAt) / 1000
    const pose = structuredClone(store.state.pose)
    const result = scorePose(pose, task)
    lastResult = result
    const record: ScoreRecord = {
      id: createId('score'),
      student: store.state.student || '未命名学生',
      taskId: task.id,
      taskTitle: task.title,
      caseId: store.state.activeCaseId,
      score: result.score,
      positionErrorMm: result.positionErrorMm,
      angleErrorDeg: result.angleErrorDeg,
      passed: result.passed,
      durationSec: Math.round(elapsedBeforeFreeze),
      createdAt: Date.now(),
      frozenPose: pose,
      fps: ultrasound.getFps()
    }
    await db.putScore(record)
    const trajectory = recorder.stop()
    await db.putRecording({
      id: createId('rec'),
      student: record.student,
      taskId: task.id,
      title: task.title,
      caseId: record.caseId,
      createdAt: Date.now(),
      durationMs: trajectory.durationMs,
      frames: trajectory.frames
    })
    recorder.start(() => store.state.pose)
    await store.refreshScores()
    await store.refreshRecordings()

    resultBox.className = `result-box ${result.passed ? 'is-pass' : 'is-fail'}`
    resultBox.replaceChildren(
      h('div.score-ring', { style: `--score:${result.score}` }, [h('strong', { text: String(result.score) }), h('span', { text: '分' })]),
      h('div.result-details', {}, [
        h('h3', { text: result.passed ? '达标：标准切面匹配' : '未达标：继续调整探头' }),
        h('p', { text: `位置误差 ${result.positionErrorMm} mm（位置项 ${result.positionScore} 分）` }),
        h('p', { text: `角度误差 ${result.angleErrorDeg}°（角度项 ${result.angleScore} 分）` }),
        h('p', { text: `用时 ${formatDuration(elapsedBeforeFreeze)}，成绩和轨迹已存入 IndexedDB。` })
      ])
    )
    freezeButton.textContent = '再考一次'
    toast(result.passed ? '考核达标，成绩已保存' : '本次未达标，成绩已保存', result.passed ? 'success' : 'error')
  })

  const demoButton = h('button.btn.btn-ghost', {
    type: 'button',
    text: '教师演示标准位',
    onclick: () => {
      store.setPose(structuredClone(task.targetPose))
      toast('已移动到标准切面姿态；学生考核时可隐藏此按钮')
    }
  })

  const element = h('div.page.page-exam', {}, [
    h('header.page-header', {}, [
      h('div', {}, [h('h1', { text: '标准切面考核' }), h('p', { text: '选择题目、寻找切面、冻结后按标准姿态的位置和角度评分。' })]),
      h('div.exam-header-fields', {}, [
        h('label.field-row.inline', {}, [h('span', { text: '学生' }), studentInput]),
        h('div.timer-card', {}, [h('span', { text: '用时' }), timerValue])
      ])
    ]),
    h('div.exam-grid', {}, [
      h('section.panel.exam-left', {}, [
        h('div.panel-title', {}, [h('h2', { text: '考核题目' })]),
        taskList,
        taskInstruction,
        h('div.body-canvas-wrap.body-canvas-exam-wrap', {}, [bodyCanvas]),
        h('details.pose-details', { open: true }, [h('summary', { text: '精确姿态控制' }), createPoseControls()])
      ]),
      h('section.panel.exam-center', {}, [
        h('div.panel-title', {}, [h('h2', { text: '考核 B 超' }), h('span.badge.badge-neutral', { text: '冻结后评分' })]),
        ultrasound.element,
        h('div.exam-actions', {}, [freezeButton, demoButton]),
        resultBox
      ]),
      h('aside.panel.exam-right', {}, [
        h('div.panel-title', {}, [h('h2', { text: '图像参数' })]),
        createImagingControls({ compact: true }),
        h('div.standard-preview', {}, [
          h('h4', { text: '评分模型' }),
          h('p.help', { text: '位置分权重 48%，角度分权重 52%。角度同时比较声束方向和切面旋转轴，避免旋转 90° 后误判。' })
        ])
      ])
    ])
  ])

  selectTask(EXAM_TASKS[0])
  const unsubscribe = store.subscribe(() => {
    bodyScene.setPose(store.state.pose)
    bodyScene.setParams(store.state.params)
  })

  ;(element as unknown as { __dispose?: () => void }).__dispose = () => {
    unsubscribe()
    window.clearInterval(timerHandle)
    ultrasound.dispose()
    bodyScene.dispose()
    recorder.stop()
  }
  return element
}
