import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TemporalMetricChart } from '../TemporalMetricChart'

describe('TemporalMetricChart', () => {
  it('renders Task-type series on an expanding percentage timeline', () => {
    const markup = renderToStaticMarkup(
      <TemporalMetricChart
        title="Poller busy ratio"
        subtitle="Share of busy Pollers"
        metricId="poller-busy-ratio"
        simulatedTime={4}
        samples={[
          { timestamp: 0, total: 0, workflow: 0, activity: 0, throttled: false, replaying: false },
          { timestamp: 4, total: 0.5, workflow: 1, activity: 0.4, throttled: true, replaying: true },
        ]}
        autoPauseTimes={[3]}
        format="percent"
      />,
    )

    expect(markup).toContain('Poller busy ratio')
    expect(markup).toContain('data-series="maximum-poller-busy-ratio"')
    expect(markup).toContain('data-series="workflow-poller-busy-ratio"')
    expect(markup).toContain('data-series="activity-poller-busy-ratio"')
    expect(markup).toContain('data-time-max="4"')
    expect(markup).toContain('50%')
    expect(markup).toContain('Maximum')
    expect(markup).not.toContain('>Total</span>')
    expect(markup).toContain('chart-throttle-band')
    expect(markup).not.toContain('chart-replay-band')
    expect(markup).not.toContain('Workflow replay')
    expect(markup).toContain('chart-auto-pause-line')
  })

  it('labels a count aggregate as Total', () => {
    const markup = renderToStaticMarkup(
      <TemporalMetricChart
        title="Backlog"
        subtitle="Tasks waiting"
        metricId="backlog"
        simulatedTime={1}
        samples={[
          { timestamp: 0, total: 0, workflow: 0, activity: 0, throttled: false, replaying: false },
          { timestamp: 1, total: 3, workflow: 1, activity: 2, throttled: false, replaying: false },
        ]}
        format="count"
      />,
    )

    expect(markup).toContain('>Total</span>')
    expect(markup).toContain('data-series="total-backlog"')
  })
})
