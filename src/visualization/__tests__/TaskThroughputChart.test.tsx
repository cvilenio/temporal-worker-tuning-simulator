import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TaskThroughputChart } from '../TaskThroughputChart'

describe('TaskThroughputChart', () => {
  it('renders total, Workflow Task, and Activity Task throughput over full time', () => {
    const markup = renderToStaticMarkup(
      <TaskThroughputChart
        simulatedTime={10}
        currentTotal={3}
        samples={[
          { timestamp: 0, total: 0, workflow: 0, activity: 0, throttled: false },
          { timestamp: 5, total: 2, workflow: 0.5, activity: 1.5, throttled: true },
          { timestamp: 10, total: 3, workflow: 1, activity: 2, throttled: false },
        ]}
      />,
    )

    expect(markup).toContain('data-time-max="10"')
    expect(markup).toContain('data-sample-count="3"')
    expect(markup).toContain('data-series="total-task-throughput"')
    expect(markup).toContain('data-series="workflow-task-throughput"')
    expect(markup).toContain('data-series="activity-task-throughput"')
    expect(markup).toContain('data-throttle-start="0"')
    expect(markup).toContain('3.00 Tasks/s')
    expect(markup).toContain('10.0s')
  })
})
