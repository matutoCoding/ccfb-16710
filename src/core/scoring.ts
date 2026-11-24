import { poseAngleError, posePositionErrorMm } from './geometry'
import type { ExamTask, ProbePose } from './types'

export interface PoseScore {
  score: number
  positionErrorMm: number
  angleErrorDeg: number
  positionScore: number
  angleScore: number
  passed: boolean
}

export function scorePose(pose: ProbePose, task: ExamTask): PoseScore {
  const positionErrorMm = posePositionErrorMm(pose.position, task.targetPose.position)
  const angleErrorDeg = poseAngleError(pose, task.targetPose)
  const positionScore = Math.max(0, Math.min(100, 100 * (1 - positionErrorMm / (task.toleranceMm * 2))))
  const angleScore = Math.max(0, Math.min(100, 100 * (1 - angleErrorDeg / (task.toleranceDeg * 2))))
  const score = Math.round(positionScore * 0.48 + angleScore * 0.52)
  const passed = positionErrorMm <= task.toleranceMm && angleErrorDeg <= task.toleranceDeg && score >= 60
  return {
    score,
    positionErrorMm: Math.round(positionErrorMm * 10) / 10,
    angleErrorDeg: Math.round(angleErrorDeg * 10) / 10,
    positionScore: Math.round(positionScore),
    angleScore: Math.round(angleScore),
    passed
  }
}

export function summarizeScores(scores: Array<{ student: string; taskId: string; passed: boolean; score: number; durationSec: number }>) {
  const byStudent = new Map<string, { total: number; passed: number; scoreSum: number; durationSum: number }>()
  const byTask = new Map<string, { total: number; passed: number; scoreSum: number; durationSum: number }>()

  for (const score of scores) {
    const student = byStudent.get(score.student) ?? { total: 0, passed: 0, scoreSum: 0, durationSum: 0 }
    student.total++
    student.passed += score.passed ? 1 : 0
    student.scoreSum += score.score
    student.durationSum += score.durationSec
    byStudent.set(score.student, student)

    const task = byTask.get(score.taskId) ?? { total: 0, passed: 0, scoreSum: 0, durationSum: 0 }
    task.total++
    task.passed += score.passed ? 1 : 0
    task.scoreSum += score.score
    task.durationSum += score.durationSec
    byTask.set(score.taskId, task)
  }

  const finalize = (entry: { total: number; passed: number; scoreSum: number; durationSum: number }) => ({
    attempts: entry.total,
    correctRate: entry.total ? Math.round((entry.passed / entry.total) * 100) : 0,
    averageScore: entry.total ? Math.round(entry.scoreSum / entry.total) : 0,
    averageDurationSec: entry.total ? Math.round(entry.durationSum / entry.total) : 0
  })

  return {
    students: [...byStudent.entries()].map(([name, value]) => ({ name, ...finalize(value) })),
    tasks: [...byTask.entries()].map(([taskId, value]) => ({ taskId, ...finalize(value) }))
  }
}
