import { describe, expect, it } from 'vitest'
import { Simulation, TICK_SECONDS } from '..'
import { activityCompletions, runFor, simulationWith } from './helpers'

describe('Poller capacity', () => {
  it('dispatches only one queued Activity per available Poller and Slot', () => {
    const simulation = new Simulation({
      workflowStartRate: 0,
      activitiesPerWorkflow: 1,
      workflowPollers: 4,
      workflowSlots: 4,
      activityPollers: 2,
      activitySlots: 0,
      cpuCapacity: 8,
    })
    simulation.startWorkflows(4)
    for (let tick = 0; tick < 140 && simulation.getSnapshot().activityQueue.length < 4; tick += 1) {
      simulation.step(TICK_SECONDS)
    }
    expect(simulation.getSnapshot().activityQueue).toHaveLength(4)
    runFor(simulation, 0.35)

    simulation.updateConfig({ activitySlots: 2 })
    simulation.step(TICK_SECONDS)
    const firstWave = simulation.getSnapshot()
    expect(firstWave.activityQueue).toHaveLength(2)
    expect(firstWave.tasks.filter((task) => task.type === 'activity' && task.state === 'acquired')).toHaveLength(2)
    expect(firstWave.activityPollers.filter((poller) => poller.state === 'task-received')).toHaveLength(2)
    expect(firstWave.activitySlots.filter((slot) => slot.state === 'reserved')).toHaveLength(2)
  })

  it('leaves Slots idle and limits throughput with too few Pollers', () => {
    const workload = {
      workflowStartRate: 20,
      activitiesPerWorkflow: 1,
      workflowPollers: 16,
      workflowSlots: 16,
      activitySlots: 16,
      cpuCapacity: 16,
    }
    const constrained = simulationWith({ ...workload, activityPollers: 1 })
    const expanded = simulationWith({ ...workload, activityPollers: 4 })
    runFor(constrained, 10)
    runFor(expanded, 10)
    expect(activityCompletions(expanded)).toBeGreaterThan(activityCompletions(constrained) * 1.3)
    expect(constrained.getSnapshot().activitySlots.filter((slot) => !slot.taskId).length).toBeGreaterThan(0)
  })

  it('adds a second concurrent Workflow Task retrieval after live Poller scaling', () => {
    const simulation = new Simulation({
      workflowStartRate: 0,
      activitiesPerWorkflow: 1,
      workflowPollers: 1,
      workflowSlots: 0,
      activityPollers: 1,
      activitySlots: 1,
      cpuCapacity: 8,
    })
    simulation.startWorkflows(4)
    runFor(simulation, 2.2)
    expect(simulation.getSnapshot().workflowQueue).toHaveLength(4)

    simulation.updateConfig({ workflowSlots: 4 })
    simulation.step(TICK_SECONDS)
    expect(simulation.getSnapshot().workflowPollers.filter((poller) => poller.state === 'task-received')).toHaveLength(1)

    simulation.updateConfig({ workflowPollers: 2 })
    simulation.step(TICK_SECONDS)
    const scaled = simulation.getSnapshot()
    expect(scaled.workflowQueue).toHaveLength(2)
    expect(scaled.workflowPollers.filter((poller) => poller.state === 'task-received')).toHaveLength(2)
    expect(scaled.workflowSlots.filter((slot) => slot.state === 'reserved')).toHaveLength(2)
  })

  it('spaces acquisitions so one Activity Poller owns only one Task at a time', () => {
    const simulation = new Simulation({
      workflowStartRate: 0,
      activitiesPerWorkflow: 1,
      workflowPollers: 4,
      workflowSlots: 4,
      activityPollers: 1,
      activitySlots: 4,
      cpuCapacity: 8,
    })
    simulation.startWorkflows(4)
    runFor(simulation, 7)
    const acquisitions = simulation.getEventsSince(0)
      .filter((event) => event.type === 'ACTIVITY_TASK_DISPATCH_STARTED')
    expect(acquisitions.length).toBeGreaterThanOrEqual(2)
    for (let index = 1; index < acquisitions.length; index += 1) {
      expect(acquisitions[index].timestamp - acquisitions[index - 1].timestamp).toBeGreaterThanOrEqual(0.399_999)
      expect(acquisitions[index].pollerId).toBe('activity-poller-1')
    }
  })
})
