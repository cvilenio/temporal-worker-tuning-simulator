import { describe, expect, it } from 'vitest'
import { COMPLETION_RETURN_SECONDS, Simulation, TICK_SECONDS } from '..'
import type { SimulationSnapshot } from '..'

function runUntil(
  simulation: Simulation,
  predicate: (snapshot: SimulationSnapshot) => boolean,
  maxSeconds = 30,
): SimulationSnapshot {
  const ticks = Math.round(maxSeconds / TICK_SECONDS)
  for (let tick = 0; tick < ticks; tick += 1) {
    simulation.step(TICK_SECONDS)
    const snapshot = simulation.getSnapshot()
    if (predicate(snapshot)) return snapshot
  }
  throw new Error(`Condition not reached within ${maxSeconds} simulated seconds`)
}

describe('Worker completion RPC semantics', () => {
  it('processes Workflow Task commands in Temporal before scheduling Activities', () => {
    const simulation = new Simulation({
      workflowStartRate: 0,
      activitiesPerWorkflow: 2,
      activityFanout: 2,
      activitySlots: 0,
      cpuCapacity: 8,
    })
    simulation.startWorkflow()
    const snapshot = runUntil(simulation, (candidate) => candidate.tasks.filter((task) =>
      task.type === 'activity',
    ).length === 2)
    const events = simulation.getEventsSince(0)
    const workflowTaskId = 'workflow-task-1'
    const returns = events.filter((event) =>
      event.type === 'WORKFLOW_TASK_RETURN_STARTED' && event.taskId === workflowTaskId,
    )
    const responses = events.filter((event) =>
      event.type === 'WORKFLOW_TASK_RESPONSE_SENT' && event.taskId === workflowTaskId,
    )
    const completions = events.filter((event) =>
      event.type === 'WORKFLOW_TASK_COMPLETED' && event.taskId === workflowTaskId,
    )
    const activities = events.filter((event) =>
      event.type === 'ACTIVITY_TASK_SCHEDULED' && event.sourceTaskId === workflowTaskId,
    )

    expect(returns).toHaveLength(1)
    expect(responses).toHaveLength(1)
    expect(responses[0].workerId).toBe('worker-1')
    expect(completions).toHaveLength(1)
    expect(activities).toHaveLength(2)
    expect(completions[0].timestamp - returns[0].timestamp).toBeGreaterThanOrEqual(COMPLETION_RETURN_SECONDS)
    expect(returns[0].id).toBeLessThan(completions[0].id)
    expect(activities.every((event) => event.id > completions[0].id)).toBe(true)
    expect(snapshot.workflowQueue).not.toContain(workflowTaskId)
    expect(snapshot.tasks.some((task) => task.id === workflowTaskId)).toBe(false)
  })

  it('records one Activity result before Temporal schedules the next Workflow Task', () => {
    const simulation = new Simulation({
      workflowStartRate: 0,
      activitiesPerWorkflow: 1,
      activityFanout: 1,
      cpuCapacity: 8,
    })
    simulation.startWorkflow()
    runUntil(simulation, () => simulation.getEventsSince(0).filter((event) =>
      event.type === 'WORKFLOW_TASK_SCHEDULED',
    ).length === 2)
    const events = simulation.getEventsSince(0)
    const activityTaskId = events.find((event) => event.type === 'ACTIVITY_TASK_SCHEDULED')!.taskId!
    const returns = events.filter((event) =>
      event.type === 'ACTIVITY_TASK_RETURN_STARTED' && event.taskId === activityTaskId,
    )
    const responses = events.filter((event) =>
      event.type === 'ACTIVITY_TASK_RESPONSE_SENT' && event.taskId === activityTaskId,
    )
    const completions = events.filter((event) =>
      event.type === 'ACTIVITY_TASK_COMPLETED' && event.taskId === activityTaskId,
    )
    const nextWorkflowTask = events.find((event) =>
      event.type === 'WORKFLOW_TASK_SCHEDULED' && event.sourceTaskId === activityTaskId,
    )!

    expect(returns).toHaveLength(1)
    expect(responses).toHaveLength(1)
    expect(completions).toHaveLength(1)
    expect(completions[0].timestamp - returns[0].timestamp).toBeGreaterThanOrEqual(COMPLETION_RETURN_SECONDS)
    expect(returns[0].id).toBeLessThan(completions[0].id)
    expect(nextWorkflowTask.id).toBeGreaterThan(completions[0].id)
    expect(events.filter((event) =>
      event.type === 'ACTIVITY_TASK_QUEUED' && event.taskId === activityTaskId,
    )).toHaveLength(1)
  })

  it('requires a Workflow Poller even when the Workflow is warm', () => {
    const simulation = new Simulation({
      workflowStartRate: 0,
      activitiesPerWorkflow: 1,
      workflowCacheCapacity: 4,
      workflowPollers: 1,
      workflowSlots: 2,
      cpuCapacity: 8,
    })
    simulation.startWorkflow()
    runUntil(simulation, (candidate) => candidate.workflowCache[0]?.workflowId === 'workflow-1')
    simulation.updateConfig({ workflowPollers: 0 })
    const snapshot = runUntil(simulation, (candidate) => candidate.workflowQueue.length === 1)
    const events = simulation.getEventsSince(0)

    expect(snapshot.workflowCache[0]?.workflowId).toBe('workflow-1')
    expect(snapshot.workflowPollers).toHaveLength(0)
    expect(snapshot.workflowSlots.every((slot) => slot.state === 'available')).toBe(true)
    expect(snapshot.workflowQueue).toHaveLength(1)
    expect(events.filter((event) => event.type === 'WORKFLOW_TASK_DISPATCH_STARTED')).toHaveLength(1)

    for (let tick = 0; tick < 40; tick += 1) simulation.step(TICK_SECONDS)
    const settled = simulation.getSnapshot()
    expect(settled.workflowQueue).toHaveLength(1)
    expect(settled.workflowSlots.every((slot) => slot.state === 'available')).toBe(true)
    expect(simulation.getEventsSince(0).filter((event) =>
      event.type === 'WORKFLOW_TASK_DISPATCH_STARTED',
    )).toHaveLength(1)
  })
})
