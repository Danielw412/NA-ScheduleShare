# Bell-schedule Google Docs sync setup

The `bell-schedule-sync` Edge Function reads two link-visible Google Docs, asks the currently active ScheduleShare Gemini model for structured calendar facts, validates every date and evidence quote, and applies only AI-managed school-day rows. Manual assignments stay locked until an administrator explicitly unlocks or clears them.

All credentials in this guide are server-side. Do not create `VITE_GOOGLE_DOCS_API_KEY`, `VITE_GEMINI_API_KEY`, or `VITE_BELL_SCHEDULE_SYNC_TOKEN` values.

## 1. Enable and restrict the Google Docs API key

1. Open the [Google Cloud API Library](https://console.cloud.google.com/apis/library) for the project used by ScheduleShare.
2. Enable **Google Docs API**. The function calls [`documents.get`](https://developers.google.com/workspace/docs/api/reference/rest/v1/documents/get) with `includeTabsContent=true`, then traverses paragraphs, tables, and child tabs.
3. Follow [Google's API-key credential setup](https://developers.google.com/workspace/guides/create-credentials) to create an API key.
4. In the key restrictions, restrict **API restrictions** to **Google Docs API**. Add application restrictions that fit the deployment environment if Google Cloud offers a usable server-side restriction for the Supabase egress path.
5. Keep both configured source documents set to **Anyone with the link can view**. An API key does not impersonate a Workspace user, so the function can read only content available anonymously to the key's project.

The seeded documents are:

- Bell schedules: `https://docs.google.com/document/d/1KJr6cJszOP_UQP2ep5GputRwdC4YDYiShc4E-z5naNE/edit`
- NASH newsletter: `https://docs.google.com/document/d/1eUkh1tDSTTzIVooFoo5JZs0pzUp6GAqdk0DIse96IJU/edit`

Both URLs remain editable in Administration → Bell schedules.

## 2. Create the scheduler token and Edge Function secrets

Generate a high-entropy token with a password manager or a cryptographic random generator. Keep one identical value for the Edge Function and Vault scheduler call.

Set the function secrets using the Supabase Dashboard or CLI:

```bash
supabase secrets set GOOGLE_DOCS_API_KEY=replace-with-restricted-key
supabase secrets set BELL_SCHEDULE_SYNC_TOKEN=replace-with-long-random-token
```

The existing `GEMINI_API_KEY` secret is reused. Supabase documents function secret management at [Environment Variables](https://supabase.com/docs/guides/functions/secrets). Never commit a secrets file.

## 3. Store the matching scheduler values in Vault

In the production Supabase SQL editor, create the two Vault values used by the fixed five-minute cron check:

```sql
select vault.create_secret(
  'https://YOUR-PROJECT-REF.supabase.co',
  'bell_schedule_project_url'
);

select vault.create_secret(
  'THE-SAME-LONG-RANDOM-TOKEN',
  'bell_schedule_sync_token'
);
```

If either name already exists, update that secret in Vault rather than creating a duplicate. The scheduler follows Supabase's supported [`pg_cron` + `pg_net` pattern](https://supabase.com/docs/guides/functions/schedule-functions). The token is sent only in the `x-bell-schedule-sync-token` header.

## 4. Apply, deploy, and verify

Apply the database migration, then deploy the function:

```bash
supabase db push
supabase functions deploy bell-schedule-sync
```

The function has `verify_jwt=false` in `supabase/config.toml` because it supports two explicit authorization paths:

- Admin requests validate the bearer user and call the database's admin check.
- Cron requests require the private scheduler token.

Check that the five-minute job exists:

```sql
select jobname, schedule, active
from cron.job
where jobname = 'bell-schedule-sync-due-check';
```

Then open Administration → **Bell schedules**:

1. Confirm both source URLs.
2. Click **Preview now**. A successful preview proves both Docs are readable, Gemini is configured, and the structured extraction passes validation. It does not change calendar dates.
3. Expand the newest run and inspect the source section, evidence, raw Gemini JSON, validated extraction, applied dates, and skipped manual overrides.
4. Click **Sync now** once the output is correct.
5. Set the daily Eastern time (default `6:00 AM`), enable daily detection, and save.

The database claims a scheduled date atomically, so repeated five-minute checks cannot start the same daily run twice. A successful source-section hash is also idempotent: an unchanged newsletter is recorded as skipped rather than reapplied.

## Operational safety

- The detector reads only the newest two `Weekly Schedule` sections and accepts dates only from 14 days ago through 35 days ahead within the configured school year.
- Every evidence quote must occur in the selected source text.
- The exact phrase `activity period` maps to Activity Bell Schedule #1. `Activities Fair` or `Student Activities Fair` alone is forced back to Regular.
- Gemini uses temperature `0`, structured JSON, `HIGH` thinking, and `includeThoughts=false`; reasoning thoughts are neither returned nor stored.
- Manual calendar rows are locked and reported as skipped. **Unlock for AI** converts selected rows to AI-managed status; **Clear overrides** restores the normal Regular weekday fallback.
- The newest 100 sync runs are retained. New-school-year reset clears date assignments and sync history while preserving definitions, edited bell times, source URLs, and automation configuration.
