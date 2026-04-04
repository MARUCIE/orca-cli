import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('output', () => {
  let writeSpy: ReturnType<typeof vi.spyOn>
  let logSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    writeSpy.mockRestore()
    logSpy.mockRestore()
  })

  it('streamToken writes to stdout', async () => {
    const { streamToken } = await import('../src/output.js')
    streamToken('hello')
    expect(writeSpy).toHaveBeenCalledWith('hello')
  })

  it('emitJson outputs valid JSON', async () => {
    const { emitJson } = await import('../src/output.js')
    emitJson({ type: 'test', data: 'hello' })
    expect(logSpy).toHaveBeenCalled()
    const output = logSpy.mock.calls[0]![0] as string
    const parsed = JSON.parse(output)
    expect(parsed.type).toBe('test')
    expect(parsed.data).toBe('hello')
    expect(parsed.timestamp).toBeDefined()
  })
})
