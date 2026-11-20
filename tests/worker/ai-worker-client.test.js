import { describe, expect, it } from 'vitest'
import { AIWorkerClient } from '../../src/worker/AIWorkerClient.js'

class FakeWorker {
  constructor() {
    this.listeners = new Map()
    this.posted = []
    this.terminated = false
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, [])
    this.listeners.get(type).push(listener)
  }

  postMessage(message) {
    this.posted.push(message)
    if (message.type === 'PARSE_START') {
      queueMicrotask(() => {
        this.emit('message', {
          data: {
            type: 'PARSE_PROGRESS',
            taskId: message.taskId,
            progress: { phase: 'read', ratio: 0.5, message: '读取文件…' },
          },
        })
        this.emit('message', {
          data: {
            type: 'PARSE_RESULT',
            taskId: message.taskId,
            report: { file: { name: 'fake.ai' }, graphics: { vectors: [] } },
          },
        })
      })
    }
  }

  emit(type, event) {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }

  terminate() {
    this.terminated = true
  }

  last(type) {
    return [...this.posted].reverse().find((message) => message.type === type)
  }
}

describe('AIWorkerClient', () => {
  it('发送 PARSE_START 并转发进度/结果', async () => {
    const worker = new FakeWorker()
    const client = new AIWorkerClient({ workerFactory: () => worker })
    const events = []
    const result = await client.parse(new Blob(['x']), {
      onProgress: (event) => events.push(event),
    })

    expect(worker.last('PARSE_START')).toMatchObject({ type: 'PARSE_START' })
    expect(events).toHaveLength(1)
    expect(events[0].ratio).toBe(0.5)
    expect(result.ok).toBe(true)
    expect(result.report.file.name).toBe('fake.ai')
    expect(client.lastTransport).toBe('worker')
  })

  it('取消时发送 PARSE_CANCEL 并返回 aborted', async () => {
    const worker = new FakeWorker()
    const client = new AIWorkerClient({ workerFactory: () => worker })
    const controller = new AbortController()
    const promise = client.parse(new Blob(['x']), { signal: controller.signal })
    controller.abort()
    const result = await promise
    expect(result.ok).toBe(false)
    expect(result.aborted).toBe(true)
    expect(worker.last('PARSE_CANCEL')).toBeTruthy()
  })

  it('Worker 不可用时回退主线程引擎', async () => {
    const calls = []
    const fallbackEngine = {
      async parse() {
        calls.push('main')
        return { ok: true, report: { file: { name: 'fallback.ai' } } }
      },
    }
    const client = new AIWorkerClient({
      workerFactory: () => {
        throw new Error('worker unavailable')
      },
      fallbackEngine,
    })

    const result = await client.parse(new Blob(['x']))
    expect(calls).toEqual(['main'])
    expect(result.report.file.name).toBe('fallback.ai')
    expect(client.lastTransport).toBe('main')
  })

  it('terminate 释放 Worker', () => {
    const worker = new FakeWorker()
    const client = new AIWorkerClient({ workerFactory: () => worker })
    client.ensureWorker()
    client.terminate()
    expect(worker.terminated).toBe(true)
    expect(client.worker).toBeNull()
  })
})
