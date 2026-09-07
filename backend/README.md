# Remote Ninja Backend

AWS Serverless backend for the Remote Ninja platform (Schedule Live, Voice Tools, auth, and more).

## Architecture

```
Browser  -->  CloudFront  -->  S3 (Next.js static export)
                           -->  API Gateway (HTTP API)
                                    |
                                Lambda (Python 3.12)
                                    |
                                DynamoDB (single-table)
```

## Prerequisites

- [AWS CLI v2](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html) configured with credentials
- [AWS SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html)
- Python 3.12

## Deploy

```bash
cd backend

# Build the Lambda package
sam build

# Deploy (first time — interactive guided setup)
sam deploy --guided
```

During guided setup:
- **Stack name**: `ScheduleLive`
- **AWS Region**: `us-east-1` (or your preferred region)
- **CorsOrigin**: `*` for dev, or your frontend URL for production
- **Confirm changes before deploy**: Yes
- **Allow SAM CLI IAM role creation**: Yes

After deployment, note the **ApiUrl** output — you'll need it for the frontend.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /org | Load full org data |
| PUT | /org | Save full org data (with version for concurrency) |
| GET | /case-types | Load case type configuration |
| PUT | /case-types | Save case types |
| POST | /group | Add a new manager group |
| DELETE | /group/{id} | Remove a manager group |
| POST | /member | Add a member to a group |
| DELETE | /member/{id} | Remove a member |
| PUT | /shift | Update a single shift |
| PUT | /bulk | Bulk-edit multiple members |
| GET | /health | Health check |

## Connect Frontend

After deploying, create a `.env.local` file in the project root:

```bash
NEXT_PUBLIC_API_URL=https://xxxxxxxxxx.execute-api.us-east-1.amazonaws.com/api
```

Restart `npm run dev` — the frontend will now use the API instead of localStorage.

## Deploy Frontend to S3 + CloudFront

```bash
# Build the Next.js static export
cd ..  # back to project root
npx next build

# Create an S3 bucket for hosting
aws s3 mb s3://schedulelive-frontend

# Upload the build output
aws s3 sync out/ s3://schedulelive-frontend --delete

# Create a CloudFront distribution (or use the AWS Console)
aws cloudfront create-distribution \
  --origin-domain-name schedulelive-frontend.s3.amazonaws.com \
  --default-root-object index.html
```

## DynamoDB Table Design

Single-table design with document model for MVP:

| Entity | pk | sk | Notes |
|--------|----|----|-------|
| Org Data | `ORG#default` | `ORG#default` | Full org JSON blob + version counter |
| Case Types | `CFG#default` | `CASE_TYPES` | Array of case type configs |

GSI1 enables reverse lookups and time-based queries:
- `GSI1PK=ORG, GSI1SK=timestamp` — track org update history
- `GSI1PK=CFG, GSI1SK=CASE_TYPES` — lookup config by type

## Estimated Monthly Cost

| Service | Estimate |
|---------|----------|
| DynamoDB (on-demand) | $0.25 |
| Lambda (ARM64) | $0.00 (free tier) |
| API Gateway (HTTP API) | $0.50 |
| S3 + CloudFront | $0.50 |
| **Total** | **~$1.25/month** |

## Local Development

The frontend falls back to localStorage when `NEXT_PUBLIC_API_URL` is not set,
so you can develop without the backend running:

```bash
# Frontend only (no backend needed)
npm run dev

# With backend (requires SAM CLI + Docker)
cd backend
sam local start-api --port 3001

# Then in .env.local:
# NEXT_PUBLIC_API_URL=http://localhost:3001
```

## Cleanup

```bash
sam delete --stack-name ScheduleLive
```
