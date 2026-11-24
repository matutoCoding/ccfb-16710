import { store } from '../core/store'
import type { ScanRecording } from '../core/types'
import { BodyScene } from './body-scene'
import { h } from './dom'
import { UltrasoundPanel } from './ultrasound-panel'

export function openReplayDialog(recording: ScanRecording) {
  const previousPose = structuredClone(store.state.pose)
  const ultrasound = new UltrasoundPanel()
  const bodyCanvas = h<HTMLCanvasElement>('canvas.body-canvas.replay-body-canvas')
  const bodyScene = new BodyScene(bodyCanvas, recording.frames[0]?.pose ?? previousPose)
  bodyScene.setParams(store.state.params)
  bodyScene.setPath(recording.frames.map((frame) => frame.pose))

  const timeLabel = h('span', { text: '00:00.0' })
  const progress = h<HTMLInputElement>('input.replay-progress', {
    type: 'range',
    min: 0,
    max: Math.max(1, recording.durationMs),
    value: 0
  })
  let raf = 0
  let playing = false

  function stopPlayer() {
    cancelAnimationFrame(raf)
    playing = false
    playButton.textContent = '播放'
  }

  function seekTo(timeMs: number) {
    let current = recording.frames[0]
    for (const frame of recording.frames) {
      if (frame.t <= timeMs) current = frame
      else break
    }
    if (current) {
      store.setPose(current.pose)
      bodyScene.setPose(current.pose)
      progress.value = String(timeMs)
      timeLabel.textContent = `${(timeMs / 60000).toFixed(0).padStart(2, '0')}:${((timeMs % 60000) / 1000).toFixed(1).padStart(4, '0')}`
    }
  }

  const playButton = h('button.btn.btn-primary', {
    type: 'button',
    text: '播放',
    onclick: () => {
      if (playing) {
        stopPlayer()
        return
      }
      playing = true
      playButton.textContent = '暂停'
      const startOffset = Number(progress.value) >= recording.durationMs ? 0 : Number(progress.value)
      const startedAt = performance.now()
      const tickProgress = () => {
        if (!playing) return
        const t = Math.min(recording.durationMs, startOffset + performance.now() - startedAt)
        seekTo(t)
        if (t >= recording.durationMs) {
          stopPlayer()
          playButton.textContent = '重新播放'
          return
        }
        raf = requestAnimationFrame(tickProgress)
      }
      raf = requestAnimationFrame(tickProgress)
    }
  })

  progress.addEventListener('input', () => {
    stopPlayer()
    seekTo(Number(progress.value))
  })

  const close = () => {
    stopPlayer()
    ultrasound.dispose()
    bodyScene.dispose()
    store.setPose(previousPose)
    overlay.remove()
  }

  const closeButton = h('button.btn.btn-ghost', { type: 'button', text: '关闭', onclick: close })
  const overlay = h('div.modal-overlay', {
    onclick: (event: MouseEvent) => {
      if (event.target === overlay) close()
    }
  }, [
    h('div.modal.replay-modal', { role: 'dialog', 'aria-modal': 'true' }, [
      h('header.modal-header', {}, [
        h('div', {}, [
          h('h2', { text: `轨迹回放 · ${recording.title}` }),
          h('p', { text: `${recording.student} · ${recording.frames.length} 个采样点 · ${(recording.durationMs / 1000).toFixed(1)} 秒` })
        ]),
        closeButton
      ]),
      h('div.replay-grid', {}, [
        h('div.replay-body', {}, [bodyCanvas]),
        h('div.replay-us', {}, [ultrasound.element])
      ]),
      h('div.replay-controls', {}, [playButton, progress, timeLabel])
    ])
  ])
  document.body.append(overlay)
  seekTo(0)
}
