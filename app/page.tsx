"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { OrgData, Member, Shift, SelectionRef, CaseTypes, ManagerGroup, CaseTypeConfig } from "@/lib/types";
import { loadOrg, saveOrg, loadCaseTypes, saveCaseTypes, generateId, tH, hToStr, classifyShift, ini, makeShifts, emptyTrained, nextColor } from "@/lib/store";
import { SLOT_SIZE, NUM_SLOTS, SLOT_LABELS, DAY_NAMES } from "@/lib/constants";


function getWeekDays(baseDate: Date) {
  const d = new Date(baseDate);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  const days = [];
  const today = new Date();
  const todayStr = today.toDateString();
  for (let i = 0; i < 7; i++) {
    const dd = new Date(d);
    dd.setDate(d.getDate() + i);
    days.push({
      name: DAY_NAMES[i],
      date: dd.getDate(),
      month: dd.toLocaleString("en", { month: "short" }),
      fullDate: dd.toDateString(),
      isToday: dd.toDateString() === todayStr,
      isWeekend: i >= 5,
      di: i,
    });
  }
  return days;
}

function formatWeekRange(days: ReturnType<typeof getWeekDays>) {
  return `${days[0].name} ${days[0].month} ${days[0].date} - ${days[6].name} ${days[6].month} ${days[6].date}`;
}

export default function SchedulePage() {
  const [org, setOrg] = useState<OrgData>([]);
  const [mounted, setMounted] = useState(false);
  const [caseTypes, setCaseTypes] = useState<CaseTypeConfig[]>([]);
  const [dark, setDark] = useState(false);
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [selected, setSelected] = useState<SelectionRef[]>([]);
  const [weekOffset, setWeekOffset] = useState(0);
  const [toast, setToast] = useState("");
  const [editModal, setEditModal] = useState<{ gi: number; mi: number; di: number; isMgr: boolean } | null>(null);
  const [bulkModal, setBulkModal] = useState(false);
  const [addModal, setAddModal] = useState(false);
  const [addGroupModal, setAddGroupModal] = useState(false);
  const [settingsModal, setSettingsModal] = useState(false);

  useEffect(() => { setOrg(loadOrg()); setCaseTypes(loadCaseTypes()); setMounted(true); }, []);
  useEffect(() => { if (mounted) saveOrg(org); }, [org, mounted]);
  useEffect(() => { if (mounted) saveCaseTypes(caseTypes); }, [caseTypes, mounted]);
  useEffect(() => { document.documentElement.classList.toggle("dark", dark); }, [dark]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2500);
  }, []);

  const baseDate = new Date();
  baseDate.setDate(baseDate.getDate() + weekOffset * 7);
  const DAYS = getWeekDays(baseDate);
  const nowH = new Date().getHours();

  const allPeople = (): Member[] => {
    const a: Member[] = [];
    org.forEach((g) => { a.push(g.mgr); g.members.forEach((m) => a.push(m)); });
    return a;
  };
  const getRef = (s: SelectionRef): Member => s.isMgr ? org[s.gi].mgr : org[s.gi].members[s.mi];
  const isSelected = (gi: number, mi: number, isMgr: boolean) => selected.some((s) => s.gi === gi && s.mi === mi && s.isMgr === isMgr);
  const toggleSelect = (gi: number, mi: number, isMgr: boolean) => {
    setSelected((prev) => {
      const idx = prev.findIndex((s) => s.gi === gi && s.mi === mi && s.isMgr === isMgr);
      if (idx >= 0) return prev.filter((_, i) => i !== idx);
      return [...prev, { gi, mi, isMgr }];
    });
  };
  const isTrained = (m: Member): boolean => { if (!activeFilter) return true; return !!m.trained[activeFilter]; };

  const updateShift = (gi: number, mi: number, di: number, isMgr: boolean, shift: Shift | null) => {
    setOrg((prev) => {
      const next = JSON.parse(JSON.stringify(prev)) as OrgData;
      const m = isMgr ? next[gi].mgr : next[gi].members[mi];
      if (shift) { m.shifts[di] = shift; m.off = m.off.filter((d) => d !== di); }
      else { delete m.shifts[di]; if (!m.off.includes(di)) m.off.push(di); }
      return next;
    });
  };

  const bulkApply = (refs: SelectionRef[], s: string, e: string, t: Shift["t"], offDays: number[], trained: CaseTypes) => {
    setOrg((prev) => {
      const next = JSON.parse(JSON.stringify(prev)) as OrgData;
      refs.forEach((ref) => {
        const m = ref.isMgr ? next[ref.gi].mgr : next[ref.gi].members[ref.mi];
        m.off = [...offDays]; m.trained = { ...trained }; m.shifts = {};
        for (let i = 0; i < 7; i++) { if (!offDays.includes(i)) m.shifts[i] = { s, e, t }; }
      });
      return next;
    });
    showToast("Applied to " + refs.length + " people");
    setSelected([]);
  };

  const addMember = (gi: number, login: string, s: string, e: string, offDays: number[], trained: CaseTypes) => {
    setOrg((prev) => {
      const next = JSON.parse(JSON.stringify(prev)) as OrgData;
      next[gi].members.push({ id: generateId(), login, name: login, note: "", color: nextColor(next[gi].members.length + 1), trained, shifts: makeShifts(s, e, classifyShift(tH(s)), offDays), off: offDays });
      return next;
    });
    showToast("Added " + login + "!");
  };

  const addGroup = (name: string, login: string) => {
    setOrg((prev) => [...prev, { id: generateId(), collapsed: false, mgr: { id: generateId(), login, name, note: "", color: nextColor(prev.length), trained: emptyTrained(caseTypes), shifts: makeShifts("08:00", "17:00", "day", [5, 6]), off: [5, 6] }, members: [] }]);
    showToast("Added team: " + name);
  };

  const removeGroup = (gi: number) => { setOrg((prev) => prev.filter((_, i) => i !== gi)); setSelected([]); };
  const removeMember = (gi: number, mi: number) => { setOrg((prev) => { const next = JSON.parse(JSON.stringify(prev)); next[gi].members.splice(mi, 1); return next; }); setSelected([]); };
  const toggleCollapse = (gi: number) => { setOrg((prev) => { const next = [...prev]; next[gi] = { ...next[gi], collapsed: !next[gi].collapsed }; return next; }); };

  // Drag
  const dragRef = useRef<any>(null);
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current; if (!d) return;
      const dx = e.clientX - d.startX; if (Math.abs(dx) > 3) d.didDrag = true;
      const dP = (dx / d.containerW) * 100; const sP = 100 / NUM_SLOTS;
      if (d.mode === "right") { let w = Math.max(sP, d.origWidthPct + dP); w = Math.round(w / sP) * sP; w = Math.min(w, 100 - d.origLeftPct); d.el.style.width = w + "%"; }
      else if (d.mode === "left") { let l = d.origLeftPct + dP; l = Math.round(l / sP) * sP; l = Math.max(0, l); let w2 = d.origWidthPct - (l - d.origLeftPct); if (w2 < sP) { l = d.origLeftPct + d.origWidthPct - sP; w2 = sP; } d.el.style.left = l + "%"; d.el.style.width = w2 + "%"; }
      else { let l2 = d.origLeftPct + dP; l2 = Math.round(l2 / sP) * sP; l2 = Math.max(0, Math.min(l2, 100 - d.origWidthPct)); d.el.style.left = l2 + "%"; }
      const cL = parseFloat(d.el.style.left); const cW = parseFloat(d.el.style.width);
      const lbl = d.el.querySelector(".sh-label"); if (lbl) lbl.textContent = hToStr((cL / 100) * 24) + " - " + hToStr((cL / 100) * 24 + (cW / 100) * 24);
    };
    const onUp = () => {
      const d = dragRef.current; if (!d) return; d.el.style.opacity = "1";
      if (d.didDrag) {
        const cL = parseFloat(d.el.style.left); const cW = parseFloat(d.el.style.width);
        let sH = Math.round(((cL / 100) * 24) / SLOT_SIZE) * SLOT_SIZE;
        let eH = Math.round((sH + (cW / 100) * 24) / SLOT_SIZE) * SLOT_SIZE;
        if (eH <= sH) eH = sH + SLOT_SIZE; if (eH > 24) eH = 24;
        updateShift(d.gi, d.mi, d.di, d.isMgr, { s: hToStr(sH), e: hToStr(eH), t: classifyShift(sH) });
        showToast(hToStr(sH) + " - " + hToStr(eH));
      } else if (d.mode === "move") { setEditModal({ gi: d.gi, mi: d.mi, di: d.di, isMgr: d.isMgr }); }
      dragRef.current = null;
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
  }, [org]);

  const startDrag = (e: React.MouseEvent, mode: string, gi: number, mi: number, di: number, isMgr: boolean) => {
    e.preventDefault(); e.stopPropagation();
    const block = (e.target as HTMLElement).closest(".shift-block") as HTMLElement; if (!block) return;
    block.style.opacity = "0.8";
    dragRef.current = { el: block, mode, gi, mi, di, isMgr, startX: e.clientX, origLeftPct: parseFloat(block.style.left), origWidthPct: parseFloat(block.style.width), containerW: block.parentElement!.getBoundingClientRect().width, didDrag: false };
  };

  if (!mounted) return <div className="flex items-center justify-center h-screen text-slate-400">Loading...</div>;

  const todayDi = DAYS.find((d) => d.isToday)?.di ?? -1;
  const ap = allPeople();
  const filteredPeople = activeFilter ? ap.filter((m) => isTrained(m)) : ap;
  const workingToday = filteredPeople.filter((m) => m.shifts && m.shifts[todayDi]).length;

  const shiftBg: Record<string, string> = { morning: "linear-gradient(135deg,#f59e0b,#fbbf24)", day: "linear-gradient(135deg,#3b82f6,#60a5fa)", swing: "linear-gradient(135deg,#8b5cf6,#a78bfa)", night: "linear-gradient(135deg,#475569,#64748b)" };

  return (
    <div className="min-h-screen select-none">
      {/* TOP BAR */}
      <div className="sticky top-0 z-50 flex items-center justify-between px-5 py-2.5 bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center text-white text-xs font-extrabold">SL</div>
          <span className="text-sm font-bold">Schedule <span className="text-indigo-500">Live</span></span>
          <span className="inline-flex items-center gap-1 text-[9px] font-bold text-green-500 bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 px-2 py-0.5 rounded-full ml-2"><span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />LIVE</span>
        </div>
      <div className="flex items-center gap-1.5">
          <button className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-600 text-xs" onClick={() => setDark(!dark)}><i className={"fa-solid fa-" + (dark ? "sun" : "moon")} /></button>
          <button className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 text-xs font-semibold flex items-center gap-1 hover:border-indigo-400 hover:text-indigo-500 transition" onClick={() => setSettingsModal(true)}><i className="fa-solid fa-gear" /> Case Types</button>
          <button className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 text-xs font-semibold flex items-center gap-1" onClick={() => setAddGroupModal(true)}><i className="fa-solid fa-sitemap" /> Add Team</button>
          <button className="px-2.5 py-1.5 rounded-lg bg-indigo-500 text-white text-xs font-semibold flex items-center gap-1" onClick={() => setAddModal(true)}><i className="fa-solid fa-plus" /> Add Member</button>
        </div>
      </div>

      <div className="px-5 py-3.5">
        {/* Week nav */}
        <div className="flex items-center justify-between mb-2.5 flex-wrap gap-2">
          <div className="flex items-center gap-1.5">
            <button className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-600 text-xs font-semibold" onClick={() => setWeekOffset((w) => w - 1)}><i className="fa-solid fa-chevron-left" /></button>
            <button className="px-3 py-1 rounded-lg border border-slate-200 dark:border-slate-600 text-xs font-bold flex items-center gap-1" onClick={() => setWeekOffset(0)}><i className="fa-regular fa-calendar" /> {formatWeekRange(DAYS)}</button>
            <button className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-600 text-xs font-semibold" onClick={() => setWeekOffset((w) => w + 1)}><i className="fa-solid fa-chevron-right" /></button>
          </div>
          <span className="text-[10px] text-slate-400"><i className="fa-solid fa-hand-pointer mr-1" />Drag edges to resize | Click to edit | Checkbox for bulk</span>
        </div>

        {/* Filter bar */}
        <div className="flex items-center gap-1.5 mb-3 flex-wrap p-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mr-1"><i className="fa-solid fa-filter mr-1" />Case</span>
          <button className={"px-3 py-1 rounded-full text-[10px] font-bold border " + (activeFilter === null ? "bg-indigo-500 text-white border-indigo-500" : "border-slate-200 dark:border-slate-600 text-slate-500")} onClick={() => setActiveFilter(null)}>All</button>
          {caseTypes.map((ct) => {
            const count = ap.filter((m) => m.trained[ct.key]).length;
            return <button key={ct.key} className={"px-3 py-1 rounded-full text-[10px] font-bold border " + (activeFilter === ct.key ? "text-white border-transparent" : "border-slate-200 dark:border-slate-600 text-slate-500")} style={activeFilter === ct.key ? { background: ct.color } : {}} onClick={() => setActiveFilter(activeFilter === ct.key ? null : ct.key)}>{ct.label} <span className="opacity-70 font-mono">{count}</span></button>;
          })}
        </div>

        {/* Bulk bar */}
        {selected.length > 0 && (
          <div className="flex items-center gap-2 mb-3 p-2.5 bg-gradient-to-r from-indigo-500 to-purple-500 rounded-xl text-white text-xs font-semibold">
            <span className="text-base font-extrabold font-mono bg-white/20 px-2 py-0.5 rounded-md">{selected.length}</span>
            <span>selected</span>
            <span className="flex-1 text-[10px] opacity-70 truncate">{selected.map((s) => getRef(s).login).join(", ")}</span>
            <button className="px-3 py-1 rounded-lg bg-white text-indigo-600 font-bold" onClick={() => setBulkModal(true)}><i className="fa-solid fa-pen-to-square mr-1" />Bulk Edit</button>
            <button className="px-3 py-1 rounded-lg border border-white/30 bg-white/10" onClick={() => setSelected([])}><i className="fa-solid fa-xmark mr-1" />Clear</button>
          </div>
        )}

        {/* Stats */}
        <div className="flex gap-1.5 mb-3 flex-wrap">
          {[{ icon: "fa-sitemap", color: "#8b5cf6", n: org.length, l: "Managers" }, { icon: "fa-users", color: "#6366f1", n: filteredPeople.length, l: activeFilter ? "Trained" : "People" }, { icon: "fa-circle-check", color: "#22c55e", n: workingToday, l: "On Today" }, { icon: "fa-check-double", color: "#6366f1", n: selected.length, l: "Selected" }].map((s, i) => (
            <div key={i} className="flex items-center gap-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-1.5">
              <i className={"fa-solid " + s.icon + " text-[11px]"} style={{ color: s.color }} />
              <div><div className="text-base font-extrabold font-mono">{s.n}</div><div className="text-[9px] text-slate-400 uppercase tracking-wide font-semibold">{s.l}</div></div>
            </div>
          ))}
        </div>

        {/* Manager groups */}
        {org.map((g, gi) => {
          const ppl = [g.mgr, ...g.members];
          const trainedPpl = activeFilter ? ppl.filter((m) => isTrained(m)) : ppl;
          const todayOn = trainedPpl.filter((m) => m.shifts && m.shifts[todayDi]).length;
          return (
            <div key={g.id} className="mb-3.5 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden shadow-sm">
              <div className="flex items-center justify-between px-3.5 py-2.5 bg-white dark:bg-slate-800 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/50 border-b border-slate-200 dark:border-slate-700" onClick={() => toggleCollapse(gi)}>
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white border-2 border-white" style={{ background: g.mgr.color, boxShadow: "0 0 0 2px #818cf8" }}>{ini(g.mgr.login)}</div>
                  <div><h3 className="text-sm font-bold">{g.mgr.name}</h3><div className="text-[10px] text-slate-400">Manager | {ppl.length} people</div></div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[10px] font-semibold text-green-500"><i className="fa-solid fa-check-circle mr-1" />{todayOn} today</span>
                  <button className="text-[10px] text-red-400 hover:text-red-500 px-2" onClick={(e) => { e.stopPropagation(); if (confirm("Remove " + g.mgr.name + "'s team?")) removeGroup(gi); }}><i className="fa-solid fa-trash" /></button>
                  <i className={"fa-solid fa-chevron-down text-slate-400 text-xs transition-transform " + (g.collapsed ? "-rotate-90" : "")} />
                </div>
              </div>
              {!g.collapsed && (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-[11px] min-w-[960px]">
                    <thead><tr>
                      <th className="bg-slate-50 dark:bg-slate-800 text-slate-400 text-[9px] uppercase tracking-wider font-bold p-1.5 text-left pl-3 min-w-[190px] sticky left-0 z-[6] border-b-2 border-slate-200 dark:border-slate-700" />
                      {DAYS.map((d) => (<th key={d.di} className={"text-[9px] uppercase tracking-wider font-bold p-1.5 text-center border-b-2 min-w-[120px] " + (d.isToday ? "bg-indigo-50 dark:bg-indigo-900/30 text-indigo-500 border-indigo-200" : d.isWeekend ? "text-amber-500 bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700" : "text-slate-400 bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700")}>{d.name}<span className={"block text-sm font-mono " + (d.isToday ? "text-indigo-500" : d.isWeekend ? "text-amber-500" : "text-slate-800 dark:text-slate-200")}>{d.date}</span></th>))}
                    </tr></thead>
                    <tbody>
                      {/* Ruler */}
                      <tr><td className="text-[8px] text-slate-400 pl-3 bg-slate-50 dark:bg-slate-800 sticky left-0 z-[3] border-r border-slate-200 dark:border-slate-700">24hr</td>
                        {DAYS.map((d) => (<td key={d.di} className="bg-slate-50 dark:bg-slate-800 p-0 px-0.5"><div className="flex">{SLOT_LABELS.map((l, i) => (<span key={i} className="flex-1 text-center text-[7px] text-slate-400 font-semibold font-mono py-0.5 border-r border-slate-200 dark:border-slate-700 last:border-r-0">{l}</span>))}</div></td>))}
                      </tr>
                      {/* Members */}
                      {ppl.map((m, idx) => {
                        const isMgr = idx === 0; const miVal = isMgr ? -1 : idx - 1;
                        const t2 = isTrained(m); const sel = isSelected(gi, miVal, isMgr);
                        return (
                          <tr key={m.id} className={"group " + (isMgr ? "bg-indigo-50/50 dark:bg-indigo-900/20 " : "") + (sel ? "!bg-indigo-50 dark:!bg-indigo-900/30 " : "") + (!t2 && activeFilter ? "opacity-25 grayscale" : "")}>
                            <td className="pl-2 pr-1 sticky left-0 z-[3] bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-700">
                              <div className="flex items-center gap-1.5">
                                <div className={"w-[18px] h-[18px] rounded-[5px] border-2 flex items-center justify-center cursor-pointer text-[10px] shrink-0 " + (sel ? "bg-indigo-500 border-indigo-500 text-white" : "border-slate-300 dark:border-slate-600 text-transparent")} onClick={() => toggleSelect(gi, miVal, isMgr)}>{sel ? "V" : ""}</div>
                                <div className={"w-[26px] h-[26px] rounded-full flex items-center justify-center text-[9px] font-bold text-white shrink-0 " + (isMgr ? "border-2 border-indigo-400" : "")} style={{ background: m.color }}>{ini(m.login)}</div>
                                <div className="min-w-0">
                                  <div className={"text-[11px] font-semibold truncate " + (isMgr ? "text-indigo-500" : "")}>{m.name || m.login}</div>
                                  <div className="flex gap-0.5 flex-wrap mt-0.5">{caseTypes.filter((ct) => m.trained[ct.key]).map((ct) => (<span key={ct.key} className="text-[7px] font-bold px-1 rounded text-white" style={{ background: ct.color }}>{ct.label}</span>))}</div>
                                </div>
                                {!isMgr && <button className="ml-auto text-[9px] text-red-300 hover:text-red-500 opacity-0 group-hover:opacity-100 px-1" onClick={() => { if (confirm("Remove " + m.login + "?")) removeMember(gi, miVal); }}><i className="fa-solid fa-xmark" /></button>}
                              </div>
                            </td>
                            {DAYS.map((d) => {
                              const sh = m.shifts ? m.shifts[d.di] : undefined; const isOff = !sh;
                              return (
                                <td key={d.di} className={"p-0.5 " + (d.isToday ? "bg-indigo-50/40 dark:bg-indigo-900/10" : "")}>
                                  {isOff ? (
                                    <div className="relative h-8 rounded-md overflow-hidden cursor-pointer" style={{ background: "repeating-linear-gradient(45deg,#f1f5f9,#f1f5f9 3px,#e2e8f0 3px,#e2e8f0 6px)" }} onClick={() => setEditModal({ gi, mi: miVal, di: d.di, isMgr })}><div className="absolute inset-0 flex items-center justify-center text-xs font-semibold text-slate-400"><i className="fa-solid fa-bed mr-1 text-[8px]" />OFF</div></div>
                                  ) : (
                                    <div className="relative h-8 rounded-md overflow-visible bg-slate-100 dark:bg-slate-700">
                                      <div className="absolute inset-0 flex pointer-events-none">{Array.from({ length: NUM_SLOTS }).map((_, i) => (<div key={i} className="flex-1" style={{ borderRight: i < NUM_SLOTS - 1 ? (i === 3 || i === 6 || i === 9 ? "1px solid rgba(0,0,0,0.12)" : "1px solid rgba(0,0,0,0.05)") : "none" }} />))}</div>
                                      {d.isToday && <div className="absolute top-[-2px] bottom-[-2px] w-[2px] bg-red-500 z-[4] pointer-events-none" style={{ left: (nowH / 24 * 100) + "%" }}><div className="absolute top-[-2px] left-[-2px] w-[6px] h-[6px] rounded-full bg-red-500" /></div>}
                                      <div className="shift-block absolute top-[2px] bottom-[2px] rounded-[5px] flex items-center justify-center z-[3] cursor-grab hover:shadow-lg transition-shadow" style={{ left: (tH(sh!.s) / 24 * 100) + "%", width: ((tH(sh!.e) - tH(sh!.s)) / 24 * 100) + "%", background: shiftBg[sh!.t] || shiftBg.day }} onMouseDown={(e) => startDrag(e, "move", gi, miVal, d.di, isMgr)}>
                                        <div className="absolute top-0 bottom-0 left-0 w-2 cursor-ew-resize hover:bg-white/30 z-[5]" onMouseDown={(e) => startDrag(e, "left", gi, miVal, d.di, isMgr)}><div className="absolute top-1/2 -translate-y-1/2 left-[2px] w-[2px] h-3 bg-white/50 rounded-sm" /></div>
                                        <span className="sh-label text-[8px] font-bold text-white drop-shadow pointer-events-none whitespace-nowrap overflow-hidden text-ellipsis px-1">{sh!.s} - {sh!.e}</span>
                                        <div className="absolute top-0 bottom-0 right-0 w-2 cursor-ew-resize hover:bg-white/30 z-[5]" onMouseDown={(e) => startDrag(e, "right", gi, miVal, d.di, isMgr)}><div className="absolute top-1/2 -translate-y-1/2 right-[2px] w-[2px] h-3 bg-white/50 rounded-sm" /></div>
                                      </div>
                                    </div>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                      {/* Coverage */}
                      <tr><td className="text-[9px] font-bold text-slate-400 pl-3 bg-slate-50 dark:bg-slate-800 sticky left-0 z-[3] border-r border-slate-200 dark:border-slate-700"><i className="fa-solid fa-layer-group mr-1" />Coverage</td>
                        {DAYS.map((d) => (<td key={d.di} className="bg-slate-50 dark:bg-slate-800 p-0.5"><div className="flex h-[18px] rounded overflow-hidden">{Array.from({ length: NUM_SLOTS }).map((_, si) => { const slotS = si * SLOT_SIZE; const slotE = (si + 1) * SLOT_SIZE; const base = activeFilter ? trainedPpl : ppl; const c = base.filter((m) => { const s = m.shifts ? m.shifts[d.di] : null; if (!s) return false; return tH(s.s) < slotE && tH(s.e) > slotS; }).length; const maxC = base.length; let bg = "transparent"; let color = "#94a3b8"; if (maxC > 0 && c >= maxC * 0.7) { bg = "#f0fdf4"; color = "#22c55e"; } else if (c > 0) { bg = "#eef2ff"; color = "#6366f1"; } return <div key={si} className="flex-1 flex items-center justify-center text-[7px] font-bold border-r border-slate-200/50 last:border-r-0" style={{ background: bg, color }}>{c > 0 ? c : ""}</div>; })}</div></td>))}
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}

        {/* Org coverage */}
        <div className="mt-3.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-3.5 shadow-sm">
          <h4 className="text-xs font-bold mb-2.5"><i className="fa-solid fa-globe text-indigo-500 mr-1.5" />All Teams - Daily Headcount</h4>
          <div className="flex gap-1">
            {DAYS.map((d) => { const c = filteredPeople.filter((m) => m.shifts && m.shifts[d.di]).length; const maxP = filteredPeople.length || 1; const pct = Math.round((c / maxP) * 100); const col = pct >= 70 ? "#22c55e" : pct >= 40 ? "#f59e0b" : "#ef4444"; const bg = pct >= 70 ? "#f0fdf4" : pct >= 40 ? "#f1f5f9" : "#fef2f2"; return (
              <div key={d.di} className="flex-1 text-center p-2.5 rounded-lg border border-slate-200 dark:border-slate-700" style={{ background: bg, boxShadow: d.isToday ? "0 0 0 2px #6366f1" : "none" }}>
                <div className="text-[9px] font-bold text-slate-400">{d.name}</div>
                <div className="text-xl font-extrabold font-mono" style={{ color: col }}>{c}</div>
                <div className="text-[9px] text-slate-400">of {maxP}</div>
                <div className="w-full h-1 bg-slate-200 rounded-full overflow-hidden mt-1"><div className="h-full rounded-full" style={{ width: pct + "%", background: col }} /></div>
              </div>
            ); })}
          </div>
        </div>
      </div>

      {/* MODALS */}
      {editModal && <EditModal org={org} m={editModal} days={DAYS} onSave={(sh) => { updateShift(editModal.gi, editModal.mi, editModal.di, editModal.isMgr, sh); setEditModal(null); showToast("Updated!"); }} onClose={() => setEditModal(null)} />}
      {bulkModal && <BulkModal sel={selected} org={org} onApply={bulkApply} onClose={() => setBulkModal(false)} />}
      {addModal && <AddModal org={org} caseTypes={caseTypes} onAdd={addMember} onClose={() => setAddModal(false)} />}
      {addGroupModal && <AddGroupModal onAdd={addGroup} onClose={() => setAddGroupModal(false)} />}
      {settingsModal && <SettingsModal caseTypes={caseTypes} onSave={(ct) => { setCaseTypes(ct); setSettingsModal(false); showToast("Case types updated!"); }} onClose={() => setSettingsModal(false)} />}
      {toast && <div className="fixed bottom-4 right-4 bg-slate-900 text-white px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 shadow-xl z-[300]"><i className="fa-solid fa-circle-check" />{toast}</div>}
    </div>
  );
}

function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[200] flex items-center justify-center" onClick={onClose}><div className="bg-white dark:bg-slate-800 rounded-2xl p-5 w-[400px] max-w-[92vw] shadow-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>{children}</div></div>;
}
function Lbl({ children }: { children: React.ReactNode }) { return <label className="block text-[10px] font-semibold text-slate-500 mt-2 mb-0.5 uppercase tracking-wide">{children}</label>; }

function EditModal({ org, m, days, onSave, onClose }: any) {
  const member = m.isMgr ? org[m.gi].mgr : org[m.gi].members[m.mi];
  const sh = member.shifts?.[m.di];
  const [start, setStart] = useState(sh?.s || "08:00");
  const [end, setEnd] = useState(sh?.e || "17:00");
  const [type, setType] = useState(sh?.t || "day");
  const [status, setStatus] = useState(sh ? "working" : "off");
  return <Overlay onClose={onClose}><h3 className="text-sm font-bold mb-3"><i className="fa-solid fa-pen-to-square text-indigo-500 mr-1.5" />{member.name} - {days.find((d: any) => d.di === m.di)?.name}</h3>
    <Lbl>Start</Lbl><input type="time" value={start} onChange={(e) => setStart(e.target.value)} className="w-full p-1.5 border border-slate-200 dark:border-slate-600 rounded-lg text-sm bg-slate-50 dark:bg-slate-700" step={1800} />
    <Lbl>End</Lbl><input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className="w-full p-1.5 border border-slate-200 dark:border-slate-600 rounded-lg text-sm bg-slate-50 dark:bg-slate-700" step={1800} />
    <Lbl>Type</Lbl><select value={type} onChange={(e) => setType(e.target.value)} className="w-full p-1.5 border border-slate-200 dark:border-slate-600 rounded-lg text-sm bg-slate-50 dark:bg-slate-700"><option value="morning">Morning</option><option value="day">Day</option><option value="swing">Swing</option><option value="night">Night</option></select>
    <Lbl>Status</Lbl><select value={status} onChange={(e) => setStatus(e.target.value)} className="w-full p-1.5 border border-slate-200 dark:border-slate-600 rounded-lg text-sm bg-slate-50 dark:bg-slate-700"><option value="working">Working</option><option value="off">Day Off</option></select>
    <div className="flex gap-1.5 mt-3.5 justify-end"><button className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold" onClick={onClose}>Cancel</button><button className="px-3 py-1.5 rounded-lg bg-indigo-500 text-white text-xs font-semibold" onClick={() => onSave(status === "off" ? null : { s: start, e: end, t: type })}><i className="fa-solid fa-check mr-1" />Save</button></div>
  </Overlay>;
}

function BulkModal({ sel, org, onApply, onClose }: any) {
  const first = sel[0].isMgr ? org[sel[0].gi].mgr : org[sel[0].gi].members[sel[0].mi];
  const fsh = Object.values(first.shifts)[0] as Shift | undefined;
  const [start, setStart] = useState(fsh?.s || "08:00");
  const [end, setEnd] = useState(fsh?.e || "17:00");
  const [type, setType] = useState<Shift["t"]>(fsh?.t || "day");
  const [offDays, setOffDays] = useState<number[]>([...first.off]);
  const [trained, setTrained] = useState<CaseTypes>({ ...first.trained });
  return <Overlay onClose={onClose}><h3 className="text-sm font-bold mb-2"><i className="fa-solid fa-users-gear text-indigo-500 mr-1.5" />Bulk Edit ({sel.length} people)</h3>
    <Lbl>Shift</Lbl><div className="flex gap-1.5"><input type="time" value={start} onChange={(e) => setStart(e.target.value)} className="flex-1 p-1.5 border border-slate-200 dark:border-slate-600 rounded-lg text-sm bg-slate-50 dark:bg-slate-700" step={1800} /><input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className="flex-1 p-1.5 border border-slate-200 dark:border-slate-600 rounded-lg text-sm bg-slate-50 dark:bg-slate-700" step={1800} /></div>
    <Lbl>Type</Lbl><select value={type} onChange={(e) => setType(e.target.value as Shift["t"])} className="w-full p-1.5 border border-slate-200 dark:border-slate-600 rounded-lg text-sm bg-slate-50 dark:bg-slate-700"><option value="morning">Morning</option><option value="day">Day</option><option value="swing">Swing</option><option value="night">Night</option></select>
    <Lbl>Days Off</Lbl><div className="flex gap-1 mt-1">{["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((d, i) => { const di = [6,0,1,2,3,4,5][i]; return <button key={d} className={"px-2 py-1 rounded-md text-[10px] font-semibold border " + (offDays.includes(di) ? "bg-indigo-500 text-white border-indigo-500" : "border-slate-200 dark:border-slate-600 text-slate-500")} onClick={() => setOffDays((p) => p.includes(di) ? p.filter((x) => x !== di) : [...p, di])}>{d}</button>; })}</div>
    <Lbl>Case Types</Lbl><div className="flex gap-1 mt-1 flex-wrap">{caseTypes.map((ct) => <button key={ct.key} className={"px-2.5 py-1 rounded-lg text-[10px] font-bold border " + (trained[ct.key] ? "text-white border-transparent" : "border-slate-200 dark:border-slate-600 text-slate-500")} style={trained[ct.key] ? { background: ct.color } : {}} onClick={() => setTrained((p) => ({ ...p, [ct.key]: !p[ct.key] }))}>{ct.label}</button>)}</div>
    <p className="text-[10px] text-amber-500 mt-2"><i className="fa-solid fa-triangle-exclamation mr-1" />Overwrites all selected</p>
    <div className="flex gap-1.5 mt-3 justify-end"><button className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold" onClick={onClose}>Cancel</button><button className="px-3 py-1.5 rounded-lg bg-indigo-500 text-white text-xs font-semibold" onClick={() => { onApply(sel, start, end, type, offDays, trained); onClose(); }}><i className="fa-solid fa-check-double mr-1" />Apply</button></div>
  </Overlay>;
}

function AddModal({ org, caseTypes, onAdd, onClose }: any) {
  const [login, setLogin] = useState(""); const [gi, setGi] = useState(0);
  const [start, setStart] = useState("08:00"); const [end, setEnd] = useState("17:00");
  const [offDays, setOffDays] = useState<number[]>([5, 6]);
  const [trained, setTrained] = useState<CaseTypes>(emptyTrained(caseTypes));
  return <Overlay onClose={onClose}><h3 className="text-sm font-bold mb-3"><i className="fa-solid fa-user-plus text-indigo-500 mr-1.5" />Add Member</h3>
    <Lbl>Login / Name</Lbl><input type="text" value={login} onChange={(e) => setLogin(e.target.value)} placeholder="e.g. jdoe" className="w-full p-1.5 border border-slate-200 dark:border-slate-600 rounded-lg text-sm bg-slate-50 dark:bg-slate-700" />
    <Lbl>Manager</Lbl><select value={gi} onChange={(e) => setGi(Number(e.target.value))} className="w-full p-1.5 border border-slate-200 dark:border-slate-600 rounded-lg text-sm bg-slate-50 dark:bg-slate-700">{org.map((g: any, i: number) => <option key={i} value={i}>{g.mgr.name}</option>)}</select>
    <Lbl>Shift</Lbl><div className="flex gap-1.5"><input type="time" value={start} onChange={(e) => setStart(e.target.value)} className="flex-1 p-1.5 border border-slate-200 dark:border-slate-600 rounded-lg text-sm bg-slate-50 dark:bg-slate-700" step={1800} /><input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className="flex-1 p-1.5 border border-slate-200 dark:border-slate-600 rounded-lg text-sm bg-slate-50 dark:bg-slate-700" step={1800} /></div>
    <Lbl>Days Off</Lbl><div className="flex gap-1 mt-1">{["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((d, i) => { const di = [6,0,1,2,3,4,5][i]; return <button key={d} className={"px-2 py-1 rounded-md text-[10px] font-semibold border " + (offDays.includes(di) ? "bg-indigo-500 text-white border-indigo-500" : "border-slate-200 dark:border-slate-600 text-slate-500")} onClick={() => setOffDays((p) => p.includes(di) ? p.filter((x) => x !== di) : [...p, di])}>{d}</button>; })}</div>
    <Lbl>Trained On</Lbl><div className="flex gap-1 mt-1 flex-wrap">{caseTypes.map((ct) => <button key={ct.key} className={"px-2.5 py-1 rounded-lg text-[10px] font-bold border " + (trained[ct.key] ? "text-white border-transparent" : "border-slate-200 dark:border-slate-600 text-slate-500")} style={trained[ct.key] ? { background: ct.color } : {}} onClick={() => setTrained((p) => ({ ...p, [ct.key]: !p[ct.key] }))}>{ct.label}</button>)}</div>
    <div className="flex gap-1.5 mt-3.5 justify-end"><button className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold" onClick={onClose}>Cancel</button><button className="px-3 py-1.5 rounded-lg bg-indigo-500 text-white text-xs font-semibold" onClick={() => { if (!login.trim()) return; onAdd(gi, login.trim(), start, end, offDays, trained); onClose(); }}><i className="fa-solid fa-plus mr-1" />Add</button></div>
  </Overlay>;
}

function AddGroupModal({ onAdd, onClose }: any) {
  const [name, setName] = useState(""); const [login, setLogin] = useState("");
  return <Overlay onClose={onClose}><h3 className="text-sm font-bold mb-3"><i className="fa-solid fa-sitemap text-indigo-500 mr-1.5" />Add Manager Team</h3>
    <Lbl>Manager Name</Lbl><input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Jane Smith" className="w-full p-1.5 border border-slate-200 dark:border-slate-600 rounded-lg text-sm bg-slate-50 dark:bg-slate-700" />
    <Lbl>Login</Lbl><input type="text" value={login} onChange={(e) => setLogin(e.target.value)} placeholder="e.g. jsmith" className="w-full p-1.5 border border-slate-200 dark:border-slate-600 rounded-lg text-sm bg-slate-50 dark:bg-slate-700" />
    <div className="flex gap-1.5 mt-3.5 justify-end"><button className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold" onClick={onClose}>Cancel</button><button className="px-3 py-1.5 rounded-lg bg-indigo-500 text-white text-xs font-semibold" onClick={() => { if (!name.trim()) return; onAdd(name.trim(), login.trim() || name.trim().toLowerCase().replace(/\s/g, "")); onClose(); }}><i className="fa-solid fa-plus mr-1" />Create</button></div>
  </Overlay>;
}



const PRESET_COLORS = ["#ef4444","#f97316","#f59e0b","#22c55e","#06b6d4","#3b82f6","#8b5cf6","#ec4899","#14b8a6","#64748b"];

function SettingsModal({ caseTypes, onSave, onClose }: { caseTypes: CaseTypeConfig[]; onSave: (ct: CaseTypeConfig[]) => void; onClose: () => void }) {
  const [types, setTypes] = useState<CaseTypeConfig[]>(caseTypes.map(ct => ({...ct})));
  const [newLabel, setNewLabel] = useState("");
  const [newColor, setNewColor] = useState("#3b82f6");

  const addType = () => {
    if (!newLabel.trim()) return;
    const key = newLabel.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
    if (types.some(t => t.key === key)) return;
    setTypes([...types, { key, label: newLabel.trim(), color: newColor }]);
    setNewLabel("");
  };
  const removeType = (key: string) => setTypes(types.filter(t => t.key !== key));
  const updateLabel = (key: string, label: string) => setTypes(types.map(t => t.key === key ? {...t, label} : t));
  const cycleColor = (key: string, current: string) => { const i = PRESET_COLORS.indexOf(current); setTypes(types.map(t => t.key === key ? {...t, color: PRESET_COLORS[(i+1)%PRESET_COLORS.length]} : t)); };

  return (
    <Overlay onClose={onClose}>
      <h3 className="text-sm font-bold mb-3 flex items-center gap-1.5"><i className="fa-solid fa-gear text-indigo-500" /> Manage Case Types</h3>
      <p className="text-[10px] text-slate-400 mb-3">Add, rename, recolor, or remove case types. Click the color circle to change it.</p>
      <div className="space-y-2 mb-4">
        {types.map((ct) => (
          <div key={ct.key} className="flex items-center gap-2 p-2 bg-slate-50 dark:bg-slate-700 rounded-lg">
            <div className="w-6 h-6 rounded-full cursor-pointer border-2 border-white shadow-sm shrink-0" style={{ background: ct.color }} onClick={() => cycleColor(ct.key, ct.color)} title="Click to cycle color" />
            <input type="text" value={ct.label} onChange={(e) => updateLabel(ct.key, e.target.value)} className="flex-1 px-2 py-1 border border-slate-200 dark:border-slate-600 rounded-md text-xs bg-white dark:bg-slate-800 outline-none focus:border-indigo-400" />
            <span className="text-[9px] text-slate-400 font-mono">{ct.key}</span>
            <button className="text-red-400 hover:text-red-500 text-xs px-1" onClick={() => removeType(ct.key)} title="Remove"><i className="fa-solid fa-trash" /></button>
          </div>
        ))}
      </div>
      <div className="border-t border-slate-200 dark:border-slate-700 pt-3">
        <Lbl>Add New Case Type</Lbl>
        <div className="flex gap-2 items-center mt-1">
          <div className="w-6 h-6 rounded-full cursor-pointer border-2 border-white shadow-sm shrink-0" style={{ background: newColor }} onClick={() => { const i = PRESET_COLORS.indexOf(newColor); setNewColor(PRESET_COLORS[(i+1)%PRESET_COLORS.length]); }} title="Click to cycle color" />
          <input type="text" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="e.g. Quality Audit" className="flex-1 px-2 py-1.5 border border-slate-200 dark:border-slate-600 rounded-md text-xs bg-white dark:bg-slate-800 outline-none focus:border-indigo-400" onKeyDown={(e) => e.key === "Enter" && addType()} />
          <button className="px-3 py-1.5 rounded-lg bg-indigo-500 text-white text-xs font-semibold shrink-0" onClick={addType}><i className="fa-solid fa-plus mr-1" />Add</button>
        </div>
      </div>
      <div className="flex gap-1.5 mt-4 justify-end">
        <button className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 text-xs font-semibold" onClick={onClose}>Cancel</button>
        <button className="px-3 py-1.5 rounded-lg bg-indigo-500 text-white text-xs font-semibold" onClick={() => onSave(types)}><i className="fa-solid fa-check mr-1" />Save Changes</button>
      </div>
    </Overlay>
  );
}
