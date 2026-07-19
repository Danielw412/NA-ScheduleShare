# ScheduleShare custom-domain cutover

Production site: `https://schedule.naclubs.net/`

Worker/API: `https://schedule-api.naclubs.net/`

## 1. Put `naclubs.net` on Cloudflare DNS

1. Add `naclubs.net` to the correct Cloudflare account.
2. At the registrar, replace the current nameservers with the two nameservers Cloudflare assigns.
3. Wait until Cloudflare marks the zone **Active**.

Do not create a wildcard `*.naclubs.net` record.

## 2. Point the ScheduleShare subdomain to GitHub Pages

In Cloudflare DNS, create:

| Type | Name | Target | Proxy status | TTL |
| --- | --- | --- | --- | --- |
| CNAME | `schedule` | `danielw412.github.io` | DNS only | Auto |

The target must not include `/NA-ScheduleShare`.

In GitHub, open **NA-ScheduleShare → Settings → Pages**:

1. Set **Custom domain** to `schedule.naclubs.net`.
2. Save it and wait for the DNS check to pass.
3. Enable **Enforce HTTPS** when GitHub makes the option available.

## 3. Update hosted Supabase Auth URLs

In Supabase, open **NA ScheduleShare → Authentication → URL Configuration**:

- Site URL: `https://schedule.naclubs.net/`
- Add redirect URL: `https://schedule.naclubs.net/`
- Keep `https://danielw412.github.io/NA-ScheduleShare/` temporarily during the transition.
- Keep localhost redirect URLs used for local development.

No database migration is required.

## 4. Deploy the Worker custom domain

After Cloudflare shows the zone as Active, run from the repository root:

```powershell
pnpm install
pnpm worker:typecheck
pnpm test:worker
pnpm worker:deploy
```

The `wrangler.toml` configuration creates the Worker custom domain `schedule-api.naclubs.net` and sets the frontend redirect target to `https://schedule.naclubs.net/`.

Do not manually create a conflicting DNS record for `schedule-api`; Wrangler/Cloudflare creates the Worker custom-domain record.

## 5. Merge and deploy the frontend

Merge the custom-domain pull request into `main`. The normal GitHub Pages workflow will build the site for `/` and will use:

- `VITE_SCHEDULE_IMPORT_API_URL=https://schedule-api.naclubs.net/api/schedule-import`
- `VITE_SCHEDULE_SHARE_BASE_URL=https://schedule-api.naclubs.net`

The Supabase URL and publishable key remain GitHub Actions secrets.

## 6. Verify

Check all of the following:

- `https://schedule.naclubs.net/` loads with no missing CSS or images.
- Google sign-in returns to `https://schedule.naclubs.net/`.
- Email/password sign-in works.
- Screenshot import succeeds.
- A generated share link starts with `https://schedule-api.naclubs.net/share/` and redirects into ScheduleShare.
- GitHub Pages shows HTTPS enforcement enabled.

After the transition is stable, the old GitHub Pages redirect URL and legacy Worker origin can be removed.
