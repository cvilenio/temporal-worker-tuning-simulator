# Temporal Worker Tuning Simulator visual and interaction design

This document describes what the simulator shows and how the user controls it.
It reflects the current UI in `src/App.tsx`, `src/controls/`, `src/visualization/`, and `src/styles.css`.
[`SCOPE_BEHAVIOR_SPEC.md`](SCOPE_BEHAVIOR_SPEC.md) covers what the simulator teaches, and [`SIM_ENGINE_SPEC.md`](SIM_ENGINE_SPEC.md) covers the engine mechanics.

## Design principles

The scene is an animated diagram that reads left to right: Client, Temporal Service, Task Queues, Worker Pollers, Worker Slots.
A viewer should be able to tell within a few seconds where work originates, where it waits, where it is picked up, and where it runs.

These rules hold across the UI:

- The visual layer renders engine state and adds no semantics of its own.
- Each engine Task is exactly one rendered square, keyed by Task ID, and it keeps its identity as it moves from queue to Poller to Slot.
- Task color encodes Task type only: `--color-workflow` for Workflow Tasks and `--color-activity` for Activity Tasks.
- Location encodes state: a Task in a queue is waiting, a Task on a Poller has been claimed, and a Task in a Slot is executing.
- A Workflow Execution is a separate object from its Tasks and stays in the Temporal Service while its Tasks come and go.
- Every visual element should make a concept easier to understand; anything that does not is left out.

## Page layout

The page is a single column with a minimum width of 960px.

```text
+------------------------------------------------------------------+
| Temporal Worker Tuning Simulator              Current run time 0s |
+------------------------------------------------------------------+
| Controls panel                                                    |
|   Workflow generation mode, count or rate, Start / Pause / Reset  |
|   Time scale                                                      |
|   Simulator config: Preset, Custom settings (collapsed)           |
+------------------------------------------------------------------+
| TEMPORAL TASK FLOW                                                |
|   +--------+  +------------------------+  +---------------------+ |
|   | CLIENT |  | TEMPORAL SERVICE       |  | WORKER A            | |
|   +--------+  +------------------------+  +---------------------+ |
+------------------------------------------------------------------+
| > Monitoring (collapsed)                                          |
| > Diagnostics (collapsed)                                         |
+------------------------------------------------------------------+
```

The header clock shows simulated time since the current run started and stops at an auto-pause.
Below 1100px wide, the controls grid collapses to two columns and the action buttons wrap onto their own row.

## Scene

The scene is one SVG with a fixed `0 0 1200 600` viewBox that scales to the panel width.
It has three regions drawn as rounded rectangles.

### Client region

The Client region holds a triangular emitter labeled "Workflow Start" and an arrow into the Temporal Service.
Each Workflow start appears as a small filled circle that travels from the emitter to its slot in the Active Workflows list.

The bottom of the region holds the shape legend: Workflow (circle), Workflow Task (square), Activity Task (square), and Command / result RPC (diamond).

### Temporal Service region

The left half of the region is the "Temporal Service Core" box, subtitled "Workflow state / history" and "Task scheduling".
It holds the Active Workflows grid, five columns wide.

A Workflow Execution is a filled circle in `--color-text` with its count of outstanding Tasks printed inside.
When the Workflow completes, the circle switches to an inset fill with a `--color-success` outline and a check mark.
It holds for 2 seconds and fades out over 0.5 seconds.
The hold and fade run on real (presentation) time, so they last the same at every time scale.
The list shows at most 20 Workflows and prints "+N" for the rest.
When more than one Worker is running, a Workflow that is warm in a Worker's cache gets a small badge with that Worker's letter.

The right half holds two lanes, labeled "WORKFLOW LANE" and "ACTIVITY LANE".
Each lane has a queue box titled with its live depth, for example "Workflow Task Queue (3)".
New Tasks travel from the core into the queue entrance, then slide to the next free position at the queue head.
A queue draws at most 20 Tasks and prints "+N" for the overflow.

### Worker region

With one Worker, the region is titled "WORKER A" and wraps its contents in an inner outline.
With more than one, it is titled "WORKERS (n)" and draws every Worker's Pollers and Slots as one combined group.
The engine supports up to four Workers, but the UI has no Worker count control, so the app always runs one.

Each lane mirrors its queue on the Worker side:

- **Pollers** are circles in a grid four columns wide.
  An idle long-polling Poller has a surface fill.
  A Poller holding a claimed Task fills with `--color-border-strong` and a brighter outline.
- **Slots** are rounded squares in a grid eight columns wide.
  Available Slots are inset.
  A reserved Slot has a dashed `--color-warning` outline.
  An occupied Slot has a surface fill.
  A draining Slot drops to 45% opacity until its Task finishes and the engine removes it.
  After the Slot limit drops, an idle Slot within the limit also shows as draining until in-flight Tasks bring the occupied count below the limit.

The Workflow Cache view sits between the two lanes.
It draws up to eight cells per Worker, labeled with the cached Workflow's short ID (`WF1`, `WF2`), plus an "n / capacity" count.
A cache hit flashes the matching cell in `--color-replay` for 0.5 seconds.
An eviction shows "WFn evicted" in `--color-danger`, or "WFn closed" when the Workflow completed, and fades over 0.8 seconds.
The right end of the row shows "Hit N% · Replays N".
A capacity of 0 shows "disabled".

The bottom of the region holds three resource meters, each with a percentage and a detail readout:

| Meter | Fill | Detail |
| --- | --- | --- |
| CPU | `--color-cpu` | demand / capacity in CPU |
| Memory | Three segments: base Worker (`--color-text-muted`), active Tasks (`--color-active-task`), Workflow cache (`--color-cache`) | used / capacity in MB |
| I/O | `--color-io` | demand / capacity in throughput |

A "Memory colors" legend above the meters names the three memory segments.
The memory meter's hover title breaks usage down by segment.
When CPU or I/O is throttled, or memory is under pressure, the meter fill turns `--color-danger` and pulses with a glow.

### Return rail

A dashed rail runs from the right edge of the Worker region back to the Temporal Service core, labeled "COMMANDS / RESULTS -> TEMPORAL".
The rail is dim at rest and brightens while any completion is in flight.
When a Task finishes, a diamond travels from its Slot to the rail, then left along it to the core, over a dashed path drawn for the length of the trip.

## Task encodings

| Element | Encoding |
| --- | --- |
| Workflow Task | 10px square in `--color-workflow` |
| Activity Task | 10px square in `--color-activity` |
| I/O-bound Task | Same square at 25% fill opacity with a dashed outline, in every state |
| Replaying Workflow Task | Inset fill with a `--color-replay` outline; its Slot gets a `--color-replay` outline and a "↻" glyph |
| Sticky-wait Workflow Task | Spinning dashed `--color-success` ring plus the letter of the Worker it is waiting for |
| Sticky fallback | The Task outline flashes `--color-danger` for 0.7 seconds when it falls back to the shared queue |
| Claimed Task | Dashed lines from the queue exit to the Poller and from the Poller to the reserved Slot, plus a ring around the Poller |
| Poll request | Dashed line pulsing to the left of each idle long-polling Poller, drawn only when a lane has four or fewer Pollers |

The I/O dim reflects the Task's resource profile, not a moment-to-moment CPU or I/O phase.

## Color tokens

All colors are CSS custom properties on `:root` in `src/styles.css`.
The page uses a single dark theme.

| Token | Role |
| --- | --- |
| `--color-workflow` | Workflow Tasks, Workflow Task chart series |
| `--color-activity` | Activity Tasks, Activity Task chart series |
| `--color-cpu` | CPU meter and CPU chart line |
| `--color-io` | I/O meter and I/O chart line |
| `--color-cache` | Workflow cache memory segment |
| `--color-active-task` | Active Task memory segment |
| `--color-magenta` | Memory chart line |
| `--color-replay`, `--color-warning` | Replay, reserved Slots, cache hit flash |
| `--color-success` | Completed Workflows, cache labels, sticky routing, warm badges |
| `--color-danger` | Throttling, evictions, sticky fallback |
| `--color-pause` | Auto-pause markers on charts |
| `--color-control` | Accent for buttons, sliders, and checkboxes |

Inter at weight 300 is the primary typeface, and Courier New is used for the Diagnostics JSON and the Task statistics table.

## Motion and time

Task movement is driven by engine state, not by renderer timers.
Each transit (start request, queue admission, poll dispatch, Slot dispatch, completion return) is an engine stage with a fixed simulated duration.
The renderer interpolates a Task's position from the stage start time and the stage duration.
Because transits run on simulated time, the time scale speeds them up or slows them down along with everything else.

The animation loop runs on `requestAnimationFrame`.
Each frame converts elapsed real time to simulated time (time scale times a base rate of 0.75), steps the engine in fixed 50ms ticks, and renders the latest snapshot.
A frame contributes at most 0.25 seconds of real time, so a backgrounded tab does not jump ahead.

Persistent motion is limited to the poll-request pulse, the sticky-wait ring, and the throttle pulse on resource meters.
With `prefers-reduced-motion: reduce`, those animations, the cache hit flash, the eviction fade, and the sticky fallback flash are turned off, and throttled meters show a solid `--color-danger` fill.

## Controls panel

### Workflow generation

The "Workflow generation mode" radio chooses between Manual and Continuous.

In Manual mode, a "Workflows to start" stepper sets a count from 1 to 1000, and the primary button reads "Start N Workflows".
Pressing it starts that many Workflows and arms auto-pause.
The run pauses itself once every Workflow has completed and the queues, Slots, resource demand, and throughput metrics have stayed idle for 2 simulated seconds.

In Continuous mode, a "Workflow starts" number input and a per second, per minute, or per hour select set the start rate.
The primary button reads "Start continuous" and is disabled while the run is playing.
Starting fires one Workflow immediately, then follows the rate.

Pause stops the run, and the same button reads Resume after a manual pause.
It is disabled before the first Start and after an auto-pause.
Reset clears the run, its metrics, and its auto-pause markers, and keeps the current settings.

### Time scale

The time scale row has a slider from 0.25x to 2x in 0.25 steps, a number input that accepts 0.05x to 8x, and buttons for 0.5x, 1x, 2x, 4x, and 8x.
The button matching the current scale is highlighted.

### Presets

The Preset select loads a full configuration, including generation mode, start rate or count, and every Worker and Task setting.
The presets are Default setting, Default setting (manual mode), Poller constrained, Slot constrained, CPU constrained, I/O constrained, and Memory constrained.
The select shows "Custom" whenever the current settings match no preset.

### Custom settings

"Custom settings" is a collapsed section with four collapsed subsections:

- **Workflow shape** sets Execution Phases and Activities per Activity Phase, and shows a tally of Workflow Tasks and Activity Tasks per Workflow.
- **Worker capacity** sets Workflow and Activity Pollers and Slots per Worker, and Workflow Cache Capacity per Worker.
- **Worker resources** sets CPU, memory, and I/O capacity per Worker, and memory per cache entry.
- **Task resource profiles** sets a CPU-bound or I/O-bound profile, demand, base execution duration, and duration jitter for each Task type, plus replay latency per history unit for Workflow Tasks.
  "Lock profile types" keeps both Task types on the same profile.

The README lists the SDK option each Worker capacity slider maps to.

Every setting applies to the running simulation without an Apply button.
Sliders hold a draft value while being dragged and commit it on pointer release, key release, or blur, so the scene updates once the user lets go.

## Monitoring panel

"Monitoring" is a collapsed section below the scene with three open subsections.
Every chart plots simulated time from 0 to now, shades periods of resource throttling in translucent `--color-danger`, and draws a dashed `--color-pause` line at each auto-pause.

| Section | Chart | Series |
| --- | --- | --- |
| Temporal metrics | Poller busy ratio | Maximum, Workflow Tasks, Activity Tasks |
| | Slot utilization | Maximum, Workflow Tasks, Activity Tasks |
| | Sync match rate (rolling 5 seconds) | Maximum, Workflow Tasks, Activity Tasks |
| | Backlog | Total, Workflow Tasks, Activity Tasks |
| Worker resources | CPU, Memory, and I/O utilization | One line per chart in the resource color |
| Load testing | Task throughput (rolling 5 seconds) | Total, Workflow Tasks, Activity Tasks |
| | Task completion latency (rolling 5-second mean, scheduled to completed) | Overall, Workflow Tasks, Activity Tasks |
| | Task statistics table | Completed, Tasks/s, average, P25, P50, P75, P95, P99, and max latency per Task group |

The README maps each chart to its closest production metric.

## Diagnostics

"Diagnostics" is a collapsed section at the bottom that prints the raw snapshot as JSON.
It includes queue depths, Workers, aggregate Pollers, Slots, resources, and cache state, the metrics object, every live Task, and the last 12 engine events.

## Hover titles

Scene elements carry plain SVG `<title>` text for hover.
Tasks show their ID and state, plus replay or sticky-wait detail.
Workflows show their short ID, outstanding Task count, and warm or cold cache status.
Pollers and Slots show their ID and state, and the memory meter shows its segment breakdown.

## Rendering architecture

| Module | Responsibility |
| --- | --- |
| `App.tsx` | Owns the `Simulation`, the animation loop, auto-pause, and page layout |
| `controls/Controls.tsx` | Controls panel, presets, and Custom settings |
| `visualization/SimulationScene.tsx` | Scene regions, queues, Pollers, Slots, cache view, resource meters, return rail |
| `visualization/WorkflowLayer.tsx` | Workflow start requests and Active Workflows |
| `visualization/TaskLayer.tsx` | Task squares, claim lines, sticky indicators |
| `visualization/ResultLayer.tsx` | Completion diamonds on the return rail |
| `visualization/useVisualTimeline.ts` | Turns engine events into start, completion, and fade timing for the Workflow and result layers |
| `visualization/geometry.ts` | Lane positions, grid layout, queue caps |
| Chart components | `TemporalMetricChart`, `ResourceUsageChart`, `TaskThroughputChart`, `TaskLatencyChart`, `TaskDistributionTable`, with shared `ThrottleBands` and `ChartLifecycleMarkers` |

The layers are drawn in order: result diamonds, then Workflows, then Tasks, so Tasks stay on top.
