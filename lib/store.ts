import { OrgData, Member, Shift, CaseTypes, CaseTypeConfig } from "./types";
import { MEMBER_COLORS, DEFAULT_CASE_TYPES } from "./constants";

const STORAGE_KEY = "schedule-live-data";
const CASE_TYPES_KEY = "schedule-live-case-types";

// ============ HELPERS ============

export function generateId(): string {
  return Math.random().toString(36).substring(2, 10);
}

export function tH(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h + m / 60;
}

export function hToStr(h: number): string {
  h = Math.max(0, Math.min(24, h));
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return `${hh.toString().padStart(2, "0")}:${mm.toString().padStart(2, "0")}`;
}

export function classifyShift(startHour: number): Shift["t"] {
  if (startHour < 10) return "morning";
  if (startHour >= 13) return "swing";
  return "day";
}

export function ini(login: string): string {
  return login.slice(0, 2).toUpperCase();
}

export function makeShifts(
  s: string,
  e: string,
  t: Shift["t"],
  offDays: number[]
): Record<number, Shift> {
  const shifts: Record<number, Shift> = {};
  for (let i = 0; i < 7; i++) {
    if (!offDays.includes(i)) {
      shifts[i] = { s, e, t };
    }
  }
  return shifts;
}

export function emptyTrained(caseTypes: CaseTypeConfig[]): CaseTypes {
  const t: CaseTypes = {} as CaseTypes;
  caseTypes.forEach((ct) => { t[ct.key] = false; });
  return t;
}

export function nextColor(existingCount: number): string {
  return MEMBER_COLORS[existingCount % MEMBER_COLORS.length];
}

// ============ PERSISTENCE ============

export function loadOrg(): OrgData {
  if (typeof window === "undefined") return getDefaultData();
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return getDefaultData();
  try {
    return JSON.parse(raw) as OrgData;
  } catch {
    return getDefaultData();
  }
}

export function saveOrg(data: OrgData): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function loadCaseTypes(): CaseTypeConfig[] {
  if (typeof window === "undefined") return DEFAULT_CASE_TYPES;
  const raw = localStorage.getItem(CASE_TYPES_KEY);
  if (!raw) return DEFAULT_CASE_TYPES;
  try {
    return JSON.parse(raw) as CaseTypeConfig[];
  } catch {
    return DEFAULT_CASE_TYPES;
  }
}

export function saveCaseTypes(types: CaseTypeConfig[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(CASE_TYPES_KEY, JSON.stringify(types));
}

// ============ DEFAULT (EMPTY) DATA ============
// Ships with one empty manager group as a starting point.

function getDefaultData(): OrgData {
  return [
    {
      id: generateId(),
      collapsed: false,
      mgr: {
        id: generateId(),
        login: "manager1",
        name: "Manager A",
        note: "",
        color: "#6366f1",
        trained: {},
        shifts: makeShifts("08:00", "17:00", "day", [5, 6]),
        off: [5, 6],
      },
      members: [
        {
          id: generateId(),
          login: "agent1",
          name: "Agent 1",
          note: "",
          color: "#3b82f6",
          trained: {},
          shifts: makeShifts("06:00", "14:00", "morning", [4, 5]),
          off: [4, 5],
        },
        {
          id: generateId(),
          login: "agent2",
          name: "Agent 2",
          note: "",
          color: "#8b5cf6",
          trained: {},
          shifts: makeShifts("14:00", "22:00", "swing", [5, 6]),
          off: [5, 6],
        },
      ],
    },
  ];
}
