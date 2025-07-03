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
		if (!this.validateEnvironment(env)) {
			return new Response('Error: N8N_BASE_URL environment variable is not set', { status: 500 });
		}

		const { workflowId, hasTestParam } = this.parseRequestUrl(request.url);
		if (!workflowId) {
			return new Response('Error: No workflow ID provided in the URL', { status: 400 });
		}

		const headers = this.prepareHeaders(request.headers, env.N8N_BASE_URL);

		const response = hasTestParam
			? await this.handleTestParamRequest(workflowId, request, headers, env)
			: await this.handleStandardRequest(workflowId, request, headers, env);

		return this.createNotCachedResponse(response);
	},

	validateEnvironment(env) {
		return !!env.N8N_BASE_URL;
	},

	parseRequestUrl(requestUrl) {
		const url = new URL(requestUrl);
		const pathParts = url.pathname.split('/').filter(part => part !== '');
		return {
			workflowId: pathParts.length > 0 ? pathParts[0] : '',
			hasTestParam: url.searchParams.has('t'),
			searchParams: url.search
		};
	},

	prepareHeaders(originalHeaders, baseUrl) {
		const headers = new Headers(originalHeaders);
		headers.set('host', new URL(baseUrl).host);
		return headers;
	},

	async handleTestParamRequest(workflowId, request, headers, env) {
		// Najpierw próbujemy endpoint webhook-test
		const testResponse = await this.makeRequest(
			`/webhook-test/${workflowId}`,
			request,
			headers,
			env
		);

		// Jeśli nie powiodło się, próbujemy standardowy endpoint
		if (testResponse.status !== 200) {
			return await this.makeRequest(
				`/webhook/${workflowId}`,
				request,
				headers,
				env
			);
		}

		return testResponse;
	},

	async handleStandardRequest(workflowId, request, headers, env) {
		const response = await this.makeRequest(
			`/webhook/${workflowId}`,
			request,
			headers,
			env
		);

		if (response.status === 404) {
			const shouldTryTestEndpoint = await this.shouldTryWebhookTest(response);
			if (shouldTryTestEndpoint) {
				return await this.makeRequest(
					`/webhook-test/${workflowId}`,
					request,
					headers,
					env
				);
			}
		}

		return response;
	},

	async makeRequest(path, originalRequest, headers, env) {
		const url = new URL(path + new URL(originalRequest.url).search, env.N8N_BASE_URL);
		const clonedRequest = originalRequest.clone();

		return await fetch(new Request(url.toString(), {
			method: clonedRequest.method,
			headers: headers,
			body: clonedRequest.body,
			redirect: 'follow'
		}));
	},

	async shouldTryWebhookTest(response) {
		try {
			const clonedResponse = response.clone();
			const responseText = await clonedResponse.text();

			// Check if the response looks like JSON before trying to parse it
			if (!responseText || !responseText.trim().startsWith('{')) {
				// Not a JSON response, no need to try webhook-test
				return false;
			}

			try {
				const responseData = JSON.parse(responseText);
				return responseData && responseData.code === 404;
			} catch (parseError) {
				// If parsing fails, it's not a valid JSON response
				// Silently handle the error without logging
				return false;
			}
		} catch (error) {
			// Silently handle any other errors without logging
			return false;
		}
	},

	createNotCachedResponse(response) {
		const newResponse = new Response(response.body, response);
		newResponse.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
		newResponse.headers.set('Pragma', 'no-cache');
		newResponse.headers.set('Expires', '0');
		return newResponse;
	}
};
