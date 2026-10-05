import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SlotResidenceChart } from '../SlotResidenceChart'

describe('SlotResidenceChart', () => {
  it('renders all samples against the full simulation time domain', () => {
    const markup = renderToStaticMarkup(
      <SlotResidenceChart
        simulatedTime={10}
        currentValue={1.25}
        samples={[
          { timestamp: 0, value: 0, throttled: false },
          { timestamp: 5, value: 1.5, throttled: true },
          { timestamp: 10, value: 1.25, throttled: false },
        ]}
      />,
    )

    expect(markup).toContain('data-time-max="10"')
    expect(markup).toContain('data-sample-count="3"')
    expect(markup).toContain('data-series="slot-residence"')
    expect(markup).toContain('data-throttle-start="0"')
    expect(markup).toContain('data-throttle-end="5"')
    expect(markup).toContain('Resource throttling')
    expect(markup).toContain('1.25s')
    expect(markup).toContain('10.0s')
  })
})
