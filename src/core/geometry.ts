import type { ProbeKind, ProbePose, Vec3 } from './types'

export const v3 = (x = 0, y = 0, z = 0): Vec3 => [x, y, z]
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s]
export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0]
]
export const length = (a: Vec3) => Math.hypot(a[0], a[1], a[2])
export const normalize = (a: Vec3): Vec3 => {
  const l = length(a)
  return l > 1e-8 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 1, 0]
}
export const clamp = (x: number, min: number, max: number) => Math.min(max, Math.max(min, x))
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export const degToRad = (d: number) => (d * Math.PI) / 180
export const radToDeg = (r: number) => (r * 180) / Math.PI

export interface ProbeBasis {
  origin: Vec3
  direction: Vec3
  lateral: Vec3
  elevational: Vec3
}

// tiltX: 绕患者左右轴倾头/倾足；tiltZ: 绕头足轴左右倾；spin: 沿声束旋转
export function poseBasis(pose: ProbePose): ProbeBasis {
  const ax = degToRad(pose.tiltX)
  const az = degToRad(pose.tiltZ)
  const sp = degToRad(pose.spin)

  let d: Vec3 = [0, Math.cos(ax), Math.sin(ax)]
  d = [
    -d[1] * Math.sin(az),
    d[1] * Math.cos(az),
    d[2]
  ]
  d = normalize(d)

  const reference: Vec3 = Math.abs(d[2]) > 0.92 ? [0, 0, 1] : [0, 0, 1]
  let lateral = normalize(cross(d, reference))
  if (length(lateral) < 0.01) lateral = [1, 0, 0]
  let elevational = normalize(cross(lateral, d))

  if (Math.abs(sp) > 1e-6) {
    const c = Math.cos(sp)
    const s = Math.sin(sp)
    const rotatedL = add(
      add(scale(lateral, c), scale(cross(d, lateral), s)),
      scale(d, dot(d, lateral) * (1 - c))
    )
    const rotatedE = add(
      add(scale(elevational, c), scale(cross(d, elevational), s)),
      scale(d, dot(d, elevational) * (1 - c))
    )
    lateral = normalize(rotatedL)
    elevational = normalize(rotatedE)
  }

  return { origin: [...pose.position] as Vec3, direction: d, lateral, elevational }
}

export function directionToTilt(direction: Vec3): Pick<ProbePose, 'tiltX' | 'tiltZ'> {
  const d = normalize(direction)
  const tiltX = radToDeg(Math.asin(clamp(d[2], -1, 1)))
  const cosX = Math.cos(degToRad(tiltX))
  const tiltZ = radToDeg(Math.atan2(-d[0], d[1] / Math.max(cosX, 1e-4)))
  return { tiltX, tiltZ }
}

export function angleBetweenDeg(a: Vec3, b: Vec3): number {
  const cos = clamp(dot(normalize(a), normalize(b)), -1, 1)
  return radToDeg(Math.acos(cos))
}

export function poseAngleError(a: ProbePose, b: ProbePose): number {
  const ba = poseBasis(a)
  const bb = poseBasis(b)
  const beam = angleBetweenDeg(ba.direction, bb.direction)
  // 旋转切面也要计入：比较 lateral 轴。无向轴取锐角。
  let spin = angleBetweenDeg(ba.lateral, bb.lateral)
  spin = Math.min(spin, 180 - spin)
  return Math.max(beam, spin * 0.7)
}

export function posePositionErrorMm(a: Vec3, b: Vec3): number {
  return length(sub(a, b))
}

export function ellipsoidSurfaceY(x: number, z: number, center: Vec3, radii: Vec3): number | null {
  const q = 1 - ((x - center[0]) / radii[0]) ** 2 - ((z - center[2]) / radii[2]) ** 2
  if (q < 0) return null
  return center[1] - radii[1] * Math.sqrt(q)
}

export function inwardEllipsoidNormal(point: Vec3, center: Vec3, radii: Vec3): Vec3 {
  const outward = normalize([
    (point[0] - center[0]) / (radii[0] ** 2),
    (point[1] - center[1]) / (radii[1] ** 2),
    (point[2] - center[2]) / (radii[2] ** 2)
  ])
  return scale(outward, -1)
}

export function defaultProbeWidth(probe: ProbeKind): number {
  if (probe === 'linear') return 64
  if (probe === 'convex') return 58
  return 18
}

export function probeLineCount(probe: ProbeKind): number {
  return probe === 'linear' ? 256 : 224
}
