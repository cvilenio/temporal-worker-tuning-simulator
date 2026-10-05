import {
  ACTIVITY_CPU_BASE_DURATION_SECONDS,
  ACTIVITY_IO_BASE_DURATION_SECONDS,
  ACTIVITY_MAX_CPU_DEMAND,
  CPU_CONTENTION_KNEE,
  CPU_CAPACITY_OPTIONS,
  CPU_MAX_CONTENTION_SPEED_LOSS,
  COMPLETION_RETURN_SECONDS,
  IO_CAPACITY,
  IO_CONTENTION_KNEE,
  IO_MAX_CONTENTION_SPEED_LOSS,
  MAX_RECENT_EVENTS,
  METRIC_SAMPLE_SECONDS,
  METRIC_WINDOW_SECONDS,
  POLL_DISPATCH_SECONDS,
  QUEUE_ADMISSION_SECONDS,
  QUEUE_DWELL_SECONDS,
  SLOT_DISPATCH_SECONDS,
  TASK_ENQUEUE_STAGGER_SECONDS,
  TICK_SECONDS,
  WORKFLOW_CPU_BASE_DURATION_SECONDS,
  WORKFLOW_IO_BASE_DURATION_SECONDS,
  WORKFLOW_MAX_CPU_DEMAND,
  WORKFLOW_START_TRANSIT_SECONDS,
  WORKFLOW_TASK_ISSUE_DELAY_SECONDS,
  WORKFLOW_TASK_ISSUE_JITTER_SECONDS,
} from './constants'
import type {
  ActivityTask,
  Poller,
  SemanticEvent,
  SimulationConfig,
  MetricSample,
  SimulationSnapshot,
  SimulationTask,
  Slot,
  TaskResourceProfile,
  TaskType,
  TaskThroughputSample,
  WorkflowExecution,
  WorkflowTask,
} from './types'
import { resourceProgressScale } from './resources'

export const defaultConfig: SimulationConfig = {
  workflowStartRate: 0.1,
  activitiesPerWorkflow: 3,
  activityFanout: 3,
  workflowPollers: 2,
  activityPollers: 2,
  workflowSlots: 2,
  activitySlots: 2,
  cpuCapacity: 1,
  workflowTaskResourceProfile: 'cpu',
  activityTaskResourceProfile: 'cpu',
  taskResourceProfilesLocked: true,
  workflowTaskCpuDemand: WORKFLOW_MAX_CPU_DEMAND,
  activityTaskCpuDemand: ACTIVITY_MAX_CPU_DEMAND,
  workflowTaskIoDemand: WORKFLOW_MAX_CPU_DEMAND,
  activityTaskIoDemand: WORKFLOW_MAX_CPU_DEMAND,
}

function normalizeConfig(config: SimulationConfig): SimulationConfig {
  const cpuDemand = (value: number) => Math.max(0.05, Math.min(1, Math.round(value * 20) / 20))
  const cpuCapacity = CPU_CAPACITY_OPTIONS.reduce((nearest, option) =>
    Math.abs(option - config.cpuCapacity) < Math.abs(nearest - config.cpuCapacity) ? option : nearest,
  )
  const workflowTaskResourceProfile = config.workflowTaskResourceProfile === 'io' ? 'io' : 'cpu'
  const activityTaskResourceProfile = config.taskResourceProfilesLocked
    ? workflowTaskResourceProfile
    : config.activityTaskResourceProfile === 'io' ? 'io' : 'cpu'
  return {
    ...config,
    cpuCapacity,
    workflowTaskResourceProfile,
    activityTaskResourceProfile,
    taskResourceProfilesLocked: Boolean(config.taskResourceProfilesLocked),
    workflowTaskCpuDemand: cpuDemand(config.workflowTaskCpuDemand),
    activityTaskCpuDemand: cpuDemand(config.activityTaskCpuDemand),
    workflowTaskIoDemand: cpuDemand(config.workflowTaskIoDemand),
    activityTaskIoDemand: cpuDemand(config.activityTaskIoDemand),
  }
}

interface CompletionRecord {
  timestamp: number
  type: 'activity' | 'workflow'
}

interface SlotResidenceRecord {
  timestamp: number
  seconds: number
}

interface TaskCompletionRecord {
  timestamp: number
  type: TaskType
}

export class Simulation {
  private config: SimulationConfig
  private readonly seed: number
  private time = 0
  private arrivalAccumulator = 0
  private nextWorkflowId = 1
  private nextWorkflowTaskId = 1
  private nextActivityTaskId = 1
  private nextEventId = 1
  private workflows = new Map<string, WorkflowExecution>()
  private tasks = new Map<string, SimulationTask>()
  private workflowQueue: string[] = []
  private activityQueue: string[] = []
  private workflowPollers: Poller[] = []
  private activityPollers: Poller[] = []
  private workflowSlots: Slot[] = []
  private activitySlots: Slot[] = []
  private events: SemanticEvent[] = []
  private completions: CompletionRecord[] = []
  private slotResidences: SlotResidenceRecord[] = []
  private slotResidenceHistory: MetricSample[] = [{ timestamp: 0, value: 0, throttled: false }]
  private taskCompletions: TaskCompletionRecord[] = []
  private taskThroughputHistory: TaskThroughputSample[] = [{
    timestamp: 0,
    total: 0,
    workflow: 0,
    activity: 0,
    throttled: false,
  }]
  private workflowCompletionHistory: MetricSample[] = [{ timestamp: 0, value: 0, throttled: false }]
  private cpuUtilization = 0
  private cpuDemand = 0
  private cpuThrottled = false
  private ioUtilization = 0
  private ioDemand = 0
  private ioThrottled = false
  private throttledSinceLastMetricSample = false

  constructor(config: Partial<SimulationConfig> = {}, seed = 1) {
    this.config = normalizeConfig({ ...defaultConfig, ...config })
    this.seed = seed
    this.syncCapacity()
  }

  step(deltaSeconds = TICK_SECONDS): void {
    const ticks = Math.round(deltaSeconds / TICK_SECONDS)
    for (let index = 0; index < ticks; index += 1) this.tick()
  }

  updateConfig(changes: Partial<SimulationConfig>): void {
    const previousWorkflowProfile = this.config.workflowTaskResourceProfile
    const previousActivityProfile = this.config.activityTaskResourceProfile
    const profilesLocked = changes.taskResourceProfilesLocked ?? this.config.taskResourceProfilesLocked
    const merged = { ...this.config, ...changes }
    if (profilesLocked) {
      const sharedProfile = changes.workflowTaskResourceProfile
        ?? changes.activityTaskResourceProfile
        ?? this.config.workflowTaskResourceProfile
      merged.workflowTaskResourceProfile = sharedProfile
      merged.activityTaskResourceProfile = sharedProfile
    }
    this.config = normalizeConfig(merged)
    if (this.config.workflowTaskResourceProfile !== previousWorkflowProfile) {
      this.reprofilePendingTasks('workflow', this.config.workflowTaskResourceProfile)
    }
    if (this.config.activityTaskResourceProfile !== previousActivityProfile) {
      this.reprofilePendingTasks('activity', this.config.activityTaskResourceProfile)
    }
    this.syncCapacity()
  }

  startWorkflow(): void {
    this.startWorkflows(1)
  }

  startWorkflows(count: number): void {
    const total = Math.max(0, Math.floor(count))
    for (let index = 0; index < total; index += 1) this.createWorkflow()
  }

  reset(): void {
    const config = { ...this.config }
    this.time = 0
    this.arrivalAccumulator = 0
    this.nextWorkflowId = 1
    this.nextWorkflowTaskId = 1
    this.nextActivityTaskId = 1
    this.nextEventId = 1
    this.workflows.clear()
    this.tasks.clear()
    this.workflowQueue = []
    this.activityQueue = []
    this.events = []
    this.completions = []
    this.slotResidences = []
    this.slotResidenceHistory = [{ timestamp: 0, value: 0, throttled: false }]
    this.taskCompletions = []
    this.taskThroughputHistory = [{ timestamp: 0, total: 0, workflow: 0, activity: 0, throttled: false }]
    this.workflowCompletionHistory = [{ timestamp: 0, value: 0, throttled: false }]
    this.cpuUtilization = 0
    this.cpuDemand = 0
    this.cpuThrottled = false
    this.ioUtilization = 0
    this.ioDemand = 0
    this.ioThrottled = false
    this.throttledSinceLastMetricSample = false
    this.config = config
    this.workflowPollers = []
    this.activityPollers = []
    this.workflowSlots = []
    this.activitySlots = []
    this.syncCapacity()
  }

  getSnapshot(): SimulationSnapshot {
    const activeTasks = [...this.tasks.values()].filter((task) => task.state !== 'completed')
    const scheduleToStart = (type: TaskType) => {
      const started = [...this.tasks.values()].filter(
        (task) => task.type === type && task.startedAt !== undefined,
      )
      if (started.length === 0) return 0
      return started.reduce((sum, task) => sum + task.startedAt! - task.scheduledAt, 0) / started.length
    }
    const cutoff = this.time - METRIC_WINDOW_SECONDS
    const recent = this.completions.filter((record) => record.timestamp > cutoff)
    const slotResidenceSeconds = this.currentSlotResidenceSeconds()
    const taskThroughput = this.currentTaskThroughput()
    return {
      simulatedTime: this.time,
      config: { ...this.config },
      workflows: [...this.workflows.values()].map((workflow) => ({ ...workflow })),
      tasks: activeTasks.map((task) => ({ ...task })),
      workflowQueue: [...this.workflowQueue],
      activityQueue: [...this.activityQueue],
      workflowPollers: this.workflowPollers.map((poller) => ({ ...poller })),
      activityPollers: this.activityPollers.map((poller) => ({ ...poller })),
      workflowSlots: this.workflowSlots.map((slot) => ({ ...slot })),
      activitySlots: this.activitySlots.map((slot) => ({ ...slot })),
      cpuUtilization: this.cpuUtilization,
      cpuDemand: this.cpuDemand,
      cpuThrottled: this.cpuThrottled,
      memoryUtilization: 0,
      ioUtilization: this.ioUtilization,
      ioDemand: this.ioDemand,
      ioThrottled: this.ioThrottled,
      metrics: {
        activityThroughput: recent.filter((record) => record.type === 'activity').length / METRIC_WINDOW_SECONDS,
        totalTaskThroughput: taskThroughput.total,
        workflowTaskThroughput: taskThroughput.workflow,
        activityTaskThroughput: taskThroughput.activity,
        workflowCompletions: recent.filter((record) => record.type === 'workflow').length / METRIC_WINDOW_SECONDS,
        slotResidenceSeconds,
        workflowScheduleToStart: scheduleToStart('workflow'),
        activityScheduleToStart: scheduleToStart('activity'),
      },
      slotResidenceHistory: this.slotResidenceHistory.map((sample) => ({ ...sample })),
      taskThroughputHistory: this.taskThroughputHistory.map((sample) => ({ ...sample })),
      workflowCompletionHistory: this.workflowCompletionHistory.map((sample) => ({ ...sample })),
      recentEvents: this.events.slice(-MAX_RECENT_EVENTS).map((event) => ({ ...event })),
    }
  }

  getEventsSince(eventId: number): SemanticEvent[] {
    return this.events.filter((event) => event.id > eventId).map((event) => ({ ...event }))
  }

  private tick(): void {
    this.time = this.round(this.time + TICK_SECONDS)
    this.generateArrivals()
    this.advanceWorkflowStarts()
    this.advanceQueueAdmissions()
    this.advanceSlotDispatches()
    this.advanceDispatches('workflow')
    this.advanceDispatches('activity')
    this.advanceCompletionReturns()
    this.trimRetiredPollers()
    this.dispatch('workflow')
    this.dispatch('activity')
    this.allocateResources()
    this.removeDrainedSlots()
    this.completions = this.completions.filter(
      (record) => record.timestamp > this.time - METRIC_WINDOW_SECONDS,
    )
    this.slotResidences = this.slotResidences.filter(
      (record) => record.timestamp > this.time - METRIC_WINDOW_SECONDS,
    )
    this.taskCompletions = this.taskCompletions.filter(
      (record) => record.timestamp > this.time - METRIC_WINDOW_SECONDS,
    )
    const tickNumber = Math.round(this.time / TICK_SECONDS)
    const sampleEveryTicks = Math.round(METRIC_SAMPLE_SECONDS / TICK_SECONDS)
    if (tickNumber % sampleEveryTicks === 0) {
      const throttled = this.throttledSinceLastMetricSample
      this.slotResidenceHistory.push({
        timestamp: this.time,
        value: this.currentSlotResidenceSeconds(),
        throttled,
      })
      this.taskThroughputHistory.push({
        timestamp: this.time,
        ...this.currentTaskThroughput(),
        throttled,
      })
      this.workflowCompletionHistory.push({
        timestamp: this.time,
        value: this.currentWorkflowCompletionRate(),
        throttled,
      })
      this.throttledSinceLastMetricSample = false
    }
  }

  private currentSlotResidenceSeconds(): number {
    if (this.slotResidences.length === 0) return 0
    return this.slotResidences.reduce((sum, record) => sum + record.seconds, 0) / this.slotResidences.length
  }

  private currentTaskThroughput(): Pick<TaskThroughputSample, 'total' | 'workflow' | 'activity'> {
    const workflow = this.taskCompletions.filter((record) => record.type === 'workflow').length / METRIC_WINDOW_SECONDS
    const activity = this.taskCompletions.filter((record) => record.type === 'activity').length / METRIC_WINDOW_SECONDS
    return { total: workflow + activity, workflow, activity }
  }

  private currentWorkflowCompletionRate(): number {
    return this.completions.filter((record) => record.type === 'workflow').length / METRIC_WINDOW_SECONDS
  }

  private trimRetiredPollers(): void {
    this.workflowPollers = this.trimPollers(this.workflowPollers, this.config.workflowPollers)
    this.activityPollers = this.trimPollers(this.activityPollers, this.config.activityPollers)
  }

  private trimPollers(pollers: Poller[], target: number): Poller[] {
    if (pollers.length <= target) return pollers
    const busy = pollers.filter((poller) => poller.state === 'dispatching')
    const idle = pollers.filter((poller) => poller.state === 'polling')
    return [...busy, ...idle.slice(0, Math.max(0, target - busy.length))]
      .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))
  }

  private generateArrivals(): void {
    this.arrivalAccumulator += this.config.workflowStartRate * TICK_SECONDS
    while (this.arrivalAccumulator >= 1) {
      this.arrivalAccumulator -= 1
      this.createWorkflow()
    }
  }

  private createWorkflow(): void {
    const ordinal = this.nextWorkflowId++
    const id = `workflow-${ordinal}`
    const workflow: WorkflowExecution = {
      id,
      state: 'initial',
      createdAt: this.time,
      initialTaskIssueJitter: this.workflowIssueJitter(ordinal),
      activitiesExpected: this.config.activitiesPerWorkflow,
      activityFanout: this.config.activityFanout,
      activitiesScheduled: 0,
      activitiesCompleted: 0,
      pendingWorkflowEvents: 1,
      workflowTaskOutstanding: false,
      finalWorkflowTaskScheduled: false,
    }
    this.emit('WORKFLOW_START_REQUESTED', { workflowId: id })
    this.workflows.set(id, workflow)
    this.emit('WORKFLOW_CREATED', { workflowId: id })
  }

  private advanceWorkflowStarts(): void {
    for (const workflow of this.workflows.values()) {
      if (workflow.state !== 'initial' || workflow.workflowTaskOutstanding) continue
      const issueAt = workflow.createdAt
        + WORKFLOW_START_TRANSIT_SECONDS
        + WORKFLOW_TASK_ISSUE_DELAY_SECONDS
        + workflow.initialTaskIssueJitter
      if (this.time < this.round(issueAt)) continue
      this.scheduleWorkflowTask(workflow, 'initial')
    }
  }

  private scheduleWorkflowTask(
    workflow: WorkflowExecution,
    phase: 'initial' | 'decision' | 'final',
    source?: SimulationTask,
  ): void {
    if (workflow.workflowTaskOutstanding) return
    const resourceProfile = this.config.workflowTaskResourceProfile
    const resourceDemand = this.taskResourceDemand('workflow', resourceProfile)
    const resourceWork = this.taskResourceWork('workflow', resourceProfile)
    const task: WorkflowTask = {
      id: `workflow-task-${this.nextWorkflowTaskId++}`,
      workflowId: workflow.id,
      type: 'workflow',
      phase,
      state: 'enqueuing',
      scheduledAt: this.time,
      enqueueStartedAt: this.time,
      enqueueRemaining: QUEUE_ADMISSION_SECONDS,
      dispatchRemaining: 0,
      slotDispatchRemaining: 0,
      completionReturnRemaining: 0,
      cpuWorkRemaining: resourceProfile === 'cpu' ? resourceWork : 0,
      maxCpuDemand: resourceProfile === 'cpu' ? resourceDemand : 0,
      ioWorkRemaining: resourceProfile === 'io' ? resourceWork : 0,
      maxIoDemand: resourceProfile === 'io' ? resourceDemand : 0,
      resourceProfile,
      sourceSlotId: source?.assignedSlotId,
      createdFrom: source ? 'activity-slot' : 'workflow',
    }
    this.tasks.set(task.id, task)
    workflow.workflowTaskOutstanding = true
    this.emit('WORKFLOW_TASK_SCHEDULED', {
      workflowId: workflow.id,
      taskId: task.id,
      sourceTaskId: source?.id,
      sourceSlotId: source?.assignedSlotId,
    })
  }

  private advanceQueueAdmissions(): void {
    for (const task of this.tasks.values()) {
      if (task.state !== 'enqueuing') continue
      if (this.time < task.enqueueStartedAt) continue
      task.enqueueRemaining = this.round(task.enqueueRemaining - TICK_SECONDS)
      if (task.enqueueRemaining > 0) continue
      task.state = 'queued'
      task.queuedAt = this.time
      task.pollEligibleAt = this.round(this.time + QUEUE_DWELL_SECONDS)
      const queue = task.type === 'workflow' ? this.workflowQueue : this.activityQueue
      queue.push(task.id)
      this.emit(task.type === 'workflow' ? 'WORKFLOW_TASK_QUEUED' : 'ACTIVITY_TASK_QUEUED', {
        workflowId: task.workflowId,
        taskId: task.id,
      })
    }
  }

  private advanceDispatches(type: TaskType): void {
    const pollers = this.getPollers(type)
    for (const poller of pollers) {
      if (poller.state !== 'dispatching' || !poller.taskId) continue
      const task = this.tasks.get(poller.taskId)
      if (!task) continue
      task.dispatchRemaining = this.round(task.dispatchRemaining - TICK_SECONDS)
      if (task.dispatchRemaining > 0) continue
      task.state = 'dispatching'
      task.slotDispatchStartedAt = this.time
      task.slotDispatchRemaining = SLOT_DISPATCH_SECONDS
      poller.state = 'polling'
      poller.taskId = undefined
      this.emit(type === 'workflow' ? 'WORKFLOW_TASK_SLOT_DISPATCH_STARTED' : 'ACTIVITY_TASK_SLOT_DISPATCH_STARTED', {
        workflowId: task.workflowId,
        taskId: task.id,
        pollerId: task.assignedPollerId,
        slotId: task.assignedSlotId,
      })
    }
  }

  private advanceSlotDispatches(): void {
    for (const task of this.tasks.values()) {
      if (task.state !== 'dispatching') continue
      task.slotDispatchRemaining = this.round(task.slotDispatchRemaining - TICK_SECONDS)
      if (task.slotDispatchRemaining > 0) continue
      task.state = 'running'
      task.startedAt = this.time
      const slot = this.getSlots(task.type).find((candidate) => candidate.id === task.assignedSlotId)
      if (slot) slot.state = 'occupied'
      this.emit(task.type === 'workflow' ? 'WORKFLOW_TASK_STARTED' : 'ACTIVITY_TASK_STARTED', {
        workflowId: task.workflowId,
        taskId: task.id,
        slotId: task.assignedSlotId,
      })
    }
  }

  private dispatch(type: TaskType): void {
    const queue = type === 'workflow' ? this.workflowQueue : this.activityQueue
    const availablePollers = this.getPollers(type).filter((poller) => poller.state === 'polling')
    const availableSlots = this.getSlots(type).filter((slot) => slot.state === 'available')
    const eligibleCount = queue.findIndex((taskId) => {
      const task = this.tasks.get(taskId)!
      return (task.pollEligibleAt ?? Infinity) > this.time
    })
    const eligiblePrefix = eligibleCount === -1 ? queue.length : eligibleCount
    const count = Math.min(eligiblePrefix, availablePollers.length, availableSlots.length)
    for (let index = 0; index < count; index += 1) {
      const taskId = queue.shift()!
      const task = this.tasks.get(taskId)!
      const poller = availablePollers[index]
      const slot = availableSlots[index]
      task.state = 'acquired'
      task.dispatchStartedAt = this.time
      task.dispatchRemaining = POLL_DISPATCH_SECONDS
      task.assignedPollerId = poller.id
      task.assignedSlotId = slot.id
      task.dispatchBatchIndex = index
      poller.state = 'dispatching'
      poller.taskId = task.id
      slot.state = 'reserved'
      slot.taskId = task.id
      this.emit(type === 'workflow' ? 'WORKFLOW_TASK_DISPATCH_STARTED' : 'ACTIVITY_TASK_DISPATCH_STARTED', {
        workflowId: task.workflowId,
        taskId: task.id,
        pollerId: poller.id,
        slotId: slot.id,
      })
    }
  }

  private allocateResources(): void {
    const running = [...this.tasks.values()].filter((task) => task.state === 'running')
    const cpuActive = running.filter((task) => (task.cpuWorkRemaining ?? 0) > 0)
    const desiredCpu = cpuActive.reduce((sum, task) => sum + task.maxCpuDemand, 0)
    this.cpuDemand = desiredCpu
    this.cpuUtilization = Math.min(desiredCpu / this.config.cpuCapacity, 1)
    const cpuScale = resourceProgressScale(desiredCpu, this.config.cpuCapacity, {
      knee: CPU_CONTENTION_KNEE,
      maxSpeedLoss: CPU_MAX_CONTENTION_SPEED_LOSS,
    })
    this.cpuThrottled = desiredCpu > 0 && cpuScale < 1
    for (const task of cpuActive) {
      task.cpuWorkRemaining = this.round(
        task.cpuWorkRemaining - task.maxCpuDemand * cpuScale * TICK_SECONDS,
      )
    }

    const ioActive = running.filter((task) => (task.ioWorkRemaining ?? 0) > 0)
    const desiredIo = ioActive.reduce((sum, task) => sum + task.maxIoDemand, 0)
    this.ioDemand = desiredIo
    this.ioUtilization = Math.min(desiredIo / IO_CAPACITY, 1)
    const ioScale = resourceProgressScale(desiredIo, IO_CAPACITY, {
      knee: IO_CONTENTION_KNEE,
      maxSpeedLoss: IO_MAX_CONTENTION_SPEED_LOSS,
    })
    this.ioThrottled = desiredIo > 0 && ioScale < 1
    this.throttledSinceLastMetricSample ||= this.cpuThrottled || this.ioThrottled
    for (const task of ioActive) {
      task.ioWorkRemaining = this.round(
        task.ioWorkRemaining - task.maxIoDemand * ioScale * TICK_SECONDS,
      )
    }

    for (const task of running) {
      if ((task.cpuWorkRemaining ?? 0) <= 0 && (task.ioWorkRemaining ?? 0) <= 0) {
        this.beginCompletionReturn(task)
      }
    }
  }

  private beginCompletionReturn(task: SimulationTask): void {
    task.state = 'returning'
    task.completionReturnRemaining = COMPLETION_RETURN_SECONDS
    if (task.dispatchStartedAt !== undefined) {
      this.slotResidences.push({
        timestamp: this.time,
        seconds: this.round(this.time - task.dispatchStartedAt),
      })
    }
    const slot = this.getSlots(task.type).find((candidate) => candidate.id === task.assignedSlotId)
    if (slot) {
      slot.taskId = undefined
      slot.state = slot.ordinal > this.slotLimit(task.type) ? 'draining' : 'available'
    }
    this.emit(task.type === 'workflow' ? 'WORKFLOW_TASK_RETURN_STARTED' : 'ACTIVITY_TASK_RETURN_STARTED', {
      workflowId: task.workflowId,
      taskId: task.id,
      slotId: task.assignedSlotId,
    })
  }

  private advanceCompletionReturns(): void {
    for (const task of this.tasks.values()) {
      if (task.state !== 'returning') continue
      task.completionReturnRemaining = this.round(task.completionReturnRemaining - TICK_SECONDS)
      if (task.completionReturnRemaining > 0) continue
      this.completeTask(task)
    }
  }

  private completeTask(task: SimulationTask): void {
    task.state = 'completed'
    task.completedAt = this.time
    this.taskCompletions.push({ timestamp: this.time, type: task.type })
    const workflow = this.workflows.get(task.workflowId)!
    if (task.type === 'workflow') {
      workflow.workflowTaskOutstanding = false
      workflow.pendingWorkflowEvents = 0
      this.emit('WORKFLOW_TASK_COMPLETED', {
        workflowId: workflow.id,
        taskId: task.id,
        slotId: task.assignedSlotId,
      })
      if (task.phase === 'final') this.completeWorkflow(workflow)
      else this.scheduleActivityBatch(workflow, task)
    } else {
      workflow.activitiesCompleted += 1
      workflow.pendingWorkflowEvents += 1
      this.completions.push({ timestamp: this.time, type: 'activity' })
      this.emit('ACTIVITY_TASK_COMPLETED', {
        workflowId: workflow.id,
        taskId: task.id,
        slotId: task.assignedSlotId,
      })
      const batchCompleted = workflow.activitiesCompleted === workflow.activitiesScheduled
      if (!batchCompleted) return
      const allActivitiesCompleted = workflow.activitiesCompleted === workflow.activitiesExpected
      if (allActivitiesCompleted && !workflow.finalWorkflowTaskScheduled) {
        workflow.finalWorkflowTaskScheduled = true
        workflow.state = 'final'
        this.ensureWorkflowTask(workflow, 'final', task)
      } else if (!allActivitiesCompleted) {
        workflow.state = 'decision'
        this.ensureWorkflowTask(workflow, 'decision', task)
      }
    }
  }

  private reprofilePendingTasks(type: TaskType, profile: 'cpu' | 'io'): void {
    for (const task of this.tasks.values()) {
      if (task.type !== type) continue
      if (task.state === 'running' || task.state === 'returning' || task.state === 'completed') continue
      const resourceDemand = this.taskResourceDemand(task.type, profile)
      const resourceWork = this.taskResourceWork(task.type, profile)
      task.resourceProfile = profile
      task.cpuWorkRemaining = profile === 'cpu' ? resourceWork : 0
      task.maxCpuDemand = profile === 'cpu' ? resourceDemand : 0
      task.ioWorkRemaining = profile === 'io' ? resourceWork : 0
      task.maxIoDemand = profile === 'io' ? resourceDemand : 0
      this.emit('TASK_RESOURCE_PROFILE_CHANGED', {
        workflowId: task.workflowId,
        taskId: task.id,
      })
    }
  }

  private ensureWorkflowTask(
    workflow: WorkflowExecution,
    phase: 'decision' | 'final',
    source: SimulationTask,
  ): void {
    if (workflow.pendingWorkflowEvents <= 0 || workflow.workflowTaskOutstanding) return
    this.scheduleWorkflowTask(workflow, phase, source)
  }

  private scheduleActivityBatch(workflow: WorkflowExecution, sourceTask: WorkflowTask): void {
    workflow.state = 'waiting'
    const remaining = workflow.activitiesExpected - workflow.activitiesScheduled
    const batchSize = Math.min(workflow.activityFanout, remaining)
    const activityTaskIds: string[] = []
    const resourceProfile = this.config.activityTaskResourceProfile
    const resourceDemand = this.taskResourceDemand('activity', resourceProfile)
    const resourceWork = this.taskResourceWork('activity', resourceProfile)
    for (let batchIndex = 0; batchIndex < batchSize; batchIndex += 1) {
      const activityIndex = workflow.activitiesScheduled + 1
      workflow.activitiesScheduled = activityIndex
      const task: ActivityTask = {
        id: `activity-task-${this.nextActivityTaskId++}`,
        workflowId: workflow.id,
        type: 'activity',
        activityIndex,
        state: 'enqueuing',
        scheduledAt: this.time,
        enqueueStartedAt: this.round(this.time + batchIndex * TASK_ENQUEUE_STAGGER_SECONDS),
        enqueueRemaining: QUEUE_ADMISSION_SECONDS,
        dispatchRemaining: 0,
        slotDispatchRemaining: 0,
        completionReturnRemaining: 0,
        cpuWorkRemaining: resourceProfile === 'cpu' ? resourceWork : 0,
        maxCpuDemand: resourceProfile === 'cpu' ? resourceDemand : 0,
        ioWorkRemaining: resourceProfile === 'io' ? resourceWork : 0,
        maxIoDemand: resourceProfile === 'io' ? resourceDemand : 0,
        resourceProfile,
        sourceSlotId: sourceTask.assignedSlotId,
        createdFrom: 'workflow-slot',
      }
      this.tasks.set(task.id, task)
      activityTaskIds.push(task.id)
      this.emit('ACTIVITY_TASK_SCHEDULED', {
        workflowId: workflow.id,
        taskId: task.id,
        sourceTaskId: sourceTask.id,
        sourceSlotId: sourceTask.assignedSlotId,
      })
    }
    this.emit('ACTIVITIES_SCHEDULED', {
      workflowId: workflow.id,
      taskId: sourceTask.id,
      activityTaskIds,
      sourceSlotId: sourceTask.assignedSlotId,
    })
  }

  private completeWorkflow(workflow: WorkflowExecution): void {
    workflow.state = 'completed'
    workflow.completedAt = this.time
    this.completions.push({ timestamp: this.time, type: 'workflow' })
    this.emit('WORKFLOW_COMPLETED', { workflowId: workflow.id })
  }

  private syncCapacity(): void {
    this.workflowPollers = this.resizePollers(this.workflowPollers, 'workflow', this.config.workflowPollers)
    this.activityPollers = this.resizePollers(this.activityPollers, 'activity', this.config.activityPollers)
    this.workflowSlots = this.resizeSlots(this.workflowSlots, 'workflow', this.config.workflowSlots)
    this.activitySlots = this.resizeSlots(this.activitySlots, 'activity', this.config.activitySlots)
  }

  private resizePollers(existing: Poller[], type: TaskType, target: number): Poller[] {
    const busy = existing.filter((poller) => poller.state === 'dispatching')
    const idle = existing.filter((poller) => poller.state === 'polling')
    const keep = [...busy, ...idle].slice(0, Math.max(target, busy.length))
    while (keep.length < target) {
      keep.push({ id: `${type}-poller-${keep.length + 1}`, type, state: 'polling' })
    }
    return keep.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))
  }

  private resizeSlots(existing: Slot[], type: TaskType, target: number): Slot[] {
    for (const slot of existing) {
      if (slot.ordinal > target) {
        slot.state = slot.taskId ? 'draining' : 'draining'
      } else if (!slot.taskId) {
        slot.state = 'available'
      }
    }
    while (existing.length < target) {
      const ordinal = existing.length + 1
      existing.push({ id: `${type}-slot-${ordinal}`, type, state: 'available', ordinal })
    }
    return existing.filter((slot) => slot.ordinal <= target || slot.taskId)
  }

  private removeDrainedSlots(): void {
    this.workflowSlots = this.workflowSlots.filter(
      (slot) => slot.ordinal <= this.config.workflowSlots || slot.taskId,
    )
    this.activitySlots = this.activitySlots.filter(
      (slot) => slot.ordinal <= this.config.activitySlots || slot.taskId,
    )
  }

  private getPollers(type: TaskType): Poller[] {
    return type === 'workflow' ? this.workflowPollers : this.activityPollers
  }

  private getSlots(type: TaskType): Slot[] {
    return type === 'workflow' ? this.workflowSlots : this.activitySlots
  }

  private slotLimit(type: TaskType): number {
    return type === 'workflow' ? this.config.workflowSlots : this.config.activitySlots
  }

  private taskResourceDemand(type: TaskType, profile: TaskResourceProfile): number {
    if (type === 'workflow') {
      return profile === 'cpu' ? this.config.workflowTaskCpuDemand : this.config.workflowTaskIoDemand
    }
    return profile === 'cpu' ? this.config.activityTaskCpuDemand : this.config.activityTaskIoDemand
  }

  private taskResourceWork(type: TaskType, profile: TaskResourceProfile): number {
    const duration = type === 'workflow'
      ? profile === 'cpu' ? WORKFLOW_CPU_BASE_DURATION_SECONDS : WORKFLOW_IO_BASE_DURATION_SECONDS
      : profile === 'cpu' ? ACTIVITY_CPU_BASE_DURATION_SECONDS : ACTIVITY_IO_BASE_DURATION_SECONDS
    return this.round(this.taskResourceDemand(type, profile) * duration)
  }

  private emit(type: string, data: Omit<SemanticEvent, 'id' | 'timestamp' | 'type'>): void {
    this.events.push({ id: this.nextEventId++, timestamp: this.time, type, ...data })
  }

  private round(value: number): number {
    return Math.round(value * 1_000_000) / 1_000_000
  }

  private workflowIssueJitter(ordinal: number): number {
    const seedOffset = (Math.abs(this.seed) % 997) / 997
    const lowDiscrepancyValue = (seedOffset + (ordinal - 1) * 0.618_033_988_75) % 1
    return this.round(lowDiscrepancyValue * WORKFLOW_TASK_ISSUE_JITTER_SECONDS)
  }
}
