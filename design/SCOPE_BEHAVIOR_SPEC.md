# Temporal Worker Scaling Simulator — v0 Scope & Behavioral Spec

## 1. Purpose

Build a simple interactive simulation that develops intuition for **Temporal Worker capacity, concurrency, and vertical scaling**.

The simulator should help a user understand questions such as:

- What is the difference between Pollers and Task Slots?
- Why can increasing Task Slots increase throughput?
- Why does increasing Slots eventually stop helping?
- Why are Workflow and Activity Tasks separate kinds of work?
- Why do CPU-bound and I/O-bound Activities respond differently to increased concurrency?
- How do CPU and memory constrain Worker capacity?
- What does the Workflow cache do?
- How does cache size trade memory consumption against Workflow replay?
- How can different bottlenecks produce similar symptoms such as queue growth?
- When does vertical scaling help, and when is another resource the actual constraint?

The simulator is intended to teach **cause and effect**, not predict exact production throughput.

---

# 2. Primary teaching model

The simulation revolves around four major systems:

**Client → Temporal Service → Task Queues → Workers**

The important distinction is that a Workflow Execution is **not itself a Task**.

A typical simplified lifecycle is:

1. A Client requests that a Workflow Execution start.
2. Temporal creates a Workflow Execution.
3. Temporal schedules a **Workflow Task**.
4. A Workflow Worker retrieves the Workflow Task.
5. The Workflow Task executes in a **Workflow Task Slot**.
6. Workflow code may schedule one or more Activities.
7. Temporal schedules corresponding **Activity Tasks**.
8. Activity Workers retrieve those Activity Tasks.
9. Activity Tasks execute in **Activity Task Slots**.
10. Activity results are recorded by Temporal.
11. Those results may cause another Workflow Task to be scheduled.
12. The Workflow Execution continues until completion.

Conceptually:

```text
Client
  │
  │ Start Workflow
  ▼

       Workflow Execution
              ◎
              │
              │ WFT scheduled
              ▼

┌──────────── Temporal ─────────────┐
│                                  │
│ Workflow Task Queue              │
│              ●                   │
│                                  │
└──────────────┬───────────────────┘
               ▼

        Workflow Worker
      Poller → [ WFT Slot ]

               │
               │ Workflow schedules work
               ▼

┌──────────── Temporal ─────────────┐
│                                  │
│ Activity Task Queue              │
│          ●  ●  ●                 │
│                                  │
└──────────────┬───────────────────┘
               ▼

         Activity Worker
     Pollers → [ ][ ][ ][ ]

               │
               │ Activity completion
               ▼

        another Workflow Task
               │
               ▼

       Workflow Execution ◎
            advances
```

Workflow and Activity processing may initially be shown inside the **same Worker process**, but their Pollers, Slots, Tasks, and resource characteristics must remain logically distinct.

---

# 3. A Workflow Execution persists

This is an important visual and semantic rule.

A Workflow Execution should have a persistent identity.

It should **not disappear when it creates Activity Tasks**.

Instead, the visual metaphor should be:

```text
                     Activity Task ●
                   ↗
Workflow ◎ ───────→ Activity Task ●
                   ↘
                     Activity Task ●
```

The Workflow Execution `◎` remains alive.

Later:

```text
Activity ●
    │
    │ completes
    ▼

Workflow Task ●
    │
    │ executes
    ▼

Workflow ◎ advances
```

This allows the simulation to teach an important Temporal concept naturally:

> A Workflow Execution represents durable orchestration state, while Workflow Tasks and Activity Tasks are discrete pieces of work generated over its lifetime.

Visually, it is acceptable for a Workflow point of light to appear to **split or emit multiple Tasks**, provided that the persistent Workflow identity remains visible.

---

# 4. Two separate classification dimensions

The simulator must not collapse all work into one generic Task type.

There are two orthogonal dimensions.

## Dimension A — Temporal Task Type

### Workflow Task

Runs deterministic Workflow logic.

Characteristics relevant to this simulation:

- retrieved by Workflow Task Pollers
- consumes a Workflow Task Slot while executing
- normally executes for a relatively short period
- performs orchestration logic
- may schedule Activities, timers, Child Workflows, etc.
- must remain deterministic
- does not perform arbitrary external I/O
- may require Workflow History replay
- benefits from Workflow caching

Workflow Tasks should therefore **not be classified as CPU-bound versus I/O-bound in the same way as Activities**.

Their important performance distinction for this simulator is instead:

```text
cached Workflow execution
vs.
Workflow replay after cache miss
```

---

### Activity Task

Runs Activity code.

Characteristics:

- retrieved by Activity Task Pollers
- consumes an Activity Task Slot while executing
- may interact with databases, APIs, files, other services, or compute-heavy libraries
- may be short or long running
- may be CPU-heavy, I/O-heavy, memory-heavy, or mixed

Activities are where the CPU-bound versus I/O-bound distinction becomes especially important.

---

# 5. Activity workload profiles

## CPU-bound Activity

Examples:

```text
image processing
compression
encryption
large data transformation
scientific computation
CPU-heavy serialization
```

Behavior:

- consumes significant CPU while executing
- increasing Activity concurrency raises CPU utilization
- additional Activity Slots help until available CPU becomes saturated
- once CPU is saturated, additional Slots produce diminishing or negligible throughput improvement
- excessive concurrency can increase execution latency

Example:

```text
8 Activity Slots

CPU ██████████ 100%

[●][●][●][●][●][●][●][●]

Increase slots to 16:

[●][●][●][●][●][●][●][●]
[●][●][●][●][●][●][●][●]

CPU remains saturated.

Result:
little additional throughput
and potentially worse latency
```

---

## I/O-bound Activity

Examples:

```text
HTTP request
database request
object-storage access
waiting on another service
network API call
```

Behavior:

- spends much of its elapsed execution time waiting
- occupies an Activity Slot while waiting
- consumes relatively little CPU during wait periods
- can often sustain substantially more concurrent Tasks than a CPU-bound workload
- increasing Activity Slots can improve throughput even when CPU utilization remains moderate

Example:

```text
CPU ███░░░░░░░ 30%

8 slots
[●][●][●][●][●][●][●][●]

Increase to 16 slots:

[●][●][●][●][●][●][●][●]
[●][●][●][●][●][●][●][●]

More operations may wait concurrently.

Result:
higher throughput
without equivalent CPU growth
```

---

## Mixed Activity workload

A future version may allow:

```text
40% CPU-bound
60% I/O-bound
```

For the first implementation, predefined profiles are preferable.

---

# 6. Worker conceptual model

A Worker contains several different forms of capacity.

```text
┌──────────────────── Worker ─────────────────────┐
│                                                │
│ WORKFLOW                     ACTIVITY           │
│                                                │
│ Pollers                      Pollers            │
│ ○ ○                          ○ ○ ○ ○            │
│                                                │
│ Workflow Slots               Activity Slots     │
│ [ ] [ ] [ ] [ ]             [ ][ ][ ][ ][ ]   │
│                                                │
│           Workflow Cache                       │
│           ◌ ◌ ◌ ◌ ◌ ◌                         │
│                                                │
│ CPU                          Memory             │
│ █████░░░░                   ██████░░░          │
│                                                │
└────────────────────────────────────────────────┘
```

The simulator must make clear that these are **not interchangeable forms of capacity**.

A Worker can simultaneously have:

- free slots but insufficient polling capacity
- adequate Pollers but all slots occupied
- many slots but insufficient CPU
- sufficient CPU but constrained memory
- sufficient execution resources but poor Workflow cache efficiency

---

# 7. Pollers

Pollers belong **inside the Worker boundary**.

There are separate pools for at least:

- Workflow Task Pollers
- Activity Task Pollers

Conceptually, a Poller:

1. waits for work from Temporal;
2. obtains an appropriate Task;
3. dispatches that Task into Worker execution capacity.

For the visual model, a Poller should behave like a **dispatcher or emitter**.

Example:

```text
Temporal Activity Queue

● ● ● ● ●

        ↓ Task acquired

┌──────── Worker ──────────┐
│                         │
│ Poller                  │
│   ○                     │
│    \                    │
│     \ ●                 │
│      \                  │
│       ▼                 │
│ [●] [●] [ ] [ ]        │
│          ▲              │
│          next slot      │
└─────────────────────────┘
```

The Poller can visually rotate or point toward the next available Slot and emit the Task into it.

This should make Pollers feel active without implying that Task traffic must travel through an external Worker port or pipe.

### Poller rule

Increasing Pollers changes the Worker's ability to **retrieve and dispatch work**.

Increasing Pollers does not directly increase execution concurrency.

### Visual rule

A Poller animation must manipulate the same Task dot that came from Temporal.

It must not generate decorative copies of that dot.

---

# 8. Task Slots

Slots represent **execution concurrency**.

There are separate pools for:

- Workflow Task Slots
- Activity Task Slots

A Task occupies one appropriate Slot while the Worker processes it.

Example:

```text
Workflow Slots

[●] [ ] [ ]


Activity Slots

[●] [●] [●] [ ] [ ]
```

Increasing Slot count allows more Tasks of that type to execute concurrently.

However:

> Slots represent permission/capacity for concurrency. They do not create CPU, memory, or network capacity.

Therefore:

```text
more Slots
≠
automatically more throughput
```

The simulator should make that one of its central discoveries.

---

# 9. Workflow cache / sticky execution

Workflow caching is a separate mechanism from Task Slots.

After a Workflow Task executes, the Workflow Execution may become blocked waiting for something such as:

```text
Activity result
Timer
Signal
Update
Child Workflow result
other event
```

The Workflow Task finishes and releases its Workflow Task Slot.

The Workflow Execution itself may remain cached in Worker memory.

Conceptually:

```text
Workflow Slot

[ W1 ]

Workflow Task executes...

        ↓

Workflow waits for Activity

        ↓

slot becomes free

[    ]


Workflow Cache

[ W1 ]
```

The important distinction is:

```text
Workflow Task Slot
= currently executing Workflow Task

Workflow Cache
= retained Workflow execution state between Tasks
```

---

# 10. Cache hit behavior

When an event causes the Workflow to need another Workflow Task:

```text
Activity completes
       ↓
new WFT scheduled
       ↓
Worker receives WFT
```

If the Workflow state is still cached:

```text
CACHE HIT

Workflow Cache
   [W1]
     │
     ▼

Workflow Slot
   [W1]

continue execution
```

This avoids reconstructing the Workflow from its entire relevant History.

---

# 11. Cache miss and replay

If the Workflow has been evicted:

```text
CACHE MISS
     ↓
retrieve/reconstruct from History
     ↓
replay Workflow
     ↓
rebuild Workflow state
     ↓
process current Workflow Task
```

For the simulator, replay should introduce:

- additional CPU work
- additional Workflow Task execution time
- increased resource consumption
- lower effective Workflow Task throughput

A larger cache therefore creates a tradeoff:

```text
larger Workflow cache
        ↓
higher memory consumption
        +
fewer cache misses
        ↓
less replay
        ↓
less CPU spent reconstructing Workflow state
```

---

# 12. Terminology: Workflow cache vs. sticky Task Queue

The simulator may use the user-facing label:

**Workflow Cache**

with an explanatory subtitle such as:

**Sticky execution / cached Workflows**

Do not imply that the Worker cache and the server-side sticky Task Queue are literally the same component.

They participate in the same optimization but are distinct concepts.

Detailed sticky Task Queue routing behavior is outside the initial simulation scope.

---

# 13. CPU model

CPU is a Worker-level physical resource.

CPU demand comes from:

- Workflow Task execution
- Workflow replay
- CPU-bound Activities
- CPU portions of I/O-bound Activities
- Worker/SDK/runtime overhead

CPU should not simply behave like another slot count.

If CPU demand exceeds available capacity:

```text
CPU demand > CPU capacity
        ↓
Tasks execute more slowly
        ↓
slots stay occupied longer
        ↓
throughput plateaus
        ↓
queues may grow
```

This creates a feedback loop the user can observe.

The simulator should therefore represent CPU pressure primarily by changing **processing speed**, not by arbitrarily refusing Tasks.

---

# 14. Memory model

Memory is another Worker-level physical resource.

Memory demand comes from:

- cached Workflow Executions
- active Tasks
- Activity state
- Workflow/runtime state
- Worker/SDK/runtime overhead

The initial conceptual model may be:

```text
memory used =
base Worker memory
+ Workflow cache memory
+ active Task memory
```

As memory pressure rises:

1. cache capacity becomes increasingly valuable but expensive;
2. cached Workflow entries may need to be evicted;
3. cache misses increase;
4. replay increases;
5. replay consumes more CPU.

This creates an important cross-resource relationship:

```text
low memory
   ↓
cache eviction
   ↓
more replay
   ↓
higher CPU demand
```

This interaction should eventually emerge from the simulation rather than be represented as a scripted scenario.

Actual operating-system OOM behavior and Worker crash recovery are outside v0.

---

# 15. Work units and visual grammar

A central design invariant:

> Every visible work dot represents a discrete logical unit of work.

Do not use visually similar decorative sparkles, glowing trails, or particle streams that could be mistaken for additional Tasks.

Glow is an appearance applied to the work object.

It is not itself another object.

---

## Workflow Execution

Visual suggestion:

```text
◎
```

Persistent.

Larger or visually distinct from Tasks.

Represents durable Workflow identity.

---

## Workflow Task

Visual suggestion:

```text
●
```

One color.

Short-lived.

Appears when Workflow logic must execute.

---

## Activity Task

Visual suggestion:

```text
●
```

A second color.

Exists from Activity scheduling through Activity processing/completion.

---

## Identity preservation

When a Task moves:

```text
Task Queue
   ●

     ↓

Poller
   ●

     ↓

Slot
  [●]
```

it must remain **the same visual object**.

No replacement dot should suddenly appear at the destination.

This makes motion meaningful and keeps the eventual animation implementation tractable.

---

# 16. Workflow-to-Task visual transformation

When a Workflow starts, the visualization may use a transformation such as:

```text
Workflow Start Request

        ●
        ↓

Workflow Execution

        ◎

        │
        └──── ● Workflow Task
```

When Workflow code schedules Activities:

```text
               ● Activity
             ↗
Workflow ◎ ──→ ● Activity
             ↘
               ● Activity
```

The Workflow Execution remains.

The newly created Activity dots travel into the appropriate Activity Task Queue.

This gives the desired visual effect of work **splitting apart to fill queues** while preserving the correct mental model.

---

# 17. Temporal boundary

Task Queues belong inside the **Temporal Service / Temporal Cloud boundary**.

Example:

```text
┌────────────── Temporal ──────────────┐
│                                     │
│ Workflow Task Queue                 │
│ ● ●                                 │
│                                     │
│ Activity Task Queue                 │
│ ● ● ● ● ●                          │
│                                     │
└─────────────────────────────────────┘
```

Workers remain outside that boundary.

Pollers remain inside Workers.

---

# 18. Initial workload controls

The first useful simulator should expose relatively few controls.

## Workload

- Workflow start rate
- Activities scheduled per Workflow
- Activity workload profile:
  - CPU-bound
  - I/O-bound

Later:

- mixed Activity workloads
- Activity duration
- burstiness
- Workflow complexity

---

# 19. Initial Worker controls

- Worker count
- Workflow Pollers per Worker
- Activity Pollers per Worker
- Workflow Slots per Worker
- Activity Slots per Worker
- CPU capacity per Worker
- memory capacity per Worker
- Workflow cache capacity

These controls should be able to change while the simulation is running.

That is an important implementation constraint.

No animation should depend on having a predetermined beginning and ending state.

---

# 20. Simulation controls

- pause
- play
- reset
- simulation speed

Potentially later:

- step one simulation tick
- deterministic seed
- scenario presets

---

# 21. Initial observable metrics

Only expose metrics that help explain the simulation.

## Temporal

- Workflow Task backlog
- Activity Task backlog
- Workflow Task schedule-to-start
- Activity Task schedule-to-start

## Worker

- Workflow Slots occupied / available
- Activity Slots occupied / available
- Workflow Poller count/state
- Activity Poller count/state
- CPU utilization
- memory utilization
- Workflow cache occupancy
- cache hit rate
- cache miss rate
- replay count/rate

## Overall

- Workflow start rate
- Workflow completion rate
- Activity completion rate

Graphs are not necessary for the earliest prototype.

The immediate visual state should explain most behavior.

---

# 22. Required demonstration scenarios

The crude simulator is successful if these conditions become visually obvious.

## A. Balanced

- queues remain small
- Pollers continually receive work
- Slots cycle smoothly
- CPU remains below saturation
- memory remains healthy
- throughput roughly keeps pace with incoming work

---

## B. Workflow Poller constrained

- Workflow Tasks accumulate
- Workflow Slots remain unnecessarily available
- CPU remains below saturation
- increasing Workflow Pollers reduces schedule-to-start and backlog

---

## C. Activity Poller constrained

- Activity Tasks accumulate
- Activity Slots remain unnecessarily available
- CPU may remain below saturation
- increasing Activity Pollers improves dispatch

---

## D. Workflow Slot constrained

- Workflow Tasks accumulate
- Workflow Slots remain fully occupied
- Pollers are not the limiting factor
- adding Workflow Slots initially improves throughput

---

## E. Activity Slot constrained

- Activity Tasks accumulate
- Activity Slots remain fully occupied
- CPU may or may not be saturated
- increasing Activity Slots helps until another resource becomes limiting

---

## F. CPU-bound Activity workload

- Activity Slots become occupied
- CPU approaches saturation
- adding Slots initially improves throughput
- eventually adding Slots stops helping
- increasing CPU improves throughput

The user should be able to discover:

> The bottleneck moved from concurrency to compute.

---

## G. I/O-bound Activity workload

- many Activity Slots remain occupied
- CPU stays relatively low
- Tasks spend significant time waiting
- increasing Activity Slots allows more concurrent outstanding operations
- throughput increases without proportional CPU growth

The user should discover:

> Low CPU does not necessarily mean excessive Activity concurrency.

---

## H. Workflow-cache constrained

- many Workflow Executions compete for limited cache capacity
- cached Workflows are evicted
- cache misses increase
- replay increases
- Workflow CPU demand rises
- Workflow Task processing slows

Increasing cache capacity:

- consumes more memory
- reduces replay
- reduces replay-related CPU demand

---

## I. Memory constrained

A large cache and/or high concurrency consumes available memory.

The simulator should demonstrate:

```text
increase cache
      ↓
initially beneficial
      ↓
memory pressure rises
      ↓
eventually another limit appears
```

The lesson is:

> More cache is not free capacity.

---

## J. Bottleneck migration

This is an especially important emergent scenario.

Example:

```text
Activity Slots = 4
CPU = 8 units

Slot constrained.
```

User increases:

```text
Activity Slots → 16
```

Now:

```text
CPU reaches 100%
```

The simulator should visibly show that the intervention worked but moved the bottleneck.

This may be the single most important conceptual behavior in the project.

---

# 23. Explicitly out of scope for v0

Do not attempt to model these initially:

- Nexus Tasks
- Local Activities
- Child Workflow visualization
- Signals as a separate visualization
- Updates as a separate visualization
- Queries
- Activity heartbeats
- Activity cancellation semantics
- Activity retries
- Workflow retries
- precise retry backoff
- Worker Versioning / Worker Deployments
- Build IDs
- Task Queue partitions
- detailed sticky Task Queue routing
- eager Activity execution
- eager Workflow start
- Temporal persistence internals
- Matching Service implementation details
- exact Temporal Cloud APS limits
- Cloud rate limiting
- Temporal Cloud autoscaling
- Kubernetes autoscaling
- network failure simulation
- Worker crashes/recovery
- garbage collection modeling
- exact language-SDK differences
- precise thread-pool behavior
- downstream service rate limiting
- exact production performance prediction

These should be added only when they support the teaching objective.

---

# 24. Modeling philosophy

The simulator should be:

**Mechanistically believable, pedagogically useful, and intentionally simplified.**

Its purpose is to demonstrate:

```text
change
  ↓
resource pressure
  ↓
bottleneck
  ↓
observable symptom
  ↓
tuning response
```

It should not imply:

```text
4 vCPUs + 200 Slots
=
exactly 3,742 Tasks/sec
```

All equations and constants should therefore be:

- simple
- inspectable
- documented
- tunable
- deterministic where practical

---

# 25. Dynamic-animation requirement

The final system will not play a fixed polished animation.

The visualization must continuously adapt to simulation state.

Therefore:

- all work objects must be generated dynamically;
- paths must support arbitrary runtime traffic;
- Queue density must grow and shrink dynamically;
- Pollers must select available Tasks dynamically;
- Slots must appear and disappear as settings change;
- Workers must support runtime scaling;
- CPU and memory state must respond continuously;
- no behavior should depend on prerecorded motion;
- no visual flourish should require a known future state.

This requirement should influence all visual-design decisions.

---

# 26. Visual-design philosophy

The crude prototype should initially resemble an explanatory mathematical animation more than a dashboard.

Preferred characteristics:

- dark neutral background
- simple geometry
- thin boundaries
- a small semantic color palette
- restrained typography
- dots as the dominant work representation
- smooth meaningful motion
- minimal decorative effects

Influence:

**3Blue1Brown-style explanatory clarity**, rather than literal imitation of its aesthetic.

The useful principles are:

- few simultaneous visual concepts;
- persistent spatial relationships;
- color always means something;
- motion always means something;
- transitions explain causality;
- labels supplement the visual model rather than replace it.

Space-like glow and richer visual effects should be layered on only after the underlying simulation reads clearly without them.

---

# 27. Non-negotiable semantic rules

1. A dot represents work.
2. Decorative elements must not look like work.
3. Workflow Executions and Tasks are different concepts.
4. A Workflow Execution persists while Tasks are generated over time.
5. Temporal owns Task Queues.
6. Workers own Pollers, Slots, cache, CPU, and memory.
7. Workflow and Activity Pollers are distinct.
8. Workflow and Activity Slots are distinct.
9. Pollers retrieve/dispatch work; Slots execute work.
10. CPU and memory are physical constraints, not extra Slot counts.
11. CPU-bound and I/O-bound are Activity workload characteristics, not replacements for Workflow/Activity Task type.
12. Workflow cache trades memory for reduced replay.
13. Cache misses introduce replay work.
14. The same Task visual object should persist as it moves between states.
15. Simulation behavior takes priority over visual spectacle.
16. Every visual element must support arbitrary runtime parameter changes.
17. More capacity in one dimension may simply expose the next bottleneck.

---

# 28. v0 success criteria

After several minutes interacting with the crude simulator, a user unfamiliar with Temporal Worker tuning should be able to explain:

1. A Workflow Execution is not the same thing as a Workflow Task.
2. Workflow Executions generate multiple Tasks over their lifetime.
3. Workflow and Activity Tasks have separate execution capacity.
4. Pollers retrieve work; Slots execute it.
5. More Pollers do not create more execution capacity.
6. More Slots do not create more CPU or memory.
7. CPU-bound and I/O-bound Activities react differently to additional concurrency.
8. CPU saturation limits the usefulness of additional Slots.
9. Workflow cache consumes memory but reduces replay.
10. Cache misses can increase CPU demand.
11. Increasing one resource can cause the bottleneck to move somewhere else.
12. Queue growth and schedule-to-start latency are symptoms whose underlying cause must be diagnosed.

If those concepts are obvious in the crude version, the simulator has achieved its first objective.

---

# 29. Scope boundary for the first implementation

The first implementation should deliberately support only enough behavior to demonstrate:

```text
Workflow start
    ↓
Workflow Task
    ↓
Workflow execution
    ↓
Activity creation
    ↓
Activity queue
    ↓
Activity polling
    ↓
Activity Slot execution
    ↓
Activity completion
    ↓
another Workflow Task
```

combined with:

```text
Poller limits
Slot limits
CPU limits
Memory limits
Workflow cache/replay
CPU-bound Activities
I/O-bound Activities
```

Anything beyond those concepts requires explicit justification before entering v0 scope.