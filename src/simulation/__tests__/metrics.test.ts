import { describe, expect, it } from 'vitest'
import { Simulation } from '..'
import { runFor } from './helpers'

describe('metric history', () => {
  it('records replay and overlapping resource throttling windows', () => {
    const simulation = new Simulation({
      workflowStartRate: 0,
      activitiesPerWorkflow: 1,
      workflowCacheCapacity: 0,
      cpuCapacity: 0.25,
    })
    simulation.startWorkflow()
    runFor(simulation, 12)
    const snapshot = simulation.getSnapshot()

    expect(snapshot.taskThroughputHistory.some((sample) => sample.replaying)).toBe(true)
    expect(snapshot.slotUtilizationHistory.some((sample) => sample.replaying)).toBe(true)
    expect(snapshot.taskThroughputHistory.some((sample) => sample.replaying && sample.throttled)).toBe(true)
  })

  it('retains metric samples for full simulation time and clears on reset', () => {
    const simulation = new Simulation({
      workflowStartRate: 0,
      cpuCapacity: 8,
      workflowTaskBaseDurationSeconds: 0.05,
      activityTaskBaseDurationSeconds: 0.5,
    })
    simulation.startWorkflow()
    runFor(simulation, 12)
    const throughputHistory = simulation.getSnapshot().taskThroughputHistory
    const latencyHistory = simulation.getSnapshot().taskLatencyHistory
    const pollerBusyRatioHistory = simulation.getSnapshot().pollerBusyRatioHistory
    const slotUtilizationHistory = simulation.getSnapshot().slotUtilizationHistory
    const syncMatchRateHistory = simulation.getSnapshot().syncMatchRateHistory
    const backlogHistory = simulation.getSnapshot().backlogHistory
    const cpuUtilizationHistory = simulation.getSnapshot().cpuUtilizationHistory
    const memoryUtilizationHistory = simulation.getSnapshot().memoryUtilizationHistory
    const ioUtilizationHistory = simulation.getSnapshot().ioUtilizationHistory

    expect(throughputHistory).toHaveLength(49)
    expect(throughputHistory.at(-1)?.timestamp).toBe(12)
    expect(throughputHistory.every((sample) =>
      sample.total === sample.workflow + sample.activity)).toBe(true)
    expect(throughputHistory.some((sample) => sample.workflow > 0)).toBe(true)
    expect(throughputHistory.some((sample) => sample.activity > 0)).toBe(true)
    expect(latencyHistory).toHaveLength(49)
    expect(latencyHistory.some((sample) => sample.total > 0)).toBe(true)
    expect(latencyHistory.some((sample) => sample.workflow > 0)).toBe(true)
    expect(latencyHistory.some((sample) => sample.activity > 0)).toBe(true)
    expect(pollerBusyRatioHistory).toHaveLength(49)
    expect(pollerBusyRatioHistory.some((sample) => sample.total > 0)).toBe(true)
    expect(slotUtilizationHistory).toHaveLength(49)
    expect(slotUtilizationHistory.some((sample) => sample.total > 0)).toBe(true)
    expect(syncMatchRateHistory).toHaveLength(49)
    expect(syncMatchRateHistory.some((sample) => sample.total > 0)).toBe(true)
    expect(backlogHistory).toHaveLength(49)
    expect(cpuUtilizationHistory).toHaveLength(49)
    expect(cpuUtilizationHistory.some((sample) => sample.value > 0)).toBe(true)
    expect(memoryUtilizationHistory).toHaveLength(49)
    expect(memoryUtilizationHistory[0].value).toBe(0.15)
    expect(ioUtilizationHistory).toHaveLength(49)
    expect([...cpuUtilizationHistory, ...memoryUtilizationHistory, ...ioUtilizationHistory]
      .every((sample) => sample.value >= 0 && sample.value <= 1)).toBe(true)

    simulation.reset()
    expect(simulation.getSnapshot().taskThroughputHistory).toEqual([{
      timestamp: 0,
      total: 0,
      workflow: 0,
      activity: 0,
      throttled: false,
      replaying: false,
    }])
    expect(simulation.getSnapshot().taskLatencyHistory).toEqual([{
      timestamp: 0,
      total: 0,
      workflow: 0,
      activity: 0,
      throttled: false,
      replaying: false,
    }])
    const emptyTaskTypeHistory = [{ timestamp: 0, total: 0, workflow: 0, activity: 0, throttled: false, replaying: false }]
    expect(simulation.getSnapshot().pollerBusyRatioHistory).toEqual(emptyTaskTypeHistory)
    expect(simulation.getSnapshot().slotUtilizationHistory).toEqual(emptyTaskTypeHistory)
    expect(simulation.getSnapshot().syncMatchRateHistory).toEqual(emptyTaskTypeHistory)
    expect(simulation.getSnapshot().backlogHistory).toEqual(emptyTaskTypeHistory)
    expect(simulation.getSnapshot().cpuUtilizationHistory).toEqual([{ timestamp: 0, value: 0, throttled: false, replaying: false }])
    expect(simulation.getSnapshot().memoryUtilizationHistory).toEqual([{ timestamp: 0, value: 0.15, throttled: false, replaying: false }])
    expect(simulation.getSnapshot().ioUtilizationHistory).toEqual([{ timestamp: 0, value: 0, throttled: false, replaying: false }])
  })

  it('reports queued Tasks as backlog and async matches after capacity returns', () => {
    const simulation = new Simulation({
      workflowStartRate: 0,
      activitiesPerWorkflow: 1,
      workflowPollers: 1,
      workflowSlots: 0,
    })
    simulation.startWorkflows(3)
    runFor(simulation, 3)

    const backlogged = simulation.getSnapshot()
    expect(backlogged.backlogHistory.at(-1)).toMatchObject({
      total: 3,
      workflow: 3,
      activity: 0,
    })

    simulation.updateConfig({ workflowSlots: 1 })
    runFor(simulation, 1)
    const recovering = simulation.getSnapshot()
    expect(recovering.syncMatchRateHistory.at(-1)?.workflow).toBe(0)
    expect(recovering.slotUtilizationHistory.some((sample) => sample.workflow === 1)).toBe(true)
    expect(recovering.pollerBusyRatioHistory.some((sample) => sample.workflow === 1)).toBe(true)
    for (const sample of recovering.pollerBusyRatioHistory) {
      expect(sample.total).toBe(Math.max(sample.workflow, sample.activity))
    }
    for (const sample of recovering.slotUtilizationHistory) {
      expect(sample.total).toBe(Math.max(sample.workflow, sample.activity))
    }
    for (const sample of recovering.syncMatchRateHistory) {
      expect(sample.total).toBe(Math.max(sample.workflow, sample.activity))
    }
  })

  it('marks Temporal metric samples throttled during memory pressure', () => {
    const simulation = new Simulation({
      workflowStartRate: 0,
      activitiesPerWorkflow: 1,
      workflowCacheCapacity: 4,
      workflowCacheEntryMemoryMb: 16,
      memoryCapacityMb: 64,
      workflowSlots: 4,
      workflowPollers: 4,
    })
    simulation.startWorkflows(4)
    runFor(simulation, 8)

    const snapshot = simulation.getSnapshot()
    expect(snapshot.recentEvents.some((event) =>
      event.type === 'CACHE_EVICTED' && event.reason === 'MEMORY_PRESSURE',
    )).toBe(true)
    expect(snapshot.pollerBusyRatioHistory.some((sample) => sample.throttled)).toBe(true)
    expect(snapshot.slotUtilizationHistory.some((sample) => sample.throttled)).toBe(true)
    expect(snapshot.syncMatchRateHistory.some((sample) => sample.throttled)).toBe(true)
    expect(snapshot.backlogHistory.some((sample) => sample.throttled)).toBe(true)
    expect(snapshot.memoryUtilizationHistory.some((sample) => sample.throttled)).toBe(true)
  })

  it('measures cumulative Task throughput separately for each started run', () => {
    const simulation = new Simulation({
      workflowStartRate: 0,
      activitiesPerWorkflow: 1,
      activityFanout: 1,
      cpuCapacity: 1,
    })

    simulation.beginTaskThroughputRound()
    simulation.startWorkflow()
    while (!simulation.getSnapshot().workflows.every((workflow) => workflow.state === 'completed')) {
      simulation.step()
    }
    simulation.endTaskThroughputRound()

    const firstRun = simulation.getSnapshot()
    const elapsed = firstRun.simulatedTime
    expect(firstRun.roundTaskThroughput).toMatchObject({
      roundId: 1,
      elapsedSeconds: elapsed,
      total: 3 / elapsed,
      workflow: 2 / elapsed,
      activity: 1 / elapsed,
    })
    expect(firstRun.taskDistribution.total.completed).toBe(3)
    expect(firstRun.taskDistribution.workflow.completed).toBe(2)
    expect(firstRun.taskDistribution.activity.completed).toBe(1)
    expect(firstRun.taskDistribution.total.throughput).toBeCloseTo(3 / elapsed)
    expect(firstRun.taskDistribution.total.p25Latency)
      .toBeLessThanOrEqual(firstRun.taskDistribution.total.p50Latency)
    expect(firstRun.taskDistribution.total.p50Latency)
      .toBeLessThanOrEqual(firstRun.taskDistribution.total.p75Latency)
    expect(firstRun.taskDistribution.total.p75Latency)
      .toBeLessThanOrEqual(firstRun.taskDistribution.total.p95Latency)
    expect(firstRun.taskDistribution.total.p95Latency)
      .toBeLessThanOrEqual(firstRun.taskDistribution.total.p99Latency)
    expect(firstRun.taskDistribution.total.p99Latency)
      .toBeLessThanOrEqual(firstRun.taskDistribution.total.maxLatency)

    simulation.beginTaskThroughputRound()
    const secondRun = simulation.getSnapshot()
    expect(secondRun.roundTaskThroughput).toMatchObject({
      roundId: 2,
      elapsedSeconds: 0,
      total: 0,
      workflow: 0,
      activity: 0,
    })
    expect(secondRun.taskDistribution.total.completed).toBe(0)

    simulation.reset()
    expect(simulation.getSnapshot().roundTaskThroughput).toBeNull()
    expect(simulation.getSnapshot().taskDistribution.total.completed).toBe(0)
  })
})
