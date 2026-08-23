# Bell-schedule Google Docs sync setup

The `bell-schedule-sync` Edge Function reads the anonymous plain-text export of the link-visible NASH newsletter, asks the currently active ScheduleShare Gemini model for structured calendar facts, validates every date and evidence quote, and applies only AI-managed school-day rows. Bell times come from the database definitions managed in Administration, so the detector never reads the bell-schedule Google Doc. Manual assignments stay locked until an administrator explicitly unlocks or clears them.

Google Docs authentication is not used. The remaining credentials in this guide are server-side; do not create `VITE_GEMINI_API_KEY` or `VITE_BELL_SCHEDULE_SYNC_TOKEN` values.

## 1. Make the source Docs publicly exportable

1. Open the newsletter's **Share** dialog.
2. Set **General access** to **Anyone with the link** and the role to **Viewer**.
3. Confirm the document can be opened in a private/incognito browser window without signing in.

The function extracts the document ID from the configured URL and fetches Google's public `https://docs.google.com/document/d/DOCUMENT_ID/export?format=txt` endpoint. It sends no Google API key, OAuth token, cookie, or authorization header. Keep sensitive information out of these public documents.

The seeded source is:

- NASH newsletter: `https://docs.google.com/document/d/1eUkh1tDSTTzIVooFoo5JZs0pzUp6GAqdk0DIse96IJU/edit`

The URL remains editable in Administration → Bell schedules.

## 2. Create the scheduler token and Edge Function secrets

Generate a high-entropy token with a password manager or a cryptographic random generator. Keep one identical value for the Edge Function and Vault scheduler call.

Set the scheduler secret using the Supabase Dashboard or CLI:

```bash
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

1. Confirm the newsletter source URL.
2. Click **Preview now**. A successful preview proves the public text export is readable, Gemini is configured, and the structured extraction passes validation. It does not change calendar dates.
3. Expand the newest run and inspect the source section, evidence, raw Gemini JSON, validated extraction, applied dates, and skipped manual overrides.
4. Click **Sync now** once the output is correct.
5. Set the daily Eastern time (default `6:00 AM`), enable daily detection, and save.

The database claims a scheduled date atomically, so repeated five-minute checks cannot start the same daily run twice. A successful source-section hash is also idempotent: an unchanged newsletter is recorded as skipped rather than reapplied.

## Operational safety

- The detector reads only the newest two `Weekly Schedule` sections and accepts dates only from 14 days ago through 35 days ahead within the configured school year.
- Source fetches are restricted to Google Docs public plain-text export URLs and are rejected if they return an HTML sign-in page or exceed the bounded document size.
- Every evidence quote must occur in the selected source text.
- The exact phrase `activity period` maps to Activity Bell Schedule #1. `Activities Fair` or `Student Activities Fair` alone is forced back to Regular.
- Gemini uses temperature `0`, structured JSON, `HIGH` thinking, and `includeThoughts=false`; reasoning thoughts are neither returned nor stored.
- Manual calendar rows are locked and reported as skipped. **Unlock for AI** converts selected rows to AI-managed status; **Clear overrides** restores the normal Regular weekday fallback.
- The newest 100 sync runs are retained. New-school-year reset clears date assignments and sync history while preserving definitions, edited bell times, source URLs, and automation configuration.
