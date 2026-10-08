import { describe, expect, it } from 'vitest'
import { simulationSecondsForRealSeconds } from './simulationClock'

describe('simulation clock scale', () => {
  it('maps displayed 1x to the previous 0.75x simulation rate', () => {
    expect(simulationSecondsForRealSeconds(1, 1)).toBe(0.75)
    expect(simulationSecondsForRealSeconds(1, 4)).toBe(3)
    expect(simulationSecondsForRealSeconds(1, 8)).toBe(6)
  })
})
