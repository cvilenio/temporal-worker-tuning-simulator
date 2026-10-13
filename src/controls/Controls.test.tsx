import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Simulation, defaultConfig } from '../simulation'
import { WorkflowGenerationControls } from './Controls'
import { SIMULATOR_PRESETS } from './presets'

function renderGeneration(config = defaultConfig) {
  return renderToStaticMarkup(
    <WorkflowGenerationControls
      config={config}
      workflowRateValue={6}
      workflowRateUnit="minute"
      generationMode="triggered"
      workflowCount={1}
      playing
      canResume={false}
      speed={1}
      onConfigChange={() => undefined}
      onWorkflowRateValueChange={() => undefined}
      onWorkflowRateUnitChange={() => undefined}
      onGenerationModeChange={() => undefined}
      onWorkflowCountChange={() => undefined}
      onStart={() => undefined}
      onPlayingChange={() => undefined}
      onSpeedChange={() => undefined}
      onReset={() => undefined}
    />,
  )
}

describe('Controls', () => {
  it('defines a moderate Poller-constrained demonstration', () => {
    const preset = SIMULATOR_PRESETS.pollerConstrained

    expect(preset.generationMode).toBe('continuous')
    expect(preset.workflowRateValue).toBe(24)
    expect(preset.workflowRateUnit).toBe('minute')
    expect(preset.config.activityPollers).toBe(1)
    expect(preset.config.activitySlots).toBe(8)
    expect(preset.config.activitiesPerWorkflow).toBe(8)
    expect(preset.config.activityFanout).toBe(8)
    expect(preset.config.activityTaskCpuDemand).toBe(0.05)
    expect(preset.config.activityTaskBaseDurationSeconds).toBe(0.75)
    expect(preset.config.workflowTaskReplayLatencySeconds).toBe(0.5)

    const simulation = new Simulation(preset.config)
    let backlogTicks = 0
    let minimumIdleSlotsDuringBacklog = preset.config.activitySlots
    let maximumQueueDepth = 0
    let cpuThrottledBacklogTicks = 0
    for (let tick = 0; tick < 1_200; tick += 1) {
      simulation.step()
      const snapshot = simulation.getSnapshot()
      maximumQueueDepth = Math.max(maximumQueueDepth, snapshot.activityQueue.length)
      const idleSlots = snapshot.activitySlots.filter((slot) => slot.state === 'available').length
      if (snapshot.activityQueue.length >= 4) {
        backlogTicks += 1
        minimumIdleSlotsDuringBacklog = Math.min(minimumIdleSlotsDuringBacklog, idleSlots)
        if (snapshot.cpuThrottled) cpuThrottledBacklogTicks += 1
      }
    }
    expect(backlogTicks).toBeGreaterThan(100)
    expect(maximumQueueDepth).toBeGreaterThanOrEqual(6)
    expect(minimumIdleSlotsDuringBacklog).toBeGreaterThanOrEqual(2)
    expect(cpuThrottledBacklogTicks).toBeLessThan(backlogTicks / 10)
  })

  it('defines a sustained Slot-constrained demonstration', () => {
    const preset = SIMULATOR_PRESETS.slotConstrained

    expect(preset.generationMode).toBe('continuous')
    expect(preset.workflowRateValue).toBe(12)
    expect(preset.workflowRateUnit).toBe('minute')
    expect(preset.config.activityPollers).toBe(4)
    expect(preset.config.activitySlots).toBe(1)
    expect(preset.config.activitiesPerWorkflow).toBe(4)
    expect(preset.config.activityFanout).toBe(4)
    expect(preset.config.activityTaskCpuDemand).toBe(0.1)
    expect(preset.config.activityTaskBaseDurationSeconds).toBe(2)

    const simulation = new Simulation(preset.config)
    let backlogTicks = 0
    let availableSlotBacklogTicks = 0
    let maximumQueueDepth = 0
    let maximumBusyPollers = 0
    for (let tick = 0; tick < 1_200; tick += 1) {
      simulation.step()
      const snapshot = simulation.getSnapshot()
      maximumQueueDepth = Math.max(maximumQueueDepth, snapshot.activityQueue.length)
      if (snapshot.activityQueue.length >= 4) {
        backlogTicks += 1
        if (snapshot.activitySlots[0].state === 'available') availableSlotBacklogTicks += 1
        maximumBusyPollers = Math.max(
          maximumBusyPollers,
          snapshot.activityPollers.filter((poller) => poller.state !== 'long-polling').length,
        )
      }
    }

    expect(backlogTicks).toBeGreaterThan(100)
    expect(maximumQueueDepth).toBeGreaterThanOrEqual(8)
    expect(availableSlotBacklogTicks).toBeLessThan(backlogTicks / 10)
    expect(maximumBusyPollers).toBeLessThanOrEqual(1)
  })

  it('defines a sustained CPU-constrained demonstration', () => {
    const preset = SIMULATOR_PRESETS.cpuConstrained

    expect(preset.generationMode).toBe('continuous')
    expect(preset.workflowRateValue).toBe(24)
    expect(preset.workflowRateUnit).toBe('minute')
    expect(preset.config.activityPollers).toBe(8)
    expect(preset.config.activitySlots).toBe(8)
    expect(preset.config.activitiesPerWorkflow).toBe(6)
    expect(preset.config.activityFanout).toBe(6)
    expect(preset.config.cpuCapacity).toBe(0.5)
    expect(preset.config.activityTaskCpuDemand).toBe(0.25)
    expect(preset.config.activityTaskBaseDurationSeconds).toBe(2)

    const simulation = new Simulation(preset.config)
    let backlogTicks = 0
    let saturatedBacklogTicks = 0
    let throttledBacklogTicks = 0
    let maximumQueueDepth = 0
    for (let tick = 0; tick < 1_200; tick += 1) {
      simulation.step()
      const snapshot = simulation.getSnapshot()
      maximumQueueDepth = Math.max(maximumQueueDepth, snapshot.activityQueue.length)
      if (snapshot.activityQueue.length >= 4) {
        backlogTicks += 1
        if (snapshot.cpuUtilization === 1) saturatedBacklogTicks += 1
        if (snapshot.cpuThrottled) throttledBacklogTicks += 1
      }
    }

    expect(backlogTicks).toBeGreaterThan(100)
    expect(maximumQueueDepth).toBeGreaterThanOrEqual(8)
    expect(saturatedBacklogTicks).toBeGreaterThan(backlogTicks * 0.9)
    expect(throttledBacklogTicks).toBeGreaterThan(backlogTicks * 0.9)
  })

  it('defines a sustained I/O-constrained demonstration with low CPU usage', () => {
    const preset = SIMULATOR_PRESETS.ioConstrained

    expect(preset.generationMode).toBe('continuous')
    expect(preset.workflowRateValue).toBe(24)
    expect(preset.workflowRateUnit).toBe('minute')
    expect(preset.config.activityPollers).toBe(8)
    expect(preset.config.activitySlots).toBe(8)
    expect(preset.config.activitiesPerWorkflow).toBe(6)
    expect(preset.config.activityFanout).toBe(6)
    expect(preset.config.activityTaskResourceProfile).toBe('io')
    expect(preset.config.taskResourceProfilesLocked).toBe(false)
    expect(preset.config.ioCapacity).toBe(0.5)
    expect(preset.config.activityTaskIoDemand).toBe(0.25)
    expect(preset.config.activityTaskBaseDurationSeconds).toBe(2)

    const simulation = new Simulation(preset.config)
    let backlogTicks = 0
    let saturatedBacklogTicks = 0
    let throttledBacklogTicks = 0
    let lowCpuBacklogTicks = 0
    let maximumQueueDepth = 0
    for (let tick = 0; tick < 1_200; tick += 1) {
      simulation.step()
      const snapshot = simulation.getSnapshot()
      maximumQueueDepth = Math.max(maximumQueueDepth, snapshot.activityQueue.length)
      if (snapshot.activityQueue.length >= 4) {
        backlogTicks += 1
        if (snapshot.ioUtilization === 1) saturatedBacklogTicks += 1
        if (snapshot.ioThrottled) throttledBacklogTicks += 1
        if (snapshot.cpuUtilization <= 0.3) lowCpuBacklogTicks += 1
      }
    }

    expect(backlogTicks).toBeGreaterThan(100)
    expect(maximumQueueDepth).toBeGreaterThanOrEqual(8)
    expect(saturatedBacklogTicks).toBeGreaterThan(backlogTicks * 0.9)
    expect(throttledBacklogTicks).toBeGreaterThan(backlogTicks * 0.9)
    expect(lowCpuBacklogTicks).toBeGreaterThan(backlogTicks * 0.9)
  })

  it('defines memory pressure shared by active Tasks and Workflow cache', () => {
    const preset = SIMULATOR_PRESETS.memoryConstrained

    expect(preset.generationMode).toBe('continuous')
    expect(preset.workflowRateValue).toBe(8)
    expect(preset.workflowRateUnit).toBe('minute')
    expect(preset.config.activitiesPerWorkflow).toBe(20)
    expect(preset.config.activityFanout).toBe(4)
    expect(preset.config.activitySlots).toBe(14)
    expect(preset.config.workflowCacheCapacity).toBe(6)
    expect(preset.config.workflowCacheEntryMemoryMb).toBe(3)
    expect(preset.config.memoryCapacityMb).toBe(64)
    expect(preset.config.activityTaskCpuDemand).toBe(0.01)

    const simulation = new Simulation(preset.config)
    let maximumMemoryUtilization = 0
    let maximumCacheMemoryMb = 0
    let maximumCacheSize = 0
    let maximumActiveTaskMemoryMb = 0
    let maximumWorkflowQueueDepth = 0
    let memoryPressureTicks = 0
    let cpuThrottledTicks = 0
    let ioThrottledTicks = 0
    for (let tick = 0; tick < 2_400; tick += 1) {
      simulation.step()
      const snapshot = simulation.getSnapshot()
      maximumMemoryUtilization = Math.max(maximumMemoryUtilization, snapshot.memoryUtilization)
      maximumCacheSize = Math.max(maximumCacheSize, snapshot.workflowCache.length)
      maximumWorkflowQueueDepth = Math.max(maximumWorkflowQueueDepth, snapshot.workflowQueue.length)
      maximumCacheMemoryMb = Math.max(
        maximumCacheMemoryMb,
        snapshot.workflowCache.reduce((sum, entry) => sum + entry.memoryMb, 0),
      )
      maximumActiveTaskMemoryMb = Math.max(
        maximumActiveTaskMemoryMb,
        snapshot.tasks.filter((task) =>
          task.state === 'acquired' || task.state === 'dispatching' || task.state === 'running',
        ).length * 2,
      )
      if (snapshot.cpuThrottled) cpuThrottledTicks += 1
      if (snapshot.memoryPressure) memoryPressureTicks += 1
      if (snapshot.ioThrottled) ioThrottledTicks += 1
    }

    const events = simulation.getEventsSince(0)
    const memoryEvictions = events.filter((event) =>
      event.type === 'CACHE_EVICTED' && event.reason === 'MEMORY_PRESSURE',
    )
    const replays = events.filter((event) => event.type === 'REPLAY_STARTED')
    const evictedWorkflowRewarmed = memoryEvictions.some((eviction) => events.some((event) =>
      event.type === 'CACHE_INSERTED'
      && event.workflowId === eviction.workflowId
      && event.id > eviction.id,
    ))

    expect(maximumMemoryUtilization).toBeGreaterThan(0.9)
    expect(maximumCacheMemoryMb).toBeGreaterThanOrEqual(18)
    expect(maximumCacheSize).toBe(preset.config.workflowCacheCapacity)
    expect(maximumActiveTaskMemoryMb).toBeGreaterThanOrEqual(12)
    expect(memoryEvictions.length).toBeGreaterThan(2)
    expect(memoryPressureTicks).toBeGreaterThan(0)
    expect(replays.length).toBeGreaterThan(memoryEvictions.length)
    expect(evictedWorkflowRewarmed).toBe(true)
    expect(maximumWorkflowQueueDepth).toBeLessThanOrEqual(12)
    expect(cpuThrottledTicks).toBeLessThan(240)
    expect(ioThrottledTicks).toBe(0)
  })

  it('shows default CPU capacity and Task demand values', () => {
    const markup = renderGeneration()

    expect(defaultConfig.cpuCapacity).toBe(1)
    expect(defaultConfig.ioCapacity).toBe(1)
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
    expect(markup).toContain('<output>0.15 CPU</output>')
    expect(markup).toContain('<output>1 CPU</output>')
    expect(markup).toContain('<output>1 throughput</output>')
    expect(markup).toContain('<output>0.25 s</output>')
    expect(markup).toContain('<output>2 s</output>')
    expect(markup.match(/Base execution duration/g)).toHaveLength(2)
    expect(markup.match(/Execution duration jitter/g)).toHaveLength(2)
    expect(markup.match(/<output>25%<\/output>/g)).toHaveLength(2)
    expect(markup).toContain('Replay latency / history unit')
    expect(markup).toContain('<output>1 s</output>')
  })

  it('shows Task demand in throughput units for the I/O-bound profile', () => {
    const markup = renderGeneration({
      ...defaultConfig,
      workflowTaskResourceProfile: 'io',
      activityTaskResourceProfile: 'io',
    })

    expect(markup).toContain('I/O-bound')
    expect(markup).toContain('<output>0.25 throughput</output>')
    expect(markup.match(/<output>0.25 throughput<\/output>/g)).toHaveLength(2)
  })

  it('renders top-level generation and nested Simulator config sections', () => {
    const markup = renderToStaticMarkup(
      <WorkflowGenerationControls
        config={defaultConfig}
        workflowRateValue={6}
        workflowRateUnit="minute"
        generationMode="triggered"
        workflowCount={3}
        playing
        canResume={false}
        speed={1}
        onConfigChange={() => undefined}
        onWorkflowRateValueChange={() => undefined}
        onWorkflowRateUnitChange={() => undefined}
        onGenerationModeChange={() => undefined}
        onWorkflowCountChange={() => undefined}
        onStart={() => undefined}
        onPlayingChange={() => undefined}
        onSpeedChange={() => undefined}
        onReset={() => undefined}
      />,
    )

    expect(markup).toContain('aria-label="Workflow generation mode"')
    expect(markup).toContain('<div class="generation-config-label">Workflow generation mode</div>')
    expect(markup).toContain('Manual')
    expect(markup).toContain('Start 3 Workflows')
    expect(markup).toContain('>Pause</button>')
    expect(markup).toContain('>Reset</button>')
    expect(markup).toContain('<section class="simulator-config" aria-labelledby="simulator-config-title"><div id="simulator-config-title" class="simulator-config-title">Simulator config</div>')
    expect(markup).toContain('aria-label="Simulator preset"')
    expect(markup).toContain('<option value="default">Default setting</option>')
    expect(markup).toContain('<option value="defaultTriggered" selected="">Default setting (manual mode)</option>')
    expect(markup).toContain('<option value="pollerConstrained">Poller constrained</option>')
    expect(markup).toContain('<option value="slotConstrained">Slot constrained</option>')
    expect(markup).toContain('<option value="cpuConstrained">CPU constrained</option>')
    expect(markup).toContain('<option value="ioConstrained">I/O constrained</option>')
    expect(markup).toContain('<option value="memoryConstrained">Memory constrained</option>')
    expect(markup.indexOf('Simulator preset')).toBeLessThan(markup.indexOf('Workflow shape'))
    expect(markup).toContain('<details class="custom-settings"><summary>Custom settings</summary>')
    expect(markup).toContain('<details class="config-section workflow-shape-controls"><summary>Workflow shape</summary>')
    expect(markup).toContain('<details class="config-section worker-capacity-section"><summary>Worker capacity</summary>')
    expect(markup).toContain('<details class="config-section worker-resources-section"><summary>Worker resources</summary>')
    expect(markup).toContain('<details class="config-section task-resource-profiles-section"><summary>Task resource profiles</summary>')
    expect(markup).toContain('I/O Capacity / Worker')
    expect(markup).toContain('Execution Phases')
    expect(markup).toContain('Activities per Activity Phase')
    expect(markup).toContain('Each Workflow Task schedules one execution phase of Activities')
    expect(markup).toContain('<strong>2</strong> Workflow Tasks / Workflow')
    expect(markup).toContain('<strong>3</strong> Activity Tasks / Workflow')
  })

  it('renders time-scale controls above generation without a Play button', () => {
    const markup = renderGeneration()

    expect(markup.indexOf('Workflow generation mode')).toBeLessThan(markup.indexOf('Simulation time controls'))
    expect(markup.indexOf('>Reset</button>')).toBeLessThan(markup.indexOf('Simulation time controls'))
    expect(markup).toContain('Time scale')
    expect(markup).toContain('>0.5x</button>')
    expect(markup).toContain('>1x</button>')
    expect(markup).toContain('>2x</button>')
    expect(markup).toContain('>4x</button>')
    expect(markup).toContain('>8x</button>')
    expect(markup).not.toContain('>Play</button>')
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
        speed={1}
        onConfigChange={() => undefined}
        onWorkflowRateValueChange={() => undefined}
        onWorkflowRateUnitChange={() => undefined}
        onGenerationModeChange={() => undefined}
        onWorkflowCountChange={() => undefined}
        onStart={() => undefined}
        onPlayingChange={() => undefined}
        onSpeedChange={() => undefined}
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
        speed={1}
        onConfigChange={() => undefined}
        onWorkflowRateValueChange={() => undefined}
        onWorkflowRateUnitChange={() => undefined}
        onGenerationModeChange={() => undefined}
        onWorkflowCountChange={() => undefined}
        onStart={() => undefined}
        onPlayingChange={() => undefined}
        onSpeedChange={() => undefined}
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
        speed={1}
        onConfigChange={() => undefined}
        onWorkflowRateValueChange={() => undefined}
        onWorkflowRateUnitChange={() => undefined}
        onGenerationModeChange={() => undefined}
        onWorkflowCountChange={() => undefined}
        onStart={() => undefined}
        onPlayingChange={() => undefined}
        onSpeedChange={() => undefined}
        onReset={() => undefined}
      />,
    )

    expect(markup).toContain('>Resume</button>')
  })
})
