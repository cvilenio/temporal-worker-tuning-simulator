export type TaskType = 'workflow' | 'activity'
export type WorkflowPhase = 'initial' | 'waiting' | 'decision' | 'final' | 'completed'
export type TaskState = 'enqueuing' | 'queued' | 'acquired' | 'dispatching' | 'running' | 'returning' | 'completed'
export type PollerState = 'polling' | 'dispatching'
export type SlotState = 'available' | 'reserved' | 'occupied' | 'draining'
export type TaskResourceProfile = 'cpu' | 'io'

export interface SimulationConfig {
  workflowStartRate: number
  activitiesPerWorkflow: number
  activityFanout: number
  workflowPollers: number
  activityPollers: number
  workflowSlots: number
  activitySlots: number
  cpuCapacity: number
  workflowTaskResourceProfile: TaskResourceProfile
  activityTaskResourceProfile: TaskResourceProfile
  taskResourceProfilesLocked: boolean
  workflowTaskCpuDemand: number
  activityTaskCpuDemand: number
  workflowTaskIoDemand: number
  activityTaskIoDemand: number
}

export interface WorkflowExecution {
  id: string
  state: WorkflowPhase
  createdAt: number
  initialTaskIssueJitter: number
  completedAt?: number
  activitiesExpected: number
  activityFanout: number
  activitiesScheduled: number
  activitiesCompleted: number
  pendingWorkflowEvents: number
  workflowTaskOutstanding: boolean
  finalWorkflowTaskScheduled: boolean
}

export interface BaseTask {
  id: string
  workflowId: string
  type: TaskType
  state: TaskState
  scheduledAt: number
  enqueueStartedAt: number
  dispatchStartedAt?: number
  startedAt?: number
  completedAt?: number
  assignedPollerId?: string
  assignedSlotId?: string
  sourceSlotId?: string
  createdFrom: 'workflow' | 'workflow-slot' | 'activity-slot'
  enqueueRemaining: number
  queuedAt?: number
  pollEligibleAt?: number
  dispatchRemaining: number
  slotDispatchStartedAt?: number
  slotDispatchRemaining: number
  completionReturnRemaining: number
  dispatchBatchIndex?: number
  cpuWorkRemaining: number
  maxCpuDemand: number
  ioWorkRemaining: number
  maxIoDemand: number
  resourceProfile: TaskResourceProfile
}

export interface WorkflowTask extends BaseTask {
  type: 'workflow'
  phase: 'initial' | 'decision' | 'final'
}

export interface ActivityTask extends BaseTask {
  type: 'activity'
  activityIndex: number
}

export type SimulationTask = WorkflowTask | ActivityTask

export interface Poller {
  id: string
  type: TaskType
  state: PollerState
  taskId?: string
}

export interface Slot {
  id: string
  type: TaskType
  state: SlotState
  taskId?: string
  ordinal: number
}

export interface SemanticEvent {
  id: number
  timestamp: number
  type: string
  workflowId?: string
  taskId?: string
  pollerId?: string
  slotId?: string
  sourceSlotId?: string
  sourceTaskId?: string
  activityTaskIds?: string[]
}

export interface RollingMetrics {
  activityThroughput: number
  totalTaskThroughput: number
  workflowTaskThroughput: number
  activityTaskThroughput: number
  workflowCompletions: number
  slotResidenceSeconds: number
  workflowScheduleToStart: number
  activityScheduleToStart: number
}

export interface MetricSample {
  timestamp: number
  value: number
  throttled: boolean
}

export interface TaskThroughputSample {
  timestamp: number
  total: number
  workflow: number
  activity: number
  throttled: boolean
}

export interface SimulationSnapshot {
  simulatedTime: number
  config: SimulationConfig
  workflows: WorkflowExecution[]
  tasks: SimulationTask[]
  workflowQueue: string[]
  activityQueue: string[]
  workflowPollers: Poller[]
  activityPollers: Poller[]
  workflowSlots: Slot[]
  activitySlots: Slot[]
  cpuUtilization: number
  cpuDemand: number
  cpuThrottled: boolean
  memoryUtilization: number
  ioUtilization: number
  ioDemand: number
  ioThrottled: boolean
  metrics: RollingMetrics
  slotResidenceHistory: MetricSample[]
  taskThroughputHistory: TaskThroughputSample[]
  workflowCompletionHistory: MetricSample[]
  recentEvents: SemanticEvent[]
}
