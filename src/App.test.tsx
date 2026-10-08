import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import App from './App'

describe('App defaults', () => {
  it('loads the continuous default preset', () => {
    const markup = renderToStaticMarkup(<App />)

    expect(markup).toContain('<input type="radio" name="workload-mode" checked=""/>Continuous')
    expect(markup).toContain('<option value="default" selected="">Default setting</option>')
    expect(markup).toContain('Start continuous')
  })

  it('keeps Monitoring closed with its child sections open', () => {
    const markup = renderToStaticMarkup(<App />)
    const monitoringMarkup = markup.slice(markup.indexOf('<details class="monitoring-panel">'))

    expect(markup).toContain('<details class="monitoring-panel"><summary>Monitoring</summary>')
    expect(markup.match(/<details class="monitoring-section" open="">/g)).toHaveLength(3)
    expect(monitoringMarkup.indexOf('<summary>Temporal metrics</summary>')).toBeLessThan(monitoringMarkup.indexOf('<summary>Worker resources</summary>'))
    expect(monitoringMarkup.indexOf('<summary>Worker resources</summary>')).toBeLessThan(monitoringMarkup.indexOf('<summary>Load testing</summary>'))
    expect(monitoringMarkup).toContain('Task throughput')
    expect(monitoringMarkup).toContain('Task completion latency')
    expect(monitoringMarkup).toContain('Task statistics')
    expect(monitoringMarkup).not.toContain('Task throughput since start')
    expect(monitoringMarkup).not.toContain('Slot residence time')
    expect(monitoringMarkup).not.toContain('Workflow completion rate')
  })
})
