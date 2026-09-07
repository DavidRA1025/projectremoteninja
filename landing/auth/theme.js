/**
 * Remote Ninja — Theme Toggle (Light / Dark)
 * ============================================
 * Include on every page AFTER theme.css.
 *
 * API:
 *   ThemeManager.toggle()          — switch theme
 *   ThemeManager.set('dark')       — force theme
 *   ThemeManager.current()         — 'light' | 'dark'
 *   ThemeManager.injectToggle(el)  — render toggle button into a container
 *   ThemeManager.injectFloating()  — render floating toggle (top-right)
 *
 * Persistence: localStorage key "rn-theme"
 * Default: follows OS prefers-color-scheme
 */
var ThemeManager = (function() {
  'use strict';

  var STORAGE_KEY = 'rn-theme';

  // Determine initial theme: saved → OS → light
  function getInitial() {
    var saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
    return 'light';
  }

  // Apply theme to <html>
  function apply(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(STORAGE_KEY, theme);
    // Update any existing toggle buttons
    document.querySelectorAll('.theme-toggle').forEach(function(btn) {
      btn.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
      btn.setAttribute('title', theme === 'dark' ? 'Light mode' : 'Dark mode');
    });
  }

  function current() {
    return document.documentElement.getAttribute('data-theme') || 'light';
  }

  function toggle() {
    apply(current() === 'dark' ? 'light' : 'dark');
  }

  function set(theme) {
    apply(theme);
  }

  // Create the toggle button HTML
  function createToggleButton() {
    var btn = document.createElement('button');
    btn.className = 'theme-toggle';
    btn.type = 'button';
    btn.setAttribute('aria-label', current() === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
    btn.setAttribute('title', current() === 'dark' ? 'Light mode' : 'Dark mode');
    btn.innerHTML = '<span class="theme-icon theme-icon-sun">☀️</span><span class="theme-icon theme-icon-moon">🌙</span>';
    btn.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      toggle();
    });
    return btn;
  }

  // Render toggle into an existing element
  function injectToggle(container) {
    if (typeof container === 'string') container = document.getElementById(container);
    if (!container) return;
    container.appendChild(createToggleButton());
  }

  // Render floating toggle (top-right corner, behind nav)
  function injectFloating() {
    // Don't duplicate
    if (document.getElementById('rn-theme-floating')) return;
    var wrap = document.createElement('div');
    wrap.id = 'rn-theme-floating';
    wrap.style.cssText = 'position:fixed;top:14px;right:16px;z-index:998;';
    wrap.appendChild(createToggleButton());
    document.body.appendChild(wrap);
  }

  // Apply immediately (before DOMContentLoaded) to prevent flash
  apply(getInitial());

  // Listen for OS theme changes
  if (window.matchMedia) {
    try {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function(e) {
        // Only follow OS if user hasn't manually set
        if (!localStorage.getItem(STORAGE_KEY)) {
          apply(e.matches ? 'dark' : 'light');
        }
      });
    } catch(e) {
      // Safari 13 fallback
      window.matchMedia('(prefers-color-scheme: dark)').addListener(function(e) {
        if (!localStorage.getItem(STORAGE_KEY)) apply(e.matches ? 'dark' : 'light');
      });
    }
  }

  return {
    toggle: toggle,
    set: set,
    current: current,
    injectToggle: injectToggle,
    injectFloating: injectFloating,
    createToggleButton: createToggleButton
  };
})();
