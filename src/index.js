/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

export default {
	async fetch(request, env, ctx) {
		// Check if required environment variables are set
		if (!env.N8N_BASE_URL) {
			return new Response('Error: N8N_BASE_URL environment variable is not set', { status: 500 });
		}

		// Create a new URL object from the original request URL
		const url = new URL(request.url);

		// Extract the workflow ID from the URL path
		// The path is expected to be in the format /xyz where xyz is the workflow ID
		const pathParts = url.pathname.split('/').filter(part => part !== '');
		const workflowId = pathParts.length > 0 ? pathParts[0] : '';

		if (!workflowId) {
			return new Response('Error: No workflow ID provided in the URL', { status: 400 });
		}

		// Clone the request headers
		const headers = new Headers(request.headers);

		// Set the host header to the n8n instance host
		headers.set('host', new URL(env.N8N_BASE_URL).host);

		// Create a new request to the n8n instance with /webhook/{workflowId} path
		const n8nUrl = new URL(`/webhook/${workflowId}${url.search}`, env.N8N_BASE_URL);

		const n8nRequest = new Request(n8nUrl.toString(), {
			method: request.method,
			headers: headers,
			body: request.body,
			redirect: 'follow',
		});

		// Fetch the response from the n8n instance
		let response = await fetch(n8nRequest);

		// If the response is a 404, try with /webhook-test/{workflowId}
		if (response.status === 404) {
			// Clone the response so we can read its body without consuming it
			const clonedResponse = response.clone();

			try {
				// Try to parse the response as JSON
				const responseData = await clonedResponse.json();

				// Check if it's a 404 with the expected code
				if (responseData && responseData.code === 404) {
					// Create a new URL for the webhook-test endpoint
					const testUrl = new URL(`/webhook-test/${workflowId}${url.search}`, env.N8N_BASE_URL);

					// We need to clone the original request to get a fresh body stream
					const originalRequest = request.clone();

					// Create a new request to the webhook-test endpoint
					const testRequest = new Request(testUrl.toString(), {
						method: originalRequest.method,
						headers: headers,
						body: originalRequest.body,
						redirect: 'follow',
					});

					// Fetch the response from the webhook-test endpoint
					response = await fetch(testRequest);
				}
			} catch (error) {
				// If parsing the response fails (e.g., it's not JSON), continue with the original response
				console.error('Error parsing response:', error);
			}
		}

		// Return the response
		return response;
	},
};
