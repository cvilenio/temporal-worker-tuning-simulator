import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { defaultConfig } from '../simulation'
import { Controls } from './Controls'

describe('Controls', () => {
  it('shows default CPU capacity and Task demand values', () => {
    const markup = renderToStaticMarkup(
      <Controls
        config={defaultConfig}
        workflowRateValue={6}
        workflowRateUnit="minute"
        generationMode="triggered"
        workflowCount={1}
        playing
        speed={1}
        onConfigChange={() => undefined}
        onWorkflowRateValueChange={() => undefined}
        onWorkflowRateUnitChange={() => undefined}
        onGenerationModeChange={() => undefined}
        onWorkflowCountChange={() => undefined}
        onStartWorkflows={() => undefined}
        onPlayingChange={() => undefined}
        onReset={() => undefined}
        onSpeedChange={() => undefined}
      />,
    )

    expect(defaultConfig.cpuCapacity).toBe(1)
    expect(markup).toContain('Workflow Task')
    expect(markup).toContain('Activity Task')
    expect(markup).toContain('Lock profile types')
    expect(markup).toContain('<output>0.25 CPU</output>')
    expect(markup.match(/<output>1 CPU<\/output>/g)).toHaveLength(2)
  })

  it('shows Task demand in throughput units for the I/O-bound profile', () => {
    const markup = renderToStaticMarkup(
      <Controls
        config={{
          ...defaultConfig,
          workflowTaskResourceProfile: 'io',
          activityTaskResourceProfile: 'io',
        }}
        workflowRateValue={6}
        workflowRateUnit="minute"
        generationMode="triggered"
        workflowCount={1}
        playing
        speed={1}
        onConfigChange={() => undefined}
        onWorkflowRateValueChange={() => undefined}
        onWorkflowRateUnitChange={() => undefined}
        onGenerationModeChange={() => undefined}
        onWorkflowCountChange={() => undefined}
        onStartWorkflows={() => undefined}
        onPlayingChange={() => undefined}
        onReset={() => undefined}
        onSpeedChange={() => undefined}
      />,
    )

    expect(markup).toContain('I/O-bound')
    expect(markup).toContain('<output>0.25 throughput</output>')
    expect(markup.match(/<output>0.25 throughput<\/output>/g)).toHaveLength(2)
  })
})
