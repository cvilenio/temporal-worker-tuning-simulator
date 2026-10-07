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

    expect(snapshot.slotResidenceHistory.some((sample) => sample.replaying)).toBe(true)
    expect(snapshot.taskThroughputHistory.some((sample) => sample.replaying)).toBe(true)
    expect(snapshot.workflowCompletionHistory.some((sample) => sample.replaying)).toBe(true)
    expect(snapshot.slotResidenceHistory.some((sample) => sample.replaying && sample.throttled)).toBe(true)
  })

  it('retains Slot residence samples for full simulation time and clears on reset', () => {
    const simulation = new Simulation({ workflowStartRate: 0, cpuCapacity: 8 })
    simulation.startWorkflow()
    runFor(simulation, 12)
    const history = simulation.getSnapshot().slotResidenceHistory
    const throughputHistory = simulation.getSnapshot().taskThroughputHistory
    const workflowCompletionHistory = simulation.getSnapshot().workflowCompletionHistory

    expect(history).toHaveLength(49)
    expect(history[0]).toEqual({ timestamp: 0, value: 0, throttled: false, replaying: false })
    expect(history.at(-1)?.timestamp).toBe(12)
    expect(history.some((sample) => sample.value > 0)).toBe(true)
    expect(throughputHistory).toHaveLength(49)
    expect(throughputHistory.every((sample) =>
      sample.total === sample.workflow + sample.activity)).toBe(true)
    expect(throughputHistory.some((sample) => sample.workflow > 0)).toBe(true)
    expect(throughputHistory.some((sample) => sample.activity > 0)).toBe(true)
    expect(workflowCompletionHistory).toHaveLength(49)
    expect(workflowCompletionHistory.at(-1)?.timestamp).toBe(12)
    expect(workflowCompletionHistory.some((sample) => sample.value > 0)).toBe(true)

    simulation.reset()
    expect(simulation.getSnapshot().slotResidenceHistory).toEqual([{ timestamp: 0, value: 0, throttled: false, replaying: false }])
    expect(simulation.getSnapshot().taskThroughputHistory).toEqual([{
      timestamp: 0,
      total: 0,
      workflow: 0,
      activity: 0,
      throttled: false,
      replaying: false,
    }])
    expect(simulation.getSnapshot().workflowCompletionHistory).toEqual([{ timestamp: 0, value: 0, throttled: false, replaying: false }])
  })
})
