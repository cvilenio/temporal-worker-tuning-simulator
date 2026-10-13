# Temporal Worker Tuning Simulator engine

This document describes the simulation engine in `src/simulation/` as it is implemented.
The engine is a deterministic, fixed-step model of Workflow Executions, Task Queues, and Workers.
It knows nothing about rendering; the UI reads snapshots and semantic events from it.

Constants live in `src/simulation/constants.ts` and are referenced by name below.
Values are quoted only where they help explain behavior, so check the constants file before relying on a number.
Behavioral tests live in `src/simulation/__tests__/`, one file per topic (polling, Slots, CPU, I/O, cache, sticky routing, scaling, metrics, determinism, and so on).

## Public API

The engine is exported from `src/simulation/index.ts`.

```ts
const simulation = new Simulation(config?: Partial<SimulationConfig>, seed = 1)

simulation.step(deltaSeconds = TICK_SECONDS)
simulation.updateConfig(changes: Partial<SimulationConfig>)
simulation.startWorkflow()
simulation.startWorkflows(count)
simulation.startContinuousGeneration()
simulation.beginTaskThroughputRound()
simulation.endTaskThroughputRound()
simulation.reset()
simulation.getSnapshot(): SimulationSnapshot
simulation.getEventsSince(eventId): SemanticEvent[]
```

`defaultConfig` in `Simulation.ts` holds the default configuration.
Missing config fields fall back to it, and every config passes through `normalizeConfig`, which clamps and rounds values to their supported ranges.
`step()` advances a whole number of ticks; a delta that is not a multiple of `TICK_SECONDS` is rounded.
`reset()` clears all runtime state and metrics and keeps the current config and seed.
The engine has no pause; pausing means the caller stops calling `step()`.
Types for config, entities, snapshots, and events are in `src/simulation/types.ts`.

## Time model

The engine advances in fixed ticks of `TICK_SECONDS` (0.05 simulated seconds).
All engine durations are simulated seconds.

The app loop in `src/App.tsx` converts real elapsed time to simulated time with `simulationSecondsForRealSeconds` from `src/simulationClock.ts`.
Simulated seconds equal real seconds times the time scale times `BASE_SIMULATION_RATE` (0.75).
At time scale 1, the simulation runs at 0.75 simulated seconds per real second.
The app accumulates simulated time and calls `step(TICK_SECONDS)` once per whole tick, capping a single frame at 0.25 real seconds.
The time scale is a UI setting and never reaches the engine.

Each tick runs these stages in order:

1. Generate continuous arrivals.
2. Issue initial Workflow Tasks for Workflows whose start transit has finished.
3. Advance queue admission.
4. Advance Slot dispatch, starting Tasks that finish it.
5. Advance poll dispatch for Workflow Tasks, then Activity Tasks.
6. Advance completion returns, completing Tasks that finish them.
7. Apply sticky fallbacks.
8. Trim Pollers above the configured count.
9. Match queued Workflow Tasks, then Activity Tasks, to Pollers and Slots.
10. Allocate CPU and I/O to running Tasks and begin completion returns for Tasks with no work left.
11. Enforce cache capacity and memory limits.
12. Remove drained Slots and drained Workers.
13. Trim rolling metric windows and record metric samples when a sample boundary is reached.

## Determinism

Given the same config, seed, and sequence of API calls, the engine produces identical snapshots and events.
The app always uses seed 1, and no seed control is exposed.

Randomness comes from a seeded low-discrepancy sequence instead of a PRNG.
The seed shifts the sequence start, and each Task or Workflow uses its ordinal to pick the next point.
This drives two values:

- Initial Workflow Task issue jitter, between 0 and `WORKFLOW_TASK_ISSUE_JITTER_SECONDS`, using a golden-ratio step (`workflowIssueJitter`).
- Task execution duration jitter, using a plastic-number step with a per-Task-type offset (`taskExecutionDuration`).

Values are rounded to six decimal places after each arithmetic step to keep results stable across runs.
IDs come from monotonic counters, and collections are iterated in insertion or sorted order.

## Configuration

`SimulationConfig` covers:

- Workload: `workflowStartRate` (Workflows per simulated second), `activitiesPerWorkflow`, and `activityFanout`.
- Worker capacity: `workerCount`, `workflowPollers`, `activityPollers`, `workflowSlots`, `activitySlots`, and `workflowCacheCapacity`.
  Poller, Slot, and cache counts are per Worker.
- Worker resources: `cpuCapacity`, `ioCapacity`, `memoryCapacityMb`, and `workflowCacheEntryMemoryMb`.
  These are also per Worker.
- Task resource profiles: `workflowTaskResourceProfile`, `activityTaskResourceProfile` (`cpu` or `io`), and `taskResourceProfilesLocked`.
- Per-Task-type CPU demand, I/O demand, base duration, and duration jitter percent, plus `workflowTaskReplayLatencySeconds`.

`normalizeConfig` enforces these ranges:

| Field | Range |
| --- | --- |
| `cpuCapacity` | `MIN_CPU_CAPACITY` to `MAX_CPU_CAPACITY` (0.1 to 1.0), step 0.1 |
| `ioCapacity` | `MIN_IO_CAPACITY` to `MAX_IO_CAPACITY` (0.1 to 1.0), step 0.1 |
| `memoryCapacityMb` | 64 to 1024, step 16 |
| `workflowCacheCapacity` | 0 to 50 |
| `workflowCacheEntryMemoryMb` | 1 to 16 |
| `workerCount` | 1 to 4 |
| CPU and I/O demand | 0.01 to 1, step 0.01 |
| Base duration and replay latency | 0.05 to 10 seconds, step 0.05 |
| Duration jitter | 0 to 100 percent, step 5 |

When `taskResourceProfilesLocked` is true, both Task types use the Workflow Task profile.
Workload and Poller and Slot counts are not clamped by the engine; the UI limits them.

## Workflow generation

Continuous arrivals use an accumulator.
Each tick adds `workflowStartRate * TICK_SECONDS`, and every whole unit creates one Workflow.
`startContinuousGeneration()` resets the accumulator and creates one Workflow immediately.
`startWorkflows(count)` creates `count` Workflows in the current tick.

Generation modes belong to the app.
In manual mode the app sets `workflowStartRate` to 0, calls `startWorkflows(n)`, and arms auto-pause (`src/autoPause.ts`).
Auto-pause stops the loop once all started Workflows have completed and live metrics have stayed at zero for `AUTO_PAUSE_ZERO_BUFFER_SECONDS`.
In continuous mode the app sets the configured rate and calls `startContinuousGeneration()`.
In both modes the app calls `beginTaskThroughputRound()` on start and `endTaskThroughputRound()` on auto-pause.

## Workflow Executions

A Workflow Execution moves through `initial`, `waiting`, `decision`, `final`, and `completed`.

A new Workflow represents a start request in transit to the Temporal Service.
Its initial Workflow Task is scheduled after `WORKFLOW_START_TRANSIT_SECONDS + WORKFLOW_TASK_ISSUE_DELAY_SECONDS` plus its issue jitter.

Workflows run in phases.
`activitiesPerWorkflow` is the total number of Activities, and `activityFanout` is how many are scheduled per phase.
The UI shows this as Execution Phases times Activities per Activity Phase.

1. The initial Workflow Task completes and schedules the first batch of `min(activityFanout, remaining)` Activity Tasks.
2. When every Activity in the batch completes, the engine schedules a `decision` Workflow Task if Activities remain, or a `final` Workflow Task if all Activities are done.
3. A `decision` Workflow Task schedules the next batch.
4. The `final` Workflow Task completes the Workflow.

A Workflow has at most one outstanding Workflow Task.
Each Workflow captures `activitiesExpected` and `activityFanout` at creation, so later config changes do not alter running Workflows' shape.

History is modeled as `historyUnits`.
It starts at 1 and increases by 1 for each completed Workflow Task and each completed Activity Task.

## Tasks

Workflow Tasks and Activity Tasks share one state set: `enqueuing`, `queued`, `acquired`, `dispatching`, `running`, `returning`, and `completed`.
Each stage has a fixed latency in simulated time:

| State | Meaning | Duration |
| --- | --- | --- |
| `enqueuing` | Task being admitted to its Task Queue | `QUEUE_ADMISSION_SECONDS` (0.9 s) |
| `queued` | In the Task Queue | At least `QUEUE_DWELL_SECONDS` (0.3 s) before it can be polled, then until matched |
| `acquired` | Poller holds the Task and a Slot is reserved | `POLL_DISPATCH_SECONDS` (0.4 s) |
| `dispatching` | Task moving from Poller into its Slot; the Poller is free again | `SLOT_DISPATCH_SECONDS` (0.5 s) |
| `running` | Executing in the Slot | Until replay and resource work finish |
| `returning` | Completion RPC to the Temporal Service; the Slot is already free | `COMPLETION_RETURN_SECONDS` (0.52 s) |
| `completed` | Done | |

Activity Tasks in one batch start admission `TASK_ENQUEUE_STAGGER_SECONDS` apart.
These fixed stages model network and handoff latency, so a Task's schedule-to-start is at least about 2.1 simulated seconds even with idle capacity.

A Task's `executionPhase` is `replay`, `decision`, or `activity`.
A Workflow Task has a `phase` (`initial`, `decision`, or `final`) and a `routingState` (see sticky routing).

## Pollers and Slots

Poller states are `long-polling` and `task-received`.
A Poller returns to `long-polling` as soon as poll dispatch ends.
Slot states are `available`, `reserved`, `occupied`, and `draining`.

Matching runs each tick for each Task type.
The engine scans the Task Queue in FIFO order and skips Tasks that are not yet poll-eligible or that have no eligible Worker.
A Worker is eligible when it is active and has both a `long-polling` Poller and an `available` Slot of that Task type.
A Poller therefore takes a Task only when a Slot is free, and a Task held by sticky routing does not block Tasks behind it.
On a match, the Poller moves to `task-received`, the Slot to `reserved`, and the Task to `acquired`.
The Slot becomes `occupied` when the Task starts running and is released when the Task enters `returning`.

Worker selection is round-robin across active Workers, with a separate pointer per Task type.

A delivery counts as a sync match when the Task is matched within half a tick of becoming poll-eligible.

IDs on `worker-1` are unprefixed, such as `activity-slot-1` and `workflow-poller-1`.
Other Workers prefix their ID, such as `worker-2-activity-slot-1`.
Workers have display IDs `A` through `D`.

## Resource model

Each Worker has CPU, I/O, and memory capacity.
CPU and I/O are shared by that Worker's running Tasks and allocated every tick; memory is tracked and enforced through cache eviction.

### Task work

Each Task has one resource profile, `cpu` or `io`, taken from its Task type's config when the Task is scheduled.
Execution duration is the base duration with jitter applied as a multiplier between `1 - jitter%` and `1 + jitter%`, floored at one tick.
Resource work is demand times execution duration.
A `cpu` Task needs only CPU work and an `io` Task needs only I/O work.
Without contention, a Task runs for its execution duration.

### Contention

`resourceProgressScale` in `src/simulation/resources.ts` turns total demand and capacity into a progress multiplier for every active Task on that resource.

- Below the knee, Tasks progress at full speed.
- Between the knee and full load, speed falls along a smoothstep curve, up to the maximum speed loss.
- Above full load, speed is also scaled by capacity divided by demand.

CPU uses `CPU_CONTENTION_KNEE` (0.7) and `CPU_MAX_CONTENTION_SPEED_LOSS` (0.25).
I/O uses `IO_CONTENTION_KNEE` (0.6) and `IO_MAX_CONTENTION_SPEED_LOSS` (0.4).
A Worker reports `cpuThrottled` or `ioThrottled` whenever the multiplier is below 1, which starts at the knee.
Utilization is demand divided by capacity, clamped to 1.

### Memory

Worker memory is `BASE_WORKER_MEMORY_MB`, plus `ACTIVE_TASK_MEMORY_MB` for each Task in `acquired`, `dispatching`, or `running`, plus the memory of each cache entry on that Worker.
Memory never blocks or slows Tasks.
When a Worker's memory exceeds `memoryCapacityMb`, the engine evicts that Worker's least recently used cache entries with reason `MEMORY_PRESSURE` until it fits or the cache is empty.
Each memory-pressure eviction sets `memoryPressure` true for `MEMORY_PRESSURE_PULSE_SECONDS`.
Reported memory utilization is clamped to 1, but `memoryUsedMb` can exceed capacity when active Tasks alone exceed it.

## Workflow cache and replay

Each Worker has an LRU cache of Workflow Executions with up to `workflowCacheCapacity` entries.
A Workflow is cached on at most one Worker.

When a Workflow Task starts running, the engine checks the assigned Worker's cache.

- On a hit, the entry is touched and the Task runs its decision work.
- On a miss, the Workflow's cache affinity is cleared and the Task first replays history.

Replay work is `max(1, historyUnits) * workflowTaskReplayLatencySeconds * REPLAY_CPU_DEMAND`.
Replay always runs on CPU at `REPLAY_CPU_DEMAND`, even for an `io` Workflow Task, and the Task makes no I/O progress while replaying.
Replay slows down under CPU contention like any other CPU work.

The Workflow is inserted into or refreshed in the Worker's cache when replay completes and again when a non-final Workflow Task completes.
Insertion evicts the least recently used entry with reason `CAPACITY` when the cache is full.
The initial Workflow Task always misses and replays one history unit.
With capacity 0, caching is disabled and every Workflow Task replays.

Eviction reasons are:

| Reason | Cause |
| --- | --- |
| `CAPACITY` | Cache full on insert, or capacity lowered |
| `MEMORY_PRESSURE` | Worker memory above capacity |
| `WORKFLOW_COMPLETED` | Workflow completed |
| `WORKER_REMOVED` | Worker started draining |
| `STICKY_FALLBACK` | Another Worker cached the Workflow after a sticky fallback, leaving this Worker's entry stale |

`cacheEvictions` counts forced evictions.
A `WORKFLOW_COMPLETED` removal is a normal close, so it emits `CACHE_EVICTED` without incrementing the counter.

## Sticky routing

A `decision` or `final` Workflow Task scheduled while its Workflow is cached on a Worker gets `routingState: 'sticky-wait'` and a `preferredWorkerId`.
Initial Workflow Tasks always use `shared-queue`.

A sticky-wait Task can be matched only by its preferred Worker.
If it is still queued `STICKY_SCHEDULE_TO_START_TIMEOUT_SECONDS` (2 s) after it was scheduled, it falls back.
The timer starts at scheduling, so queue admission counts toward it.
On fallback the Task becomes `shared-fallback`, any Worker can take it, and a `STICKY_FALLBACK` event is emitted.
The cache entry survives the fallback.
If the original Worker takes the Task, it is a cache hit with no replay, matching SDK Workers that skip already-applied Events when handed a full history for a current cached run.
If another Worker takes it, that Worker misses and replays, and once it caches the Workflow the original Worker's entry is evicted with reason `STICKY_FALLBACK`.

## Multiple Workers

The engine supports `workerCount` from 1 to 4.
The UI has no Worker count control, so the app always runs one Worker; multi-Worker behavior is covered by tests such as `sticky.test.ts` and `scaling.test.ts`.

Workers are `worker-1` through `worker-4`, and each gets the configured per-Worker Pollers, Slots, cache, and resources.
Lowering `workerCount` drains the highest-numbered Workers.
A draining Worker immediately loses its cache entries (reason `WORKER_REMOVED`), drops idle Pollers, and stops accepting new Tasks, including sticky ones.
Its running Tasks finish normally, and the Worker is deleted once it has no Tasks other than ones in `returning`.
Raising `workerCount` adds Workers or reactivates draining ones.

## Live configuration changes

`updateConfig()` applies changes at once without restarting the run.

- Poller increases add Pollers immediately.
  Decreases remove idle Pollers; busy Pollers finish their current poll dispatch first.
- Slot increases add Slots immediately.
  Slots above the new limit drain; a freed Slot within the limit becomes available only once the Worker's occupied Slots are below the limit, so no new Task starts while occupied Slots exceed the limit.
  Running Tasks are never terminated, and drained Slots are removed.
- Cache capacity and cache entry memory changes apply immediately, evicting entries if needed.
- Resource capacity and demand changes affect the next tick's allocation.
  Demand and duration changes apply to newly scheduled Tasks.
- A resource profile change reprofiles every Task of that type that has not started running (`enqueuing`, `queued`, `acquired`, or `dispatching`).
  Their work is recomputed from the new profile and their existing execution duration, and a `TASK_RESOURCE_PROFILE_CHANGED` event is emitted per Task.
  Running Tasks keep their profile.
- `workflowStartRate` affects the next tick's arrivals.

## Snapshots and metrics

`getSnapshot()` returns copies of the config, live and recently completed Workflows, live Tasks, Task Queues, Workers, Pollers, Slots, cache entries, aggregate resource state, cache metrics, rolling metrics, metric histories, and the last `MAX_RECENT_EVENTS` events.
Aggregate CPU, I/O, and memory utilization divide total demand or usage by per-Worker capacity times Worker count.

Rolling metrics use a `METRIC_WINDOW_SECONDS` (5 s) window:

- Task throughput, total and per Task type.
- Activity throughput and Workflow completions per second.
- Average Slot residence, measured from Poller acquisition to completion return start.
- Workflow and Activity schedule-to-start, averaged over every started Task in the run from running totals.

Cache metrics are global: size, capacity (per-Worker capacity times active Workers), hits, misses, evictions, hit rate, replays started, and total replay CPU seconds.

Every `METRIC_SAMPLE_SECONDS` (0.25 s) the engine appends one sample to each history:

| History | Value |
| --- | --- |
| `pollerBusyRatioHistory` | Share of Pollers not in `long-polling` |
| `slotUtilizationHistory` | Share of Slots holding a Task |
| `syncMatchRateHistory` | Share of deliveries in the window that were sync matches |
| `backlogHistory` | Task Queue lengths |
| `taskThroughputHistory` | Rolling Task throughput |
| `taskLatencyHistory` | Average schedule-to-completion latency of Tasks completed in the window |
| `cpuUtilizationHistory`, `ioUtilizationHistory`, `memoryUtilizationHistory` | Aggregate utilization |

Per-Task-type histories hold `total`, `workflow`, and `activity` values.
For Poller busy ratio, Slot utilization, and sync match rate, `total` is the larger of the two Task types.
Each sample carries `throttled` and `replaying` flags that are set if CPU or I/O throttling, memory pressure, or replay occurred at any point since the previous sample.
Resource histories set `throttled` from that resource alone.

Charts plot the whole run, so histories are capped at `MAX_METRIC_HISTORY_SAMPLES`.
When a history passes the cap, every history drops every second sample, folding the dropped sample's flags into the kept one, and the sampling interval doubles.
Long runs therefore keep between half and all of the cap at a uniform, coarser interval.

A load-test round runs from `beginTaskThroughputRound()` to `endTaskThroughputRound()`.
`roundTaskThroughput` reports cumulative throughput and elapsed time for the current or most recent round, and `taskDistribution` reports completed count, throughput, average, P25, P50, P75, P95, P99, and max schedule-to-completion latency for Tasks completed in the round.
Round latencies are kept as a count per exact latency value, which gives exact percentiles in memory bounded by the number of distinct latencies.

## Events

The engine emits semantic events with `id`, `timestamp`, `type`, and context fields such as `workflowId`, `taskId`, `pollerId`, `slotId`, `workerId`, `routingState`, `reason`, and `replayCpuSeconds`.
`getEventsSince(id)` returns every retained event after that ID.
The engine retains at least the most recent `MAX_RETAINED_EVENTS` events and trims older ones.

Other state is bounded the same way: completed Tasks are dropped on completion, completed Workflows are dropped `COMPLETED_WORKFLOW_RETENTION_SECONDS` (60 s) after completing, and rolling-window records are trimmed to the window.

| Area | Events |
| --- | --- |
| Workflow | `WORKFLOW_START_REQUESTED`, `WORKFLOW_CREATED`, `WORKFLOW_COMPLETED` |
| Workflow Task | `WORKFLOW_TASK_SCHEDULED`, `WORKFLOW_TASK_QUEUED`, `WORKFLOW_TASK_DISPATCH_STARTED`, `WORKFLOW_TASK_SLOT_DISPATCH_STARTED`, `WORKFLOW_TASK_STARTED`, `WORKFLOW_TASK_RESPONSE_SENT`, `WORKFLOW_TASK_RETURN_STARTED`, `WORKFLOW_TASK_COMPLETED` |
| Activity Task | `ACTIVITIES_SCHEDULED`, `ACTIVITY_TASK_SCHEDULED`, `ACTIVITY_TASK_QUEUED`, `ACTIVITY_TASK_DISPATCH_STARTED`, `ACTIVITY_TASK_SLOT_DISPATCH_STARTED`, `ACTIVITY_TASK_STARTED`, `ACTIVITY_TASK_RESPONSE_SENT`, `ACTIVITY_TASK_RETURN_STARTED`, `ACTIVITY_TASK_COMPLETED` |
| Cache and replay | `CACHE_HIT`, `CACHE_MISS`, `CACHE_INSERTED`, `CACHE_REFRESHED`, `CACHE_EVICTED`, `REPLAY_STARTED`, `REPLAY_COMPLETED` |
| Routing and config | `STICKY_FALLBACK`, `TASK_RESOURCE_PROFILE_CHANGED` |

`ACTIVITIES_SCHEDULED` carries the source Workflow Task in `taskId` and the new Activity Task IDs in `activityTaskIds`.
`CACHE_EVICTED` carries a `reason`.
Worker, Poller, and Slot lifecycle changes emit no events; they are visible in snapshots.

## Not modeled

- Retries, timeouts other than the sticky schedule-to-start timeout, and failures.
- Resource-based Slot suppliers and Poller autoscaling.
- Multiple Task Queues per Task type, Task Queue partitions, and rate limits.
- Variable network latency; transit stages use the fixed durations above.
