import { describe, expect, it } from 'vitest'
import {
  activityLaneY,
  compactWorkflowPoints,
  maxVisibleQueueTasks,
  pollerPoint,
  queueEgress,
  queueIngress,
  queueStoragePoint,
  resultCorePoint,
  serviceCoreBounds,
  serviceCorePoint,
  slotPoint,
  workflowPoint,
  workflowLaneY,
} from '../geometry'

function verticalCenter(points: Array<{ y: number }>): number {
  const values = points.map((point) => point.y)
  return (Math.min(...values) + Math.max(...values)) / 2
}

describe('visual lane geometry', () => {
  it('hands the Workflow Start request into the first active Workflow position', () => {
    expect(serviceCorePoint()).toEqual(workflowPoint(0))
  })

  it('keeps the completion diamond inside the Temporal Service Core', () => {
    const coreRight = serviceCoreBounds.x + serviceCoreBounds.width
    expect(coreRight - resultCorePoint().x).toBe(20)
  })

  it('keeps every Queue position on its lane centerline', () => {
    for (let index = 0; index < 24; index += 1) {
      expect(queueStoragePoint(index, workflowLaneY).y).toBe(workflowLaneY)
      expect(queueStoragePoint(index, activityLaneY).y).toBe(activityLaneY)
    }
    expect(queueIngress(workflowLaneY).y).toBe(workflowLaneY)
    expect(queueEgress(workflowLaneY).y).toBe(workflowLaneY)
  })

  it('packs the oldest queued Task closest to egress', () => {
    const egress = queueEgress(workflowLaneY)
    const oldest = queueStoragePoint(0, workflowLaneY)
    const newer = queueStoragePoint(1, workflowLaneY)
    expect(oldest.x).toBeLessThan(egress.x)
    expect(newer.x).toBeLessThan(oldest.x)
    expect(oldest.x - newer.x).toBe(12.5)
    expect(queueStoragePoint(maxVisibleQueueTasks - 1, workflowLaneY).x)
      .toBeGreaterThan(queueIngress(workflowLaneY).x)
  })

  it('compacts remaining Workflow Executions after one is removed', () => {
    const layout = compactWorkflowPoints(['workflow-1', 'workflow-3', 'workflow-4'])
    expect(layout.get('workflow-1')).toEqual({ x: 230, y: 225 })
    expect(layout.get('workflow-3')).toEqual({ x: 260, y: 225 })
    expect(layout.get('workflow-4')).toEqual({ x: 290, y: 225 })
  })

  it.each([2, 4, 8, 16, 32])('centers a %i-Slot grid around the Activity lane', (count) => {
    const points = Array.from({ length: count }, (_, index) => slotPoint(index, count, activityLaneY))
    expect(verticalCenter(points)).toBe(activityLaneY)
  })

  it.each([2, 4, 5, 8, 10])('centers a %i-Poller group around the Workflow lane', (count) => {
    const points = Array.from({ length: count }, (_, index) => pollerPoint(index, count, workflowLaneY))
    expect(verticalCenter(points)).toBe(workflowLaneY)
  })
})
