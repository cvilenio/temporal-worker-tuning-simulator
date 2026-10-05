import type { MetricSample } from '../simulation'
import { ThrottleBands, ThrottleLegend } from './ThrottleBands'

const WIDTH = 1200
const HEIGHT = 180
const LEFT = 62
const RIGHT = 20
const TOP = 18
const BOTTOM = 34
const PLOT_WIDTH = WIDTH - LEFT - RIGHT
const PLOT_HEIGHT = HEIGHT - TOP - BOTTOM

function linePath(samples: MetricSample[], maxTime: number, maxValue: number): string {
  return samples.map((sample, index) => {
    const x = LEFT + (sample.timestamp / maxTime) * PLOT_WIDTH
    const y = TOP + PLOT_HEIGHT - (sample.value / maxValue) * PLOT_HEIGHT
    return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`
  }).join(' ')
}

export function SlotResidenceChart({
  simulatedTime,
  currentValue,
  samples,
}: {
  simulatedTime: number
  currentValue: number
  samples: MetricSample[]
}) {
  const maxTime = Math.max(simulatedTime, 0.25)
  const observedMax = Math.max(0, ...samples.map((sample) => sample.value))
  const maxValue = Math.max(1, observedMax * 1.1)
  const path = linePath(samples, maxTime, maxValue)
  const midpoint = maxTime / 2

  return (
    <section className="chart-panel" aria-labelledby="slot-residence-chart-title">
      <div className="chart-header">
        <div>
          <h2 id="slot-residence-chart-title">Slot residence time</h2>
          <p>Rolling 5-second average across completed Tasks</p>
        </div>
        <div className="chart-status">
          <strong>{currentValue.toFixed(2)}s</strong>
          <ThrottleLegend />
        </div>
      </div>
      <svg
        className="slot-residence-chart"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={`Slot residence time from 0 to ${simulatedTime.toFixed(1)} simulated seconds`}
        data-time-max={simulatedTime}
        data-sample-count={samples.length}
      >
        <ThrottleBands samples={samples} maxTime={maxTime} left={LEFT} top={TOP} plotWidth={PLOT_WIDTH} plotHeight={PLOT_HEIGHT} />
        {[0, 0.5, 1].map((fraction) => {
          const y = TOP + PLOT_HEIGHT - fraction * PLOT_HEIGHT
          return <line key={fraction} x1={LEFT} y1={y} x2={WIDTH - RIGHT} y2={y} className="chart-grid-line" />
        })}
        <line x1={LEFT} y1={TOP} x2={LEFT} y2={TOP + PLOT_HEIGHT} className="chart-axis" />
        <line x1={LEFT} y1={TOP + PLOT_HEIGHT} x2={WIDTH - RIGHT} y2={TOP + PLOT_HEIGHT} className="chart-axis" />
        <path d={path} className="chart-line" data-series="slot-residence" />
        <text x={LEFT - 10} y={TOP + 4} textAnchor="end" className="chart-label">{maxValue.toFixed(2)}s</text>
        <text x={LEFT - 10} y={TOP + PLOT_HEIGHT + 4} textAnchor="end" className="chart-label">0s</text>
        <text x={LEFT} y={HEIGHT - 9} textAnchor="middle" className="chart-label">0s</text>
        <text x={LEFT + PLOT_WIDTH / 2} y={HEIGHT - 9} textAnchor="middle" className="chart-label">{midpoint.toFixed(1)}s</text>
        <text x={WIDTH - RIGHT} y={HEIGHT - 9} textAnchor="end" className="chart-label">{simulatedTime.toFixed(1)}s</text>
      </svg>
    </section>
  )
}
