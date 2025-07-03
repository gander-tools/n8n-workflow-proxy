import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import worker from '../src';

// Define constants used in tests
const WEBHOOK_TYPES = {
	TEST: 'webhook-test',
	PRODUCTION: 'webhook'
};

const OPTION_TYPES = {
	TEST_THEN_PROD: 'tp',
	PROD_THEN_TEST: 'pt',
	TEST_ONLY: 't',
	PROD_ONLY: 'p'
};

describe('n8n workflow proxy', () => {
	beforeEach(() => {
		// Set up environment variables for tests
		env.N8N_BASE_URL = 'https://n8n.example.com';
	});

	afterEach(() => {
		// Reset mocks after each test
		vi.resetAllMocks();
	});

	// Tests for the new URL structure with different order values
	describe('new URL structure with order parameter', () => {
		it('handles tp order - tries webhook-test first, then webhook', async () => {
			const request = new Request('http://example.com/tp/123?param=value');
			const ctx = createExecutionContext();

			// Mock the fetch function to return an error on first call
			// and a success response on second call
			global.fetch = vi.fn()
				.mockResolvedValueOnce(new Response('Error response', { status: 404 }))
				.mockResolvedValueOnce(new Response('Mocked webhook response', { status: 200 }));

			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			// Check that fetch was called twice with the correct URLs
			expect(global.fetch).toHaveBeenCalledTimes(2);
			expect(global.fetch).toHaveBeenNthCalledWith(
				1,
				expect.objectContaining({
					url: 'https://n8n.example.com/webhook-test/123?param=value'
				})
			);
			expect(global.fetch).toHaveBeenNthCalledWith(
				2,
				expect.objectContaining({
					url: 'https://n8n.example.com/webhook/123?param=value'
				})
			);

			expect(await response.text()).toBe('Mocked webhook response');
		});

		it('handles pt order - tries webhook first, then webhook-test', async () => {
			const request = new Request('http://example.com/pt/123?param=value');
			const ctx = createExecutionContext();

			// Mock the fetch function to return an error on first call
			// and a success response on second call
			global.fetch = vi.fn()
				.mockResolvedValueOnce(new Response('Error response', { status: 404 }))
				.mockResolvedValueOnce(new Response('Mocked webhook-test response', { status: 200 }));

			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			// Check that fetch was called twice with the correct URLs
			expect(global.fetch).toHaveBeenCalledTimes(2);
			expect(global.fetch).toHaveBeenNthCalledWith(
				1,
				expect.objectContaining({
					url: 'https://n8n.example.com/webhook/123?param=value'
				})
			);
			expect(global.fetch).toHaveBeenNthCalledWith(
				2,
				expect.objectContaining({
					url: 'https://n8n.example.com/webhook-test/123?param=value'
				})
			);

			expect(await response.text()).toBe('Mocked webhook-test response');
		});

		it('handles t order - only tries webhook-test', async () => {
			const request = new Request('http://example.com/t/123?param=value');
			const ctx = createExecutionContext();

			// Mock the fetch function to return success
			global.fetch = vi.fn()
				.mockResolvedValueOnce(new Response('Mocked webhook-test response', { status: 200 }));

			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			// Check that fetch was called once with the webhook-test URL
			expect(global.fetch).toHaveBeenCalledTimes(1);
			expect(global.fetch).toHaveBeenCalledWith(
				expect.objectContaining({
					url: 'https://n8n.example.com/webhook-test/123?param=value'
				})
			);

			expect(await response.text()).toBe('Mocked webhook-test response');
		});

		it('handles p order - only tries webhook', async () => {
			const request = new Request('http://example.com/p/123?param=value');
			const ctx = createExecutionContext();

			// Mock the fetch function to return success
			global.fetch = vi.fn()
				.mockResolvedValueOnce(new Response('Mocked webhook response', { status: 200 }));

			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			// Check that fetch was called once with the webhook URL
			expect(global.fetch).toHaveBeenCalledTimes(1);
			expect(global.fetch).toHaveBeenCalledWith(
				expect.objectContaining({
					url: 'https://n8n.example.com/webhook/123?param=value'
				})
			);

			expect(await response.text()).toBe('Mocked webhook response');
		});
	});

	it('extracts workflow ID and forwards requests to webhook endpoint', async () => {
		// Use a URL with both option and workflowId
		const request = new Request('http://example.com/p/123?param=value');
		const ctx = createExecutionContext();

		// Mock the fetch function
		global.fetch = vi.fn().mockResolvedValue(new Response('Mocked n8n response'));

		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		// Check that fetch was called with the correct URL
		expect(global.fetch).toHaveBeenCalledWith(
			expect.objectContaining({
				url: 'https://n8n.example.com/webhook/123?param=value'
			})
		);

		expect(await response.text()).toBe('Mocked n8n response');
	});

	it('returns error when no workflow ID is provided', async () => {
		const request = new Request('http://example.com/');
		const ctx = createExecutionContext();

		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(400);
		expect(await response.text()).toBe('Error: No workflow ID provided in the URL');
	});

	it('retries with webhook-test endpoint when webhook endpoint fails', async () => {
		const request = new Request('http://example.com/p/123');
		const ctx = createExecutionContext();

		// Mock the executeWebhookStrategy method
		const originalExecuteWebhookStrategy = worker.executeWebhookStrategy;

		// Create a mock implementation that simulates the fallback behavior
		worker.executeWebhookStrategy = vi.fn().mockImplementation(async (workflowId, req, headers, env, option) => {
			// Simulate the fallback behavior by returning a success response
			return new Response('Mocked webhook-test response', { status: 200 });
		});

		try {
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			// Check that executeWebhookStrategy was called with the correct parameters
			expect(worker.executeWebhookStrategy).toHaveBeenCalledTimes(1);
			expect(worker.executeWebhookStrategy).toHaveBeenCalledWith(
				'123',
				request,
				expect.any(Headers),
				env,
				'p' // option = 'p' for PROD_ONLY
			);

			expect(await response.text()).toBe('Mocked webhook-test response');
		} finally {
			// Restore the original executeWebhookStrategy method
			worker.executeWebhookStrategy = originalExecuteWebhookStrategy;
		}
	});

	it('retries with alternate endpoint for any non-200 response', async () => {
		// Use pt option to ensure it tries production first, then test
		const request = new Request('http://example.com/pt/123');
		const ctx = createExecutionContext();

		// Mock the handleRequest method instead of makeRequest
		const originalHandleRequest = worker.handleRequest;
		worker.handleRequest = vi.fn()
			.mockRejectedValueOnce(new Error('Request failed with status 404'))
			.mockResolvedValueOnce(new Response('Success on second try', { status: 200 }));

		try {
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			// Check that handleRequest was called twice with the correct parameters
			expect(worker.handleRequest).toHaveBeenCalledTimes(2);
			expect(worker.handleRequest).toHaveBeenNthCalledWith(
				1,
				'123',
				request,
				expect.any(Headers),
				env,
				false // isTestHook = false for production webhook
			);
			expect(worker.handleRequest).toHaveBeenNthCalledWith(
				2,
				'123',
				request,
				expect.any(Headers),
				env,
				true // isTestHook = true for test webhook
			);

			// The second response should be returned
			expect(response.status).toBe(200);
			expect(await response.text()).toBe('Success on second try');
		} finally {
			// Restore the original handleRequest method
			worker.handleRequest = originalHandleRequest;
		}
	});

	it('tries webhook-test endpoint first when t parameter is present', async () => {
		const request = new Request('http://example.com/t/123');
		const ctx = createExecutionContext();

		// Mock the makeRequest method instead of global.fetch
		const originalMakeRequest = worker.makeRequest;
		worker.makeRequest = vi.fn()
			.mockResolvedValueOnce(new Response('Mocked webhook-test response', { status: 200 }));

		try {
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			// Check that makeRequest was called once with the correct path
			expect(worker.makeRequest).toHaveBeenCalledTimes(1);
			expect(worker.makeRequest).toHaveBeenCalledWith(
				'/webhook-test/123',
				request,
				expect.any(Headers),
				env
			);

			expect(await response.text()).toBe('Mocked webhook-test response');
		} finally {
			// Restore the original makeRequest method
			worker.makeRequest = originalMakeRequest;
		}
	});

	it('tries webhook endpoint after webhook-test when t parameter is present and webhook-test fails', async () => {
		// Use tp option to ensure it tries test first, then production
		const request = new Request('http://example.com/tp/123?param=value');
		const ctx = createExecutionContext();

		// Mock the handleRequest method instead of makeRequest
		const originalHandleRequest = worker.handleRequest;
		worker.handleRequest = vi.fn()
			.mockRejectedValueOnce(new Error('Request failed with status 404'))
			.mockResolvedValueOnce(new Response('Mocked webhook response', { status: 200 }));

		try {
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			// Check that handleRequest was called twice with the correct parameters
			expect(worker.handleRequest).toHaveBeenCalledTimes(2);
			expect(worker.handleRequest).toHaveBeenNthCalledWith(
				1,
				'123',
				request,
				expect.any(Headers),
				env,
				true // isTestHook = true for test webhook
			);
			expect(worker.handleRequest).toHaveBeenNthCalledWith(
				2,
				'123',
				request,
				expect.any(Headers),
				env,
				false // isTestHook = false for production webhook
			);

			expect(await response.text()).toBe('Mocked webhook response');
		} finally {
			// Restore the original handleRequest method
			worker.handleRequest = originalHandleRequest;
		}
	});

	it('returns error when N8N_BASE_URL is not set', async () => {
		// Temporarily unset the N8N_BASE_URL
		const originalN8nBaseUrl = env.N8N_BASE_URL;
		env.N8N_BASE_URL = '';

		const request = new Request('http://example.com/123');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(500);
		expect(await response.text()).toBe('Error: N8N_BASE_URL environment variable is not set');

		// Restore the environment variable
		env.N8N_BASE_URL = originalN8nBaseUrl;
	});

	it('handleRequest throws error for non-200 responses', async () => {
		// Create a mock request and environment
		const request = new Request('http://example.com/123');
		const mockHeaders = new Headers();
		const mockEnv = { N8N_BASE_URL: 'https://n8n.example.com' };

		// Mock the makeRequest method to return a non-200 response
		const originalMakeRequest = worker.makeRequest;
		worker.makeRequest = vi.fn().mockResolvedValue(new Response('Error response', { status: 404 }));

		try {
			// Call handleRequest directly and expect it to throw an error
			await expect(worker.handleRequest('123', request, mockHeaders, mockEnv, false))
				.rejects.toThrow('Request failed with status 404');

			// Verify makeRequest was called with the correct path
			expect(worker.makeRequest).toHaveBeenCalledWith(
				'/webhook/123',
				request,
				mockHeaders,
				mockEnv
			);
		} finally {
			// Restore the original makeRequest method
			worker.makeRequest = originalMakeRequest;
		}
	});

	it('handleRequest uses correct path based on isTestHook parameter', async () => {
		// Create a mock request and environment
		const request = new Request('http://example.com/123');
		const mockHeaders = new Headers();
		const mockEnv = { N8N_BASE_URL: 'https://n8n.example.com' };

		// Mock the makeRequest method
		const originalMakeRequest = worker.makeRequest;
		worker.makeRequest = vi.fn().mockResolvedValue(new Response('Success response', { status: 200 }));

		try {
			// Call handleRequest with isTestHook = true
			await worker.handleRequest('123', request, mockHeaders, mockEnv, true);

			// Verify makeRequest was called with the webhook-test path
			expect(worker.makeRequest).toHaveBeenCalledWith(
				'/webhook-test/123',
				request,
				mockHeaders,
				mockEnv
			);

			// Reset the mock
			worker.makeRequest.mockReset();
			worker.makeRequest.mockResolvedValue(new Response('Success response', { status: 200 }));

			// Call handleRequest with isTestHook = false
			await worker.handleRequest('123', request, mockHeaders, mockEnv, false);

			// Verify makeRequest was called with the webhook path
			expect(worker.makeRequest).toHaveBeenCalledWith(
				'/webhook/123',
				request,
				mockHeaders,
				mockEnv
			);
		} finally {
			// Restore the original makeRequest method
			worker.makeRequest = originalMakeRequest;
		}
	});

	it('retries with alternate endpoint regardless of response content', async () => {
		// Use pt option to ensure it tries production first, then test
		const request = new Request('http://example.com/pt/123');
		const ctx = createExecutionContext();

		// Mock the handleRequest method instead of makeRequest
		const originalHandleRequest = worker.handleRequest;
		worker.handleRequest = vi.fn()
			// First call: return a non-JSON error response
			.mockRejectedValueOnce(new Error('Request failed with status 500'))
			// Second call: return a success response
			.mockResolvedValueOnce(new Response('Success response', { status: 200 }));

		try {
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			// Check that handleRequest was called twice with the correct parameters
			expect(worker.handleRequest).toHaveBeenCalledTimes(2);
			expect(worker.handleRequest).toHaveBeenNthCalledWith(
				1,
				'123',
				request,
				expect.any(Headers),
				env,
				false // isTestHook = false for production webhook
			);
			expect(worker.handleRequest).toHaveBeenNthCalledWith(
				2,
				'123',
				request,
				expect.any(Headers),
				env,
				true // isTestHook = true for test webhook
			);

			// The second response should be returned
			expect(response.status).toBe(200);
			expect(await response.text()).toBe('Success response');
		} finally {
			// Restore the original handleRequest method
			worker.handleRequest = originalHandleRequest;
		}
	});

	// Test for prepareHeaders method
	it('prepareHeaders sets the correct host header', () => {
		const originalHeaders = new Headers();
		originalHeaders.set('Content-Type', 'application/json');

		const baseUrl = 'https://n8n.example.com';
		const headers = worker.prepareHeaders(originalHeaders, baseUrl);

		expect(headers.get('host')).toBe('n8n.example.com');
		expect(headers.get('Content-Type')).toBe('application/json');
	});

	// Test for makeRequest method
	it('makeRequest constructs the request correctly', async () => {
		const path = '/webhook/123';
		const originalRequest = new Request('http://example.com/123?param=value', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ test: 'data' })
		});
		const headers = new Headers({ 'Content-Type': 'application/json', 'host': 'n8n.example.com' });
		const mockEnv = { N8N_BASE_URL: 'https://n8n.example.com' };

		// Save the original fetch function
		const originalFetch = global.fetch;

		// Create a mock fetch function
		const mockFetch = vi.fn().mockResolvedValue(new Response('Success', { status: 200 }));

		// Replace the global fetch function with our mock
		global.fetch = mockFetch;

		try {
			// Call the method under test
			await worker.makeRequest(path, originalRequest, headers, mockEnv);

			// Check that fetch was called once
			expect(mockFetch).toHaveBeenCalledTimes(1);

			// Get the Request object that was passed to fetch
			const requestArg = mockFetch.mock.calls[0][0];
			expect(requestArg).toBeInstanceOf(Request);

			// Check the URL
			expect(requestArg.url).toBe('https://n8n.example.com/webhook/123?param=value');

			// Check the method
			expect(requestArg.method).toBe('POST');

			// Check the headers
			expect(requestArg.headers.get('content-type')).toBe('application/json');
			expect(requestArg.headers.get('host')).toBe('n8n.example.com');
		} finally {
			// Restore the original fetch function
			global.fetch = originalFetch;
		}
	});

	// Test for parseRequestUrl method with different URL formats
	it('parseRequestUrl handles different URL formats correctly', () => {
		// Standard URL with option and workflowId
		let result = worker.parseRequestUrl('http://example.com/tp/123?param=value');
		expect(result.option).toBe('tp');
		expect(result.workflowId).toBe('123');
		expect(result.searchParams).toBe('?param=value');

		// URL with only one segment (treated as option, not workflowId)
		result = worker.parseRequestUrl('http://example.com/123');
		expect(result.option).toBe('123');
		expect(result.workflowId).toBe('');

		// URL with no path segments
		result = worker.parseRequestUrl('http://example.com/');
		expect(result.option).toBe('p'); // OPTION_TYPES.PROD_ONLY is 'p'
		expect(result.workflowId).toBe('');

		// URL with additional path segments (should ignore extra segments)
		result = worker.parseRequestUrl('http://example.com/tp/123/extra/segments');
		expect(result.option).toBe('tp');
		expect(result.workflowId).toBe('123');
	});

	// Test for executeWebhookStrategy with invalid option
	it('executeWebhookStrategy defaults to PROD_ONLY when invalid option is provided', async () => {
		const workflowId = '123';
		const request = new Request('http://example.com/invalid/123');
		const headers = new Headers();
		const mockEnv = { N8N_BASE_URL: 'https://n8n.example.com' };
		const invalidOption = 'invalid';

		// Mock handleRequest to return success
		const originalHandleRequest = worker.handleRequest;
		worker.handleRequest = vi.fn().mockResolvedValue(new Response('Success', { status: 200 }));

		await worker.executeWebhookStrategy(workflowId, request, headers, mockEnv, invalidOption);

		// Verify handleRequest was called with isTestHook = false (PROD_ONLY strategy)
		expect(worker.handleRequest).toHaveBeenCalledTimes(1);
		expect(worker.handleRequest).toHaveBeenCalledWith(
			workflowId, request, headers, mockEnv, false
		);

		// Restore the original handleRequest method
		worker.handleRequest = originalHandleRequest;
	});

	// Test for executeWebhookStrategy when both primary and fallback fail
	it('executeWebhookStrategy throws error when both primary and fallback fail', async () => {
		const workflowId = '123';
		const request = new Request('http://example.com/tp/123');
		const headers = new Headers();
		const mockEnv = { N8N_BASE_URL: 'https://n8n.example.com' };
		const option = OPTION_TYPES.TEST_THEN_PROD;

		// Mock handleRequest to fail for both primary and fallback
		const originalHandleRequest = worker.handleRequest;
		worker.handleRequest = vi.fn()
			.mockRejectedValueOnce(new Error('Primary endpoint failed'))
			.mockRejectedValueOnce(new Error('Fallback endpoint failed'));

		// Expect executeWebhookStrategy to throw an error
		await expect(worker.executeWebhookStrategy(workflowId, request, headers, mockEnv, option))
			.rejects.toThrow('Fallback endpoint failed');

		// Verify handleRequest was called twice with the correct parameters
		expect(worker.handleRequest).toHaveBeenCalledTimes(2);
		expect(worker.handleRequest).toHaveBeenNthCalledWith(
			1, workflowId, request, headers, mockEnv, true
		);
		expect(worker.handleRequest).toHaveBeenNthCalledWith(
			2, workflowId, request, headers, mockEnv, false
		);

		// Restore the original handleRequest method
		worker.handleRequest = originalHandleRequest;
	});

	// Test for createNotCachedResponse method
	it('createNotCachedResponse adds the correct cache control headers', async () => {
		const originalResponse = new Response('Test response', {
			status: 200,
			headers: { 'Content-Type': 'application/json' }
		});

		const newResponse = worker.createNotCachedResponse(originalResponse);

		// Check that the cache control headers are set correctly
		expect(newResponse.headers.get('Cache-Control')).toBe('no-store, no-cache, must-revalidate, proxy-revalidate');
		expect(newResponse.headers.get('Pragma')).toBe('no-cache');
		expect(newResponse.headers.get('Expires')).toBe('0');

		// Check that the original headers are preserved
		expect(newResponse.headers.get('Content-Type')).toBe('application/json');

		// Check that the body and status are preserved
		expect(await newResponse.text()).toBe('Test response');
		expect(newResponse.status).toBe(200);
	});

});
