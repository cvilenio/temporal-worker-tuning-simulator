import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Simulation } from '../../simulation'
import { SimulationScene } from '../SimulationScene'

describe('SimulationScene resources', () => {
  it('labels multiple Workers, RPC direction, and suppresses dense Poll requests', () => {
    const compact = new Simulation({ workerCount: 2, workflowStartRate: 0 }).getSnapshot()
    const dense = new Simulation({ workerCount: 3, workflowPollers: 2, workflowStartRate: 0 }).getSnapshot()
    const render = (snapshot: typeof compact) => renderToStaticMarkup(
      <SimulationScene
        snapshot={snapshot}
        nowMs={0}
        presentationNowMs={0}
        timeline={{ workflows: new Map(), tasks: new Map() }}
      />,
    )
    const compactMarkup = render(compact)
    const denseMarkup = render(dense)

    expect(compactMarkup).toContain('WORKERS (2)')
    expect(compactMarkup).toContain('data-worker-id="worker-1"')
    expect(compactMarkup).toContain('data-worker-id="worker-2"')
    expect(compactMarkup).toContain('WORKER A')
    expect(compactMarkup).toContain('WORKER B')
    expect(compactMarkup).not.toContain('poller-worker-label')
    expect(compactMarkup).not.toContain('slot-worker-label')
    expect(compactMarkup).toContain('COMMANDS / RESULTS -&gt; TEMPORAL')
    expect(compactMarkup).toContain('aria-label="Command / result RPC"')
    expect(compactMarkup).toContain('<tspan>Command / result</tspan><tspan x="54" dy="11">RPC</tspan>')
    expect(compactMarkup).toContain('class="poll-request"')
    expect(denseMarkup).not.toContain('class="poll-request"')
  })

  it('renders CPU, memory, and I/O bars with inline capacity labels', () => {
    const snapshot = new Simulation({ workflowStartRate: 0 }).getSnapshot()
    const markup = renderToStaticMarkup(
      <SimulationScene
        snapshot={snapshot}
        nowMs={0}
        presentationNowMs={0}
        timeline={{ workflows: new Map(), tasks: new Map() }}
      />,
    )

    expect(markup).toContain('CPU')
    expect(markup).not.toContain('Shared CPU')
    expect(markup).toContain('Memory')
    expect(markup).toContain('I/O')
    expect(markup).toContain('0% (0 / 1 CPU)')
    expect(markup).toContain('0% (0 / 1 throughput)')
    expect(markup).toContain('15% (19.2 / 128 MB)')
    expect(markup).toContain('19.2 MB base Workers + 0 MB active Tasks + 0 MB Workflow cache')
    expect(markup).toContain('Memory colors: base Worker, active Tasks, Workflow cache')
    expect(markup).toContain('Base Worker')
    expect(markup).toContain('Active Tasks')
    expect(markup).toContain('resource-fill memory-base-fill')
    expect(markup).toContain('resource-fill memory-task-fill')
    expect(markup).toContain('resource-fill memory-cache-fill')
    expect(markup).toContain('Workflow Cache')
    expect(markup).toContain('0 / 6')
    expect(markup).toContain('<text x="785" y="556" class="section-label">I/O</text>')
  })

  it('renders Workflow I/O utilization independently from CPU utilization', () => {
    const simulation = new Simulation({
      workflowStartRate: 0,
      workflowTaskResourceProfile: 'io',
      activityTaskResourceProfile: 'cpu',
      taskResourceProfilesLocked: false,
    })
    simulation.startWorkflow()
    let snapshot = simulation.getSnapshot()
    for (let tick = 0; tick < 100; tick += 1) {
      simulation.step()
      snapshot = simulation.getSnapshot()
      if (snapshot.ioUtilization > 0) break
    }
    const markup = renderToStaticMarkup(
      <SimulationScene
        snapshot={snapshot}
        nowMs={snapshot.simulatedTime * 1_000}
        presentationNowMs={snapshot.simulatedTime * 1_000}
        timeline={{ workflows: new Map(), tasks: new Map() }}
      />,
    )

    expect(markup).toContain('data-resource="cpu" data-utilization="0"')
    expect(markup).toContain('data-resource="io" data-utilization="0.25"')
    expect(markup).toContain('25% (0.25 / 1 throughput)')
  })

  it('shows large cache capacity through the size metric without a colliding overflow label', () => {
    const snapshot = new Simulation({ workflowStartRate: 0, workflowCacheCapacity: 10 }).getSnapshot()
    const markup = renderToStaticMarkup(
      <SimulationScene
        snapshot={snapshot}
        nowMs={0}
        presentationNowMs={0}
        timeline={{ workflows: new Map(), tasks: new Map() }}
      />,
    )

    expect(markup).toContain('0 / 10')
    expect(markup).not.toContain('cache-overflow')
  })

  it('marks a throttled resource bar for pulsing', () => {
    const simulation = new Simulation({
      workflowStartRate: 0,
      activitiesPerWorkflow: 1,
      activityTaskCpuDemand: 1,
    })
    simulation.startWorkflow()
    let snapshot = simulation.getSnapshot()
    for (let tick = 0; tick < 200; tick += 1) {
      simulation.step()
      snapshot = simulation.getSnapshot()
      if (snapshot.cpuThrottled) break
    }
    const markup = renderToStaticMarkup(
      <SimulationScene
        snapshot={snapshot}
        nowMs={snapshot.simulatedTime * 1_000}
        presentationNowMs={snapshot.simulatedTime * 1_000}
        timeline={{ workflows: new Map(), tasks: new Map() }}
      />,
    )

    expect(markup).toContain('data-resource="cpu" data-utilization="1" data-throttled="true"')
    expect(markup).toContain('resource-fill cpu-fill throttled')
  })

  it('renders warm Workflow cache entries and memory use', () => {
    const simulation = new Simulation({
      workflowStartRate: 0,
      activitiesPerWorkflow: 1,
      activitySlots: 0,
      workflowCacheCapacity: 2,
      cpuCapacity: 8,
    })
    simulation.startWorkflow()
    let snapshot = simulation.getSnapshot()
    for (let tick = 0; tick < 200; tick += 1) {
      simulation.step()
      snapshot = simulation.getSnapshot()
      if (snapshot.workflowCache.length === 1) break
    }
    const markup = renderToStaticMarkup(
      <SimulationScene
        snapshot={snapshot}
        nowMs={snapshot.simulatedTime * 1_000}
        presentationNowMs={snapshot.simulatedTime * 1_000}
        timeline={{ workflows: new Map(), tasks: new Map() }}
      />,
    )

    expect(markup).toContain('data-cache-size="1" data-cache-capacity="2"')
    expect(markup).toContain('data-cache-workflow-id="workflow-1"')
    expect(markup).toContain('W1')
    expect(markup).toContain('1 / 2')
    expect(markup).toContain('20% (25.2 / 128 MB)')
    expect(markup).toContain('19.2 MB base Workers + 2 MB active Tasks + 4 MB Workflow cache')
  })

  it('shows replay in the occupied Workflow Slot on a cache miss', () => {
    const simulation = new Simulation({
      workflowStartRate: 0,
      activitiesPerWorkflow: 1,
      workflowCacheCapacity: 0,
      cpuCapacity: 8,
    })
    simulation.startWorkflow()
    let snapshot = simulation.getSnapshot()
    for (let tick = 0; tick < 300; tick += 1) {
      simulation.step()
      snapshot = simulation.getSnapshot()
      if (snapshot.tasks.some((task) => task.type === 'workflow' && task.executionPhase === 'replay')) break
    }
    const markup = renderToStaticMarkup(
      <SimulationScene
        snapshot={snapshot}
        nowMs={snapshot.simulatedTime * 1_000}
        presentationNowMs={snapshot.simulatedTime * 1_000}
        timeline={{ workflows: new Map(), tasks: new Map() }}
      />,
    )

    expect(markup).toContain('slot occupied replaying')
    expect(markup).toContain('class="replay-glyph"')
    expect(markup).toContain('task task-workflow replaying')
    expect(markup).toContain('↻')
    expect(markup).toContain('disabled')
    expect(markup).toContain('data-cache-misses="1" data-replays-started="1"')
    expect(markup).toContain('Hit 0% · Replays 1')
  })

  it('binds simultaneous replay indicators to adjacent Workflow Slots', () => {
    const simulation = new Simulation({
      workflowStartRate: 0,
      activitiesPerWorkflow: 1,
      workflowCacheCapacity: 0,
      workflowPollers: 2,
      workflowSlots: 2,
      activityPollers: 2,
      activitySlots: 2,
      cpuCapacity: 0.25,
    })
    simulation.startWorkflows(2)
    let snapshot = simulation.getSnapshot()
    for (let tick = 0; tick < 500; tick += 1) {
      simulation.step()
      snapshot = simulation.getSnapshot()
      if (snapshot.tasks.filter((task) =>
        task.type === 'workflow' && task.state === 'running' && task.executionPhase === 'replay',
      ).length === 2) break
    }
    const markup = renderToStaticMarkup(
      <SimulationScene
        snapshot={snapshot}
        nowMs={snapshot.simulatedTime * 1_000}
        presentationNowMs={snapshot.simulatedTime * 1_000}
        timeline={{ workflows: new Map(), tasks: new Map() }}
      />,
    )

    expect(markup.match(/class="replay-glyph"/g)).toHaveLength(2)
    expect(markup).not.toContain('>REPLAY<')
    expect(markup).toContain('x="938"')
    expect(markup).toContain('x="970"')
  })

  it('removes replay styling as soon as the engine enters Workflow decision execution', () => {
    const simulation = new Simulation({
      workflowStartRate: 0,
      activitiesPerWorkflow: 1,
      workflowCacheCapacity: 0,
      workflowTaskResourceProfile: 'io',
      activityTaskResourceProfile: 'cpu',
      taskResourceProfilesLocked: false,
      cpuCapacity: 0.25,
    })
    simulation.startWorkflow()
    let snapshot = simulation.getSnapshot()
    for (let tick = 0; tick < 500; tick += 1) {
      simulation.step()
      snapshot = simulation.getSnapshot()
      if (snapshot.tasks.some((task) =>
        task.type === 'workflow'
        && task.state === 'running'
        && task.executionPhase === 'decision'
        && task.cacheOutcome === 'miss',
      )) break
    }
    const markup = renderToStaticMarkup(
      <SimulationScene
        snapshot={snapshot}
        nowMs={snapshot.simulatedTime * 1_000}
        presentationNowMs={snapshot.simulatedTime * 1_000}
        timeline={{ workflows: new Map(), tasks: new Map() }}
      />,
    )

    expect(markup).toContain('slot occupied')
    expect(markup).not.toContain('slot occupied replaying')
    expect(markup).not.toContain('class="replay-glyph"')
    expect(markup).not.toContain('>REPLAY<')
  })

  it('highlights cache hits without creating another moving object', () => {
    const simulation = new Simulation({
      workflowStartRate: 0,
      activitiesPerWorkflow: 1,
      workflowCacheCapacity: 2,
      cpuCapacity: 8,
    })
    simulation.startWorkflow()
    let snapshot = simulation.getSnapshot()
    for (let tick = 0; tick < 300; tick += 1) {
      simulation.step()
      snapshot = simulation.getSnapshot()
      if (snapshot.recentEvents.some((event) => event.type === 'CACHE_HIT')) break
    }
    const markup = renderToStaticMarkup(
      <SimulationScene
        snapshot={snapshot}
        nowMs={snapshot.simulatedTime * 1_000}
        presentationNowMs={snapshot.simulatedTime * 1_000}
        timeline={{ workflows: new Map(), tasks: new Map() }}
      />,
    )

    expect(markup).toContain('cache-cell occupied hit')
    expect(markup).toContain('Hit 50%')
  })

  it('shows deterministic cache eviction while retaining the newest entry', () => {
    const simulation = new Simulation({
      workflowStartRate: 0,
      activitiesPerWorkflow: 1,
      activitySlots: 0,
      workflowCacheCapacity: 1,
      cpuCapacity: 8,
    })
    simulation.startWorkflows(2)
    let snapshot = simulation.getSnapshot()
    for (let tick = 0; tick < 300; tick += 1) {
      simulation.step()
      snapshot = simulation.getSnapshot()
      if (snapshot.recentEvents.some((event) => event.type === 'CACHE_EVICTED')) break
    }
    const markup = renderToStaticMarkup(
      <SimulationScene
        snapshot={snapshot}
        nowMs={snapshot.simulatedTime * 1_000}
        presentationNowMs={snapshot.simulatedTime * 1_000}
        timeline={{ workflows: new Map(), tasks: new Map() }}
      />,
    )

    expect(markup).toContain('data-cache-size="1" data-cache-capacity="1"')
    expect(markup).toContain('data-cache-workflow-id="workflow-2"')
    expect(markup).toMatch(/<rect x="790"[^>]+data-cache-workflow-id="workflow-2"/)
    expect(markup).toContain('WF1 evicted')
  })

  it('removes a completed Workflow from the visible cache immediately', () => {
    const simulation = new Simulation({
      workflowStartRate: 0,
      activitiesPerWorkflow: 1,
      workflowCacheCapacity: 4,
      cpuCapacity: 8,
    })
    simulation.startWorkflow()
    let snapshot = simulation.getSnapshot()
    for (let tick = 0; tick < 400; tick += 1) {
      simulation.step()
      snapshot = simulation.getSnapshot()
      if (snapshot.workflows[0]?.state === 'completed') break
    }
    const markup = renderToStaticMarkup(
      <SimulationScene
        snapshot={snapshot}
        nowMs={snapshot.simulatedTime * 1_000}
        presentationNowMs={snapshot.simulatedTime * 1_000}
        timeline={{ workflows: new Map(), tasks: new Map() }}
      />,
    )

    expect(markup).toContain('data-cache-size="0" data-cache-capacity="4"')
    expect(markup).not.toContain('data-cache-workflow-id="workflow-1"')
    expect(markup).toContain('WF1 closed')
  })
})
