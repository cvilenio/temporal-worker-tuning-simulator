import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ResourceUsageChart } from '../ResourceUsageChart'

describe('ResourceUsageChart', () => {
  it('renders native resource units and throttling windows', () => {
    const markup = renderToStaticMarkup(
      <ResourceUsageChart
        title="Memory utilization"
        subtitle="Worker memory"
        resource="memory"
        simulatedTime={2}
        currentValue={0.75}
        samples={[
          { timestamp: 0, value: 0.15, throttled: false, replaying: false },
          { timestamp: 2, value: 0.75, throttled: true, replaying: false },
        ]}
        autoPauseTimes={[1.5]}
      />,
    )

    expect(markup).toContain('75%')
    expect(markup).toContain('100%')
    expect(markup).toContain('data-series="memory-usage"')
    expect(markup).toContain('chart-line resource-memory')
    expect(markup).toContain('chart-throttle-band')
    expect(markup).toContain('chart-auto-pause-line')
    expect(markup).not.toContain('Workflow replay')
  })
})
