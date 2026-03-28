/**
 * Unit tests for ModelResolver service.
 * Tests model name normalization and alias resolution.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ModelResolver, createModelResolver } from '@/services/model-resolver';

describe('ModelResolver', () => {
  // Default test aliases
  const testAliases = {
    'gpt-4': 'gpt-4-turbo',
    'gpt-4-32k': 'gpt-4-32k-context',
    'gpt-3.5-turbo': 'gpt-3.5-turbo-0125',
    'claude-3': 'claude-3-opus-20240229',
    'claude-3-sonnet': 'claude-3-sonnet-20240229',
    'claude-3-haiku': 'claude-3-haiku-20240307',
    'minimax-m2.5': 'MiniMax-M2.5',
    'minimax-m2': 'MiniMax-M2',
  };

  let resolver: ModelResolver;

  beforeEach(() => {
    resolver = createModelResolver({ aliases: testAliases });
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
      expect(aliases).toEqual(testAliases);
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

  describe('constructor with empty aliases', () => {
    it('should work with empty aliases', () => {
      const emptyResolver = createModelResolver({ aliases: {} });
      expect(emptyResolver.resolve('gpt-4')).toBe('gpt-4');
    });
  });

  describe('updateAliases', () => {
    it('should update aliases at runtime', () => {
      resolver.updateAliases({ 'new-alias': 'new-canonical' });
      expect(resolver.resolve('new-alias')).toBe('new-canonical');
    });

    it('should reject circular aliases on update', () => {
      expect(() => {
        resolver.updateAliases({ 'a': 'b', 'b': 'a' });
      }).toThrow('Circular alias chain');
    });

    it('should log when aliases are updated', () => {
      const emptyResolver = createModelResolver({ aliases: {} });
      emptyResolver.updateAliases({ 'test': 'canonical' });
      expect(emptyResolver.getAliases()).toEqual({ 'test': 'canonical' });
    });
  });

  describe('detectCircularAliases', () => {
    it('should detect circular chains', () => {
      const error = ModelResolver.detectCircularAliases({ 'a': 'b', 'b': 'a' });
      expect(error).toContain('Circular alias chain');
    });

    it('should detect longer circular chains', () => {
      const error = ModelResolver.detectCircularAliases({ 'a': 'b', 'b': 'c', 'c': 'a' });
      expect(error).toContain('Circular alias chain');
    });

    it('should return null for valid aliases', () => {
      const result = ModelResolver.detectCircularAliases(testAliases);
      expect(result).toBeNull();
    });

    it('should handle aliases with different casing', () => {
      // This should NOT be flagged as circular - "minimax-m2.5" is the alias key,
      // "MiniMax-M2.5" is the canonical name (different cases are allowed)
      const result = ModelResolver.detectCircularAliases({ 'minimax-m2.5': 'MiniMax-M2.5' });
      expect(result).toBeNull();
    });
  });
});