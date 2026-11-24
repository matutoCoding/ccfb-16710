import {
  ANATOMY_SHAPES,
  BODY,
  CALIBRATION,
  ribPoint,
  VOLUME_SIZE_MM
} from './anatomy'
import type { Vec3, VolumeData } from './types'

export const HU_STORAGE_OFFSET = 1024

export function encodeHu(hu: number): number {
  return Math.max(0, Math.min(4095, Math.round(hu + HU_STORAGE_OFFSET)))
}

export function decodeHu(stored: number): number {
  return stored - HU_STORAGE_OFFSET
}

const yieldToUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

function worldToVoxelBound(min: number, max: number, spacing: number, count: number): [number, number] {
  const a = Math.max(0, Math.floor(min / spacing) - 1)
  const b = Math.min(count - 1, Math.ceil(max / spacing) + 1)
  return [a, b]
}

export async function createSyntheticVolume(
  size = 512,
  onProgress?: (label: string, progress?: number) => void
): Promise<VolumeData> {
  const total = size * size * size
  const hu = new Uint16Array(total)
  const spacing = VOLUME_SIZE_MM / size
  const index = (x: number, y: number, z: number) => x + size * (y + size * z)

  onProgress?.('填充空气背景', 0.02)
  hu.fill(encodeHu(-1000))

  const paintEllipsoid = (center: Vec3, radii: Vec3, value: number) => {
    const [x0, x1] = worldToVoxelBound(center[0] - radii[0], center[0] + radii[0], spacing, size)
    const [y0, y1] = worldToVoxelBound(center[1] - radii[1], center[1] + radii[1], spacing, size)
    const [z0, z1] = worldToVoxelBound(center[2] - radii[2], center[2] + radii[2], spacing, size)
    for (let z = z0; z <= z1; z++) {
      const wz = (z + 0.5) * spacing
      const dz = (wz - center[2]) / radii[2]
      for (let y = y0; y <= y1; y++) {
        const wy = (y + 0.5) * spacing
        const dy = (wy - center[1]) / radii[1]
        const base = dz * dz + dy * dy
        for (let x = x0; x <= x1; x++) {
          const wx = (x + 0.5) * spacing
          const dx = (wx - center[0]) / radii[0]
          if (base + dx * dx <= 1) hu[index(x, y, z)] = encodeHu(value)
        }
      }
    }
  }

  const paintBox = (center: Vec3, boxSize: Vec3, value: number) => {
    const [x0, x1] = worldToVoxelBound(center[0] - boxSize[0] / 2, center[0] + boxSize[0] / 2, spacing, size)
    const [y0, y1] = worldToVoxelBound(center[1] - boxSize[1] / 2, center[1] + boxSize[1] / 2, spacing, size)
    const [z0, z1] = worldToVoxelBound(center[2] - boxSize[2] / 2, center[2] + boxSize[2] / 2, spacing, size)
    for (let z = z0; z <= z1; z++) {
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) hu[index(x, y, z)] = encodeHu(value)
      }
    }
  }

  const paintCapsuleZ = (center: Vec3, radius: number, halfLength: number, value: number) => {
    const [x0, x1] = worldToVoxelBound(center[0] - radius, center[0] + radius, spacing, size)
    const [y0, y1] = worldToVoxelBound(center[1] - radius, center[1] + radius, spacing, size)
    const [z0, z1] = worldToVoxelBound(center[2] - halfLength - radius, center[2] + halfLength + radius, spacing, size)
    for (let z = z0; z <= z1; z++) {
      const wz = (z + 0.5) * spacing
      const dz = Math.max(0, Math.abs(wz - center[2]) - halfLength)
      for (let y = y0; y <= y1; y++) {
        const wy = (y + 0.5) * spacing
        const dy = wy - center[1]
        for (let x = x0; x <= x1; x++) {
          const wx = (x + 0.5) * spacing
          const dx = wx - center[0]
          if (dx * dx + dy * dy + dz * dz <= radius * radius) hu[index(x, y, z)] = encodeHu(value)
        }
      }
    }
  }

  const paintSphere = (center: Vec3, radius: number, value: number) => {
    paintEllipsoid(center, [radius, radius, radius], value)
  }

  onProgress?.('生成腹壁与脂肪层', 0.08)
  const [bx0, bx1] = worldToVoxelBound(BODY.center[0] - BODY.radii[0], BODY.center[0] + BODY.radii[0], spacing, size)
  const [by0, by1] = worldToVoxelBound(BODY.center[1] - BODY.radii[1], BODY.center[1] + BODY.radii[1], spacing, size)
  const [bz0, bz1] = worldToVoxelBound(BODY.center[2] - BODY.radii[2], BODY.center[2] + BODY.radii[2], spacing, size)
  let slab = 0
  const slabs = bz1 - bz0 + 1
  for (let z = bz0; z <= bz1; z++) {
    const wz = (z + 0.5) * spacing
    const dz = (wz - BODY.center[2]) / BODY.radii[2]
    for (let y = by0; y <= by1; y++) {
      const wy = (y + 0.5) * spacing
      const dy = (wy - BODY.center[1]) / BODY.radii[1]
      const yz = dz * dz + dy * dy
      for (let x = bx0; x <= bx1; x++) {
        const wx = (x + 0.5) * spacing
        const dx = (wx - BODY.center[0]) / BODY.radii[0]
        const q = yz + dx * dx
        if (q <= 1) {
          let value = 36
          if (q > 0.76) value = -88
          if (q > 0.955) value = 46
          hu[index(x, y, z)] = encodeHu(value)
        }
      }
    }
    slab++
    if (slab % 24 === 0) {
      onProgress?.('生成腹壁与脂肪层', 0.08 + 0.34 * (slab / slabs))
      await yieldToUi()
    }
  }

  for (const shape of ANATOMY_SHAPES) {
    onProgress?.(`绘制${shape.label}`)
    if (shape.kind === 'ellipsoid') paintEllipsoid(shape.center, shape.radii, shape.hu)
    if (shape.kind === 'box') paintBox(shape.center, shape.size, shape.hu)
    if (shape.kind === 'capsuleZ') paintCapsuleZ(shape.center, shape.radius, shape.halfLength, shape.hu)
    await yieldToUi()
  }

  onProgress?.('生成弧形肋骨与声影结构', 0.78)
  for (let r = 0; r < 6; r++) {
    for (const side of [-1, 1] as const) {
      for (let i = 0; i <= 30; i++) {
        const p = ribPoint(r, side, i / 30)
        paintSphere(p, 4.8, 680)
      }
    }
    if (r % 2 === 0) await yieldToUi()
  }

  // 标定板第一表面严格位于 firstFaceY；探测原点到该平面的声程为 80 mm。
  paintBox(CALIBRATION.plate.center, CALIBRATION.plate.size, 3000)

  onProgress?.('完成体数据合成', 1)
  return {
    id: 'synthetic-abdomen',
    name: `合成腹部体数据 ${size}³`,
    dims: [size, size, size],
    spacing: [spacing, spacing, spacing],
    hu,
    synthetic: true,
    knownReflectorDepthMm: CALIBRATION.expectedDepthMm,
    knownReflectorWorld: {
      position: [CALIBRATION.plate.center[0], CALIBRATION.plate.firstFaceY, CALIBRATION.plate.center[2]],
      normal: [0, -1, 0]
    }
  }
}
