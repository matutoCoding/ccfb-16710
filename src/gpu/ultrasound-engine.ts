import { DEFAULT_TISSUE_BANDS } from '../core/anatomy'
import { degToRad, poseBasis } from '../core/geometry'
import type { ImagingParams, ProbePose, TissueBand, Vec3, VolumeData } from '../core/types'
import { COMPUTE_WGSL, LINE_COUNT, MAX_SIM_DEPTH_MM, SAMPLE_COUNT } from './compute-shader'
import { RENDER_WGSL } from './render-shader'

const COMPUTE_UNIFORM_SIZE = 256
const RENDER_UNIFORM_SIZE = 128
const LINE_BUFFER_SIZE = LINE_COUNT * SAMPLE_COUNT * 4

export class UltrasoundEngine {
  readonly canvas: HTMLCanvasElement
  device: GPUDevice
  private context: GPUCanvasContext
  private format: GPUTextureFormat
  private computePipeline: GPUComputePipeline
  private renderPipeline: GPURenderPipeline
  private computeUniform: GPUBuffer
  private renderUniform: GPUBuffer
  private lineBuffer: GPUBuffer
  private readbackBuffer: GPUBuffer
  private volumeTexture: GPUTexture | null = null
  private computeBindGroup: GPUBindGroup | null = null
  private renderBindGroup: GPUBindGroup
  private volume: VolumeData | null = null
  private pose: ProbePose
  private params: ImagingParams
  private bands: TissueBand[] = DEFAULT_TISSUE_BANDS
  private disposed = false

  private constructor(
    canvas: HTMLCanvasElement,
    device: GPUDevice,
    context: GPUCanvasContext,
    format: GPUTextureFormat
  ) {
    this.canvas = canvas
    this.device = device
    this.context = context
    this.format = format

    const computeModule = device.createShaderModule({ code: COMPUTE_WGSL, label: 'ultrasound-compute' })
    const renderModule = device.createShaderModule({ code: RENDER_WGSL, label: 'ultrasound-render' })

    this.computePipeline = device.createComputePipeline({
      label: 'ultrasound-ray-pipeline',
      layout: 'auto',
      compute: { module: computeModule, entryPoint: 'main' }
    })
    this.renderPipeline = device.createRenderPipeline({
      label: 'ultrasound-scan-converter',
      layout: 'auto',
      vertex: { module: renderModule, entryPoint: 'vertexMain' },
      fragment: { module: renderModule, entryPoint: 'fragmentMain', targets: [{ format }] },
      primitive: { topology: 'triangle-list' }
    })

    this.computeUniform = device.createBuffer({ size: COMPUTE_UNIFORM_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    this.renderUniform = device.createBuffer({ size: RENDER_UNIFORM_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    this.lineBuffer = device.createBuffer({
      size: LINE_BUFFER_SIZE,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
    })
    this.readbackBuffer = device.createBuffer({
      size: SAMPLE_COUNT * 4 * 2,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    })

    this.renderBindGroup = device.createBindGroup({
      layout: this.renderPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.renderUniform } },
        { binding: 1, resource: { buffer: this.lineBuffer } }
      ]
    })

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
  }

  static async create(canvas: HTMLCanvasElement): Promise<UltrasoundEngine> {
    if (!navigator.gpu) throw new Error('当前浏览器没有暴露 navigator.gpu，请使用最新版 Chrome/Edge 并启用 WebGPU。')
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })
    if (!adapter) throw new Error('没有可用的 WebGPU 适配器。')
    const requiredLimits: Record<string, number> = {}
    if (adapter.limits.maxTextureDimension3D >= 512) {
      requiredLimits.maxTextureDimension3D = 512
    }
    const device = await adapter.requestDevice({ requiredLimits })
    const context = canvas.getContext('webgpu') as GPUCanvasContext | null
    if (!context) throw new Error('无法创建 WebGPU Canvas 上下文。')
    const format = navigator.gpu.getPreferredCanvasFormat()
    context.configure({ device, format, alphaMode: 'opaque' })
    device.pushErrorScope('validation')
    const engine = new UltrasoundEngine(canvas, device, context, format)
    const validationError = await device.popErrorScope()
    if (validationError) throw validationError
    return engine
  }

  setBands(bands: TissueBand[]) {
    this.bands = bands
  }

  setPose(pose: ProbePose) {
    this.pose = pose
  }

  setParams(params: ImagingParams) {
    this.params = params
  }

  getVolume() {
    return this.volume
  }

  setVolume(volume: VolumeData) {
    this.volume = volume
    this.volumeTexture?.destroy()
    const [width, height, depth] = volume.dims
    this.volumeTexture = this.device.createTexture({
      label: `ct-${volume.id ?? 'volume'}`,
      dimension: '3d',
      size: { width, height, depthOrArrayLayers: depth },
      format: 'r16uint',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
    })
    this.device.queue.writeTexture(
      { texture: this.volumeTexture },
      volume.hu as Uint16Array<ArrayBuffer>,
      { bytesPerRow: width * 2, rowsPerImage: height },
      { width, height, depthOrArrayLayers: depth }
    )
    this.computeBindGroup = this.device.createBindGroup({
      layout: this.computePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.computeUniform } },
        { binding: 1, resource: this.volumeTexture.createView() },
        { binding: 2, resource: { buffer: this.lineBuffer } }
      ]
    })
  }

  updateVolumePixels() {
    if (!this.volume || !this.volumeTexture) return
    const [width, height, depth] = this.volume.dims
    this.device.queue.writeTexture(
      { texture: this.volumeTexture },
      this.volume.hu as Uint16Array<ArrayBuffer>,
      { bytesPerRow: width * 2, rowsPerImage: height },
      { width, height, depthOrArrayLayers: depth }
    )
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.25)
    const width = Math.max(2, Math.floor(this.canvas.clientWidth * dpr))
    const height = Math.max(2, Math.floor(this.canvas.clientHeight * dpr))
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width
      this.canvas.height = height
    }
  }

  private probeTypeIndex() {
    return this.params.probe === 'linear' ? 0 : this.params.probe === 'convex' ? 1 : 2
  }

  private writeUniforms() {
    if (!this.volume) return
    const basis = poseBasis(this.pose)
    const probeWidth = this.params.probe === 'linear' ? 64 : this.params.probe === 'convex' ? 58 : 20
    const curvature = this.params.probe === 'convex' ? 48 : 0
    const halfAngle = degToRad(this.params.sectorAngle / 2)

    const compute = new Float32Array(64)
    compute.set(basis.origin, 0)
    compute.set(basis.direction, 4)
    compute.set(basis.lateral, 8)
    compute.set(basis.elevational, 12)
    compute[15] = probeWidth
    compute.set(this.volume.spacing, 16)
    compute[19] = MAX_SIM_DEPTH_MM / SAMPLE_COUNT
    compute.set(this.volume.dims.map(Number) as Vec3, 20)
    compute[23] = MAX_SIM_DEPTH_MM
    compute[24] = this.probeTypeIndex()
    compute[25] = halfAngle
    compute[26] = curvature
    compute[27] = this.params.frequency

    const sorted = [...this.bands].sort((a, b) => (a.lowHu + a.highHu) / 2 - (b.lowHu + b.highHu) / 2).slice(0, 8)
    sorted.forEach((band, i) => {
      const offset = 28 + i * 4
      compute[offset] = (band.lowHu + band.highHu) / 2
      compute[offset + 1] = band.impedance
      compute[offset + 2] = band.attenuation
      compute[offset + 3] = band.scatter
    })
    this.device.queue.writeBuffer(this.computeUniform, 0, compute)

    this.resize()
    const render = new Float32Array(32)
    render[0] = this.canvas.width
    render[1] = this.canvas.height
    render[2] = this.params.depth
    render[3] = MAX_SIM_DEPTH_MM
    render[4] = this.probeTypeIndex()
    render[5] = halfAngle
    render[6] = curvature
    render[7] = probeWidth
    render[8] = this.params.gain
    render[9] = this.params.focus
    render[10] = this.params.dynamicRange
    render[11] = this.params.speckle
    this.params.tgc.slice(0, 8).forEach((v, i) => {
      render[12 + i] = v
    })
    this.device.queue.writeBuffer(this.renderUniform, 0, render)
  }

  renderFrame() {
    if (this.disposed || !this.volume || !this.computeBindGroup) return
    this.writeUniforms()
    const encoder = this.device.createCommandEncoder({ label: 'ultrasound-frame' })
    const computePass = encoder.beginComputePass()
    computePass.setPipeline(this.computePipeline)
    computePass.setBindGroup(0, this.computeBindGroup)
    computePass.dispatchWorkgroups(Math.ceil(LINE_COUNT / 16))
    computePass.end()

    const view = this.context.getCurrentTexture().createView()
    const renderPass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view,
          clearValue: { r: 0.01, g: 0.012, b: 0.016, a: 1 },
          loadOp: 'clear',
          storeOp: 'store'
        }
      ]
    })
    renderPass.setPipeline(this.renderPipeline)
    renderPass.setBindGroup(0, this.renderBindGroup)
    renderPass.draw(3)
    renderPass.end()
    this.device.queue.submit([encoder.finish()])
  }

  async measureCentralReflector(): Promise<{ depthMm: number; peak: number; samples: Float32Array }> {
    if (!this.volume || !this.computeBindGroup) throw new Error('体数据尚未加载')
    this.writeUniforms()
    const encoder = this.device.createCommandEncoder()
    const pass = encoder.beginComputePass()
    pass.setPipeline(this.computePipeline)
    pass.setBindGroup(0, this.computeBindGroup)
    pass.dispatchWorkgroups(Math.ceil(LINE_COUNT / 16))
    pass.end()
    const rowBytes = SAMPLE_COUNT * 4
    encoder.copyBufferToBuffer(this.lineBuffer, 127 * rowBytes, this.readbackBuffer, 0, rowBytes)
    encoder.copyBufferToBuffer(this.lineBuffer, 128 * rowBytes, this.readbackBuffer, rowBytes, rowBytes)
    this.device.queue.submit([encoder.finish()])

    await this.readbackBuffer.mapAsync(GPUMapMode.READ)
    const copy = new Float32Array(this.readbackBuffer.getMappedRange().slice(0))
    this.readbackBuffer.unmap()
    const a = copy.slice(0, SAMPLE_COUNT)
    const b = copy.slice(SAMPLE_COUNT, SAMPLE_COUNT * 2)
    const avg = new Float32Array(SAMPLE_COUNT)
    for (let i = 0; i < SAMPLE_COUNT; i++) avg[i] = (a[i] + b[i]) * 0.5

    let peakIndex = 20
    let peak = 0
    for (let i = 20; i < SAMPLE_COUNT - 8; i++) {
      if (avg[i] > peak) {
        peak = avg[i]
        peakIndex = i
      }
    }
    const y0 = avg[Math.max(0, peakIndex - 1)]
    const y1 = avg[peakIndex]
    const y2 = avg[Math.min(SAMPLE_COUNT - 1, peakIndex + 1)]
    const denominator = y0 - 2 * y1 + y2
    let shift = 0
    if (Math.abs(denominator) > 1e-12) shift = Math.max(-1, Math.min(1, 0.5 * (y0 - y2) / denominator))
    const step = MAX_SIM_DEPTH_MM / SAMPLE_COUNT
    const depthMm = (peakIndex + shift + 0.5) * step
    return { depthMm, peak, samples: avg }
  }

  dispose() {
    this.disposed = true
    this.volumeTexture?.destroy()
    this.computeUniform.destroy()
    this.renderUniform.destroy()
    this.lineBuffer.destroy()
    this.readbackBuffer.destroy()
  }
}
