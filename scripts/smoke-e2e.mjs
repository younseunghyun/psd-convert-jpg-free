import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import https from 'node:https'
import { setTimeout as delay } from 'node:timers/promises'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'

const root = process.cwd()
const port = 5173
const url = `http://127.0.0.1:${port}/`

function startDevServer() {
  const child = spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, BROWSER: 'none' },
  })

  let ready = false
  const out = []

  function onData(chunk) {
    const s = chunk.toString('utf8')
    out.push(s)
    if (out.length > 200) out.shift()
    if (s.includes('ready in') || s.includes('Local:')) ready = true
  }

  child.stdout.on('data', onData)
  child.stderr.on('data', onData)

  return {
    child,
    async waitReady(timeoutMs = 20_000) {
      const started = Date.now()
      while (!ready) {
        if (Date.now() - started > timeoutMs) {
          throw new Error(`Dev server did not become ready in ${timeoutMs}ms.\n\nLast output:\n${out.join('')}`)
        }
        await delay(100)
      }
    },
    getOutput() {
      return out.join('')
    },
  }
}

async function downloadFile(url, outPath) {
  await fs.mkdir(path.dirname(outPath), { recursive: true })

  const data = await new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume()
          downloadFile(res.headers.location, outPath).then(resolve, reject)
          return
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Failed to download ${url}: HTTP ${res.statusCode}`))
          res.resume()
          return
        }
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => resolve(Buffer.concat(chunks)))
      })
      .on('error', reject)
  })

  await fs.writeFile(outPath, data)
}

async function ensureSamplePsd() {
  const sample = path.join(root, 'testdata', 'sample.psd')
  try {
    await fs.stat(sample)
    return sample
  } catch {
    // Download a known-small PSD with composite data from ag-psd's test fixtures.
    const url =
      'https://raw.githubusercontent.com/Agamnentzar/ag-psd/master/test/read/alpha-composite/src.psd'
    await downloadFile(url, sample)
    return sample
  }
}

async function main() {
  const server = startDevServer()
  try {
    await server.waitReady()

    const browser = await chromium.launch()
    const context = await browser.newContext({
      acceptDownloads: true,
    })
    const page = await context.newPage()

    await page.goto(url, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('text=PSD 파일을 여기에 드롭', { timeout: 10_000 })

    const sample = await ensureSamplePsd()
    await page.setInputFiles('input[type="file"]', sample)

    await page.waitForSelector('canvas.preview', { timeout: 20_000 })

    const size = await page.$eval('canvas.preview', (c) => ({ w: c.width, h: c.height }))
    if (size.w !== 100 || size.h !== 100) {
      throw new Error(`Unexpected preview canvas size: ${size.w}x${size.h} (expected 100x100)`)
    }

    // Smoke export: click download and ensure a download is triggered.
    const downloadPromise = page.waitForEvent('download', { timeout: 10_000 })
    await page.click('button:has-text("PNG로 다운로드")')
    const download = await downloadPromise
    const suggested = download.suggestedFilename()
    if (!suggested.toLowerCase().endsWith('.png')) {
      throw new Error(`Unexpected download filename: ${suggested}`)
    }

    await context.close()
    await browser.close()

    process.stdout.write(`OK: parsed composite, preview ${size.w}x${size.h}, downloaded ${suggested}\n`)
  } finally {
    // Best-effort shutdown.
    server.child.kill('SIGTERM')
  }
}

main().catch((err) => {
  process.stderr.write(String(err?.stack || err) + '\n')
  process.exit(1)
})
