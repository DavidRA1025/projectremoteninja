# Auth System Setup Guide

## Architecture
```
User opens amazon-vrmo.com
  -> Not logged in? -> Redirect to /auth/login.html
    -> Login / Sign Up / Forgot Password (Cognito)
      -> JWT stored in sessionStorage
        -> User sees the site
```

## Roles
| Role | Access |
|------|--------|
| super_admin | Everything + User Management (/admin/) |
| admin | Edit schedules, upload extensions |
| member | View schedules, download extensions |

## Deployment Steps

### Step 1 — Deploy backend with Cognito
```bash
cd backend
sam build
sam deploy
```

Note the outputs:
- **UserPoolId**: `us-east-1_XXXXXXX`
- **UserPoolClientId**: `xxxxxxxxxxxxxxxxxxxxxxxxxx`

### Step 2 — Update auth config
Edit `landing/auth/config.js` and replace the placeholder values:
```javascript
var AUTH_CONFIG = {
  UserPoolId: 'us-east-1_XXXXXXX',     // <-- from SAM output
  ClientId: 'xxxxxxxxxxxxxxxxxxxxxxxxxx', // <-- from SAM output
  Region: 'us-east-1',
  ApiUrl: 'https://zta7che674.execute-api.us-east-1.amazonaws.com/api'
};
```

### Step 3 — Upload auth pages to S3
```bash
aws s3 sync landing/auth/ s3://schedule-live-frontend-chenwayi/auth/ --content-type "text/html"
aws s3 cp landing/auth/config.js s3://schedule-live-frontend-chenwayi/auth/config.js --content-type "application/javascript"
aws s3 cp landing/auth/guard.js s3://schedule-live-frontend-chenwayi/auth/guard.js --content-type "application/javascript"
aws s3 cp landing/auth/auth-styles.css s3://schedule-live-frontend-chenwayi/auth/auth-styles.css --content-type "text/css"
aws s3 cp landing/index.html s3://schedule-live-frontend-chenwayi/index.html --content-type "text/html"
aws s3 cp landing/extensions/index.html s3://schedule-live-frontend-chenwayi/extensions/index.html --content-type "text/html"
aws s3 cp landing/extensions/upload.html s3://schedule-live-frontend-chenwayi/extensions/upload.html --content-type "text/html"
aws s3 sync landing/admin/ s3://schedule-live-frontend-chenwayi/admin/ --content-type "text/html"
```

### Step 4 — Rebuild and upload schedule app
```bash
cd ..
npx next build
aws s3 sync out/ s3://schedule-live-frontend-chenwayi/schedule/ --delete
```

### Step 5 — Invalidate CloudFront
```bash
aws cloudfront create-invalidation --distribution-id E4RGO3BS445QF --paths "/*"
```

### Step 6 — Create your Super Admin account
1. Go to `https://amazon-vrmo.com/auth/signup.html`
2. Sign up with your email
3. Verify your email with the code
4. Then promote yourself to super_admin via AWS CLI:

```bash
aws cognito-idp admin-update-user-attributes \
  --user-pool-id us-east-1_XXXXXXX \
  --username YOUR_EMAIL \
  --user-attributes Name=custom:role,Value=super_admin
```

After this, you can manage all other users from the Admin panel at `/admin/`.

## Auth Pages
| Page | URL |
|------|-----|
| Login | /auth/login.html |
| Sign Up | /auth/signup.html |
| Verify Email | /auth/verify.html |
| Forgot Password | /auth/forgot-password.html |
| Admin Panel | /admin/ |

## Files
```
landing/auth/
  config.js          <- Cognito IDs (UPDATE AFTER DEPLOY)
  guard.js           <- Auth guard (include on all protected pages)
  auth-styles.css    <- Shared styles for auth pages
  login.html         <- Login page
  signup.html        <- Registration page
  verify.html        <- Email verification
  forgot-password.html <- Password reset

landing/admin/
  index.html         <- User management (super_admin only)
```
