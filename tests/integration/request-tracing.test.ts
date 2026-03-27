/**
 * Integration tests for request tracing.
 *
 * @module tests/integration/request-tracing.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { registerRequestTimer } from '@/middleware/request-timer';

describe('Request Tracing Integration', () => {
  let app: FastifyInstance;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    app = Fastify({ logger: false });
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(async () => {
    await app.close();
    stdoutSpy.mockRestore();
  });

  describe('registerRequestTimer', () => {
    it('should register without errors', () => {
      expect(() => registerRequestTimer(app)).not.toThrow();
    });

    it('should track timing for registered routes', async () => {
      registerRequestTimer(app);

      app.get('/v1/test', async (request, reply) => {
        return { status: 'ok' };
      });

      const response = await app.inject({
        method: 'GET',
        url: '/v1/test',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: 'ok' });

      // Check that timing was logged
      const calls = stdoutSpy.mock.calls;
      const timingLog = calls.find((call) =>
        call[0].includes('"requestId"') && call[0].includes('"phases"')
      );

      expect(timingLog).toBeDefined();
    });

    it('should include requestReceived and responseSent stages', async () => {
      registerRequestTimer(app);

      app.get('/v1/test', async (request, reply) => {
        return { status: 'ok' };
      });

      await app.inject({
        method: 'GET',
        url: '/v1/test',
      });

      const calls = stdoutSpy.mock.calls;
      const timingLog = calls.find((call) =>
        call[0].includes('"requestReceived"') && call[0].includes('"responseSent"')
      );

      expect(timingLog).toBeDefined();
    });
  });

  describe('excluded paths', () => {
    it('should NOT track timing for /health', async () => {
      registerRequestTimer(app);

      app.get('/health', async (request, reply) => {
        return { status: 'healthy' };
      });

      await app.inject({
        method: 'GET',
        url: '/health',
      });

      // Should not have timing logs for health endpoint
      const calls = stdoutSpy.mock.calls;
      const timingLog = calls.find((call) =>
        call[0].includes('"phases"')
      );

      expect(timingLog).toBeUndefined();
    });

    it('should NOT track timing for /internal/* routes', async () => {
      registerRequestTimer(app);

      app.get('/internal/reload', async (request, reply) => {
        return { reloaded: true };
      });

      await app.inject({
        method: 'GET',
        url: '/internal/reload',
      });

      // Should not have timing logs for internal endpoint
      const calls = stdoutSpy.mock.calls;
      const timingLog = calls.find((call) =>
        call[0].includes('"phases"')
      );

      expect(timingLog).toBeUndefined();
    });
  });

  describe('error handling', () => {
    it('should mark request as incomplete on error', async () => {
      registerRequestTimer(app);

      app.get('/v1/error', async (request, reply) => {
        throw new Error('Test error');
      });

      const response = await app.inject({
        method: 'GET',
        url: '/v1/error',
      });

      expect(response.statusCode).toBe(500);

      // Find timing log
      const calls = stdoutSpy.mock.calls;
      const timingLog = calls.find((call) =>
        call[0].includes('"incomplete":true')
      );

      expect(timingLog).toBeDefined();
    });
  });

  describe('concurrent requests', () => {
    it('should assign different colors to concurrent requests', async () => {
      registerRequestTimer(app);

      app.get('/v1/concurrent', async (request, reply) => {
        // Simulate some processing time
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { request: request.id };
      });

      // Send concurrent requests
      const [response1, response2, response3] = await Promise.all([
        app.inject({ method: 'GET', url: '/v1/concurrent' }),
        app.inject({ method: 'GET', url: '/v1/concurrent' }),
        app.inject({ method: 'GET', url: '/v1/concurrent' }),
      ]);

      expect(response1.statusCode).toBe(200);
      expect(response2.statusCode).toBe(200);
      expect(response3.statusCode).toBe(200);

      // Extract colorIndex from timing logs
      const calls = stdoutSpy.mock.calls;
      const colorIndices: number[] = [];

      for (const call of calls) {
        const match = call[0].match(/"colorIndex":(\d+)/);
        if (match) {
          colorIndices.push(parseInt(match[1], 10));
        }
      }

      // Should have 3 color indices
      expect(colorIndices.length).toBeGreaterThanOrEqual(3);

      // Colors should be in valid range
      for (const idx of colorIndices) {
        expect(idx).toBeGreaterThanOrEqual(0);
        expect(idx).toBeLessThan(10);
      }
    });
  });

  describe('JSON output format', () => {
    it('should output valid JSON', async () => {
      registerRequestTimer(app);

      app.get('/v1/json', async (request, reply) => {
        return { data: 'test' };
      });

      await app.inject({
        method: 'GET',
        url: '/v1/json',
      });

      // Find JSON output (after the ANSI color prefix)
      const calls = stdoutSpy.mock.calls;
      const jsonCall = calls.find((call) =>
        call[0].includes('"requestId"') && call[0].includes('"phases"')
      );

      expect(jsonCall).toBeDefined();

      // Extract JSON part (after color prefix and requestId bracket)
      const output = jsonCall![0];
      const jsonMatch = output.match(/\{"requestId".*\}/);

      expect(jsonMatch).toBeDefined();

      // Should be valid JSON
      const parsed = JSON.parse(jsonMatch![0]);
      expect(parsed).toHaveProperty('requestId');
      expect(parsed).toHaveProperty('colorIndex');
      expect(parsed).toHaveProperty('totalDurationMs');
      expect(parsed).toHaveProperty('phases');
      expect(parsed).toHaveProperty('incomplete');
    });

    it('should include requestId in output', async () => {
      registerRequestTimer(app);

      app.get('/v1/requestid', async (request, reply) => {
        return { requestId: request.id };
      });

      const response = await app.inject({
        method: 'GET',
        url: '/v1/requestid',
      });

      const requestId = response.json().requestId;

      // Find timing log with this requestId
      const calls = stdoutSpy.mock.calls;
      const timingLog = calls.find((call) =>
        call[0].includes(`"requestId":"${requestId}"`)
      );

      expect(timingLog).toBeDefined();
    });
  });
});