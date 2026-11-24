import { ANATOMY_SHAPES, BODY, RIB_DESCRIPTORS, ribPoint } from '../core/anatomy'
import { directionToTilt, poseBasis } from '../core/geometry'
import type { ImagingParams, ProbeKind, ProbePose, Vec3 } from '../core/types'

interface Projected {
  x: number
  y: number
  scale: number
  depth: number
}

interface RenderTriangle {
  points: [Projected, Projected, Projected]
  depth: number
  color: string
  alpha: number
}

function sphereGeometry(segments = 20, rings = 12) {
  const vertices: Vec3[] = []
  const indices: Array<[number, number, number]> = []
  for (let y = 0; y <= rings; y++) {
    const v = y / rings
    const theta = v * Math.PI
    for (let x = 0; x <= segments; x++) {
      const u = x / segments
      const phi = u * Math.PI * 2
      vertices.push([Math.sin(theta) * Math.cos(phi), Math.cos(theta), Math.sin(theta) * Math.sin(phi)])
    }
  }
  for (let y = 0; y < rings; y++) {
    for (let x = 0; x < segments; x++) {
      const a = y * (segments + 1) + x
      const b = a + segments + 1
      indices.push([a, b, a + 1], [b, b + 1, a + 1])
    }
  }
  return { vertices, indices }
}

function boxGeometry() {
  const vertices: Vec3[] = [
    [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
    [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]
  ]
  const indices: Array<[number, number, number]> = [
    [0, 1, 2], [0, 2, 3], [4, 6, 5], [4, 7, 6],
    [0, 4, 5], [0, 5, 1], [3, 2, 6], [3, 6, 7],
    [0, 3, 7], [0, 7, 4], [1, 5, 6], [1, 6, 2]
  ]
  return { vertices, indices }
}

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace('#', '')
  return [parseInt(value.slice(0, 2), 16), parseInt(value.slice(2, 4), 16), parseInt(value.slice(4, 6), 16)]
}

function shade(hex: string, factor: number): string {
  const [r, g, b] = hexToRgb(hex)
  const f = Math.max(0.35, Math.min(1.25, factor))
  return `rgb(${Math.round(Math.min(255, r * f))},${Math.round(Math.min(255, g * f))},${Math.round(Math.min(255, b * f))})`
}

export class BodyScene {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private sphere = sphereGeometry(16, 10)
  private box = boxGeometry()
  private raf = 0
  private width = 320
  private height = 420
  private yaw = -0.28
  private pitch = 0.1
  private distance = 430
  private focal = 520
  private target: Vec3 = [160, 112, 165]
  private pose: ProbePose
  private params: ImagingParams | null = null
  private ghostPose: ProbePose | null = null
  private path: ProbePose[] = []
  private mode: 'probe' | 'orbit' = 'probe'
  private dragging = false
  private dragKind: 'probe' | 'orbit' | null = null
  private lastPointer = { x: 0, y: 0 }
  private disposed = false
  private dirty = true
  onPoseChange: ((pose: ProbePose) => void) | null = null

  constructor(canvas: HTMLCanvasElement, pose: ProbePose) {
    this.canvas = canvas
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('无法创建 2D 三维视图上下文')
    this.ctx = ctx
    this.pose = structuredClone(pose)
    this.bindEvents()
    this.resize()
    this.loop()
  }

  setPose(pose: ProbePose) {
    this.pose = pose
    this.dirty = true
  }

  setParams(params: ImagingParams) {
    this.params = params
    this.dirty = true
  }

  setGhostPose(pose: ProbePose | null) {
    this.ghostPose = pose
    this.dirty = true
  }

  setPath(frames: ProbePose[]) {
    this.path = frames
    this.dirty = true
  }

  setMode(mode: 'probe' | 'orbit') {
    this.mode = mode
    this.canvas.style.cursor = mode === 'orbit' ? 'grab' : 'crosshair'
    this.dirty = true
  }

  private resize() {
    const rect = this.canvas.getBoundingClientRect()
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    this.width = Math.max(280, rect.width)
    this.height = Math.max(320, rect.height)
    this.canvas.width = Math.floor(this.width * dpr)
    this.canvas.height = Math.floor(this.height * dpr)
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    this.focal = this.height * 1.28
    this.dirty = true
  }

  private rotate(q: Vec3): Vec3 {
    const cy = Math.cos(this.yaw)
    const sy = Math.sin(this.yaw)
    const x1 = q[0] * cy - q[1] * sy
    const y1 = q[0] * sy + q[1] * cy
    const cp = Math.cos(this.pitch)
    const sp = Math.sin(this.pitch)
    const y2 = y1 * cp - q[2] * sp
    const z2 = y1 * sp + q[2] * cp
    return [x1, y2, z2]
  }

  private inverseVector(q: Vec3): Vec3 {
    const cp = Math.cos(this.pitch)
    const sp = Math.sin(this.pitch)
    const y1 = q[1] * cp + q[2] * sp
    const z1 = -q[1] * sp + q[2] * cp
    const cy = Math.cos(this.yaw)
    const sy = Math.sin(this.yaw)
    return [q[0] * cy + y1 * sy, -q[0] * sy + y1 * cy, z1]
  }

  private project(world: Vec3): Projected {
    const q = this.rotate([world[0] - this.target[0], world[1] - this.target[1], world[2] - this.target[2]])
    const depth = this.distance + q[1]
    const scale = this.focal / Math.max(80, depth)
    return {
      x: this.width / 2 + q[0] * scale,
      y: this.height / 2 - q[2] * scale,
      scale,
      depth
    }
  }

  private pointerRay(clientX: number, clientY: number) {
    const rect = this.canvas.getBoundingClientRect()
    const x = clientX - rect.left
    const y = clientY - rect.top
    const nx = (x - this.width / 2) / this.focal
    const nz = -(y - this.height / 2) / this.focal
    const direction = this.inverseVector([nx, 1, nz])
    const dl = Math.hypot(direction[0], direction[1], direction[2])
    const dir: Vec3 = [direction[0] / dl, direction[1] / dl, direction[2] / dl]
    const originRelative = this.inverseVector([0, -this.distance, 0])
    const origin: Vec3 = [
      originRelative[0] + this.target[0],
      originRelative[1] + this.target[1],
      originRelative[2] + this.target[2]
    ]
    return { origin, dir }
  }

  private hitBody(clientX: number, clientY: number): Vec3 | null {
    const { origin, dir } = this.pointerRay(clientX, clientY)
    const c = BODY.center
    const r = BODY.radii
    const oc: Vec3 = [(origin[0] - c[0]) / r[0], (origin[1] - c[1]) / r[1], (origin[2] - c[2]) / r[2]]
    const ds: Vec3 = [dir[0] / r[0], dir[1] / r[1], dir[2] / r[2]]
    const a = ds[0] ** 2 + ds[1] ** 2 + ds[2] ** 2
    const b = 2 * (oc[0] * ds[0] + oc[1] * ds[1] + oc[2] * ds[2])
    const cc = oc[0] ** 2 + oc[1] ** 2 + oc[2] ** 2 - 1
    const disc = b * b - 4 * a * cc
    if (disc < 0) return null
    const t = (-b - Math.sqrt(disc)) / (2 * a)
    if (t < 0) return null
    return [origin[0] + dir[0] * t, origin[1] + dir[1] * t, origin[2] + dir[2] * t]
  }

  private updateProbeFromPointer(event: PointerEvent) {
    const hit = this.hitBody(event.clientX, event.clientY)
    if (!hit) return
    const outward: Vec3 = [
      (hit[0] - BODY.center[0]) / BODY.radii[0] ** 2,
      (hit[1] - BODY.center[1]) / BODY.radii[1] ** 2,
      (hit[2] - BODY.center[2]) / BODY.radii[2] ** 2
    ]
    const ol = Math.hypot(...outward)
    const inward: Vec3 = [-outward[0] / ol, -outward[1] / ol, -outward[2] / ol]
    const angles = directionToTilt(inward)
    this.pose = { ...this.pose, position: hit, tiltX: angles.tiltX, tiltZ: angles.tiltZ }
    this.dirty = true
    this.onPoseChange?.(this.pose)
  }

  private onPointerDown = (event: PointerEvent) => {
    this.canvas.setPointerCapture(event.pointerId)
    this.dragging = true
    this.lastPointer = { x: event.clientX, y: event.clientY }
    this.dragKind = event.button === 2 || event.shiftKey || this.mode === 'orbit' ? 'orbit' : 'probe'
    if (this.dragKind === 'probe') this.updateProbeFromPointer(event)
  }

  private onPointerMove = (event: PointerEvent) => {
    if (!this.dragging) return
    const dx = event.clientX - this.lastPointer.x
    const dy = event.clientY - this.lastPointer.y
    this.lastPointer = { x: event.clientX, y: event.clientY }
    if (this.dragKind === 'orbit') {
      this.yaw += dx * 0.008
      this.pitch = Math.max(-0.75, Math.min(0.75, this.pitch + dy * 0.006))
      this.dirty = true
    } else {
      this.updateProbeFromPointer(event)
    }
  }

  private onPointerUp = () => {
    this.dragging = false
    this.dragKind = null
  }

  private onWheel = (event: WheelEvent) => {
    event.preventDefault()
    this.distance = Math.max(300, Math.min(650, this.distance + event.deltaY * 0.35))
    this.dirty = true
  }

  private onContext = (event: Event) => event.preventDefault()

  private bindEvents() {
    this.canvas.addEventListener('pointerdown', this.onPointerDown)
    this.canvas.addEventListener('pointermove', this.onPointerMove)
    this.canvas.addEventListener('pointerup', this.onPointerUp)
    this.canvas.addEventListener('pointercancel', this.onPointerUp)
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false })
    this.canvas.addEventListener('contextmenu', this.onContext)
  }

  private addEllipsoidTriangles(center: Vec3, radii: Vec3, color: string, alpha: number, triangles: RenderTriangle[]) {
    const light: Vec3 = [-0.42, -0.72, -0.36]
    for (const tri of this.sphere.indices) {
      const worldPoints = tri.map((idx) => {
        const v = this.sphere.vertices[idx]
        return [center[0] + v[0] * radii[0], center[1] + v[1] * radii[1], center[2] + v[2] * radii[2]] as Vec3
      })
      const projected = worldPoints.map((p) => this.project(p)) as [Projected, Projected, Projected]
      const depth = (projected[0].depth + projected[1].depth + projected[2].depth) / 3
      const localNormal: Vec3 = [
        (worldPoints[0][0] - center[0]) / radii[0] ** 2,
        (worldPoints[0][1] - center[1]) / radii[1] ** 2,
        (worldPoints[0][2] - center[2]) / radii[2] ** 2
      ]
      const nl = Math.hypot(...localNormal)
      const n: Vec3 = [localNormal[0] / nl, localNormal[1] / nl, localNormal[2] / nl]
      const diffuse = Math.max(0.28, -(n[0] * light[0] + n[1] * light[1] + n[2] * light[2]))
      triangles.push({ points: projected, depth, color: shade(color, 0.62 + diffuse * 0.62), alpha })
    }
  }

  private addBoxTriangles(center: Vec3, halfSize: Vec3, rotationBasis: ReturnType<typeof poseBasis> | null, color: string, alpha: number, triangles: RenderTriangle[]) {
    for (const tri of this.box.indices) {
      const worldPoints = tri.map((idx) => {
        const v = this.box.vertices[idx]
        let local: Vec3 = [v[0] * halfSize[0], v[1] * halfSize[1], v[2] * halfSize[2]]
        if (rotationBasis) {
          const b = rotationBasis
          local = [
            b.lateral[0] * local[0] + b.direction[0] * local[1] + b.elevational[0] * local[2],
            b.lateral[1] * local[0] + b.direction[1] * local[1] + b.elevational[1] * local[2],
            b.lateral[2] * local[0] + b.direction[2] * local[1] + b.elevational[2] * local[2]
          ]
        }
        return [center[0] + local[0], center[1] + local[1], center[2] + local[2]] as Vec3
      })
      const projected = worldPoints.map((p) => this.project(p)) as [Projected, Projected, Projected]
      triangles.push({
        points: projected,
        depth: (projected[0].depth + projected[1].depth + projected[2].depth) / 3,
        color,
        alpha
      })
    }
  }

  private drawTriangles(items: RenderTriangle[]) {
    items.sort((a, b) => b.depth - a.depth)
    const ctx = this.ctx
    for (const item of items) {
      ctx.beginPath()
      ctx.moveTo(item.points[0].x, item.points[0].y)
      ctx.lineTo(item.points[1].x, item.points[1].y)
      ctx.lineTo(item.points[2].x, item.points[2].y)
      ctx.closePath()
      ctx.globalAlpha = item.alpha
      ctx.fillStyle = item.color
      ctx.fill()
      ctx.strokeStyle = item.color
      ctx.lineWidth = 0.45
      ctx.stroke()
    }
    ctx.globalAlpha = 1
  }

  private drawRibs() {
    const ctx = this.ctx
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    for (let r = 0; r < RIB_DESCRIPTORS.length; r++) {
      for (const side of [-1, 1] as const) {
        ctx.beginPath()
        let avgScale = 1
        for (let i = 0; i <= 24; i++) {
          const p = this.project(ribPoint(r, side, i / 24))
          avgScale += p.scale
          if (i === 0) ctx.moveTo(p.x, p.y)
          else ctx.lineTo(p.x, p.y)
        }
        avgScale /= 25
        ctx.strokeStyle = 'rgba(232,226,210,0.82)'
        ctx.lineWidth = Math.max(3, 4.6 * avgScale)
        ctx.stroke()
      }
    }
  }

  private drawLabel(world: Vec3, text: string, color = '#e2e8f0') {
    const p = this.project(world)
    const ctx = this.ctx
    ctx.font = '600 14px "Microsoft YaHei", system-ui, sans-serif'
    const width = ctx.measureText(text).width + 12
    ctx.globalAlpha = 0.82
    ctx.fillStyle = 'rgba(15,23,42,0.78)'
    ctx.roundRect(p.x - width / 2, p.y - 12, width, 22, 6)
    ctx.fill()
    ctx.globalAlpha = 1
    ctx.fillStyle = color
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, p.x, p.y)
  }

  private drawBeam(pose: ProbePose, color: string, ghost = false) {
    if (!this.params && !ghost) return
    const basis = poseBasis(pose)
    const probe: ProbeKind = this.params?.probe ?? 'convex'
    const depth = ghost ? 110 : this.params?.depth ?? 150
    const halfAngle = ((this.params?.sectorAngle ?? 62) / 2 * Math.PI) / 180
    const halfWidth = probe === 'linear' ? 32 : 26
    const ctx = this.ctx
    const points: Vec3[] = [pose.position]
    if (probe === 'linear') {
      points.push(
        pose.position.map((v, i) => v + basis.lateral[i] * halfWidth) as Vec3,
        pose.position.map((v, i) => v + basis.lateral[i] * halfWidth + basis.direction[i] * depth * 0.72) as Vec3,
        pose.position.map((v, i) => v - basis.lateral[i] * halfWidth + basis.direction[i] * depth * 0.72) as Vec3,
        pose.position.map((v, i) => v - basis.lateral[i] * halfWidth) as Vec3
      )
    } else {
      for (let i = 0; i <= 24; i++) {
        const a = -halfAngle + (i / 24) * halfAngle * 2
        const dir = basis.direction.map((_, k) => basis.direction[k] * Math.cos(a) + basis.lateral[k] * Math.sin(a)) as Vec3
        points.push(pose.position.map((v, k) => v + dir[k] * depth * 0.72) as Vec3)
      }
    }
    const projected = points.map((p) => this.project(p))
    ctx.save()
    ctx.globalAlpha = ghost ? 0.22 : 0.34
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.moveTo(projected[0].x, projected[0].y)
    for (let i = 1; i < projected.length; i++) ctx.lineTo(projected[i].x, projected[i].y)
    ctx.closePath()
    ctx.fill()
    ctx.globalAlpha = ghost ? 0.7 : 0.95
    ctx.strokeStyle = color
    ctx.setLineDash(ghost ? [5, 5] : [])
    ctx.lineWidth = 1.5
    ctx.stroke()
    ctx.restore()
  }

  private drawProbe(pose: ProbePose, ghost = false) {
    const basis = poseBasis(pose)
    const kind = this.params?.probe ?? 'convex'
    const width = kind === 'linear' ? 70 : kind === 'convex' ? 60 : 20
    const color = ghost ? '#34d399' : '#22d3ee'
    const items: RenderTriangle[] = []
    const headCenter: Vec3 = pose.position.map((v, i) => v - basis.direction[i] * 7) as Vec3
    this.addBoxTriangles(headCenter, [width / 2, 7, 10], basis, ghost ? '#34d399' : '#334155', ghost ? 0.28 : 0.96, items)
    const handleCenter: Vec3 = pose.position.map((v, i) => v - basis.direction[i] * 48) as Vec3
    this.addBoxTriangles(handleCenter, [13, 34, 12], basis, ghost ? '#065f46' : '#0f172a', ghost ? 0.2 : 0.98, items)
    this.drawTriangles(items)

    const p = this.project(pose.position)
    this.ctx.save()
    this.ctx.globalAlpha = ghost ? 0.5 : 1
    this.ctx.fillStyle = color
    this.ctx.shadowColor = color
    this.ctx.shadowBlur = 12
    this.ctx.beginPath()
    this.ctx.arc(p.x, p.y, ghost ? 5 : 6, 0, Math.PI * 2)
    this.ctx.fill()
    this.ctx.restore()
    this.drawBeam(pose, color, ghost)
  }

  private drawPath() {
    if (this.path.length < 2) return
    const ctx = this.ctx
    for (let i = 1; i < this.path.length; i++) {
      const a = this.project(this.path[i - 1].position)
      const b = this.project(this.path[i].position)
      ctx.strokeStyle = `rgba(34,211,238,${0.25 + (i / this.path.length) * 0.65})`
      ctx.lineWidth = 2.2
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      ctx.stroke()
    }
    const start = this.project(this.path[0].position)
    const end = this.project(this.path[this.path.length - 1].position)
    ctx.fillStyle = '#94a3b8'
    ctx.beginPath(); ctx.arc(start.x, start.y, 4, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#22d3ee'
    ctx.beginPath(); ctx.arc(end.x, end.y, 6, 0, Math.PI * 2); ctx.fill()
  }

  private render = () => {
    if (this.disposed) return
    if (this.canvas.clientWidth !== Math.floor(this.width)) this.resize()
    const ctx = this.ctx
    ctx.clearRect(0, 0, this.width, this.height)

    const items: RenderTriangle[] = []
    this.addEllipsoidTriangles(BODY.center, BODY.radii, '#d9a083', 0.16, items)
    for (const shape of ANATOMY_SHAPES) {
      if (shape.kind === 'ellipsoid') this.addEllipsoidTriangles(shape.center, shape.radii, shape.color, shape.opacity ?? 0.82, items)
      if (shape.kind === 'capsuleZ') this.addEllipsoidTriangles(shape.center, [shape.radius, shape.radius, shape.halfLength], shape.color, 0.86, items)
      if (shape.kind === 'box') this.addBoxTriangles(shape.center, [shape.size[0] / 2, shape.size[1] / 2, shape.size[2] / 2], null, shape.color, 0.9, items)
    }
    this.drawTriangles(items)
    this.drawRibs()
    this.drawPath()

    this.drawLabel([126, 72, 184], '肝')
    this.drawLabel([92, 126, 164], '胆')
    this.drawLabel([91, 138, 150], '右肾')
    this.drawLabel([229, 138, 153], '左肾')
    this.drawLabel([160, 116, 165], '标定面', '#a5f3fc')

    if (this.ghostPose) this.drawProbe(this.ghostPose, true)
    this.drawProbe(this.pose)

    ctx.fillStyle = 'rgba(226,232,240,0.72)'
    ctx.font = '14px system-ui, "Microsoft YaHei"'
    ctx.textAlign = 'left'
    ctx.fillText('拖动体表移动探头 · Shift/右键拖动旋转视角 · 滚轮缩放', 14, this.height - 14)
  }

  private loop = () => {
    if (this.disposed) return
    if (this.canvas.clientWidth !== Math.floor(this.width)) this.resize()
    if (this.dirty) {
      try {
        this.render()
      } catch (error) {
        console.error('三维体表渲染失败', error)
      }
      this.dirty = false
    }
    this.raf = requestAnimationFrame(this.loop)
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    this.canvas.removeEventListener('pointerdown', this.onPointerDown)
    this.canvas.removeEventListener('pointermove', this.onPointerMove)
    this.canvas.removeEventListener('pointerup', this.onPointerUp)
    this.canvas.removeEventListener('pointercancel', this.onPointerUp)
    this.canvas.removeEventListener('wheel', this.onWheel)
    this.canvas.removeEventListener('contextmenu', this.onContext)
  }
}
