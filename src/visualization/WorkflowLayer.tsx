import type { SimulationSnapshot } from '../simulation'
import { compactWorkflowPoints, serviceCorePoint } from './geometry'
import {
  CLIENT_TO_CORE_MS,
  WORKFLOW_COMPLETED_FADE_MS,
  WORKFLOW_COMPLETED_HOLD_MS,
  type VisualTimeline,
} from './useVisualTimeline'
import { outstandingTaskCounts } from './workflowCounts'

const CLIENT_POINT = { x: 90, y: 225 }

export function WorkflowLayer({
  snapshot,
  nowMs,
  presentationNowMs,
  timeline,
}: {
  snapshot: SimulationSnapshot
  nowMs: number
  presentationNowMs: number
  timeline: VisualTimeline
}) {
  const core = serviceCorePoint()
  const existingIds = new Set(snapshot.workflows.map((workflow) => workflow.id))
  const plans = [...timeline.workflows.values()]
  const visiblePlans = plans
    .filter((plan) => nowMs >= plan.coreArrival && existingIds.has(plan.workflowId))
    .slice(0, 20)
  const layout = compactWorkflowPoints(visiblePlans.map((plan) => plan.workflowId))
  const incomingPlans = plans.filter((plan) => existingIds.has(plan.workflowId)).slice(0, 20)
  const incomingLayout = compactWorkflowPoints(incomingPlans.map((plan) => plan.workflowId))
  const taskCounts = outstandingTaskCounts(snapshot.tasks)

  return (
    <g className="workflow-layer">
      {plans.map((plan) => {
        if (nowMs >= plan.coreArrival) return null
        const progress = Math.max(0, Math.min(1, (nowMs - plan.requestStart) / CLIENT_TO_CORE_MS))
        const destination = incomingLayout.get(plan.workflowId) ?? core
        return (
          <circle
            key={`request-${plan.workflowId}`}
            cx={CLIENT_POINT.x + (destination.x - CLIENT_POINT.x) * progress}
            cy={CLIENT_POINT.y + (destination.y - CLIENT_POINT.y) * progress}
            r="7"
            className="workflow-start"
          >
            <title>Workflow Start for {plan.workflowId}</title>
          </circle>
        )
      })}
      {visiblePlans.map((plan) => {
        const point = layout.get(plan.workflowId)!
        const completed = plan.completedPresentationAt !== undefined
        const outstandingTasks = taskCounts.get(plan.workflowId) ?? 0
        const fadeProgress = completed
          ? Math.max(0, Math.min(1, (
            presentationNowMs - plan.completedPresentationAt! - WORKFLOW_COMPLETED_HOLD_MS
          ) / WORKFLOW_COMPLETED_FADE_MS))
          : 0
        return (
          <g key={plan.workflowId} style={{ opacity: 1 - fadeProgress }}>
            <circle cx={point.x} cy={point.y} r="9" className={`workflow-execution${completed ? ' completed' : ''}`}>
              <title>{plan.workflowId}{completed ? ' - completed' : ` - ${outstandingTasks} outstanding Tasks`}</title>
            </circle>
            <text
              x={point.x}
              y={point.y + 4}
              textAnchor="middle"
              className={completed ? 'workflow-check' : 'workflow-task-count'}
            >
              {completed ? '✓' : outstandingTasks}
            </text>
          </g>
        )
      })}
    </g>
  )
}
