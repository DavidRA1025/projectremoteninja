export interface Shift {
  s: string; // start time "HH:MM"
  e: string; // end time "HH:MM"
  t: "morning" | "day" | "swing" | "night";
}

export interface CaseTypes {
  cn_cfp: boolean;
  row_cfp: boolean;
  rev_sp: boolean;
  kibana: boolean;
  paragon: boolean;
  arvt: boolean;
  [key: string]: boolean;
}

export interface Member {
  id: string;
  login: string;
  name: string;
  note: string;
  color: string;
  trained: CaseTypes;
  shifts: Record<number, Shift>; // key = day index (0=Mon..6=Sun)
  off: number[];
}

export interface ManagerGroup {
  id: string;
  collapsed: boolean;
  mgr: Member;
  members: Member[];
}

export type OrgData = ManagerGroup[];

export interface CaseTypeConfig {
  key: string;
  label: string;
  color: string;
}

export interface SelectionRef {
  gi: number;
  mi: number;
  isMgr: boolean;
}
