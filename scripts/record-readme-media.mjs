// Records the README GIFs by driving the simulator in headless Chromium.
//
// Usage: npm run readme:media [-- <scene> ...]
// Requires ffmpeg and gifski on PATH (macOS: brew install ffmpeg gifski).

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = join(ROOT, 'docs', 'media')
const FPS = 15
const OUTPUT_WIDTH = 960

// A visible pointer, since headless screen captures do not include the OS cursor.
const CURSOR_SCRIPT = `
  window.addEventListener('DOMContentLoaded', () => {
    const cursor = document.createElement('div')
    cursor.id = 'readme-cursor'
    Object.assign(cursor.style, {
      position: 'fixed', left: '-40px', top: '-40px', width: '18px', height: '18px',
      marginLeft: '-9px', marginTop: '-9px', borderRadius: '50%', pointerEvents: 'none',
      zIndex: '2147483647', background: 'rgba(255, 255, 255, 0.35)',
      border: '2px solid rgba(255, 255, 255, 0.9)', transition: 'transform 120ms ease',
    })
    document.body.appendChild(cursor)
    window.addEventListener('mousemove', (event) => {
      cursor.style.left = event.clientX + 'px'
      cursor.style.top = event.clientY + 'px'
    }, true)
    window.addEventListener('mousedown', () => { cursor.style.transform = 'scale(0.7)' }, true)
    window.addEventListener('mouseup', () => { cursor.style.transform = 'scale(1)' }, true)
  })
`

const pause = (page, ms) => page.waitForTimeout(ms)

const hideCursor = (page) => page.evaluate(() => {
  document.getElementById('readme-cursor').style.display = 'none'
})

async function moveTo(page, locator, { steps = 20 } = {}) {
  const box = await locator.boundingBox()
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y, { steps })
  return { x, y, box }
}

async function clickOn(page, locator) {
  await moveTo(page, locator)
  await pause(page, 250)
  await locator.click()
}

async function choosePreset(page, presetId) {
  const select = page.getByLabel('Simulator preset')
  await moveTo(page, select)
  await pause(page, 400)
  await select.selectOption(presetId)
}

async function dragRange(page, label, value) {
  const input = page.locator('label.range-control', { hasText: label }).locator('input[type="range"]')
  const { min, max, current } = await input.evaluate((el) => ({
    min: Number(el.min), max: Number(el.max), current: Number(el.value),
  }))
  const box = await input.boundingBox()
  // Chromium range thumbs are 16px wide, so the usable track is inset by 8px each side.
  const xFor = (v) => box.x + 8 + ((v - min) / (max - min)) * (box.width - 16)
  const y = box.y + box.height / 2
  await page.mouse.move(xFor(current), y, { steps: 20 })
  await pause(page, 300)
  await page.mouse.down()
  await page.mouse.move(xFor(value), y, { steps: 30 })
  await pause(page, 200)
  await page.mouse.up()
}

const SCENES = {
  // The Task flow diagram under steady load, used as the README hero image.
  hero: {
    viewport: { width: 1280, height: 1010 },
    crop: '.simulation-panel',
    async setup(page) {
      await choosePreset(page, 'pollerConstrained')
      await page.getByRole('button', { name: '2x' }).click()
      await page.getByRole('button', { name: 'Start continuous' }).click()
      await pause(page, 6000)
      await hideCursor(page)
    },
    async record(page) {
      await pause(page, 9000)
    },
  },

  // Switching from the default preset to a constrained one mid-run.
  presets: {
    viewport: { width: 1280, height: 1010 },
    async setup(page) {
      await page.getByRole('button', { name: '4x' }).click()
      await page.mouse.move(640, 500)
    },
    async record(page) {
      await clickOn(page, page.getByRole('button', { name: 'Start continuous' }))
      await pause(page, 3500)
      await choosePreset(page, 'cpuConstrained')
      await pause(page, 10000)
    },
  },

  // Relieving an Activity Slot bottleneck with the Worker capacity sliders.
  tuning: {
    viewport: { width: 1280, height: 1300 },
    async setup(page) {
      await choosePreset(page, 'slotConstrained')
      await page.locator('.custom-settings > summary').click()
      await page.locator('.worker-capacity-section > summary').click()
      await page.getByRole('button', { name: '2x' }).click()
      await page.mouse.move(640, 300)
    },
    async record(page) {
      await clickOn(page, page.getByRole('button', { name: 'Start continuous' }))
      await pause(page, 7000)
      await dragRange(page, 'Activity Slots / Worker', 8)
      await pause(page, 7500)
    },
  },

  // Live Temporal metric charts reacting to a slot-constrained run.
  monitoring: {
    viewport: { width: 1280, height: 1230 },
    crop: '.monitoring-section:first-child',
    async setup(page) {
      await choosePreset(page, 'slotConstrained')
      await page.getByRole('button', { name: '4x' }).click()
      await page.locator('.monitoring-panel > summary').click()
      await page.locator('.monitoring-section:first-child').evaluate((el) => {
        window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY)
      })
      await page.getByRole('button', { name: 'Start continuous' }).evaluate((el) => el.click())
      await hideCursor(page)
    },
    async record(page) {
      await pause(page, 14000)
    },
  },
}

async function captureFrames(page, durationFn, frameDir) {
  const session = await page.context().newCDPSession(page)
  const frames = []
  session.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    frames.push({ data, timestamp: metadata.timestamp })
    session.send('Page.screencastFrameAck', { sessionId }).catch(() => {})
  })
  await session.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 })
  await durationFn()
  const endTimestamp = Date.now() / 1000
  await session.send('Page.stopScreencast')

  // The screencast only emits frames on change, so each frame is held until the next one.
  const lines = []
  frames.forEach((frame, index) => {
    const file = join(frameDir, `raw-${String(index).padStart(5, '0')}.png`)
    writeFileSync(file, Buffer.from(frame.data, 'base64'))
    const next = frames[index + 1]?.timestamp ?? endTimestamp
    lines.push(`file '${file}'`, `duration ${Math.max(next - frame.timestamp, 0.001).toFixed(4)}`)
  })
  lines.push(`file '${join(frameDir, `raw-${String(frames.length - 1).padStart(5, '0')}.png`)}'`)
  const concatFile = join(frameDir, 'frames.txt')
  writeFileSync(concatFile, lines.join('\n'))
  return concatFile
}

async function recordScene(browser, url, name, scene) {
  const context = await browser.newContext({ viewport: scene.viewport, deviceScaleFactor: 1, colorScheme: 'dark' })
  await context.addInitScript(CURSOR_SCRIPT)
  const page = await context.newPage()
  await page.goto(url)
  await page.getByLabel('Simulator preset').waitFor()
  await scene.setup(page)

  let crop = null
  if (scene.crop) {
    const box = await page.locator(scene.crop).boundingBox()
    crop = [box.width, box.height, box.x, box.y].map((value) => Math.round(value))
  }

  const workDir = mkdtempSync(join(tmpdir(), `readme-${name}-`))
  try {
    const concatFile = await captureFrames(page, () => scene.record(page), workDir)
    await context.close()

    const filters = [`fps=${FPS}`]
    if (crop) filters.push(`crop=${crop.join(':')}`)
    execFileSync('ffmpeg', [
      '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', concatFile,
      '-vf', filters.join(','), join(workDir, 'frame-%05d.png'),
    ])
    const output = join(OUT_DIR, `${name}.gif`)
    execFileSync('sh', ['-c', `gifski --quiet --fps ${FPS} --width ${OUTPUT_WIDTH} --quality 90 -o "${output}" "${workDir}"/frame-*.png`])
    console.log(`${name}.gif  ${(statSync(output).size / 1024 / 1024).toFixed(1)} MB`)
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }
}

const requested = process.argv.slice(2)
const names = requested.length ? requested : Object.keys(SCENES)
const unknown = names.filter((name) => !SCENES[name])
if (unknown.length) {
  console.error(`Unknown scene(s): ${unknown.join(', ')}. Choose from: ${Object.keys(SCENES).join(', ')}`)
  process.exit(1)
}

mkdirSync(OUT_DIR, { recursive: true })
const server = await createServer({ root: ROOT, logLevel: 'error', server: { port: 0 } })
await server.listen()
const url = server.resolvedUrls.local[0]
const browser = await chromium.launch()
try {
  for (const name of names) await recordScene(browser, url, name, SCENES[name])
} finally {
  await browser.close()
  await server.close()
}
