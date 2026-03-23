/**
 * Unit tests for health routes.
 */

import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { registerHealthRoutes } from '@/routes/health';

describe('Health Routes', () => {
  describe('GET /health', () => {
    it('should return 200 with ok status', async () => {
      const app = Fastify();
      registerHealthRoutes(app, { configLoaded: true, planCount: 2 });

      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        status: 'ok',
      });
    });

    it('should include uptime and version', async () => {
      const app = Fastify();
      registerHealthRoutes(app, { configLoaded: true, planCount: 2 });

      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      const body = response.json();
      expect(body).toHaveProperty('uptime');
      expect(body).toHaveProperty('version');
      expect(body).toHaveProperty('timestamp');
      expect(typeof body.uptime).toBe('number');
      expect(body.uptime).toBeGreaterThanOrEqual(0);
    });
  });

  describe('GET /ready', () => {
    it('should return 200 when all checks pass', async () => {
      const app = Fastify();
      registerHealthRoutes(app, { configLoaded: true, planCount: 2 });

      const response = await app.inject({
        method: 'GET',
        url: '/ready',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        ready: true,
        checks: {
          config: true,
          plans: true,
        },
      });
    });

    it('should return 503 when config is not loaded', async () => {
      const app = Fastify();
      registerHealthRoutes(app, { configLoaded: false, planCount: 2 });

      const response = await app.inject({
        method: 'GET',
        url: '/ready',
      });

      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({
        ready: false,
        checks: {
          config: false,
          plans: true,
        },
      });
    });

    it('should return 503 when plans count is negative', async () => {
      const app = Fastify();
      registerHealthRoutes(app, { configLoaded: true, planCount: -1 });

      const response = await app.inject({
        method: 'GET',
        url: '/ready',
      });

      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({
        ready: false,
      });
    });

    it('should include message when not ready', async () => {
      const app = Fastify();
      registerHealthRoutes(app, { configLoaded: false, planCount: -1 });

      const response = await app.inject({
        method: 'GET',
        url: '/ready',
      });

      const body = response.json();
      expect(body).toHaveProperty('message');
      expect(body.message).toContain('config');
      expect(body.message).toContain('plans');
    });
  });
});