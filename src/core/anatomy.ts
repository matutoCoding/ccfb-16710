import { directionToTilt, ellipsoidSurfaceY, normalize, sub } from './geometry'
import type { ExamTask, ProbePose, TissueBand, Vec3 } from './types'

export const VOLUME_DIMS = 512
export const VOXEL_SPACING = 0.625
export const VOLUME_SIZE_MM = VOLUME_DIMS * VOXEL_SPACING

export const BODY = {
  center: [160, 118, 165] as Vec3,
  radii: [142, 78, 126] as Vec3
}

export const CALIBRATION = {
  expectedDepthMm: 80,
  probe: {
    position: [160, 40, 165] as Vec3,
    tiltX: 0,
    tiltZ: 0,
    spin: 0
  } satisfies ProbePose,
  plate: {
    center: [160, 121, 165] as Vec3,
    size: [84, 2, 38] as Vec3,
    firstFaceY: 120
  }
}

export interface EllipsoidShape {
  kind: 'ellipsoid'
  id: string
  label: string
  center: Vec3
  radii: Vec3
  hu: number
  color: string
  opacity?: number
}

export interface BoxShape {
  kind: 'box'
  id: string
  label: string
  center: Vec3
  size: Vec3
  hu: number
  color: string
}

export interface CapsuleShape {
  kind: 'capsuleZ'
  id: string
  label: string
  center: Vec3
  radius: number
  halfLength: number
  hu: number
  color: string
}

export type AnatomyShape = EllipsoidShape | BoxShape | CapsuleShape

export const ANATOMY_SHAPES: AnatomyShape[] = [
  { kind: 'ellipsoid', id: 'liver', label: '肝脏', center: [126, 116, 184], radii: [70, 46, 54], hu: 55, color: '#9a5144', opacity: 0.82 },
  { kind: 'ellipsoid', id: 'gallbladder', label: '胆囊', center: [92, 145, 164], radii: [10, 17, 12], hu: 2, color: '#5d9b63', opacity: 0.9 },
  { kind: 'ellipsoid', id: 'kidneyR', label: '右肾', center: [91, 166, 150], radii: [29, 24, 43], hu: 38, color: '#a85f68', opacity: 0.88 },
  { kind: 'ellipsoid', id: 'pelvisR', label: '右肾窦', center: [91, 170, 150], radii: [12, 10, 25], hu: 12, color: '#d8b184', opacity: 0.9 },
  { kind: 'ellipsoid', id: 'kidneyL', label: '左肾', center: [229, 166, 153], radii: [29, 24, 43], hu: 40, color: '#a85f68', opacity: 0.88 },
  { kind: 'ellipsoid', id: 'pelvisL', label: '左肾窦', center: [229, 170, 153], radii: [12, 10, 25], hu: 14, color: '#d8b184', opacity: 0.9 },
  { kind: 'capsuleZ', id: 'aorta', label: '腹主动脉', center: [151, 151, 166], radius: 8.5, halfLength: 76, hu: 28, color: '#c64b4b' },
  { kind: 'capsuleZ', id: 'ivc', label: '下腔静脉', center: [174, 148, 166], radius: 11.5, halfLength: 72, hu: 24, color: '#4b78c6' },
  {
    kind: 'box',
    id: 'reflector',
    label: '已知深度反射界面',
    center: CALIBRATION.plate.center,
    size: CALIBRATION.plate.size,
    hu: 3000,
    color: '#d7e3f4'
  }
]

export const RIB_DESCRIPTORS = [
  { z: 108, span: 1.05, zSlope: 16 },
  { z: 129, span: 1.12, zSlope: 18 },
  { z: 150, span: 1.18, zSlope: 20 },
  { z: 171, span: 1.16, zSlope: 18 },
  { z: 192, span: 1.08, zSlope: 15 },
  { z: 213, span: 0.96, zSlope: 12 }
]

export function ribPoint(ribIndex: number, side: -1 | 1, t: number): Vec3 {
  const rib = RIB_DESCRIPTORS[ribIndex]
  const a = 0.28 + t * rib.span
  const z = rib.z + side * rib.zSlope * Math.sin(a) * 0.35
  return [
    BODY.center[0] + side * 132 * Math.sin(a),
    BODY.center[1] - 69 * Math.cos(a) + 2,
    z
  ]
}

function poseToward(x: number, z: number, target: Vec3, spin: number): ProbePose {
  const y = ellipsoidSurfaceY(x, z, BODY.center, BODY.radii) ?? 44
  const position: Vec3 = [x, y + 0.5, z]
  const direction = normalize(sub(target, position))
  const tilt = directionToTilt(direction)
  return { position, tiltX: tilt.tiltX, tiltZ: tilt.tiltZ, spin }
}

export const EXAM_TASKS: ExamTask[] = [
  {
    id: 'liver-transverse',
    title: '肝脏横切面',
    organ: 'liver',
    instruction: '探头置于右肋缘/剑突下区域，声束指向肝门，显示肝实质与肝内管道样结构。',
    referenceHint: '图像应呈现大片均匀中等回声，内部可见细小管道断面。',
    targetPose: poseToward(126, 184, [126, 122, 184], 0),
    toleranceMm: 24,
    toleranceDeg: 14
  },
  {
    id: 'gallbladder-long',
    title: '胆囊长轴切面',
    organ: 'gallbladder',
    instruction: '在肝脏脏面找到无回声梨形结构，旋转探头使胆囊长轴与图像侧向平行。',
    referenceHint: '胆囊应为边界清晰的无回声长条，后方可见回声增强。',
    targetPose: poseToward(98, 164, [92, 145, 164], 88),
    toleranceMm: 18,
    toleranceDeg: 16
  },
  {
    id: 'kidney-right-coronal',
    title: '右肾冠状切面',
    organ: 'kidneyR',
    instruction: '探头移至右侧腋中线附近，声束朝向后内侧，显示椭圆形肾脏与中央肾窦。',
    referenceHint: '肾包膜明亮，皮质低回声，中央肾窦为高回声。',
    targetPose: poseToward(27, 150, [91, 166, 150], 82),
    toleranceMm: 26,
    toleranceDeg: 18
  },
  {
    id: 'kidney-left-coronal',
    title: '左肾冠状切面',
    organ: 'kidneyL',
    instruction: '探头移至左侧腋中线附近，声束朝向后内侧，找到左肾冠状面。',
    referenceHint: '左肾位置略高，图像中应见低回声皮质包绕高回声肾窦。',
    targetPose: poseToward(293, 153, [229, 166, 153], 96),
    toleranceMm: 26,
    toleranceDeg: 18
  }
]

export const DEFAULT_TISSUE_BANDS: TissueBand[] = [
  { id: 'air', name: '空气/肺', lowHu: -1100, highHu: -500, impedance: 0.0004, attenuation: 12, scatter: 0.0, color: '#94a3b8' },
  { id: 'fat', name: '脂肪', lowHu: -200, highHu: -40, impedance: 1.38, attenuation: 0.48, scatter: 0.24, color: '#facc15' },
  { id: 'fluid', name: '胆汁/尿液', lowHu: -20, highHu: 20, impedance: 1.48, attenuation: 0.03, scatter: 0.025, color: '#38bdf8' },
  { id: 'blood', name: '血液/血管', lowHu: 21, highHu: 34, impedance: 1.61, attenuation: 0.18, scatter: 0.07, color: '#ef4444' },
  { id: 'soft', name: '软组织/肝肾', lowHu: 35, highHu: 85, impedance: 1.64, attenuation: 0.72, scatter: 0.52, color: '#a78bfa' },
  { id: 'muscle', name: '肌肉/皮肤', lowHu: 86, highHu: 180, impedance: 1.70, attenuation: 1.05, scatter: 0.62, color: '#fb7185' },
  { id: 'bone', name: '肋骨/钙化', lowHu: 181, highHu: 1800, impedance: 7.6, attenuation: 8.5, scatter: 0.86, color: '#e2e8f0' },
  { id: 'metal', name: '强反射标定板', lowHu: 1801, highHu: 4095, impedance: 32, attenuation: 18, scatter: 0.95, color: '#67e8f9' }
]

export const DEFAULT_IMAGING = {
  probe: 'convex' as const,
  frequency: 3.5,
  gain: 18,
  tgc: [0, 1, 2, 3, 4, 5, 6, 7],
  depth: 160,
  focus: 75,
  dynamicRange: 72,
  sectorAngle: 62,
  speckle: 0.82
}

export const STUDENT_NAMES_KEY = 'usim.student'
