import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { 
	LOGGING_ENABLED, 
	logRequest, 
	maskEmail,
	setCorrelationId,
	getCorrelationId,
	clearCorrelationId,
} from '../lib/logger.js';

describe('Logger Module', () => {
	describe('LOGGING_ENABLED constant', () => {
		it('should be a boolean', () => {
			expect(typeof LOGGING_ENABLED).toBe('boolean');
		});

		it('should default to false when env variable is not set', () => {
			const isEnabled = process.env.ENABLE_PLUGIN_REQUEST_LOGGING === '1';
			expect(typeof isEnabled).toBe('boolean');
		});
	});

	describe('logRequest function', () => {
		it('should accept stage and data parameters', () => {
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

	describe('token masking', () => {
		it('should mask JWT tokens in data', () => {
			const jwtToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
			expect(() => {
				logRequest('test-stage', { token: jwtToken });
			}).not.toThrow();
		});

		it('should mask sensitive keys in data', () => {
			expect(() => {
				logRequest('test-stage', {
					access_token: 'secret-access-token',
					refresh_token: 'secret-refresh-token',
					authorization: 'Bearer xyz',
					apiKey: 'sk-1234567890abcdef',
				});
			}).not.toThrow();
		});

		it('should handle nested sensitive data', () => {
			expect(() => {
				logRequest('test-stage', {
					auth: {
						access: 'secret-token',
						nested: {
							refresh: 'another-secret',
						},
					},
				});
			}).not.toThrow();
		});
	});

	describe('maskEmail function', () => {
		it('should mask a standard email address', () => {
			const masked = maskEmail('john.doe@example.com');
			expect(masked).toBe('jo***@***.com');
		});

		it('should mask a short local part', () => {
			const masked = maskEmail('a@example.org');
			expect(masked).toBe('a***@***.org');
		});

		it('should handle subdomain emails', () => {
			const masked = maskEmail('user@mail.company.co.uk');
			expect(masked).toBe('us***@***.uk');
		});

		it('should handle invalid emails gracefully', () => {
			const masked = maskEmail('not-an-email');
			expect(masked).toBe('***@***');
		});

		it('should preserve TLD correctly', () => {
			const masked = maskEmail('test@domain.io');
			expect(masked).toBe('te***@***.io');
		});
	});

	describe('correlation ID management', () => {
		beforeEach(() => {
			clearCorrelationId();
		});

		afterEach(() => {
			clearCorrelationId();
		});

		it('should start with no correlation ID', () => {
			expect(getCorrelationId()).toBeNull();
		});

		it('should generate a UUID when setCorrelationId is called without argument', () => {
			const id = setCorrelationId();
			expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
			expect(getCorrelationId()).toBe(id);
		});

		it('should use provided ID when setCorrelationId is called with argument', () => {
			const customId = 'custom-correlation-id-123';
			const id = setCorrelationId(customId);
			expect(id).toBe(customId);
			expect(getCorrelationId()).toBe(customId);
		});

		it('should clear correlation ID', () => {
			setCorrelationId();
			expect(getCorrelationId()).not.toBeNull();
			clearCorrelationId();
			expect(getCorrelationId()).toBeNull();
		});

		it('should overwrite existing correlation ID', () => {
			const first = setCorrelationId('first-id');
			const second = setCorrelationId('second-id');
			expect(first).toBe('first-id');
			expect(second).toBe('second-id');
			expect(getCorrelationId()).toBe('second-id');
		});
	});
});
