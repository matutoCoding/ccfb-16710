import { CALIBRATION } from '../core/anatomy'
import { db } from '../core/db'
import { CpuUltrasoundRenderer } from '../gpu/cpu-renderer'
import { UltrasoundEngine } from '../gpu/ultrasound-engine'
import { store } from '../core/store'
import type { BenchmarkResult, CalibrationResult } from '../core/types'
import { button, h, toast } from '../ui/dom'

export function createSettingsPage(): HTMLElement {
  const studentInput = h<HTMLInputElement>('input.input', { value: store.state.student })
  studentInput.addEventListener('change', () => void store.setStudent(studentInput.value.trim() || '未命名学生'))

  const gpuStatus = h('div.status-line', { text: store.state.webgpuAvailable ? '检测到 navigator.gpu，可启动 WebGPU 计算内核。' : '当前浏览器未暴露 WebGPU。' })
  const depthResult = h('div.test-result', { text: '尚未执行深度验收。' })
  const fpsResult = h('div.test-result', { text: '尚未执行 512³ 帧率测试。' })
  const progress = h('div.settings-progress')
  const testCanvas = h<HTMLCanvasElement>('canvas.settings-test-canvas')
  let engine: UltrasoundEngine | CpuUltrasoundRenderer | null = null
  let rendererMode: 'webgpu' | 'cpu' = 'webgpu'
  let benchmarkRaf = 0

  async function ensureEngine() {
    if (engine) return engine
    try {
      engine = await UltrasoundEngine.create(testCanvas)
      rendererMode = 'webgpu'
    } catch (error) {
      console.warn('WebGPU 验收内核不可用，使用 CPU 参考内核', error)
      engine = new CpuUltrasoundRenderer(testCanvas)
      rendererMode = 'cpu'
      toast('WebGPU 不可用，已切换 CPU 参考内核；性能结果不作为 GPU 验收', 'error')
    }
    if (store.state.volume) engine.setVolume(store.state.volume)
    engine.setBands(store.state.bands)
    return engine
  }

  async function ensureVolume512() {
    if (store.state.volume?.dims[0] === 512) return store.state.volume
    return store.generateSynthetic(512, false)
  }

  const depthButton = button('执行 <0.5mm 深度验收', () => void runDepth(), 'primary')
  const benchmarkButton = button('执行 512³ / 3 秒帧率测试', () => void runBenchmark(), 'primary')

  async function runDepth() {
    depthResult.className = 'test-result is-running'
    depthResult.textContent = '正在生成/载入 512³ 标定体数据...'
    depthButton.setAttribute('disabled', 'true')
    try {
      const volume = await ensureVolume512()
      progress.textContent = '正在初始化 WebGPU 管线并回读中心声线...'
      const gpu = await ensureEngine()
      gpu.setVolume(volume)
      gpu.setBands(store.state.bands)
      gpu.setPose(structuredClone(CALIBRATION.probe))
      gpu.setParams({
        ...store.state.params,
        probe: 'linear',
        depth: 120,
        focus: 80,
        sectorAngle: 45
      })
      await new Promise((resolve) => setTimeout(resolve, 80))
      const measurement = await gpu.measureCentralReflector()
      const error = Math.abs(measurement.depthMm - CALIBRATION.expectedDepthMm)
      const result: CalibrationResult = {
        ok: error < 0.5,
        measuredDepthMm: Math.round(measurement.depthMm * 1000) / 1000,
        expectedDepthMm: CALIBRATION.expectedDepthMm,
        errorMm: Math.round(error * 1000) / 1000,
        thresholdMm: 0.5,
        peakValue: Math.round(measurement.peak * 10000) / 10000,
        renderer: rendererMode,
        message: error < 0.5 ? '通过：强反射界面深度误差小于 0.5 mm。' : '未通过：误差超过 0.5 mm。'
      }
      depthResult.className = `test-result ${result.ok ? 'is-pass' : 'is-fail'}`
      depthResult.innerHTML = `
        <strong>${result.message}</strong>
        <div>渲染内核：${rendererMode.toUpperCase()}</div>
        <div>期望深度：${result.expectedDepthMm.toFixed(1)} mm</div>
        <div>实测峰值深度：${result.measuredDepthMm.toFixed(3)} mm</div>
        <div>绝对误差：${result.errorMm.toFixed(3)} mm（阈值 0.500 mm）</div>
        <div>回波峰值：${result.peakValue}</div>`
      toast(result.message, result.ok ? 'success' : 'error')
    } catch (error) {
      depthResult.className = 'test-result is-fail'
      depthResult.textContent = error instanceof Error ? error.message : String(error)
    } finally {
      depthButton.removeAttribute('disabled')
      progress.textContent = ''
    }
  }

  async function runBenchmark() {
    fpsResult.className = 'test-result is-running'
    fpsResult.textContent = '正在准备 512³ 体数据...'
    benchmarkButton.setAttribute('disabled', 'true')
    try {
      const volume = await ensureVolume512()
      const gpu = await ensureEngine()
      gpu.setVolume(volume)
      gpu.setBands(store.state.bands)
      gpu.setPose(store.state.pose)
      gpu.setParams({ ...store.state.params, probe: 'convex', depth: 160 })
      await new Promise((resolve) => setTimeout(resolve, 150))

      let frames = 0
      const warmupUntil = performance.now() + 500
      while (performance.now() < warmupUntil) {
        gpu.renderFrame()
        await new Promise((resolve) => requestAnimationFrame(resolve))
      }

      const start = performance.now()
      await new Promise<void>((resolve) => {
        const tick = () => {
          gpu.renderFrame()
          frames++
          if (performance.now() - start < 3000) benchmarkRaf = requestAnimationFrame(tick)
          else resolve()
        }
        benchmarkRaf = requestAnimationFrame(tick)
      })
      const elapsedSec = (performance.now() - start) / 1000
      const fps = Math.round(frames / elapsedSec)
      const result: BenchmarkResult = {
        fps,
        frameMs: Math.round((1000 / fps) * 10) / 10,
        samples: frames,
        dims: volume.dims,
        renderer: rendererMode,
        ok: rendererMode === 'webgpu' && fps >= 30
      }
      const passTitle = rendererMode === 'cpu'
        ? 'CPU 参考内核结果；512³ ≥30FPS 需在 WebGPU 浏览器验收'
        : result.ok
          ? '通过：512³ 实时扫查 ≥ 30 FPS'
          : '当前设备低于 30 FPS，可降低 DPR 或使用 256³ 教学数据'
      fpsResult.className = `test-result ${result.ok ? 'is-pass' : 'is-warn'}`
      fpsResult.innerHTML = `
        <strong>${passTitle}</strong>
        <div>渲染内核：${rendererMode.toUpperCase()}</div>
        <div>平均帧率：${result.fps} FPS</div>
        <div>平均帧间隔：${result.frameMs} ms</div>
        <div>统计帧数：${result.samples}；WebGPU 声线 256 × 深度采样 1024，CPU 参考内核为降精度版本。</div>`
      toast(`帧率测试完成：${fps} FPS`, result.ok ? 'success' : 'error')
    } catch (error) {
      fpsResult.className = 'test-result is-fail'
      fpsResult.textContent = error instanceof Error ? error.message : String(error)
    } finally {
      benchmarkButton.removeAttribute('disabled')
    }
  }

  async function exportScores() {
    const scores = await db.getAllScores()
    const blob = new Blob([JSON.stringify(scores, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `ultrasound-scores-${new Date().toISOString().slice(0, 19)}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const element = h('div.page.page-settings', {}, [
    h('header.page-header', {}, [h('div', {}, [h('h1', { text: '设置与验收自检' }), h('p', { text: '学生身份、WebGPU 状态、深度精度、512³ 性能和本地数据管理。' })])]),
    h('div.settings-grid', {}, [
      h('section.panel', {}, [
        h('div.panel-title', {}, [h('h2', { text: '学生 / 教师身份' })]),
        h('label.field-row', {}, [h('span', { text: '学号或姓名' }), studentInput]),
        h('p.help', { text: '成绩和轨迹会按这个名字归档到 IndexedDB。' })
      ]),
      h('section.panel', {}, [h('div.panel-title', {}, [h('h2', { text: '运行环境' })]), gpuStatus, h('p.help', { text: '推荐桌面版 Chrome/Edge 120+；高性能显卡。WebGPU 计算着色器文件位于 src/gpu/compute-shader.ts。' })]),
      h('section.panel.acceptance-panel', {}, [
        h('div.panel-title', {}, [h('h2', { text: '验收一：深度误差 < 0.5 mm' })]),
        h('p.help', { text: `合成体数据在 y=${CALIBRATION.plate.firstFaceY} mm 处放置 HU=3000 的强反射板；标定探头声原点 y=${CALIBRATION.probe.position[1]} mm，期望声程 ${CALIBRATION.expectedDepthMm} mm。测试会回读中心声线并做抛物线亚采样。` }),
        h('div.button-row', {}, [depthButton]),
        depthResult
      ]),
      h('section.panel.acceptance-panel', {}, [
        h('div.panel-title', {}, [h('h2', { text: '验收二：512³ ≥ 30 FPS' })]),
        h('p.help', { text: '测试持续三秒，每帧执行 256 条声线、每条 1024 步的 WGSL compute dispatch 和扫描转换。' }),
        h('div.button-row', {}, [benchmarkButton]),
        fpsResult,
        h('div.settings-canvas-wrap', {}, [testCanvas])
      ]),
      h('section.panel', {}, [
        h('div.panel-title', {}, [h('h2', { text: '本地数据' })]),
        h('div.button-row', {}, [
          button('导出成绩 JSON', () => void exportScores(), 'primary'),
          button('重新载入快速 256³', () => void store.generateSynthetic(256, false), 'ghost'),
          button('清空 IndexedDB 并重载', async () => {
            if (!confirm('将删除全部病例、成绩和轨迹，确定？')) return
            indexedDB.deleteDatabase('ultrasound-training-workbench')
            location.reload()
          }, 'danger')
        ]),
        progress
      ]),
      h('section.panel', {}, [
        h('div.panel-title', {}, [h('h2', { text: '实现说明' })]),
        h('ul.help-list', {}, [
          h('li', { text: 'CT HU 使用 R16Uint 3D 纹理上传，着色器内三线性采样。' }),
          h('li', { text: '声波按阻抗差计算界面反射，累计透射、衰减和世界锁定相干散斑。' }),
          h('li', { text: '声影、后方回声增强和混响均由声能/延迟重复回波产生。' }),
          h('li', { text: '病例、成绩、录制轨迹和 KV 设置均存入 IndexedDB。' })
        ])
      ])
    ])
  ])

  ;(element as unknown as { __dispose?: () => void }).__dispose = () => {
    cancelAnimationFrame(benchmarkRaf)
    engine?.dispose()
  }
  return element
}
