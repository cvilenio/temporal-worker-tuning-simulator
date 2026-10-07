import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { defaultConfig } from '../simulation'
import { Controls, WorkflowGenerationControls } from './Controls'

describe('Controls', () => {
  it('shows default CPU capacity and Task demand values', () => {
    const markup = renderToStaticMarkup(
      <Controls
        config={defaultConfig}
        playing
        speed={1}
        onConfigChange={() => undefined}
        onPlayingChange={() => undefined}
        onSpeedChange={() => undefined}
      />,
    )

    expect(defaultConfig.cpuCapacity).toBe(1)
    expect(defaultConfig.workflowPollers).toBe(1)
    expect(defaultConfig.activitySlots).toBe(4)
    expect(markup).toContain('Workflow Task')
    expect(markup).toContain('Activity Task')
    expect(markup).toContain('Lock profile types')
    expect(markup).not.toContain('>Workers<')
    expect(markup).toContain('Workflow Cache Capacity / Worker')
    expect(markup).toContain('Workflow Cache Memory / Entry')
    expect(markup).toContain('<output>6</output>')
    expect(markup).toContain('<output>4 MB</output>')
    expect(markup).toContain('<output>128 MB</output>')
    expect(markup).toContain('<output>0.01 CPU</output>')
    expect(markup).toContain('<output>0.25 CPU</output>')
    expect(markup).toContain('<output>1 CPU</output>')
  })

  it('shows Task demand in throughput units for the I/O-bound profile', () => {
    const markup = renderToStaticMarkup(
      <Controls
        config={{
          ...defaultConfig,
          workflowTaskResourceProfile: 'io',
          activityTaskResourceProfile: 'io',
        }}
        playing
        speed={1}
        onConfigChange={() => undefined}
        onPlayingChange={() => undefined}
        onSpeedChange={() => undefined}
      />,
    )

    expect(markup).toContain('I/O-bound')
    expect(markup).toContain('<output>0.25 throughput</output>')
    expect(markup.match(/<output>0.25 throughput<\/output>/g)).toHaveLength(2)
  })

  it('renders top-level triggered generation and collapsed Workflow shape controls', () => {
    const markup = renderToStaticMarkup(
      <WorkflowGenerationControls
        config={defaultConfig}
        workflowRateValue={6}
        workflowRateUnit="minute"
        generationMode="triggered"
        workflowCount={3}
        playing
        canResume={false}
        onConfigChange={() => undefined}
        onWorkflowRateValueChange={() => undefined}
        onWorkflowRateUnitChange={() => undefined}
        onGenerationModeChange={() => undefined}
        onWorkflowCountChange={() => undefined}
        onStart={() => undefined}
        onPlayingChange={() => undefined}
        onReset={() => undefined}
      />,
    )

    expect(markup).toContain('aria-label="Workflow generation"')
    expect(markup).toContain('Start 3 Workflows')
    expect(markup).toContain('>Pause</button>')
    expect(markup).toContain('>Reset</button>')
    expect(markup).toContain('<details class="workflow-shape-controls"><summary>Workflow shape</summary>')
    expect(markup).toContain('Activity batches / Workflow')
    expect(markup).toContain('Activities / batch')
    expect(markup).toContain('Each Workflow Task schedules one Activity batch')
    expect(markup).toContain('<strong>2</strong> Workflow Tasks / Workflow')
    expect(markup).toContain('<strong>3</strong> Activity Tasks / Workflow')
  })

  it('tallies Workflow and Activity Tasks from Workflow shape', () => {
    const markup = renderToStaticMarkup(
      <WorkflowGenerationControls
        config={{ ...defaultConfig, activitiesPerWorkflow: 8, activityFanout: 2 }}
        workflowRateValue={6}
        workflowRateUnit="minute"
        generationMode="triggered"
        workflowCount={1}
        playing={false}
        canResume={false}
        onConfigChange={() => undefined}
        onWorkflowRateValueChange={() => undefined}
        onWorkflowRateUnitChange={() => undefined}
        onGenerationModeChange={() => undefined}
        onWorkflowCountChange={() => undefined}
        onStart={() => undefined}
        onPlayingChange={() => undefined}
        onReset={() => undefined}
      />,
    )

    expect(markup).toContain('<strong>5</strong> Workflow Tasks / Workflow')
    expect(markup).toContain('<strong>8</strong> Activity Tasks / Workflow')
  })

  it('keeps a Start button available in continuous mode', () => {
    const markup = renderToStaticMarkup(
      <WorkflowGenerationControls
        config={defaultConfig}
        workflowRateValue={6}
        workflowRateUnit="minute"
        generationMode="continuous"
        workflowCount={1}
        playing={false}
        canResume={false}
        onConfigChange={() => undefined}
        onWorkflowRateValueChange={() => undefined}
        onWorkflowRateUnitChange={() => undefined}
        onGenerationModeChange={() => undefined}
        onWorkflowCountChange={() => undefined}
        onStart={() => undefined}
        onPlayingChange={() => undefined}
        onReset={() => undefined}
      />,
    )

    expect(markup).toContain('Workflow starts')
    expect(markup).toContain('Start continuous')
  })

  it('replaces Pause with Resume after a manual pause', () => {
    const markup = renderToStaticMarkup(
      <WorkflowGenerationControls
        config={defaultConfig}
        workflowRateValue={6}
        workflowRateUnit="minute"
        generationMode="triggered"
        workflowCount={1}
        playing={false}
        canResume
        onConfigChange={() => undefined}
        onWorkflowRateValueChange={() => undefined}
        onWorkflowRateUnitChange={() => undefined}
        onGenerationModeChange={() => undefined}
        onWorkflowCountChange={() => undefined}
        onStart={() => undefined}
        onPlayingChange={() => undefined}
        onReset={() => undefined}
      />,
    )

    expect(markup).toContain('>Resume</button>')
  })
})
