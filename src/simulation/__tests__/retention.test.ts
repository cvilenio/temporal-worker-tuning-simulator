import { describe, expect, it } from 'vitest'
import { Simulation } from '..'
import {
  COMPLETED_WORKFLOW_RETENTION_SECONDS,
  MAX_METRIC_HISTORY_SAMPLES,
  MAX_RETAINED_EVENTS,
} from '../constants'
import { runFor } from './helpers'

describe('long-run retention', () => {
  it('keeps engine state bounded across a long continuous run', () => {
    const simulation = new Simulation({
      workflowStartRate: 1,
      activitiesPerWorkflow: 2,
      activityFanout: 2,
      workflowPollers: 8,
      workflowSlots: 8,
      activityPollers: 4,
      activitySlots: 8,
      cpuCapacity: 1,
      activityTaskCpuDemand: 0.05,
      activityTaskBaseDurationSeconds: 0.5,
      workflowTaskReplayLatencySeconds: 0.05,
      workflowCacheCapacity: 50,
      memoryCapacityMb: 1024,
    })
    simulation.beginTaskThroughputRound()
    simulation.startContinuousGeneration()
    const runSeconds = 900
    runFor(simulation, runSeconds)
    const snapshot = simulation.getSnapshot()

    for (const history of [
      snapshot.taskThroughputHistory,
      snapshot.taskLatencyHistory,
      snapshot.pollerBusyRatioHistory,
      snapshot.slotUtilizationHistory,
      snapshot.syncMatchRateHistory,
      snapshot.backlogHistory,
      snapshot.cpuUtilizationHistory,
      snapshot.memoryUtilizationHistory,
      snapshot.ioUtilizationHistory,
    ]) {
      expect(history.length).toBeLessThanOrEqual(MAX_METRIC_HISTORY_SAMPLES)
      expect(history.length).toBeGreaterThan(MAX_METRIC_HISTORY_SAMPLES / 2)
      expect(history[0].timestamp).toBe(0)
      expect(history.at(-1)!.timestamp).toBeGreaterThan(runSeconds - 10)
    }

    const workflowsStarted = runSeconds
    expect(snapshot.workflowQueue.length + snapshot.activityQueue.length).toBeLessThan(10)
    expect(snapshot.workflows.length).toBeLessThan(COMPLETED_WORKFLOW_RETENTION_SECONDS + 30)
    expect(snapshot.tasks.every((task) => task.state !== 'completed')).toBe(true)
    expect(snapshot.tasks.length).toBeLessThan(100)
    expect(simulation.getEventsSince(0).length).toBeLessThanOrEqual(MAX_RETAINED_EVENTS * 2)

    const distribution = snapshot.taskDistribution
    expect(distribution.workflow.completed).toBeGreaterThan(workflowsStarted * 2 * 0.95)
    expect(distribution.activity.completed).toBeGreaterThan(workflowsStarted * 2 * 0.95)
    expect(distribution.total.completed).toBe(distribution.workflow.completed + distribution.activity.completed)
    expect(distribution.total.p50Latency).toBeGreaterThan(0)
    expect(snapshot.metrics.activityScheduleToStart).toBeGreaterThan(0)
  })

  it('keeps completed Workflows visible for the retention window', () => {
    const simulation = new Simulation({ workflowStartRate: 0, activitiesPerWorkflow: 1, activityFanout: 1, cpuCapacity: 1 })
    simulation.startWorkflow()
    while (!simulation.getSnapshot().workflows.every((workflow) => workflow.state === 'completed')) simulation.step()
    runFor(simulation, COMPLETED_WORKFLOW_RETENTION_SECONDS - 1)
    expect(simulation.getSnapshot().workflows).toHaveLength(1)
    runFor(simulation, 2)
    expect(simulation.getSnapshot().workflows).toHaveLength(0)
  })
})
