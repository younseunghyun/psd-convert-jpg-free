/// <reference lib="webworker" />

import { initializeCanvas, readPsd } from 'ag-psd'

type ParseRequest = { type: 'parse'; fileName: string; buffer: ArrayBuffer }

// ag-psd needs a canvas factory to decode composite image data in a Worker.
if (typeof OffscreenCanvas !== 'undefined') {
  // ag-psd typing is DOM-canvas-oriented, but it supports OffscreenCanvas in Workers.
  initializeCanvas(
    ((width: number, height: number) => new OffscreenCanvas(width, height)) as unknown as (
      width: number,
      height: number,
    ) => HTMLCanvasElement,
  )
}

self.onmessage = (event: MessageEvent<ParseRequest>) => {
  const msg = event.data
  if (!msg || msg.type !== 'parse') return

  try {
    if (typeof OffscreenCanvas === 'undefined') {
      self.postMessage({ type: 'error', message: 'OffscreenCanvas is not supported in this browser.' })
      return
    }

    const psd = readPsd(msg.buffer, { skipLayerImageData: true, skipThumbnail: true })

    const canvas = psd.canvas as unknown as OffscreenCanvas | undefined
    if (!canvas || typeof (canvas as OffscreenCanvas).transferToImageBitmap !== 'function') {
      self.postMessage({
        type: 'error',
        message: 'No composite image found in this PSD (or unsupported PSD features).',
      })
      return
    }

    const bitmap = canvas.transferToImageBitmap()
    // Can’t post canvases back from Workers.
    delete (psd as unknown as { canvas?: unknown }).canvas

    self.postMessage(
      { type: 'parsed', fileName: msg.fileName, width: psd.width, height: psd.height, bitmap },
      // Mark bitmap as transferable to avoid copies.
      [bitmap],
    )
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to parse PSD.'
    self.postMessage({ type: 'error', message })
  }
}
