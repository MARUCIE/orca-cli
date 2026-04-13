import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ProgressIndicator, printError, printRichBanner } from '../src/output.js'

describe('ProgressIndicator', () => {
  let mockStderr: string[] = []
  let stderrSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    mockStderr = []
    vi.useFakeTimers()

    // Mock process.stderr.write to capture output
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((text: string | Uint8Array) => {
      mockStderr.push(String(text))
      return true
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    stderrSpy.mockRestore()
  })

  describe('start()', () => {
    it('initializes with thinking phase', () => {
      const indicator = new ProgressIndicator()
      indicator.start()

      // Advance timer to trigger render
      vi.advanceTimersByTime(100)

      // Check that something was written to stderr
      expect(mockStderr.length).toBeGreaterThan(0)
      const output = mockStderr.join('')
      expect(output).toContain('Thinking...')
    })

    it('starts timer and sets phase to thinking', () => {
      const indicator = new ProgressIndicator()
      indicator.start()

      // Render one iteration
      vi.advanceTimersByTime(100)

      // Stop and verify elapsed time is ~0
      const result = indicator.stop()
      expect(result.elapsed).toBeGreaterThanOrEqual(0)
      expect(result.elapsed).toBeLessThan(200) // Should be very quick
    })
  })

  describe('markWorking()', () => {
    it('transitions from thinking to working phase', () => {
      const indicator = new ProgressIndicator()
      indicator.start()

      // Initially in thinking phase
      vi.advanceTimersByTime(100)
      let output = mockStderr.join('')
      expect(output).toContain('Thinking...')

      mockStderr = []
      indicator.markWorking()

      // After marking working, should show working
      vi.advanceTimersByTime(100)
      output = mockStderr.join('')
      expect(output).toContain('Working')
    })
  })

  describe('addText() and addChars()', () => {
    it('addText estimates tokens from Latin text (4 chars/token)', () => {
      const indicator = new ProgressIndicator()
      indicator.start()

      indicator.addText('Hello world test')  // 16 Latin chars → ceil(16/4) = 4 tokens

      vi.advanceTimersByTime(100)

      const result = indicator.stop()
      expect(result.tokens).toBe(4)
    })

    it('addText estimates CJK tokens at ~1.5 chars/token', () => {
      const indicator = new ProgressIndicator()
      indicator.start()

      indicator.addText('你好世界测试')  // 6 CJK chars → ceil(6/1.5) = 4 tokens

      vi.advanceTimersByTime(100)

      const result = indicator.stop()
      expect(result.tokens).toBe(4)
    })

    it('addChars estimates tokens at 4 chars/token', () => {
      const indicator = new ProgressIndicator()
      indicator.start()

      indicator.addChars(100)  // 100 chars → ceil(100/4) = 25 tokens

      vi.advanceTimersByTime(100)

      const result = indicator.stop()
      expect(result.tokens).toBe(25)
    })

    it('starts at zero tokens', () => {
      const indicator = new ProgressIndicator()
      indicator.start()

      vi.advanceTimersByTime(100)

      const result = indicator.stop()
      expect(result.tokens).toBe(0)
    })

    it('accumulates tokens with zero additions', () => {
      const indicator = new ProgressIndicator()
      indicator.start()

      indicator.addChars(0)
      vi.advanceTimersByTime(100)

      const result = indicator.stop()
      expect(result.tokens).toBe(0)
    })
  })

  describe('stop()', () => {
    it('returns elapsed time in milliseconds', () => {
      const indicator = new ProgressIndicator()
      indicator.start()

      vi.advanceTimersByTime(2500) // 2.5 seconds

      const result = indicator.stop()
      expect(result.elapsed).toBeGreaterThanOrEqual(2500)
      expect(result.elapsed).toBeLessThan(2600)
    })

    it('returns token count', () => {
      const indicator = new ProgressIndicator()
      indicator.start()
      indicator.addChars(100)  // 100 chars → ceil(100/4) = 25 tokens

      const result = indicator.stop()
      expect(result.tokens).toBe(25)
    })

    it('clears interval and can be called multiple times safely', () => {
      const indicator = new ProgressIndicator()
      indicator.start()

      vi.advanceTimersByTime(100)

      // First stop
      const result1 = indicator.stop()
      expect(result1.elapsed).toBeGreaterThanOrEqual(100)

      // Clear mock to track second call
      mockStderr = []

      // Second stop should not error and should be safe
      const result2 = indicator.stop()
      expect(result2.tokens).toBe(0)

      // No new output after second stop
      expect(mockStderr.length).toBe(0)
    })

    it('clears the progress line from stderr', () => {
      const indicator = new ProgressIndicator()
      indicator.start()

      vi.advanceTimersByTime(100)

      mockStderr = []

      indicator.stop()

      // Should have written ANSI clear sequence (save cursor + clear line + restore)
      const output = mockStderr.join('')
      expect(output).toContain('\x1b[2K') // ANSI: clear entire line
    })
  })

  describe('rendering with tokens', () => {
    it('shows token count when working and tokens present', () => {
      const indicator = new ProgressIndicator()
      indicator.start()
      indicator.markWorking()
      indicator.addChars(100) // 100 chars ≈ 25 tokens

      mockStderr = []
      vi.advanceTimersByTime(100)

      const output = mockStderr.join('')
      expect(output).toContain('Working')
      expect(output).toContain('↓')
      expect(output).toContain('25') // 100 chars / 4 = 25 tokens
    })

    it('does not show token count when working but zero tokens', () => {
      const indicator = new ProgressIndicator()
      indicator.start()
      indicator.markWorking()

      mockStderr = []
      vi.advanceTimersByTime(100)

      const output = mockStderr.join('')
      expect(output).toContain('Working')
      // Should not show "↓" or token count when no tokens
      expect(output).not.toContain('↓')
    })
  })

  describe('timing display', () => {
    it('shows elapsed time less than 60s in seconds', () => {
      const indicator = new ProgressIndicator()
      indicator.start()

      vi.advanceTimersByTime(45000) // 45 seconds

      mockStderr = []
      vi.advanceTimersByTime(100)

      const output = mockStderr.join('')
      expect(output).toMatch(/45s/)
    })

    it('shows elapsed time >= 60s in minutes and seconds', () => {
      const indicator = new ProgressIndicator()
      indicator.start()

      vi.advanceTimersByTime(125000) // 2 minutes 5 seconds

      mockStderr = []
      vi.advanceTimersByTime(100)

      const output = mockStderr.join('')
      expect(output).toMatch(/2m 5s/)
    })

    it('shows exactly 1 minute correctly', () => {
      const indicator = new ProgressIndicator()
      indicator.start()

      vi.advanceTimersByTime(60000) // exactly 60 seconds

      mockStderr = []
      vi.advanceTimersByTime(100)

      const output = mockStderr.join('')
      expect(output).toMatch(/1m 0s/)
    })
  })

  describe('spinner animation', () => {
    it('cycles through spinner frames', () => {
      const indicator = new ProgressIndicator()
      indicator.start()

      mockStderr = []

      // Capture multiple render cycles
      vi.advanceTimersByTime(100)
      const output1 = mockStderr.join('')

      mockStderr = []
      vi.advanceTimersByTime(100)
      const output2 = mockStderr.join('')

      // Outputs should contain spinner characters (Braille patterns)
      expect(output1).toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/)
      expect(output2).toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/)

      indicator.stop()
    })

    it('shows interrupt message', () => {
      const indicator = new ProgressIndicator()
      indicator.start()

      vi.advanceTimersByTime(100)

      const output = mockStderr.join('')
      expect(output).toContain('esc to interrupt')
    })
  })
})

describe('printError with error classification', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    errorSpy.mockRestore()
  })

  it('prints error message and suggests API key fix for 401', () => {
    printError('401 Unauthorized: invalid api key')

    expect(errorSpy).toHaveBeenCalled()
    const output = errorSpy.mock.calls.map(c => c[0]).join('\n')
    expect(output).toContain('401')
    expect(output).toContain('API key')
  })

  it('prints rate limit suggestion for 429 errors', () => {
    printError('429 Too Many Requests - rate limited')

    expect(errorSpy).toHaveBeenCalled()
    const output = errorSpy.mock.calls.map(c => c[0]).join('\n')
    expect(output).toContain('Rate limited')
  })

  it('prints model not found suggestion for 404 errors', () => {
    printError('404 Not Found: model unavailable')

    expect(errorSpy).toHaveBeenCalled()
    const output = errorSpy.mock.calls.map(c => c[0]).join('\n')
    expect(output).toContain('Model not found')
  })

  it('prints timeout suggestion for timeout errors', () => {
    printError('Request timed out after 30 seconds')

    expect(errorSpy).toHaveBeenCalled()
    const output = errorSpy.mock.calls.map(c => c[0]).join('\n')
    expect(output).toContain('timed out')
  })
})

describe('printRichBanner with path abbreviation', () => {
  let logSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    logSpy.mockRestore()
  })

  it('abbreviates HOME directory path with ~', async () => {
    const home = process.env.HOME || ''

    if (!home) {
      // Skip if HOME not set
      expect(true).toBe(true)
      return
    }

    const testPath = home + '/my/project'
    await printRichBanner({
      provider: 'test',
      model: 'claude-opus-4',
      cwd: testPath,
    })

    expect(logSpy).toHaveBeenCalled()
    const output = logSpy.mock.calls.map(c => String(c[0])).join('\n')
    expect(output).toContain('~')
    expect(output).not.toContain(home)
  })
})

describe('integration: full progress cycle', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('complete cycle: start, work, accumulate tokens, stop', () => {
    const indicator = new ProgressIndicator()

    // Start
    indicator.start()
    vi.advanceTimersByTime(100)

    // Transition to working
    indicator.markWorking()
    vi.advanceTimersByTime(100)

    // Accumulate tokens via addText (Latin text)
    indicator.addText('hello world')   // 11 Latin chars → ceil(11/4) = 3
    indicator.addText('testing here')  // 12 Latin chars → ceil(12/4) = 3
    vi.advanceTimersByTime(1000)

    // Stop
    const result = indicator.stop()

    expect(result.elapsed).toBeGreaterThanOrEqual(1200)
    expect(result.tokens).toBe(6)  // 3 + 3
  })

  it('quick operation: start and stop quickly', () => {
    const indicator = new ProgressIndicator()

    indicator.start()
    vi.advanceTimersByTime(10)

    const result = indicator.stop()

    expect(result.elapsed).toBeLessThan(100)
    expect(result.tokens).toBe(0)
  })

  it('long operation with multiple token batches', () => {
    const indicator = new ProgressIndicator()

    indicator.start()
    indicator.markWorking()

    // Simulate token stream via addChars (each 40 chars → ceil(40/4) = 10 tokens)
    for (let i = 0; i < 5; i++) {
      indicator.addChars(40)
      vi.advanceTimersByTime(500)
    }

    const result = indicator.stop()

    expect(result.elapsed).toBeGreaterThanOrEqual(2500)
    expect(result.tokens).toBe(50)  // 5 × 10
  })
})
