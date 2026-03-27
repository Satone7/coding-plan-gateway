/**
 * Unit tests for ModelResolver service.
 * Tests model name normalization and alias resolution.
 */

import { describe, it, expect } from 'vitest';
import { ModelResolver, createModelResolver, MODEL_ALIASES } from '@/services/model-resolver';

describe('ModelResolver', () => {
  let resolver: ModelResolver;

  beforeEach(() => {
    resolver = createModelResolver();
  });

  describe('resolve', () => {
    it('should return normalized name when no alias exists', () => {
      const result = resolver.resolve('gpt-4-turbo');
      expect(result).toBe('gpt-4-turbo');
    });

    it('should handle lowercase input', () => {
      const result = resolver.resolve('minimax-m2.5');
      expect(result).toBe('MiniMax-M2.5');
    });

    it('should handle uppercase input', () => {
      const result = resolver.resolve('MINIMAX-M2.5');
      expect(result).toBe('MiniMax-M2.5');
    });

    it('should handle mixed case input', () => {
      const result = resolver.resolve('MiniMax-M2.5');
      expect(result).toBe('MiniMax-M2.5');
    });

    it('should handle GPT alias', () => {
      const result = resolver.resolve('gpt-4');
      expect(result).toBe('gpt-4-turbo');
    });

    it('should handle Claude aliases', () => {
      expect(resolver.resolve('claude-3')).toBe('claude-3-opus-20240229');
      expect(resolver.resolve('claude-3-sonnet')).toBe('claude-3-sonnet-20240229');
      expect(resolver.resolve('claude-3-haiku')).toBe('claude-3-haiku-20240307');
    });

    it('should trim whitespace from input', () => {
      const result = resolver.resolve('  gpt-4-turbo  ');
      expect(result).toBe('gpt-4-turbo');
    });

    it('should handle unknown model names (no alias)', () => {
      const result = resolver.resolve('unknown-model');
      expect(result).toBe('unknown-model');
    });
  });

  describe('resolveWithOriginal', () => {
    it('should preserve original name for upstream', () => {
      const result = resolver.resolveWithOriginal('gpt-4');
      expect(result.originalName).toBe('gpt-4');
    });

    it('should return canonical name for plan matching', () => {
      const result = resolver.resolveWithOriginal('gpt-4');
      expect(result.canonicalName).toBe('gpt-4-turbo');
    });

    it('should indicate when alias was used', () => {
      const result = resolver.resolveWithOriginal('gpt-4');
      expect(result.wasAlias).toBe(true);
      expect(result.resolvedAlias).toBe('gpt-4');
    });

    it('should indicate when no alias was used', () => {
      const result = resolver.resolveWithOriginal('gpt-4-turbo');
      expect(result.wasAlias).toBe(false);
      expect(result.resolvedAlias).toBeUndefined();
    });

    it('should preserve case of original model name', () => {
      const result = resolver.resolveWithOriginal('GPT-4');
      expect(result.originalName).toBe('GPT-4');
      expect(result.canonicalName).toBe('gpt-4-turbo');
    });

    it('should handle minimax alias correctly', () => {
      const result = resolver.resolveWithOriginal('minimax-m2.5');
      expect(result.canonicalName).toBe('MiniMax-M2.5');
      expect(result.originalName).toBe('minimax-m2.5');
      expect(result.wasAlias).toBe(true);
      expect(result.resolvedAlias).toBe('minimax-m2.5');
    });
  });

  describe('getAliases', () => {
    it('should return all known aliases', () => {
      const aliases = resolver.getAliases();
      expect(aliases).toEqual(MODEL_ALIASES);
    });

    it('should return a copy (not reference)', () => {
      const aliases = resolver.getAliases();
      aliases['test-alias'] = 'test-canonical';
      const aliases2 = resolver.getAliases();
      expect(aliases2).not.toHaveProperty('test-alias');
    });
  });

  describe('isAlias', () => {
    it('should return true for known alias', () => {
      expect(resolver.isAlias('gpt-4')).toBe(true);
    });

    it('should return true for case-insensitive alias', () => {
      expect(resolver.isAlias('GPT-4')).toBe(true);
      expect(resolver.isAlias('Gpt-4')).toBe(true);
    });

    it('should return false for non-alias', () => {
      expect(resolver.isAlias('gpt-4-turbo')).toBe(false);
    });

    it('should return false for unknown model', () => {
      expect(resolver.isAlias('unknown-model')).toBe(false);
    });

    it('should handle minimax alias', () => {
      expect(resolver.isAlias('minimax-m2.5')).toBe(true);
      expect(resolver.isAlias('MiniMax-M2.5')).toBe(true);
    });
  });
});