import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Simulation, defaultConfig, type SimulationSnapshot, type SimulationTask } from '../../simulation'
import { TaskLayer } from '../TaskLayer'

describe('TaskLayer', () => {
  it('renders enqueuing Tasks created before enqueue staggering was added', () => {
    const legacyTask = {
      id: 'activity-task-1',
      workflowId: 'workflow-1',
      type: 'activity',
      activityIndex: 1,
      state: 'enqueuing',
      scheduledAt: 0,
      createdFrom: 'workflow-slot',
      enqueueRemaining: 0.7,
      dispatchRemaining: 0,
      slotDispatchRemaining: 0,
      cpuWorkRemaining: 0.5,
      maxCpuDemand: 1,
      ioWorkRemaining: 0,
      maxIoDemand: 0,
      resourceProfile: 'cpu',
    } as SimulationTask
    const snapshot: SimulationSnapshot = {
      simulatedTime: 0.2,
      config: defaultConfig,
      workflows: [],
      tasks: [legacyTask],
    workflowQueue: [],
    activityQueue: [],
    workers: [],
      workflowPollers: [],
      activityPollers: [],
      workflowSlots: [],
      activitySlots: [],
      cpuUtilization: 0,
      cpuDemand: 0,
      cpuThrottled: false,
      memoryUtilization: 0,
      memoryUsedMb: 64,
      memoryPressure: false,
      ioUtilization: 0,
      ioDemand: 0,
      ioThrottled: false,
      workflowCache: [],
      cacheMetrics: {
        cacheSize: 0,
        cacheCapacity: defaultConfig.workflowCacheCapacity,
        cacheHits: 0,
        cacheMisses: 0,
        cacheEvictions: 0,
        cacheHitRate: 0,
        replaysStarted: 0,
        replayCpuSeconds: 0,
      },
      metrics: {
        activityThroughput: 0,
        totalTaskThroughput: 0,
        workflowTaskThroughput: 0,
        activityTaskThroughput: 0,
        workflowCompletions: 0,
        slotResidenceSeconds: 0,
        workflowScheduleToStart: 0,
        activityScheduleToStart: 0,
      },
      taskThroughputHistory: [{ timestamp: 0, total: 0, workflow: 0, activity: 0, throttled: false, replaying: false }],
      taskLatencyHistory: [{ timestamp: 0, total: 0, workflow: 0, activity: 0, throttled: false, replaying: false }],
      taskDistribution: {
        total: { completed: 0, throughput: 0, averageLatency: 0, p25Latency: 0, p50Latency: 0, p75Latency: 0, p95Latency: 0, p99Latency: 0, maxLatency: 0 },
        workflow: { completed: 0, throughput: 0, averageLatency: 0, p25Latency: 0, p50Latency: 0, p75Latency: 0, p95Latency: 0, p99Latency: 0, maxLatency: 0 },
        activity: { completed: 0, throughput: 0, averageLatency: 0, p25Latency: 0, p50Latency: 0, p75Latency: 0, p95Latency: 0, p99Latency: 0, maxLatency: 0 },
      },
      roundTaskThroughput: null,
      pollerBusyRatioHistory: [{ timestamp: 0, total: 0, workflow: 0, activity: 0, throttled: false, replaying: false }],
      slotUtilizationHistory: [{ timestamp: 0, total: 0, workflow: 0, activity: 0, throttled: false, replaying: false }],
      syncMatchRateHistory: [{ timestamp: 0, total: 0, workflow: 0, activity: 0, throttled: false, replaying: false }],
      backlogHistory: [{ timestamp: 0, total: 0, workflow: 0, activity: 0, throttled: false, replaying: false }],
      cpuUtilizationHistory: [{ timestamp: 0, value: 0, throttled: false, replaying: false }],
      memoryUtilizationHistory: [{ timestamp: 0, value: 0.15, throttled: false, replaying: false }],
      ioUtilizationHistory: [{ timestamp: 0, value: 0, throttled: false, replaying: false }],
      recentEvents: [],
    }

    const markup = renderToStaticMarkup(<svg><TaskLayer snapshot={snapshot} /></svg>)
    expect(markup).toContain('data-task-id="activity-task-1"')
    expect(markup).not.toContain('NaN')
  })

  it('interpolates Task movement between fixed simulation ticks', () => {
    const simulation = new Simulation({ workflowStartRate: 0 })
    simulation.startWorkflow()
    let snapshot = simulation.getSnapshot()
    for (let tick = 0; tick < 100; tick += 1) {
      simulation.step()
      snapshot = simulation.getSnapshot()
      if (snapshot.tasks.some((task) =>
        task.id === 'workflow-task-1'
        && task.state === 'enqueuing'
        && snapshot.simulatedTime >= task.enqueueStartedAt,
      )) break
    }
    const tickTimeMs = snapshot.simulatedTime * 1_000

    const positionAt = (nowMs: number) => {
      const markup = renderToStaticMarkup(<svg><TaskLayer snapshot={snapshot} nowMs={nowMs} /></svg>)
      return Number(markup.match(/data-task-id="workflow-task-1"[^>]* x="([^"]+)"/)?.[1])
    }

    expect(positionAt(tickTimeMs + 25)).toBeGreaterThan(positionAt(tickTimeMs))
  })
})
