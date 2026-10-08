import { Simulation, TICK_SECONDS, type SimulationConfig } from '..'

export function runFor(simulation: Simulation, seconds: number): Simulation {
  const ticks = Math.round(seconds / TICK_SECONDS)
  for (let index = 0; index < ticks; index += 1) simulation.step(TICK_SECONDS)
  return simulation
}

export function activityCompletions(simulation: Simulation): number {
  return simulation.getEventsSince(0).filter((event) => event.type === 'ACTIVITY_TASK_COMPLETED').length
}

export function simulationWith(changes: Partial<SimulationConfig>): Simulation {
  return new Simulation({
    workflowStartRate: 4,
    activitiesPerWorkflow: 4,
    workflowPollers: 4,
    activityPollers: 8,
    workflowSlots: 4,
    activitySlots: 8,
    cpuCapacity: 8,
    workflowTaskReplayLatencySeconds: 0.4,
    ...changes,
  }, 7)
}
