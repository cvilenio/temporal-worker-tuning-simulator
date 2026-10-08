import { describe, expect, it } from 'vitest'
import { Simulation } from '..'
import { activityCompletions, runFor, simulationWith } from './helpers'

describe('shared CPU', () => {
  it('proportionally throttles Task work that exceeds fractional Worker CPU', () => {
    const simulation = new Simulation({
      workflowStartRate: 0,
      activitiesPerWorkflow: 1,
      activityFanout: 1,
      cpuCapacity: 0.1,
      activityTaskCpuDemand: 0.25,
      activityTaskBaseDurationSeconds: 2,
      activityTaskDurationJitterPercent: 0,
    })
    simulation.startWorkflow()

    let snapshot = simulation.getSnapshot()
    for (let tick = 0; tick < 400; tick += 1) {
      simulation.step()
      snapshot = simulation.getSnapshot()
      if (snapshot.tasks.some((task) => task.type === 'activity' && task.state === 'running')) break
    }

    const running = snapshot.tasks.find((task) => task.type === 'activity' && task.state === 'running')!
    const workBefore = running.cpuWorkRemaining
    expect(snapshot.cpuDemand).toBe(0.25)
    expect(snapshot.cpuUtilization).toBe(1)
    expect(snapshot.cpuThrottled).toBe(true)

    simulation.step()
    const workAfter = simulation.getSnapshot().tasks.find((task) => task.id === running.id)!.cpuWorkRemaining
    expect(workBefore - workAfter).toBeCloseTo(0.00375)
  })

  it('combines fractional Task demand against integer CPU capacity', () => {
    const simulation = new Simulation({
      workflowStartRate: 0,
      activitiesPerWorkflow: 2,
      activityFanout: 2,
      workflowPollers: 1,
      workflowSlots: 1,
      activityPollers: 2,
      activitySlots: 2,
      cpuCapacity: 1,
      activityTaskCpuDemand: 0.5,
      activityTaskBaseDurationSeconds: 0.5,
      activityTaskDurationJitterPercent: 0,
    })
    simulation.startWorkflow()

    let snapshot = simulation.getSnapshot()
    for (let tick = 0; tick < 200; tick += 1) {
      simulation.step()
      snapshot = simulation.getSnapshot()
      if (snapshot.tasks.filter((task) => task.type === 'activity' && task.state === 'running').length === 2) break
    }

    const running = snapshot.tasks.filter((task) => task.type === 'activity' && task.state === 'running')
    expect(running).toHaveLength(2)
    expect(running.every((task) => task.maxCpuDemand === 0.5)).toBe(true)
    expect(snapshot.cpuUtilization).toBe(1)
    expect(snapshot.cpuDemand).toBe(1)

    const taskIds = running.map((task) => task.id)
    runFor(simulation, 2)
    const events = simulation.getEventsSince(0)
    for (const taskId of taskIds) {
      const started = events.find((event) => event.type === 'ACTIVITY_TASK_STARTED' && event.taskId === taskId)!
      const returnStarted = events.find((event) => event.type === 'ACTIVITY_TASK_RETURN_STARTED' && event.taskId === taskId)!
      expect(returnStarted.timestamp - started.timestamp).toBeCloseTo(0.6)
    }
  })

  it('keeps execution at its base duration below capacity and slows it under contention', () => {
    const durationsAtDemand = (activityTaskCpuDemand: number) => {
      const simulation = new Simulation({
        workflowStartRate: 0,
        activitiesPerWorkflow: 5,
        activityFanout: 5,
        workflowPollers: 1,
        workflowSlots: 1,
        activityPollers: 5,
        activitySlots: 5,
        cpuCapacity: 1,
        workflowTaskCpuDemand: 0.05,
        activityTaskCpuDemand,
        activityTaskBaseDurationSeconds: 0.5,
      })
      simulation.startWorkflow()
      runFor(simulation, 20)
      const events = simulation.getEventsSince(0)
      return events
        .filter((event) => event.type === 'ACTIVITY_TASK_RETURN_STARTED')
        .map((returnStarted) => {
          const started = events.find((event) =>
            event.type === 'ACTIVITY_TASK_STARTED' && event.taskId === returnStarted.taskId,
          )!
          return returnStarted.timestamp - started.timestamp
        })
    }

    const belowCapacity = durationsAtDemand(0.1)
    const contended = durationsAtDemand(0.5)
    const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length

    expect(belowCapacity).toHaveLength(5)
    expect(contended).toHaveLength(5)
    expect(average(belowCapacity)).toBeLessThan(0.55)
    expect(average(contended)).toBeGreaterThan(average(belowCapacity) * 1.5)
  })

  it('increases Slot residence above the CPU contention knee before saturation', () => {
    const residenceAtDemand = (activityTaskCpuDemand: number) => {
      const simulation = new Simulation({
        workflowStartRate: 0,
        activitiesPerWorkflow: 1,
        activityFanout: 1,
        cpuCapacity: 1,
        activityTaskCpuDemand,
      })
      simulation.startWorkflow()
      runFor(simulation, 10)
      const events = simulation.getEventsSince(0)
      const dispatched = events.find((event) => event.type === 'ACTIVITY_TASK_DISPATCH_STARTED')!
      const returnStarted = events.find((event) => event.type === 'ACTIVITY_TASK_RETURN_STARTED')!
      return returnStarted.timestamp - dispatched.timestamp
    }

    expect(residenceAtDemand(0.85)).toBeGreaterThan(residenceAtDemand(0.5))
  })

  it('reports active CPU throttling and records it in metric samples', () => {
    const simulation = new Simulation({
      workflowStartRate: 0,
      activitiesPerWorkflow: 1,
      activityFanout: 1,
      cpuCapacity: 1,
      activityTaskCpuDemand: 0.85,
    })
    simulation.startWorkflow()

    let snapshot = simulation.getSnapshot()
    for (let tick = 0; tick < 200; tick += 1) {
      simulation.step()
      snapshot = simulation.getSnapshot()
      if (snapshot.cpuThrottled) break
    }

    expect(snapshot.cpuUtilization).toBe(0.85)
    expect(snapshot.cpuThrottled).toBe(true)
    runFor(simulation, 0.3)
    expect(simulation.getSnapshot().slotResidenceHistory.some((sample) => sample.throttled)).toBe(true)
  })

  it('applies CPU demand changes only to newly created Tasks', () => {
    const simulation = new Simulation({ workflowStartRate: 0, workflowTaskCpuDemand: 0.5 })
    simulation.startWorkflow()
    runFor(simulation, 1.1)
    const existing = simulation.getSnapshot().tasks.find((task) => task.type === 'workflow')!
    expect(existing.maxCpuDemand).toBe(0.5)

    simulation.updateConfig({ workflowTaskCpuDemand: 0.25 })
    expect(simulation.getSnapshot().tasks.find((task) => task.id === existing.id)?.maxCpuDemand).toBe(0.5)
    simulation.startWorkflow()
    runFor(simulation, 1.5)
    const newer = simulation.getSnapshot().tasks.find((task) =>
      task.type === 'workflow' && task.workflowId === 'workflow-2',
    )!
    expect(newer.maxCpuDemand).toBe(0.25)
  })

  it('normalizes CPU capacity to tenths between 0.1 and 1 CPU', () => {
    const simulation = new Simulation({ cpuCapacity: 0.6 })
    expect(simulation.getSnapshot().config.cpuCapacity).toBe(0.6)
    simulation.updateConfig({ cpuCapacity: 2.6 })
    expect(simulation.getSnapshot().config.cpuCapacity).toBe(1)
    simulation.updateConfig({ cpuCapacity: 12 })
    expect(simulation.getSnapshot().config.cpuCapacity).toBe(1)
    simulation.updateConfig({ cpuCapacity: 0 })
    expect(simulation.getSnapshot().config.cpuCapacity).toBe(0.1)
  })

  it('reports rolling Slot residence time from reservation through completion', () => {
    const simulation = new Simulation({ workflowStartRate: 0 })
    simulation.startWorkflow()
    for (let tick = 0; tick < 400; tick += 1) {
      simulation.step()
      if (simulation.getSnapshot().metrics.slotResidenceSeconds > 0) break
    }
    expect(simulation.getSnapshot().metrics.slotResidenceSeconds).toBeGreaterThan(0)
  })

  it('saturates and makes additional Slots ineffective', () => {
    const workload = {
      workflowStartRate: 30,
      activitiesPerWorkflow: 1,
      workflowPollers: 32,
      workflowSlots: 32,
      activityPollers: 32,
      activityTaskCpuDemand: 1,
      cpuCapacity: 2,
      workflowTaskBaseDurationSeconds: 0.05,
      activityTaskBaseDurationSeconds: 0.5,
    }
    const sixteen = simulationWith({ ...workload, activitySlots: 16 })
    const thirtyTwo = simulationWith({ ...workload, activitySlots: 32 })
    runFor(sixteen, 60)
    runFor(thirtyTwo, 60)
    const throughput16 = activityCompletions(sixteen)
    const throughput32 = activityCompletions(thirtyTwo)
    expect(sixteen.getSnapshot().cpuUtilization).toBe(1)
    expect(thirtyTwo.getSnapshot().cpuUtilization).toBe(1)
    expect(Math.abs(throughput32 - throughput16) / throughput16).toBeLessThan(0.2)
  })

  it('accelerates running work after a live CPU increase', () => {
    const workload = {
      workflowStartRate: 20,
      activitiesPerWorkflow: 1,
      workflowPollers: 16,
      workflowSlots: 16,
      activityPollers: 16,
      activitySlots: 16,
      cpuCapacity: 0.2,
      workflowTaskBaseDurationSeconds: 0.05,
      workflowTaskReplayLatencySeconds: 0.05,
      activityTaskBaseDurationSeconds: 2,
      activityTaskDurationJitterPercent: 0,
    }
    const baseline = simulationWith(workload)
    const scaled = simulationWith(workload)
    runFor(baseline, 15)
    runFor(scaled, 15)
    scaled.updateConfig({ cpuCapacity: 1 })
    runFor(baseline, 20)
    runFor(scaled, 20)
    expect(activityCompletions(scaled)).toBeGreaterThan(activityCompletions(baseline) * 1.35)
  })
})
