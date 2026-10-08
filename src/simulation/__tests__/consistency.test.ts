import { describe, expect, it } from 'vitest'
import { Simulation, TICK_SECONDS } from '..'
import { runFor } from './helpers'

describe('Task state consistency', () => {
  it('keeps Poller and Slot state tied to one assigned Task lifecycle', () => {
    const simulation = new Simulation({
      workflowStartRate: 0,
      activitiesPerWorkflow: 1,
      workflowPollers: 2,
      workflowSlots: 2,
      activityPollers: 2,
      activitySlots: 2,
      cpuCapacity: 2,
    })
    simulation.startWorkflows(4)

    for (let tick = 0; tick < 140; tick += 1) {
      simulation.step(TICK_SECONDS)
      const snapshot = simulation.getSnapshot()
      const tasks = new Map(snapshot.tasks.map((task) => [task.id, task]))

      for (const poller of [...snapshot.workflowPollers, ...snapshot.activityPollers]) {
        if (poller.state === 'long-polling') {
          expect(poller.taskId).toBeUndefined()
        } else {
          expect(tasks.get(poller.taskId!)?.state).toBe('acquired')
          expect(tasks.get(poller.taskId!)?.assignedPollerId).toBe(poller.id)
        }
      }

      for (const slot of [...snapshot.workflowSlots, ...snapshot.activitySlots]) {
        if (!slot.taskId) continue
        const task = tasks.get(slot.taskId)
        expect(task?.assignedSlotId).toBe(slot.id)
        if (slot.state === 'reserved') expect(['acquired', 'dispatching']).toContain(task?.state)
        if (slot.state === 'occupied') expect(task?.state).toBe('running')
      }
    }
  })

  it('emits acquisition, Slot dispatch, running, and completion in order', () => {
    const simulation = new Simulation({
      workflowStartRate: 0,
      activitiesPerWorkflow: 1,
      workflowTaskBaseDurationSeconds: 0.05,
      activityTaskBaseDurationSeconds: 0.5,
    })
    simulation.startWorkflow()
    for (let tick = 0; tick < 200; tick += 1) {
      simulation.step(TICK_SECONDS)
      if (simulation.getEventsSince(0).some((event) =>
        event.type === 'WORKFLOW_TASK_COMPLETED' && event.taskId === 'workflow-task-1',
      )) break
    }
    const events = simulation.getEventsSince(0)
    const types = events
      .filter((event) => event.taskId === 'workflow-task-1')
      .map((event) => event.type)
    expect(types.indexOf('WORKFLOW_TASK_DISPATCH_STARTED')).toBeLessThan(types.indexOf('WORKFLOW_TASK_SLOT_DISPATCH_STARTED'))
    expect(types.indexOf('WORKFLOW_TASK_SLOT_DISPATCH_STARTED')).toBeLessThan(types.indexOf('WORKFLOW_TASK_STARTED'))
    expect(types.indexOf('WORKFLOW_TASK_STARTED')).toBeLessThan(types.indexOf('WORKFLOW_TASK_RETURN_STARTED'))
    expect(types.indexOf('WORKFLOW_TASK_RETURN_STARTED')).toBeLessThan(types.indexOf('WORKFLOW_TASK_COMPLETED'))
  })

  it('creates no Activities or Worker execution with zero Workflow Pollers', () => {
    const simulation = new Simulation({
      workflowStartRate: 0,
      workflowPollers: 0,
      workflowSlots: 8,
      activityPollers: 0,
      activitySlots: 8,
    })
    simulation.startWorkflows(10)
    runFor(simulation, 4)
    const snapshot = simulation.getSnapshot()
    expect(snapshot.workflowQueue).toHaveLength(10)
    expect(snapshot.activityQueue).toHaveLength(0)
    expect(snapshot.workflowSlots.every((slot) => !slot.taskId)).toBe(true)
    expect(snapshot.activitySlots.every((slot) => !slot.taskId)).toBe(true)
    expect(snapshot.cpuUtilization).toBe(0)
    expect(simulation.getEventsSince(0).some((event) => event.type === 'ACTIVITY_TASK_SCHEDULED')).toBe(false)
  })

  it('stops at the Activity Queue with zero Activity Pollers', () => {
    const simulation = new Simulation({
      workflowStartRate: 0,
      activitiesPerWorkflow: 1,
      workflowPollers: 4,
      workflowSlots: 4,
      activityPollers: 0,
      activitySlots: 4,
      cpuCapacity: 8,
    })
    simulation.startWorkflows(4)
    for (let tick = 0; tick < 200; tick += 1) {
      simulation.step()
      if (simulation.getSnapshot().activityQueue.length === 4) break
    }
    const snapshot = simulation.getSnapshot()
    expect(snapshot.activityQueue).toHaveLength(4)
    expect(snapshot.activitySlots.every((slot) => !slot.taskId)).toBe(true)
    expect(simulation.getEventsSince(0).some((event) => event.type === 'ACTIVITY_TASK_COMPLETED')).toBe(false)
  })
})
