# DocSpace Approval Portal

Demo stand: approval and form-filling workflow UI on top of ONLYOFFICE DocSpace.

## Stack

- **Server**: Node.js + Express
- **Client**: React + Vite (served by the same Express process)

## Local development

```bash
cp .env.example .env
# fill in .env values
npm install
npm run dev
```

Opens at http://localhost:3005

## Environment variables

See [.env.example](.env.example) — copy it to `.env` and fill in the values.

| Variable | Required | Description |
|---|---|---|
| `DOCSPACE_BASE_URL` | ✅ | DocSpace instance URL |
| `DOCSPACE_AUTH_TOKEN` | ✅ | DocSpace admin API token |
| `VITE_DOCSPACE_URL` | ✅ | Same as `DOCSPACE_BASE_URL` (used client-side for SDK) |
| `DEMO_MODE` | ✅ | Set to `true` to enable demo stand |
| `DEMO_EMAIL_DOMAIN` | ✅ | Email domain for demo user accounts (must be allowed in DocSpace) |
| `DOCSPACE_FORMS_ROOM_TITLE` | — | Name of the Forms room in DocSpace (default: `Forms Room`) |
| `DOCSPACE_FORMS_ROOM_TITLE_FALLBACKS` | — | Fallback room names, comma-separated |
| `DOCSPACE_FORMS_TEMPLATES_FOLDER_TITLE` | — | Templates folder name (default: `Templates`) |
| `PORTAL_NAME` | — | Portal name shown in the UI |
| `PORTAL_TAGLINE` | — | Tagline shown in the sidebar |
| `PORT` | — | Server port (default: `8080`) |

## Production build

```bash
npm run build   # builds client to client/dist/
npm run start   # serves in production mode (NODE_ENV=production)
```

## Deployment (Docker + nginx)

```bash
docker run -d \
  --name docspace-approval-portal \
  --publish 0.0.0.0:3005:3005 \
  -v /app/docspace-approval:/app/docspace-approval \
  -w /app/docspace-approval \
  --restart always \
  node:lts-alpine npm run start
```

Nginx config:

```nginx
server {
    listen 443 ssl;
    server_name your-portal.your-domain.com;

    ssl_certificate     /etc/ssl/certs/fullchain.pem;
    ssl_certificate_key /etc/ssl/private/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3005;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto https;
    }
}
```

## ⚠️ Cookie requirement

The portal must be hosted on the **same eTLD+1 domain** as the DocSpace instance for the embedded editor to work correctly.

Example: if DocSpace is on `docspace.onlyoffice.com`, the portal must be on `*.onlyoffice.com` (e.g. `approval.onlyoffice.com`).

This is required because DocSpace sets `asc_auth_key` with `SameSite=Strict`. Cross-site iframes cannot access it, so the editor will show a login screen instead of opening in edit mode.
