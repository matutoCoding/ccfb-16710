import { degToRad, poseBasis } from '../core/geometry'
import type { ImagingParams, ProbePose, TissueBand, VolumeData } from '../core/types'
import { MAX_SIM_DEPTH_MM } from './compute-shader'

const LINES = 128
const SAMPLES = 384

type Point4 = [number, number, number, number]

export class CpuUltrasoundRenderer {
  private ctx: CanvasRenderingContext2D
  private volume: VolumeData | null = null
  private pose: ProbePose
  private params: ImagingParams
  private bands: TissueBand[]
  private width = 360
  private height = 420
  private image: ImageData | null = null
  private lines = new Float32Array(LINES * SAMPLES)

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('无法创建 CPU 兼容模式 2D 上下文')
    this.ctx = ctx
    this.pose = { position: [160, 44, 165], tiltX: 0, tiltZ: 0, spin: 0 }
    this.params = {
      probe: 'convex',
      frequency: 3.5,
      gain: 30,
      tgc: [0, 2, 5, 9, 14, 19, 25, 30],
      depth: 160,
      focus: 80,
      dynamicRange: 72,
      sectorAngle: 62,
      speckle: 0.82
    }
    this.bands = []
  }

  setVolume(volume: VolumeData) {
    this.volume = volume
  }

  setPose(pose: ProbePose) {
    this.pose = pose
  }

  setParams(params: ImagingParams) {
    this.params = params
  }

  setBands(bands: TissueBand[]) {
    this.bands = bands
  }

  private points(): Point4[] {
    return [...this.bands]
      .sort((a, b) => (a.lowHu + a.highHu) / 2 - (b.lowHu + b.highHu) / 2)
      .slice(0, 8)
      .map((band) => [(band.lowHu + band.highHu) / 2, band.impedance, band.attenuation, band.scatter])
  }

  private sampleHu(world: [number, number, number]): number {
    const volume = this.volume
    if (!volume) return -1000
    const [nx, ny, nz] = volume.dims
    const [sx, sy, sz] = volume.spacing
    const fx = world[0] / sx - 0.5
    const fy = world[1] / sy - 0.5
    const fz = world[2] / sz - 0.5
    const x0 = Math.floor(fx)
    const y0 = Math.floor(fy)
    const z0 = Math.floor(fz)
    const tx = fx - x0
    const ty = fy - y0
    const tz = fz - z0
    const load = (x: number, y: number, z: number) => {
      const cx = Math.max(0, Math.min(nx - 1, x))
      const cy = Math.max(0, Math.min(ny - 1, y))
      const cz = Math.max(0, Math.min(nz - 1, z))
      return volume.hu[cx + nx * (cy + ny * cz)] - 1024
    }
    const x00 = load(x0, y0, z0) * (1 - tx) + load(x0 + 1, y0, z0) * tx
    const x10 = load(x0, y0 + 1, z0) * (1 - tx) + load(x0 + 1, y0 + 1, z0) * tx
    const x01 = load(x0, y0, z0 + 1) * (1 - tx) + load(x0 + 1, y0, z0 + 1) * tx
    const x11 = load(x0, y0 + 1, z0 + 1) * (1 - tx) + load(x0 + 1, y0 + 1, z0 + 1) * tx
    const yA = x00 * (1 - ty) + x10 * ty
    const yB = x01 * (1 - ty) + x11 * ty
    return yA * (1 - tz) + yB * tz
  }

  private material(hu: number, points: Point4[]): Point4 {
    if (hu <= points[0][0]) return points[0]
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i]
      const b = points[i + 1]
      if (hu <= b[0]) {
        const t = Math.max(0, Math.min(1, (hu - a[0]) / Math.max(0.0001, b[0] - a[0])))
        return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t]
      }
    }
    return points[points.length - 1]
  }

  private hash(x: number, y: number, z: number) {
    const n = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453
    return n - Math.floor(n)
  }

  private noise(x: number, y: number, z: number) {
    const xi = Math.floor(x)
    const yi = Math.floor(y)
    const zi = Math.floor(z)
    const xf = x - xi
    const yf = y - yi
    const zf = z - zi
    const u = xf * xf * (3 - 2 * xf)
    const v = yf * yf * (3 - 2 * yf)
    const w = zf * zf * (3 - 2 * zf)
    const c000 = this.hash(xi, yi, zi)
    const c100 = this.hash(xi + 1, yi, zi)
    const c010 = this.hash(xi, yi + 1, zi)
    const c110 = this.hash(xi + 1, yi + 1, zi)
    const c001 = this.hash(xi, yi, zi + 1)
    const c101 = this.hash(xi + 1, yi, zi + 1)
    const c011 = this.hash(xi, yi + 1, zi + 1)
    const c111 = this.hash(xi + 1, yi + 1, zi + 1)
    const x00 = c000 + (c100 - c000) * u
    const x10 = c010 + (c110 - c010) * u
    const x01 = c001 + (c101 - c001) * u
    const x11 = c011 + (c111 - c011) * u
    return (x00 + (x10 - x00) * v) * (1 - w) + (x01 + (x11 - x01) * v) * w
  }

  private computeLines() {
    if (!this.volume || this.bands.length < 2) return
    const points = this.points()
    const basis = poseBasis(this.pose)
    const type = this.params.probe === 'linear' ? 0 : this.params.probe === 'convex' ? 1 : 2
    const halfAngle = degToRad(this.params.sectorAngle / 2)
    const curvature = 48
    const width = this.params.probe === 'linear' ? 64 : 58
    const step = MAX_SIM_DEPTH_MM / SAMPLES

    for (let line = 0; line < LINES; line++) {
      const side = (line / (LINES - 1)) * 2 - 1
      let origin = [...basis.origin] as [number, number, number]
      let dir = [...basis.direction] as [number, number, number]
      if (type === 0) {
        origin = origin.map((v, i) => v + basis.lateral[i] * side * width * 0.5) as [number, number, number]
      } else if (type === 2) {
        const a = side * halfAngle
        dir = dir.map((_, i) => basis.direction[i] * Math.cos(a) + basis.lateral[i] * Math.sin(a)) as [number, number, number]
      } else {
        const a = side * halfAngle
        const radial = dir.map((_, i) => basis.direction[i] * Math.cos(a) + basis.lateral[i] * Math.sin(a)) as [number, number, number]
        const center = origin.map((v, i) => v - basis.direction[i] * curvature)
        origin = center.map((v, i) => v + radial[i] * curvature) as [number, number, number]
        dir = radial
      }

      let zPrev = this.material(this.sampleHu(origin), points)[1]
      let transmission = 1
      let attenuation = 1
      for (let s = 0; s < SAMPLES; s++) {
        const d = (s + 1) * step
        const next = origin.map((v, i) => v + dir[i] * d) as [number, number, number]
        const mat = this.material(this.sampleHu(next), points)
        const r = (mat[1] - zPrev) / (mat[1] + zPrev + 1e-5)
        const cellDb = mat[2] * this.params.frequency * (step / 10)
        attenuation *= Math.pow(10, -cellDb / 20)
        const incident = transmission * attenuation
        const interfaceEcho = incident * Math.min(0.985, Math.abs(r)) * attenuation
        const mid = origin.map((v, i) => v + dir[i] * (s + 0.5) * step) as [number, number, number]
        const n = this.noise(mid[0] * 2.35 + 11.7, mid[1] * 2.35 + 4.1, mid[2] * 2.35 + 7.3)
        const speckle = Math.min(1.6, Math.pow(Math.abs(n * 2 - 1), 0.72) * 1.35)
        const scatter = incident * mat[3] * speckle * 0.2 * attenuation
        this.lines[line * SAMPLES + s] = Math.min(1, Math.max(interfaceEcho, scatter))
        transmission *= Math.sqrt(Math.max(0.015, 1 - r * r))
        zPrev = mat[1]
      }
    }
  }

  private sampleLine(lineCoord: number, axial: number) {
    const sampleF = Math.max(0, Math.min(SAMPLES - 1.001, (axial / MAX_SIM_DEPTH_MM) * SAMPLES - 0.5))
    const lineF = Math.max(0, Math.min(LINES - 1.001, lineCoord))
    const l0 = Math.floor(lineF)
    const s0 = Math.floor(sampleF)
    const lf = lineF - l0
    const sf = sampleF - s0
    const get = (l: number, s: number) => this.lines[Math.max(0, Math.min(LINES - 1, l)) * SAMPLES + Math.max(0, Math.min(SAMPLES - 1, s))]
    const a = get(l0, s0) * (1 - sf) + get(l0, s0 + 1) * sf
    const b = get(l0 + 1, s0) * (1 - sf) + get(l0 + 1, s0 + 1) * sf
    return a * (1 - lf) + b * lf
  }

  renderFrame() {
    if (!this.volume || this.bands.length < 2) return
    const rect = this.canvas.getBoundingClientRect()
    const targetWidth = 320
    const targetHeight = Math.max(260, Math.min(520, Math.round(targetWidth * Math.max(0.7, rect.height / Math.max(1, rect.width)))))
    if (this.width !== targetWidth || this.height !== targetHeight || !this.image) {
      this.width = targetWidth
      this.height = targetHeight
      this.canvas.width = targetWidth
      this.canvas.height = targetHeight
      this.image = this.ctx.createImageData(targetWidth, targetHeight)
    }
    this.computeLines()
    const data = this.image.data
    const p = this.params
    const halfAngle = degToRad(p.sectorAngle / 2)
    const mmPerPixel = p.depth / this.height
    const type = p.probe === 'linear' ? 0 : p.probe === 'convex' ? 1 : 2
    const topPad = type === 1 ? 48 * (1 - Math.cos(halfAngle)) : 0

    for (let y = 0; y < this.height; y++) {
      const yMm = y * mmPerPixel - topPad
      for (let x = 0; x < this.width; x++) {
        const xMm = (x - this.width / 2) * mmPerPixel
        let lineCoord = -1
        let axial = yMm
        if (type === 0) {
          if (yMm >= 0 && yMm <= p.depth && Math.abs(xMm) <= 32) lineCoord = (xMm / 64 + 0.5) * (LINES - 1)
        } else if (type === 2) {
          axial = Math.hypot(xMm, Math.max(yMm, 0))
          const angle = Math.atan2(xMm, Math.max(yMm, 0.001))
          if (yMm >= 0 && axial <= p.depth && Math.abs(angle) <= halfAngle) lineCoord = (angle / halfAngle * 0.5 + 0.5) * (LINES - 1)
        } else {
          const yy = yMm + 48
          const radial = Math.hypot(xMm, yy)
          axial = radial - 48
          const angle = Math.atan2(xMm, yy)
          if (axial >= -0.35 && axial <= p.depth && Math.abs(angle) <= halfAngle) lineCoord = (angle / halfAngle * 0.5 + 0.5) * (LINES - 1)
        }

        const idx = (y * this.width + x) * 4
        if (lineCoord < 0) {
          data[idx] = 4
          data[idx + 1] = 6
          data[idx + 2] = 10
          data[idx + 3] = 255
          continue
        }

        const beam = 1.1 + Math.abs(axial - p.focus) * 0.03
        const lineSigma = type === 0 ? beam / (64 / LINES) : Math.min(4, beam / Math.max(axial, 8) / halfAngle * LINES * 0.5)
        let value = 0
        for (const offset of [-lineSigma * 0.5, 0, lineSigma * 0.5]) {
          value += this.sampleLine(lineCoord + offset, axial) * 0.28
          value += this.sampleLine(lineCoord + offset, axial + 0.4) * 0.12
          value += this.sampleLine(lineCoord + offset, axial - 0.4) * 0.12
        }
        value += 0.2 * this.sampleLine(lineCoord, axial / 2)
        const seg = Math.max(0, Math.min(7, Math.floor((axial / p.depth) * 8)))
        const db = 20 * Math.log(Math.max(value, 1e-6)) / Math.LN10 + p.gain + p.tgc[seg]
        let gray = Math.max(0, Math.min(1, (db + p.dynamicRange * 0.82) / p.dynamicRange))
        gray = Math.pow(gray, 0.92) * 255
        data[idx] = gray * 0.96
        data[idx + 1] = gray
        data[idx + 2] = Math.min(255, gray * 1.04)
        data[idx + 3] = 255
      }
    }
    this.ctx.putImageData(this.image, 0, 0)
  }

  dispose() {}

  async measureCentralReflector() {
    this.computeLines()
    const center = Math.floor(LINES / 2)
    let peakIndex = 10
    let peak = 0
    for (let s = 10; s < SAMPLES - 4; s++) {
      const value = (this.lines[(center - 1) * SAMPLES + s] + this.lines[center * SAMPLES + s]) / 2
      if (value > peak) {
        peak = value
        peakIndex = s
      }
    }
    const y0 = this.lines[center * SAMPLES + Math.max(0, peakIndex - 1)]
    const y1 = this.lines[center * SAMPLES + peakIndex]
    const y2 = this.lines[center * SAMPLES + Math.min(SAMPLES - 1, peakIndex + 1)]
    const denom = y0 - 2 * y1 + y2
    let shift = 0
    if (Math.abs(denom) > 1e-12) shift = Math.max(-1, Math.min(1, 0.5 * (y0 - y2) / denom))
    const step = MAX_SIM_DEPTH_MM / SAMPLES
    return { depthMm: (peakIndex + shift + 0.5) * step, peak, samples: this.lines.slice(center * SAMPLES, center * SAMPLES + SAMPLES) }
  }
}
