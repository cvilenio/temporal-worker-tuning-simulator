import { describe, expect, it } from 'vitest'
import { Simulation } from '..'
import { runFor } from './helpers'

describe('shared I/O throughput', () => {
  it('shows sustained Workflow I/O before CPU-bound Activities execute', () => {
    const simulation = new Simulation({
      workflowStartRate: 0,
      activitiesPerWorkflow: 1,
      workflowTaskResourceProfile: 'io',
      activityTaskResourceProfile: 'cpu',
      taskResourceProfilesLocked: false,
      workflowTaskIoDemand: 0.25,
      activityTaskCpuDemand: 1,
    })
    simulation.startWorkflow()

    let workflowIoTicks = 0
    let activityCpuObserved = false
    for (let tick = 0; tick < 240; tick += 1) {
      simulation.step()
      const snapshot = simulation.getSnapshot()
      if (snapshot.ioUtilization > 0) workflowIoTicks += 1
      if (snapshot.tasks.some((task) => task.type === 'activity' && task.state === 'running')) {
        expect(snapshot.cpuUtilization).toBeGreaterThan(0)
        activityCpuObserved = true
        break
      }
    }

    expect(workflowIoTicks).toBeGreaterThanOrEqual(15)
    expect(activityCpuObserved).toBe(true)
  })

  it('moves I/O-bound Task work through I/O without consuming CPU', () => {
    const simulation = new Simulation({
      workflowStartRate: 0,
      activitiesPerWorkflow: 2,
      activityFanout: 2,
      workflowPollers: 1,
      workflowSlots: 1,
      activityPollers: 2,
      activitySlots: 2,
      workflowTaskResourceProfile: 'io',
      activityTaskResourceProfile: 'io',
      workflowTaskIoDemand: 0.25,
      activityTaskIoDemand: 0.5,
    })
    simulation.startWorkflow()

    let snapshot = simulation.getSnapshot()
    for (let tick = 0; tick < 240; tick += 1) {
      simulation.step()
      snapshot = simulation.getSnapshot()
      if (snapshot.tasks.filter((task) => task.type === 'activity' && task.state === 'running').length === 2) break
    }

    const running = snapshot.tasks.filter((task) => task.type === 'activity' && task.state === 'running')
    expect(running).toHaveLength(2)
    expect(running.every((task) => task.resourceProfile === 'io')).toBe(true)
    expect(running.every((task) => task.maxIoDemand === 0.5)).toBe(true)
    expect(snapshot.cpuUtilization).toBe(0)
    expect(snapshot.ioUtilization).toBe(1)
    expect(snapshot.ioDemand).toBe(1)
    expect(snapshot.memoryUtilization).toBe(0)
  })

  it('keeps I/O execution at its base duration below capacity and slows it under contention', () => {
    const averageDurationAtDemand = (activityTaskIoDemand: number) => {
      const simulation = new Simulation({
        workflowStartRate: 0,
        activitiesPerWorkflow: 5,
        activityFanout: 5,
        workflowPollers: 1,
        workflowSlots: 1,
        activityPollers: 5,
        activitySlots: 5,
        workflowTaskResourceProfile: 'cpu',
        activityTaskResourceProfile: 'io',
        taskResourceProfilesLocked: false,
        activityTaskIoDemand,
      })
      simulation.startWorkflow()
      runFor(simulation, 20)
      const events = simulation.getEventsSince(0)
      const durations = events
        .filter((event) => event.type === 'ACTIVITY_TASK_RETURN_STARTED')
        .map((returnStarted) => {
          const started = events.find((event) =>
            event.type === 'ACTIVITY_TASK_STARTED' && event.taskId === returnStarted.taskId,
          )!
          return returnStarted.timestamp - started.timestamp
        })
      return durations.reduce((sum, value) => sum + value, 0) / durations.length
    }

    const belowCapacity = averageDurationAtDemand(0.1)
    const contended = averageDurationAtDemand(0.5)

    expect(belowCapacity).toBeLessThan(2.1)
    expect(contended).toBeGreaterThan(belowCapacity * 1.5)
  })

  it('increases Slot residence above the I/O contention knee before saturation', () => {
    const residenceAtDemand = (activityTaskIoDemand: number) => {
      const simulation = new Simulation({
        workflowStartRate: 0,
        activitiesPerWorkflow: 1,
        activityFanout: 1,
        workflowTaskResourceProfile: 'cpu',
        activityTaskResourceProfile: 'io',
        taskResourceProfilesLocked: false,
        activityTaskIoDemand,
      })
      simulation.startWorkflow()
      runFor(simulation, 12)
      const events = simulation.getEventsSince(0)
      const dispatched = events.find((event) => event.type === 'ACTIVITY_TASK_DISPATCH_STARTED')!
      const returnStarted = events.find((event) => event.type === 'ACTIVITY_TASK_RETURN_STARTED')!
      return returnStarted.timestamp - dispatched.timestamp
    }

    expect(residenceAtDemand(0.8)).toBeGreaterThan(residenceAtDemand(0.5))
  })

  it('reports active I/O throttling and records it in metric samples', () => {
    const simulation = new Simulation({
      workflowStartRate: 0,
      activitiesPerWorkflow: 1,
      activityFanout: 1,
      workflowTaskResourceProfile: 'cpu',
      activityTaskResourceProfile: 'io',
      taskResourceProfilesLocked: false,
      activityTaskIoDemand: 0.8,
    })
    simulation.startWorkflow()

    let snapshot = simulation.getSnapshot()
    for (let tick = 0; tick < 200; tick += 1) {
      simulation.step()
      snapshot = simulation.getSnapshot()
      if (snapshot.ioThrottled) break
    }

    expect(snapshot.ioUtilization).toBe(0.8)
    expect(snapshot.ioThrottled).toBe(true)
    runFor(simulation, 0.3)
    expect(simulation.getSnapshot().taskThroughputHistory.some((sample) => sample.throttled)).toBe(true)
  })

  it('reprofiles pending Tasks while running Tasks retain their profile', () => {
    const simulation = new Simulation({
      workflowStartRate: 0,
      activitiesPerWorkflow: 2,
      activityFanout: 2,
      workflowPollers: 2,
      workflowSlots: 2,
      activityPollers: 2,
      activitySlots: 1,
      cpuCapacity: 0.25,
      workflowTaskResourceProfile: 'cpu',
      activityTaskResourceProfile: 'cpu',
      taskResourceProfilesLocked: false,
    })
    simulation.startWorkflows(4)
    for (let tick = 0; tick < 90; tick += 1) simulation.step()

    simulation.updateConfig({ activityTaskResourceProfile: 'io' })
    const changed = simulation.getSnapshot().tasks
    expect(changed.filter((task) => task.type === 'activity' && task.state !== 'running').every((task) => task.resourceProfile === 'io')).toBe(true)
    expect(changed.filter((task) => task.type === 'workflow' && task.state !== 'running').every((task) => task.resourceProfile === 'cpu')).toBe(true)
    expect(changed.filter((task) => task.state === 'running').every((task) => task.resourceProfile === 'cpu')).toBe(true)

    let ioBecameActive = false
    for (let tick = 0; tick < 300; tick += 1) {
      simulation.step()
      const snapshot = simulation.getSnapshot()
      if (snapshot.cpuUtilization === 0 && snapshot.ioUtilization > 0) {
        ioBecameActive = true
        break
      }
    }
    expect(ioBecameActive).toBe(true)
  })

  it('locks profile types without coupling demand values', () => {
    const simulation = new Simulation({
      taskResourceProfilesLocked: true,
      workflowTaskCpuDemand: 0.25,
      activityTaskCpuDemand: 0.75,
    })
    simulation.updateConfig({ activityTaskResourceProfile: 'io' })
    const config = simulation.getSnapshot().config
    expect(config.workflowTaskResourceProfile).toBe('io')
    expect(config.activityTaskResourceProfile).toBe('io')
    expect(config.workflowTaskCpuDemand).toBe(0.25)
    expect(config.activityTaskCpuDemand).toBe(0.75)
  })
})
