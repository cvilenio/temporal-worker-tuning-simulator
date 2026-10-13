# Temporal Worker Tuning Simulator

A browser-based teaching simulator that shows how Worker Pollers, Slots, Workflow cache, and CPU, memory, and I/O capacity shape Task throughput and Task Queue backlog.

![Workflow and Activity Tasks flowing from the Temporal Service through Task Queues into a Worker's Pollers and Slots](docs/media/hero.gif)

## Quick start

Requires Node.js 20.19 or later.

```sh
npm install
npm run dev
```

Open the URL Vite prints, then press **Start continuous**.

## Before you start

> [!IMPORTANT]
> This is a teaching simulation.
> It does not connect to Temporal, read metrics from your Workers, or tune or recommend settings for a real deployment.
> Every Task, Worker, and metric on screen is simulated in your browser so you can build intuition for how Worker settings interact.

Worker tuning decides whether a Temporal application keeps up with demand, responds promptly, and uses its compute efficiently.
The settings involved interact in ways that are hard to see from dashboards alone.
The simulator makes those interactions visible: change one setting and watch Tasks move, queue, and wait.

### From a Workflow Definition to Tasks

A Temporal application runs in two environments.
The Temporal Service keeps durable state and Event History and decides what work comes next.
Your Workers run your Workflow and Activity code.
The two coordinate through Tasks.

A Workflow Definition is a sequence of steps, such as local logic, Timers, and Activity calls.
As a Workflow Execution runs, Temporal drives those steps forward with two kinds of Tasks:

- A Workflow Task runs your Workflow code until it needs something, then returns Commands such as "schedule these Activities."
- An Activity Task runs one Activity and returns its result.

A Workflow that calls three Activities one after another produces four Workflow Tasks and three Activity Tasks, alternating.
The simulator's **Workflow shape** settings control this pattern.

### How Workers receive Tasks

1. A Client asks the Temporal Service to start a Workflow.
2. The Temporal Service schedules the first Workflow Task on a Task Queue.
3. A Worker's Poller receives the Task from the Task Queue.
4. The Worker runs the Task in a Slot.
5. The Worker reports Commands or results back to the Temporal Service.
6. The Temporal Service records the progress as Events, then schedules the next Tasks or records completion.

Workflow Tasks and Activity Tasks are queued separately, even under one Task Queue name, and each type has its own Pollers and Slots, which is why the scene shows two lanes.

### Worker capacity

| Setting | Role | Symptom when it is the bottleneck |
| --- | --- | --- |
| Pollers | Request Tasks from a Task Queue; a Poller polls only while a Slot is free | The queue grows while Slots sit idle |
| Slots | Run one Task each, concurrently | Every Slot is busy and Tasks wait in the queue |
| Workflow cache | Keeps Workflow state in memory so the next Workflow Task skips replaying the Event History | Cache hit rate falls and replay CPU rises |
| CPU, memory, I/O | The physical capacity that running Tasks share | A meter saturates, Tasks slow down, and the queue grows even though Slots are free |

The same symptom, a growing backlog, can come from any row in this table.
Learning to tell them apart is the main skill the simulator teaches.

### Learning with the simulator

- Before you start a preset, predict which queue will back up and which meter will move, then run it and check your prediction.
- Change one setting at a time so you can attribute what changes.
- After you remove a bottleneck, look for the next one, because raising one limit usually moves the constraint somewhere else.
- Read the Monitoring charts the way you would read production dashboards; [Monitor live metrics](#monitor-live-metrics) maps each chart to its closest SDK or Temporal Cloud metric.

The simulator models fixed Poller and Slot counts, the settings in the [SDK option table](#tune-with-sliders).
Real SDKs also offer resource-based Slot suppliers and Poller autoscaling, which adjust these counts at runtime; see [Worker performance](https://docs.temporal.io/develop/worker-performance) in the Temporal docs.
[`design/SCOPE_BEHAVIOR_SPEC.md`](design/SCOPE_BEHAVIOR_SPEC.md) lists what else the model leaves out.

## Run a preset

![Switching from the default preset to CPU constrained mid-run, after which the CPU meter saturates and the Activity Task Queue backs up](docs/media/presets.gif)

Each preset loads a workload and Worker configuration that reproduces one bottleneck.
Pick one from the **Preset** menu, then press **Start continuous**.
You can switch presets while a run is in progress.

| Preset | Bottleneck | What to watch |
| --- | --- | --- |
| Default setting | None | Tasks match to waiting Pollers immediately and the queues stay empty. |
| Default setting (manual mode) | None | Starts a fixed number of Workflows and auto-pauses when they finish. |
| Poller constrained | One Activity Poller feeding eight Activity Slots | Slots sit idle while the Activity Task Queue grows. |
| Slot constrained | One Activity Slot | Pollers wait for a free Slot and Activity Tasks queue behind it. |
| CPU constrained | 0.5 CPU shared by CPU-bound Activities | The CPU meter pins at 100%, Tasks slow down, and the backlog grows even though Slots are free. |
| I/O constrained | Half the I/O throughput for I/O-bound Activities | The I/O meter saturates while CPU stays low. |
| Memory constrained | 64 MB of Worker memory with a 3 MB-per-entry Workflow cache | Cache evictions force Workflow replays, lowering the cache hit rate. |

The time scale controls run the simulation from 0.25x to 8x real time.
**Reset** clears the run and keeps the current settings.

## Tune with sliders

![Dragging Activity Slots from 1 to 8 during a slot-constrained run, after which the Activity Task Queue drains](docs/media/tuning.gif)

Open **Custom settings** to change any value while the simulation runs.
Changes apply immediately, and the **Preset** menu switches to **Custom** once the settings no longer match a preset.

**Workflow shape** sets the number of execution phases and the number of Activities per phase.
Each Workflow Task schedules one phase, and every Activity in that phase must finish before the next Workflow Task runs.

**Worker capacity** maps to these Worker options:

| Slider | Go SDK option | Python SDK option |
| --- | --- | --- |
| Workflow Pollers / Worker | `MaxConcurrentWorkflowTaskPollers` | `max_concurrent_workflow_task_polls` |
| Workflow Slots / Worker | `MaxConcurrentWorkflowTaskExecutionSize` | `max_concurrent_workflow_tasks` |
| Activity Pollers / Worker | `MaxConcurrentActivityTaskPollers` | `max_concurrent_activity_task_polls` |
| Activity Slots / Worker | `MaxConcurrentActivityExecutionSize` | `max_concurrent_activities` |
| Workflow Cache Capacity / Worker | `worker.SetStickyWorkflowCacheSize` | `max_cached_workflows` |

**Worker resources** sets the CPU, memory, and I/O capacity of each Worker, plus the memory each cached Workflow uses.

**Task resource profiles** marks Workflow Tasks and Activity Tasks as CPU-bound or I/O-bound and sets their demand, base duration, duration jitter, and replay latency.
**Lock profile types** keeps both Task types on the same profile.

## Monitor live metrics

![Poller busy ratio, Slot utilization, sync match rate, and backlog charts updating during a slot-constrained run](docs/media/monitoring.gif)

Expand **Monitoring** below the Task flow diagram to chart the current run as it happens.
Charts plot simulated time, split Workflow Tasks from Activity Tasks, shade periods of resource throttling, and mark auto-pauses.
Metrics are held in the browser for the current run only, and **Reset** clears them.

| Section | Chart | Closest production metric |
| --- | --- | --- |
| Temporal metrics | Poller busy ratio | Poll success rate: `temporal_cloud_v1_poll_success_count` against `temporal_cloud_v1_poll_timeout_count` |
| | Slot utilization | `temporal_worker_task_slots_used` against `temporal_worker_task_slots_available` |
| | Sync match rate | `temporal_cloud_v1_poll_success_sync_count` divided by `temporal_cloud_v1_poll_success_count` |
| | Backlog | `temporal_cloud_v1_approximate_backlog_count` |
| Worker resources | CPU, memory, and I/O utilization | Host or container metrics, such as `container_cpu_usage_seconds_total` and `container_memory_usage_bytes` |
| Load testing | Task throughput | Rate of `temporal_workflow_task_execution_latency_count` and `temporal_activity_execution_latency_count` |
| | Task completion latency | `temporal_workflow_task_schedule_to_start_latency` and `temporal_activity_schedule_to_start_latency` plus execution latency |
| | Task statistics | Completed counts, throughput, and P25 through P99 latency for the run |

Self-hosted clusters emit the server metrics without the `temporal_cloud_v1_` prefix, for example `poll_success_sync` and `approximate_backlog_count`.

**Diagnostics** at the bottom of the page shows the raw simulation state as JSON.

## How the model works

The simulator runs a deterministic, fixed-step engine in the browser.
Workflows start at the Client, the Temporal Service schedules Workflow Tasks and Activity Tasks onto separate Task Queues, and the Worker's Pollers and Slots pull and execute them against shared CPU, memory, and I/O.
A sticky Workflow cache lets later Workflow Tasks skip replay when the Workflow is still cached.

The design specs describe the behavior in detail:

- [`design/SCOPE_BEHAVIOR_SPEC.md`](design/SCOPE_BEHAVIOR_SPEC.md) covers what the simulator teaches.
- [`design/SIM_ENGINE_SPEC.md`](design/SIM_ENGINE_SPEC.md) covers the simulation mechanics.
- [`design/VISUAL_SPEC.md`](design/VISUAL_SPEC.md) covers the visual and interaction model.

## Development

```sh
npm test
npm run build
```

Enable the sensitive-content pre-commit hook once after cloning:

```sh
git config core.hooksPath .githooks
```

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for details.

### Regenerate the README GIFs

The GIFs in `docs/media/` are recorded by [`scripts/record-readme-media.mjs`](scripts/record-readme-media.mjs), which drives the app in headless Chromium.
Re-record them after UI changes.

```sh
brew install ffmpeg gifski
npx playwright install chromium
npm run readme:media
```

Pass scene names to record a subset, for example `npm run readme:media -- tuning monitoring`.
