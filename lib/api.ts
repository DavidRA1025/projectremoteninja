/**
 * ScheduleLive API Client
 * =======================
 * Replaces localStorage with API calls to the AWS backend.
 * Falls back to localStorage when the API is unavailable (offline mode).
 *
 * Environment variable:
 *   NEXT_PUBLIC_API_URL — API Gateway endpoint (e.g. https://xxx.execute-api.us-east-1.amazonaws.com/api)
 *   If not set, uses localStorage only (development mode).
 */

import { OrgData, CaseTypeConfig } from "./types";
import { loadOrg as loadOrgLocal, saveOrg as saveOrgLocal } from "./store";
import { loadCaseTypes as loadCaseTypesLocal, saveCaseTypes as saveCaseTypesLocal } from "./store";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

// Track the current org version for optimistic concurrency
let currentVersion = 0;

/**
 * Check if the API backend is configured.
 * When API_URL is empty, we fall back to localStorage (dev mode).
 */
export function isApiEnabled(): boolean {
  return API_URL.length > 0;
}

// ============ GENERIC FETCH WRAPPER ============

async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<{ data: T; version?: number; error?: string }> {
  if (!isApiEnabled()) {
    throw new Error("API not configured");
  }

  const url = `${API_URL}${path}`;
  const resp = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  const json = await resp.json();

  if (!resp.ok) {
    throw new Error(json.error || `API error: ${resp.status}`);
  }

  return json;
}

// ============ ORG DATA ============

/**
 * Load org data from API (or localStorage fallback).
 * Returns [data, version] tuple.
 */
export async function loadOrgApi(): Promise<[OrgData, number]> {
  if (!isApiEnabled()) {
    return [loadOrgLocal(), 0];
  }

  try {
    const result = await apiFetch<{ data: OrgData; version: number }>("/org");
    currentVersion = (result.data as any)?.version ?? result.version ?? 0;
    const orgData = result.data?.data ?? result.data;
    return [orgData as unknown as OrgData, currentVersion];
  } catch (err) {
    console.warn("API unavailable, falling back to localStorage:", err);
    return [loadOrgLocal(), 0];
  }
}

/**
 * Save org data to API (or localStorage fallback).
 * Includes version for optimistic concurrency control.
 */
export async function saveOrgApi(data: OrgData): Promise<{ success: boolean; error?: string }> {
  // Always save to localStorage as backup
  saveOrgLocal(data);

  if (!isApiEnabled()) {
    return { success: true };
  }

  try {
    const result = await apiFetch<{ success: boolean; version: number; error?: string }>("/org", {
      method: "PUT",
      body: JSON.stringify({ data, version: currentVersion }),
    });
    if ((result.data as any)?.version) {
      currentVersion = (result.data as any).version;
    } else if (result.version) {
      currentVersion = result.version;
    }
    return { success: true };
  } catch (err: any) {
    console.error("Failed to save to API:", err);
    return { success: false, error: err.message };
  }
}

// ============ CASE TYPES ============

/**
 * Load case types from API (or localStorage fallback).
 */
export async function loadCaseTypesApi(): Promise<CaseTypeConfig[]> {
  if (!isApiEnabled()) {
    return loadCaseTypesLocal();
  }

  try {
    const result = await apiFetch<{ data: CaseTypeConfig[] }>("/case-types");
    return result.data?.data ?? result.data ?? [];
  } catch (err) {
    console.warn("API unavailable for case-types, using localStorage:", err);
    return loadCaseTypesLocal();
  }
}

/**
 * Save case types to API (or localStorage fallback).
 */
export async function saveCaseTypesApi(types: CaseTypeConfig[]): Promise<void> {
  // Always save locally as backup
  saveCaseTypesLocal(types);

  if (!isApiEnabled()) return;

  try {
    await apiFetch("/case-types", {
      method: "PUT",
      body: JSON.stringify({ data: types }),
    });
  } catch (err) {
    console.error("Failed to save case types to API:", err);
  }
}

// ============ GRANULAR OPERATIONS ============
// These call specific endpoints for more efficient updates
// instead of saving the entire org blob.

/**
 * Add a new manager group via API.
 */
export async function addGroupApi(name: string, login: string): Promise<any> {
  if (!isApiEnabled()) return null;

  try {
    const result = await apiFetch("/group", {
      method: "POST",
      body: JSON.stringify({ name, login }),
    });
    if ((result.data as any)?.version) currentVersion = (result.data as any).version;
    return result.data;
  } catch (err) {
    console.error("Failed to add group:", err);
    return null;
  }
}

/**
 * Delete a manager group via API.
 */
export async function deleteGroupApi(groupId: string): Promise<boolean> {
  if (!isApiEnabled()) return false;

  try {
    const result = await apiFetch(`/group/${groupId}`, { method: "DELETE" });
    if ((result.data as any)?.version) currentVersion = (result.data as any).version;
    return true;
  } catch (err) {
    console.error("Failed to delete group:", err);
    return false;
  }
}

/**
 * Add a member to a group via API.
 */
export async function addMemberApi(groupId: string, memberData: any): Promise<any> {
  if (!isApiEnabled()) return null;

  try {
    const result = await apiFetch("/member", {
      method: "POST",
      body: JSON.stringify({ groupId, ...memberData }),
    });
    if ((result.data as any)?.version) currentVersion = (result.data as any).version;
    return result.data;
  } catch (err) {
    console.error("Failed to add member:", err);
    return null;
  }
}

/**
 * Delete a member via API.
 */
export async function deleteMemberApi(memberId: string): Promise<boolean> {
  if (!isApiEnabled()) return false;

  try {
    const result = await apiFetch(`/member/${memberId}`, { method: "DELETE" });
    if ((result.data as any)?.version) currentVersion = (result.data as any).version;
    return true;
  } catch (err) {
    console.error("Failed to delete member:", err);
    return false;
  }
}

/**
 * Bulk edit multiple members via API.
 */
export async function bulkEditApi(
  memberIds: string[],
  shiftStart: string,
  shiftEnd: string,
  shiftType: string,
  offDays: number[],
  trained: Record<string, boolean>
): Promise<boolean> {
  if (!isApiEnabled()) return false;

  try {
    const result = await apiFetch("/bulk", {
      method: "PUT",
      body: JSON.stringify({
        memberIds,
        shiftStart,
        shiftEnd,
        shiftType,
        offDays,
        trained,
      }),
    });
    if ((result.data as any)?.version) currentVersion = (result.data as any).version;
    return true;
  } catch (err) {
    console.error("Failed to bulk edit:", err);
    return false;
  }
}

/**
 * Get the current data version (for concurrency tracking).
 */
export function getCurrentVersion(): number {
  return currentVersion;
}
