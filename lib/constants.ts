import { CaseTypeConfig } from "./types";

export const SLOT_SIZE = 2;
export const NUM_SLOTS = 12;
export const SLOT_LABELS = [
  "12a", "2a", "4a", "6a", "8a", "10a",
  "12p", "2p", "4p", "6p", "8p", "10p",
];

export const CASE_TYPES: CaseTypeConfig[] = [
  { key: "cn_cfp", label: "CN CFP", color: "#ef4444" },
  { key: "row_cfp", label: "ROW CFP", color: "#f97316" },
  { key: "rev_sp", label: "Rev SP", color: "#8b5cf6" },
  { key: "kibana", label: "Kibana", color: "#06b6d4" },
  { key: "paragon", label: "Paragon", color: "#22c55e" },
  { key: "arvt", label: "ARVT", color: "#ec4899" },
];

export const MEMBER_COLORS = [
  "#6366f1", "#3b82f6", "#8b5cf6", "#f59e0b",
  "#06b6d4", "#ef4444", "#22c55e", "#ec4899",
  "#14b8a6", "#f97316", "#a855f7", "#10b981",
];

export const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
