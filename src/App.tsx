// @refresh reset
import { useEffect, useRef, useState } from 'react'
import { Controls, type GenerationMode, type WorkflowRateUnit } from './controls/Controls'
import { Simulation, TICK_SECONDS, defaultConfig, type SimulationConfig, type SimulationSnapshot } from './simulation'
import { SimulationScene } from './visualization/SimulationScene'
import { SlotResidenceChart } from './visualization/SlotResidenceChart'
import { TaskThroughputChart } from './visualization/TaskThroughputChart'
import { WorkflowCompletionChart } from './visualization/WorkflowCompletionChart'
import { useVisualTimeline } from './visualization/useVisualTimeline'
import './styles.css'

function diagnostics(snapshot: SimulationSnapshot) {
  return {
    simulatedTime: snapshot.simulatedTime,
    queues: {
      workflow: snapshot.workflowQueue.length,
      activity: snapshot.activityQueue.length,
    },
    worker: {
      workflowPollers: snapshot.workflowPollers,
      activityPollers: snapshot.activityPollers,
      workflowSlots: snapshot.workflowSlots,
      activitySlots: snapshot.activitySlots,
      cpuUtilization: snapshot.cpuUtilization,
      cpuDemand: snapshot.cpuDemand,
      cpuThrottled: snapshot.cpuThrottled,
      memoryUtilization: snapshot.memoryUtilization,
      ioUtilization: snapshot.ioUtilization,
      ioDemand: snapshot.ioDemand,
      ioThrottled: snapshot.ioThrottled,
    },
    metrics: snapshot.metrics,
    tasks: snapshot.tasks,
    recentEvents: snapshot.recentEvents.slice(-12),
  }
}

export default function App() {
  const simulationRef = useRef(new Simulation({ ...defaultConfig, workflowStartRate: 0 }, 1))
  const [snapshot, setSnapshot] = useState(() => simulationRef.current.getSnapshot())
  const [config, setConfig] = useState<SimulationConfig>({ ...defaultConfig, workflowStartRate: 0 })
  const [playing, setPlaying] = useState(true)
  const [timeScale, setTimeScale] = useState(1)
  const [visualTimeMs, setVisualTimeMs] = useState(0)
  const [presentationTimeMs, setPresentationTimeMs] = useState(0)
  const [generationMode, setGenerationMode] = useState<GenerationMode>('triggered')
  const [workflowCount, setWorkflowCount] = useState(1)
  const [workflowRateValue, setWorkflowRateValue] = useState(6)
  const [workflowRateUnit, setWorkflowRateUnit] = useState<WorkflowRateUnit>('minute')
  const playingRef = useRef(playing)
  const timeScaleRef = useRef(timeScale)
  const visualTimeRef = useRef(visualTimeMs)
  const presentationTimeRef = useRef(presentationTimeMs)
  const timeline = useVisualTimeline(snapshot, visualTimeMs, presentationTimeMs)

  useEffect(() => { playingRef.current = playing }, [playing])
  useEffect(() => { timeScaleRef.current = timeScale }, [timeScale])

  useEffect(() => {
    let frame = 0
    let previous = performance.now()
    let accumulator = 0
    const animate = (now: number) => {
      const elapsed = Math.min((now - previous) / 1000, 0.25)
      previous = now
      if (playingRef.current) {
        accumulator += elapsed * timeScaleRef.current
        visualTimeRef.current += elapsed * 1_000 * timeScaleRef.current
        presentationTimeRef.current += elapsed * 1_000
        while (accumulator >= TICK_SECONDS) {
          simulationRef.current.step(TICK_SECONDS)
          accumulator -= TICK_SECONDS
        }
      }
      setSnapshot(simulationRef.current.getSnapshot())
      setVisualTimeMs(visualTimeRef.current)
      setPresentationTimeMs(presentationTimeRef.current)
      frame = requestAnimationFrame(animate)
    }
    frame = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(frame)
  }, [])

  const updateConfig = (changes: Partial<SimulationConfig>) => {
    const next = { ...config, ...changes }
    setConfig(next)
    simulationRef.current.updateConfig(changes)
    setSnapshot(simulationRef.current.getSnapshot())
  }

  const rateFactor = (unit: WorkflowRateUnit) => unit === 'second' ? 1 : unit === 'minute' ? 60 : 3600

  const updateWorkflowRateValue = (value: number) => {
    setWorkflowRateValue(value)
    if (generationMode === 'continuous') {
      updateConfig({ workflowStartRate: value / rateFactor(workflowRateUnit) })
    }
  }

  const updateWorkflowRateUnit = (unit: WorkflowRateUnit) => {
    const currentRate = workflowRateValue / rateFactor(workflowRateUnit)
    const converted = currentRate * rateFactor(unit)
    setWorkflowRateValue(Number(converted.toFixed(2)))
    setWorkflowRateUnit(unit)
  }

  const updateGenerationMode = (mode: GenerationMode) => {
    setGenerationMode(mode)
    updateConfig({
      workflowStartRate: mode === 'triggered'
        ? 0
        : workflowRateValue / rateFactor(workflowRateUnit),
    })
  }

  const updateTimeScale = (next: number) => {
    timeScaleRef.current = next
    setTimeScale(next)
  }

  const startWorkflows = () => {
    simulationRef.current.startWorkflows(workflowCount)
    setSnapshot(simulationRef.current.getSnapshot())
  }

  const reset = () => {
    simulationRef.current.reset()
    visualTimeRef.current = 0
    presentationTimeRef.current = 0
    setVisualTimeMs(0)
    setPresentationTimeMs(0)
    setSnapshot(simulationRef.current.getSnapshot())
  }

  return (
    <main>
      <header>
        <div>
          <h1>Temporal Worker Scaling Simulator</h1>
          <p>Watch Temporal schedule Tasks and Workers return completion signals.</p>
        </div>
        <div className="clock">Sim time <strong>{snapshot.simulatedTime.toFixed(1)}s</strong></div>
      </header>

      <section className="metrics" aria-label="Current metrics">
        <span>Workflow queue <strong>{snapshot.workflowQueue.length}</strong></span>
        <span>Activity queue <strong>{snapshot.activityQueue.length}</strong></span>
        <span>W Slots <strong>{snapshot.workflowSlots.filter((slot) => slot.taskId).length}/{snapshot.workflowSlots.length}</strong></span>
        <span>A Slots <strong>{snapshot.activitySlots.filter((slot) => slot.taskId).length}/{snapshot.activitySlots.length}</strong></span>
        <span>CPU <strong>{Math.round(snapshot.cpuUtilization * 100)}% ({snapshot.cpuDemand.toFixed(2)}/{snapshot.config.cpuCapacity})</strong></span>
        <span>Slot residence <strong>{snapshot.metrics.slotResidenceSeconds.toFixed(2)}s</strong></span>
        <span>Activity throughput <strong>{snapshot.metrics.activityThroughput.toFixed(1)}/s</strong></span>
        <span>Workflow completions <strong>{snapshot.metrics.workflowCompletions.toFixed(1)}/s</strong></span>
      </section>

      <SimulationScene
        snapshot={snapshot}
        nowMs={visualTimeMs}
        presentationNowMs={presentationTimeMs}
        timeline={timeline}
      />
      <TaskThroughputChart
        simulatedTime={snapshot.simulatedTime}
        currentTotal={snapshot.metrics.totalTaskThroughput}
        samples={snapshot.taskThroughputHistory}
      />
      <SlotResidenceChart
        simulatedTime={snapshot.simulatedTime}
        currentValue={snapshot.metrics.slotResidenceSeconds}
        samples={snapshot.slotResidenceHistory}
      />
      <WorkflowCompletionChart
        simulatedTime={snapshot.simulatedTime}
        currentValue={snapshot.metrics.workflowCompletions}
        samples={snapshot.workflowCompletionHistory}
      />
      <Controls
        config={config}
        workflowRateValue={workflowRateValue}
        workflowRateUnit={workflowRateUnit}
        generationMode={generationMode}
        workflowCount={workflowCount}
        playing={playing}
        speed={timeScale}
        onConfigChange={updateConfig}
        onWorkflowRateValueChange={updateWorkflowRateValue}
        onWorkflowRateUnitChange={updateWorkflowRateUnit}
        onGenerationModeChange={updateGenerationMode}
        onWorkflowCountChange={setWorkflowCount}
        onStartWorkflows={startWorkflows}
        onPlayingChange={setPlaying}
        onReset={reset}
        onSpeedChange={updateTimeScale}
      />

      <details className="diagnostics">
        <summary>Diagnostics</summary>
        <pre>{JSON.stringify(diagnostics(snapshot), null, 2)}</pre>
      </details>
    </main>
  )
}
