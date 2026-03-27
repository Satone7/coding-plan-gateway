/**
 * Unit tests for RequestTimer middleware.
 *
 * @module tests/unit/middleware/request-timer.test
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { performance } from 'perf_hooks';
import {
  RequestTimer,
  createRequestTrace,
} from '@/middleware/request-timer';
import type { RequestTrace } from '@/types/request-trace';
import { ANSI_COLOR_CODES, COLOR_PALETTE_SIZE } from '@/types/request-trace';

describe('RequestTimer', () => {
  let timer: RequestTimer;
  let mockTime: number;
  let originalNow: typeof performance.now;

  beforeEach(() => {
    mockTime = 1000;
    originalNow = performance.now;
    vi.spyOn(performance, 'now').mockImplementation(() => mockTime);
    timer = new RequestTimer('test-request-id');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create a timer with correct initial state', () => {
      const trace = timer.getTrace();

      expect(trace.requestId).toBe('test-request-id');
      expect(trace.colorIndex).toBeGreaterThanOrEqual(0);
      expect(trace.colorIndex).toBeLessThan(COLOR_PALETTE_SIZE);
      expect(trace.stages).toEqual([]);
      expect(trace.totalDurationMs).toBeNull();
      expect(trace.incomplete).toBe(false);
    });
  });

  describe('startStage', () => {
    it('should add a new stage with start time', () => {
      timer.startStage('validation');

      const trace = timer.getTrace();
      expect(trace.stages).toHaveLength(1);
      expect(trace.stages[0].name).toBe('validation');
      expect(trace.stages[0].startTime).toBeDefined();
      expect(trace.stages[0].endTime).toBeNull();
      expect(trace.stages[0].durationMs).toBeNull();
    });

    it('should handle multiple stages', () => {
      timer.startStage('validation');
      timer.startStage('routing');
      timer.startStage('quotaCheck');

      const trace = timer.getTrace();
      expect(trace.stages).toHaveLength(3);
      expect(trace.stages.map((s) => s.name)).toEqual(['validation', 'routing', 'quotaCheck']);
    });

    it('should update existing stage if started again', () => {
      timer.startStage('validation');
      timer.endStage('validation');
      timer.startStage('validation');

      const trace = timer.getTrace();
      expect(trace.stages).toHaveLength(1);
      expect(trace.stages[0].endTime).toBeNull();
      expect(trace.stages[0].durationMs).toBeNull();
    });
  });

  describe('endStage', () => {
    it('should set end time and calculate duration', () => {
      timer.startStage('validation');
      mockTime = 1010;
      timer.endStage('validation');

      const trace = timer.getTrace();
      expect(trace.stages[0].endTime).toBe(1010);
      expect(trace.stages[0].durationMs).toBe(10);
    });

    it('should create stage with zero duration if not started', () => {
      timer.endStage('validation');

      const trace = timer.getTrace();
      expect(trace.stages).toHaveLength(1);
      expect(trace.stages[0].name).toBe('validation');
      expect(trace.stages[0].durationMs).toBe(0);
    });
  });

  describe('getTrace', () => {
    it('should return current trace state', () => {
      timer.startStage('validation');
      timer.endStage('validation');

      const trace = timer.getTrace();
      expect(trace.requestId).toBe('test-request-id');
      expect(trace.stages).toHaveLength(1);
    });
  });

  describe('markIncomplete', () => {
    it('should mark trace as incomplete', () => {
      timer.markIncomplete();

      const trace = timer.getTrace();
      expect(trace.incomplete).toBe(true);
    });
  });

  describe('finalize', () => {
    it('should calculate total duration', () => {
      const newTimer = new RequestTimer('test');
      mockTime = 1050;
      newTimer.finalize();

      const trace = newTimer.getTrace();
      expect(trace.totalDurationMs).toBe(50);
    });
  });

  describe('toSummary', () => {
    it('should generate correct TimingSummary', () => {
      mockTime = 1000;
      timer.startStage('validation');
      mockTime = 1005;
      timer.endStage('validation');

      mockTime = 1005;
      timer.startStage('routing');
      mockTime = 1010;
      timer.endStage('routing');

      timer.finalize();

      const summary = timer.toSummary();

      expect(summary.requestId).toBe('test-request-id');
      expect(summary.colorIndex).toBeGreaterThanOrEqual(0);
      expect(summary.phases).toHaveLength(2);
      expect(summary.phases[0]).toEqual({ name: 'validation', durationMs: 5 });
      expect(summary.phases[1]).toEqual({ name: 'routing', durationMs: 5 });
      expect(summary.incomplete).toBe(false);
    });

    it('should filter out stages without duration', () => {
      timer.startStage('validation');
      // Not ending the stage

      const summary = timer.toSummary();
      expect(summary.phases).toHaveLength(0);
    });
  });

  describe('logSummary', () => {
    it('should output JSON to stdout', () => {
      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

      timer.startStage('validation');
      timer.endStage('validation');
      timer.logSummary();

      expect(stdoutSpy).toHaveBeenCalled();
      const output = stdoutSpy.mock.calls[0][0];
      expect(output).toContain('test-request-id');
      expect(output).toContain('"requestId"');

      stdoutSpy.mockRestore();
    });

    it('should include ANSI color codes in output', () => {
      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

      timer.logSummary();

      const output = stdoutSpy.mock.calls[0][0];
      expect(output).toContain('\x1b['); // ANSI escape sequence

      stdoutSpy.mockRestore();
    });
  });
});

describe('createRequestTrace', () => {
  it('should create a valid RequestTrace', () => {
    const trace = createRequestTrace('req-123');

    expect(trace.requestId).toBe('req-123');
    expect(trace.colorIndex).toBeGreaterThanOrEqual(0);
    expect(trace.colorIndex).toBeLessThan(COLOR_PALETTE_SIZE);
    expect(trace.startTime).toBeDefined();
    expect(trace.stages).toEqual([]);
    expect(trace.totalDurationMs).toBeNull();
    expect(trace.incomplete).toBe(false);
  });

  it('should assign different colors to consecutive traces', () => {
    const trace1 = createRequestTrace('req-1');
    const trace2 = createRequestTrace('req-2');
    const trace3 = createRequestTrace('req-3');

    // Colors should rotate through the palette
    expect(trace1.colorIndex).not.toBe(trace2.colorIndex);
    expect(trace2.colorIndex).not.toBe(trace3.colorIndex);
  });
});

describe('color assignment', () => {
  it('should cycle through colors', () => {
    const traces: RequestTrace[] = [];
    for (let i = 0; i < COLOR_PALETTE_SIZE + 2; i++) {
      traces.push(createRequestTrace(`req-${i}`));
    }

    // First and last should be same (modulo cycling)
    expect(traces[0].colorIndex).toBe(traces[COLOR_PALETTE_SIZE].colorIndex);
    expect(traces[1].colorIndex).toBe(traces[COLOR_PALETTE_SIZE + 1].colorIndex);
  });
});

describe('ANSI_COLOR_CODES', () => {
  it('should have 10 colors', () => {
    expect(ANSI_COLOR_CODES).toHaveLength(10);
  });

  it('should contain valid ANSI codes', () => {
    for (const code of ANSI_COLOR_CODES) {
      expect(code).toBeGreaterThanOrEqual(31); // First color code
      expect(code).toBeLessThanOrEqual(97); // Last standard color code
    }
  });
});

describe('TimingSummary format', () => {
  it('should match the JSON schema structure', () => {
    let time = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => time);
    const timer = new RequestTimer('req-schema-test');
    timer.startStage('requestReceived');
    time = 1001;
    timer.endStage('requestReceived');
    timer.startStage('validation');
    time = 1005;
    timer.endStage('validation');
    timer.startStage('routing');
    time = 1010;
    timer.endStage('routing');
    timer.startStage('upstreamRequest');
    time = 1050;
    timer.endStage('upstreamRequest');
    timer.startStage('responseSent');
    time = 1051;
    timer.endStage('responseSent');

    timer.finalize();
    const summary = timer.toSummary();

    // Verify required fields
    expect(summary).toHaveProperty('requestId');
    expect(summary).toHaveProperty('colorIndex');
    expect(summary).toHaveProperty('totalDurationMs');
    expect(summary).toHaveProperty('phases');
    expect(summary).toHaveProperty('incomplete');

    // Verify types
    expect(typeof summary.requestId).toBe('string');
    expect(typeof summary.colorIndex).toBe('number');
    expect(typeof summary.totalDurationMs).toBe('number');
    expect(Array.isArray(summary.phases)).toBe(true);
    expect(typeof summary.incomplete).toBe('boolean');

    // Verify phases structure
    for (const phase of summary.phases) {
      expect(phase).toHaveProperty('name');
      expect(phase).toHaveProperty('durationMs');
      expect(typeof phase.name).toBe('string');
      expect(typeof phase.durationMs).toBe('number');
    }
  });
});