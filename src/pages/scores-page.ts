import { EXAM_TASKS } from '../core/anatomy'
import { db } from '../core/db'
import { summarizeScores } from '../core/scoring'
import { store } from '../core/store'
import { formatDateTime, formatDuration, h, statCard, toast } from '../ui/dom'
import { openReplayDialog } from '../ui/replay-dialog'

export function createScoresPage(): HTMLElement {
  const summary = h('div.stats-grid')
  const studentStats = h('div.table-wrap')
  const taskStats = h('div.table-wrap')
  const scoreTable = h('div.table-wrap')
  const recordingList = h('div.recording-list')
  const studentFilter = h<HTMLSelectElement>('select.input')
  const taskFilter = h<HTMLSelectElement>('select.input', {}, [
    h('option', { value: 'all', text: '全部题目' }),
    ...EXAM_TASKS.map((task) => h('option', { value: task.id, text: task.title }))
  ])

  function renderSummary() {
    const all = store.state.scores
    const passed = all.filter((item) => item.passed).length
    const avgScore = all.length ? Math.round(all.reduce((sum, item) => sum + item.score, 0) / all.length) : 0
    const avgTime = all.length ? Math.round(all.reduce((sum, item) => sum + item.durationSec, 0) / all.length) : 0
    summary.replaceChildren(
      statCard('考核次数', String(all.length), 'IndexedDB 持久化'),
      statCard('总正确率', all.length ? `${Math.round((passed / all.length) * 100)}%` : '—', `${passed} 次达标`),
      statCard('平均分数', all.length ? String(avgScore) : '—', '位置 + 角度'),
      statCard('平均用时', all.length ? formatDuration(avgTime) : '—', '从开始到冻结')
    )

    const students = [...new Set(all.map((item) => item.student))]
    const selectedStudent = studentFilter.value || 'all'
    studentFilter.replaceChildren(
      h('option', { value: 'all', text: '全部学生' }),
      ...students.map((name) => h('option', { value: name, text: name }))
    )
    studentFilter.value = [...studentFilter.options].some((option) => option.value === selectedStudent) ? selectedStudent : 'all'
  }

  function renderAggregates() {
    const summaryData = summarizeScores(store.state.scores)
    studentStats.replaceChildren(
      h('table.data-table', {}, [
        h('thead', {}, [h('tr', {}, [h('th', { text: '学生' }), h('th', { text: '次数' }), h('th', { text: '正确率' }), h('th', { text: '平均分' }), h('th', { text: '平均用时' })])]),
        h('tbody', {}, summaryData.students.map((row) => h('tr', {}, [
          h('td.strong', { text: row.name }),
          h('td', { text: String(row.attempts) }),
          h('td', {}, [h('span.badge', { class: row.correctRate >= 60 ? 'badge-good' : 'badge-warn', text: `${row.correctRate}%` })]),
          h('td', { text: String(row.averageScore) }),
          h('td', { text: formatDuration(row.averageDurationSec) })
        ])))
      ])
    )

    taskStats.replaceChildren(
      h('table.data-table', {}, [
        h('thead', {}, [h('tr', {}, [h('th', { text: '题目' }), h('th', { text: '次数' }), h('th', { text: '正确率' }), h('th', { text: '平均分' }), h('th', { text: '平均用时' })])]),
        h('tbody', {}, summaryData.tasks.map((row) => h('tr', {}, [
          h('td.strong', { text: EXAM_TASKS.find((task) => task.id === row.taskId)?.title ?? row.taskId }),
          h('td', { text: String(row.attempts) }),
          h('td', { text: `${row.correctRate}%` }),
          h('td', { text: String(row.averageScore) }),
          h('td', { text: formatDuration(row.averageDurationSec) })
        ])))
      ])
    )
  }

  function renderScores() {
    const student = studentFilter.value || 'all'
    const taskId = taskFilter.value || 'all'
    const rows = store.state.scores.filter((item) => (student === 'all' || item.student === student) && (taskId === 'all' || item.taskId === taskId))
    scoreTable.replaceChildren(
      h('table.data-table', {}, [
        h('thead', {}, [h('tr', {}, ['时间', '学生', '题目', '分数', '位置误差', '角度误差', '用时', '结果'].map((text) => h('th', { text })))]),
        h('tbody', {}, rows.map((item) => h('tr', {}, [
          h('td.nowrap', { text: formatDateTime(item.createdAt) }),
          h('td.strong', { text: item.student }),
          h('td', { text: item.taskTitle }),
          h('td.score-cell', { text: String(item.score) }),
          h('td', { text: `${item.positionErrorMm} mm` }),
          h('td', { text: `${item.angleErrorDeg}°` }),
          h('td', { text: formatDuration(item.durationSec) }),
          h('td', {}, [h('span.badge', { class: item.passed ? 'badge-good' : 'badge-bad', text: item.passed ? '达标' : '未达标' })])
        ])))
      ])
    )
    if (!rows.length) scoreTable.append(h('div.table-empty', { text: '当前筛选下还没有成绩。去考核页冻结一个切面吧。' }))
  }

  function renderRecordings() {
    recordingList.replaceChildren()
    if (!store.state.recordings.length) {
      recordingList.append(h('div.table-empty', { text: '还没有扫查轨迹。训练页或考核页停止录制后会出现在这里。' }))
      return
    }
    for (const recording of store.state.recordings) {
      recordingList.append(
        h('article.recording-card', {}, [
          h('div', {}, [
            h('strong', { text: recording.title }),
            h('p', { text: `${recording.student} · ${formatDateTime(recording.createdAt)} · ${(recording.durationMs / 1000).toFixed(1)}s · ${recording.frames.length} 点` })
          ]),
          h('div.button-row', {}, [
            h('button.btn.btn-primary', { type: 'button', text: '回放轨迹', onclick: () => openReplayDialog(recording) }),
            h('button.btn.btn-danger', {
              type: 'button',
              text: '删除',
              onclick: async () => {
                await db.deleteRecording(recording.id)
                await store.refreshRecordings()
                toast('轨迹已删除')
              }
            })
          ])
        ])
      )
    }
  }

  studentFilter.addEventListener('change', renderScores)
  taskFilter.addEventListener('change', renderScores)

  renderSummary()
  renderAggregates()
  renderScores()
  renderRecordings()
  let lastScores = store.state.scores
  let lastRecordings = store.state.recordings
  const unsubscribe = store.subscribe(() => {
    if (store.state.scores === lastScores && store.state.recordings === lastRecordings) return
    lastScores = store.state.scores
    lastRecordings = store.state.recordings
    renderSummary()
    renderAggregates()
    renderScores()
    renderRecordings()
  })

  void Promise.all([store.refreshScores(), store.refreshRecordings()])

  const element = h('div.page.page-scores', {}, [
    h('header.page-header', {}, [
      h('div', {}, [h('h1', { text: '成绩统计与轨迹回放' }), h('p', { text: '按学生和题目统计正确率、平均分数与用时；教师可回放探头路径。' })]),
      h('div.button-row', {}, [
        h('button.btn.btn-danger', {
          type: 'button',
          text: '清空成绩',
          onclick: async () => {
            if (!confirm('确定清空全部成绩？录制轨迹不会删除。')) return
            await db.clearScores()
            await store.refreshScores()
            toast('成绩已清空')
          }
        })
      ])
    ]),
    summary,
    h('section.panel', {}, [h('div.panel-title', {}, [h('h2', { text: '按学生统计' })]), studentStats]),
    h('section.panel', {}, [h('div.panel-title', {}, [h('h2', { text: '按题目统计' })]), taskStats]),
    h('section.panel', {}, [
      h('div.panel-title', {}, [
        h('h2', { text: '成绩明细' }),
        h('div.filters', {}, [studentFilter, taskFilter])
      ]),
      scoreTable
    ]),
    h('section.panel', {}, [h('div.panel-title', {}, [h('h2', { text: '扫查录像 / 探头轨迹' })]), recordingList])
  ])
  ;(element as unknown as { __dispose?: () => void }).__dispose = unsubscribe
  return element
}
