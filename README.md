# Remote Ninja

Remote Ninja is the internal team platform hosted at **amazon-vrmo.com**. It bundles
several tools behind a single Cognito-authenticated hub: **Schedule Live** (real-time
team scheduling), **Voice Tools** (speech-to-text + text-to-speech), **Browser
Extensions**, and an admin panel for user management. This README focuses on the
Schedule Live module and the shared AWS backend.

## Architecture

```
                    +-------------------+
                    |     Browser       |
                    |  (Next.js SPA)    |
                    +--------+----------+
                             |
                    +--------v----------+
                    |    CloudFront     |
                    |   (CDN + Cache)   |
                    +--------+----------+
                             |
              +--------------+--------------+
              |                             |
    +---------v---------+       +-----------v-----------+
    |    S3 Bucket      |       |    API Gateway        |
    | (Static Frontend) |       |   (HTTP API + CORS)   |
    +-------------------+       +-----------+-----------+
                                            |
                                +-----------v-----------+
                                |    Lambda (Python)    |
                                |  Single handler for   |
                                |  all CRUD operations  |
                                +-----------+-----------+
                                            |
                                +-----------v-----------+
                                |     DynamoDB          |
                                |  (Single-table, PAY)  |
                                +-----------------------+
```

## Features

- **24-hour visual shift bars** with 2-hour snap grid
- **Drag to resize/move** shifts - edges to resize, center to move
- **Click to edit** exact times via modal
- **Multi-select + bulk edit** - apply same schedule and case types to multiple people
- **Dynamic case types** - add/rename/recolor/remove via Settings panel
- **Manager groups** - collapsible sections per manager with their direct reports
- **Coverage heatmaps** - per-team and org-wide coverage per 2-hour slot
- **Dark mode** toggle
- **Shared cloud storage** - all users see the same data via DynamoDB
- **Offline fallback** - works with localStorage when API is unavailable
- **Optimistic concurrency** - version tracking prevents lost updates

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 15 + React 19 + TypeScript + Tailwind CSS v4 |
| API | AWS API Gateway (HTTP API) |
| Compute | AWS Lambda (Python 3.12, ARM64) |
| Database | AWS DynamoDB (on-demand, single-table) |
| Hosting | S3 + CloudFront |
| IaC | AWS SAM |

## Getting Started

### Local Development (no AWS needed)

```bash
npm install
npm run dev
```

Open http://localhost:3000 - uses localStorage for data persistence.

### Deploy Backend to AWS

```bash
cd backend
sam build
sam deploy --guided
```

See [backend/README.md](backend/README.md) for full deployment instructions.

### Connect Frontend to Backend

Create `.env.local` in the project root:

```
NEXT_PUBLIC_API_URL=https://your-api-id.execute-api.us-east-1.amazonaws.com/api
```

Restart the dev server - all data now flows through DynamoDB.

## Project Structure

```
projectremoteninja/
+-- app/
|   +-- globals.css         # Tailwind import
|   +-- layout.tsx          # Root layout + Font Awesome
|   +-- page.tsx            # Main app (schedule UI)
+-- lib/
|   +-- types.ts            # TypeScript interfaces
|   +-- constants.ts        # Slot config, colors, defaults
|   +-- store.ts            # localStorage persistence
|   +-- api.ts              # AWS API client (with offline fallback)
+-- backend/
|   +-- template.yaml       # SAM template (DynamoDB + Lambda + API GW)
|   +-- functions/
|   |   +-- api_handler.py  # Lambda handler (all routes)
|   +-- README.md           # Deployment instructions
+-- package.json
+-- tsconfig.json
+-- README.md
```

## Estimated Cost

~$1.25/month for a team of 15 people on AWS free tier.

## License

Internal use only.
