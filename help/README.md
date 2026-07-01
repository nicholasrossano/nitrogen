# Nitrogen user documentation (Mintlify)

Public product docs for [nitrogenai.mintlify.app](https://nitrogenai.mintlify.app/), also proxied at `/docs` on the main site.

Internal contributor docs live in the repo root `docs/` folder — not here.

## Local preview

```bash
npm i -g mint
cd help
mint dev
```

Open http://localhost:3000.

## Git sync (one-time Mintlify dashboard setup)

After this folder is merged to `main`:

1. [Mintlify dashboard](https://app.mintlify.com) → **Git Settings** → **Manual setup**
2. Repository: `nicholasrossano/nitrogen`
3. Production branch: `main`
4. **Subdirectory:** `help`
5. Install the [Mintlify GitHub App](https://dashboard.mintlify.com/settings/organization/github-app) on `nicholasrossano/nitrogen`
6. Confirm a deploy triggers on push

Pushes to `help/` on the production branch redeploy the live site automatically.
