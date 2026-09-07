/**
 * ScheduleLive Auth Guard
 * ========================
 * Include on every protected page (EXCEPT index.html which handles its own auth).
 * Redirects to / (login page) if not authenticated.
 *
 * Usage in HTML:
 *   <script src="/auth/config.js"></script>
 *   <script src="https://cdn.jsdelivr.net/npm/amazon-cognito-identity-js@6/dist/amazon-cognito-identity.min.js"></script>
 *   <script src="/auth/guard.js"></script>
 *
 * Then use:
 *   var user = AuthGuard.getCurrentUser();       // { email, name, role }
 *   var token = AuthGuard.getAuthToken();        // JWT string
 *   AuthGuard.hasRole('admin');                  // true/false
 *   AuthGuard.requireRole('admin');              // redirects if not
 *   AuthGuard.logout();
 */
var AuthGuard = (function() {
  'use strict';

  var ROLE_HIERARCHY = { super_admin: 3, admin: 2, member: 1 };
  var _cachedUser = null;
  var _cachedToken = null;
  var _ready = false;
  var _readyCallbacks = [];

  // ============ TOKEN PARSING ============
  function parseJwt(token) {
    try {
      var base64Url = token.split('.')[1];
      var base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      var jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
      }).join(''));
      return JSON.parse(jsonPayload);
    } catch (e) {
      return null;
    }
  }

  function isTokenExpired(token) {
    var payload = parseJwt(token);
    if (!payload || !payload.exp) return true;
    return Date.now() >= payload.exp * 1000;
  }

  // ============ SESSION MANAGEMENT ============
  function saveSession(idToken, accessToken, refreshToken) {
    sessionStorage.setItem('sl_id_token', idToken);
    sessionStorage.setItem('sl_access_token', accessToken);
    if (refreshToken) sessionStorage.setItem('sl_refresh_token', refreshToken);
  }

  function clearSession() {
    sessionStorage.removeItem('sl_id_token');
    sessionStorage.removeItem('sl_access_token');
    sessionStorage.removeItem('sl_refresh_token');
    _cachedUser = null;
    _cachedToken = null;
  }

  function getIdToken() {
    return sessionStorage.getItem('sl_id_token');
  }

  function getAccessToken() {
    return sessionStorage.getItem('sl_access_token');
  }

  // ============ USER INFO ============
  function extractUserFromToken(idToken) {
    var payload = parseJwt(idToken);
    if (!payload) return null;
    return {
      email: payload.email || '',
      name: payload.name || payload.email || '',
      role: payload['custom:role'] || 'member',
      sub: payload.sub || ''
    };
  }

  function getCurrentUser() {
    if (_cachedUser) return _cachedUser;
    var idToken = getIdToken();
    if (!idToken || isTokenExpired(idToken)) return null;
    _cachedUser = extractUserFromToken(idToken);
    return _cachedUser;
  }

  function getAuthToken() {
    var token = getIdToken();
    if (!token || isTokenExpired(token)) return null;
    return token;
  }

  // ============ ROLE CHECKS ============
  function hasRole(requiredRole) {
    var user = getCurrentUser();
    if (!user) return false;
    var userLevel = ROLE_HIERARCHY[user.role] || 0;
    var requiredLevel = ROLE_HIERARCHY[requiredRole] || 0;
    return userLevel >= requiredLevel;
  }

  function requireRole(requiredRole) {
    if (!hasRole(requiredRole)) {
      window.location.href = '/?access_denied=1';
      return false;
    }
    return true;
  }

  // ============ COGNITO SDK HELPERS ============
  function getCognitoUserPool() {
    if (typeof AmazonCognitoIdentity === 'undefined') return null;
    return new AmazonCognitoIdentity.CognitoUserPool({
      UserPoolId: AUTH_CONFIG.UserPoolId,
      ClientId: AUTH_CONFIG.ClientId
    });
  }

  function refreshSession(callback) {
    var pool = getCognitoUserPool();
    if (!pool) return callback(false);
    var cognitoUser = pool.getCurrentUser();
    if (!cognitoUser) return callback(false);
    cognitoUser.getSession(function(err, session) {
      if (err || !session || !session.isValid()) {
        clearSession();
        return callback(false);
      }
      saveSession(
        session.getIdToken().getJwtToken(),
        session.getAccessToken().getJwtToken(),
        session.getRefreshToken().getToken()
      );
      _cachedUser = null;
      callback(true);
    });
  }

  // ============ LOGOUT ============
  function logout() {
    var pool = getCognitoUserPool();
    if (pool) {
      var cognitoUser = pool.getCurrentUser();
      if (cognitoUser) cognitoUser.signOut();
    }
    clearSession();
    // Redirect to root (which is the login page)
    window.location.href = '/';
  }

  // ============ AUTH CHECK ON PAGE LOAD ============
  function checkAuth(options) {
    options = options || {};
    var idToken = getIdToken();

    if (!idToken) {
      if (!options.allowAnonymous) {
        window.location.href = '/?session_expired=1';
      }
      return;
    }

    if (isTokenExpired(idToken)) {
      refreshSession(function(success) {
        if (!success && !options.allowAnonymous) {
          window.location.href = '/?session_expired=1';
        } else {
          _onReady();
        }
      });
      return;
    }

    _onReady();
  }

  function _onReady() {
    _ready = true;
    _readyCallbacks.forEach(function(cb) { cb(); });
    _readyCallbacks = [];
  }

  function onReady(callback) {
    if (_ready) { callback(); }
    else { _readyCallbacks.push(callback); }
  }

  // ============ NAV BAR INJECTION ============
  function injectNavBar(containerId) {
    var user = getCurrentUser();
    if (!user) return;

    var container = document.getElementById(containerId);
    if (!container) {
      container = document.createElement('div');
      container.id = 'auth-nav-bar';
      container.style.cssText = 'position:fixed;top:12px;right:16px;display:flex;align-items:center;gap:8px;z-index:9999;font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:13px;';
      document.body.appendChild(container);
    }

    var roleColors = { super_admin: '#ef4444', admin: '#f59e0b', member: '#22c55e' };
    var roleLabels = { super_admin: 'Super Admin', admin: 'Admin', member: 'Member' };
    var color = roleColors[user.role] || '#64748b';
    var label = roleLabels[user.role] || user.role;
    var initial = (user.name || user.email || '?')[0].toUpperCase();
    var avatarColor = localStorage.getItem('rn-avatar-color') || '#6366f1';

    // Build dropdown menu
    var dropdownItems = '';
    dropdownItems += '<a href="/profile/" style="display:flex;align-items:center;gap:8px;padding:8px 14px;color:var(--text-primary);text-decoration:none;font-size:12px;font-weight:600;border-radius:6px;transition:background .15s"><i class="fas fa-user-pen" style="width:16px;color:var(--text-tertiary)"></i> Profile &amp; Settings</a>';
    if (hasRole('super_admin')) {
      dropdownItems += '<a href="/admin/" style="display:flex;align-items:center;gap:8px;padding:8px 14px;color:var(--text-primary);text-decoration:none;font-size:12px;font-weight:600;border-radius:6px;transition:background .15s"><i class="fas fa-shield-halved" style="width:16px;color:var(--text-tertiary)"></i> Admin Panel</a>';
    }
    dropdownItems += '<div style="height:1px;background:var(--border);margin:4px 8px"></div>';
    dropdownItems += '<a href="#" onclick="AuthGuard.logout();return false;" style="display:flex;align-items:center;gap:8px;padding:8px 14px;color:var(--danger);text-decoration:none;font-size:12px;font-weight:600;border-radius:6px;transition:background .15s"><i class="fas fa-right-from-bracket" style="width:16px"></i> Sign Out</a>';

    container.innerHTML = ''
      + '<span style="font-size:11px;color:var(--text-secondary);">Hi, <b style="color:var(--text-primary)">' + (user.name || user.email) + '</b></span>'
      + '<span style="padding:2px 7px;border-radius:100px;font-size:9px;font-weight:700;color:#fff;background:' + color + '">' + label + '</span>'
      + '<div style="position:relative" id="user-menu-wrap">'
      +   '<button onclick="AuthGuard._toggleMenu()" style="width:32px;height:32px;border-radius:50%;background:' + avatarColor + ';color:#fff;display:inline-flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;border:2px solid transparent;cursor:pointer;transition:all .15s" onmouseover="this.style.borderColor=\'var(--accent)\'" onmouseout="this.style.borderColor=\'transparent\'">' + initial + '</button>'
      +   '<div id="user-dropdown" style="display:none;position:absolute;top:40px;right:0;background:var(--bg-card);border:1px solid var(--border);border-radius:12px;box-shadow:var(--shadow-lg);padding:6px;min-width:200px;z-index:10000">'
      +     '<div style="padding:10px 14px 8px;border-bottom:1px solid var(--border);margin-bottom:4px">'
      +       '<div style="font-size:12px;font-weight:700;color:var(--text-heading)">' + (user.name || 'User') + '</div>'
      +       '<div style="font-size:10px;color:var(--text-tertiary)">' + user.email + '</div>'
      +     '</div>'
      +     dropdownItems
      +   '</div>'
      + '</div>';

    // Close dropdown on outside click
    document.addEventListener('click', function(e) {
      var wrap = document.getElementById('user-menu-wrap');
      var dd = document.getElementById('user-dropdown');
      if (wrap && dd && !wrap.contains(e.target)) {
        dd.style.display = 'none';
      }
    });
  }

  function _toggleMenu() {
    var dd = document.getElementById('user-dropdown');
    if (dd) {
      dd.style.display = dd.style.display === 'none' ? 'block' : 'none';
    }
  }

  // ============ API FETCH WITH AUTH ============
  function authFetch(url, options) {
    options = options || {};
    options.headers = options.headers || {};
    var token = getAuthToken();
    if (token) {
      options.headers['Authorization'] = 'Bearer ' + token;
    }
    return fetch(url, options);
  }

  // Auto-check on load (skip for index.html and auth pages)
  if (typeof window !== 'undefined') {
    var pathname = window.location.pathname;
    var isAuthPage = pathname.indexOf('/auth/') === 0;
    var isRootPage = pathname === '/' || pathname === '/index.html';
    // Root page handles its own auth (split-panel login/dashboard)
    // Auth pages don't need auth check
    if (!isAuthPage && !isRootPage) {
      checkAuth();
    }
  }

  return {
    getCurrentUser: getCurrentUser,
    getAuthToken: getAuthToken,
    hasRole: hasRole,
    requireRole: requireRole,
    logout: logout,
    checkAuth: checkAuth,
    onReady: onReady,
    injectNavBar: injectNavBar,
    _toggleMenu: _toggleMenu,
    authFetch: authFetch,
    saveSession: saveSession,
    clearSession: clearSession,
    parseJwt: parseJwt,
    getCognitoUserPool: getCognitoUserPool,
    refreshSession: refreshSession
  };
})();
