import { describe, expect, it } from 'vitest'
import { Simulation, STICKY_SCHEDULE_TO_START_TIMEOUT_SECONDS, TICK_SECONDS } from '..'
import type { SimulationSnapshot, WorkflowTask } from '..'

function runUntil(
  simulation: Simulation,
  predicate: (snapshot: SimulationSnapshot) => boolean,
  maxSeconds = 40,
): SimulationSnapshot {
  for (let tick = 0; tick < Math.round(maxSeconds / TICK_SECONDS); tick += 1) {
    simulation.step(TICK_SECONDS)
    const snapshot = simulation.getSnapshot()
    if (predicate(snapshot)) return snapshot
  }
  throw new Error(`Condition not reached within ${maxSeconds} simulated seconds`)
}

describe('multi-Worker sticky Workflow routing', () => {
  it('routes shared work round-robin and keeps caches Worker-local', () => {
    const simulation = new Simulation({
      workerCount: 2,
      workflowPollers: 2,
      workflowStartRate: 0,
      activitiesPerWorkflow: 1,
      activitySlots: 0,
      cpuCapacity: 8,
    })
    simulation.startWorkflows(2)
    const snapshot = runUntil(simulation, (candidate) => candidate.workflowCache.length === 2)

    expect(snapshot.workers.map((worker) => worker.displayId)).toEqual(['A', 'B'])
    expect(snapshot.workers[0].workflowCache.map((entry) => entry.workflowId)).toEqual(['workflow-1'])
    expect(snapshot.workers[1].workflowCache.map((entry) => entry.workflowId)).toEqual(['workflow-2'])
    expect(snapshot.workflows.map((workflow) => workflow.cachedWorkerId)).toEqual(['worker-1', 'worker-2'])
    expect(snapshot.workflowPollers.map((poller) => poller.workerId)).toEqual([
      'worker-1', 'worker-1', 'worker-2', 'worker-2',
    ])
    expect(snapshot.activityPollers.map((poller) => poller.workerId)).toEqual([
      'worker-1', 'worker-1', 'worker-2', 'worker-2',
    ])
  })

  it('sends a later Workflow Task to its warm Worker for a cache hit', () => {
    const simulation = new Simulation({
      workerCount: 2,
      workflowStartRate: 0,
      activitiesPerWorkflow: 1,
      activityFanout: 1,
      cpuCapacity: 8,
    })
    simulation.startWorkflow()
    runUntil(simulation, () => simulation.getEventsSince(0).some((event) =>
      event.type === 'CACHE_HIT' && event.workflowId === 'workflow-1',
    ))
    const events = simulation.getEventsSince(0)
    const hit = events.find((event) => event.type === 'CACHE_HIT' && event.workflowId === 'workflow-1')!
    const laterTask = events.filter((event) =>
      event.type === 'WORKFLOW_TASK_SCHEDULED' && event.workflowId === 'workflow-1',
    )[1]

    expect(laterTask.preferredWorkerId).toBe('worker-1')
    expect(laterTask.routingState).toBe('sticky-wait')
    expect(hit.workerId).toBe('worker-1')
    expect(events.some((event) => event.type === 'REPLAY_STARTED' && event.taskId === hit.taskId)).toBe(false)
  })

  it('keeps one Task ID when sticky wait falls back to shared routing', () => {
    const simulation = new Simulation({
      workerCount: 2,
      workflowStartRate: 0,
      activitiesPerWorkflow: 2,
      activityFanout: 1,
      workflowSlots: 1,
      activityTaskResourceProfile: 'io',
      taskResourceProfilesLocked: false,
      activityTaskIoDemand: 1,
      cpuCapacity: 8,
    })
    simulation.startWorkflow()
    runUntil(simulation, (candidate) => candidate.workflowCache.some((entry) => entry.workflowId === 'workflow-1'))
    simulation.updateConfig({ workflowSlots: 0 })
    const waiting = runUntil(simulation, (candidate) => candidate.tasks.some((task) =>
      task.type === 'workflow'
      && task.workflowId === 'workflow-1'
      && task.routingState === 'sticky-wait'
      && task.state === 'queued',
    ))
    const stickyTask = waiting.tasks.find((task) =>
      task.type === 'workflow' && task.workflowId === 'workflow-1' && task.routingState === 'sticky-wait',
    ) as WorkflowTask
    expect(stickyTask.preferredWorkerId).toBe('worker-1')
    simulation.step(0.5)
    const stillWaiting = simulation.getSnapshot().tasks.find((task) => task.id === stickyTask.id) as WorkflowTask
    expect(stillWaiting.state).toBe('queued')
    expect(stillWaiting.routingState).toBe('sticky-wait')
    expect(stillWaiting.assignedWorkerId).toBeUndefined()

    const fallback = runUntil(simulation, () => simulation.getEventsSince(0).some((event) =>
      event.type === 'STICKY_FALLBACK' && event.taskId === stickyTask.id,
    ), STICKY_SCHEDULE_TO_START_TIMEOUT_SECONDS + 3)
    const fallbackTask = fallback.tasks.find((task) => task.id === stickyTask.id) as WorkflowTask | undefined
    const fallbackEvent = simulation.getEventsSince(0).find((event) =>
      event.type === 'STICKY_FALLBACK' && event.taskId === stickyTask.id,
    )!

    expect(fallbackEvent.routingState).toBe('shared-fallback')
    expect(fallbackTask?.routingState === 'shared-fallback' || fallbackTask === undefined).toBe(true)
    expect(fallback.workflows.find((workflow) => workflow.id === 'workflow-1')?.cachedWorkerId).toBeNull()

    simulation.updateConfig({ workflowSlots: 1 })
    const transferred = runUntil(simulation, (candidate) => candidate.workflows.find((workflow) =>
      workflow.id === 'workflow-1',
    )?.cachedWorkerId === 'worker-2')
    const events = simulation.getEventsSince(0)
    expect(events.some((event) => event.type === 'CACHE_MISS' && event.taskId === stickyTask.id && event.workerId === 'worker-2')).toBe(true)
    expect(events.some((event) => event.type === 'REPLAY_STARTED' && event.taskId === stickyTask.id && event.workerId === 'worker-2')).toBe(true)
    expect(transferred.workers[1].workflowCache.some((entry) => entry.workflowId === 'workflow-1')).toBe(true)
  })

  it('clears affinity when its Worker is removed', () => {
    const simulation = new Simulation({
      workerCount: 2,
      workflowStartRate: 0,
      activitiesPerWorkflow: 1,
      activitySlots: 0,
      cpuCapacity: 8,
    })
    simulation.startWorkflows(2)
    runUntil(simulation, (candidate) => candidate.workflows.find((workflow) =>
      workflow.id === 'workflow-2',
    )?.cachedWorkerId === 'worker-2')

    simulation.updateConfig({ workerCount: 1 })
    const snapshot = simulation.getSnapshot()

    expect(snapshot.workflows.find((workflow) => workflow.id === 'workflow-2')?.cachedWorkerId).toBeNull()
    expect(snapshot.workflowCache.some((entry) => entry.workerId === 'worker-2')).toBe(false)
    expect(snapshot.recentEvents.some((event) =>
      event.type === 'CACHE_EVICTED' && event.reason === 'WORKER_REMOVED' && event.workerId === 'worker-2',
    )).toBe(true)
  })

  it('drains a removed Worker without terminating its running Task', () => {
    const simulation = new Simulation({
      workerCount: 2,
      workflowStartRate: 0,
      activitiesPerWorkflow: 1,
      activityFanout: 1,
      activityTaskResourceProfile: 'io',
      taskResourceProfilesLocked: false,
      activityTaskIoDemand: 1,
      cpuCapacity: 8,
    })
    simulation.startWorkflows(2)
    const running = runUntil(simulation, (candidate) => candidate.tasks.some((task) =>
      task.type === 'activity' && task.assignedWorkerId === 'worker-2' && task.state === 'running',
    ))
    const drainingTask = running.tasks.find((task) =>
      task.type === 'activity' && task.assignedWorkerId === 'worker-2' && task.state === 'running',
    )!

    simulation.updateConfig({ workerCount: 1 })
    const scaledDown = simulation.getSnapshot()
    expect(scaledDown.workers.find((worker) => worker.id === 'worker-2')?.status).toBe('draining')
    expect(scaledDown.tasks.find((task) => task.id === drainingTask.id)?.state).toBe('running')

    runUntil(simulation, (candidate) => !candidate.workers.some((worker) => worker.id === 'worker-2'))
    const drained = runUntil(simulation, () => simulation.getEventsSince(0).some((event) =>
      event.type === 'ACTIVITY_TASK_COMPLETED' && event.taskId === drainingTask.id,
    ))
    expect(drained.tasks.some((task) => task.id === drainingTask.id && task.state === 'running')).toBe(false)
    expect(simulation.getEventsSince(0).some((event) =>
      event.type === 'ACTIVITY_TASK_COMPLETED' && event.taskId === drainingTask.id,
    )).toBe(true)
  })
})
