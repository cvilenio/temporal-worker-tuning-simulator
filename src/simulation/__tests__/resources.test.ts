import { describe, expect, it } from 'vitest'
import { resourceProgressScale } from '../resources'

describe('resource contention curve', () => {
  it('runs at full speed below the contention knee', () => {
    expect(resourceProgressScale(0.5, 1, { knee: 0.7, maxSpeedLoss: 0.25 })).toBe(1)
    expect(resourceProgressScale(0.6, 1, { knee: 0.6, maxSpeedLoss: 0.4 })).toBe(1)
  })

  it('slows smoothly before saturation', () => {
    const cpuScale = resourceProgressScale(0.85, 1, { knee: 0.7, maxSpeedLoss: 0.25 })
    const ioScale = resourceProgressScale(0.8, 1, { knee: 0.6, maxSpeedLoss: 0.4 })

    expect(cpuScale).toBeCloseTo(0.875)
    expect(ioScale).toBeCloseTo(0.8)
  })

  it('combines saturation contention with proportional overload sharing', () => {
    expect(resourceProgressScale(1, 1, { knee: 0.7, maxSpeedLoss: 0.25 })).toBeCloseTo(0.75)
    expect(resourceProgressScale(2, 1, { knee: 0.7, maxSpeedLoss: 0.25 })).toBeCloseTo(0.375)
    expect(resourceProgressScale(2, 1, { knee: 0.6, maxSpeedLoss: 0.4 })).toBeCloseTo(0.3)
  })
})
