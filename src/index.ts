class RequestError extends Error {
	status: number;
	response: Response;

	constructor(message: string, status: number, response: Response) {
		super(message);
		this.name = 'RequestError';
		this.status = status;
		this.response = response;
	}
}

// Define webhook types
const WEBHOOK_TYPES = {
	TEST: 'webhook-test',
	PRODUCTION: 'webhook'
} as const;

// Define option types for URL routing
const OPTION_TYPES = {
	TEST_THEN_PROD: 'tp',
	PROD_THEN_TEST: 'pt',
	TEST_ONLY: 't',
	PROD_ONLY: 'p'
} as const;

// Define webhook strategy configurations
type WebhookStrategy = {
	primary: boolean;
	fallback: boolean | null;
};

const WEBHOOK_STRATEGIES: Record<string, WebhookStrategy> = {
	[OPTION_TYPES.TEST_THEN_PROD]: {
		primary: true,
		fallback: false
	},
	[OPTION_TYPES.PROD_THEN_TEST]: {
		primary: false,
		fallback: true
	},
	[OPTION_TYPES.TEST_ONLY]: {
		primary: true,
		fallback: null
	},
	[OPTION_TYPES.PROD_ONLY]: {
		primary: false,
		fallback: null
	}
};

// Define return type for parseRequestUrl
interface ParsedUrl {
	workflowId: string;
	option: string;
	searchParams: string;
}

// Define the worker interface that extends ExportedHandler
interface WorkerHandler extends ExportedHandler<Env> {
	executeWebhookStrategy(
		workflowId: string,
		request: Request,
		headers: Headers,
		env: Env,
		option: string
	): Promise<Response>;
	validateEnvironment(env: Env): boolean;
	parseRequestUrl(requestUrl: string): ParsedUrl;
	prepareHeaders(originalHeaders: Headers, baseUrl: string): Headers;
	handleRequest(
		workflowId: string,
		request: Request,
		headers: Headers,
		env: Env,
		isTestHook: boolean
	): Promise<Response>;
	makeRequest(
		path: string,
		originalRequest: Request,
		headers: Headers,
		env: Env
	): Promise<Response>;
	createNotCachedResponse(response: Response): Response;
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		if (!this.validateEnvironment(env)) {
			return new Response('Error: N8N_BASE_URL environment variable is not set', { status: 500 });
		}

		const { workflowId, option } = this.parseRequestUrl(request.url);
		if (!workflowId) {
			return new Response('Error: No workflow ID provided in the URL', { status: 400 });
		}

		const headers = this.prepareHeaders(request.headers, env.N8N_BASE_URL);
		const response = await this.executeWebhookStrategy(workflowId, request, headers, env, option);

		return this.createNotCachedResponse(response);
	},

	async executeWebhookStrategy(
		workflowId: string,
		request: Request,
		headers: Headers,
		env: Env,
		option: string
	): Promise<Response> {
		const strategy = WEBHOOK_STRATEGIES[option] || WEBHOOK_STRATEGIES[OPTION_TYPES.PROD_ONLY];

		try {
			return await this.handleRequest(workflowId, request, headers, env, strategy.primary);
		} catch (error) {
			if (strategy.fallback !== null) {
				return await this.handleRequest(workflowId, request, headers, env, strategy.fallback);
			}
			throw error;
		}
	},

	validateEnvironment(env: Env): boolean {
		return !!env.N8N_BASE_URL;
	},

	parseRequestUrl(requestUrl: string): ParsedUrl {
		const url = new URL(requestUrl);
		const [option, workflowId] = url.pathname.split('/').filter(Boolean);

		return {
			workflowId: workflowId || '',
			option: option || OPTION_TYPES.PROD_ONLY,
			searchParams: url.search
		};
	},

	prepareHeaders(originalHeaders: Headers, baseUrl: string): Headers {
		const headers = new Headers(originalHeaders);
		headers.set('host', new URL(baseUrl).host);
		return headers;
	},

	async handleRequest(
		workflowId: string,
		request: Request,
		headers: Headers,
		env: Env,
		isTestHook: boolean
	): Promise<Response> {
		const webhookType = isTestHook ? WEBHOOK_TYPES.TEST : WEBHOOK_TYPES.PRODUCTION;
		const path = `/${webhookType}/${workflowId}`;

		const response = await this.makeRequest(path, request, headers, env);

		if (response.status !== 200) {
			throw new RequestError(
				`Request failed with status ${response.status}`,
				response.status,
				response
			);
		}

		return response;
	},

	async makeRequest(
		path: string,
		originalRequest: Request,
		headers: Headers,
		env: Env
	): Promise<Response> {
		const url = new URL(path + new URL(originalRequest.url).search, env.N8N_BASE_URL);
		const clonedRequest = originalRequest.clone();

		return await fetch(new Request(url.toString(), {
			method: clonedRequest.method,
			headers: headers,
			body: clonedRequest.body,
			redirect: 'follow'
		}));
	},

	createNotCachedResponse(response: Response): Response {
		const newResponse = new Response(response.body, response);
		newResponse.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
		newResponse.headers.set('Pragma', 'no-cache');
		newResponse.headers.set('Expires', '0');
		return newResponse;
	}
} satisfies WorkerHandler;
