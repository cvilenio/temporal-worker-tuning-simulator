# Temporal Worker Scaling Simulator — v0 Visual & Interaction Specification

## 1. Purpose

This document defines the **visual structure and interaction model** for the first crude implementation of the Temporal Worker Scaling Simulator.

The goal of v0 is not to look polished.

The goal is to make the simulation:

- immediately understandable;
- easy to manipulate;
- faithful to the conceptual model;
- visually debuggable;
- suitable for rapid iteration;
- simple enough that aesthetic decisions do not obscure whether the simulation itself works.

The v0 visual design should feel closer to an **animated explanatory diagram** than a production dashboard.

---

# 2. Relationship to the other specifications

This document complements:

### Scope & Behavioral Spec

Defines:

> What the simulator should teach.

### Simulation Engine Spec

Defines:

> What happens mechanically.

### Visual & Interaction Spec

Defines:

> What the user sees and how they manipulate it.

The visual layer must not introduce semantics that do not exist in the engine.

---

# 3. Primary visual principle

The entire simulator should be understandable as a left-to-right flow:

```text
Client
  ↓
Temporal Service
  ↓
Task Queues
  ↓
Worker
  ↓
Execution
```

More precisely:

```text
CLIENT

   ↓ Workflow Start

TEMPORAL

   Workflow Execution
         ◎

   Workflow Task Queue
         ●

   Activity Task Queue
      ● ● ● ●

          ↓

WORKER

Workflow Pollers → Workflow Slots

Activity Pollers → Activity Slots

Workflow Cache

CPU / Memory
```

The user should be able to look at the screen for a few seconds and infer:

- where work originates;
- where it waits;
- where it is retrieved;
- where it executes;
- what resources constrain it.

---

# 4. Initial screen composition

Use a single-screen layout.

Recommended composition:

```text
┌─────────────────────────────────────────────────────────────┐
│ Temporal Worker Scaling Simulator                           │
│                                                             │
│ [Play] [Pause] [Reset]                         Speed: 1×    │
├─────────────┬───────────────────────┬───────────────────────┤
│             │                       │                       │
│   CLIENT    │      TEMPORAL         │       WORKER          │
│             │                       │                       │
│             │ Workflow Executions   │ Workflow              │
│     ●       │      ◎ ◎ ◎            │ Pollers → Slots       │
│      \      │                       │ ○ ○      [●][ ]       │
│       \     │ Workflow Queue        │                       │
│        →    │ ● ● ●                 │ Activity              │
│             │                       │ Pollers → Slots       │
│             │ Activity Queue        │ ○ ○ ○    [●][●][ ]   │
│             │ ● ● ● ● ●             │                       │
│             │                       │ Workflow Cache        │
│             │                       │ ◎ ◎ ◎ ◎               │
│             │                       │                       │
│             │                       │ CPU     64%           │
│             │                       │ Memory  42%           │
│             │                       │                       │
├─────────────┴───────────────────────┴───────────────────────┤
│ Controls                                                    │
│                                                             │
│ Workflow Rate     [----|------]  2/sec                      │
│ Activities/WF     [---|-------]  4                          │
│ Profile           [ I/O-bound ▼ ]                           │
│                                                             │
│ W Pollers         [--|--------]  2                          │
│ A Pollers         [---|-------]  3                          │
│ W Slots           [--|--------]  2                          │
│ A Slots           [----|------]  4                          │
│ CPU               [----|------]  4                          │
│ Memory            [----|------]  2 GiB                      │
│ Cache             [-----|-----]  50                         │
└─────────────────────────────────────────────────────────────┘
```

This does not have to be visually sophisticated.

The structure matters more than precise placement.

---

# 5. Layout hierarchy

## Left region — Client

Contains:

- Client label;
- Workflow Start emitter;
- optional small current request-rate label.

The Client should occupy relatively little space.

Its primary role is to make incoming demand visible.

---

## Center region — Temporal Service

The Temporal Service should be visibly enclosed by one clear boundary.

Inside that boundary:

- persistent Workflow Executions;
- Workflow Task Queue;
- Activity Task Queue.

Task Queues must never appear outside the Temporal boundary.

---

## Right region — Worker area

The Worker boundary should clearly contain:

- Workflow Pollers;
- Workflow Slots;
- Activity Pollers;
- Activity Slots;
- Workflow Cache;
- CPU indicator;
- Memory indicator.

Pollers must never appear outside the Worker boundary.

For multiple Workers, duplicate this structure vertically or horizontally.

---

# 6. Visual grammar

Use simple geometric objects.

Avoid icons unless they materially clarify meaning.

The initial visual vocabulary should consist primarily of:

- circles;
- hollow circles;
- rectangles;
- thin lines;
- labels;
- simple bars.

---

# 7. Workflow Execution representation

Represent a Workflow Execution as a larger hollow circle.

Example:

```text
◎
```

Properties:

- persistent;
- larger than Tasks;
- visually distinct from Tasks;
- remains visible while the Workflow waits;
- does not occupy Worker Slots unless a Workflow Task is currently executing.

The Workflow Execution represents durable orchestration state.

---

# 8. Workflow Task representation

Represent a Workflow Task as a small solid circle.

Example:

```text
●
```

Use one dedicated semantic color.

Recommended initial semantic palette:

```text
Workflow Execution = light neutral outline
Workflow Task      = blue
Activity Task      = orange
```

Exact colors should not be heavily tuned in v0.

Color meaning should remain stable.

---

# 9. Activity Task representation

Represent an Activity Task as the same basic dot shape but with its own semantic color.

Example:

```text
●
```

The difference between Workflow and Activity Tasks should come from color, not completely different shapes.

This reinforces:

> Both are Tasks, but they are different Task types.

---

# 10. One dot = one logical unit of work

This is a hard rule.

If the engine contains:

```text
activity-task-103
```

the renderer shows exactly one visible Activity Task dot for that entity.

Do not create:

- decorative copies;
- spark particles that resemble Tasks;
- duplicate queue dots;
- phantom dots to make motion look busier.

Glow or a trail may eventually be attached to a dot, but these effects must clearly belong to the same object.

---

# 11. Semantic location

Each Task should occupy exactly one visible semantic location at any point.

Examples:

### Queued

```text
Activity Queue

● ● ● ●
```

### Dispatching

```text
Poller ○
        \
         ●
          \
           ▼
          [ ]
```

### Running

```text
[●]
```

A Task should never visually exist both in the queue and the Worker simultaneously.

---

# 12. Workflow start animation

The simplest initial animation:

```text
Client

●
 \
  \

Temporal

◎
```

The Client emits a Workflow Start point.

When it reaches Temporal:

1. create the persistent Workflow Execution `◎`;
2. schedule its first Workflow Task `●`.

Conceptually:

```text
Request ●
     ↓

Workflow ◎
     │
     └── ● Workflow Task
```

This transformation should be simple and readable.

No explosion or elaborate particle effect.

---

# 13. Workflow-to-Activity split

When the initial Workflow Task schedules Activities, the Workflow Execution remains visible.

Example:

```text
                 ●
               ↗
Workflow ◎ ─── ●
               ↘
                 ●
```

The Activity dots then move into the Activity Task Queue.

For four Activities:

```text
Workflow ◎

     ↘ ●
      ↘ ●
      ↗ ●
     ↗ ●

Activity Queue
```

The key teaching message is:

> The Workflow persists while it creates separate pieces of work.

---

# 14. Workflow Task Queue

The Workflow Task Queue should initially be a simple bounded region.

Example:

```text
Workflow Task Queue

┌────────────────┐
│ ● ● ●          │
└────────────────┘
```

Task ordering may be represented left-to-right.

Oldest Task should generally appear closest to the dispatch edge.

No scrolling queue visualization is required.

---

# 15. Activity Task Queue

Same visual structure:

```text
Activity Task Queue

┌─────────────────────────┐
│ ● ● ● ● ● ● ●          │
└─────────────────────────┘
```

Because Activity backlogs may grow substantially, support visual compression.

For example:

Up to 20 Tasks:

```text
● ● ● ● ● ● ●
```

Above visual capacity:

```text
● ● ● ● ● ● ● ● ● ●  +37
```

The engine still retains every Task.

The renderer may aggregate hidden overflow visually.

---

# 16. Queue overflow visualization

Do not attempt to render thousands of dots.

Use a configured visual threshold.

Example:

```text
MAX_VISIBLE_QUEUE_TASKS = 30
```

If queue depth is 87:

```text
render first 30 dots
show "+57"
```

The visible dots must still correspond to real Task IDs.

Aggregated Tasks do not individually animate until they enter the visible window.

---

# 17. Poller representation

Represent each Poller as a small hollow circle or simple emitter.

Example:

```text
○
```

Pollers should be arranged in a row or column.

Workflow:

```text
Workflow Pollers

○ ○
```

Activity:

```text
Activity Pollers

○ ○ ○
```

Avoid representing Pollers as ports in the Worker wall.

They are internal Worker components.

---

# 18. Poller state

Use subtle state changes.

### Polling / waiting

```text
○
```

neutral.

### Dispatching

```text
◉
```

or a slightly stronger outline.

### Retiring

reduced opacity.

Do not use constant pulsing or flashing for every Poller.

Motion should only happen when something meaningful changes.

---

# 19. Poller dispatch animation

When a Poller receives a Task:

1. identify the Slot already reserved for the Task;
2. visually orient the Poller toward that Slot;
3. animate the same Task dot from the Poller into the Slot.

Example:

```text
○
 \
  \
   ●
    \
     ▼

[ ] [ ] [ ]
     ▲
 reserved slot
```

The Task should appear to be **placed by the Poller into execution capacity**.

The path can be a simple line or curve.

The line itself is not work.

---

# 20. Queue-to-Poller movement

A Task leaving the Temporal Queue may move to the Poller first:

```text
Queue ●
       \
        \
         ○ Poller
```

then:

```text
○
 \
  ●
   \
    [ ]
```

This creates a clear conceptual sequence:

```text
Task Queue
    ↓
Poller
    ↓
Slot
```

The Poller should not appear as a permanent tunnel through which all work streams.

---

# 21. Slot representation

Use simple rectangular or circular cells.

Recommended:

```text
[ ]
```

because occupancy is immediately obvious.

Workflow Slots:

```text
[●] [ ]
```

Activity Slots:

```text
[●] [●] [ ] [ ]
```

The dot remains visible inside the Slot for the lifetime of execution.

---

# 22. Slot states

### Available

```text
[ ]
```

### Reserved for dispatch

```text
[·]
```

or subtle outline change.

### Occupied

```text
[●]
```

### Draining

```text
[●]
```

with a small down-arrow or reduced border opacity if necessary.

Do not add text inside every Slot.

---

# 23. CPU-bound Activity execution

A CPU-bound Activity remains visibly active inside the Slot.

Example:

```text
[●]
```

Potential simple animation:

- dot rotates slightly;
- dot has a fast subtle pulse;
- thin progress ring advances.

Do not rely on an animation loop to communicate CPU usage.

The CPU bar elsewhere remains authoritative.

---

# 24. I/O-bound Activity execution

The Activity stays in the Slot while waiting on I/O.

The user should be able to distinguish:

```text
executing CPU
```

from:

```text
waiting on I/O
```

without creating another Task representation.

Suggested visual behavior:

### CPU phase

solid Activity dot:

```text
[●]
```

### I/O wait

same dot becomes hollow or dimmer:

```text
[○]
```

Then returns to solid during the final CPU phase.

This teaches:

> The Slot is still occupied even though CPU usage may be low.

That distinction is extremely important.

---

# 25. Workflow Task execution

A Workflow Task entering a Workflow Slot:

```text
[●]
```

should usually complete quickly.

On a cache hit:

- short execution;
- no special delay.

On a cache miss:

- Task visibly spends additional time in replay.

---

# 26. Replay visualization

Replay should be visible but simple.

Recommended:

```text
Workflow Slot

[● ↺]
```

or:

```text
REPLAY
[●]
```

with a small temporary label above the Slot.

The same Workflow Task remains in the Slot.

Do not create a separate “replay Task.”

When replay ends, remove the label and continue normal Workflow execution.

---

# 27. Workflow Cache representation

The cache should appear as a separate Worker subsystem.

Example:

```text
Workflow Cache

◎ ◎ ◎ ◎ ◎
```

Each cached Workflow uses the persistent Workflow identity symbol.

This is intentionally different from Task dots.

If cache capacity is larger than visually convenient, use:

```text
◎ ◎ ◎ ◎ ◎   5 / 50
```

Do not display 50 separate icons unless useful.

---

# 28. Cache insertion animation

After a Workflow Task completes and the Workflow remains open:

- the Workflow Execution already exists;
- its cache status should become visible inside the Worker.

A subtle link or movement may show:

```text
Workflow ◎
    ↓
Worker Cache ◎
```

However, this does not mean the Workflow Execution itself moved out of Temporal.

The cached icon represents the Worker's in-memory copy/state.

To avoid confusion, a later polished version may use a miniature cache marker rather than visually duplicating the full Workflow object.

For v0, simple cache occupancy is sufficient.

---

# 29. Cache hit visualization

On a cache hit:

briefly highlight the relevant cached Workflow entry.

Example:

```text
Workflow Cache

◎ ◎ ◉ ◎
    ↑
cache hit
```

No large animation is required.

---

# 30. Cache miss visualization

On a cache miss:

1. briefly display `CACHE MISS`;
2. Workflow Task enters replay state;
3. replay consumes time and CPU.

Example:

```text
Cache miss

Workflow Slot
[● ↺]
```

This should make the cost visible without turning cache behavior into a separate animation system.

---

# 31. CPU indicator

Use a simple horizontal bar.

Example:

```text
CPU

██████░░░░  61%
```

No gauge or speedometer.

At >90%:

```text
██████████  100%
```

The visual color may intensify modestly later.

For v0, percentage and fill are sufficient.

---

# 32. Memory indicator

Same pattern:

```text
Memory

████░░░░░░  42%
```

If memory exceeds configured capacity:

```text
██████████  113%
OVERCOMMITTED
```

Do not simulate dramatic failure visually in v0.

---

# 33. Worker resource placement

CPU and memory should appear at Worker level, not inside Workflow or Activity subsections.

Example:

```text
┌──────────────── Worker ────────────────┐
│                                       │
│ Workflow                              │
│ ○ ○       [●] [ ]                    │
│                                       │
│ Activity                              │
│ ○ ○ ○     [●] [●] [ ] [ ]           │
│                                       │
│ Workflow Cache                        │
│ ◎ ◎ ◎ ◎                              │
│                                       │
│ CPU     ███████░░░   70%             │
│ Memory  ████░░░░░░   40%             │
└───────────────────────────────────────┘
```

This reinforces that both Task types share the same machine resources.

---

# 34. Multiple Workers

When Worker count increases, add Worker panels.

Preferred initial layout:

```text
Temporal

     ↓

┌ Worker 1 ┐
└──────────┘

┌ Worker 2 ┐
└──────────┘

┌ Worker 3 ┐
└──────────┘
```

Workers may stack vertically.

Avoid shrinking each Worker excessively.

If more than four Workers are configured, use visual aggregation.

---

# 35. Worker aggregation

The simulator does not need to display dozens of physical Workers individually.

Recommended v0 display limit:

```text
MAX_VISIBLE_WORKERS = 4
```

If the user configures eight:

```text
Worker 1
Worker 2
Worker 3
Worker 4
+4 Workers
```

The engine continues modeling all Workers.

A later version may support zoom or aggregate fleet representations.

---

# 36. Worker scale-up animation

When Worker count increases:

```text
1 → 2
```

new Worker appears with:

- empty cache;
- available Slots;
- idle Pollers;
- low CPU;
- base memory.

Use a simple fade/slide-in.

No dramatic spawning animation.

---

# 37. Worker scale-down animation

When a Worker begins draining:

label:

```text
DRAINING
```

Reduce its border opacity slightly.

Existing Tasks remain visible.

Once empty:

fade Worker out.

This visually communicates graceful scale-down.

---

# 38. Persistent spatial relationships

Do not allow major components to move around in response to normal simulation state.

For example:

- Temporal remains in the center;
- Worker remains on the right;
- queues remain in fixed locations;
- Pollers remain in fixed locations;
- Slots remain in predictable grids.

Only work objects should move frequently.

This makes causal changes easy to follow.

---

# 39. Initial interaction controls

Use ordinary form controls.

No futuristic knobs.

## Simulation

```text
Play
Pause
Reset

Speed:
0.5×
1×
2×
4×
```

---

# 40. Workload controls

### Workflow Start Rate

Example:

```text
Workflow Rate

[----------|------]
2.0 / sec
```

Suggested range:

```text
0 – 10 / sec
```

The exact range may be tuned after prototype testing.

---

### Activities per Workflow

```text
Activities / Workflow

[----|------------]
4
```

Suggested values:

```text
1 – 10
```

---

### Activity Profile

Use segmented control or dropdown:

```text
Activity Profile

[ CPU-bound ] [ I/O-bound ]
```

No mixed profile in initial v0.

---

# 41. Worker controls

### Worker count

```text
Workers

[-] 1 [+]
```

Suggested initial range:

```text
1 – 8
```

---

### Workflow Pollers per Worker

Suggested:

```text
1 – 10
```

---

### Activity Pollers per Worker

Suggested:

```text
1 – 10
```

---

### Workflow Slots per Worker

Suggested:

```text
1 – 16
```

---

### Activity Slots per Worker

Suggested:

```text
1 – 32
```

---

### CPU per Worker

Suggested values:

```text
1
2
4
8
16
```

---

### Memory per Worker

Suggested values:

```text
512 MB
1 GB
2 GB
4 GB
8 GB
```

---

### Workflow Cache Capacity

Suggested initial range:

```text
0 – 100
```

May be a slider.

---

# 42. Live configuration behavior

Controls modify a running simulation.

The user should not need to press:

```text
Apply
```

Changes take effect according to engine semantics.

For example:

```text
Activity Slots
4 → 12
```

should visibly create additional empty Slots.

```text
CPU
2 → 8
```

should make currently running CPU work begin completing faster.

```text
Activity Pollers
1 → 4
```

should make additional Pollers appear and begin retrieving work.

---

# 43. Do not hide dynamic behavior behind transitions

UI animations must not be so slow that they hide the engine response.

For example, changing:

```text
Slots 4 → 16
```

should not take 2 seconds to visually add Slots.

Recommended structural transition:

```text
150–300 ms
```

The user's attention should remain on workload movement.

---

# 44. Default visible metrics

The first screen should avoid becoming a dashboard.

Always-visible metrics:

### Temporal

```text
Workflow Queue: 3
Activity Queue: 17
```

### Worker

```text
W Slots: 1 / 2
A Slots: 4 / 4

CPU:    78%
Memory: 46%

Cache:  9 / 50
```

### Throughput

One simple value:

```text
Activity Throughput: 7.4 / sec
```

Potentially:

```text
Workflow Completions: 1.8 / sec
```

Do not initially add time-series charts.

---

# 45. Optional diagnostics drawer

Include a developer-oriented diagnostics panel that can be opened separately.

Example:

```text
Diagnostics

Workflow Queue Depth: 14
Activity Queue Depth: 37

Workflow schedule-to-start: 0.4 s
Activity schedule-to-start: 1.8 s

CPU utilization: 98%

Cache hits: 42
Cache misses: 13
Cache evictions: 11

Replay CPU: 0.84 CPU-s
```

This is valuable for validating engine behavior without cluttering the primary teaching view.

---

# 46. Scenario presets

Presets may be included after the core controls work.

Recommended:

```text
Balanced
Poller constrained
Slot constrained
CPU constrained
I/O constrained
Cache constrained
```

Each preset simply changes ordinary controls.

No scenario-specific animation or hidden engine behavior.

---

# 47. Bottleneck labels

Do NOT initially display an automatic label such as:

```text
CURRENT BOTTLENECK: CPU
```

That would tell the user the answer instead of letting the simulation teach them.

The user should infer:

```text
queue growing
+
slots full
+
CPU 100%
```

Later, explanatory mode may offer interpretation.

---

# 48. Interaction goal

The primary interaction loop should be:

```text
observe
   ↓
form hypothesis
   ↓
move one control
   ↓
watch system change
   ↓
identify new constraint
```

The simulator should encourage experimentation.

---

# 49. Motion grammar

Every animation should correspond to one of these semantic events:

```text
request begins
Task is scheduled
Task enters queue
Task is dispatched
Task enters Slot
Task changes execution phase
Task completes
Workflow advances
Workflow completes
cache entry inserted
cache hit
cache miss
cache eviction
Worker added
Worker drained
```

If an animation does not correspond to one of these events, question whether it belongs in v0.

---

# 50. Animation duration

Keep motion readable but quick.

Suggested visual ranges:

```text
Client → Temporal:
300–500 ms

Queue → Poller:
200–350 ms

Poller → Slot:
200–350 ms

structural UI change:
150–300 ms
```

Execution duration itself comes from the engine.

Do not force execution into these animation durations.

---

# 51. Engine time vs. animation time

At high simulation speed, trying to animate every Task at full duration may become unreadable.

Therefore the renderer may:

- shorten transit animations;
- batch visually insignificant events;
- aggregate high-rate queue entries.

But it must preserve:

- Task identity where visible;
- ordering;
- relative flow;
- semantic correctness.

---

# 52. High-rate visualization

At high throughput:

Do not make dots move so fast that the screen becomes noise.

Possible strategy:

At:

```text
≤ 20 visible Task events/sec
```

show every visible Task.

Above that:

- visually sample some transit events;
- retain accurate queue counts and metrics;
- preserve all engine events internally.

However, v0 should first try to operate within workload ranges where most Tasks can remain individually visible.

---

# 53. No decorative flow lines in v0

Do not add persistent glowing lines connecting every component.

They create ambiguity about whether:

```text
line = work
line = capacity
line = network
line = data stream
```

Use temporary subtle paths only while a Task is moving.

Otherwise components remain disconnected geometrically but spatially obvious.

---

# 54. No background particles in v0

Do not use stars, sparkles, or ambient floating dots.

This conflicts directly with:

```text
dot = work
```

A space aesthetic can be introduced later through:

- background gradient;
- subtle texture;
- glow;
- typography;
- soft halos.

Not through arbitrary particles.

---

# 55. No trails initially

Do not use persistent particle trails.

They may look attractive but create duplicate visual information.

If later added, trails must:

- fade quickly;
- clearly originate from the Task;
- never resemble independent Task dots.

---

# 56. Color semantics

Initial palette should be small.

For example:

```text
background       dark neutral

Workflow Task    cool blue

Activity Task    warm orange

Workflow state   neutral/light blue outline

cache/replay     purple or secondary cool accent

warning          yellow

critical         red
```

Do not use more colors than needed.

Exact hex values are not part of v0.

---

# 57. Color must remain semantic

Do not change a Task's color merely because:

- it is moving;
- it is fast;
- it is selected;
- CPU is high.

The Task's core color identifies its Task type.

State should be expressed with:

- opacity;
- outline;
- pulse;
- small labels;
- surrounding UI state.

---

# 58. Typography

Use one modern sans-serif typeface.

No futuristic display fonts.

Recommended qualities:

- readable at small sizes;
- neutral;
- clean.

Examples of acceptable direction:

```text
Inter
system UI
similar neutral sans-serif
```

The typography should disappear into the visualization.

---

# 59. Labels

Use direct terminology.

Good:

```text
Workflow Task Queue
Activity Task Queue
Workflow Pollers
Activity Pollers
Workflow Slots
Activity Slots
Workflow Cache
CPU
Memory
```

Avoid shortened labels until space requires them.

The simulator is educational.

Clarity is more important than compactness.

---

# 60. Hover behavior

Hovering over a visible Task may show:

```text
Activity Task
activity-task-183

Workflow:
workflow-42

State:
Waiting on I/O

Queued:
0.8 s

Running:
1.2 s
```

Hover is optional in the first crude prototype.

Do not make critical information hover-only.

---

# 61. Hovering a Workflow Execution

Could show:

```text
Workflow Execution
workflow-42

State:
Waiting for Activities

Activities:
3 / 4 complete

Cached on:
Worker 1
```

Again, useful but not required for the first milestone.

---

# 62. Initial crude implementation technology

Recommended:

```text
React + TypeScript
+
SVG
```

Use:

- SVG circles for Tasks;
- SVG rectangles for boundaries and Slots;
- SVG paths for temporary movement;
- HTML controls around the SVG.

Avoid PixiJS initially.

The goal is rapid semantic iteration.

---

# 63. Why SVG first

SVG makes it easy to:

- inspect objects in dev tools;
- attach stable IDs;
- animate individual Task entities;
- label components;
- alter layout quickly;
- have AI modify the code;
- debug state visually.

Move to PixiJS only if actual performance becomes a problem.

---

# 64. Rendering architecture

Recommended conceptual structure:

```text
<SimulationScene>

  <ClientView />

  <TemporalView>
      <WorkflowExecutions />
      <TaskQueue type="workflow" />
      <TaskQueue type="activity" />
  </TemporalView>

  <WorkerFleetView>
      <WorkerView>
          <PollerGroup type="workflow" />
          <SlotGroup type="workflow" />

          <PollerGroup type="activity" />
          <SlotGroup type="activity" />

          <WorkflowCacheView />
          <ResourceBars />
      </WorkerView>
  </WorkerFleetView>

</SimulationScene>
```

Task rendering should be centralized enough to preserve identity during motion.

---

# 65. Do not bind animation directly to React component mount/unmount

Avoid:

```text
Task left queue
→ destroy queue component dot
→ create new Poller component dot
```

That risks making the Task appear to teleport or duplicate.

Prefer a shared visual Task layer keyed by stable Task IDs.

Conceptually:

```text
<TaskLayer>
    activity-task-31
    activity-task-32
    workflow-task-14
</TaskLayer>
```

Each Task calculates its target visual position based on engine state.

---

# 66. Task position model

The renderer maps semantic location to coordinates.

Example:

```text
QUEUED
→ queue coordinate

DISPATCHING
→ interpolated position between queue/poller/slot

RUNNING
→ center of assigned Slot
```

The Task itself remains the same rendered object.

This implementation choice is important enough to treat as part of the spec.

---

# 67. Crude milestone 1

The first visual milestone should contain only:

```text
1 Client

1 Temporal Service

1 Workflow Task Queue

1 Activity Task Queue

1 Worker

Workflow Pollers

Workflow Slots

Activity Pollers

Activity Slots

CPU
```

Do not add Workflow Cache yet.

Controls:

```text
Workflow Rate
Activity Slots
CPU
```

Use CPU-bound Activities only.

---

# 68. Milestone 1 acceptance test

Start with:

```text
low Activity Slot count
high CPU capacity
```

Expected visual:

```text
Activity Queue grows

Activity Slots:
[●][●]

CPU:
low/moderate
```

Increase Slots.

Expected:

```text
more Tasks enter Worker
queue starts draining
CPU rises
```

Keep increasing Slots.

Expected:

```text
CPU reaches 100%
```

Further Slot increases:

```text
little throughput improvement
```

This should be obvious without looking at engine logs.

If not, fix the visualization before adding more complexity.

---

# 69. Crude milestone 2

Add:

```text
Activity Poller control
```

Test:

```text
many available Slots
high CPU
one Poller
```

Expected:

```text
queue backlog
+
many empty Slots
```

Increase Pollers.

Expected:

```text
Slots fill
queue drains faster
```

---

# 70. Crude milestone 3

Add I/O-bound Activity profile.

Test:

```text
Activity Slots full
CPU low
queue growing
```

Increase Activity Slots.

Expected:

```text
more I/O Tasks run concurrently
throughput improves
CPU stays relatively moderate
```

The visual difference between:

```text
[●] CPU-active
```

and:

```text
[○] waiting on I/O
```

must be obvious.

---

# 71. Crude milestone 4

Add Workflow Cache.

Test:

```text
small cache
many Workflows
```

Expected:

```text
evictions
cache misses
replay labels
higher CPU usage
```

Increase cache.

Expected:

```text
fewer replay events
lower Workflow CPU overhead
```

---

# 72. Crude milestone 5

Add:

```text
Memory
multiple Workers
worker scaling
```

Do not proceed to visual polish until these interactions remain understandable.

---

# 73. What not to build yet

Do not build:

- charts;
- starfield;
- nebula;
- bloom filters;
- particle emitters;
- elaborate menus;
- onboarding walkthrough;
- responsive mobile layout;
- 3D camera;
- sound;
- worker chassis illustration;
- glowing circuit boards;
- polished gradients;
- advanced presets;
- explanatory narration;
- production settings persistence.

These can all wait.

---

# 74. Evaluation questions

After each crude milestone, evaluate the simulator with these questions:

### Can I tell where work is waiting?

### Can I tell why it is waiting?

### Can I tell the difference between Poller and Slot constraints?

### Can I tell whether CPU is the limiting factor?

### Can I tell an I/O-waiting Task from a CPU-active Task?

### Can I see that Workflow Executions persist independently of Tasks?

### Can I see Workflow work generate Activity work?

### Can I tell when replay is happening?

### Can I observe the bottleneck move after changing a control?

If the answer to any of these is unclear, do not compensate with labels or extra metrics first.

Improve the visual relationship.

---

# 75. Design rule for adding complexity

Before adding any visual element, ask:

> What concept becomes easier to understand because this exists?

If there is no clear answer, do not add it.

Examples:

### Queue boundary

Useful because it shows where Tasks wait.

### Slot cell

Useful because it shows concurrency capacity.

### CPU bar

Useful because it shows a shared physical constraint.

### Ambient stars

Do not help explain Worker scaling.

Therefore:

```text
not yet
```

---

# 76. Future aesthetic layer

Once the crude simulation is validated, the same structure may evolve toward the original space-like aesthetic.

Potential future treatments:

- nearly black background;
- very subtle radial gradients;
- soft bloom around Task dots;
- luminous Task colors;
- faint Worker/Temporal outlines;
- smooth eased trajectories;
- restrained halos around active Pollers;
- subtle resource-pressure glow;
- elegant typography.

The underlying geometry and semantic grammar should remain largely unchanged.

This is important:

> The polished version should be a stylistic evolution of a proven diagram, not a redesign of the simulation.

---

# 77. Final v0 visual principle

The prototype should initially look almost disappointingly simple.

That is intentional.

The desired progression is:

```text
correct
    ↓
clear
    ↓
interactive
    ↓
educational
    ↓
beautiful
```

not:

```text
beautiful
    ↓
try to make it correct
```

The crude simulator succeeds when the user can understand the changing bottleneck by watching a handful of dots, Slots, Pollers, and resource bars move in response to live controls.