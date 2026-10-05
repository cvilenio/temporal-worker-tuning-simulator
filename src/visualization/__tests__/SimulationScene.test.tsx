import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Simulation } from '../../simulation'
import { SimulationScene } from '../SimulationScene'

describe('SimulationScene resources', () => {
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
})
