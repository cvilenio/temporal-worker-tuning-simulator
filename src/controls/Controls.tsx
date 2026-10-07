import { useEffect, useState } from 'react'
import { CPU_CAPACITY_OPTIONS, defaultConfig, type SimulationConfig } from '../simulation'

export type WorkflowRateUnit = 'second' | 'minute' | 'hour'
export type GenerationMode = 'triggered' | 'continuous'

interface ControlsProps {
  config: SimulationConfig
  playing: boolean
  speed: number
  onConfigChange: (changes: Partial<SimulationConfig>) => void
  onPlayingChange: (playing: boolean) => void
  onSpeedChange: (speed: number) => void
}

interface WorkflowGenerationControlsProps {
  config: SimulationConfig
  workflowRateValue: number
  workflowRateUnit: WorkflowRateUnit
  generationMode: GenerationMode
  workflowCount: number
  playing: boolean
  canResume: boolean
  onConfigChange: (changes: Partial<SimulationConfig>) => void
  onWorkflowRateValueChange: (value: number) => void
  onWorkflowRateUnitChange: (unit: WorkflowRateUnit) => void
  onGenerationModeChange: (mode: GenerationMode) => void
  onWorkflowCountChange: (count: number) => void
  onStart: () => void
  onPlayingChange: (playing: boolean) => void
  onReset: () => void
}

interface RangeControlProps {
  label: string
  value: number
  min: number
  max: number
  step?: number
  suffix?: string
  onChange: (value: number) => void
}

function RangeControl({ label, value, min, max, step = 1, suffix = '', onChange }: RangeControlProps) {
  const [draft, setDraft] = useState(value)

  useEffect(() => {
    setDraft(value)
  }, [value])

  const commit = (next = draft) => {
    if (next !== value) onChange(next)
  }

  return (
    <label className="range-control">
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={draft}
        onChange={(event) => setDraft(Number(event.target.value))}
        onPointerUp={(event) => commit(Number(event.currentTarget.value))}
        onPointerCancel={(event) => commit(Number(event.currentTarget.value))}
        onKeyUp={(event) => commit(Number(event.currentTarget.value))}
        onBlur={(event) => commit(Number(event.currentTarget.value))}
      />
      <output>{draft}{suffix}</output>
    </label>
  )
}

function DiscreteRangeControl({
  label,
  value,
  values,
  suffix = '',
  onChange,
}: {
  label: string
  value: number
  values: readonly number[]
  suffix?: string
  onChange: (value: number) => void
}) {
  const indexFor = (candidate: number) => values.reduce((nearestIndex, option, index) =>
    Math.abs(option - candidate) < Math.abs(values[nearestIndex] - candidate) ? index : nearestIndex,
  0)
  const valueIndex = indexFor(value)
  const [draftIndex, setDraftIndex] = useState(valueIndex)

  useEffect(() => {
    setDraftIndex(indexFor(value))
  }, [value, values])

  const commit = (index = draftIndex) => {
    const next = values[index]
    if (next !== value) onChange(next)
  }

  return (
    <label className="range-control">
      <span>{label}</span>
      <input
        type="range"
        min={0}
        max={values.length - 1}
        step={1}
        value={draftIndex}
        onChange={(event) => setDraftIndex(Number(event.target.value))}
        onPointerUp={(event) => commit(Number(event.currentTarget.value))}
        onPointerCancel={(event) => commit(Number(event.currentTarget.value))}
        onKeyUp={(event) => commit(Number(event.currentTarget.value))}
        onBlur={(event) => commit(Number(event.currentTarget.value))}
      />
      <output>{values[draftIndex]}{suffix}</output>
    </label>
  )
}

export function WorkflowGenerationControls({
  config,
  workflowRateValue,
  workflowRateUnit,
  generationMode,
  workflowCount,
  playing,
  canResume,
  onConfigChange,
  onWorkflowRateValueChange,
  onWorkflowRateUnitChange,
  onGenerationModeChange,
  onWorkflowCountChange,
  onStart,
  onPlayingChange,
  onReset,
}: WorkflowGenerationControlsProps) {
  const activityBatches = Math.ceil(config.activitiesPerWorkflow / config.activityFanout)
  const [rateDraft, setRateDraft] = useState(String(workflowRateValue))

  useEffect(() => {
    setRateDraft(String(workflowRateValue))
  }, [workflowRateValue])

  const commitRate = () => {
    const parsed = Number(rateDraft)
    const next = Number.isFinite(parsed) ? Math.max(0, parsed) : workflowRateValue
    setRateDraft(String(next))
    onWorkflowRateValueChange(next)
  }

  return (
    <section className="workflow-generation-controls" aria-label="Workflow generation">
      <div className="generation-mode" role="radiogroup" aria-label="Workflow generation mode">
        <label>
          <input type="radio" name="workload-mode" checked={generationMode === 'triggered'} onChange={() => onGenerationModeChange('triggered')} />
          Triggered
        </label>
        <label>
          <input type="radio" name="workload-mode" checked={generationMode === 'continuous'} onChange={() => onGenerationModeChange('continuous')} />
          Continuous
        </label>
      </div>

      {generationMode === 'triggered' ? (
        <div className="top-count-control">
          <label htmlFor="workflow-count">Workflows to start</label>
          <div className="count-stepper">
            <button type="button" aria-label="Decrease Workflow count" onClick={() => onWorkflowCountChange(Math.max(1, workflowCount - 1))}>-</button>
            <input
              id="workflow-count"
              aria-label="Workflow count"
              type="number"
              min="1"
              max="1000"
              step="1"
              value={workflowCount}
              onChange={(event) => {
                const value = Number(event.target.value)
                if (Number.isFinite(value)) onWorkflowCountChange(Math.max(1, Math.min(1000, Math.floor(value))))
              }}
            />
            <button type="button" aria-label="Increase Workflow count" onClick={() => onWorkflowCountChange(Math.min(1000, workflowCount + 1))}>+</button>
          </div>
        </div>
      ) : (
        <div className="top-rate-control">
          <label htmlFor="workflow-rate-value">Workflow starts</label>
          <input
            id="workflow-rate-value"
            type="number"
            min="0"
            step="1"
            value={rateDraft}
            onChange={(event) => setRateDraft(event.target.value)}
            onBlur={commitRate}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitRate()
            }}
          />
          <select
            aria-label="Workflow start rate unit"
            value={workflowRateUnit}
            onChange={(event) => onWorkflowRateUnitChange(event.target.value as WorkflowRateUnit)}
          >
            <option value="second">per second</option>
            <option value="minute">per minute</option>
            <option value="hour">per hour</option>
          </select>
        </div>
      )}

      <div className="generation-actions">
        <button type="button" className="start-workflow-button" onClick={onStart} disabled={generationMode === 'continuous' && playing}>
          {generationMode === 'triggered'
            ? `Start ${workflowCount} Workflow${workflowCount === 1 ? '' : 's'}`
            : 'Start continuous'}
        </button>
        <button
          type="button"
          onClick={() => onPlayingChange(!playing)}
          disabled={!playing && !canResume}
        >
          {playing ? 'Pause' : canResume ? 'Resume' : 'Pause'}
        </button>
        <button type="button" onClick={onReset}>Reset</button>
      </div>

      <details className="workflow-shape-controls">
        <summary>Workflow shape</summary>
        <p>Each Workflow Task schedules one Activity batch. Every Activity in that batch must finish before the next batch starts.</p>
        <div className="workflow-shape-grid">
          <RangeControl label="Activity batches / Workflow" value={activityBatches} min={1} max={10} onChange={(value) => onConfigChange({ activitiesPerWorkflow: value * config.activityFanout })} />
          <RangeControl label="Activities / batch" value={config.activityFanout} min={1} max={10} onChange={(value) => onConfigChange({ activitiesPerWorkflow: activityBatches * value, activityFanout: value })} />
        </div>
        <div className="workflow-shape-tally" aria-live="polite">
          <span><strong>{activityBatches + 1}</strong> Workflow Tasks / Workflow</span>
          <span><strong>{config.activitiesPerWorkflow}</strong> Activity Tasks / Workflow</span>
        </div>
      </details>
    </section>
  )
}

export function Controls({
  config,
  playing,
  speed,
  onConfigChange,
  onPlayingChange,
  onSpeedChange,
}: ControlsProps) {
  const cpuCapacity = config.cpuCapacity ?? defaultConfig.cpuCapacity
  const workflowTaskResourceProfile = config.workflowTaskResourceProfile ?? defaultConfig.workflowTaskResourceProfile
  const activityTaskResourceProfile = config.activityTaskResourceProfile ?? defaultConfig.activityTaskResourceProfile
  const taskResourceProfilesLocked = config.taskResourceProfilesLocked ?? defaultConfig.taskResourceProfilesLocked
  const workflowTaskDemand = workflowTaskResourceProfile === 'cpu'
    ? config.workflowTaskCpuDemand ?? defaultConfig.workflowTaskCpuDemand
    : config.workflowTaskIoDemand ?? defaultConfig.workflowTaskIoDemand
  const activityTaskDemand = activityTaskResourceProfile === 'cpu'
    ? config.activityTaskCpuDemand ?? defaultConfig.activityTaskCpuDemand
    : config.activityTaskIoDemand ?? defaultConfig.activityTaskIoDemand
  const updateWorkflowTaskDemand = (value: number) => onConfigChange(workflowTaskResourceProfile === 'cpu'
    ? { workflowTaskCpuDemand: value }
    : { workflowTaskIoDemand: value })
  const updateActivityTaskDemand = (value: number) => onConfigChange(activityTaskResourceProfile === 'cpu'
    ? { activityTaskCpuDemand: value }
    : { activityTaskIoDemand: value })
  const updateWorkflowTaskProfile = (profile: 'cpu' | 'io') => onConfigChange(taskResourceProfilesLocked
    ? { workflowTaskResourceProfile: profile, activityTaskResourceProfile: profile }
    : { workflowTaskResourceProfile: profile })
  const updateActivityTaskProfile = (profile: 'cpu' | 'io') => onConfigChange(taskResourceProfilesLocked
    ? { workflowTaskResourceProfile: profile, activityTaskResourceProfile: profile }
    : { activityTaskResourceProfile: profile })
  const updateProfileLock = (locked: boolean) => onConfigChange(locked
    ? {
        taskResourceProfilesLocked: true,
        activityTaskResourceProfile: workflowTaskResourceProfile,
      }
    : { taskResourceProfilesLocked: false })
  const [speedDraft, setSpeedDraft] = useState(String(speed))
  const [speedSliderDraft, setSpeedSliderDraft] = useState(Math.min(speed, 2))

  useEffect(() => {
    setSpeedDraft(String(speed))
    setSpeedSliderDraft(Math.min(speed, 2))
  }, [speed])

  const commitSpeed = () => {
    const parsed = Number(speedDraft)
    const next = Number.isFinite(parsed) ? Math.max(0.05, Math.min(8, parsed)) : speed
    setSpeedDraft(String(next))
    onSpeedChange(next)
  }

  const commitSpeedSlider = (next = speedSliderDraft) => {
    if (next !== speed) onSpeedChange(next)
  }

  return (
    <section className="controls" aria-label="Simulation controls">
      <div className="transport-controls">
        <button type="button" onClick={() => onPlayingChange(true)} disabled={playing}>Play</button>
        <div className="speed-control">
          <label htmlFor="simulation-speed">Time scale</label>
          <input
            id="simulation-speed"
            type="range"
            min="0.25"
            max="2"
            step="0.25"
            list="speed-presets"
            value={speedSliderDraft}
            onChange={(event) => setSpeedSliderDraft(Number(event.target.value))}
            onPointerUp={(event) => commitSpeedSlider(Number(event.currentTarget.value))}
            onPointerCancel={(event) => commitSpeedSlider(Number(event.currentTarget.value))}
            onKeyUp={(event) => commitSpeedSlider(Number(event.currentTarget.value))}
            onBlur={(event) => commitSpeedSlider(Number(event.currentTarget.value))}
          />
          <datalist id="speed-presets">
            {[0.25, 0.5, 1, 2].map((option) => <option key={option} value={option} />)}
          </datalist>
          <input
            className="speed-number"
            aria-label="Simulation speed value"
            type="number"
            min="0.05"
            max="8"
            step="0.05"
            value={speedDraft}
            onChange={(event) => setSpeedDraft(event.target.value)}
            onBlur={commitSpeed}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitSpeed()
            }}
          />
          <span>x</span>
          <button type="button" className={speed === 1 ? 'active' : ''} onClick={() => onSpeedChange(1)}>1x</button>
          <button type="button" className={speed === 4 ? 'active' : ''} onClick={() => onSpeedChange(4)}>4x</button>
          <button type="button" className={speed === 8 ? 'active' : ''} onClick={() => onSpeedChange(8)}>8x</button>
        </div>
      </div>
      <div className="control-grid">
        <fieldset>
          <legend>Worker</legend>
          <RangeControl label="Workflow Pollers / Worker" value={config.workflowPollers} min={0} max={10} onChange={(value) => onConfigChange({ workflowPollers: value })} />
          <RangeControl label="Workflow Slots / Worker" value={config.workflowSlots} min={0} max={16} onChange={(value) => onConfigChange({ workflowSlots: value })} />
          <RangeControl label="Activity Pollers / Worker" value={config.activityPollers} min={0} max={10} onChange={(value) => onConfigChange({ activityPollers: value })} />
          <RangeControl label="Activity Slots / Worker" value={config.activitySlots} min={0} max={32} onChange={(value) => onConfigChange({ activitySlots: value })} />
          <DiscreteRangeControl label="CPU / Worker" value={cpuCapacity} values={CPU_CAPACITY_OPTIONS} suffix=" CPU" onChange={(value) => onConfigChange({ cpuCapacity: value })} />
          <RangeControl label="Workflow Cache Capacity / Worker" value={config.workflowCacheCapacity} min={0} max={50} onChange={(value) => onConfigChange({ workflowCacheCapacity: value })} />
          <RangeControl label="Workflow Cache Memory / Entry" value={config.workflowCacheEntryMemoryMb} min={1} max={16} suffix=" MB" onChange={(value) => onConfigChange({ workflowCacheEntryMemoryMb: value })} />
          <RangeControl label="Memory / Worker" value={config.memoryCapacityMb} min={64} max={1024} step={16} suffix=" MB" onChange={(value) => onConfigChange({ memoryCapacityMb: value })} />
          <div className="task-resource-panel">
            <div className="task-resource-header">
              <span className="task-resource-title">Task resource profiles</span>
              <label className="profile-lock">
                <input type="checkbox" checked={taskResourceProfilesLocked} onChange={(event) => updateProfileLock(event.target.checked)} />
                Lock profile types
              </label>
            </div>
            <div className="task-profile-group">
              <span className="task-profile-name">Workflow Task</span>
              <div className="workload-mode" role="radiogroup" aria-label="Workflow Task resource profile">
                <label>
                  <input type="radio" name="workflow-task-resource-profile" checked={workflowTaskResourceProfile === 'cpu'} onChange={() => updateWorkflowTaskProfile('cpu')} />
                  CPU-bound
                </label>
                <label>
                  <input type="radio" name="workflow-task-resource-profile" checked={workflowTaskResourceProfile === 'io'} onChange={() => updateWorkflowTaskProfile('io')} />
                  I/O-bound
                </label>
              </div>
              <RangeControl label="Demand" value={workflowTaskDemand} min={0.01} max={1} step={0.01} suffix={workflowTaskResourceProfile === 'cpu' ? ' CPU' : ' throughput'} onChange={updateWorkflowTaskDemand} />
            </div>
            <div className="task-profile-group">
              <span className="task-profile-name">Activity Task</span>
              <div className="workload-mode" role="radiogroup" aria-label="Activity Task resource profile">
                <label>
                  <input type="radio" name="activity-task-resource-profile" checked={activityTaskResourceProfile === 'cpu'} onChange={() => updateActivityTaskProfile('cpu')} />
                  CPU-bound
                </label>
                <label>
                  <input type="radio" name="activity-task-resource-profile" checked={activityTaskResourceProfile === 'io'} onChange={() => updateActivityTaskProfile('io')} />
                  I/O-bound
                </label>
              </div>
              <RangeControl label="Demand" value={activityTaskDemand} min={0.01} max={1} step={0.01} suffix={activityTaskResourceProfile === 'cpu' ? ' CPU' : ' throughput'} onChange={updateActivityTaskDemand} />
            </div>
          </div>
        </fieldset>
      </div>
    </section>
  )
}
