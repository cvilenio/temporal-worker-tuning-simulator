# Temporal Worker Tuning Simulator scope and behavior

This document describes what the simulator teaches and how its model behaves.
The [README](../README.md) covers usage, the preset table, the mapping from sliders to SDK Worker options, and the mapping from charts to production metrics.
[`SIM_ENGINE_SPEC.md`](SIM_ENGINE_SPEC.md) covers engine mechanics and [`VISUAL_SPEC.md`](VISUAL_SPEC.md) covers the UI.

## Purpose

The simulator builds intuition for Temporal Worker capacity and vertical scaling.
It teaches cause and effect, and its numbers are not throughput predictions for real deployments.

A user who spends a few minutes with it should be able to explain:

1. A Workflow Execution is not a Workflow Task, and one Workflow Execution produces many Tasks over its lifetime.
2. Workflow Tasks and Activity Tasks have separate Pollers and separate Slots.
3. Pollers retrieve work and Slots execute it, so more Pollers add no execution capacity.
4. More Slots add no CPU, memory, or I/O capacity.
5. CPU-bound and I/O-bound Tasks saturate different resources as concurrency rises.
6. The Workflow cache spends memory to avoid replay, and replay costs CPU.
7. Raising one limit often moves the bottleneck somewhere else.
8. Task Queue backlog and schedule-to-start latency are symptoms whose cause needs diagnosis.

## Lifecycle model

The scene has three regions: Client, Temporal Service, and Workers.

1. The Client starts a Workflow Execution.
2. The Temporal Service schedules an initial Workflow Task on the Workflow Task Queue.
3. A Workflow Poller acquires the Task and hands it to a Workflow Slot.
4. The Workflow Task schedules the first Activity phase.
5. The Temporal Service places one Activity Task per Activity in that phase on the Activity Task Queue.
6. Activity Pollers and Activity Slots acquire and run those Activity Tasks.
7. When every Activity in the phase completes, the Temporal Service schedules the next Workflow Task.
8. After the last phase, a final Workflow Task completes the Workflow Execution.

**Workflow shape** controls this loop.
"Execution Phases" sets the number of Activity phases, and "Activities per Activity Phase" sets how many Activities run in parallel within a phase.
Both range from 1 to 10.

A Workflow Execution keeps its identity for its whole life.
It stays visible in the Temporal Service region while its Tasks move through queues and Slots, and it shows how many of its Tasks are outstanding.
Each Task keeps one visual identity as it moves from queue to Poller to Slot and back.

Workflow and Activity processing share one Worker process.
Their Pollers, Slots, and Task Queues stay separate.

## Pollers

A Poller retrieves a Task from its Task Queue and dispatches it into a Slot.
A Poller acquires a Task only when its Worker has a free Slot of the same type, which reserves that Slot.
Workflow Pollers and Activity Pollers are separate pools, each ranging from 0 to 10 per Worker.

When Pollers are the constraint, Tasks wait in the queue while Slots sit idle.
Adding Pollers increases how fast work is retrieved and leaves execution concurrency unchanged.

## Slots

A Slot is permission for one Task to execute.
Workflow Slots range from 0 to 16 per Worker, and Activity Slots range from 0 to 32.
A Task holds its Slot from acquisition until it starts returning its result to the Temporal Service.

Slots create no CPU, memory, or I/O capacity.
Adding Slots raises throughput only until a physical resource saturates.

Slot count changes apply during a run.
When the limit drops, Slots above the new limit drain: their running Tasks finish normally, and the Slots are removed once empty.
No new Task starts on a Worker while its occupied Slots exceed the limit.

## Task resource profiles

Each Task type has its own resource profile, set under **Task resource profiles**.
Each profile is CPU-bound or I/O-bound.
**Lock profile types** keeps Workflow Tasks and Activity Tasks on the same profile, and it is on by default with both set to CPU-bound.

Each Task type has these settings:

- Demand, from 0.01 to 1, in CPU for a CPU-bound profile or I/O throughput for an I/O-bound profile.
- Base execution duration, from 0.05 to 10 seconds.
- Execution duration jitter, from 0 to 100 percent.

Workflow Tasks also have a replay latency per history unit, from 0.05 to 2 seconds.

A Task's work is its demand multiplied by its execution duration.
At full speed it finishes in its execution duration.
A CPU-bound Task consumes only CPU, and an I/O-bound Task consumes only I/O capacity.
Changing a profile during a run also changes Tasks that have not started running yet.

## Worker resources

Each Worker has three physical resources, set under **Worker resources**.

| Resource | Range | Consumed by |
| --- | --- | --- |
| CPU | 0.1 to 1.0 CPU | CPU-bound Tasks and Workflow replay |
| Memory | 64 to 1024 MB | Base Worker memory, active Tasks, and cached Workflows |
| I/O capacity | 0.1 to 1.0 throughput | I/O-bound Tasks |

### CPU and I/O contention

CPU and I/O slow Tasks down instead of refusing them.
Each resource follows a contention curve.
Below a knee, Tasks run at full speed.
Above the knee, Tasks slow gradually: the CPU knee is at 70% load with up to 25% speed loss, and the I/O knee is at 60% load with up to 40% speed loss.
Past 100% load, the available capacity is also shared proportionally across the active Tasks.

Slower Tasks hold their Slots longer, so throughput plateaus and queues grow.
That feedback loop is the main signal of a resource bottleneck.

### Memory

Memory used is base Worker memory plus a fixed amount per active Task plus the memory of each cached Workflow.
**Workflow Cache Memory / Entry** sets the per-entry cost, from 1 to 16 MB.
When memory used exceeds capacity, the Worker evicts least recently used cache entries until it fits.
Memory pressure never blocks or kills Tasks.

This creates a cross-resource chain: low memory evicts cached Workflows, evictions cause replay, and replay consumes CPU.

## Workflow cache and replay

After a Workflow Task finishes, the Worker keeps the Workflow Execution in its Workflow cache.
**Workflow Cache Capacity / Worker** sets the entry limit, from 0 to 50, and 0 disables caching.
The cache evicts the least recently used entry when it is full, and it removes an entry when its Workflow Execution completes.

When a later Workflow Task runs on a Worker that has the Workflow cached, it is a cache hit and runs only its own work.
On a cache miss, the Worker first replays the Workflow from its Event History.
Replay is CPU work proportional to the Workflow's history length and the replay latency setting.
It runs before the Workflow Task's own work, and the Slot stays occupied during replay.

A larger cache uses more memory and causes fewer misses, less replay, and less replay CPU.

### Sticky routing

A follow-up Workflow Task for a cached Workflow waits for the Worker that holds the cache entry.
If that Worker does not pick it up within 2 seconds, the Task falls back to the shared Workflow Task Queue.
The original Worker still hits its cache if it takes the fallback Task; any other Worker replays, and the original Worker's stale entry is evicted.
So with several Workers, starved Workflow Slots or Pollers can turn cache hits into replays.

The UI labels this mechanism the Workflow cache.
The Worker-side cache and the server-side sticky Task Queue are distinct components that serve one optimization.

## Workflow generation and run control

**Workflow generation mode** has two options:

- **Manual** starts a fixed number of Workflow Executions, from 1 to 1000, with **Start N Workflows**.
  The run auto-pauses once every Workflow Execution has completed and activity has stayed at zero for 2 simulated seconds.
- **Continuous** starts Workflow Executions at a configured rate per second, minute, or hour until paused.

Pause, Resume, and Reset control the run, and Reset keeps the current settings.
Every setting applies live during a run.
The engine is deterministic, so the same settings and actions produce the same run.

## Teaching scenarios

Each scenario reproduces one bottleneck.
Some have a preset, and the rest need slider changes from the default.

### Balanced

Preset: Default setting.
Tasks match to waiting Pollers right away, Slots cycle, resources stay below their knees, and queues stay empty.

### Activity Poller constrained

Preset: Poller constrained.
One Activity Poller feeds eight Activity Slots.
The Activity Task Queue grows while Activity Slots sit idle and CPU stays low.
Adding Activity Pollers drains the queue.

### Workflow Poller constrained

No preset: set Workflow Pollers to 1 with several Workflow Slots, and raise the Workflow start rate.
The Workflow Task Queue grows while Workflow Slots sit idle.
Cache hit rate also falls, because sticky Tasks time out and fall back.

### Activity Slot constrained

Preset: Slot constrained.
One Activity Slot stays busy, Pollers wait for it, and Activity Tasks queue behind it.
Adding Activity Slots helps until another resource becomes the limit.

### Workflow Slot constrained

No preset: set Workflow Slots to 1 and raise the Workflow start rate or the number of Execution Phases.
Workflow Tasks queue behind the busy Slot and their schedule-to-start latency grows.

### CPU constrained

Preset: CPU constrained.
Eight Activity Slots run CPU-bound Activities on 0.5 CPU.
The CPU meter pins, Tasks slow, and the backlog grows even though Slots are free.
More Slots stop helping, and more CPU restores throughput.
The lesson is that the bottleneck moved from concurrency to compute.

### I/O constrained

Preset: I/O constrained.
I/O-bound Activities saturate half the default I/O capacity while CPU stays low.
Adding Activity Slots helps only until I/O capacity saturates.
The lesson is that low CPU does not mean concurrency is too high.

### Workflow cache constrained

No preset: lower Workflow Cache Capacity / Worker below the number of concurrently running Workflow Executions.
Cached Workflows are evicted, cache hit rate falls, replays rise, and CPU demand from Workflow Tasks grows.
Raising the cache capacity reduces replay and costs memory.

### Memory constrained

Preset: Memory constrained.
A 64 MB Worker with 3 MB cache entries and 14 Activity Slots cannot hold its whole cache.
Memory pressure evicts cached Workflows, the hit rate drops, and replays rise.
The lesson is that cache capacity costs memory.

### Bottleneck migration

Start from Slot constrained and raise Activity Slots until the queue drains, then raise the Workflow start rate or the Activity demand.
CPU becomes the next limit.
The intervention worked, and the bottleneck moved.

## Semantic rules

The model and the UI follow these rules:

1. Workflow Executions and Tasks are different things, and a Workflow Execution persists while its Tasks come and go.
2. The Temporal Service owns Task Queues, and Workers own Pollers, Slots, the Workflow cache, and physical resources.
3. Workflow and Activity Pollers, Slots, and Task Queues are distinct.
4. Pollers retrieve and dispatch work, and Slots execute it.
5. CPU, memory, and I/O are physical limits, separate from Slot counts.
6. CPU-bound and I/O-bound are resource profiles, separate from Task type.
7. Cache misses add replay work, and the cache trades memory for less replay.
8. One Task keeps one visual identity across all its states.
9. Every visual element supports any runtime setting change.
10. Simulation behavior takes priority over visual effects.

## Out of scope

The simulator does not model:

- Activity or Workflow retries and timeouts.
- Activity Heartbeats and cancellation.
- Local Activities, Child Workflows, Timers, Signals, Queries, Updates, and Nexus.
- Worker Versioning, Build IDs, and Task Queue partitions.
- Eager Activity execution and eager Workflow start.
- Temporal Service internals, persistence, and Temporal Cloud rate limits.
- Network failures, Worker crashes, out-of-memory kills, and garbage collection.
- Resource-based slot suppliers and poller autoscaling.
- SDK-specific threading and runtime differences.
- Horizontal scaling in the UI.
  The engine supports up to four Workers with round-robin dispatch, but the UI always runs one Worker.
