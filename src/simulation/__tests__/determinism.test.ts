import { describe, expect, it } from 'vitest'
import { Simulation } from '..'
import { runFor } from './helpers'

describe('determinism', () => {
  it('produces identical state and events for identical input', () => {
    const first = runFor(new Simulation({}, 42), 8)
    const second = runFor(new Simulation({}, 42), 8)
    expect(first.getSnapshot()).toEqual(second.getSnapshot())
    expect(first.getEventsSince(0)).toEqual(second.getEventsSince(0))
  })

  it('applies the same live configuration sequence deterministically', () => {
    const execute = () => {
      const simulation = runFor(new Simulation({}, 9), 2)
      simulation.updateConfig({ activitySlots: 12, cpuCapacity: 4 })
      runFor(simulation, 4)
      simulation.updateConfig({ activityPollers: 4 })
      return runFor(simulation, 3).getSnapshot()
    }
    expect(execute()).toEqual(execute())
  })
})
