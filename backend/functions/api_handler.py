"""
ScheduleLive API Handler

========================
Single Lambda function handling all API routes via API Gateway HTTP API proxy.

Routes:
  GET  /org          — Load full org data
  PUT  /org          — Save full org data (overwrite)
  GET  /case-types   — Load case type configuration
  PUT  /case-types   — Save case type configuration
  POST /group        — Add a new manager group
  DELETE /group/{id} — Remove a manager group and its members
  POST /member       — Add a member to a group
  DELETE /member/{id}— Remove a member
  PUT  /shift        — Update a single shift for a member
  PUT  /bulk         — Bulk-edit multiple members
  GET  /health       — Health check
  GET  /extensions   — List all extensions
  POST /extensions   — Add/update extension metadata
  DELETE /extensions/{id} — Remove extension
  POST /extensions/upload-url — Generate presigned S3 upload URL

Design decisions:
  - MVP uses a "document model": full org stored as one DynamoDB item.
    This keeps reads fast (single GetItem) and simplifies the frontend.
  - For teams under 100 people, the 400KB DynamoDB item limit is plenty.
  - When scaling beyond 100, decompose into per-group/per-member items.
  - All writes use optimistic concurrency via a version counter to prevent
    lost updates when multiple users edit simultaneously.
"""

import json
import os
import time
import uuid
import traceback
import boto3
from decimal import Decimal
import base64
import urllib.request
import urllib.parse
import hmac
import hashlib

# Cognito configuration
USER_POOL_ID = os.environ.get('USER_POOL_ID', '')
USER_POOL_CLIENT_ID = os.environ.get('USER_POOL_CLIENT_ID', '')
USER_POOL_REGION = os.environ.get('USER_POOL_REGION', 'us-east-1')

cognito_client = boto3.client('cognito-idp', region_name=USER_POOL_REGION)

# ============ JWT VALIDATION ============

def decode_jwt_payload(token):
    """Decode JWT payload without verification (for extracting claims)."""
    try:
        parts = token.split('.')
        if len(parts) != 3:
            return None
        payload = parts[1]
        # Add padding
        payload += '=' * (4 - len(payload) % 4)
        decoded = base64.urlsafe_b64decode(payload)
        return json.loads(decoded)
    except Exception:
        return None

def get_user_from_token(event):
    """Extract user info from Authorization header JWT."""
    auth_header = event.get('headers', {}).get('authorization', '')
    if not auth_header:
        auth_header = event.get('headers', {}).get('Authorization', '')
    if not auth_header:
        return None
    
    token = auth_header.replace('Bearer ', '').replace('bearer ', '').strip()
    if not token:
        return None
    
    payload = decode_jwt_payload(token)
    if not payload:
        return None
    
    # Check expiry
    if payload.get('exp', 0) < time.time():
        return None
    
    return {
        'email': payload.get('email', ''),
        'name': payload.get('name', ''),
        'role': payload.get('custom:role', 'member'),
        'sub': payload.get('sub', '')
    }

def require_auth(event):
    """Returns user dict or None if not authenticated."""
    return get_user_from_token(event)

def require_role(event, required_role):
    """Check if user has required role. Returns (user, error_response)."""
    user = require_auth(event)
    if not user:
        return None, response(401, {'error': 'Authentication required'})
    
    role_hierarchy = {'super_admin': 3, 'admin': 2, 'member': 1}
    user_level = role_hierarchy.get(user.get('role', ''), 0)
    required_level = role_hierarchy.get(required_role, 0)
    
    if user_level < required_level:
        return None, response(403, {'error': 'Insufficient permissions'})
    
    return user, None

# ============ ADMIN USER MANAGEMENT ============

def handle_admin_list_users(event):
    """List all Cognito users."""
    user, err = require_role(event, 'super_admin')
    if err:
        return err
    
    try:
        result = cognito_client.list_users(UserPoolId=USER_POOL_ID, Limit=60)
        users = []
        for u in result.get('Users', []):
            attrs = {a['Name']: a['Value'] for a in u.get('Attributes', [])}
            users.append({
                'email': attrs.get('email', ''),
                'name': attrs.get('name', ''),
                'role': attrs.get('custom:role', 'member'),
                'sub': attrs.get('sub', ''),
                'status': u.get('UserStatus', ''),
                'enabled': u.get('Enabled', True),
                'created': u.get('UserCreateDate', '').isoformat() if hasattr(u.get('UserCreateDate', ''), 'isoformat') else str(u.get('UserCreateDate', '')),
            })
        return response(200, {'data': users})
    except Exception as e:
        return response(500, {'error': f'Failed to list users: {str(e)}'})

def handle_admin_change_role(event, email):
    """Change a user's role."""
    user, err = require_role(event, 'super_admin')
    if err:
        return err
    
    body = json.loads(event.get('body', '{}') or '{}')
    new_role = body.get('role', 'member')
    if new_role not in ('super_admin', 'admin', 'member'):
        return response(400, {'error': 'Invalid role'})
    
    try:
        cognito_client.admin_update_user_attributes(
            UserPoolId=USER_POOL_ID,
            Username=email,
            UserAttributes=[{'Name': 'custom:role', 'Value': new_role}]
        )
        return response(200, {'success': True, 'role': new_role})
    except Exception as e:
        return response(500, {'error': f'Failed to update role: {str(e)}'})

def handle_admin_disable_user(event, email):
    """Disable a user."""
    user, err = require_role(event, 'super_admin')
    if err:
        return err
    try:
        cognito_client.admin_disable_user(UserPoolId=USER_POOL_ID, Username=email)
        return response(200, {'success': True})
    except Exception as e:
        return response(500, {'error': f'Failed to disable user: {str(e)}'})

def handle_admin_enable_user(event, email):
    """Enable a user."""
    user, err = require_role(event, 'super_admin')
    if err:
        return err
    try:
        cognito_client.admin_enable_user(UserPoolId=USER_POOL_ID, Username=email)
        return response(200, {'success': True})
    except Exception as e:
        return response(500, {'error': f'Failed to enable user: {str(e)}'})

def handle_admin_delete_user(event, email):
    """Delete a user."""
    user, err = require_role(event, 'super_admin')
    if err:
        return err
    try:
        cognito_client.admin_delete_user(UserPoolId=USER_POOL_ID, Username=email)
        return response(200, {'success': True})
    except Exception as e:
        return response(500, {'error': f'Failed to delete user: {str(e)}'})


def handle_admin_invite_user(event):
    """POST /admin/users/invite — Create a user via AdminCreateUser (invite-only flow).
    Cognito sends a temporary password via email. User must set new password on first login.
    """
    user, err = require_role(event, 'super_admin')
    if err:
        return err

    body = json.loads(event.get('body', '{}') or '{}')
    email = body.get('email', '').strip()
    name = body.get('name', '').strip()
    role = body.get('role', 'member')

    if not email:
        return response(400, {'error': 'Email is required'})
    if not name:
        return response(400, {'error': 'Name is required'})
    if role not in ('super_admin', 'admin', 'member'):
        return response(400, {'error': 'Invalid role'})

    try:
        cognito_client.admin_create_user(
            UserPoolId=USER_POOL_ID,
            Username=email,
            UserAttributes=[
                {'Name': 'email', 'Value': email},
                {'Name': 'email_verified', 'Value': 'true'},
                {'Name': 'name', 'Value': name},
                {'Name': 'custom:role', 'Value': role},
            ],
            DesiredDeliveryMediums=['EMAIL'],
        )
        return response(201, {'success': True, 'email': email, 'role': role})
    except cognito_client.exceptions.UsernameExistsException:
        return response(409, {'error': f'User {email} already exists'})
    except Exception as e:
        return response(500, {'error': f'Failed to invite user: {str(e)}'})


# ============ CONFIG ============

TABLE_NAME = os.environ.get("TABLE_NAME", "ScheduleLive")
CORS_ORIGIN = os.environ.get("CORS_ORIGIN", "*")

dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(TABLE_NAME)

# Keys for the document-model items
ORG_PK = "ORG#default"
ORG_SK = "ORG#default"
CFG_PK = "CFG#default"
CFG_SK = "CASE_TYPES"
S3_BUCKET = os.environ.get("S3_BUCKET", "schedule-live-frontend-chenwayi")
S3_EXTENSIONS_PREFIX = "extensions/downloads/"

s3_client = boto3.client("s3")

# Extension keys
EXT_PK = "EXTENSIONS"



# ============ HELPERS ============

def response(status_code, body=None):
    """Build an API Gateway response with CORS headers."""
    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": CORS_ORIGIN,
            "Access-Control-Allow-Methods": "GET,PUT,POST,DELETE,OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Requested-With",
        },
        "body": json.dumps(body, default=str) if body is not None else "",
    }


def parse_body(event):
    """Parse the JSON body from an API Gateway event."""
    body = event.get("body", "")
    if not body:
        return {}
    try:
        return json.loads(body)
    except json.JSONDecodeError:
        return {}


def generate_id():
    """Generate a short unique ID (8 chars)."""
    return uuid.uuid4().hex[:8]


# ============ DEFAULT DATA ============
# Same structure as the frontend's getDefaultData() — ships empty.

def get_default_org():
    """Return default org data for first-time setup."""
    return [
        {
            "id": generate_id(),
            "collapsed": False,
            "mgr": {
                "id": generate_id(),
                "login": "manager1",
                "name": "Manager A",
                "note": "",
                "color": "#6366f1",
                "trained": {},
                "shifts": {
                    str(i): {"s": "08:00", "e": "17:00", "t": "day"}
                    for i in range(5)  # Mon-Fri
                },
                "off": [5, 6],
            },
            "members": [
                {
                    "id": generate_id(),
                    "login": "agent1",
                    "name": "Agent 1",
                    "note": "",
                    "color": "#3b82f6",
                    "trained": {},
                    "shifts": {
                        str(i): {"s": "06:00", "e": "14:00", "t": "morning"}
                        for i in [0, 1, 2, 3, 6]  # Mon-Thu + Sun
                    },
                    "off": [4, 5],
                },
                {
                    "id": generate_id(),
                    "login": "agent2",
                    "name": "Agent 2",
                    "note": "",
                    "color": "#8b5cf6",
                    "trained": {},
                    "shifts": {
                        str(i): {"s": "14:00", "e": "22:00", "t": "swing"}
                        for i in range(5)  # Mon-Fri
                    },
                    "off": [5, 6],
                },
            ],
        }
    ]


def get_default_case_types():
    """Return empty case types — users configure their own."""
    return []


# ============ DATA ACCESS ============

def load_org():
    """Load org data from DynamoDB, or return defaults if not found."""
    resp = table.get_item(Key={"pk": ORG_PK, "sk": ORG_SK})
    item = resp.get("Item")
    if not item:
        return get_default_org(), 0
    # DynamoDB stores numbers as Decimal; convert to native Python types
    data = json.loads(json.dumps(item.get("data", []), default=str))
    version = int(item.get("version", 0))
    return data, version


def save_org(data, version=None):
    """Save org data to DynamoDB with optimistic concurrency."""
    now = int(time.time())
    item = {
        "pk": ORG_PK,
        "sk": ORG_SK,
        "data": data,
        "version": (version or 0) + 1,
        "updated_at": now,
        "GSI1PK": "ORG",
        "GSI1SK": str(now),
    }

    if version is not None and version > 0:
        # Optimistic lock: only update if version matches
        try:
            table.put_item(
                Item=item,
                ConditionExpression="attribute_not_exists(version) OR version = :v",
                ExpressionAttributeValues={":v": version},
            )
        except dynamodb.meta.client.exceptions.ConditionalCheckFailedException:
            return False, "Version conflict — someone else updated. Please refresh."
    else:
        table.put_item(Item=item)

    return True, item["version"]


def load_case_types():
    """Load case types from DynamoDB, or return defaults if not found."""
    resp = table.get_item(Key={"pk": CFG_PK, "sk": CFG_SK})
    item = resp.get("Item")
    if not item:
        return get_default_case_types()
    return json.loads(json.dumps(item.get("data", []), default=str))


def save_case_types(data):
    """Save case types to DynamoDB."""
    table.put_item(
        Item={
            "pk": CFG_PK,
            "sk": CFG_SK,
            "data": data,
            "updated_at": int(time.time()),
            "GSI1PK": "CFG",
            "GSI1SK": "CASE_TYPES",
        }
    )


# ============ ROUTE HANDLERS ============

def handle_get_org(event):
    """GET /org — Return the full org data."""
    data, version = load_org()
    return response(200, {"data": data, "version": version})


def handle_put_org(event):
    """PUT /org — Overwrite the full org data."""
    body = parse_body(event)
    data = body.get("data")
    version = body.get("version", 0)
    if data is None:
        return response(400, {"error": "Missing 'data' field"})

    success, result = save_org(data, version)
    if not success:
        return response(409, {"error": result})
    return response(200, {"success": True, "version": result})


def handle_get_case_types(event):
    """GET /case-types — Return case type configuration."""
    data = load_case_types()
    return response(200, {"data": data})


def handle_put_case_types(event):
    """PUT /case-types — Save case type configuration."""
    body = parse_body(event)
    data = body.get("data")
    if data is None:
        return response(400, {"error": "Missing 'data' field"})
    save_case_types(data)
    return response(200, {"success": True})


def handle_post_group(event):
    """POST /group — Add a new manager group to the org."""
    body = parse_body(event)
    name = body.get("name", "").strip()
    login = body.get("login", "").strip()
    if not name:
        return response(400, {"error": "Missing 'name'"})

    org_data, version = load_org()
    new_group = {
        "id": generate_id(),
        "collapsed": False,
        "mgr": {
            "id": generate_id(),
            "login": login or name.lower().replace(" ", ""),
            "name": name,
            "note": "",
            "color": "#6366f1",
            "trained": {},
            "shifts": {
                str(i): {"s": "08:00", "e": "17:00", "t": "day"}
                for i in range(5)
            },
            "off": [5, 6],
        },
        "members": [],
    }
    org_data.append(new_group)
    success, result = save_org(org_data, version)
    if not success:
        return response(409, {"error": result})
    return response(201, {"success": True, "group": new_group, "version": result})


def handle_delete_group(event, group_id):
    """DELETE /group/{id} — Remove a manager group."""
    org_data, version = load_org()
    org_data = [g for g in org_data if g.get("id") != group_id]
    success, result = save_org(org_data, version)
    if not success:
        return response(409, {"error": result})
    return response(200, {"success": True, "version": result})


def handle_post_member(event):
    """POST /member — Add a member to a group."""
    body = parse_body(event)
    group_id = body.get("groupId")
    login = body.get("login", "").strip()
    if not group_id or not login:
        return response(400, {"error": "Missing 'groupId' or 'login'"})

    org_data, version = load_org()
    new_member = {
        "id": generate_id(),
        "login": login,
        "name": body.get("name", login),
        "note": body.get("note", ""),
        "color": body.get("color", "#3b82f6"),
        "trained": body.get("trained", {}),
        "shifts": body.get("shifts", {}),
        "off": body.get("off", [5, 6]),
    }

    for group in org_data:
        if group.get("id") == group_id:
            group["members"].append(new_member)
            break
    else:
        return response(404, {"error": f"Group {group_id} not found"})

    success, result = save_org(org_data, version)
    if not success:
        return response(409, {"error": result})
    return response(201, {"success": True, "member": new_member, "version": result})


def handle_delete_member(event, member_id):
    """DELETE /member/{id} — Remove a member from any group."""
    org_data, version = load_org()
    found = False
    for group in org_data:
        before = len(group["members"])
        group["members"] = [m for m in group["members"] if m.get("id") != member_id]
        if len(group["members"]) < before:
            found = True
            break

    if not found:
        return response(404, {"error": f"Member {member_id} not found"})

    success, result = save_org(org_data, version)
    if not success:
        return response(409, {"error": result})
    return response(200, {"success": True, "version": result})


def handle_put_shift(event):
    """PUT /shift — Update a single shift for a member."""
    body = parse_body(event)
    member_id = body.get("memberId")
    is_mgr = body.get("isMgr", False)
    group_index = body.get("groupIndex")
    day = str(body.get("day"))
    shift = body.get("shift")  # null = day off

    if member_id is None and group_index is None:
        return response(400, {"error": "Missing member identifier"})

    org_data, version = load_org()

    # Find the member
    target = None
    if is_mgr and group_index is not None:
        if 0 <= group_index < len(org_data):
            target = org_data[group_index]["mgr"]
    else:
        for group in org_data:
            if is_mgr and group.get("id") == body.get("groupId"):
                target = group["mgr"]
                break
            for m in group["members"]:
                if m.get("id") == member_id:
                    target = m
                    break
            if target:
                break

    if not target:
        return response(404, {"error": "Member not found"})

    if shift:
        target["shifts"][day] = shift
        target["off"] = [d for d in target.get("off", []) if d != int(day)]
    else:
        target["shifts"].pop(day, None)
        if int(day) not in target.get("off", []):
            target.setdefault("off", []).append(int(day))

    success, result = save_org(org_data, version)
    if not success:
        return response(409, {"error": result})
    return response(200, {"success": True, "version": result})


def handle_put_bulk(event):
    """PUT /bulk — Bulk-edit multiple members (same schedule + case types)."""
    body = parse_body(event)
    member_ids = body.get("memberIds", [])
    shift_start = body.get("shiftStart")
    shift_end = body.get("shiftEnd")
    shift_type = body.get("shiftType", "day")
    off_days = body.get("offDays", [])
    trained = body.get("trained", {})

    if not member_ids:
        return response(400, {"error": "Missing 'memberIds'"})

    org_data, version = load_org()

    # Build the new shifts
    new_shifts = {}
    for i in range(7):
        if i not in off_days:
            new_shifts[str(i)] = {"s": shift_start, "e": shift_end, "t": shift_type}

    updated = 0
    for group in org_data:
        # Check manager
        if group["mgr"].get("id") in member_ids:
            group["mgr"]["shifts"] = dict(new_shifts)
            group["mgr"]["off"] = list(off_days)
            group["mgr"]["trained"] = dict(trained)
            updated += 1
        # Check members
        for m in group["members"]:
            if m.get("id") in member_ids:
                m["shifts"] = dict(new_shifts)
                m["off"] = list(off_days)
                m["trained"] = dict(trained)
                updated += 1

    success, result = save_org(org_data, version)
    if not success:
        return response(409, {"error": result})
    return response(200, {"success": True, "updated": updated, "version": result})


def handle_health(event):
    """GET /health — Health check endpoint."""
    return response(200, {
        "status": "healthy",
        "service": "ScheduleLive",
        "timestamp": int(time.time()),
    })



# ============ PROFILE HANDLER ============

def handle_get_profile(event):
    """GET /profile — Return the current user's Cognito attributes."""
    auth_header = event.get("headers", {}).get("authorization", "")
    token = auth_header.replace("Bearer ", "") if auth_header.startswith("Bearer ") else ""
    if not token:
        return response(401, {"error": "Not authenticated"})

    payload = decode_jwt_payload(token)
    if not payload:
        return response(401, {"error": "Invalid token"})

    email = payload.get("email", "")

    try:
        result = cognito_client.admin_get_user(
            UserPoolId=USER_POOL_ID,
            Username=email
        )
        attrs = {a["Name"]: a["Value"] for a in result.get("UserAttributes", [])}
        return response(200, {
            "email": attrs.get("email", email),
            "name": attrs.get("name", ""),
            "role": attrs.get("custom:role", "member"),
            "created": result.get("UserCreateDate", "").isoformat() if hasattr(result.get("UserCreateDate", ""), "isoformat") else str(result.get("UserCreateDate", "")),
            "status": result.get("UserStatus", ""),
            "enabled": result.get("Enabled", True),
        })
    except Exception as e:
        return response(500, {"error": str(e)})



# ============ EXTENSION HANDLERS ============

def handle_get_extensions(event):
    """GET /extensions - List all extensions."""
    resp = table.query(
        KeyConditionExpression="pk = :pk",
        ExpressionAttributeValues={":pk": EXT_PK},
    )
    items = resp.get("Items", [])
    extensions = []
    for item in items:
        ext = json.loads(json.dumps(item.get("data", {}), default=str))
        extensions.append(ext)
    # Sort by name
    extensions.sort(key=lambda x: x.get("name", ""))
    return response(200, {"data": extensions})


def handle_post_extension(event):
    """POST /extensions - Add or update an extension."""
    body = parse_body(event)
    ext_id = body.get("id") or generate_id()
    name = body.get("name", "").strip()
    if not name:
        return response(400, {"error": "Missing 'name'"})

    ext_data = {
        "id": ext_id,
        "name": name,
        "version": body.get("version", "1.0.0"),
        "description": body.get("description", ""),
        "features": body.get("features", []),
        "icon": body.get("icon", "fa-solid fa-puzzle-piece"),
        "gradient_colors": body.get("gradient_colors", ["#6366f1", "#8b5cf6"]),
        "tags": body.get("tags", []),
        "chrome_url": body.get("chrome_url", ""),
        "firefox_url": body.get("firefox_url", ""),
        "chrome_only": body.get("chrome_only", False),
        "updated_at": int(time.time()),
    }

    table.put_item(
        Item={
            "pk": EXT_PK,
            "sk": f"EXT#{ext_id}",
            "data": ext_data,
            "GSI1PK": "EXT",
            "GSI1SK": ext_data["name"],
        }
    )
    return response(200 if body.get("id") else 201, {"success": True, "data": ext_data})


def handle_delete_extension(event, ext_id):
    """DELETE /extensions/{id} - Remove an extension."""
    table.delete_item(Key={"pk": EXT_PK, "sk": f"EXT#{ext_id}"})
    return response(200, {"success": True})


def handle_upload_url(event):
    """POST /extensions/upload-url - Generate a presigned S3 upload URL."""
    body = parse_body(event)
    filename = body.get("filename", "").strip()
    content_type = body.get("content_type", "application/octet-stream")

    if not filename:
        return response(400, {"error": "Missing 'filename'"})

    # Sanitize filename
    safe_name = filename.replace(" ", "-").replace("/", "-")
    s3_key = f"{S3_EXTENSIONS_PREFIX}{safe_name}"

    try:
        presigned = s3_client.generate_presigned_url(
            "put_object",
            Params={
                "Bucket": S3_BUCKET,
                "Key": s3_key,
                "ContentType": content_type,
            },
            ExpiresIn=300,  # 5 minutes
        )
        download_url = f"https://{S3_BUCKET}.s3.amazonaws.com/{s3_key}"
        return response(200, {
            "upload_url": presigned,
            "download_url": f"/extensions/downloads/{safe_name}",
            "s3_key": s3_key,
        })
    except Exception as e:
        return response(500, {"error": f"Failed to generate upload URL: {str(e)}"})





# ============ QR CODE LOGIN ============

QR_TTL_SECONDS = 300  # 5 minutes
QR_PK = "QR_SESSION"

def handle_qr_generate(event):
    """POST /auth/qr/generate — Create a pending QR login session.
    No auth required (desktop isn't logged in yet).
    Returns a token + URL for the QR code.
    """
    token = uuid.uuid4().hex
    now = int(time.time())
    ttl = now + QR_TTL_SECONDS

    table.put_item(Item={
        "pk": QR_PK,
        "sk": f"QR#{token}",
        "status": "pending",
        "created_at": now,
        "ttl": ttl,
    })

    qr_url = "https://amazon-vrmo.com/auth/qr-approve.html" + "?" + "token" + "=" + token

    return response(200, {
        "token": token,
        "qr_url": qr_url,
        "expires_in": QR_TTL_SECONDS,
    })


def handle_qr_status(event, token):
    """GET /auth/qr/status/{token} — Poll QR session status.
    No auth required (desktop polls this).
    Returns: pending | approved (with tokens) | expired.
    """
    resp = table.get_item(Key={"pk": QR_PK, "sk": f"QR#{token}"})
    item = resp.get("Item")

    if not item:
        return response(200, {"status": "expired"})

    now = int(time.time())
    if now > int(item.get("ttl", 0)):
        # Clean up expired session
        table.delete_item(Key={"pk": QR_PK, "sk": f"QR#{token}"})
        return response(200, {"status": "expired"})

    status = item.get("status", "pending")

    if status == "approved":
        # Return the tokens and delete the record (one-time use)
        tokens = item.get("tokens", {})
        approved_by = item.get("approved_by", "")
        # Delete after reading — one-time pickup
        table.delete_item(Key={"pk": QR_PK, "sk": f"QR#{token}"})
        return response(200, {
            "status": "approved",
            "approved_by": approved_by,
            "tokens": {
                "id_token": tokens.get("id_token", ""),
                "access_token": tokens.get("access_token", ""),
                "refresh_token": tokens.get("refresh_token", ""),
            }
        })

    return response(200, {"status": "pending"})


def handle_qr_approve(event):
    """POST /auth/qr/approve — Approve a QR login session.
    REQUIRES auth (the phone user must be logged in).
    Transfers the phone user's tokens to the QR session so the desktop can pick them up.
    """
    user = require_auth(event)
    if not user:
        return response(401, {"error": "Authentication required. Please log in on your phone first."})

    body = parse_body(event)
    token = body.get("token", "").strip()
    if not token:
        return response(400, {"error": "Missing token"})

    # Check the QR session exists and is pending
    resp = table.get_item(Key={"pk": QR_PK, "sk": f"QR#{token}"})
    item = resp.get("Item")

    if not item:
        return response(404, {"error": "QR session not found or expired"})

    if item.get("status") != "pending":
        return response(400, {"error": "QR session already used or expired"})

    now = int(time.time())
    if now > int(item.get("ttl", 0)):
        table.delete_item(Key={"pk": QR_PK, "sk": f"QR#{token}"})
        return response(400, {"error": "QR session expired"})

    # Get the approver's tokens from the Authorization header
    auth_header = event.get('headers', {}).get('authorization', '') or event.get('headers', {}).get('Authorization', '')
    id_token = auth_header.replace('Bearer ', '').replace('bearer ', '').strip()
    access_token = event.get('headers', {}).get('x-access-token', '')
    refresh_token = event.get('headers', {}).get('x-refresh-token', '')

    # Update the QR session to approved with tokens
    table.update_item(
        Key={"pk": QR_PK, "sk": f"QR#{token}"},
        UpdateExpression="SET #s = :s, approved_by = :ab, tokens = :t",
        ExpressionAttributeNames={"#s": "status"},
        ExpressionAttributeValues={
            ":s": "approved",
            ":ab": user.get("email", ""),
            ":t": {
                "id_token": id_token,
                "access_token": access_token,
                "refresh_token": refresh_token,
            }
        }
    )

    return response(200, {"success": True, "approved_by": user.get("email", "")})


# ============ ROUTER ============

def lambda_handler(event, context):
    """
    Main entry point. Routes requests based on HTTP method + path.
    API Gateway HTTP API sends the path in requestContext.http.path.
    """
    try:
        http = event.get("requestContext", {}).get("http", {})
        method = http.get("method", "GET").upper()
        # Strip the stage prefix (e.g. /api/) from the path
        raw_path = http.get("path", "/")
        path = raw_path.replace("/api", "", 1) if raw_path.startswith("/api") else raw_path

        # OPTIONS — CORS preflight
        if method == "OPTIONS":
            return response(200)

        # Health check
        if path == "/health":
            return handle_health(event)

        # Profile
        if path == "/profile" and method == "GET":
            return handle_get_profile(event)

        # Org data
        if path == "/org":
            if method == "GET":
                return handle_get_org(event)
            elif method == "PUT":
                return handle_put_org(event)

        # Case types
        if path == "/case-types":
            if method == "GET":
                return handle_get_case_types(event)
            elif method == "PUT":
                return handle_put_case_types(event)

        # Groups
        if path == "/group":
            if method == "POST":
                return handle_post_group(event)
        if path.startswith("/group/") and method == "DELETE":
            group_id = path.split("/group/")[1]
            return handle_delete_group(event, group_id)

        # Members
        if path == "/member":
            if method == "POST":
                return handle_post_member(event)
        if path.startswith("/member/") and method == "DELETE":
            member_id = path.split("/member/")[1]
            return handle_delete_member(event, member_id)

        # Shifts
        if path == "/shift" and method == "PUT":
            return handle_put_shift(event)

        # Bulk edit
        if path == "/bulk" and method == "PUT":
            return handle_put_bulk(event)


        # Extensions
        if path == "/extensions":
            if method == "GET":
                return handle_get_extensions(event)
            elif method == "POST":
                return handle_post_extension(event)
        if path.startswith("/extensions/") and method == "DELETE":
            ext_id = path.split("/extensions/")[1]
            return handle_delete_extension(event, ext_id)
        if path == "/extensions/upload-url" and method == "POST":
            return handle_upload_url(event)

        # ============ QR CODE LOGIN ROUTES ============
        if path == "/auth/qr/generate" and method == "POST":
            return handle_qr_generate(event)
        if path.startswith("/auth/qr/status/") and method == "GET":
            token = path.split("/auth/qr/status/")[1]
            return handle_qr_status(event, token)
        if path == "/auth/qr/approve" and method == "POST":
            return handle_qr_approve(event)

        # ============ ADMIN ROUTES ============
        if path == "/admin/users/invite" and method == "POST":
            return handle_admin_invite_user(event)
        if path == "/admin/users" and method == "GET":
            return handle_admin_list_users(event)
        if path.startswith("/admin/users/") and path.endswith("/role") and method == "PUT":
            email = path.replace("/admin/users/", "").replace("/role", "")
            return handle_admin_change_role(event, urllib.parse.unquote(email))
        if path.startswith("/admin/users/") and path.endswith("/disable") and method == "PUT":
            email = path.replace("/admin/users/", "").replace("/disable", "")
            return handle_admin_disable_user(event, urllib.parse.unquote(email))
        if path.startswith("/admin/users/") and path.endswith("/enable") and method == "PUT":
            email = path.replace("/admin/users/", "").replace("/enable", "")
            return handle_admin_enable_user(event, urllib.parse.unquote(email))
        if path.startswith("/admin/users/") and method == "DELETE":
            email = path.replace("/admin/users/", "")
            return handle_admin_delete_user(event, urllib.parse.unquote(email))

        # Not found
        return response(404, {"error": f"Not found: {method} {path}"})

    except Exception as e:
        print(f"ERROR: {traceback.format_exc()}")
        return response(500, {"error": str(e)})
