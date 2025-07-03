import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import worker from '../src';

describe('n8n workflow proxy', () => {
	beforeEach(() => {
		// Set up environment variables for tests
		env.N8N_BASE_URL = 'https://n8n.example.com';
	});

	afterEach(() => {
		// Reset mocks after each test
		vi.resetAllMocks();
	});

	it('extracts workflow ID and forwards requests to webhook endpoint', async () => {
		const request = new Request('http://example.com/123?param=value');
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

	it('retries with webhook-test endpoint on 404 with code 404', async () => {
		const request = new Request('http://example.com/123');
		const ctx = createExecutionContext();

		// Mock the fetch function to return a 404 with code 404 on first call
		// and a success response on second call
		global.fetch = vi.fn()
			.mockResolvedValueOnce(new Response(JSON.stringify({ code: 404 }), { status: 404 }))
			.mockResolvedValueOnce(new Response('Mocked webhook-test response'));

		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		// Check that fetch was called twice with the correct URLs
		expect(global.fetch).toHaveBeenCalledTimes(2);
		expect(global.fetch).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				url: 'https://n8n.example.com/webhook/123'
			})
		);
		expect(global.fetch).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				url: 'https://n8n.example.com/webhook-test/123'
			})
		);

		expect(await response.text()).toBe('Mocked webhook-test response');
	});

	it('does not retry if 404 response is not JSON with code 404', async () => {
		const request = new Request('http://example.com/123');
		const ctx = createExecutionContext();

		// Mock the fetch function to return a 404 without the expected JSON structure
		global.fetch = vi.fn()
			.mockResolvedValueOnce(new Response('Not found', { status: 404 }));

		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		// Check that fetch was called only once
		expect(global.fetch).toHaveBeenCalledTimes(1);
		expect(global.fetch).toHaveBeenCalledWith(
			expect.objectContaining({
				url: 'https://n8n.example.com/webhook/123'
			})
		);

		expect(response.status).toBe(404);
	});

	it('tries webhook-test endpoint first when t parameter is present', async () => {
		const request = new Request('http://example.com/123?t');
		const ctx = createExecutionContext();

		// Mock the fetch function to return success on first call
		global.fetch = vi.fn()
			.mockResolvedValueOnce(new Response('Mocked webhook-test response', { status: 200 }));

		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		// Check that fetch was called once with the webhook-test URL
		expect(global.fetch).toHaveBeenCalledTimes(1);
		expect(global.fetch).toHaveBeenCalledWith(
			expect.objectContaining({
				url: 'https://n8n.example.com/webhook-test/123?t'
			})
		);

		expect(await response.text()).toBe('Mocked webhook-test response');
	});

	it('tries webhook endpoint after webhook-test when t parameter is present and webhook-test fails', async () => {
		const request = new Request('http://example.com/123?t&param=value');
		const ctx = createExecutionContext();

		// Mock the fetch function to return failure on first call and success on second call
		global.fetch = vi.fn()
			.mockResolvedValueOnce(new Response('Not found', { status: 404 }))
			.mockResolvedValueOnce(new Response('Mocked webhook response', { status: 200 }));

		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		// Check that fetch was called twice with the correct URLs
		expect(global.fetch).toHaveBeenCalledTimes(2);
		expect(global.fetch).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				url: 'https://n8n.example.com/webhook-test/123?t&param=value'
			})
		);
		expect(global.fetch).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				url: 'https://n8n.example.com/webhook/123?t&param=value'
			})
		);

		expect(await response.text()).toBe('Mocked webhook response');
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

});
