/**
 * Unit tests for validators utility.
 */

import { describe, it, expect } from 'vitest';
import {
  uuidSchema,
  nonEmptyStringSchema,
  httpsUrlSchema,
  positiveIntegerSchema,
  nonNegativeIntegerSchema,
  quotaPeriodSchema,
  quotaConfigSchema,
  createPlanSchema,
  updatePlanSchema,
  validate,
  safeValidate,
  ValidationError,
} from '@/utils/validators';

describe('Validators', () => {
  describe('uuidSchema', () => {
    it('should validate a valid UUID', () => {
      const result = uuidSchema.safeParse('550e8400-e29b-41d4-a716-446655440000');
      expect(result.success).toBe(true);
    });

    it('should reject an invalid UUID', () => {
      const result = uuidSchema.safeParse('not-a-uuid');
      expect(result.success).toBe(false);
    });
  });

  describe('nonEmptyStringSchema', () => {
    it('should accept non-empty strings', () => {
      const result = nonEmptyStringSchema.safeParse('hello');
      expect(result.success).toBe(true);
    });

    it('should reject empty strings', () => {
      const result = nonEmptyStringSchema.safeParse('');
      expect(result.success).toBe(false);
    });
  });

  describe('httpsUrlSchema', () => {
    it('should accept HTTPS URLs', () => {
      const result = httpsUrlSchema.safeParse('https://api.example.com');
      expect(result.success).toBe(true);
    });

    it('should accept localhost URLs', () => {
      const result = httpsUrlSchema.safeParse('http://localhost:8080');
      expect(result.success).toBe(true);
    });

    it('should reject non-HTTPS URLs', () => {
      const result = httpsUrlSchema.safeParse('http://api.example.com');
      expect(result.success).toBe(false);
    });

    it('should reject invalid URLs', () => {
      const result = httpsUrlSchema.safeParse('not-a-url');
      expect(result.success).toBe(false);
    });
  });

  describe('positiveIntegerSchema', () => {
    it('should accept positive integers', () => {
      const result = positiveIntegerSchema.safeParse(42);
      expect(result.success).toBe(true);
    });

    it('should reject zero', () => {
      const result = positiveIntegerSchema.safeParse(0);
      expect(result.success).toBe(false);
    });

    it('should reject negative numbers', () => {
      const result = positiveIntegerSchema.safeParse(-1);
      expect(result.success).toBe(false);
    });

    it('should reject non-integers', () => {
      const result = positiveIntegerSchema.safeParse(1.5);
      expect(result.success).toBe(false);
    });
  });

  describe('nonNegativeIntegerSchema', () => {
    it('should accept zero', () => {
      const result = nonNegativeIntegerSchema.safeParse(0);
      expect(result.success).toBe(true);
    });

    it('should accept positive integers', () => {
      const result = nonNegativeIntegerSchema.safeParse(42);
      expect(result.success).toBe(true);
    });

    it('should reject negative numbers', () => {
      const result = nonNegativeIntegerSchema.safeParse(-1);
      expect(result.success).toBe(false);
    });
  });

  describe('quotaPeriodSchema', () => {
    it('should accept valid periods', () => {
      expect(quotaPeriodSchema.safeParse('daily').success).toBe(true);
      expect(quotaPeriodSchema.safeParse('monthly').success).toBe(true);
      expect(quotaPeriodSchema.safeParse('total').success).toBe(true);
    });

    it('should reject invalid periods', () => {
      const result = quotaPeriodSchema.safeParse('weekly');
      expect(result.success).toBe(false);
    });
  });

  describe('quotaConfigSchema', () => {
    it('should validate a valid quota config', () => {
      const result = quotaConfigSchema.safeParse({
        limit: 100,
        period: 'daily',
      });
      expect(result.success).toBe(true);
    });

    it('should reject missing fields', () => {
      const result = quotaConfigSchema.safeParse({ limit: 100 });
      expect(result.success).toBe(false);
    });
  });

  describe('createPlanSchema', () => {
    it('should validate a valid plan', () => {
      const result = createPlanSchema.safeParse({
        name: 'Test Plan',
        baseUrl: 'https://api.example.com',
        apiKey: 'secret-key',
        models: ['model-1', 'model-2'],
        quota: { limit: 100, period: 'daily' },
      });
      expect(result.success).toBe(true);
    });

    it('should reject empty name', () => {
      const result = createPlanSchema.safeParse({
        name: '',
        baseUrl: 'https://api.example.com',
        apiKey: 'secret-key',
        models: ['model-1'],
        quota: { limit: 100, period: 'daily' },
      });
      expect(result.success).toBe(false);
    });

    it('should reject empty models array', () => {
      const result = createPlanSchema.safeParse({
        name: 'Test Plan',
        baseUrl: 'https://api.example.com',
        apiKey: 'secret-key',
        models: [],
        quota: { limit: 100, period: 'daily' },
      });
      expect(result.success).toBe(false);
    });
  });

  describe('updatePlanSchema', () => {
    it('should validate partial updates', () => {
      const result = updatePlanSchema.safeParse({
        name: 'Updated Name',
      });
      expect(result.success).toBe(true);
    });

    it('should accept empty object', () => {
      const result = updatePlanSchema.safeParse({});
      expect(result.success).toBe(true);
    });
  });

  describe('validate function', () => {
    it('should return data on success', () => {
      const result = validate(nonEmptyStringSchema, 'hello');
      expect(result).toBe('hello');
    });

    it('should throw ValidationError on failure', () => {
      expect(() => validate(nonEmptyStringSchema, '')).toThrow(ValidationError);
    });

    it('should have error details in ValidationError', () => {
      try {
        validate(nonEmptyStringSchema, '');
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
        const validationError = error as ValidationError;
        expect(validationError.details).toBeDefined();
        expect(validationError.getFormattedErrors()).toBeDefined();
      }
    });
  });

  describe('safeValidate function', () => {
    it('should return success object on valid data', () => {
      const result = safeValidate(nonEmptyStringSchema, 'hello');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe('hello');
      }
    });

    it('should return error object on invalid data', () => {
      const result = safeValidate(nonEmptyStringSchema, '');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBeDefined();
      }
    });
  });
});