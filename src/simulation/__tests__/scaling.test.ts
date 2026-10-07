import { describe, expect, it } from 'vitest'
import { TICK_SECONDS, type Simulation } from '..'
import { activityCompletions, runFor, simulationWith } from './helpers'

function runWindow(simulation: Simulation, seconds: number): number {
  let cpuUtilizationTotal = 0
  const ticks = Math.round(seconds / TICK_SECONDS)
  for (let tick = 0; tick < ticks; tick += 1) {
    simulation.step(TICK_SECONDS)
    cpuUtilizationTotal += simulation.getSnapshot().cpuUtilization
  }
  return cpuUtilizationTotal / ticks
}

function runUntil(simulation: Simulation, predicate: () => boolean, maxSeconds = 120): void {
  const ticks = Math.round(maxSeconds / TICK_SECONDS)
  for (let tick = 0; tick < ticks; tick += 1) {
    simulation.step(TICK_SECONDS)
    if (predicate()) return
  }
  throw new Error(`Condition not reached within ${maxSeconds} simulated seconds`)
}

describe('bottleneck migration', () => {
  it('moves from Slots to CPU, then responds to more CPU', () => {
    const simulation = simulationWith({
      workflowStartRate: 0,
      activitiesPerWorkflow: 1,
      workflowPollers: 16,
      workflowSlots: 16,
      activityPollers: 16,
      activitySlots: 1,
      activityTaskCpuDemand: 1,
      cpuCapacity: 4,
      workflowCacheCapacity: 50,
      memoryCapacityMb: 1_024,
    })
    simulation.startWorkflows(300)
    runUntil(simulation, () => simulation.getSnapshot().workflows.every((workflow) =>
      workflow.activitiesScheduled === 1,
    ))

    const beforeSlotLimited = activityCompletions(simulation)
    const slotLimitedCpu = runWindow(simulation, 12)
    const afterSlotLimited = activityCompletions(simulation)
    const slotLimitedCompletions = afterSlotLimited - beforeSlotLimited
    expect(slotLimitedCpu).toBeLessThan(0.6)

    simulation.updateConfig({ activitySlots: 16 })
    const cpuLimitedCpu = runWindow(simulation, 12)
    const afterCpuLimited = activityCompletions(simulation)
    const cpuLimitedCompletions = afterCpuLimited - afterSlotLimited
    expect(cpuLimitedCompletions).toBeGreaterThan(slotLimitedCompletions * 2)
    expect(cpuLimitedCpu).toBeGreaterThan(0.8)

    simulation.updateConfig({ cpuCapacity: 8 })
    runFor(simulation, 12)
    const scaledCpuCompletions = activityCompletions(simulation) - afterCpuLimited
    expect(scaledCpuCompletions).toBeGreaterThan(cpuLimitedCompletions * 1.2)
  })
})
