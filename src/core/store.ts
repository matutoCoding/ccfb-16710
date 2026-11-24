import { DEFAULT_IMAGING, DEFAULT_TISSUE_BANDS, EXAM_TASKS } from './anatomy'
import { db } from './db'
import { createSyntheticVolume } from './synthetic'
import type {
  CaseRecord,
  ImagingParams,
  PageKey,
  ProbePose,
  ScanRecording,
  ScoreRecord,
  TissueBand,
  VolumeData
} from './types'

export interface AppState {
  page: PageKey
  student: string
  cases: CaseRecord[]
  scores: ScoreRecord[]
  recordings: ScanRecording[]
  volume: VolumeData | null
  volumeRevision: number
  activeCaseId: string
  volumeLoading: boolean
  volumeProgress: string
  volumeProgressValue: number
  webgpuAvailable: boolean
  pose: ProbePose
  params: ImagingParams
  bands: TissueBand[]
}

const initialPose: ProbePose = { ...EXAM_TASKS[0].targetPose }

class AppStore extends EventTarget {
  private generationSeq = 0

  state: AppState = {
    page: 'cases',
    student: typeof localStorage === 'undefined' ? '2024001' : localStorage.getItem('ultrasound.student') ?? '2024001',
    cases: [],
    scores: [],
    recordings: [],
    volume: null,
    volumeRevision: 0,
    activeCaseId: 'synthetic-256',
    volumeLoading: false,
    volumeProgress: '',
    volumeProgressValue: 0,
    webgpuAvailable: typeof navigator !== 'undefined' && 'gpu' in navigator,
    pose: {
      position: [...initialPose.position],
      tiltX: initialPose.tiltX,
      tiltZ: initialPose.tiltZ,
      spin: initialPose.spin
    },
    params: {
      ...DEFAULT_IMAGING,
      tgc: [...DEFAULT_IMAGING.tgc]
    },
    bands: DEFAULT_TISSUE_BANDS.map((band) => ({ ...band }))
  }

  setPage(page: PageKey) {
    this.state.page = page
    this.emit()
  }

  emit() {
    this.dispatchEvent(new CustomEvent('change'))
  }

  subscribe(listener: () => void): () => void {
    this.addEventListener('change', listener)
    return () => this.removeEventListener('change', listener)
  }

  setPose(pose: ProbePose) {
    this.state.pose = pose
    this.emit()
  }

  patchPose(patch: Partial<ProbePose>) {
    this.state.pose = { ...this.state.pose, ...patch }
    this.emit()
  }

  patchParams(patch: Partial<ImagingParams>) {
    this.state.params = { ...this.state.params, ...patch }
    this.emit()
  }

  setTgc(index: number, value: number) {
    const tgc = [...this.state.params.tgc]
    tgc[index] = value
    this.patchParams({ tgc })
  }

  updateBand(id: string, patch: Partial<TissueBand>) {
    this.state.bands = this.state.bands.map((band) => (band.id === id ? { ...band, ...patch } : band))
    this.emit()
  }

  resetBands() {
    this.state.bands = DEFAULT_TISSUE_BANDS.map((band) => ({ ...band }))
    this.emit()
  }

  setVolume(volume: VolumeData, caseId?: string) {
    this.state.volume = volume
    this.state.volumeRevision++
    this.state.activeCaseId = caseId ?? volume.id ?? 'imported-case'
    this.emit()
  }

  notifyVolumePixelsChanged() {
    this.state.volumeRevision++
    this.emit()
  }

  async refreshCases() {
    this.state.cases = (await db.getAllCases()).sort((a, b) => b.createdAt - a.createdAt)
    this.emit()
  }

  async refreshScores() {
    this.state.scores = (await db.getAllScores()).sort((a, b) => b.createdAt - a.createdAt)
    this.emit()
  }

  async refreshRecordings() {
    this.state.recordings = (await db.getAllRecordings()).sort((a, b) => b.createdAt - a.createdAt)
    this.emit()
  }

  async loadPersistedStudent() {
    const student = await db.getKv<string>('student')
    if (student) {
      this.state.student = student
      localStorage.setItem('ultrasound.student', student)
    }
    this.emit()
  }

  async setStudent(student: string) {
    this.state.student = student
    localStorage.setItem('ultrasound.student', student)
    await db.setKv('student', student)
    this.emit()
  }

  async generateSynthetic(size: 192 | 256 | 384 | 512 = 256, persist = false): Promise<VolumeData> {
    const seq = ++this.generationSeq
    this.state.volumeLoading = true
    this.state.volumeProgress = `正在合成 ${size}³ 腹部 CT 体数据`
    this.state.volumeProgressValue = 0.02
    this.emit()
    try {
      const volume = await createSyntheticVolume(size, (label, progress) => {
        if (seq !== this.generationSeq) return
        this.state.volumeProgress = label
        if (typeof progress === 'number') this.state.volumeProgressValue = progress
        this.emit()
      })
      if (seq !== this.generationSeq) return volume
      this.setVolume(volume, `synthetic-${size}`)
      if (persist) {
        const record: CaseRecord = {
          id: `synthetic-abdomen-${size}`,
          name: volume.name,
          description: '程序化合成立腹部体数据：肝、双肾、胆囊、主动脉/下腔静脉、肋骨及 80mm 深强反射标定界面。',
          dims: volume.dims,
          spacing: volume.spacing,
          createdAt: Date.now(),
          builtin: true,
          hu: volume.hu.buffer.slice(volume.hu.byteOffset, volume.hu.byteOffset + volume.hu.byteLength),
          sourceFormat: 'synthetic-ct16'
        }
        await db.putCase(record)
        await this.refreshCases()
      }
      return volume
    } finally {
      if (seq === this.generationSeq) {
        this.state.volumeLoading = false
        this.state.volumeProgress = ''
        this.emit()
      }
    }
  }

  async loadCase(record: CaseRecord): Promise<VolumeData> {
    const hu = new Uint16Array(record.hu)
    const volume: VolumeData = {
      id: record.id,
      name: record.name,
      dims: record.dims,
      spacing: record.spacing,
      hu,
      synthetic: record.builtin
    }
    this.setVolume(volume, record.id)
    return volume
  }
}

export const store = new AppStore()
