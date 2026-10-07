export type TaskType = 'workflow' | 'activity'
export type WorkflowPhase = 'initial' | 'waiting' | 'decision' | 'final' | 'completed'
export type TaskState = 'enqueuing' | 'queued' | 'acquired' | 'dispatching' | 'running' | 'returning' | 'completed'
export type PollerState = 'long-polling' | 'task-received' | 'dispatching'
export type SlotState = 'available' | 'reserved' | 'occupied' | 'draining'
export type TaskResourceProfile = 'cpu' | 'io'
export type TaskExecutionPhase = 'replay' | 'decision' | 'activity'
export type WorkflowTaskRoutingState = 'shared-queue' | 'sticky-wait' | 'shared-fallback'
export type CacheEvictionReason = 'CAPACITY' | 'MEMORY_PRESSURE' | 'WORKFLOW_COMPLETED' | 'WORKER_REMOVED' | 'STICKY_FALLBACK'

export interface SimulationConfig {
  workflowStartRate: number
  activitiesPerWorkflow: number
  activityFanout: number
  workerCount: number
  workflowPollers: number
  activityPollers: number
  workflowSlots: number
  activitySlots: number
  cpuCapacity: number
  workflowCacheCapacity: number
  workflowCacheEntryMemoryMb: number
  memoryCapacityMb: number
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
  displayId: string
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
  historyUnits: number
  cachedWorkerId: string | null
  lastCacheAccessAt: number | null
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
  assignedWorkerId?: string
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
  executionPhase: TaskExecutionPhase
  replayCpuWorkRemaining: number
  replayCpuWorkTotal: number
  cacheOutcome?: 'hit' | 'miss'
}

export interface WorkflowTask extends BaseTask {
  type: 'workflow'
  phase: 'initial' | 'decision' | 'final'
  routingState: WorkflowTaskRoutingState
  preferredWorkerId?: string
  stickyWaitStartedAt?: number
  stickyFallbackAt?: number
}

export interface ActivityTask extends BaseTask {
  type: 'activity'
  activityIndex: number
}

export type SimulationTask = WorkflowTask | ActivityTask

export interface Poller {
  id: string
  workerId: string
  type: TaskType
  state: PollerState
  taskId?: string
}

export interface Slot {
  id: string
  workerId: string
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
  workerId?: string
  preferredWorkerId?: string
  routingState?: WorkflowTaskRoutingState
  reason?: CacheEvictionReason
  replayCpuSeconds?: number
}

export interface WorkflowCacheEntry {
  workflowId: string
  displayId: string
  workerId: string
  insertedAt: number
  lastUsedAt: number
  memoryMb: number
}

export interface CacheMetrics {
  cacheSize: number
  cacheCapacity: number
  cacheHits: number
  cacheMisses: number
  cacheEvictions: number
  cacheHitRate: number
  replaysStarted: number
  replayCpuSeconds: number
}

export interface WorkerSnapshot {
  id: string
  displayId: string
  status: 'active' | 'draining'
  workflowPollers: Poller[]
  activityPollers: Poller[]
  workflowSlots: Slot[]
  activitySlots: Slot[]
  cpuUtilization: number
  cpuDemand: number
  cpuThrottled: boolean
  memoryUtilization: number
  memoryUsedMb: number
  ioUtilization: number
  ioDemand: number
  ioThrottled: boolean
  workflowCache: WorkflowCacheEntry[]
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
  replaying: boolean
}

export interface TaskThroughputSample {
  timestamp: number
  total: number
  workflow: number
  activity: number
  throttled: boolean
  replaying: boolean
}

export interface SimulationSnapshot {
  simulatedTime: number
  config: SimulationConfig
  workflows: WorkflowExecution[]
  tasks: SimulationTask[]
  workflowQueue: string[]
  activityQueue: string[]
  workers: WorkerSnapshot[]
  workflowPollers: Poller[]
  activityPollers: Poller[]
  workflowSlots: Slot[]
  activitySlots: Slot[]
  cpuUtilization: number
  cpuDemand: number
  cpuThrottled: boolean
  memoryUtilization: number
  memoryUsedMb: number
  ioUtilization: number
  ioDemand: number
  ioThrottled: boolean
  workflowCache: WorkflowCacheEntry[]
  cacheMetrics: CacheMetrics
  metrics: RollingMetrics
  slotResidenceHistory: MetricSample[]
  taskThroughputHistory: TaskThroughputSample[]
  workflowCompletionHistory: MetricSample[]
  recentEvents: SemanticEvent[]
}
