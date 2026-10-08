import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TaskDistributionTable } from '../TaskDistributionTable'

const stats = {
  completed: 12,
  throughput: 2.5,
  averageLatency: 1.2,
  p25Latency: 0.7,
  p50Latency: 1,
  p75Latency: 1.4,
  p95Latency: 2.1,
  p99Latency: 2.8,
  maxLatency: 3.2,
}

describe('TaskDistributionTable', () => {
  it('renders throughput and latency percentiles for each Task group', () => {
    const markup = renderToStaticMarkup(
      <TaskDistributionTable distribution={{ total: stats, workflow: stats, activity: stats }} />,
    )

    expect(markup).toContain('Task statistics')
    expect(markup).toContain('All Tasks')
    expect(markup).toContain('Workflow Tasks')
    expect(markup).toContain('Activity Tasks')
    expect(markup).toContain('P25')
    expect(markup).toContain('P50')
    expect(markup).toContain('P75')
    expect(markup).toContain('P95')
    expect(markup).toContain('P99')
    expect(markup).toContain('3.20s')
  })
})
