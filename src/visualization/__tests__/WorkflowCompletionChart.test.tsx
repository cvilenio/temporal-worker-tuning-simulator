import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { WorkflowCompletionChart } from '../WorkflowCompletionChart'

describe('WorkflowCompletionChart', () => {
  it('renders Workflow completion rate across full simulation time', () => {
    const markup = renderToStaticMarkup(
      <WorkflowCompletionChart
        simulatedTime={10}
        currentValue={0.8}
        autoPauseTimes={[7.5]}
        samples={[
          { timestamp: 0, value: 0, throttled: false, replaying: false },
          { timestamp: 5, value: 0.4, throttled: true, replaying: true },
          { timestamp: 10, value: 0.8, throttled: false, replaying: false },
        ]}
      />,
    )

    expect(markup).toContain('Workflow completion rate')
    expect(markup).toContain('data-time-max="10"')
    expect(markup).toContain('data-sample-count="3"')
    expect(markup).toContain('data-series="workflow-completion-rate"')
    expect(markup).toContain('data-throttle-start="0"')
    expect(markup).toContain('data-replay-start="0"')
    expect(markup).toContain('Workflow replay')
    expect(markup).toContain('Auto-pause')
    expect(markup).toContain('data-auto-pause-at="7.5"')
    expect(markup).toContain('0.80 Workflows/s')
  })
})
