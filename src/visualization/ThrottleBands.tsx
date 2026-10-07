interface ThrottleSample {
  timestamp: number
  throttled: boolean
  replaying: boolean
}

interface ConditionWindow {
  start: number
  end: number
}

function conditionWindows(
  samples: ThrottleSample[],
  condition: 'throttled' | 'replaying',
): ConditionWindow[] {
  const windows: ConditionWindow[] = []
  let activeStart: number | undefined
  let activeEnd = 0

  for (let index = 1; index < samples.length; index += 1) {
    const sample = samples[index]
    if (sample[condition]) {
      activeStart ??= samples[index - 1].timestamp
      activeEnd = sample.timestamp
    } else if (activeStart !== undefined) {
      windows.push({ start: activeStart, end: activeEnd })
      activeStart = undefined
    }
  }
  if (activeStart !== undefined) windows.push({ start: activeStart, end: activeEnd })
  return windows
}

export function ThrottleBands({
  samples,
  maxTime,
  left,
  top,
  plotWidth,
  plotHeight,
}: {
  samples: ThrottleSample[]
  maxTime: number
  left: number
  top: number
  plotWidth: number
  plotHeight: number
}) {
  return (
    <g className="chart-throttle-bands" aria-label="Resource throttling windows">
      {conditionWindows(samples, 'throttled').map((window) => {
        const x = left + (window.start / maxTime) * plotWidth
        const width = ((window.end - window.start) / maxTime) * plotWidth
        return (
          <rect
            key={`${window.start}-${window.end}`}
            x={x}
            y={top}
            width={width}
            height={plotHeight}
            className="chart-throttle-band"
            data-throttle-start={window.start}
            data-throttle-end={window.end}
          >
            <title>CPU or I/O throttling active</title>
          </rect>
        )
      })}
    </g>
  )
}

export function ReplayBands({
  samples,
  maxTime,
  left,
  top,
  plotWidth,
  plotHeight,
}: {
  samples: ThrottleSample[]
  maxTime: number
  left: number
  top: number
  plotWidth: number
  plotHeight: number
}) {
  return (
    <g className="chart-replay-bands" aria-label="Workflow replay windows">
      {conditionWindows(samples, 'replaying').map((window) => {
        const x = left + (window.start / maxTime) * plotWidth
        const width = ((window.end - window.start) / maxTime) * plotWidth
        return (
          <rect
            key={`${window.start}-${window.end}`}
            x={x}
            y={top}
            width={width}
            height={plotHeight}
            className="chart-replay-band"
            data-replay-start={window.start}
            data-replay-end={window.end}
          >
            <title>Workflow replay active</title>
          </rect>
        )
      })}
    </g>
  )
}

export function ThrottleLegend() {
  return (
    <span className="chart-throttle-key">
      <i />Resource throttling
    </span>
  )
}

export function ReplayLegend() {
  return (
    <span className="chart-replay-key">
      <i />Workflow replay
    </span>
  )
}
