# Application deployment

The release supports one public Node.js service: the API serves the production
web bundle and `/api/v1/*` on the same origin. This avoids putting any secret in
the frontend and removes cross-origin setup for normal browser requests.

## Generic Node host

Use Node.js 22 or newer and configure the server-only values from `.env.example`.
Then run:

```bash
npm ci
npm run build:production
npm start
```

`npm start` honors the host-provided `PORT`, binds `0.0.0.0`, serves the web
bundle at `/`, and exposes health at `/api/v1/health`.

Required protected environment values for the full demo are:

- `NEAR_SPONSOR_ACCOUNT_ID`
- `NEAR_SPONSOR_PRIVATE_KEY`
- `NEAR_RELAYER_ACCOUNT_ID`
- `NEAR_RELAYER_PRIVATE_KEY`
- `NEAR_VERIFIER_PRIVATE_KEY`

The existing `NEAR_CONTRACT_PRIVATE_KEY` is needed for deployment and automated
owner smoke tests, but not by the public application process. Do not add it to
the application host unless that host also performs controlled deployments.

## Render blueprint

[`render.yaml`](../render.yaml) contains a ready single-service blueprint. Add
the protected values in Render's secret environment UI after creating the
service. Once the HTTPS URL is known:

1. add it to the Auth0/FastAuth allowed origins and popup/callback settings;
2. optionally set `WEB_ORIGINS` to that exact origin (same-origin requests are
   also recognized automatically);
3. run a real Google and external-wallet click-through;
4. confirm `/api/v1/health`, security headers, and the complete player journey;
5. place the URL in `docs/submission.md`.

The free plan can sleep between visits; warm the service before a live judging
session or use an always-on plan.

## Host requirements

- HTTPS termination and HSTS at the platform edge;
- persistent secret environment variables, never static-site variables;
- Node.js process support (a static-only host cannot run verification/sponsor
  services);
- outbound HTTPS access to FastNEAR, Auth0/FastAuth, Google, and NEAR explorer
  resources;
- no caching of API responses or HTML unless the documented headers are
  preserved.
