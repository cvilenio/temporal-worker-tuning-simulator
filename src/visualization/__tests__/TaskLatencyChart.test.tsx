import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TaskLatencyChart } from '../TaskLatencyChart'

describe('TaskLatencyChart', () => {
  it('renders overall and Task-type schedule-to-completion latency', () => {
    const markup = renderToStaticMarkup(
      <TaskLatencyChart
        simulatedTime={4}
        samples={[
          { timestamp: 0, total: 0, workflow: 0, activity: 0, throttled: false, replaying: false },
          { timestamp: 4, total: 2, workflow: 1, activity: 3, throttled: true, replaying: true },
        ]}
        autoPauseTimes={[3]}
      />,
    )

    expect(markup).toContain('Task completion latency')
    expect(markup).toContain('Task scheduling through completion')
    expect(markup).toContain('data-series="overall-task-latency"')
    expect(markup).toContain('data-series="workflow-task-latency"')
    expect(markup).toContain('data-series="activity-task-latency"')
    expect(markup).toContain('chart-throttle-band')
    expect(markup).not.toContain('chart-replay-band')
    expect(markup).not.toContain('Workflow replay')
  })
})
