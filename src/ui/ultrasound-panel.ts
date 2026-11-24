import { CpuUltrasoundRenderer } from '../gpu/cpu-renderer'
import { MAX_SIM_DEPTH_MM } from '../gpu/compute-shader'
import { UltrasoundEngine } from '../gpu/ultrasound-engine'
import { store } from '../core/store'
import { h } from './dom'

export class UltrasoundPanel {
  readonly element: HTMLElement
  readonly gpuCanvas: HTMLCanvasElement
  private overlay: HTMLCanvasElement
  private engine: UltrasoundEngine | null = null
  private cpu: CpuUltrasoundRenderer | null = null
  private raf = 0
  private lastVolume: unknown = null
  private lastRevision = -1
  private frames = 0
  private fpsStamp = performance.now()
  private fpsValue = 0
  private status: HTMLElement
  private fpsBadge: HTMLElement
  private errorBox: HTMLElement
  private disposed = false
  onFps: ((fps: number) => void) | null = null
  frozen = false

  constructor() {
    this.gpuCanvas = h<HTMLCanvasElement>('canvas.us-canvas')
    this.overlay = h<HTMLCanvasElement>('canvas.us-overlay')
    this.fpsBadge = h('span.badge.badge-accent', { text: '-- FPS' })
    this.status = h('span.badge.badge-neutral', { text: 'WebGPU 初始化中' })
    this.errorBox = h('div.us-error')
    this.element = h('div.us-screen', {}, [
      this.gpuCanvas,
      this.overlay,
      this.errorBox,
      h('div.us-topbar', {}, [
        h('div.us-brand', {}, [h('span.us-dot'), h('span', { text: 'B-MODE · CT RAY TRACING' })]),
        h('div.us-badges', {}, [this.status, this.fpsBadge])
      ]),
      h('div.us-bottom-hint', { text: '声速 1540 m/s · 深度按声程精确标定' })
    ])
    void this.init()
    this.loop()
  }

  getEngine() {
    return this.engine
  }

  getFps() {
    return this.fpsValue
  }

  private async init() {
    try {
      const engine = await UltrasoundEngine.create(this.gpuCanvas)
      if (this.disposed) {
        engine.dispose()
        return
      }
      this.engine = engine
      this.status.textContent = 'WebGPU Compute'
      this.status.className = 'badge badge-good'
      if (store.state.volume) {
        this.engine.setVolume(store.state.volume)
        this.lastVolume = store.state.volume
      }
    } catch (error) {
      if (this.disposed) return
      this.status.textContent = 'CPU 兼容模式'
      this.status.className = 'badge badge-warn'
      try {
        this.cpu = new CpuUltrasoundRenderer(this.gpuCanvas)
        this.cpu.setBands(store.state.bands)
        if (store.state.volume) this.cpu.setVolume(store.state.volume)
      } catch {
        this.cpu = null
      }
      this.errorBox.replaceChildren(
        h('h3', { text: this.cpu ? 'WebGPU 不可用，已切换 CPU 兼容渲染' : 'WebGPU 超声内核未启动' }),
        h('p', { text: error instanceof Error ? error.message : String(error) }),
        h('p', { text: this.cpu ? '当前仍可操作和看仿真图像，但 512³ 帧率验收请使用启用 WebGPU 的 Chrome/Edge。' : '请使用 Chrome/Edge 120+ 并启用 WebGPU。' })
      )
      this.errorBox.classList.add('is-visible')
      if (this.cpu) {
        setTimeout(() => this.errorBox.classList.remove('is-visible'), 5000)
      }
    }
  }

  private drawOverlay() {
    const rect = this.overlay.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    if (this.overlay.width !== Math.floor(rect.width * dpr)) {
      this.overlay.width = Math.floor(rect.width * dpr)
      this.overlay.height = Math.floor(rect.height * dpr)
    }
    const ctx = this.overlay.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, rect.width, rect.height)

    const depth = store.state.params.depth
    const mmPerPixel = depth / rect.height
    const halfAngle = (store.state.params.sectorAngle / 2) * Math.PI / 180
    const topPad = store.state.params.probe === 'convex' ? 48 * (1 - Math.cos(halfAngle)) : 0
    const depthToY = (mm: number) => ((mm + topPad) / depth) * rect.height
    const x = 30
    ctx.strokeStyle = 'rgba(148,163,184,0.55)'
    ctx.fillStyle = 'rgba(203,213,225,0.86)'
    ctx.lineWidth = 1
    ctx.font = '14px ui-monospace, SFMono-Regular, Menlo, monospace'
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    ctx.beginPath()
    ctx.moveTo(x, 8)
    ctx.lineTo(x, rect.height - 8)
    ctx.stroke()

    for (let mm = 20; mm <= depth; mm += 20) {
      const y = depthToY(mm)
      ctx.beginPath()
      ctx.moveTo(x - 5, y)
      ctx.lineTo(x + 5, y)
      ctx.stroke()
      ctx.fillText(String(mm), x - 8, y)
    }

    const focusY = depthToY(store.state.params.focus)
    if (focusY > 8 && focusY < rect.height - 8) {
      ctx.strokeStyle = 'rgba(34,211,238,0.8)'
      ctx.beginPath()
      ctx.moveTo(rect.width - 54, focusY)
      ctx.lineTo(rect.width - 18, focusY)
      ctx.moveTo(rect.width - 54, focusY - 5)
      ctx.lineTo(rect.width - 46, focusY)
      ctx.lineTo(rect.width - 54, focusY + 5)
      ctx.moveTo(rect.width - 18, focusY - 5)
      ctx.lineTo(rect.width - 26, focusY)
      ctx.lineTo(rect.width - 18, focusY + 5)
      ctx.stroke()
      ctx.fillStyle = 'rgba(165,243,252,0.9)'
      ctx.textAlign = 'right'
      ctx.fillText('F', rect.width - 58, focusY)
    }

    ctx.textAlign = 'left'
    ctx.fillStyle = 'rgba(148,163,184,0.75)'
    ctx.fillText(`MAX A-LINE ${MAX_SIM_DEPTH_MM}mm · 1024 SAMPLES`, 12, rect.height - 18)
    void mmPerPixel
  }

  private loop = () => {
    if (this.disposed) return
    const volume = store.state.volume
    if (this.engine && volume && volume !== this.lastVolume) {
      this.engine.setVolume(volume)
      this.lastVolume = volume
      this.lastRevision = store.state.volumeRevision
    }
    if (this.engine && volume && store.state.volumeRevision !== this.lastRevision) {
      this.engine.updateVolumePixels()
      this.lastRevision = store.state.volumeRevision
    }
    try {
      if (!this.frozen && this.engine && volume) {
        this.engine.setPose(store.state.pose)
        this.engine.setParams(store.state.params)
        this.engine.setBands(store.state.bands)
        this.engine.renderFrame()
      } else if (!this.frozen && this.cpu && volume) {
        if (volume !== this.lastVolume) {
          this.cpu.setVolume(volume)
          this.lastVolume = volume
          this.lastRevision = store.state.volumeRevision
        }
        this.cpu.setPose(store.state.pose)
        this.cpu.setParams(store.state.params)
        this.cpu.setBands(store.state.bands)
        this.cpu.renderFrame()
      }
      this.drawOverlay()
    } catch (error) {
      console.error('超声面板渲染失败', error)
    }

    this.frames++
    const now = performance.now()
    if (now - this.fpsStamp >= 600) {
      this.fpsValue = Math.round((this.frames * 1000) / (now - this.fpsStamp))
      this.fpsBadge.textContent = `${this.fpsValue} FPS`
      this.fpsBadge.className = `badge ${this.fpsValue >= 30 ? 'badge-good' : 'badge-warn'}`
      this.onFps?.(this.fpsValue)
      this.frames = 0
      this.fpsStamp = now
    }
    this.raf = requestAnimationFrame(this.loop)
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    this.engine?.dispose()
  }
}
