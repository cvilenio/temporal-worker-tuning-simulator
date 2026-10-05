import { describe, expect, it } from 'vitest'
import { COMPLETION_RETURN_SECONDS, Simulation } from '..'
import { runFor } from './helpers'

describe('Workflow lifecycle', () => {
  it('waits for each completion return before scheduling dependent work', () => {
    const simulation = new Simulation({
      workflowStartRate: 0,
      activitiesPerWorkflow: 1,
      activityFanout: 1,
      workflowPollers: 1,
      workflowSlots: 1,
      activityPollers: 1,
      activitySlots: 1,
      cpuCapacity: 8,
    })
    simulation.startWorkflow()
    runFor(simulation, 12)
    const events = simulation.getEventsSince(0).filter((event) => event.workflowId === 'workflow-1')
    const initialWorkflowCompletion = events.find((event) =>
      event.type === 'WORKFLOW_TASK_COMPLETED' && event.taskId === 'workflow-task-1',
    )!
    const initialWorkflowReturn = events.find((event) =>
      event.type === 'WORKFLOW_TASK_RETURN_STARTED' && event.taskId === 'workflow-task-1',
    )!
    const activityScheduled = events.find((event) => event.type === 'ACTIVITY_TASK_SCHEDULED')!
    const activityCompletion = events.find((event) => event.type === 'ACTIVITY_TASK_COMPLETED')!
    const activityReturn = events.find((event) => event.type === 'ACTIVITY_TASK_RETURN_STARTED')!
    const finalWorkflowTask = events.find((event) =>
      event.type === 'WORKFLOW_TASK_SCHEDULED' && event.taskId !== 'workflow-task-1',
    )!

    expect(initialWorkflowCompletion.timestamp - initialWorkflowReturn.timestamp).toBeGreaterThanOrEqual(COMPLETION_RETURN_SECONDS)
    expect(activityScheduled.timestamp).toBe(initialWorkflowCompletion.timestamp)
    expect(activityCompletion.timestamp - activityReturn.timestamp).toBeGreaterThanOrEqual(COMPLETION_RETURN_SECONDS)
    expect(finalWorkflowTask.timestamp).toBe(activityCompletion.timestamp)
  })

  it('starts exactly one Workflow for each triggered request', () => {
    const simulation = new Simulation({ workflowStartRate: 0 })
    runFor(simulation, 2)
    expect(simulation.getEventsSince(0).filter((event) => event.type === 'WORKFLOW_CREATED')).toHaveLength(0)
    simulation.startWorkflow()
    simulation.startWorkflow()
    expect(simulation.getEventsSince(0).filter((event) => event.type === 'WORKFLOW_CREATED')).toHaveLength(2)
  })

  it('starts an exact triggered batch immediately', () => {
    const simulation = new Simulation({ workflowStartRate: 0 })
    simulation.startWorkflows(10)
    const events = simulation.getEventsSince(0)
    expect(events.filter((event) => event.type === 'WORKFLOW_START_REQUESTED')).toHaveLength(10)
    expect(events.filter((event) => event.type === 'WORKFLOW_CREATED')).toHaveLength(10)
    expect(simulation.getSnapshot().workflows).toHaveLength(10)
    expect(simulation.getSnapshot().simulatedTime).toBe(0)
  })

  it('schedules the initial Workflow Task only after Workflow Start arrives', () => {
    const simulation = new Simulation({ workflowStartRate: 0 })
    simulation.startWorkflow()
    expect(simulation.getEventsSince(0).some((event) => event.type === 'WORKFLOW_TASK_SCHEDULED')).toBe(false)
    runFor(simulation, 0.65)
    expect(simulation.getEventsSince(0).some((event) => event.type === 'WORKFLOW_TASK_SCHEDULED')).toBe(false)
    simulation.step(0.05)
    expect(simulation.getEventsSince(0).some((event) => event.type === 'WORKFLOW_TASK_SCHEDULED')).toBe(false)
    runFor(simulation, 0.2)
    expect(simulation.getEventsSince(0).some((event) => event.type === 'WORKFLOW_TASK_SCHEDULED')).toBe(false)
    simulation.step(0.05)
    expect(simulation.getEventsSince(0).some((event) => event.type === 'WORKFLOW_TASK_SCHEDULED')).toBe(false)
    simulation.step(0.05)
    const created = simulation.getEventsSince(0).find((event) => event.type === 'WORKFLOW_CREATED')!
    const scheduled = simulation.getEventsSince(0).find((event) => event.type === 'WORKFLOW_TASK_SCHEDULED')!
    expect(scheduled.timestamp).toBe(1)
    expect(created.timestamp).toBeLessThan(scheduled.timestamp)
  })

  it('deterministically staggers initial Tasks for a triggered Workflow batch', () => {
    const simulation = new Simulation({ workflowStartRate: 0 }, 1)
    simulation.startWorkflows(4)
    runFor(simulation, 1.5)
    const scheduledAt = simulation.getEventsSince(0)
      .filter((event) => event.type === 'WORKFLOW_TASK_SCHEDULED')
      .map((event) => event.timestamp)
    expect(scheduledAt).toHaveLength(4)
    expect(new Set(scheduledAt).size).toBe(4)
    expect(Math.max(...scheduledAt) - Math.min(...scheduledAt)).toBeGreaterThanOrEqual(0.25)
  })

  it('schedules configured Activities and one final Workflow Task', () => {
    const simulation = new Simulation({
      workflowStartRate: 0,
      activitiesPerWorkflow: 4,
      activityFanout: 4,
      workflowPollers: 2,
      activityPollers: 4,
      workflowSlots: 2,
      activitySlots: 4,
      cpuCapacity: 8,
    })
    simulation.startWorkflow()
    runFor(simulation, 22)
    const events = simulation.getEventsSince(0)
    const firstWorkflow = events.find((event) => event.type === 'WORKFLOW_CREATED')!.workflowId
    const forFirstWorkflow = events.filter((event) => event.workflowId === firstWorkflow)
    expect(forFirstWorkflow.filter((event) => event.type === 'ACTIVITY_TASK_SCHEDULED')).toHaveLength(4)
    expect(forFirstWorkflow.filter((event) => event.type === 'WORKFLOW_TASK_SCHEDULED')).toHaveLength(2)
    expect(forFirstWorkflow.filter((event) => event.type === 'WORKFLOW_COMPLETED')).toHaveLength(1)
  })

  it('completes only after the final Workflow Task completes', () => {
    const simulation = new Simulation({
      workflowStartRate: 0,
      activitiesPerWorkflow: 3,
      workflowPollers: 2,
      activityPollers: 2,
      workflowSlots: 2,
      activitySlots: 2,
      cpuCapacity: 8,
    })
    simulation.startWorkflow()
    runFor(simulation, 18)
    const events = simulation.getEventsSince(0).filter((event) => event.workflowId === 'workflow-1')
    const lastActivityCompletion = events.map((event) => event.type).lastIndexOf('ACTIVITY_TASK_COMPLETED')
    const finalWorkflowTask = [...events].reverse().find((event) => event.type === 'WORKFLOW_TASK_SCHEDULED')!
    const finalWorkflowTaskCompletion = events.findIndex((event) =>
      event.type === 'WORKFLOW_TASK_COMPLETED' && event.taskId === finalWorkflowTask.taskId,
    )
    const workflowCompletion = events.findIndex((event) => event.type === 'WORKFLOW_COMPLETED')
    expect(lastActivityCompletion).toBeLessThan(finalWorkflowTaskCompletion)
    expect(finalWorkflowTaskCompletion).toBeLessThan(workflowCompletion)
  })

  it('fans out Activities and waits for all before the final Workflow Task', () => {
    const simulation = new Simulation({
      workflowStartRate: 0,
      activitiesPerWorkflow: 3,
      activityFanout: 3,
      workflowPollers: 1,
      activityPollers: 1,
      workflowSlots: 1,
      activitySlots: 1,
      cpuCapacity: 4,
    })
    simulation.startWorkflow()
    runFor(simulation, 18)
    const events = simulation.getEventsSince(0)
      .filter((event) => event.workflowId === 'workflow-1')
      .filter((event) => event.type === 'WORKFLOW_TASK_COMPLETED' || event.type === 'ACTIVITY_TASK_COMPLETED')
      .map((event) => event.type)
    expect(events).toEqual([
      'WORKFLOW_TASK_COMPLETED',
      'ACTIVITY_TASK_COMPLETED',
      'ACTIVITY_TASK_COMPLETED',
      'ACTIVITY_TASK_COMPLETED',
      'WORKFLOW_TASK_COMPLETED',
    ])
  })

  it('spaces fanout Activity admission while preserving one scheduled batch', () => {
    const simulation = new Simulation({
      workflowStartRate: 0,
      activitiesPerWorkflow: 3,
      activityFanout: 3,
      workflowPollers: 1,
      activityPollers: 3,
      workflowSlots: 1,
      activitySlots: 3,
      cpuCapacity: 4,
    })
    simulation.startWorkflow()
    runFor(simulation, 4)
    const activities = simulation.getSnapshot().tasks
      .filter((task) => task.type === 'activity')
      .sort((left, right) => left.activityIndex - right.activityIndex)
    expect(activities).toHaveLength(3)
    expect(activities[1].enqueueStartedAt - activities[0].enqueueStartedAt).toBeCloseTo(0.15)
    expect(activities[2].enqueueStartedAt - activities[1].enqueueStartedAt).toBeCloseTo(0.15)
    expect(simulation.getEventsSince(0)
      .filter((event) => event.type === 'ACTIVITIES_SCHEDULED')).toHaveLength(1)
  })

  it('schedules configurable Activity fanout batches', () => {
    const simulation = new Simulation({
      workflowStartRate: 0,
      activitiesPerWorkflow: 5,
      activityFanout: 2,
      workflowPollers: 2,
      workflowSlots: 2,
      activityPollers: 4,
      activitySlots: 4,
      cpuCapacity: 8,
    })
    simulation.startWorkflow()
    runFor(simulation, 25)
    const events = simulation.getEventsSince(0).filter((event) => event.workflowId === 'workflow-1')
    expect(events
      .filter((event) => event.type === 'ACTIVITIES_SCHEDULED')
      .map((event) => event.activityTaskIds?.length)).toEqual([2, 2, 1])
    expect(events.filter((event) => event.type === 'WORKFLOW_TASK_SCHEDULED')).toHaveLength(4)
    expect(events.filter((event) => event.type === 'WORKFLOW_COMPLETED')).toHaveLength(1)
  })

  it('links each subsequent Task to the completed source Task and Slot', () => {
    const simulation = new Simulation({
      workflowStartRate: 1,
      activitiesPerWorkflow: 2,
      workflowPollers: 1,
      activityPollers: 1,
      workflowSlots: 1,
      activitySlots: 1,
      cpuCapacity: 4,
    })
    runFor(simulation, 5)
    const events = simulation.getEventsSince(0).filter((event) => event.workflowId === 'workflow-1')
    const scheduled = events.filter((event) =>
      event.type === 'WORKFLOW_TASK_SCHEDULED' || event.type === 'ACTIVITY_TASK_SCHEDULED',
    )
    expect(scheduled[0].sourceTaskId).toBeUndefined()
    for (const event of scheduled.slice(1)) {
      expect(event.sourceTaskId).toBeDefined()
      expect(event.sourceSlotId).toBeDefined()
      const sourceCompletion = events.find((candidate) =>
        candidate.taskId === event.sourceTaskId && candidate.type.endsWith('_TASK_COMPLETED'),
      )
      expect(sourceCompletion).toBeDefined()
    }
  })

  it('never has more than one outstanding Workflow Task per Workflow Execution', () => {
    const simulation = new Simulation({
      workflowStartRate: 3,
      activitiesPerWorkflow: 3,
      workflowPollers: 1,
      workflowSlots: 1,
      activityPollers: 4,
      activitySlots: 8,
      cpuCapacity: 8,
    })
    runFor(simulation, 10)
    const outstanding = new Map<string, number>()
    for (const event of simulation.getEventsSince(0)) {
      if (!event.workflowId) continue
      if (event.type === 'WORKFLOW_TASK_SCHEDULED') {
        const next = (outstanding.get(event.workflowId) ?? 0) + 1
        outstanding.set(event.workflowId, next)
        expect(next).toBe(1)
      }
      if (event.type === 'WORKFLOW_TASK_COMPLETED') {
        outstanding.set(event.workflowId, (outstanding.get(event.workflowId) ?? 1) - 1)
      }
    }
  })

  it('keeps Workflow Execution alive while Activities run', () => {
    const simulation = new Simulation({ workflowStartRate: 1, activitiesPerWorkflow: 4, activitySlots: 1 })
    runFor(simulation, 4.8)
    const active = simulation.getSnapshot().workflows.find((workflow) => workflow.id === 'workflow-1')
    expect(active?.state).toBe('waiting')
    expect(active?.activitiesCompleted).toBeLessThan(active!.activitiesExpected)
  })
})
