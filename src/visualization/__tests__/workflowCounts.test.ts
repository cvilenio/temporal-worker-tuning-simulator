import { describe, expect, it } from 'vitest'
import type { SimulationTask } from '../../simulation'
import { outstandingTaskCounts } from '../workflowCounts'

function task(id: string, workflowId: string): SimulationTask {
  return {
    id,
    workflowId,
    type: 'activity',
    activityIndex: 1,
    state: 'queued',
    scheduledAt: 0,
    enqueueStartedAt: 0,
    createdFrom: 'workflow-slot',
    enqueueRemaining: 0,
    dispatchRemaining: 0,
    slotDispatchRemaining: 0,
    completionReturnRemaining: 0,
    cpuWorkRemaining: 1,
    maxCpuDemand: 1,
    ioWorkRemaining: 0,
    maxIoDemand: 0,
    resourceProfile: 'cpu',
    executionPhase: 'activity',
    replayCpuWorkRemaining: 0,
    replayCpuWorkTotal: 0,
  }
}

describe('Workflow outstanding Task counts', () => {
  it('groups active Tasks by stable Workflow ID', () => {
    const counts = outstandingTaskCounts([
      task('activity-task-1', 'workflow-1'),
      task('activity-task-2', 'workflow-1'),
      task('activity-task-3', 'workflow-2'),
    ])
    expect(counts.get('workflow-1')).toBe(2)
    expect(counts.get('workflow-2')).toBe(1)
    expect(counts.get('workflow-3')).toBeUndefined()
  })
})
