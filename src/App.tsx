// @refresh reset
import { useEffect, useRef, useState } from 'react'
import { advanceAutoPause, armAutoPause, idleAutoPauseState } from './autoPause'
import { Controls, WorkflowGenerationControls, type GenerationMode, type WorkflowRateUnit } from './controls/Controls'
import { Simulation, TICK_SECONDS, defaultConfig, type SimulationConfig, type SimulationSnapshot } from './simulation'
import { SimulationScene } from './visualization/SimulationScene'
import { SlotResidenceChart } from './visualization/SlotResidenceChart'
import { TaskThroughputChart } from './visualization/TaskThroughputChart'
import { WorkflowCompletionChart } from './visualization/WorkflowCompletionChart'
import { useVisualTimeline } from './visualization/useVisualTimeline'
import '@fontsource/inter/300.css'
import './styles.css'

function diagnostics(snapshot: SimulationSnapshot) {
  return {
    simulatedTime: snapshot.simulatedTime,
    queues: {
      workflow: snapshot.workflowQueue.length,
      activity: snapshot.activityQueue.length,
    },
    workers: snapshot.workers,
    aggregateWorkerResources: {
      workflowPollers: snapshot.workflowPollers,
      activityPollers: snapshot.activityPollers,
      workflowSlots: snapshot.workflowSlots,
      activitySlots: snapshot.activitySlots,
      cpuUtilization: snapshot.cpuUtilization,
      cpuDemand: snapshot.cpuDemand,
      cpuThrottled: snapshot.cpuThrottled,
      memoryUtilization: snapshot.memoryUtilization,
      memoryUsedMb: snapshot.memoryUsedMb,
      memoryCapacityMb: snapshot.config.memoryCapacityMb * snapshot.workers.length,
      ioUtilization: snapshot.ioUtilization,
      ioDemand: snapshot.ioDemand,
      ioThrottled: snapshot.ioThrottled,
      workflowCache: {
        entries: snapshot.workflowCache,
        ...snapshot.cacheMetrics,
      },
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
  const [playing, setPlaying] = useState(false)
  const [manuallyPaused, setManuallyPaused] = useState(false)
  const [timeScale, setTimeScale] = useState(1)
  const [visualTimeMs, setVisualTimeMs] = useState(0)
  const [presentationTimeMs, setPresentationTimeMs] = useState(0)
  const [generationMode, setGenerationMode] = useState<GenerationMode>('triggered')
  const [workflowCount, setWorkflowCount] = useState(1)
  const [workflowRateValue, setWorkflowRateValue] = useState(6)
  const [workflowRateUnit, setWorkflowRateUnit] = useState<WorkflowRateUnit>('minute')
  const [autoPauseTimes, setAutoPauseTimes] = useState<number[]>([])
  const playingRef = useRef(playing)
  const timeScaleRef = useRef(timeScale)
  const visualTimeRef = useRef(visualTimeMs)
  const presentationTimeRef = useRef(presentationTimeMs)
  const autoPauseRef = useRef(idleAutoPauseState())
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
          const autoPause = advanceAutoPause(autoPauseRef.current, simulationRef.current.getSnapshot())
          autoPauseRef.current = autoPause.state
          if (autoPause.shouldPause) {
            const pausedAt = simulationRef.current.getSnapshot().simulatedTime
            setAutoPauseTimes((current) => current.at(-1) === pausedAt ? current : [...current, pausedAt])
            playingRef.current = false
            setPlaying(false)
            setManuallyPaused(false)
            accumulator = 0
            break
          }
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
    if (mode === 'continuous') autoPauseRef.current = idleAutoPauseState()
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

  const startGeneration = () => {
    if (generationMode === 'triggered') {
      simulationRef.current.startWorkflows(workflowCount)
      autoPauseRef.current = armAutoPause()
    } else {
      autoPauseRef.current = idleAutoPauseState()
    }
    playingRef.current = true
    setPlaying(true)
    setManuallyPaused(false)
    setSnapshot(simulationRef.current.getSnapshot())
  }

  const updatePlaying = (next: boolean) => {
    playingRef.current = next
    setPlaying(next)
    setManuallyPaused(!next)
  }

  const reset = () => {
    simulationRef.current.reset()
    autoPauseRef.current = idleAutoPauseState()
    playingRef.current = false
    setPlaying(false)
    setManuallyPaused(false)
    visualTimeRef.current = 0
    presentationTimeRef.current = 0
    setVisualTimeMs(0)
    setPresentationTimeMs(0)
    setAutoPauseTimes([])
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

      <WorkflowGenerationControls
        config={config}
        workflowRateValue={workflowRateValue}
        workflowRateUnit={workflowRateUnit}
        generationMode={generationMode}
        workflowCount={workflowCount}
        playing={playing}
        canResume={manuallyPaused}
        onConfigChange={updateConfig}
        onWorkflowRateValueChange={updateWorkflowRateValue}
        onWorkflowRateUnitChange={updateWorkflowRateUnit}
        onGenerationModeChange={updateGenerationMode}
        onWorkflowCountChange={setWorkflowCount}
        onStart={startGeneration}
        onPlayingChange={updatePlaying}
        onReset={reset}
      />

      <section className="simulation-panel" aria-labelledby="simulation-panel-title">
        <h2 id="simulation-panel-title">Temporal Task Flow</h2>
        <SimulationScene
          snapshot={snapshot}
          nowMs={visualTimeMs}
          presentationNowMs={presentationTimeMs}
          timeline={timeline}
        />
      </section>
      <TaskThroughputChart
        simulatedTime={snapshot.simulatedTime}
        currentTotal={snapshot.metrics.totalTaskThroughput}
        samples={snapshot.taskThroughputHistory}
        autoPauseTimes={autoPauseTimes}
      />
      <SlotResidenceChart
        simulatedTime={snapshot.simulatedTime}
        currentValue={snapshot.metrics.slotResidenceSeconds}
        samples={snapshot.slotResidenceHistory}
        autoPauseTimes={autoPauseTimes}
      />
      <WorkflowCompletionChart
        simulatedTime={snapshot.simulatedTime}
        currentValue={snapshot.metrics.workflowCompletions}
        samples={snapshot.workflowCompletionHistory}
        autoPauseTimes={autoPauseTimes}
      />
      <Controls
        config={config}
        playing={playing}
        speed={timeScale}
        onConfigChange={updateConfig}
        onPlayingChange={updatePlaying}
        onSpeedChange={updateTimeScale}
      />

      <details className="diagnostics">
        <summary>Diagnostics</summary>
        <pre>{JSON.stringify(diagnostics(snapshot), null, 2)}</pre>
      </details>
    </main>
  )
}
