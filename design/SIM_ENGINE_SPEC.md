# Temporal Worker Scaling Simulator — v0 Simulation Engine Specification

## 1. Purpose

This document defines the **mechanics of the simulation engine** for the Temporal Worker Scaling Simulator.

The companion Scope & Behavioral Spec defines:

> What concepts the simulator should teach.

This document defines:

> What entities exist, how they change state, how resources constrain them, and how simulation state is exposed to the renderer.

The objective is not to reproduce every internal implementation detail of the Temporal SDK or Temporal Service.

The objective is to build a model that is:

- faithful to the important Temporal concepts;
- mechanically consistent;
- deterministic and testable;
- understandable by users;
- responsive to live configuration changes;
- capable of naturally producing the bottlenecks we want to teach.

The engine must not contain animation or rendering logic.

---

# 2. Modeling philosophy

The simulator should model **causal behavior**, not production benchmark numbers.

We want:

```text
configuration
      ↓
available capacity
      ↓
task movement
      ↓
resource contention
      ↓
queueing / latency / throughput
```

We explicitly do not want:

```text
4 vCPU
+
100 Activity Slots
=
exactly N Activities/sec in production
```

CPU costs, memory costs, network timing, and replay costs are therefore **illustrative normalized parameters**.

Their relative behavior should be believable.

Their absolute values should not be presented as Temporal performance guarantees.

---

# 3. Engine architecture

The simulation should be implemented as an isolated deterministic module.

Conceptually:

```text
┌──────────────────────────┐
│       React / UI         │
│ sliders, buttons, labels │
└────────────┬─────────────┘
             │ configuration
             ▼

┌──────────────────────────┐
│    Simulation Engine     │
│                          │
│ entities                 │
│ queues                   │
│ state machines           │
│ CPU scheduler            │
│ cache                    │
│ metrics                  │
│ event stream             │
└────────────┬─────────────┘
             │ snapshots + events
             ▼

┌──────────────────────────┐
│        Renderer          │
│ SVG initially            │
│ PixiJS later if needed   │
└──────────────────────────┘
```

The renderer MUST NOT determine simulation outcomes.

The renderer may interpolate motion between engine states, but it does not decide:

- when Tasks are created;
- which Worker receives a Task;
- which Slot executes a Task;
- when a Task completes;
- whether a Workflow cache hit occurs;
- CPU allocation;
- cache eviction;
- Worker scaling behavior.

Those decisions belong entirely to the simulation engine.

---

# 4. Recommended engine API

Conceptually:

```text
createSimulation(config, seed)

simulation.step(deltaTime)

simulation.updateConfig(partialConfig)

simulation.pause()
simulation.resume()

simulation.reset(seed)

simulation.getSnapshot()

simulation.getEventsSince(lastEventId)
```

The API does not have to use these exact names.

The important contract is:

### Configuration goes in.

### State and semantic events come out.

---

# 5. Time model

Use a fixed simulation timestep.

Recommended:

```text
simulation tick = 50 ms
```

or:

```text
20 simulation updates / second
```

The renderer may run independently at 60 FPS and interpolate between snapshots.

Reasons:

- deterministic behavior;
- easy testing;
- sufficient resolution for the concepts being modeled;
- avoids tying simulation behavior to browser frame rate.

Simulation speed multiplies simulation time:

```text
0.5×
1×
2×
4×
```

At:

```text
2×
```

one real second advances two simulated seconds.

Pause freezes simulation time completely.

---

# 6. Determinism

The engine should be deterministic.

Given:

```text
same configuration
same seed
same sequence of configuration changes
same simulated timestamps
```

the engine should produce:

```text
same entity states
same routing decisions
same metrics
same completion order
```

Randomness should be minimized in v0.

Where randomness is useful later, it must come from a seeded pseudo-random generator.

---

# 7. Prefer deterministic arrival generation

Workflow starts should initially use a fractional accumulator rather than Poisson/random arrival.

Example:

```text
workflowStartRate = 2.5 / second
```

Each tick:

```text
arrivalAccumulator += workflowStartRate × dt
```

When:

```text
arrivalAccumulator >= 1
```

create a Workflow Start and subtract one.

This gives smooth reproducible workload generation.

Burstiness can be added later as a separate workload mode.

---

# 8. Primary entities

The engine requires these entities.

```text
WorkflowExecution
WorkflowTask
ActivityTask
TaskQueue
Worker
Poller
Slot
WorkflowCacheEntry
```

The renderer may additionally create visual representations of Requests, but Requests do not need to be heavyweight engine entities.

---

# 9. Stable identity

Every important entity must receive a stable ID.

Examples:

```text
workflow-104
workflow-task-982
activity-task-3812
worker-1
worker-2
slot-activity-worker1-04
poller-workflow-worker1-01
```

IDs must not change while the entity exists.

This is essential for animation.

The renderer should be able to recognize:

> This dot in the queue is the same Task that is now moving toward this Worker.

---

# 10. Workflow Execution entity

Minimum conceptual state:

```text
WorkflowExecution {
    id

    state

    createdAt
    completedAt

    currentPhase

    activitiesExpected
    activitiesCompleted

    historySize

    cachedWorkerId

    finalWorkflowTaskScheduled
}
```

Recommended Workflow states:

```text
STARTING
RUNNING_WORKFLOW_TASK
WAITING_FOR_ACTIVITIES
READY_FOR_FINAL_WORKFLOW_TASK
COMPLETED
```

---

# 11. v0 Workflow template

Do not implement a generic Workflow programming language.

Use one intentionally simple Workflow template.

Each simulated Workflow does this:

```text
START

  ↓

initial Workflow Task

  ↓

schedule N Activities in parallel

  ↓

wait for all N Activities

  ↓

final Workflow Task

  ↓

COMPLETE
```

Conceptually:

```text
          Workflow ◎
              │
              ▼
             WFT
              │
       ┌──────┼──────┐
       ▼      ▼      ▼
      A1     A2      A3
       │      │      │
       └──────┼──────┘
              ▼
             WFT
              │
              ▼
          COMPLETE
```

This is sufficient to demonstrate:

- Workflow Tasks;
- Activity Tasks;
- fan-out;
- Task Queues;
- Pollers;
- Slots;
- cache behavior;
- replay;
- CPU-bound Activities;
- I/O-bound Activities.

More Workflow structures can be added later.

---

# 12. Workflow start behavior

At each generated Workflow start:

1. Create a `WorkflowExecution`.
2. Set state to `STARTING`.
3. Increment its conceptual Event History.
4. Create its initial `WorkflowTask`.
5. Enqueue that Task in the Workflow Task Queue.

The engine should emit semantic events such as:

```text
WORKFLOW_START_REQUESTED
WORKFLOW_CREATED
WORKFLOW_TASK_SCHEDULED
```

The renderer may use these to animate:

```text
Client dot
    ↓
Temporal
    ↓
Workflow ◎
    ↓
Workflow Task ●
```

The renderer should not require the engine to model client network transit in detail.

---

# 13. Workflow Task entity

Minimum state:

```text
WorkflowTask {
    id
    workflowId

    state

    scheduledAt
    dispatchStartedAt
    startedAt
    completedAt

    preferredWorkerId

    assignedWorkerId
    assignedPollerId
    assignedSlotId

    cacheHit

    replayCpuRemaining
    decisionCpuRemaining
}
```

Workflow Task states:

```text
QUEUED
DISPATCHING
RUNNING_REPLAY
RUNNING_DECISION
COMPLETED
```

A cache hit can skip:

```text
RUNNING_REPLAY
```

---

# 14. Activity Task entity

Minimum state:

```text
ActivityTask {
    id
    workflowId

    state

    scheduledAt
    dispatchStartedAt
    startedAt
    completedAt

    assignedWorkerId
    assignedPollerId
    assignedSlotId

    profile

    currentPhase

    cpuWorkRemaining
    ioWaitRemaining
}
```

States:

```text
QUEUED
DISPATCHING
RUNNING_CPU_BEFORE
WAITING_IO
RUNNING_CPU_AFTER
COMPLETED
```

CPU-bound Activities may effectively skip the I/O phase.

---

# 15. Task Queues

v0 contains two logical Task Queues:

```text
Workflow Task Queue
Activity Task Queue
```

Both belong to the Temporal Service.

Tasks are ordered FIFO except where Workflow sticky affinity applies.

Each queued Task retains:

```text
scheduledAt
```

for schedule-to-start measurement.

---

# 16. Do not explicitly model server implementation internals

The engine does not need:

- Matching Service shards;
- persistence partitions;
- Task Queue partitions;
- DB writes;
- internal queue ownership;
- namespace rate limits.

The Task Queue is an abstraction representing Tasks waiting for Worker capacity.

---

# 17. Workers

A Worker contains:

```text
Worker {
    id

    lifecycleState

    workflowPollers[]
    activityPollers[]

    workflowSlots[]
    activitySlots[]

    workflowCache[]

    cpuCapacity

    memoryCapacity
}
```

Worker lifecycle:

```text
ACTIVE
DRAINING
REMOVED
```

---

# 18. Poller types

There are separate:

```text
Workflow Pollers
Activity Pollers
```

A Poller belongs to exactly one Worker and one Task type.

Conceptual Poller state:

```text
IDLE
POLLING
DISPATCHING
RETIRING
```

Pollers must not be shared between Workflow and Activity Tasks.

---

# 19. Important Poller / Slot relationship

A Poller should not arbitrarily pull Tasks when the Worker has no ability to execute them.

For each Task type, the Worker should effectively require execution capacity before another poll can produce another Task.

Conceptually:

```text
availableForPolling =
slotLimit
- runningTasks
- TasksAlreadyBeingDispatched
```

If:

```text
availableForPolling <= 0
```

no additional poll should become eligible to retrieve work.

This keeps:

```text
Pollers = ingestion / retrieval capacity

Slots = execution concurrency capacity
```

while avoiding a fake hidden queue of Tasks sitting inside the Worker.

---

# 20. Visual interpretation of this rule

The renderer may show:

```text
Poller ○
       \
        \  Task ●
         \
          ▼
         [ ]
```

The open Slot is effectively the capacity that allowed the poll to occur.

The Poller may visually:

1. point toward an available Slot;
2. obtain a Task;
3. emit that same Task toward the selected Slot.

This gives the visual behavior requested without teaching that Workers prefetch unlimited Tasks independent of Slot capacity.

---

# 21. Poller throughput

If Pollers could instantaneously retrieve unlimited Tasks, Poller count would never become a meaningful bottleneck.

Therefore polling must have an illustrative service time.

Recommended default:

```text
pollDispatchCycle = 100 ms
```

This number is explicitly fictional/normalized.

A single Poller therefore has finite maximum dispatch capacity.

The engine may model this as:

```text
Poller receives eligible Task

    ↓

DISPATCHING for pollDispatchCycle

    ↓

Task enters reserved Slot

    ↓

Poller becomes IDLE
```

The renderer can animate the same interval.

---

# 22. Empty queue behavior

When no Task is available:

```text
Poller = POLLING
```

representing a long poll.

When a Task appears and execution capacity exists, an eligible Poller may receive it.

Do not charge CPU for long polling.

---

# 23. Slot model

Slots exist independently for:

```text
Workflow Tasks
Activity Tasks
```

Each Slot is:

```text
AVAILABLE
RESERVED_FOR_DISPATCH
OCCUPIED
DRAINING
```

Only one Task can occupy one Slot.

A Slot becomes available again when its Task completes.

---

# 24. Fixed-size slots in v0

The user-facing v0 model uses fixed Slot limits.

Example:

```text
Workflow Slots = 4
Activity Slots = 8
```

Resource-based Slot Suppliers can be added later.

The engine architecture should nevertheless avoid assuming that Slot limits can never become dynamic.

---

# 25. Live Slot increases

If:

```text
Activity Slots: 4 → 8
```

four new Slots become available immediately.

The Worker may begin additional polls.

---

# 26. Live Slot decreases

Never terminate running Tasks merely because the slider decreases.

Example:

```text
current running Activities = 8

user changes slots:
8 → 4
```

Existing eight Activities continue.

No new Activity may start until:

```text
running Activities < 4
```

The extra Slots should be considered:

```text
DRAINING
```

and removed as their Tasks complete.

This avoids unrealistic preemption.

---

# 27. CPU model: core principle

CPU should be modeled as a **shared rate-limited resource**.

Do not model CPU as:

```text
CPU = another integer number of Slots
```

Instead, Tasks require CPU work.

CPU capacity determines how quickly that work can be completed.

---

# 28. CPU units

Use CPU-seconds as normalized work.

Example:

```text
Activity needs:
0.50 CPU-seconds
```

If it receives:

```text
1 CPU unit
```

continuously, the CPU portion takes:

```text
0.50 seconds
```

If it receives:

```text
0.5 CPU units
```

it takes:

```text
1 second
```

This creates intuitive scaling.

The CPU slider can use:

```text
1
2
4
8
```

vCPU-like units.

These are illustrative capacity units rather than benchmark promises.

---

# 29. CPU demand caps

Each active CPU phase also has a maximum amount of CPU it can consume simultaneously.

Example:

```text
CPU-bound Activity:
maxCpuDemand = 1.0

Workflow Task:
maxCpuDemand = 0.25

small Activity CPU phase:
maxCpuDemand = 0.25
```

This allows one Activity to behave approximately like single-threaded CPU work while many Activities can use multiple available cores concurrently.

---

# 30. CPU allocation

Each simulation tick:

Calculate:

```text
totalDesiredCpu =
sum(maxCpuDemand of every currently CPU-active Task)
```

If:

```text
totalDesiredCpu <= worker.cpuCapacity
```

each Task receives its desired CPU.

If:

```text
totalDesiredCpu > worker.cpuCapacity
```

scale allocations proportionally:

```text
allocationScale =
cpuCapacity / totalDesiredCpu
```

For Task `i`:

```text
allocatedCpu[i] =
maxCpuDemand[i] × allocationScale
```

Then:

```text
cpuWorkRemaining[i] -=
allocatedCpu[i] × deltaTime
```

---

# 31. CPU utilization

Instantaneous CPU utilization:

```text
cpuUtilization =
min(
    totalDesiredCpu / cpuCapacity,
    1
)
```

This may be smoothed for display.

The important consequence is natural:

```text
more CPU-active Tasks
        ↓
CPU reaches capacity
        ↓
each gets a smaller share
        ↓
each remains in its Slot longer
        ↓
Slots free more slowly
        ↓
throughput plateaus
        ↓
queue grows
```

No scripted "CPU bottleneck" mode is necessary.

It emerges from the model.

---

# 32. Activity workload model

Represent Activities as phases.

Recommended generic profile:

```text
ActivityProfile {
    cpuBeforeSeconds
    ioWaitSeconds
    cpuAfterSeconds

    maxCpuDemand

    memoryMb
}
```

This is preferable to simply assigning a single duration.

It makes CPU and I/O behavior emerge naturally.

---

# 33. CPU-bound preset

Illustrative starting values:

```text
CPU-bound Activity

cpuBeforeSeconds = 0.45
ioWaitSeconds    = 0
cpuAfterSeconds  = 0.05

maxCpuDemand     = 1.0
```

Total CPU work:

```text
0.50 CPU-seconds
```

With sufficient CPU, approximately 500 ms.

With CPU contention, longer.

---

# 34. I/O-bound preset

Illustrative starting values:

```text
I/O-bound Activity

cpuBeforeSeconds = 0.02
ioWaitSeconds    = 0.80
cpuAfterSeconds  = 0.02

maxCpuDemand     = 0.25
```

The Task occupies an Activity Slot for the entire period.

During:

```text
WAITING_IO
```

it consumes:

```text
0 CPU
```

This naturally produces:

```text
many occupied Slots
+
low CPU usage
```

and makes increasing Activity Slot count useful.

---

# 35. I/O waiting

I/O waits advance according to simulation time, not CPU allocation.

Each tick:

```text
ioWaitRemaining -= deltaTime
```

CPU load has no direct effect on I/O wait duration.

CPU contention can still delay the pre- or post-I/O phases.

---

# 36. Activity execution lifecycle

Example I/O-bound Activity:

```text
Slot occupied
     │
     ▼
CPU_BEFORE
     │
     ▼
WAITING_IO
     │
     ▼
CPU_AFTER
     │
     ▼
COMPLETE
     │
     ▼
Slot released
```

The same Activity Task remains in the Slot throughout.

---

# 37. Activity completion

When an Activity completes:

1. release its Activity Slot;
2. increment the owning Workflow's `activitiesCompleted`;
3. increment Workflow History size;
4. emit `ACTIVITY_COMPLETED`;
5. if all expected Activities are complete and the final Workflow Task has not been scheduled:
   - schedule the final Workflow Task exactly once.

This final Workflow Task allows the Workflow Execution to advance and complete.

---

# 38. Workflow Task CPU model

Every Workflow Task requires some baseline CPU.

Recommended conceptual breakdown:

```text
Workflow Task CPU =
replay CPU
+
new decision CPU
```

On a cache hit:

```text
replay CPU ≈ 0
```

On a cache miss:

```text
replay CPU > 0
```

---

# 39. Workflow decision cost

Use a small fixed baseline.

Example:

```text
workflowDecisionCpu = 0.01 CPU-seconds
```

The exact value is illustrative.

Workflow Tasks should usually remain much shorter than Activities.

---

# 40. Event History size

Every Workflow Execution tracks an approximate:

```text
historySize
```

This does not need to reproduce actual Temporal Event History exactly.

Increment it when meaningful state changes happen.

For example:

```text
Workflow started        +1
Workflow Task completed +1
Activity scheduled      +1 per Activity
Activity completed      +1 per Activity
Workflow completed      +1
```

The important feature is simply:

```text
older / busier Workflow
→ larger history
→ more expensive replay on cache miss
```

---

# 41. Replay cost

Recommended:

```text
replayCpu =
historySize × replayCpuPerHistoryUnit
```

Example normalized value:

```text
replayCpuPerHistoryUnit =
0.001 CPU-seconds
```

This constant should be centralized and easy to tune.

Replay cost should be linear in v0.

No attempt should be made to reproduce exact SDK replay cost.

---

# 42. Workflow cache

Each Worker has an LRU Workflow cache.

Each entry:

```text
WorkflowCacheEntry {
    workflowId
    workerId

    createdAt
    lastUsedAt

    memoryMb
}
```

A Workflow can have at most one active cache location in v0.

---

# 43. Cache insertion

After a Workflow Task successfully finishes:

If the Workflow remains open:

```text
insert or refresh its cache entry
```

on the Worker that executed it.

Set:

```text
workflow.cachedWorkerId = worker.id
```

If the Workflow completes:

```text
remove cache entry
```

because it is no longer needed.

---

# 44. Cache hit

A Workflow Task is a cache hit when:

1. the Workflow has a valid cache entry;
2. the Task executes on that same Worker;
3. the entry has not been evicted.

Then:

```text
cacheHit = true
replayCpu = 0
```

The entry becomes most recently used.

---

# 45. Cache miss

A Workflow Task is a cache miss if:

- no cache entry exists;
- the entry was evicted;
- the cached Worker disappeared;
- the Workflow Task executes on another Worker.

Then:

```text
cacheHit = false
replayCpu = historySize × replayCost
```

After execution finishes, the Workflow becomes cached on the new Worker.

---

# 46. Sticky affinity abstraction

Do not implement explicit sticky Task Queues in v0.

Instead implement **sticky Worker affinity**.

When scheduling another Workflow Task:

If:

```text
workflow.cachedWorkerId != null
```

set:

```text
workflowTask.preferredWorkerId =
workflow.cachedWorkerId
```

For a short period, only that Worker should be preferred to claim that Workflow Task.

This models the important behavior of sticky execution without exposing server-side sticky queue internals.

---

# 47. Sticky fallback

Recommended normalized value:

```text
stickyFallbackDelay = 1 simulated second
```

If the preferred Worker cannot accept the Workflow Task within that delay:

```text
Task becomes eligible for any Worker
```

If another Worker receives it:

```text
cache miss
→ replay
```

Again, this timing is pedagogical, not a production constant.

---

# 48. Why sticky affinity matters

Without affinity:

```text
Worker A caches Workflow
        ↓
next WFT randomly lands on Worker B
        ↓
cache almost never helps
```

That would incorrectly teach the cache model.

Sticky affinity ensures the simulator captures the intended relationship:

```text
cached state
+
prefer same Worker
=
reduced replay
```

---

# 49. Cache capacity setting

User-facing control:

```text
Max Cached Workflows
```

or:

```text
Workflow Cache Capacity
```

The value specifies the maximum number of Workflow cache entries.

When the limit is exceeded:

```text
evict least-recently-used entry
```

Emit:

```text
CACHE_EVICTED
```

---

# 50. Memory model

Worker memory usage:

```text
memoryUsed =
baseWorkerMemory
+
activeWorkflowTaskMemory
+
activeActivityTaskMemory
+
workflowCacheMemory
```

Task Queue contents consume Temporal Service memory conceptually, not Worker memory, and should not count here.

---

# 51. Recommended memory components

Centralized illustrative defaults:

```text
base Worker                = 256 MB

running Workflow Task      = 4 MB

CPU-bound Activity         = 16 MB

I/O-bound Activity         = 8 MB

cached Workflow Execution  = 4 MB
```

These numbers are intentionally fictional.

They should be easy to change after visual testing.

---

# 52. Memory limit

Worker configuration exposes:

```text
memoryCapacityMb
```

The memory slider may show GiB to users.

Example:

```text
512 MB
1 GB
2 GB
4 GB
```

---

# 53. Memory-pressure behavior

v0 should use memory primarily to constrain Workflow caching.

Whenever:

```text
memoryUsed > memoryCapacity
```

first evict LRU Workflow cache entries until either:

```text
memoryUsed <= memoryCapacity
```

or:

```text
cache is empty
```

This naturally produces:

```text
less memory
    ↓
more cache eviction
    ↓
more cache misses
    ↓
more replay
    ↓
more CPU demand
```

---

# 54. Active memory overcommit

It is possible that active Tasks alone exceed the configured memory capacity.

Do not invent sophisticated GC or OOM behavior in v0.

Instead:

```text
memoryOvercommitted = true
```

and expose memory utilization above 100%.

The renderer may show a warning.

Do not crash the Worker automatically.

Worker OOM/failure behavior remains out of scope.

This should be clearly documented as a simulator simplification.

---

# 55. Why memory does not directly slow Tasks

Do not introduce arbitrary equations such as:

```text
95% memory → Tasks run 30% slower
```

unless a later version intentionally models GC/runtime behavior.

For v0, memory influences performance principally through:

```text
cache retention
→ replay frequency
→ CPU work
```

This is easier to explain and much less misleading.

---

# 56. Worker CPU and memory are shared

Workflow and Activity work on the same Worker consume the same Worker-level resource pools.

Example:

```text
Workflow replay
          \
           \
            → Worker CPU
           /
CPU Activity
```

This allows resource interactions to emerge.

Heavy Activity CPU utilization can make Workflow Tasks slower even when Workflow Slot capacity is available.

That is desirable.

---

# 57. Multiple Workers

Workers are peers polling the same logical Task Queues.

Example:

```text
             Activity Queue
            ● ● ● ● ● ● ●
             /         \
            /           \
           ▼             ▼

       Worker 1       Worker 2
```

Each Worker has its own:

- Pollers;
- Slots;
- CPU;
- memory;
- Workflow cache.

---

# 58. Worker selection for Activity Tasks

Activity Tasks have no sticky affinity in v0.

Among Workers with:

- an eligible Activity Poller;
- available Activity execution capacity;

use deterministic round-robin selection.

Avoid random assignment.

This improves reproducibility and visually balances work.

---

# 59. Worker selection for Workflow Tasks

Workflow Tasks follow:

### First priority

Preferred cached Worker, when applicable.

### Otherwise

Deterministic round-robin among eligible Workflow Workers.

---

# 60. Worker scale-up

When:

```text
Worker count:
1 → 2
```

create a new active Worker immediately.

The new Worker starts with:

```text
empty cache
all slots available
pollers enabled
CPU idle
memory = base memory
```

Existing running Tasks do not migrate.

---

# 61. Worker scale-down

Do not instantly destroy a Worker containing running work.

Use graceful drain.

Example:

```text
Workers:
3 → 2
```

Choose the highest-numbered Worker for removal unless otherwise configured.

Set:

```text
worker.lifecycleState = DRAINING
```

A draining Worker:

- stops initiating new non-essential polls;
- does not accept new Activity Tasks;
- does not accept new non-sticky Workflow Tasks;
- allows currently executing Tasks to complete.

Once it has no active Tasks:

1. discard its Workflow cache;
2. clear corresponding Workflow affinity;
3. remove Worker.

This creates understandable scale-down behavior.

---

# 62. Sticky Tasks during Worker drain

A Workflow Task that prefers a draining Worker should not remain stuck forever.

The normal:

```text
stickyFallbackDelay
```

applies.

It may then execute elsewhere with a cache miss and replay.

This gives Worker removal a natural cache consequence.

---

# 63. Live Poller increases

Example:

```text
Activity Pollers:
2 → 6
```

additional Pollers become available immediately.

If:

```text
queued Tasks exist
AND
execution Slots are available
```

they may begin dispatching.

---

# 64. Live Poller decreases

If:

```text
6 → 2
```

retire idle Pollers first.

Pollers already dispatching a Task finish their current dispatch.

Afterward they retire until the configured count is reached.

Do not cancel a Task that has already been acquired merely because Poller count decreased.

---

# 65. Live CPU change

CPU capacity changes immediately.

Example:

```text
CPU:
2 → 4
```

At the next tick the CPU allocator uses the new capacity.

Running CPU work therefore accelerates naturally.

Similarly:

```text
4 → 2
```

causes active CPU work to progress more slowly.

No Task restarts.

---

# 66. Live memory change

When memory capacity increases:

```text
current cached entries remain
future cache retention improves
```

Evicted Workflows do not magically return to cache.

When memory decreases:

1. recompute memory usage;
2. evict LRU cache entries until under capacity where possible.

---

# 67. Live workload changes

## Workflow start rate

Affects future Workflow starts immediately.

Existing Workflows are unchanged.

---

## Activities per Workflow

Applies only to Workflows created after the change.

Existing Workflows retain the value captured when created.

---

## Activity workload profile

Applies only to Activity Tasks created after the change.

Existing Tasks retain their original Activity profile.

This avoids Tasks changing behavior halfway through execution.

---

# 68. Configuration snapshots

Each Workflow should capture relevant workload configuration at creation time.

Example:

```text
workflow.workloadDefinition = {
    activitiesPerWorkflow: 4
    activityProfile: IO_BOUND
}
```

This makes live slider changes predictable.

---

# 69. Initial Workflow Task behavior

When an initial Workflow Task completes:

1. update Workflow cache;
2. generate the configured number of Activity Tasks;
3. enqueue those Tasks;
4. set Workflow state:

```text
WAITING_FOR_ACTIVITIES
```

The Workflow Task Slot is then released.

---

# 70. Visual "split" event

The engine should emit:

```text
ACTIVITIES_SCHEDULED {
    workflowId
    workflowTaskId
    activityTaskIds[]
}
```

The renderer can turn this into:

```text
              ●
             /
Workflow ◎ ─ ●
             \
              ●
```

without the engine needing to know animation geometry.

---

# 71. Final Workflow Task

When all Activities are complete:

schedule exactly one final Workflow Task.

Its execution:

1. uses Workflow sticky affinity if possible;
2. may hit or miss cache;
3. performs replay when required;
4. executes the final Workflow decision;
5. completes the Workflow Execution.

Then:

```text
Workflow.state = COMPLETED
```

and its cache entry is removed.

---

# 72. Queue depth

For each Task Queue:

```text
queueDepth =
number of Tasks in QUEUED state
```

Tasks already dispatching do not count.

---

# 73. Schedule-to-start latency

For each Task:

```text
scheduleToStart =
task.startedAt
-
task.scheduledAt
```

Track Workflow and Activity separately.

This metric naturally captures delays caused by:

- insufficient Pollers;
- insufficient Slots;
- CPU saturation causing Slots to remain occupied;
- insufficient Workers.

---

# 74. Throughput

Use rolling windows.

Recommended:

```text
5 simulated second rolling window
```

Metrics:

```text
Workflow starts / sec

Workflow completions / sec

Workflow Tasks completed / sec

Activity Tasks completed / sec
```

Do not use lifetime averages for the primary UI because they respond too slowly to slider changes.

---

# 75. CPU metric

Expose per Worker:

```text
instantaneousCpuUtilization
rollingCpuUtilization
```

Recommended display uses rolling:

```text
1 second average
```

---

# 76. Memory metric

Expose:

```text
memoryUsedMb
memoryCapacityMb

memoryUtilization =
memoryUsed / memoryCapacity
```

Allow:

```text
memoryUtilization > 1
```

for the v0 overcommit warning.

---

# 77. Slot metrics

Per Worker and Task type:

```text
slotLimit
slotsRunning
slotsDispatching
slotsAvailable
slotsDraining
```

This is useful both for rendering and debugging.

---

# 78. Poller metrics

Per Worker and Task type:

```text
configuredPollers

pollersIdle
pollersPolling
pollersDispatching
pollersRetiring
```

---

# 79. Cache metrics

Per Worker:

```text
cacheSize
cacheCapacity
cacheMemoryMb

cacheHits
cacheMisses
cacheEvictions
```

Global rolling metrics:

```text
Workflow cache hit rate
Workflow replay rate
```

---

# 80. Replay metrics

Expose:

```text
replaysStarted
replayCpuSecondsConsumed
```

This allows the visual UI eventually to make the connection:

```text
cache ↓
replay ↑
CPU ↑
```

---

# 81. Semantic event stream

The engine should produce semantic events independently of rendering.

Recommended event types:

```text
WORKFLOW_START_REQUESTED
WORKFLOW_CREATED

WORKFLOW_TASK_SCHEDULED
WORKFLOW_TASK_DISPATCH_STARTED
WORKFLOW_TASK_STARTED
WORKFLOW_TASK_COMPLETED

ACTIVITIES_SCHEDULED

ACTIVITY_TASK_SCHEDULED
ACTIVITY_TASK_DISPATCH_STARTED
ACTIVITY_TASK_STARTED
ACTIVITY_IO_WAIT_STARTED
ACTIVITY_IO_WAIT_ENDED
ACTIVITY_TASK_COMPLETED

CACHE_HIT
CACHE_MISS
CACHE_INSERTED
CACHE_EVICTED

WORKER_ADDED
WORKER_DRAINING
WORKER_REMOVED

SLOT_ADDED
SLOT_DRAINING
SLOT_REMOVED
```

Every event should contain:

```text
eventId
simulatedTimestamp
entity IDs
relevant worker/task IDs
```

---

# 82. Why events and snapshots are both needed

Snapshots answer:

> What is true right now?

Events answer:

> What just happened?

Example:

Snapshot:

```text
Activity Task 31 is RUNNING_IO
in Worker 2, Slot 4
```

Event:

```text
Activity Task 31 entered Slot 4 at 12.45 s
```

The renderer can animate the transition from the event while using snapshots as authoritative state.

---

# 83. Renderer contract

The renderer receives stable logical concepts, not animation commands.

For example:

```text
task.state = DISPATCHING
task.assignedWorkerId = worker-2
task.assignedSlotId = activity-slot-4
```

The renderer decides whether the movement is:

- linear;
- curved;
- eased;
- glowing;
- 250 ms or 350 ms visually.

The engine only determines semantic timing.

---

# 84. Visual interpolation may lag slightly

It is acceptable for visual animation to trail engine state by a small fixed rendering delay.

Example:

```text
100 ms
```

if necessary to produce smooth transitions.

The simulation engine remains authoritative.

---

# 85. No visual-object multiplication

One engine Task ID must correspond to one visible Task object.

For example:

```text
activity-task-152
```

cannot simultaneously appear:

- in the Task Queue;
- traveling to Poller;
- inside the Slot.

It occupies exactly one semantic location/state.

Glow/trails may follow it but must not be represented as additional work entities.

---

# 86. Initial configuration

Recommended starting values for visual tuning:

```text
Workflow start rate:
1 / second

Activities per Workflow:
4

Activity profile:
I/O-bound

Workers:
1

Workflow Pollers / Worker:
2

Activity Pollers / Worker:
2

Workflow Slots / Worker:
2

Activity Slots / Worker:
4

CPU / Worker:
2 CPU units

Memory / Worker:
1 GiB

Workflow Cache Capacity:
50 Workflows

Simulation speed:
1×
```

These are starting points only.

They should be adjusted after observing the prototype.

---

# 87. Scenario presets

Presets should modify normal configuration.

They must not activate hidden scripted behavior.

A preset should simply set sliders.

Example:

## Balanced

```text
moderate arrival rate
adequate Pollers
adequate Slots
adequate CPU
adequate memory
```

---

## Poller constrained

```text
high Slot count
adequate CPU
few Pollers
```

Expected emergent result:

```text
queue growth
+
idle Slots
```

---

## Slot constrained

```text
adequate Pollers
few Slots
adequate CPU
```

Expected:

```text
queue growth
+
all Slots occupied
```

---

## CPU constrained

```text
CPU-bound Activities
many Slots
limited CPU
```

Expected:

```text
CPU ≈ 100%
slots occupied longer
queue grows
extra Slots provide little benefit
```

---

## I/O bound

```text
I/O-bound Activities
few Activity Slots
low/moderate CPU
```

Increasing Slots should visibly improve throughput.

---

## Cache constrained

```text
many concurrently waiting Workflows
small cache
moderate memory
```

Expected:

```text
eviction
→ misses
→ replay
→ additional CPU
```

---

# 88. Bottleneck migration must emerge

The engine must support this sequence without any preset-specific code.

Starting state:

```text
Activity Slots = 2
CPU = 8
```

Observed:

```text
all Slots busy
CPU low/moderate
Activity queue grows
```

User changes:

```text
Slots → 16
```

Observed:

```text
queue starts draining
CPU rises
```

Eventually:

```text
CPU ≈ 100%
```

Further Slot increases do little.

Then user changes:

```text
CPU → 16
```

Throughput increases again.

This behavior is a critical engine acceptance test.

---

# 89. Cache/CPU interaction must emerge

Starting:

```text
small Workflow cache
many active Workflows
```

Expected:

```text
cache eviction ↑
cache misses ↑
replay CPU ↑
Workflow Task duration ↑
Workflow Slots remain occupied longer
Workflow queue pressure ↑
```

Increase cache:

```text
cache misses ↓
replay ↓
CPU pressure ↓
```

until memory becomes the practical limit.

No cache-specific scripted slowdown should be required.

---

# 90. I/O/Slot interaction must emerge

For I/O-bound Activities:

```text
CPU low
Activity Slots full
queue growing
```

Increase Slots.

Expected:

```text
more concurrent WAITING_IO Tasks
throughput ↑
CPU rises only modestly
```

This is another core acceptance test.

---

# 91. Poller/Slot interaction must emerge

Scenario:

```text
Activity Slots = 16
Activity Pollers = 1
CPU = 8
backlog = high
```

Expected:

```text
many Slots remain available
one Poller feeds work too slowly
```

Increase Pollers:

```text
1 → 4
```

Expected:

```text
Slots fill faster
schedule-to-start decreases
throughput increases
```

until another bottleneck emerges.

---

# 92. Engine invariants

The engine must enforce these invariants.

### Task ownership

A Task can be assigned to at most one Worker.

### Slot ownership

A Slot can contain at most one Task.

### Task type

Workflow Tasks can only use Workflow Slots.

Activity Tasks can only use Activity Slots.

### Poller type

Workflow Pollers retrieve only Workflow Tasks.

Activity Pollers retrieve only Activity Tasks.

### Workflow completion

A Workflow cannot complete before all its configured Activities complete.

### Final WFT uniqueness

Only one final Workflow Task may be created per Workflow.

### Queue uniqueness

A Task cannot simultaneously be queued and running.

### Cache uniqueness

A Workflow may have at most one active cache entry.

### Worker resource isolation

Each Worker's Slots and cache belong only to that Worker.

CPU and memory are shared inside that Worker but not between Workers.

---

# 93. Important Temporal semantic invariant

A Workflow Execution persists independently of whether any Workflow Task is currently executing.

Therefore this is valid:

```text
Workflow ◎ exists

Workflow Slots:
[ ] [ ]

Activity Slots:
[●] [●]

Workflow is waiting.
```

The engine must never equate:

```text
Workflow exists
```

with:

```text
Workflow Task is running
```

---

# 94. Tests: deterministic behavior

Test:

```text
Run same scenario twice
with same seed/config.
```

Expected:

```text
identical event stream
identical completion order
identical metrics
```

---

# 95. Tests: poller constraint

Run high backlog with:

```text
Activity Slots = 16
CPU = 16
Pollers = 1
```

Record throughput.

Then:

```text
Pollers = 4
```

Expected:

```text
throughput increases
until Pollers are no longer bottleneck
```

---

# 96. Tests: slot constraint

Run:

```text
Pollers = high
CPU = high
Activity Slots = 2
```

Then increase to:

```text
8
```

Expected:

```text
throughput increases
```

---

# 97. Tests: CPU saturation

Use CPU-bound Activities.

Give:

```text
Activity Slots = 16
CPU = 2
```

Then:

```text
Activity Slots = 32
```

Expected:

```text
throughput changes little
CPU remains saturated
```

Then:

```text
CPU = 4
```

Expected:

```text
throughput increases materially
```

---

# 98. Tests: I/O-bound scaling

Use I/O-bound Activities:

```text
CPU = 4
Slots = 4
```

Then:

```text
Slots = 16
```

Expected:

```text
throughput increases significantly
CPU remains below saturation
```

---

# 99. Tests: cache hit

Execute initial WFT on Worker A.

Ensure Workflow remains cached there.

Complete its Activities.

Dispatch final WFT back to Worker A.

Expected:

```text
CACHE_HIT
replayCpu = 0
```

---

# 100. Tests: cache miss

Execute initial WFT.

Evict cache entry.

Complete Activities.

Run final WFT.

Expected:

```text
CACHE_MISS
replayCpu > 0
```

and:

```text
replayCpu proportional to history size
```

---

# 101. Tests: LRU behavior

Cache:

```text
capacity = 2

touch:
W1
W2
W1

insert:
W3
```

Expected eviction:

```text
W2
```

---

# 102. Tests: Slot scale-down

Start eight running Activities.

Change:

```text
slots 8 → 2
```

Expected:

- all eight continue;
- no Task is terminated;
- no new Tasks start until fewer than two remain;
- final stable Slot count becomes two.

---

# 103. Tests: Worker drain

Two Workers have running Activities.

Change:

```text
workers 2 → 1
```

Expected:

- selected Worker enters DRAINING;
- receives no new Activity Tasks;
- existing Tasks finish;
- Worker is removed afterward;
- cached Workflow affinity on that Worker is cleared.

---

# 104. Tests: live CPU change

Start CPU-bound Tasks under saturation.

Increase CPU while Tasks are running.

Expected:

```text
their completion rate accelerates
without restart
```

---

# 105. Tests: live workload profile change

Start several I/O-bound Activities.

Change profile to CPU-bound.

Expected:

- existing I/O Tasks remain I/O-bound;
- newly scheduled Tasks use CPU-bound profile.

---

# 106. Diagnostics mode

The engine should optionally expose an internal diagnostic snapshot.

Example:

```text
simTime

workflowQueueDepth
activityQueueDepth

workers:
  worker-1:
    cpu
    memory
    poller states
    slot states
    cache contents

activeTasks
queuedTasks

recentEvents
```

This can initially be rendered as JSON or a developer panel.

It will greatly reduce debugging time with AI coding agents.

---

# 107. No animation work during engine milestone

The engine milestone is complete before polished motion is added.

A crude UI is sufficient.

For example:

```text
Workflow Queue:  ● ● ●

Activity Queue:  ● ● ● ● ●

Worker 1

W Pollers:
○ ○

W Slots:
[●] [ ]

A Pollers:
○ ○

A Slots:
[●][●][●][ ]

CPU: 63%
Mem: 41%

Cache:
◎ ◎ ◎ ◎
```

If this correctly demonstrates the bottlenecks, the engine is successful.

---

# 108. Implementation sequencing

Recommended order:

## Phase 1 — Basic engine

Implement:

- clock;
- deterministic Workflow arrivals;
- Workflow Execution entity;
- initial Workflow Tasks;
- Activity generation;
- final Workflow Tasks;
- completion.

No resource contention yet.

---

## Phase 2 — Queues, Pollers and Slots

Add:

- Workflow/Activity queues;
- separate Pollers;
- separate Slots;
- poll dispatch timing;
- schedule-to-start metrics.

Validate:

- Poller constrained;
- Slot constrained.

---

## Phase 3 — Activity resource model

Add:

- CPU allocator;
- CPU-bound profile;
- I/O-bound profile;
- Activity execution phases.

Validate:

- CPU-bound behavior;
- I/O-bound behavior;
- bottleneck migration.

---

## Phase 4 — Workflow cache

Add:

- cache entries;
- LRU;
- affinity;
- cache hit/miss;
- replay CPU.

Validate:

- cache-constrained behavior.

---

## Phase 5 — Memory

Add:

- Worker memory accounting;
- cache eviction under memory pressure;
- memory metrics;
- overcommit warning.

---

## Phase 6 — Dynamic configuration

Add live changes to:

- Workflow rate;
- workload;
- Pollers;
- Slots;
- CPU;
- memory;
- cache;
- Workers.

Validate drain semantics.

---

## Phase 7 — Renderer integration

Expose:

- stable snapshots;
- semantic events;
- IDs;
- metrics.

Build crude visualization.

Do not add high-end visual effects yet.

---

# 109. Definition of engine-complete

The simulation engine is ready for serious visual-design work when all of the following work without special-case scenario scripting:

### Poller constraint

```text
queue grows + Slots idle
```

### Slot constraint

```text
queue grows + Slots full
```

### CPU constraint

```text
CPU saturated + extra Slots stop helping
```

### I/O-bound concurrency

```text
Slots full + CPU modest + more Slots help
```

### Cache constraint

```text
eviction → replay → CPU cost
```

### Memory/cache interaction

```text
less memory → less cache → more replay
```

### Bottleneck migration

```text
fix one constraint → another becomes visible
```

### Dynamic tuning

Sliders can change all of the above while the simulation is running without resetting the world.

---

# 110. Explicit simplifications

These should be documented in code and eventually in the application's educational notes.

### Poll timing

Poll dispatch latency is illustrative.

### CPU work

Task CPU costs are illustrative normalized values.

### Memory

Memory mainly affects caching in v0; OS-level OOM/GC behavior is not simulated.

### Replay

Replay cost is modeled as linear with approximate History size.

### Workflow logic

All Workflows initially use one fan-out/wait/finalize template.

### Sticky execution

Sticky behavior is represented as Worker affinity and fallback rather than explicit sticky Task Queues.

### Task Queues

Task Queue server implementation details are not modeled.

### Network

Network latency and failures are not modeled.

### Retries

Activity and Workflow Task retry mechanics are not modeled.

These are intentional scope boundaries, not accidental omissions.

---

# 111. Central constants

All fictional physics values must live in one configuration module.

For example:

```text
SIM_CONSTANTS

tickMs

pollDispatchMs
stickyFallbackMs

workflowDecisionCpuSeconds
replayCpuPerHistoryUnit

baseWorkerMemoryMb
workflowTaskMemoryMb
cachedWorkflowMemoryMb

cpuBoundProfile
ioBoundProfile
```

Do not scatter these numbers across the implementation.

This makes later calibration with the visual prototype easy.

---

# 112. Final engineering principle

The simulation should never ask:

> What animation should happen now?

It should ask:

> Given the current Workload, Worker configuration, and resource state, what happens to the system next?

The renderer then turns that result into motion.

That separation is fundamental to making the eventual glowing, space-like visualization both attractive and trustworthy.