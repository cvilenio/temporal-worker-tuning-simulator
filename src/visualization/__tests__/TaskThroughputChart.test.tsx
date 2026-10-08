import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RoundTaskThroughputChart, TaskThroughputChart } from '../TaskThroughputChart'

describe('TaskThroughputChart', () => {
  it('renders total, Workflow Task, and Activity Task throughput over full time', () => {
    const markup = renderToStaticMarkup(
      <TaskThroughputChart
        simulatedTime={10}
        currentTotal={3}
        autoPauseTimes={[7.5]}
        samples={[
          { timestamp: 0, total: 0, workflow: 0, activity: 0, throttled: false, replaying: false },
          { timestamp: 5, total: 2, workflow: 0.5, activity: 1.5, throttled: true, replaying: true },
          { timestamp: 10, total: 3, workflow: 1, activity: 2, throttled: false, replaying: false },
        ]}
      />,
    )

    expect(markup).toContain('data-time-max="10"')
    expect(markup).toContain('data-sample-count="3"')
    expect(markup).toContain('data-series="total-task-throughput"')
    expect(markup).toContain('data-series="workflow-task-throughput"')
    expect(markup).toContain('data-series="activity-task-throughput"')
    expect(markup).toContain('data-throttle-start="0"')
    expect(markup).not.toContain('data-replay-start')
    expect(markup).not.toContain('Workflow replay')
    expect(markup).toContain('Auto-pause')
    expect(markup).toContain('data-auto-pause-at="7.5"')
    expect(markup).toContain('3.00 Tasks/s')
    expect(markup).toContain('10.0s')
  })

  it('renders separate cumulative throughput segments for successive runs', () => {
    const markup = renderToStaticMarkup(
      <RoundTaskThroughputChart
        simulatedTime={20}
        current={{
          timestamp: 20,
          roundId: 2,
          elapsedSeconds: 5,
          total: 1,
          workflow: 0.2,
          activity: 0.8,
          throttled: false,
          replaying: false,
        }}
        autoPauseTimes={[15]}
        samples={[
          { timestamp: 0, roundId: 1, elapsedSeconds: 0, total: 0, workflow: 0, activity: 0, throttled: false, replaying: false },
          { timestamp: 15, roundId: 1, elapsedSeconds: 15, total: 2, workflow: 0.5, activity: 1.5, throttled: false, replaying: false },
          { timestamp: 15, roundId: 2, elapsedSeconds: 0, total: 0, workflow: 0, activity: 0, throttled: false, replaying: false },
          { timestamp: 20, roundId: 2, elapsedSeconds: 5, total: 1, workflow: 0.2, activity: 0.8, throttled: false, replaying: false },
        ]}
        highlightSamples={[
          { timestamp: 0, total: 0, workflow: 0, activity: 0, throttled: false, replaying: false },
          { timestamp: 20, total: 1, workflow: 0.2, activity: 0.8, throttled: false, replaying: false },
        ]}
      />,
    )

    expect(markup).toContain('Task throughput since start')
    expect(markup).toContain('1.00 Tasks/s over 5.0s')
    expect(markup.match(/data-series="total-task-throughput"/g)).toHaveLength(2)
    expect(markup).toContain('data-segment="2"')
    expect(markup).toContain('data-auto-pause-at="15"')
  })
})
