import { describe, expect, it } from 'vitest'
import { Simulation, TICK_SECONDS } from './simulation'
import {
  AUTO_PAUSE_ZERO_BUFFER_SECONDS,
  advanceAutoPause,
  armAutoPause,
  idleAutoPauseState,
} from './autoPause'

describe('triggered-run auto pause', () => {
  it('keeps the simulation idle until a triggered run is armed', () => {
    const simulation = new Simulation({ workflowStartRate: 0 })
    const decision = advanceAutoPause(idleAutoPauseState(), simulation.getSnapshot())

    expect(decision.shouldPause).toBe(false)
    expect(decision.state).toEqual({ armed: false, zeroSince: null })
    expect(simulation.getSnapshot().simulatedTime).toBe(0)
  })

  it('pauses two seconds after every in-flight Workflow completes and rolling metrics reach zero', () => {
    const simulation = new Simulation({
      workflowStartRate: 0,
      activitiesPerWorkflow: 1,
      cpuCapacity: 8,
    })
    simulation.startWorkflows(2)
    let state = armAutoPause()
    let pauseTime: number | undefined
    let metricsReachedZeroAt: number | undefined

    for (let tick = 0; tick < 2_000; tick += 1) {
      simulation.step(TICK_SECONDS)
      const decision = advanceAutoPause(state, simulation.getSnapshot())
      state = decision.state
      if (metricsReachedZeroAt === undefined && state.zeroSince !== null) {
        metricsReachedZeroAt = state.zeroSince
      }
      if (decision.shouldPause) {
        pauseTime = simulation.getSnapshot().simulatedTime
        break
      }
    }

    const completedAt = Math.max(...simulation.getSnapshot().workflows.map((workflow) => workflow.completedAt!))
    expect(pauseTime).toBeDefined()
    expect(metricsReachedZeroAt).toBeDefined()
    expect(metricsReachedZeroAt! - completedAt).toBeGreaterThanOrEqual(5)
    expect(pauseTime! - metricsReachedZeroAt!).toBeGreaterThanOrEqual(AUTO_PAUSE_ZERO_BUFFER_SECONDS)
    expect(pauseTime! - metricsReachedZeroAt!).toBeLessThan(AUTO_PAUSE_ZERO_BUFFER_SECONDS + TICK_SECONDS * 2)
    expect(simulation.getSnapshot().metrics).toMatchObject({
      totalTaskThroughput: 0,
      workflowTaskThroughput: 0,
      activityTaskThroughput: 0,
      activityThroughput: 0,
      workflowCompletions: 0,
      slotResidenceSeconds: 0,
    })
    expect(state).toEqual({ armed: false, zeroSince: null })
  })

  it('cancels a pending pause when another triggered batch starts', () => {
    const simulation = new Simulation({
      workflowStartRate: 0,
      activitiesPerWorkflow: 1,
      cpuCapacity: 8,
    })
    simulation.startWorkflow()
    let state = armAutoPause()

    while (!simulation.getSnapshot().workflows.every((workflow) => workflow.state === 'completed')) {
      simulation.step(TICK_SECONDS)
      state = advanceAutoPause(state, simulation.getSnapshot()).state
    }
    simulation.step(TICK_SECONDS)
    state = advanceAutoPause(state, simulation.getSnapshot()).state
    expect(state.armed).toBe(true)

    simulation.startWorkflow()
    state = armAutoPause()
    const decision = advanceAutoPause(state, simulation.getSnapshot())

    expect(decision.shouldPause).toBe(false)
    expect(decision.state).toEqual({ armed: true, zeroSince: null })
  })

  it('restarts the two-second countdown if metrics resume', () => {
    const simulation = new Simulation({ workflowStartRate: 0, activitiesPerWorkflow: 1, cpuCapacity: 8 })
    simulation.startWorkflow()
    let state = armAutoPause()

    while (state.zeroSince === null) {
      simulation.step(TICK_SECONDS)
      state = advanceAutoPause(state, simulation.getSnapshot()).state
    }
    const firstZeroAt = state.zeroSince

    simulation.startWorkflow()
    let decision = advanceAutoPause(state, simulation.getSnapshot())
    expect(decision.shouldPause).toBe(false)
    expect(decision.state).toEqual({ armed: true, zeroSince: null })

    while (decision.state.zeroSince === null) {
      simulation.step(TICK_SECONDS)
      decision = advanceAutoPause(decision.state, simulation.getSnapshot())
    }
    expect(decision.state.zeroSince).toBeGreaterThan(firstZeroAt!)
  })
})
