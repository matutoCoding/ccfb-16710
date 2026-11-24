import type { ProbePose, RecordedFrame } from './types'

export class PoseRecorder {
  private frames: RecordedFrame[] = []
  private startStamp = 0
  private timer: number | null = null
  private poseProvider: (() => ProbePose) | null = null

  start(poseProvider: () => ProbePose) {
    this.frames = []
    this.startStamp = performance.now()
    this.poseProvider = poseProvider
    this.capture()
    this.timer = window.setInterval(() => this.capture(), 100)
  }

  private capture() {
    if (!this.poseProvider) return
    this.frames.push({ t: performance.now() - this.startStamp, pose: structuredClone(this.poseProvider()) })
  }

  stop(): { durationMs: number; frames: RecordedFrame[] } {
    if (this.timer !== null) window.clearInterval(this.timer)
    this.timer = null
    this.capture()
    const durationMs = this.frames.at(-1)?.t ?? 0
    const frames = this.frames
    this.frames = []
    this.poseProvider = null
    return { durationMs, frames }
  }
}

export class RecordingPlayer {
  private raf = 0
  private start = 0
  private frameIndex = 0
  constructor(
    private frames: RecordedFrame[],
    private onFrame: (pose: ProbePose, index: number) => void,
    private onEnd?: () => void
  ) {}

  play() {
    this.stop()
    this.start = performance.now()
    this.frameIndex = 0
    const tick = () => {
      const elapsed = performance.now() - this.start
      while (this.frameIndex < this.frames.length - 1 && this.frames[this.frameIndex + 1].t <= elapsed) {
        this.frameIndex++
      }
      const frame = this.frames[this.frameIndex]
      if (frame) this.onFrame(frame.pose, this.frameIndex)
      if (elapsed >= (this.frames.at(-1)?.t ?? 0)) {
        this.onEnd?.()
        return
      }
      this.raf = requestAnimationFrame(tick)
    }
    this.raf = requestAnimationFrame(tick)
  }

  stop() {
    cancelAnimationFrame(this.raf)
  }
}
