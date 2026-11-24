export type ProbeKind = 'linear' | 'convex' | 'phased'
export type PageKey = 'cases' | 'training' | 'exam' | 'imaging' | 'scores' | 'settings'

export type Vec3 = [number, number, number]

export interface ProbePose {
  position: Vec3
  tiltX: number
  tiltZ: number
  spin: number
}

export interface ImagingParams {
  probe: ProbeKind
  frequency: number
  gain: number
  tgc: number[]
  depth: number
  focus: number
  dynamicRange: number
  sectorAngle: number
  speckle: number
}

export interface TissueBand {
  id: string
  name: string
  lowHu: number
  highHu: number
  impedance: number
  attenuation: number
  scatter: number
  color: string
}

export interface VolumeData {
  id?: string
  name: string
  dims: Vec3
  spacing: Vec3
  hu: Uint16Array
  synthetic?: boolean
  knownReflectorDepthMm?: number
  knownReflectorWorld?: { position: Vec3; normal: Vec3 }
}

export interface CaseRecord {
  id: string
  name: string
  description: string
  dims: Vec3
  spacing: Vec3
  createdAt: number
  builtin?: boolean
  hu: ArrayBuffer
  sourceName?: string
  sourceFormat?: string
}

export interface ExamTask {
  id: string
  title: string
  organ: 'liver' | 'kidneyL' | 'kidneyR' | 'gallbladder'
  instruction: string
  targetPose: ProbePose
  toleranceMm: number
  toleranceDeg: number
  referenceHint: string
}

export interface ScoreRecord {
  id: string
  student: string
  taskId: string
  taskTitle: string
  caseId: string
  score: number
  positionErrorMm: number
  angleErrorDeg: number
  passed: boolean
  durationSec: number
  createdAt: number
  frozenPose: ProbePose
  fps?: number
}

export interface RecordedFrame {
  t: number
  pose: ProbePose
}

export interface ScanRecording {
  id: string
  student: string
  taskId?: string
  title: string
  caseId: string
  createdAt: number
  durationMs: number
  frames: RecordedFrame[]
}

export interface KvRecord {
  key: string
  value: unknown
}

export interface CalibrationResult {
  ok: boolean
  measuredDepthMm: number
  expectedDepthMm: number
  errorMm: number
  thresholdMm: number
  peakValue: number
  renderer: 'webgpu' | 'cpu'
  message: string
}

export interface BenchmarkResult {
  fps: number
  frameMs: number
  samples: number
  dims: Vec3
  renderer: 'webgpu' | 'cpu'
  ok: boolean
}
