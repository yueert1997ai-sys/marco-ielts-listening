# Marco Vocabulary Admin

Cloudflare Worker + D1 single-user vocabulary management site for the IELTS
Listening PWA. The GitHub repository remains the source of truth.

## Local setup

1. `npm install`
2. `cp .dev.vars.example .dev.vars`
3. Generate a password hash with `node scripts/hash-password.mjs 'your password'`
4. Put the hash, a random session secret, and a fine-grained GitHub token with
   **Issues: read and write** access to `marco-ielts-listening` in `.dev.vars`
5. `npm run db:local`
6. `npm run dev`

## Cloudflare deployment

Create the D1 database once, replace the placeholder `database_id` in
`wrangler.jsonc`, apply `schema.sql`, and set these encrypted Worker secrets:

- `ADMIN_PASSWORD_HASH`
- `SESSION_SECRET`
- `GITHUB_TOKEN`

Then run `npm run deploy`. The cron trigger publishes any pending operations
left behind when the browser closes.

## Local dictionary

Build the compact dictionary from an ECDICT checkout:

```bash
python scripts/build-ecdict-lite.py --input /path/to/ECDICT/ecdict.csv
```

The build fails if the compressed asset exceeds 20 MB.
