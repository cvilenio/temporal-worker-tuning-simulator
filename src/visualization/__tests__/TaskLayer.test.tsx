import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { defaultConfig, type SimulationSnapshot, type SimulationTask } from '../../simulation'
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
      workflowPollers: [],
      activityPollers: [],
      workflowSlots: [],
      activitySlots: [],
      cpuUtilization: 0,
      cpuDemand: 0,
      cpuThrottled: false,
      memoryUtilization: 0,
      ioUtilization: 0,
      ioDemand: 0,
      ioThrottled: false,
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
      slotResidenceHistory: [{ timestamp: 0, value: 0, throttled: false }],
      taskThroughputHistory: [{ timestamp: 0, total: 0, workflow: 0, activity: 0, throttled: false }],
      workflowCompletionHistory: [{ timestamp: 0, value: 0, throttled: false }],
      recentEvents: [],
    }

    const markup = renderToStaticMarkup(<svg><TaskLayer snapshot={snapshot} /></svg>)
    expect(markup).toContain('data-task-id="activity-task-1"')
    expect(markup).not.toContain('NaN')
  })
})
