import { describe, expect, it } from 'vitest'
import { Simulation, TICK_SECONDS } from '..'
import { runFor } from './helpers'

describe('Queue admission and zero capacity', () => {
  it('admits a Task before counting or dispatching it', () => {
    const simulation = new Simulation({
      workflowStartRate: 0,
      workflowPollers: 1,
      workflowSlots: 1,
    })
    simulation.startWorkflow()
    expect(simulation.getSnapshot().tasks).toHaveLength(0)
    expect(simulation.getSnapshot().workflowQueue).toHaveLength(0)

    runFor(simulation, 1)
    expect(simulation.getSnapshot().tasks[0].state).toBe('enqueuing')

    runFor(simulation, 0.8)
    expect(simulation.getSnapshot().workflowQueue).toHaveLength(0)
    simulation.step(TICK_SECONDS)
    const admitted = simulation.getSnapshot()
    expect(admitted.tasks[0].state).toBe('queued')
    expect(admitted.workflowQueue).toEqual(['workflow-task-1'])

    runFor(simulation, 0.25)
    expect(simulation.getSnapshot().tasks[0].state).toBe('queued')
    simulation.step(TICK_SECONDS)
    expect(simulation.getSnapshot().tasks[0].state).toBe('acquired')
  })

  it('keeps queued work idle with zero Pollers and starts after restoring Pollers', () => {
    const simulation = new Simulation({
      workflowStartRate: 0,
      workflowPollers: 0,
      workflowSlots: 8,
    })
    simulation.startWorkflows(6)
    runFor(simulation, 2.6)
    expect(simulation.getSnapshot().workflowQueue).toHaveLength(6)
    expect(simulation.getSnapshot().workflowSlots.every((slot) => !slot.taskId)).toBe(true)
    expect(simulation.getEventsSince(0).filter((event) =>
      event.type === 'WORKFLOW_TASK_DISPATCH_STARTED',
    )).toHaveLength(0)

    simulation.updateConfig({ workflowPollers: 2 })
    simulation.step(TICK_SECONDS)
    expect(simulation.getSnapshot().tasks.filter((task) => task.state === 'acquired')).toHaveLength(2)
  })

  it('keeps Pollers idle with zero Slots and starts after restoring Slots', () => {
    const simulation = new Simulation({
      workflowStartRate: 0,
      workflowPollers: 8,
      workflowSlots: 0,
    })
    simulation.startWorkflows(6)
    runFor(simulation, 2.6)
    expect(simulation.getSnapshot().workflowQueue).toHaveLength(6)
    expect(simulation.getSnapshot().workflowPollers.every((poller) => poller.state === 'long-polling')).toBe(true)

    simulation.updateConfig({ workflowSlots: 4 })
    simulation.step(TICK_SECONDS)
    expect(simulation.getSnapshot().tasks.filter((task) => task.state === 'acquired')).toHaveLength(4)
  })

  it('retires dispatching Pollers after scaling to zero', () => {
    const simulation = new Simulation({
      workflowStartRate: 0,
      workflowPollers: 4,
      workflowSlots: 8,
    })
    simulation.startWorkflows(8)
    runFor(simulation, 2.6)
    expect(simulation.getSnapshot().workflowPollers.filter((poller) => poller.state === 'task-received')).toHaveLength(4)
    const queuedBeforeScaleDown = simulation.getSnapshot().workflowQueue.length
    const dispatchesBeforeScaleDown = simulation.getEventsSince(0)
      .filter((event) => event.type === 'WORKFLOW_TASK_DISPATCH_STARTED').length

    simulation.updateConfig({ workflowPollers: 0 })
    runFor(simulation, 0.5)
    const retired = simulation.getSnapshot()
    expect(retired.workflowPollers).toHaveLength(0)
    expect(retired.workflowQueue).toHaveLength(queuedBeforeScaleDown)
    expect(simulation.getEventsSince(0).filter((event) =>
      event.type === 'WORKFLOW_TASK_DISPATCH_STARTED',
    )).toHaveLength(dispatchesBeforeScaleDown)
  })
})
