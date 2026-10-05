import { IO_CAPACITY, type Poller, type SimulationSnapshot, type Slot } from '../simulation'
import {
  activityLaneY,
  maxVisibleQueueTasks,
  pollerPoint,
  returnLaneY,
  serviceCoreBounds,
  slotGroupTop,
  slotPoint,
  workflowLaneY,
} from './geometry'
import { ResultLayer } from './ResultLayer'
import { TaskLayer } from './TaskLayer'
import type { VisualTimeline } from './useVisualTimeline'
import { WorkflowLayer } from './WorkflowLayer'

const MAX_WORKFLOWS = 20

function compactNumber(value: number): string {
  return Number(value.toFixed(2)).toString()
}

function Pollers({ pollers, y }: { pollers: Poller[]; y: number }) {
  return (
    <g>
      {pollers.map((poller, index) => {
        const point = pollerPoint(index, pollers.length, y)
        return (
          <circle key={poller.id} cx={point.x} cy={point.y} r="8" className={`poller ${poller.state}`}>
            <title>{poller.id} - {poller.state}</title>
          </circle>
        )
      })}
    </g>
  )
}

function Slots({ slots, y }: { slots: Slot[]; y: number }) {
  return (
    <g>
      {slots.map((slot, index) => {
        const point = slotPoint(index, slots.length, y)
        return (
          <rect key={slot.id} x={point.x - 14} y={point.y - 14} width="28" height="28" rx="3" className={`slot ${slot.state}`}>
            <title>{slot.id} - {slot.state}</title>
          </rect>
        )
      })}
    </g>
  )
}

function Overflow({ count, x, y }: { count: number; x: number; y: number }) {
  if (count <= maxVisibleQueueTasks) return null
  return <text x={x} y={y} className="overflow">+{count - maxVisibleQueueTasks}</text>
}

function ResourceBar({
  resource,
  label,
  y,
  utilization,
  throttled = false,
  detail,
  fillClass,
}: {
  resource: 'cpu' | 'memory' | 'io'
  label: string
  y: number
  utilization: number
  throttled?: boolean
  detail?: string
  fillClass: string
}) {
  const percent = Math.round(utilization * 100)
  return (
    <g data-resource={resource} data-utilization={utilization} data-throttled={throttled}>
      {throttled && <title>{label} throughput is being throttled</title>}
      <text x="785" y={y + 13} className="section-label">{label}</text>
      <rect x="875" y={y} width="180" height="18" rx="3" className="resource-track" />
      <rect x="875" y={y} width={180 * utilization} height="18" rx="3" className={`resource-fill ${fillClass}${throttled ? ' throttled' : ''}`} />
      <text x="1160" y={y + 13} textAnchor="end" className="metric-value">
        {percent}%{detail ? ` (${detail})` : ''}
      </text>
    </g>
  )
}

export function SimulationScene({
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
  const activeWorkflows = [...timeline.workflows.values()].filter((workflow) => nowMs >= workflow.coreArrival)
  const workflowQueueDepth = snapshot.workflowQueue.length
  const activityQueueDepth = snapshot.activityQueue.length
  const returnActive = [...timeline.tasks.values()].some((task) =>
    task.completionStart !== undefined
    && task.resultArrival !== undefined
    && nowMs >= task.completionStart
    && nowMs < task.resultArrival,
  )
  const workflowSlotLabelY = Math.min(workflowLaneY - 46, slotGroupTop(snapshot.workflowSlots.length, workflowLaneY) - 12)
  const activitySlotLabelY = Math.min(activityLaneY - 44, slotGroupTop(snapshot.activitySlots.length, activityLaneY) - 12)

  return (
    <svg className="simulation-scene" viewBox="0 0 1200 600" role="img" aria-label="Temporal Worker simulation">
      <defs>
        <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
          <path d="M0,0 L0,6 L7,3 z" className="arrow-head" />
        </marker>
        <marker id="return-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
          <path d="M0,0 L0,6 L7,3 z" className="return-arrow-head" />
        </marker>
      </defs>

      <rect x="20" y="40" width="140" height="540" rx="8" className="region" />
      <text x="40" y="73" className="region-title">CLIENT</text>
      <polygon points="103,225 84,214 84,236" className="client-emitter" />
      <text x="48" y="201" className="path-label">Workflow Start</text>
      <line x1="130" y1="225" x2="205" y2="225" className="flow-line" markerEnd="url(#arrow)" />

      <rect x="180" y="40" width="550" height="540" rx="8" className="region temporal-region" />
      <text x="200" y="73" className="region-title">TEMPORAL SERVICE</text>

      <rect
        x={serviceCoreBounds.x}
        y={serviceCoreBounds.y}
        width={serviceCoreBounds.width}
        height={serviceCoreBounds.height}
        rx="6"
        className="service-core"
      />
      <text x="225" y="125" className="core-title">Temporal Service Core</text>
      <text x="225" y="147" className="core-subtitle">Workflow state / history</text>
      <text x="225" y="165" className="core-subtitle">Task scheduling</text>
      <text x="225" y="195" className="section-label">Active Workflows</text>
      {activeWorkflows.length > MAX_WORKFLOWS && <text x="345" y="310" className="overflow">+{activeWorkflows.length - MAX_WORKFLOWS}</text>}

      <text x="425" y="150" className="queue-group-label">WORKFLOW LANE</text>
      <text x="425" y={workflowLaneY - 46} className="section-label">Workflow Task Queue ({workflowQueueDepth})</text>
      <rect x="425" y={workflowLaneY - 36} width="280" height="72" rx="4" className="queue" />
      <Overflow count={workflowQueueDepth} x={665} y={workflowLaneY + 23} />

      <text x="425" y="350" className="queue-group-label">ACTIVITY LANE</text>
      <text x="425" y={activityLaneY - 44} className="section-label">Activity Task Queue ({activityQueueDepth})</text>
      <rect x="425" y={activityLaneY - 36} width="280" height="72" rx="4" className="queue" />
      <Overflow count={activityQueueDepth} x={665} y={activityLaneY + 23} />

      <rect x="760" y="40" width="420" height="540" rx="8" className="region worker-region" />
      <text x="780" y="73" className="region-title">WORKER</text>
      <text x="785" y="190" className="section-label">Workflow Pollers</text>
      <Pollers pollers={snapshot.workflowPollers} y={workflowLaneY} />
      <text x="930" y={workflowSlotLabelY} className="section-label">Workflow Slots</text>
      <Slots slots={snapshot.workflowSlots} y={workflowLaneY} />

      <text x="785" y="380" className="section-label">Activity Pollers</text>
      <Pollers pollers={snapshot.activityPollers} y={activityLaneY} />
      <text x="930" y={activitySlotLabelY} className="section-label">Activity Slots</text>
      <Slots slots={snapshot.activitySlots} y={activityLaneY} />

      <ResourceBar resource="cpu" label="CPU" y={501} utilization={snapshot.cpuUtilization} throttled={snapshot.cpuThrottled} detail={`${compactNumber(snapshot.cpuDemand)} / ${snapshot.config.cpuCapacity} CPU`} fillClass="cpu-fill" />
      <ResourceBar resource="memory" label="Memory" y={527} utilization={snapshot.memoryUtilization} fillClass="memory-fill" />
      <ResourceBar resource="io" label="I/O" y={553} utilization={snapshot.ioUtilization} throttled={snapshot.ioThrottled} detail={`${compactNumber(snapshot.ioDemand)} / ${IO_CAPACITY} throughput`} fillClass="io-fill" />

      <circle cx="43" cy="496" r="5" className="workflow-execution" />
      <text x="54" y="500" className="small-label">Workflow</text>
      <rect x="38" y="512" width="9" height="9" className="task-workflow" />
      <text x="54" y="521" className="small-label">Workflow Task</text>
      <rect x="38" y="530" width="9" height="9" className="task-activity" />
      <text x="54" y="539" className="small-label">Activity Task</text>
      <polygon points="43,548 48,553 43,558 38,553" className="result-pulse" />
      <text x="54" y="557" className="small-label">Command / completion</text>

      <path d={`M 1160 ${returnLaneY} H 390`} className={`return-rail${returnActive ? ' active' : ''}`} markerEnd="url(#return-arrow)" />
      <text x="615" y={returnLaneY - 11} className="return-rail-label">COMMAND / COMPLETION RETURN</text>

      <ResultLayer snapshot={snapshot} nowMs={nowMs} timeline={timeline} />
      <WorkflowLayer snapshot={snapshot} nowMs={nowMs} presentationNowMs={presentationNowMs} timeline={timeline} />
      <TaskLayer snapshot={snapshot} />
    </svg>
  )
}
