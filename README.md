# Schedule Live Viewer

A real-time team scheduling tool with drag-to-edit shift bars, multi-manager hierarchy, case type filtering, bulk editing, and persistent local storage.

## Features

- **24-hour visual shift bars** with 2-hour snap grid
- **Drag to resize/move** shifts — edges to resize, center to move
- **Click to edit** exact times via modal
- **Multi-select + bulk edit** — apply same schedule & case types to multiple people
- **Case type filters** — see only staff trained for CN CFP, ROW CFP, Rev SP, etc.
- **Manager groups** — collapsible sections per manager with their direct reports
- **Coverage heatmaps** — per-team and org-wide coverage per 2-hour slot
- **Dark mode** toggle
- **Persistent storage** — all data saved to localStorage (persists across sessions)
- **Add/remove members** with shift hours, days off, and trained case types

## Tech Stack

- **Next.js 15** + React 19 + TypeScript
- **Tailwind CSS v4**
- **localStorage** for persistence (swap to DynamoDB for cloud deployment)

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Future: AWS Deployment

Replace `lib/store.ts` localStorage calls with API Gateway + Lambda + DynamoDB for multi-user real-time sync.

## License

Internal use only.
