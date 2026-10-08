import { describe, expect, it } from 'vitest'
import { Simulation, defaultConfig } from '..'
import { runFor } from './helpers'

describe('Task base execution duration', () => {
  it('uses longer Activity Tasks than Workflow Tasks by default', () => {
    expect(defaultConfig.workflowTaskBaseDurationSeconds).toBe(0.25)
    expect(defaultConfig.activityTaskBaseDurationSeconds).toBe(2)
    expect(defaultConfig.workflowTaskDurationJitterPercent).toBe(25)
    expect(defaultConfig.activityTaskDurationJitterPercent).toBe(25)
  })

  it('scales Activity Slot execution time independently of demand', () => {
    const executionDuration = (activityTaskBaseDurationSeconds: number) => {
      const simulation = new Simulation({
        workflowStartRate: 0,
        activitiesPerWorkflow: 1,
        activityFanout: 1,
        cpuCapacity: 1,
        activityTaskCpuDemand: 0.25,
        activityTaskBaseDurationSeconds,
        activityTaskDurationJitterPercent: 0,
      })
      simulation.startWorkflow()
      runFor(simulation, 20)
      const events = simulation.getEventsSince(0)
      const started = events.find((event) => event.type === 'ACTIVITY_TASK_STARTED')!
      const returnStarted = events.find((event) => event.type === 'ACTIVITY_TASK_RETURN_STARTED')!
      return returnStarted.timestamp - started.timestamp
    }

    const short = executionDuration(1)
    const long = executionDuration(3)
    expect(long).toBeGreaterThan(short * 2.5)
  })

  it('applies duration changes only to newly created Tasks', () => {
    const simulation = new Simulation({
      workflowStartRate: 0,
      workflowTaskCpuDemand: 0.5,
      workflowTaskBaseDurationSeconds: 1,
      workflowTaskDurationJitterPercent: 0,
    })
    simulation.startWorkflow()
    runFor(simulation, 1.1)
    const existing = simulation.getSnapshot().tasks.find((task) => task.type === 'workflow')!
    expect(existing.cpuWorkRemaining).toBe(0.5)

    simulation.updateConfig({ workflowTaskBaseDurationSeconds: 2 })
    expect(simulation.getSnapshot().tasks.find((task) => task.id === existing.id)?.cpuWorkRemaining).toBe(0.5)

    simulation.startWorkflow()
    runFor(simulation, 1.5)
    const newer = simulation.getSnapshot().tasks.find((task) =>
      task.type === 'workflow' && task.workflowId === 'workflow-2',
    )!
    expect(newer.cpuWorkRemaining).toBe(1)
  })

  it('normalizes duration controls to the supported range and step', () => {
    const simulation = new Simulation({
      workflowTaskBaseDurationSeconds: 0,
      activityTaskBaseDurationSeconds: 12,
      workflowTaskDurationJitterPercent: -10,
      activityTaskDurationJitterPercent: 103,
    })
    expect(simulation.getSnapshot().config.workflowTaskBaseDurationSeconds).toBe(0.05)
    expect(simulation.getSnapshot().config.activityTaskBaseDurationSeconds).toBe(10)
    expect(simulation.getSnapshot().config.workflowTaskDurationJitterPercent).toBe(0)
    expect(simulation.getSnapshot().config.activityTaskDurationJitterPercent).toBe(100)

    simulation.updateConfig({ activityTaskBaseDurationSeconds: 1.23 })
    expect(simulation.getSnapshot().config.activityTaskBaseDurationSeconds).toBe(1.25)
  })

  it('samples seeded symmetric duration jitter for each new Task', () => {
    const sampledDurations = (seed: number) => {
      const simulation = new Simulation({
        workflowStartRate: 0,
        workflowPollers: 0,
        workflowTaskBaseDurationSeconds: 2,
        workflowTaskDurationJitterPercent: 25,
      }, seed)
      simulation.startWorkflows(6)
      runFor(simulation, 4)
      return simulation.getSnapshot().tasks
        .filter((task) => task.type === 'workflow')
        .map((task) => task.executionDurationSeconds)
    }

    const first = sampledDurations(7)
    expect(first).toHaveLength(6)
    expect(new Set(first).size).toBeGreaterThan(1)
    expect(first.every((duration) => duration >= 1.5 && duration <= 2.5)).toBe(true)
    expect(sampledDurations(7)).toEqual(first)
    expect(sampledDurations(8)).not.toEqual(first)
  })
})
