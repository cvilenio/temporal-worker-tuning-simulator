import { describe, expect, it } from 'vitest'
import { TICK_SECONDS } from '..'
import { activityCompletions, runFor, simulationWith } from './helpers'

describe('Slot capacity', () => {
  it('increases throughput before CPU saturation', () => {
    const workload = {
      workflowStartRate: 20,
      activitiesPerWorkflow: 1,
      workflowPollers: 16,
      workflowSlots: 16,
      activityPollers: 16,
      cpuCapacity: 1,
      workflowTaskBaseDurationSeconds: 0.05,
      workflowTaskReplayLatencySeconds: 0.05,
      activityTaskCpuDemand: 0.05,
      activityTaskBaseDurationSeconds: 2,
      activityTaskDurationJitterPercent: 0,
    }
    const few = simulationWith({ ...workload, activitySlots: 2 })
    const many = simulationWith({ ...workload, activitySlots: 8 })
    runFor(few, 20)
    runFor(many, 20)
    expect(activityCompletions(many)).toBeGreaterThan(activityCompletions(few) * 2)
    expect(few.getSnapshot().activityQueue.length).toBeGreaterThan(0)
  })

  it('drains removed occupied Slots without terminating Tasks', () => {
    const simulation = simulationWith({ activitySlots: 8, cpuCapacity: 1 })
    for (let tick = 0; tick < 200 && simulation.getSnapshot().activitySlots.filter((slot) => slot.taskId).length <= 2; tick += 1) {
      simulation.step(TICK_SECONDS)
    }
    const runningBefore = simulation.getSnapshot().activitySlots.filter((slot) => slot.taskId).length
    simulation.updateConfig({ activitySlots: 2 })
    const afterChange = simulation.getSnapshot()
    expect(afterChange.activitySlots.filter((slot) => slot.taskId)).toHaveLength(runningBefore)
    expect(afterChange.activitySlots.filter((slot) => slot.state === 'draining').length).toBeGreaterThan(0)
    runFor(simulation, 6)
    expect(simulation.getSnapshot().activitySlots).toHaveLength(2)
  })

  it('starts no new Task while occupied Slots exceed a lowered limit', () => {
    const simulation = simulationWith({
      workflowStartRate: 0,
      activitiesPerWorkflow: 1,
      workflowPollers: 4,
      workflowSlots: 4,
      activityPollers: 4,
      activitySlots: 4,
      cpuCapacity: 1,
      activityTaskCpuDemand: 0.05,
      activityTaskBaseDurationSeconds: 3,
      activityTaskDurationJitterPercent: 50,
    })
    simulation.startWorkflows(12)
    for (let tick = 0; tick < 400 && simulation.getSnapshot().activitySlots.filter((slot) => slot.taskId).length < 4; tick += 1) {
      simulation.step(TICK_SECONDS)
    }
    expect(simulation.getSnapshot().activitySlots.filter((slot) => slot.taskId)).toHaveLength(4)

    simulation.updateConfig({ activitySlots: 2 })
    let previous = new Set(simulation.getSnapshot().activitySlots.flatMap((slot) => slot.taskId ? [slot.taskId] : []))
    let newTasksStarted = 0
    for (let tick = 0; tick < 400; tick += 1) {
      simulation.step(TICK_SECONDS)
      const current = simulation.getSnapshot().activitySlots.flatMap((slot) => slot.taskId ? [slot.taskId] : [])
      const started = current.filter((taskId) => !previous.has(taskId))
      const carriedOver = current.length - started.length
      if (started.length > 0) {
        expect(carriedOver + started.length).toBeLessThanOrEqual(2)
        newTasksStarted += started.length
      }
      previous = new Set(current)
    }
    expect(newTasksStarted).toBeGreaterThan(0)
    expect(simulation.getSnapshot().activitySlots).toHaveLength(2)
  })

  it('drains running Tasks when Activity Slots scale to zero', () => {
    const simulation = simulationWith({
      workflowStartRate: 0,
      activitiesPerWorkflow: 1,
      workflowPollers: 4,
      workflowSlots: 4,
      activityPollers: 4,
      activitySlots: 4,
      cpuCapacity: 1,
    })
    simulation.startWorkflows(4)
    for (let tick = 0; tick < 200 && simulation.getSnapshot().activitySlots.filter((slot) => slot.taskId).length < 4; tick += 1) {
      simulation.step(TICK_SECONDS)
    }
    const runningTaskIds = simulation.getSnapshot().activitySlots
      .flatMap((slot) => slot.taskId ? [slot.taskId] : [])
    expect(runningTaskIds).toHaveLength(4)

    simulation.updateConfig({ activitySlots: 0 })
    expect(simulation.getSnapshot().activitySlots).toHaveLength(4)
    expect(simulation.getSnapshot().activitySlots.every((slot) => slot.state === 'draining')).toBe(true)
    runFor(simulation, 9)
    const drained = simulation.getSnapshot()
    expect(drained.activitySlots).toHaveLength(0)
    for (const taskId of runningTaskIds) {
      expect(simulation.getEventsSince(0).some((event) =>
        event.type === 'ACTIVITY_TASK_COMPLETED' && event.taskId === taskId,
      )).toBe(true)
    }
  })
})
