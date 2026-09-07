"use client";

import { useEffect, useState } from "react";

/**
 * Auth Check for the Next.js Schedule app.
 * Checks sessionStorage for a valid JWT token.
 * If not found or expired, redirects to /auth/login.html.
 *
 * Usage: Wrap your page content:
 *   <AuthCheck>{children}</AuthCheck>
 */
export default function AuthCheck({ children }: { children: React.ReactNode }) {
  const [checked, setChecked] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);

  useEffect(() => {
    const token = sessionStorage.getItem("sl_id_token");
    if (!token) {
      window.location.href = "/auth/login.html?redirect=" + encodeURIComponent(window.location.pathname);
      return;
    }

    // Check expiry
    try {
      const payload = JSON.parse(
        atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))
      );
      if (payload.exp && Date.now() >= payload.exp * 1000) {
        sessionStorage.removeItem("sl_id_token");
        sessionStorage.removeItem("sl_access_token");
        window.location.href = "/auth/login.html?redirect=" + encodeURIComponent(window.location.pathname);
        return;
      }
    } catch {
      window.location.href = "/auth/login.html";
      return;
    }

    setAuthenticated(true);
    setChecked(true);
  }, []);

  if (!checked || !authenticated) {
    return (
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
        color: "#94a3b8",
        fontFamily: "-apple-system, sans-serif",
        background: "#0f172a"
      }}>
        <div style={{ textAlign: "center" }}>
          <div style={{
            width: 24, height: 24,
            border: "3px solid #334155",
            borderTopColor: "#6366f1",
            borderRadius: "50%",
            animation: "spin 0.6s linear infinite",
            margin: "0 auto 12px"
          }} />
          Checking authentication...
          <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
