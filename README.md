# @gander-tools/n8n-workflow-proxy

A Cloudflare Worker that acts as a proxy for n8n workflows.

## Environment Variables

This project requires the following environment variable:

- `N8N_BASE_URL`: The base URL of the n8n instance to which this will be a proxy.

This variable can be set in the Cloudflare Dashboard or in unversioned local project files.

## Development

1. Clone the repository
2. Install dependencies: `npm install`
3. Create a `.dev.vars` file in the project root with the following content:
   ```
   N8N_BASE_URL=https://your-n8n-instance.com
   ```
4. Run the development server: `npm run dev`

## Deployment

1. Set the environment variables in the Cloudflare Dashboard
2. Deploy the worker: `npm run deploy`
