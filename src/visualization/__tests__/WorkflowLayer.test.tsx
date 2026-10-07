import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Simulation, TICK_SECONDS } from '../../simulation'
import type { SimulationSnapshot } from '../../simulation'
import { WorkflowLayer } from '../WorkflowLayer'
import type { VisualTimeline } from '../useVisualTimeline'

function warmWorkflow(workerCount: number): SimulationSnapshot {
  const simulation = new Simulation({
    workerCount,
    workflowStartRate: 0,
    activitiesPerWorkflow: 1,
    activitySlots: 0,
    cpuCapacity: 8,
  })
  simulation.startWorkflow()
  for (let tick = 0; tick < Math.round(20 / TICK_SECONDS); tick += 1) {
    simulation.step(TICK_SECONDS)
    const snapshot = simulation.getSnapshot()
    if (snapshot.workflowCache.length === 1) return snapshot
  }
  throw new Error('Workflow did not become warm')
}

function render(snapshot: SimulationSnapshot): string {
  const timeline: VisualTimeline = {
    workflows: new Map([['workflow-1', {
      workflowId: 'workflow-1',
      requestStart: 0,
      coreArrival: 0,
    }]]),
    tasks: new Map(),
  }
  return renderToStaticMarkup(
    <svg>
      <WorkflowLayer
        snapshot={snapshot}
        nowMs={snapshot.simulatedTime * 1_000}
        presentationNowMs={snapshot.simulatedTime * 1_000}
        timeline={timeline}
      />
    </svg>,
  )
}

describe('Workflow affinity badges', () => {
  it('hides redundant Worker affinity with one Worker', () => {
    const markup = render(warmWorkflow(1))

    expect(markup).not.toContain('workflow-warm-badge')
    expect(markup).not.toContain('workflow-warm-label')
  })

  it('shows warm Worker identity when multiple Workers are visible', () => {
    const markup = render(warmWorkflow(2))

    expect(markup).toContain('workflow-warm-badge')
    expect(markup).toContain('workflow-warm-label')
    expect(markup).toContain('>A</text>')
  })
})
