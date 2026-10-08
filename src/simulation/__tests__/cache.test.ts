import { describe, expect, it } from 'vitest'
import {
  ACTIVE_TASK_MEMORY_MB,
  BASE_WORKER_MEMORY_MB,
  CACHED_WORKFLOW_MEMORY_MB,
  MEMORY_PRESSURE_PULSE_SECONDS,
  Simulation,
  TICK_SECONDS,
} from '..'
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

describe('Workflow cache', () => {
  it('inserts each initial Workflow into cache immediately after replay', () => {
    const simulation = new Simulation({
      workflowStartRate: 0,
      activitiesPerWorkflow: 1,
      activitySlots: 0,
      workflowPollers: 4,
      workflowSlots: 4,
      workflowCacheCapacity: 10,
      cpuCapacity: 8,
    })
    simulation.startWorkflows(4)
    runUntil(simulation, (candidate) => candidate.workflowCache.length === 4
      && candidate.tasks.every((task) => task.type !== 'workflow'))

    const events = simulation.getEventsSince(0)
    const initialTasks = events.filter((event) => event.type === 'WORKFLOW_TASK_SCHEDULED')
    expect(initialTasks).toHaveLength(4)
    expect(events.filter((event) => event.type === 'CACHE_HIT')).toHaveLength(0)
    expect(events.filter((event) => event.type === 'CACHE_MISS')).toHaveLength(4)
    expect(events.filter((event) => event.type === 'REPLAY_STARTED')).toHaveLength(4)
    expect(events.filter((event) => event.type === 'REPLAY_COMPLETED')).toHaveLength(4)

    for (const task of initialTasks) {
      const taskEvents = events.filter((event) => event.taskId === task.taskId)
      const indexOf = (type: string) => taskEvents.findIndex((event) => event.type === type)
      expect(indexOf('WORKFLOW_TASK_STARTED')).toBeLessThan(indexOf('CACHE_MISS'))
      expect(indexOf('CACHE_MISS')).toBeLessThan(indexOf('REPLAY_STARTED'))
      expect(indexOf('REPLAY_STARTED')).toBeLessThan(indexOf('REPLAY_COMPLETED'))
      expect(indexOf('REPLAY_COMPLETED')).toBeLessThan(indexOf('WORKFLOW_TASK_COMPLETED'))
      const cacheInserted = events.find((event) =>
        event.type === 'CACHE_INSERTED' && event.workflowId === task.workflowId,
      )!
      const replayCompleted = events.find((event) =>
        event.type === 'REPLAY_COMPLETED' && event.taskId === task.taskId,
      )!
      const taskCompleted = events.find((event) =>
        event.type === 'WORKFLOW_TASK_COMPLETED' && event.taskId === task.taskId,
      )!
      expect(cacheInserted.id).toBe(replayCompleted.id + 1)
      expect(cacheInserted.timestamp).toBe(replayCompleted.timestamp)
      expect(cacheInserted.id).toBeLessThan(taskCompleted.id)
    }
  })

  it('releases the exact cache memory contribution when entries are removed', () => {
    const simulation = new Simulation({
      workflowStartRate: 0,
      activitiesPerWorkflow: 1,
      activitySlots: 0,
      workflowCacheCapacity: 4,
      cpuCapacity: 8,
    })
    simulation.startWorkflows(4)
    const full = runUntil(simulation, (candidate) => candidate.workflowCache.length === 4
      && candidate.tasks.every((task) => task.type !== 'workflow' || task.state === 'completed'))

    expect(full.memoryUsedMb).toBe(BASE_WORKER_MEMORY_MB + 4 * CACHED_WORKFLOW_MEMORY_MB)
    simulation.updateConfig({ workflowCacheCapacity: 0 })
    const empty = simulation.getSnapshot()
    expect(empty.memoryUsedMb).toBe(BASE_WORKER_MEMORY_MB)
    expect(full.memoryUsedMb - empty.memoryUsedMb).toBeCloseTo(4 * CACHED_WORKFLOW_MEMORY_MB)
  })

  it('applies live cache-entry memory changes and evicts under new pressure', () => {
    const simulation = new Simulation({
      workflowStartRate: 0,
      activitiesPerWorkflow: 1,
      activitySlots: 0,
      workflowCacheCapacity: 6,
      workflowCacheEntryMemoryMb: 4,
      memoryCapacityMb: 64,
      cpuCapacity: 8,
    })
    simulation.startWorkflows(6)
    const warm = runUntil(simulation, (candidate) => candidate.workflowCache.length === 6
      && candidate.tasks.every((task) => task.type !== 'workflow'))
    expect(warm.memoryUsedMb).toBeCloseTo(BASE_WORKER_MEMORY_MB + 6 * 4)

    simulation.updateConfig({ workflowCacheEntryMemoryMb: 8 })
    const pressured = simulation.getSnapshot()
    expect(pressured.workflowCache).toHaveLength(5)
    expect(pressured.workflowCache.every((entry) => entry.memoryMb === 8)).toBe(true)
    expect(pressured.memoryUsedMb).toBeCloseTo(BASE_WORKER_MEMORY_MB + 5 * 8)
    expect(pressured.recentEvents.some((event) =>
      event.type === 'CACHE_EVICTED' && event.reason === 'MEMORY_PRESSURE',
    )).toBe(true)

    simulation.updateConfig({ workflowCacheEntryMemoryMb: 2 })
    const reduced = simulation.getSnapshot()
    expect(reduced.workflowCache).toHaveLength(5)
    expect(reduced.workflowCache.every((entry) => entry.memoryMb === 2)).toBe(true)
    expect(reduced.memoryUsedMb).toBeCloseTo(BASE_WORKER_MEMORY_MB + 5 * 2)
  })

  it('accounts for active Task memory separately from cache memory', () => {
    const simulation = new Simulation({
      workflowStartRate: 0,
      activitiesPerWorkflow: 1,
      workflowCacheCapacity: 0,
      activityPollers: 2,
      activitySlots: 2,
      activityTaskResourceProfile: 'io',
      taskResourceProfilesLocked: false,
      activityTaskIoDemand: 1,
      cpuCapacity: 8,
    })
    simulation.startWorkflows(2)
    const running = runUntil(simulation, (candidate) => candidate.tasks.filter((task) =>
      task.type === 'activity' && task.state === 'running',
    ).length === 2)

    expect(running.workflowCache).toHaveLength(0)
    expect(running.memoryUsedMb).toBe(BASE_WORKER_MEMORY_MB + 2 * ACTIVE_TASK_MEMORY_MB)
  })

  it('releases cached Workflow memory immediately on completion', () => {
    const simulation = new Simulation({
      workflowStartRate: 0,
      activitiesPerWorkflow: 1,
      activitySlots: 0,
      workflowCacheCapacity: 4,
      cpuCapacity: 8,
    })
    simulation.startWorkflow()
    const warm = runUntil(simulation, (candidate) => candidate.workflowCache.length === 1
      && candidate.tasks.every((task) => task.type !== 'workflow' || task.state === 'completed'))
    expect(warm.memoryUsedMb).toBe(BASE_WORKER_MEMORY_MB + CACHED_WORKFLOW_MEMORY_MB)

    simulation.updateConfig({ activitySlots: 1 })
    const completed = runUntil(simulation, (candidate) => candidate.workflows[0]?.state === 'completed')
    expect(completed.workflowCache).toHaveLength(0)
    expect(completed.memoryUsedMb).toBe(BASE_WORKER_MEMORY_MB)
    expect(warm.memoryUsedMb - completed.memoryUsedMb).toBe(CACHED_WORKFLOW_MEMORY_MB)
  })

  it('keeps cache memory constant during equal-size LRU replacement', () => {
    const simulation = new Simulation({
      workflowStartRate: 0,
      activitiesPerWorkflow: 1,
      activitySlots: 0,
      workflowCacheCapacity: 4,
      cpuCapacity: 8,
    })
    simulation.startWorkflows(4)
    const before = runUntil(simulation, (candidate) => candidate.workflowCache.length === 4
      && candidate.tasks.every((task) => task.type !== 'workflow' || task.state === 'completed'))
    simulation.startWorkflow()
    const after = runUntil(simulation, (candidate) => candidate.workflowCache.some((entry) =>
      entry.workflowId === 'workflow-5')
      && candidate.tasks.every((task) => task.type !== 'workflow' || task.state === 'completed'))

    expect(after.workflowCache).toHaveLength(4)
    expect(after.memoryUsedMb).toBe(before.memoryUsedMb)
    expect(after.memoryUsedMb).toBe(BASE_WORKER_MEMORY_MB + 4 * CACHED_WORKFLOW_MEMORY_MB)
  })

  it('evicts LRU state exactly when replayed state enters a full cache', () => {
    const simulation = new Simulation({
      workflowStartRate: 0,
      activitiesPerWorkflow: 1,
      activitySlots: 0,
      workflowPollers: 2,
      workflowSlots: 2,
      workflowCacheCapacity: 1,
      cpuCapacity: 8,
    })
    simulation.startWorkflows(2)
    const snapshot = runUntil(simulation, () => simulation.getEventsSince(0).some((event) =>
      event.type === 'CACHE_EVICTED' && event.reason === 'CAPACITY',
    ))
    const events = simulation.getEventsSince(0)
    const replayCompleted = events.find((event) =>
      event.type === 'REPLAY_COMPLETED' && event.workflowId === 'workflow-2',
    )!
    const eviction = events.find((event) =>
      event.type === 'CACHE_EVICTED' && event.reason === 'CAPACITY',
    )!
    const insertion = events.find((event) =>
      event.type === 'CACHE_INSERTED' && event.workflowId === 'workflow-2',
    )!
    const incomingTask = snapshot.tasks.find((task) => task.id === replayCompleted.taskId)

    expect(eviction).toMatchObject({ workflowId: 'workflow-1', timestamp: replayCompleted.timestamp })
    expect(eviction.id).toBe(replayCompleted.id + 1)
    expect(insertion.id).toBe(eviction.id + 1)
    expect(incomingTask).toMatchObject({ state: 'running', executionPhase: 'decision' })
    expect(snapshot.workflowCache.map((entry) => entry.workflowId)).toEqual(['workflow-2'])
  })

  it('inserts warm state after replay while the Workflow Task remains in its Slot', () => {
    const simulation = new Simulation({
      workflowStartRate: 0,
      activitiesPerWorkflow: 1,
      activitySlots: 0,
      workflowCacheCapacity: 4,
      cpuCapacity: 8,
    })
    simulation.startWorkflow()
    const snapshot = runUntil(simulation, (candidate) => candidate.workflowCache.length === 1)

    expect(snapshot.workflowCache[0]).toMatchObject({
      workflowId: 'workflow-1',
      displayId: 'W1',
      workerId: 'worker-1',
      memoryMb: CACHED_WORKFLOW_MEMORY_MB,
    })
    expect(snapshot.workflows[0].cachedWorkerId).toBe('worker-1')
    const events = simulation.getEventsSince(0)
    const replayCompleted = events.find((event) => event.type === 'REPLAY_COMPLETED')!
    const cacheInserted = events.find((event) => event.type === 'CACHE_INSERTED')!
    const runningTask = snapshot.tasks.find((task) => task.id === replayCompleted.taskId)
    expect(cacheInserted.id).toBe(replayCompleted.id + 1)
    expect(cacheInserted.timestamp).toBe(replayCompleted.timestamp)
    expect(runningTask).toMatchObject({ state: 'running', executionPhase: 'decision' })
    expect(events.some((event) => event.type === 'WORKFLOW_TASK_COMPLETED')).toBe(false)
    expect(events.filter((event) => event.type === 'CACHE_INSERTED')).toHaveLength(1)
    expect(events.some((event) => event.type === 'ACTIVITY_TASK_COMPLETED')).toBe(false)
  })

  it('replays the initial cache miss, then hits warm state without another replay', () => {
    const simulation = new Simulation({
      workflowStartRate: 0,
      activitiesPerWorkflow: 1,
      workflowCacheCapacity: 4,
      cpuCapacity: 8,
    })
    simulation.startWorkflow()
    const warm = runUntil(simulation, (candidate) => candidate.workflowCache.length === 1)
    const insertedAt = warm.workflowCache[0].lastUsedAt
    const hit = runUntil(simulation, (candidate) => candidate.recentEvents.some((event) =>
      event.type === 'CACHE_HIT' && event.workflowId === 'workflow-1',
    ))
    const hitTask = hit.tasks.find((task) =>
      task.type === 'workflow' && task.workflowId === 'workflow-1' && task.cacheOutcome === 'hit',
    )

    expect(hit.workflowCache[0].lastUsedAt).toBeGreaterThan(insertedAt)
    expect(hitTask?.cacheOutcome).toBe('hit')
    expect(hitTask?.executionPhase).toBe('decision')
    expect(hit.cacheMetrics.cacheHits).toBe(1)

    const snapshot = runUntil(simulation, (candidate) => candidate.workflows[0]?.state === 'completed')
    const events = simulation.getEventsSince(0)

    expect(events.filter((event) => event.type === 'CACHE_HIT')).toHaveLength(1)
    const replayEvents = events.filter((event) => event.type === 'REPLAY_STARTED')
    const initialTask = events.find((event) =>
      event.type === 'WORKFLOW_TASK_SCHEDULED' && event.workflowId === 'workflow-1',
    )!
    expect(replayEvents).toHaveLength(1)
    expect(replayEvents[0].taskId).toBe(initialTask.taskId)
    expect(replayEvents.some((event) => event.taskId === hitTask?.id)).toBe(false)
    expect(snapshot.cacheMetrics.cacheHits).toBe(1)
    expect(snapshot.workflowCache).toHaveLength(0)
    expect(snapshot.workflows[0].cachedWorkerId).toBeNull()
  })

  it('replays every Workflow Task when cache capacity is zero', () => {
    const simulation = new Simulation({
      workflowStartRate: 0,
      activitiesPerWorkflow: 1,
      workflowCacheCapacity: 0,
      cpuCapacity: 8,
    })
    simulation.startWorkflow()
    const snapshot = runUntil(simulation, (candidate) => candidate.workflows[0]?.state === 'completed')
    const events = simulation.getEventsSince(0)

    expect(snapshot.workflowCache).toHaveLength(0)
    expect(snapshot.cacheMetrics.cacheMisses).toBe(2)
    expect(snapshot.cacheMetrics.replaysStarted).toBe(2)
    expect(snapshot.cacheMetrics.replayCpuSeconds).toBeGreaterThan(0)
    expect(events.filter((event) => event.type === 'REPLAY_STARTED')).toHaveLength(2)
    expect(events.filter((event) => event.type === 'ACTIVITY_TASK_SCHEDULED')).toHaveLength(1)
  })

  it('never retains hidden cache entries when capacity is zero', () => {
    const simulation = new Simulation({
      workflowStartRate: 0,
      activitiesPerWorkflow: 3,
      activityFanout: 1,
      workflowCacheCapacity: 0,
      cpuCapacity: 8,
    })
    simulation.startWorkflow()

    for (let tick = 0; tick < Math.round(60 / TICK_SECONDS); tick += 1) {
      simulation.step(TICK_SECONDS)
      expect(simulation.getSnapshot().workflowCache).toHaveLength(0)
      if (simulation.getSnapshot().workflows[0]?.state === 'completed') break
    }

    const events = simulation.getEventsSince(0)
    expect(simulation.getSnapshot().workflows[0]?.state).toBe('completed')
    expect(events.filter((event) => event.type === 'CACHE_INSERTED')).toHaveLength(0)
    expect(events.filter((event) => event.type === 'REPLAY_STARTED')).toHaveLength(4)
  })

  it('uses shared CPU for replay even when Workflow decisions are I/O-bound', () => {
    const simulation = new Simulation({
      workflowStartRate: 0,
      activitiesPerWorkflow: 1,
      workflowCacheCapacity: 0,
      workflowTaskResourceProfile: 'io',
      activityTaskResourceProfile: 'cpu',
      taskResourceProfilesLocked: false,
      cpuCapacity: 1,
    })
    simulation.startWorkflow()
    const snapshot = runUntil(simulation, (candidate) => candidate.tasks.some((task) =>
      task.type === 'workflow' && task.executionPhase === 'replay',
    ))

    expect(snapshot.cpuDemand).toBeGreaterThan(0)
    expect(snapshot.ioDemand).toBe(0)
  })

  it('keeps the smallest default replay visible for multiple simulation ticks', () => {
    const simulation = new Simulation({
      workflowStartRate: 0,
      activitiesPerWorkflow: 1,
      activitySlots: 0,
      workflowCacheCapacity: 0,
      cpuCapacity: 1,
    })
    simulation.startWorkflow()
    runUntil(simulation, () => simulation.getEventsSince(0).some((event) => event.type === 'REPLAY_COMPLETED'))
    const events = simulation.getEventsSince(0)
    const started = events.find((event) => event.type === 'REPLAY_STARTED')!
    const completed = events.find((event) => event.type === 'REPLAY_COMPLETED')!

    expect(started.replayCpuSeconds).toBe(0.3)
    expect(completed.timestamp - started.timestamp).toBeGreaterThanOrEqual(0.95)
  })

  it('runs configurable replay before base Workflow Task execution', () => {
    const simulation = new Simulation({
      workflowStartRate: 0,
      activitiesPerWorkflow: 1,
      activitySlots: 0,
      workflowCacheCapacity: 0,
      cpuCapacity: 1,
      workflowTaskCpuDemand: 0.25,
      workflowTaskBaseDurationSeconds: 1,
      workflowTaskDurationJitterPercent: 0,
      workflowTaskReplayLatencySeconds: 0.8,
    })
    simulation.startWorkflow()
    runUntil(simulation, () => simulation.getEventsSince(0).some((event) =>
      event.type === 'WORKFLOW_TASK_RETURN_STARTED',
    ))
    const events = simulation.getEventsSince(0)
    const replayStarted = events.find((event) => event.type === 'REPLAY_STARTED')!
    const replayCompleted = events.find((event) => event.type === 'REPLAY_COMPLETED')!
    const returnStarted = events.find((event) => event.type === 'WORKFLOW_TASK_RETURN_STARTED')!

    expect(replayStarted.replayCpuSeconds).toBe(0.24)
    expect(replayCompleted.timestamp - replayStarted.timestamp).toBeGreaterThanOrEqual(0.75)
    expect(returnStarted.timestamp - replayCompleted.timestamp).toBeGreaterThanOrEqual(1)
  })

  it('keeps replay in Workflow Slots longer under shared CPU contention', () => {
    const createSimulation = () => new Simulation({
      workflowStartRate: 0,
      activitiesPerWorkflow: 1,
      workflowCacheCapacity: 0,
      workflowPollers: 4,
      workflowSlots: 4,
      activityPollers: 4,
      activitySlots: 4,
      workflowTaskResourceProfile: 'io',
      activityTaskResourceProfile: 'io',
      taskResourceProfilesLocked: false,
      cpuCapacity: 0.25,
    })
    const isolated = createSimulation()
    isolated.startWorkflow()
    runUntil(isolated, () => isolated.getEventsSince(0).some((event) => event.type === 'REPLAY_COMPLETED'))
    const isolatedEvents = isolated.getEventsSince(0)
    const isolatedStart = isolatedEvents.find((event) => event.type === 'REPLAY_STARTED')!
    const isolatedEnd = isolatedEvents.find((event) => event.type === 'REPLAY_COMPLETED')!
    const isolatedDuration = isolatedEnd.timestamp - isolatedStart.timestamp

    const contended = createSimulation()
    contended.startWorkflows(2)
    const overlap = runUntil(contended, (candidate) => candidate.tasks.filter((task) =>
      task.type === 'workflow' && task.executionPhase === 'replay',
    ).length === 2)
    expect(overlap.cpuUtilization).toBe(1)
    expect(overlap.cpuDemand).toBe(0.6)

    runUntil(contended, () => contended.getEventsSince(0).filter((event) => event.type === 'REPLAY_COMPLETED').length === 2)
    const contendedEvents = contended.getEventsSince(0)
    const starts = new Map(contendedEvents
      .filter((event) => event.type === 'REPLAY_STARTED')
      .map((event) => [event.taskId, event.timestamp]))
    const durations = contendedEvents
      .filter((event) => event.type === 'REPLAY_COMPLETED')
      .map((event) => event.timestamp - starts.get(event.taskId)!)

    expect(Math.min(...durations)).toBeGreaterThan(isolatedDuration)
  })

  it('evicts least-recently-used entries immediately when capacity decreases', () => {
    const simulation = new Simulation({
      workflowStartRate: 0,
      activitiesPerWorkflow: 1,
      activitySlots: 0,
      workflowCacheCapacity: 3,
      cpuCapacity: 8,
    })
    for (let count = 1; count <= 3; count += 1) {
      simulation.startWorkflow()
      runUntil(simulation, (candidate) => candidate.workflowCache.length === count)
    }

    simulation.updateConfig({ workflowCacheCapacity: 2 })
    const snapshot = simulation.getSnapshot()
    expect(snapshot.workflowCache.map((entry) => entry.displayId).sort()).toEqual(['W2', 'W3'])
    expect(snapshot.workflows.find((workflow) => workflow.displayId === 'W1')?.cachedWorkerId).toBeNull()
    expect(simulation.getEventsSince(0).some((event) =>
      event.type === 'CACHE_EVICTED'
      && event.workflowId === 'workflow-1'
      && event.reason === 'CAPACITY',
    )).toBe(true)
  })

  it('touches a cache hit so the true least-recently-used entry is evicted', () => {
    const simulation = new Simulation({
      workflowStartRate: 0,
      activitiesPerWorkflow: 2,
      activityFanout: 1,
      activitySlots: 0,
      activityTaskResourceProfile: 'io',
      activityTaskIoDemand: 1,
      workflowCacheCapacity: 2,
      cpuCapacity: 8,
    })
    simulation.startWorkflow()
    runUntil(simulation, (candidate) => candidate.workflowCache.length === 1)
    simulation.startWorkflow()
    runUntil(simulation, (candidate) => candidate.workflowCache.length === 2)

    simulation.updateConfig({ activitySlots: 1 })
    runUntil(simulation, (candidate) => candidate.tasks.some((task) =>
      task.type === 'activity' && task.workflowId === 'workflow-1' && task.state === 'running',
    ))
    simulation.updateConfig({ activityPollers: 0 })
    const w1Refreshes = simulation.getEventsSince(0).filter((event) =>
      event.type === 'CACHE_REFRESHED' && event.workflowId === 'workflow-1').length
    runUntil(simulation, () => simulation.getEventsSince(0).filter((event) =>
      event.type === 'CACHE_REFRESHED' && event.workflowId === 'workflow-1').length > w1Refreshes)
    simulation.updateConfig({ activitySlots: 0 })
    simulation.startWorkflow()
    runUntil(simulation, () => simulation.getEventsSince(0).some((event) =>
      event.type === 'CACHE_EVICTED' && event.reason === 'CAPACITY',
    ))
    const snapshot = simulation.getSnapshot()

    expect(snapshot.workflowCache.map((entry) => entry.displayId).sort()).toEqual(['W1', 'W3'])
    expect(simulation.getEventsSince(0).some((event) =>
      event.type === 'CACHE_EVICTED' && event.workflowId === 'workflow-2',
    )).toBe(true)
  })

  it('evicts W3 after cache hits refresh W1 and then W2', () => {
    const simulation = new Simulation({
      workflowStartRate: 0,
      activitiesPerWorkflow: 3,
      activityFanout: 1,
      activitySlots: 0,
      workflowCacheCapacity: 3,
      cpuCapacity: 8,
    })
    simulation.startWorkflows(3)
    runUntil(simulation, (candidate) => candidate.workflowCache.length === 3)

    simulation.updateConfig({ activitySlots: 1 })
    runUntil(simulation, (candidate) => candidate.tasks.some((task) =>
      task.type === 'activity' && task.workflowId === 'workflow-1' && task.state === 'running',
    ))
    simulation.updateConfig({ activityPollers: 0 })
    runUntil(simulation, () => simulation.getEventsSince(0).some((event) =>
      event.type === 'CACHE_REFRESHED' && event.workflowId === 'workflow-1',
    ))

    simulation.updateConfig({ activityPollers: 1 })
    runUntil(simulation, (candidate) => candidate.tasks.some((task) =>
      task.type === 'activity' && task.workflowId === 'workflow-2' && task.state === 'running',
    ))
    simulation.updateConfig({ activityPollers: 0 })
    const w2Refreshes = simulation.getEventsSince(0).filter((event) =>
      event.type === 'CACHE_REFRESHED' && event.workflowId === 'workflow-2').length
    runUntil(simulation, () => simulation.getEventsSince(0).filter((event) =>
      event.type === 'CACHE_REFRESHED' && event.workflowId === 'workflow-2').length > w2Refreshes)

    simulation.updateConfig({ activityPollers: 1 })
    runUntil(simulation, (candidate) => candidate.tasks.some((task) =>
      task.type === 'activity' && task.workflowId === 'workflow-1' && task.state === 'running',
    ))
    simulation.updateConfig({ activityPollers: 0 })
    const nextW1Refreshes = simulation.getEventsSince(0).filter((event) =>
      event.type === 'CACHE_REFRESHED' && event.workflowId === 'workflow-1').length
    runUntil(simulation, () => simulation.getEventsSince(0).filter((event) =>
      event.type === 'CACHE_REFRESHED' && event.workflowId === 'workflow-1').length > nextW1Refreshes)

    simulation.updateConfig({ activitySlots: 0 })
    expect(simulation.getSnapshot().workflowCache.map((entry) => entry.workflowId)).toEqual([
      'workflow-3',
      'workflow-2',
      'workflow-1',
    ])
    simulation.startWorkflow()
    const snapshot = runUntil(simulation, (candidate) => candidate.workflowCache.some((entry) =>
      entry.workflowId === 'workflow-4',
    ))

    expect(snapshot.workflowCache.map((entry) => entry.workflowId).sort()).toEqual([
      'workflow-1',
      'workflow-2',
      'workflow-4',
    ])
    expect(simulation.getEventsSince(0).some((event) =>
      event.type === 'CACHE_EVICTED' && event.workflowId === 'workflow-3',
    )).toBe(true)
  })

  it('replays an evicted Workflow on its next Workflow Task', () => {
    const simulation = new Simulation({
      workflowStartRate: 0,
      activitiesPerWorkflow: 1,
      workflowCacheCapacity: 1,
      cpuCapacity: 8,
    })
    simulation.startWorkflows(2)
    runUntil(simulation, () => simulation.getEventsSince(0).some((event) =>
      event.type === 'CACHE_EVICTED' && event.workflowId === 'workflow-1',
    ) && simulation.getEventsSince(0).filter((event) =>
      event.type === 'REPLAY_STARTED' && event.workflowId === 'workflow-1',
    ).length >= 2)

    const events = simulation.getEventsSince(0)
    expect(events.some((event) =>
      event.type === 'CACHE_EVICTED' && event.workflowId === 'workflow-1',
    )).toBe(true)
    const workflowOneReplays = events.filter((event) =>
      event.type === 'REPLAY_STARTED' && event.workflowId === 'workflow-1',
    )
    expect(workflowOneReplays).toHaveLength(2)
    expect(events.some((event) =>
      event.type === 'CACHE_MISS' && event.taskId === workflowOneReplays[1].taskId,
    )).toBe(true)
  })

  it('rewarms an evicted Workflow immediately after replay', () => {
    const simulation = new Simulation({
      workflowStartRate: 0,
      activitiesPerWorkflow: 2,
      activityFanout: 1,
      activitySlots: 0,
      workflowCacheCapacity: 2,
      cpuCapacity: 8,
    })
    simulation.startWorkflow()
    const initiallyWarm = runUntil(simulation, (candidate) => candidate.workflowCache.some((entry) =>
      entry.workflowId === 'workflow-1'))
    const firstInsertedAt = initiallyWarm.workflowCache[0].insertedAt
    simulation.startWorkflows(2)
    runUntil(simulation, (candidate) => candidate.workflowCache.length === 2
      && candidate.workflowCache.every((entry) => entry.workflowId !== 'workflow-1'))

    simulation.updateConfig({ activitySlots: 1 })
    runUntil(simulation, (candidate) => candidate.tasks.some((task) =>
      task.type === 'activity' && task.workflowId === 'workflow-1' && task.state === 'running',
    ))
    simulation.updateConfig({ activityPollers: 0 })
    const snapshot = runUntil(simulation, (candidate) => candidate.workflowCache.at(-1)?.workflowId === 'workflow-1')
    const events = simulation.getEventsSince(0).filter((event) => event.workflowId === 'workflow-1')
    const replayStarted = events.filter((event) => event.type === 'REPLAY_STARTED')
    const replayTaskId = replayStarted.at(-1)?.taskId

    expect(replayStarted).toHaveLength(2)
    expect(events.filter((event) =>
      event.type === 'CACHE_MISS' && event.taskId === replayTaskId,
    )).toHaveLength(1)
    expect(events.filter((event) =>
      event.type === 'REPLAY_COMPLETED' && event.taskId === replayTaskId,
    )).toHaveLength(1)
    expect(snapshot.workflows.find((workflow) => workflow.id === 'workflow-1')?.cachedWorkerId).toBe('worker-1')
    const rewarmed = snapshot.workflowCache.find((entry) => entry.workflowId === 'workflow-1')!
    expect(rewarmed.insertedAt).toBeGreaterThan(firstInsertedAt)
    expect(rewarmed.lastUsedAt).toBe(rewarmed.insertedAt)

    simulation.updateConfig({ activitySlots: 0 })
    simulation.startWorkflow()
    const afterReplacement = runUntil(simulation, (candidate) => candidate.workflowCache.some((entry) =>
      entry.workflowId === 'workflow-4',
    ))
    expect(afterReplacement.workflowCache.map((entry) => entry.workflowId).sort()).toEqual([
      'workflow-1',
      'workflow-4',
    ])
  })

  it('does not schedule or complete Activities during replay itself', () => {
    const simulation = new Simulation({
      workflowStartRate: 0,
      activitiesPerWorkflow: 2,
      activityFanout: 1,
      workflowCacheCapacity: 0,
      cpuCapacity: 0.25,
    })
    simulation.startWorkflow()
    runUntil(simulation, () => simulation.getEventsSince(0).some((event) => event.type === 'REPLAY_STARTED'))
    const atReplayStart = simulation.getEventsSince(0)
    const scheduled = atReplayStart.filter((event) => event.type === 'ACTIVITY_TASK_SCHEDULED').length
    const completed = atReplayStart.filter((event) => event.type === 'ACTIVITY_TASK_COMPLETED').length

    runUntil(simulation, () => simulation.getEventsSince(0).some((event) => event.type === 'REPLAY_COMPLETED'))
    const atReplayEnd = simulation.getEventsSince(0)
    expect(atReplayEnd.filter((event) => event.type === 'ACTIVITY_TASK_SCHEDULED')).toHaveLength(scheduled)
    expect(atReplayEnd.filter((event) => event.type === 'ACTIVITY_TASK_COMPLETED')).toHaveLength(completed)
  })

  it('does not restore evicted entries when capacity or memory increases', () => {
    const simulation = new Simulation({
      workflowStartRate: 0,
      activitiesPerWorkflow: 1,
      activitySlots: 0,
      workflowCacheCapacity: 1,
      memoryCapacityMb: 128,
      cpuCapacity: 8,
    })
    simulation.startWorkflows(2)
    runUntil(simulation, (candidate) => candidate.workflowCache.length === 1
      && candidate.cacheMetrics.cacheEvictions > 0)

    const retainedWorkflowId = simulation.getSnapshot().workflowCache[0].workflowId
    simulation.updateConfig({ workflowCacheCapacity: 10, memoryCapacityMb: 256 })
    const snapshot = simulation.getSnapshot()

    expect(snapshot.workflowCache).toHaveLength(1)
    expect(snapshot.workflowCache[0].workflowId).toBe(retainedWorkflowId)
  })

  it('evicts exactly the three oldest entries on a five-to-two resize', () => {
    const simulation = new Simulation({
      workflowStartRate: 0,
      activitiesPerWorkflow: 1,
      activitySlots: 0,
      workflowCacheCapacity: 5,
      cpuCapacity: 8,
    })
    for (let count = 1; count <= 5; count += 1) {
      simulation.startWorkflow()
      runUntil(simulation, (candidate) => candidate.workflowCache.length === count)
    }
    const before = simulation.getSnapshot()

    simulation.updateConfig({ workflowCacheCapacity: 2 })
    const snapshot = simulation.getSnapshot()
    const capacityEvictions = simulation.getEventsSince(0).filter((event) =>
      event.type === 'CACHE_EVICTED' && event.reason === 'CAPACITY',
    )

    expect(capacityEvictions.map((event) => event.workflowId)).toEqual([
      'workflow-1',
      'workflow-2',
      'workflow-3',
    ])
    expect(snapshot.workflowCache.map((entry) => entry.workflowId)).toEqual(['workflow-4', 'workflow-5'])
    expect(before.memoryUsedMb - snapshot.memoryUsedMb).toBeCloseTo(3 * CACHED_WORKFLOW_MEMORY_MB)
  })

  it('removes warm state as soon as the final Workflow Task completes', () => {
    const simulation = new Simulation({
      workflowStartRate: 0,
      activitiesPerWorkflow: 1,
      workflowCacheCapacity: 4,
      cpuCapacity: 8,
    })
    simulation.startWorkflow()
    const snapshot = runUntil(simulation, (candidate) => candidate.workflows[0]?.state === 'completed')
    const events = simulation.getEventsSince(0)
    const finalTask = [...events].reverse().find((event) => event.type === 'WORKFLOW_TASK_SCHEDULED')!
    const finalTaskCompleted = events.find((event) =>
      event.type === 'WORKFLOW_TASK_COMPLETED' && event.taskId === finalTask.taskId,
    )!
    const workflowCompleted = events.find((event) => event.type === 'WORKFLOW_COMPLETED')!
    const cacheRemoved = events.find((event) =>
      event.type === 'CACHE_EVICTED'
      && event.workflowId === 'workflow-1'
      && event.reason === 'WORKFLOW_COMPLETED',
    )!

    expect(cacheRemoved.id).toBe(finalTaskCompleted.id + 1)
    expect(workflowCompleted.id).toBe(cacheRemoved.id + 1)
    expect(cacheRemoved.timestamp).toBe(finalTaskCompleted.timestamp)
    expect(snapshot.workflowCache).toHaveLength(0)
    expect(snapshot.workflows[0].cachedWorkerId).toBeNull()
  })

  it('uses more replay CPU for a larger Event History without replaying Activities', () => {
    const replayFor = (activitiesPerWorkflow: number) => {
      const simulation = new Simulation({
        workflowStartRate: 0,
        activitiesPerWorkflow,
        activityFanout: activitiesPerWorkflow,
        workflowCacheCapacity: 0,
        cpuCapacity: 8,
        activityPollers: 10,
        activitySlots: 10,
      })
      simulation.startWorkflow()
      runUntil(simulation, (candidate) => candidate.workflows[0]?.state === 'completed')
      const events = simulation.getEventsSince(0)
      return {
        replayCpu: Math.max(...events
          .filter((event) => event.type === 'REPLAY_STARTED')
          .map((event) => event.replayCpuSeconds ?? 0)),
        activities: events.filter((event) => event.type === 'ACTIVITY_TASK_SCHEDULED').length,
      }
    }

    const small = replayFor(1)
    const large = replayFor(5)
    expect(large.replayCpu).toBeGreaterThan(small.replayCpu)
    expect(small.activities).toBe(1)
    expect(large.activities).toBe(5)
  })

  it('evicts cache entries under physical memory pressure', () => {
    const simulation = new Simulation({
      workflowStartRate: 0,
      activitiesPerWorkflow: 1,
      activitySlots: 0,
      workflowCacheCapacity: 20,
      memoryCapacityMb: 64,
      cpuCapacity: 8,
    })
    simulation.startWorkflows(12)
    runUntil(simulation, () => simulation.getEventsSince(0).some((event) =>
      event.type === 'CACHE_EVICTED' && event.reason === 'MEMORY_PRESSURE',
    ))
    const snapshot = simulation.getSnapshot()

    expect(snapshot.workflowCache.length).toBeLessThan(12)
    expect(snapshot.memoryUsedMb).toBeLessThanOrEqual(64)
    expect(snapshot.cacheMetrics.cacheEvictions).toBeGreaterThan(0)
  })

  it('evicts immediately on a live memory reduction and does not resurrect on increase', () => {
    const simulation = new Simulation({
      workflowStartRate: 0,
      activitiesPerWorkflow: 1,
      activitySlots: 0,
      workflowCacheCapacity: 20,
      memoryCapacityMb: 128,
      cpuCapacity: 8,
    })
    simulation.startWorkflows(12)
    runUntil(simulation, (candidate) => candidate.workflowCache.length === 12
      && candidate.tasks.every((task) => task.type !== 'workflow' || task.state === 'completed'))

    simulation.updateConfig({ memoryCapacityMb: 64 })
    let snapshot = simulation.getSnapshot()
    expect(snapshot.workflowCache).toHaveLength(11)
    expect(snapshot.memoryPressure).toBe(true)
    expect(simulation.getEventsSince(0).filter((event) =>
      event.type === 'CACHE_EVICTED' && event.reason === 'MEMORY_PRESSURE',
    )).toHaveLength(1)

    simulation.updateConfig({ memoryCapacityMb: 128 })
    snapshot = simulation.getSnapshot()
    expect(snapshot.workflowCache).toHaveLength(11)
    expect(snapshot.workflows.every((workflow) => workflow.state !== 'completed')).toBe(true)

    simulation.step(MEMORY_PRESSURE_PULSE_SECONDS + TICK_SECONDS)
    expect(simulation.getSnapshot().memoryPressure).toBe(false)
  })

  it('does not change Activity execution semantics when cache capacity changes', () => {
    const simulation = new Simulation({
      workflowStartRate: 0,
      activitiesPerWorkflow: 1,
      workflowCacheCapacity: 0,
      activityTaskResourceProfile: 'io',
      taskResourceProfilesLocked: false,
      activityTaskIoDemand: 1,
      cpuCapacity: 8,
    })
    simulation.startWorkflow()
    const running = runUntil(simulation, (candidate) => candidate.tasks.some((task) =>
      task.type === 'activity' && task.state === 'running',
    ))
    const activity = running.tasks.find((task) => task.type === 'activity' && task.state === 'running')!
    const workBefore = activity.ioWorkRemaining

    simulation.updateConfig({ workflowCacheCapacity: 10 })
    simulation.step(TICK_SECONDS)
    const after = simulation.getSnapshot()
    const sameActivity = after.tasks.find((task) => task.id === activity.id)!

    expect(sameActivity.state).toBe('running')
    expect(sameActivity.ioWorkRemaining).toBeLessThan(workBefore)
    expect(sameActivity.executionPhase).toBe('activity')
    expect(simulation.getEventsSince(0).some((event) =>
      event.type === 'REPLAY_STARTED' && event.taskId === activity.id,
    )).toBe(false)
  })
})
