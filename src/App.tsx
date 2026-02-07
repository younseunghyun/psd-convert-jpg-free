import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

type OutputFormat = 'png' | 'jpg'

type ParsedComposite = {
  fileName: string
  width: number
  height: number
  bitmap: ImageBitmap
  usedWorker: boolean
}

type WorkerResponse =
  | { type: 'parsed'; fileName: string; width: number; height: number; bitmap: ImageBitmap }
  | { type: 'error'; message: string }

function App() {
  const [isDragging, setIsDragging] = useState(false)
  const [isParsing, setIsParsing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [parsed, setParsed] = useState<ParsedComposite | null>(null)

  const [format, setFormat] = useState<OutputFormat>('png')
  const [jpgQuality, setJpgQuality] = useState(0.9)
  const [jpgBackground, setJpgBackground] = useState('#ffffff')
  const [scale, setScale] = useState(1)

  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const workerRef = useRef<Worker | null>(null)

  const canUseWorker = useMemo(() => {
    return typeof OffscreenCanvas !== 'undefined'
  }, [])

  useEffect(() => {
    if (!canUseWorker) return

    const worker = new Worker(new URL('./workers/psdComposite.worker.ts', import.meta.url), {
      type: 'module',
    })
    workerRef.current = worker

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const msg = event.data
      if (msg.type === 'error') {
        setIsParsing(false)
        setError(msg.message || 'Failed to parse PSD.')
        return
      }

      setIsParsing(false)
      setError(null)
      setParsed((prev) => {
        prev?.bitmap.close()
        return {
          fileName: msg.fileName,
          width: msg.width,
          height: msg.height,
          bitmap: msg.bitmap,
          usedWorker: true,
        }
      })
    }

    worker.onerror = () => {
      setIsParsing(false)
      setError('Worker failed. Try a different browser or disable extensions.')
    }

    return () => {
      worker.terminate()
      workerRef.current = null
    }
  }, [canUseWorker])

  useEffect(() => {
    const canvas = previewCanvasRef.current
    if (!canvas) return

    if (!parsed) {
      const ctx = canvas.getContext('2d')
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height)
      return
    }

    canvas.width = parsed.width
    canvas.height = parsed.height

    const ctx2d = canvas.getContext('2d')
    if (!ctx2d) return
    ctx2d.clearRect(0, 0, canvas.width, canvas.height)
    ctx2d.drawImage(parsed.bitmap, 0, 0)
  }, [parsed])

  async function parseInMainThread(file: File) {
    const { readPsd } = await import('ag-psd')
    const buffer = await file.arrayBuffer()
    const psd = readPsd(buffer, { skipLayerImageData: true, skipThumbnail: true })
    if (!psd.canvas) throw new Error('No composite image found in this PSD.')

    const bitmap = await createImageBitmap(psd.canvas as unknown as HTMLCanvasElement)
    setParsed((prev) => {
      prev?.bitmap.close()
      return { fileName: file.name, width: psd.width, height: psd.height, bitmap, usedWorker: false }
    })
  }

  async function handleFile(file: File) {
    setError(null)
    setIsParsing(true)

    try {
      if (!file.name.toLowerCase().endsWith('.psd')) {
        throw new Error('Please select a .psd file.')
      }

      const worker = workerRef.current
      if (worker) {
        const buffer = await file.arrayBuffer()
        worker.postMessage({ type: 'parse', fileName: file.name, buffer }, [buffer])
      } else {
        await parseInMainThread(file)
        setIsParsing(false)
      }
    } catch (e) {
      setIsParsing(false)
      setError(e instanceof Error ? e.message : 'Failed to parse PSD.')
    }
  }

  function onPickFile() {
    fileInputRef.current?.click()
  }

  async function onDownload() {
    if (!parsed) return

    const exportWidth = Math.max(1, Math.round(parsed.width * scale))
    const exportHeight = Math.max(1, Math.round(parsed.height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = exportWidth
    canvas.height = exportHeight
    const ctx = canvas.getContext('2d', { alpha: format === 'png' })
    if (!ctx) {
      setError('Canvas 2D context is unavailable in this browser.')
      return
    }

    if (format === 'jpg') {
      ctx.fillStyle = jpgBackground
      ctx.fillRect(0, 0, canvas.width, canvas.height)
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
    }

    ctx.imageSmoothingEnabled = scale !== 1
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(parsed.bitmap, 0, 0, exportWidth, exportHeight)

    const blob: Blob | null = await new Promise((resolve) => {
      if (format === 'png') {
        canvas.toBlob((b) => resolve(b), 'image/png')
      } else {
        canvas.toBlob((b) => resolve(b), 'image/jpeg', jpgQuality)
      }
    })

    if (!blob) {
      setError('Export failed (toBlob returned null).')
      return
    }

    const base = parsed.fileName.replace(/\.psd$/i, '')
    const name = `${base}-${exportWidth}x${exportHeight}.${format}`
    const url = URL.createObjectURL(blob)
    try {
      const a = document.createElement('a')
      a.href = url
      a.download = name
      a.click()
    } finally {
      URL.revokeObjectURL(url)
    }
  }

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <div className="mark" aria-hidden="true" />
          <div className="brandText">
            <div className="title">PSD Convert Free</div>
            <div className="subtitle">100% 브라우저에서만 동작. 업로드 없음.</div>
          </div>
        </div>
        <div className="meta">
          <span className="pill">Composite만 (빠름)</span>
          {!canUseWorker ? <span className="pill warn">Worker 미지원</span> : null}
          {parsed ? <span className="pill">{parsed.width}×{parsed.height}</span> : null}
        </div>
      </header>

      <main className="grid">
        <section
          className={`drop ${isDragging ? 'drag' : ''} ${parsed ? 'has' : ''}`}
          onDragEnter={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setIsDragging(true)
          }}
          onDragOver={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setIsDragging(true)
          }}
          onDragLeave={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setIsDragging(false)
          }}
          onDrop={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setIsDragging(false)
            const f = e.dataTransfer.files?.[0]
            if (f) void handleFile(f)
          }}
        >
          <input
            ref={fileInputRef}
            className="file"
            type="file"
            accept=".psd"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void handleFile(f)
              e.currentTarget.value = ''
            }}
          />

          {!parsed ? (
            <div className="dropInner">
              <div className="dropTitle">PSD 파일을 여기에 드롭</div>
              <div className="dropHint">또는</div>
              <button className="primary" onClick={onPickFile} disabled={isParsing}>
                파일 선택
              </button>
              <div className="dropFoot">
                {isParsing ? <span className="spinner" /> : null}
                <span className="small">
                  빠른 처리를 위해 PSD 내부 composite 이미지만 사용합니다.
                </span>
              </div>
            </div>
          ) : (
            <div className="previewWrap">
              <canvas ref={previewCanvasRef} className="preview" />
              <div className="previewBar">
                <div className="fileName" title={parsed.fileName}>
                  {parsed.fileName}
                </div>
                <div className="actions">
                  <button onClick={onPickFile} disabled={isParsing}>
                    다른 파일 열기
                  </button>
                  <button className="primary" onClick={() => void onDownload()} disabled={isParsing}>
                    {format.toUpperCase()}로 다운로드
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>

        <aside className="panel">
          <div className="panelTitle">내보내기</div>

          <div className="field">
            <label>포맷</label>
            <div className="seg">
              <button
                className={format === 'png' ? 'on' : ''}
                onClick={() => setFormat('png')}
                disabled={isParsing}
              >
                PNG
              </button>
              <button
                className={format === 'jpg' ? 'on' : ''}
                onClick={() => setFormat('jpg')}
                disabled={isParsing}
              >
                JPG
              </button>
            </div>
          </div>

          <div className="field">
            <label>배율</label>
            <div className="row">
              <input
                type="range"
                min={0.25}
                max={2}
                step={0.25}
                value={scale}
                onChange={(e) => setScale(Number(e.target.value))}
                disabled={isParsing}
              />
              <div className="mono">{scale.toFixed(2)}x</div>
            </div>
          </div>

          {format === 'jpg' ? (
            <>
              <div className="field">
                <label>품질</label>
                <div className="row">
                  <input
                    type="range"
                    min={0.1}
                    max={1}
                    step={0.05}
                    value={jpgQuality}
                    onChange={(e) => setJpgQuality(Number(e.target.value))}
                    disabled={isParsing}
                  />
                  <div className="mono">{jpgQuality.toFixed(2)}</div>
                </div>
              </div>
              <div className="field">
                <label>배경색</label>
                <div className="row">
                  <input
                    type="color"
                    value={jpgBackground}
                    onChange={(e) => setJpgBackground(e.target.value)}
                    disabled={isParsing}
                    aria-label="JPG background color"
                  />
                  <div className="mono">{jpgBackground.toUpperCase()}</div>
                </div>
              </div>
            </>
          ) : null}

          <div className="note">
            {parsed?.usedWorker ? (
              <span>파싱을 Web Worker에서 처리했습니다.</span>
            ) : (
              <span>파싱을 메인 스레드에서 처리했습니다(Worker 미지원).</span>
            )}
          </div>

          {error ? <div className="error">{error}</div> : null}
        </aside>
      </main>

      <footer className="foot">
        <div className="small">
          프라이버시: 파일은 기기 밖으로 나가지 않습니다(업로드 없음).
        </div>
      </footer>
    </div>
  )
}

export default App
