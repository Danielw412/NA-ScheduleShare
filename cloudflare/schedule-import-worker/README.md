# Schedule share and legacy import Worker

This Worker serves private schedule-share previews and retains the previous Cloudflare-AI import endpoint for backward compatibility. The website's active screenshot importer now invokes the Supabase `schedule-import` Edge Function and Gemini directly; new importer behavior belongs there.

## Configure Cloudflare

1. From the repository root, install dependencies with `pnpm install`.
2. Create two KV namespaces:

   ```bash
   pnpm exec wrangler kv namespace create RATE_LIMIT --config cloudflare/schedule-import-worker/wrangler.toml
   pnpm exec wrangler kv namespace create RATE_LIMIT --preview --config cloudflare/schedule-import-worker/wrangler.toml
   ```

3. Replace the all-zero production ID and all-one preview ID in `wrangler.toml` with the returned IDs.
4. Copy `.dev.vars.example` to `.dev.vars` for local Worker development. Use the Supabase project URL and its publishable key; never use the service-role key.
5. Set production Worker secrets:

   ```bash
   pnpm exec wrangler secret put SUPABASE_URL --config cloudflare/schedule-import-worker/wrangler.toml
   pnpm exec wrangler secret put SUPABASE_PUBLISHABLE_KEY --config cloudflare/schedule-import-worker/wrangler.toml
   ```

6. Deploy with `pnpm worker:deploy`. The deployed routes are `POST /api/schedule-import`, `GET /share/:token`, and `GET /share/:token/image.png`.

Moondream is invoked through the configured Workers AI binding. Its current model schema requires `image` to be a public HTTPS URL or base64 data URI, so the Worker creates one in request memory from the uploaded bytes. No Cloudflare AI API token is needed by the Worker.

The Worker permits only the GitHub Pages origin and the built-in local Vite/preview origins. The production entry is origin-only (`https://danielw412.github.io`), because browsers send the `Origin` header without the Pages path.

## Local development

Run Supabase and Vite in separate terminals, then start the Worker:

```bash
pnpm supabase:start
pnpm worker:dev
pnpm dev
```

Set the following in the frontend `.env.local`:

```dotenv
VITE_SCHEDULE_SHARE_BASE_URL=http://127.0.0.1:8787
```

The browser forwards only the current Supabase access token and image files. The Worker verifies the token with Supabase Auth and derives the user ID from that response. Catalogue and class reads use the same token, so existing RLS and suspension enforcement remain in effect.

## Validation and deployment

```bash
pnpm worker:typecheck
pnpm test:worker
pnpm worker:diagnose
pnpm worker:deploy
```

`pnpm worker:diagnose` starts a local diagnostic Worker with a remote Workers AI binding and sends the small public club-logo PNG. It never uses a student schedule. Its JSON result distinguishes `configuration`, `transport`, `model`, and `quota` failures. The diagnostic uses the production image converter, transcription-only prompt, 8,000-token setting, and `query` task, so it exercises the same model boundary without exposing the authenticated schedule-import endpoint.

The manually triggered `deploy-worker.yml` workflow expects these GitHub production-environment secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`

After the Worker is deployed, configure `VITE_SCHEDULE_SHARE_BASE_URL` with its origin, such as `https://na-scheduleshare-import.YOUR_SUBDOMAIN.workers.dev`. It is used only for schedule-share links and previews.

## Privacy and operational behavior

- Screenshots are held only in request memory and sent as schema-required data URIs through the Workers AI binding; neither the Worker nor KV stores image bytes.
- No catalogue names or IDs are sent to the model. Moondream returns only visible transcription fields, then the Worker fuzzy-matches that text against active Supabase catalogue rows and keeps ambiguous names unresolved.
- KV stores a per-user fixed-window request counter only.
- Requests accept one to three PNG, JPEG, or WebP images, each no larger than 10 MB.
- Model output is untrusted input and must pass an exact runtime schema before it is used.
- The Worker returns proposals only. The frontend rechecks duplicates and saves through the existing authorized class/enrollment functions after explicit confirmation.
- If the period column is missing, the Worker returns HTTP 422 and the frontend keeps the selected previews available for replacement.
- Share pages fetch only the bounded anonymous preview RPC. Invalid, disabled, suspended, Classmates, and Private links return the same generic no-data HTML and image response.
- Share HTML and 1200 × 630 PNG responses use `Cache-Control: no-store`, so privacy changes take effect on the next request.
