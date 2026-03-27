# DocSpace Approval Portal (Sample)

Local sample portal that layers a simple “approval / fill forms” workflow UI on top of ONLYOFFICE DocSpace.

This project is intentionally **not** a legally binding e-signature service. It focuses on:

- Templates (DocSpace forms/templates folder)
- Starting a fill session / generating a “fill out” link
- Tracking a lightweight status in the portal UI

## Stack

- **Server**: Node.js + Express (single process)
- **Client**: React + Vite (served via the same Express process)

## Run (local)

```powershell
cd d:\Workspace\massive-samples\DocSpace-Samples\docspace-approval-portal
copy .env.example .env
npm install
npm run dev
```

Open http://localhost:5173

## Environment (.env)

Required:

```
DOCSPACE_BASE_URL=https://your-docspace.example.com
DOCSPACE_AUTH_TOKEN=YOUR_DOCSPACE_ADMIN_TOKEN
```

Recommended:

```
VITE_DOCSPACE_URL=https://your-docspace.example.com
DOCSPACE_FORMS_ROOM_TITLE=Forms Room
DOCSPACE_FORMS_TEMPLATES_FOLDER_TITLE=Templates
```

Notes:

- **Admin token** stays **server-side only** and is never sent to the browser.
- **User tokens** are created during login and stored **in the browser** (localStorage) for this sample.
- By default, local flow history is stored in `server/.data/store.json` (override with `DOCSPACE_APPROVAL_PORTAL_STORE_PATH` or disable with `false`).

