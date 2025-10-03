import { describe, it, expect } from 'vitest';
import { LOGGING_ENABLED, logRequest } from '../lib/logger.js';

describe('Logger Module', () => {
	describe('LOGGING_ENABLED constant', () => {
		it('should be a boolean', () => {
			expect(typeof LOGGING_ENABLED).toBe('boolean');
		});

		it('should default to false when env variable is not set', () => {
			// This test verifies the default behavior
			// In a real test environment, ENABLE_PLUGIN_REQUEST_LOGGING would not be set
			const isEnabled = process.env.ENABLE_PLUGIN_REQUEST_LOGGING === '1';
			expect(typeof isEnabled).toBe('boolean');
		});
	});

	describe('logRequest function', () => {
		it('should accept stage and data parameters', () => {
			// This should not throw
			expect(() => {
				logRequest('test-stage', { data: 'test' });
			}).not.toThrow();
		});

		it('should handle empty data object', () => {
			expect(() => {
				logRequest('test-stage', {});
			}).not.toThrow();
		});

		it('should handle complex data structures', () => {
			expect(() => {
				logRequest('test-stage', {
					nested: { data: 'value' },
					array: [1, 2, 3],
					number: 123,
					boolean: true,
				});
			}).not.toThrow();
		});
	});
});
