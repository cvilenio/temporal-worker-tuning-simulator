import { describe, expect, it } from 'vitest'
import { TICK_SECONDS, type Simulation } from '..'
import { activityCompletions, runFor, simulationWith } from './helpers'

function runWindow(simulation: Simulation, seconds: number): number {
  let maxCpuUtilization = 0
  const ticks = Math.round(seconds / TICK_SECONDS)
  for (let tick = 0; tick < ticks; tick += 1) {
    simulation.step(TICK_SECONDS)
    maxCpuUtilization = Math.max(maxCpuUtilization, simulation.getSnapshot().cpuUtilization)
  }
  return maxCpuUtilization
}

describe('bottleneck migration', () => {
  it('moves from Slots to CPU, then responds to more CPU', () => {
    const simulation = simulationWith({
      workflowStartRate: 20,
      activitiesPerWorkflow: 1,
      workflowPollers: 16,
      workflowSlots: 16,
      activityPollers: 16,
      activitySlots: 1,
      cpuCapacity: 4,
    })

    const slotLimitedCpu = runWindow(simulation, 12)
    const slotLimitedCompletions = activityCompletions(simulation)
    expect(slotLimitedCpu).toBeLessThan(0.5)

    simulation.updateConfig({ activitySlots: 16 })
    const cpuLimitedCpu = runWindow(simulation, 12)
    const cpuLimitedCompletions = activityCompletions(simulation) - slotLimitedCompletions
    expect(cpuLimitedCompletions).toBeGreaterThan(slotLimitedCompletions * 2)
    expect(cpuLimitedCpu).toBe(1)

    simulation.updateConfig({ cpuCapacity: 8 })
    runFor(simulation, 12)
    const scaledCpuCompletions = activityCompletions(simulation) - slotLimitedCompletions - cpuLimitedCompletions
    expect(scaledCpuCompletions).toBeGreaterThan(cpuLimitedCompletions * 1.2)
  })
})
