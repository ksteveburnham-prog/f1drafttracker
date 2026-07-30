import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "./lib/supabase";

// ── Design tokens (PRNDL — Unofficial F1 Design System) ────────
const C = {
  bg: "rgb(11,11,11)",
  surface: "rgb(21,21,29)",
  surfaceRaised: "rgb(26,26,36)",
  hairline: "rgb(38,38,43)",
  rowLine: "rgb(30,30,38)",
  rowLine2: "rgb(32,32,40)",
  borderStrong: "rgb(48,48,55)",
  textPrimary: "rgb(254,254,254)",
  textBody: "rgb(247,244,241)",
  textSecondary: "rgb(208,208,213)",
  textMuted: "rgb(170,171,177)",
  textFaint: "rgb(96,96,102)",
  red: "rgb(225,6,0)",
  redHover: "rgb(169,5,0)",
  redLight: "rgb(233,68,64)",
  gold: "rgb(255,209,0)",
  green: "rgb(39,152,62)",
  greenLight: "rgb(93,178,110)",
  orange: "rgb(227,97,0)",
  orangeLight: "rgb(234,136,64)",
};

// Owner identity accents — Steve is always the red seat, Trevor the orange
// seat, independent of which constructor they've drafted this season.
const OWNER_STYLE = [
  { color: "rgb(225,6,0)", chip: "rgba(225,6,0,.16)", text: "rgb(240,130,128)", row: "rgba(225,6,0,.05)" },
  { color: "rgb(227,97,0)", chip: "rgba(227,97,0,.16)", text: "rgb(241,176,128)", row: "rgba(227,97,0,.05)" },
];

const CONSTRUCTOR_COLORS = {
  "McLaren": "rgb(227,97,0)", "Ferrari": "rgb(113,3,0)", "Red Bull": "rgb(64,71,255)",
  "Mercedes": "rgb(44,95,28)", "Aston Martin": "rgb(29,114,47)", "Alpine": "rgb(119,44,79)",
  "Williams": "rgb(0,5,128)", "Racing Bulls": "rgb(128,133,255)", "Haas": "rgb(170,171,177)",
  "Audi": "rgb(88,189,55)", "Cadillac": "rgb(0,3,64)",
};

const FLAG_BY_RACE = {
  "Australia": "🇦🇺", "China": "🇨🇳", "Japan": "🇯🇵",
  "Miami": "🇺🇸", "Canada": "🇨🇦", "Monaco": "🇲🇨",
  "Barcelona": "🇪🇸", "Austria": "🇦🇹", "Great Britain": "🇬🇧", "Belgium": "🇧🇪",
  "Hungary": "🇭🇺", "Netherlands": "🇳🇱", "Italy": "🇮🇹", "Madrid": "🇪🇸",
  "Azerbaijan": "🇦🇿", "Bahrain (Malaysia)": "🇲🇾", "Singapore": "🇸🇬", "United States": "🇺🇸", "Mexico": "🇲🇽",
  "São Paulo": "🇧🇷", "Las Vegas": "🇺🇸", "Qatar": "🇶🇦", "Abu Dhabi": "🇦🇪",
};
function getRaceFlag(name) { return FLAG_BY_RACE[name] ?? "🏁"; }

const labelStyle = { fontFamily: "'Montserrat',sans-serif", fontWeight: 700, fontSize: 10, letterSpacing: "0.16em", textTransform: "uppercase", color: C.textMuted };

function anim(kind, delay = 0) {
  if (kind === "pop") return `popIn .5s cubic-bezier(.2,.9,.25,1) ${delay}ms both`;
  if (kind === "fade") return `fadeIn .3s ease ${delay}ms both`;
  if (kind === "slide") return `slideIn .35s cubic-bezier(.2,.9,.25,1) ${delay}ms both`;
  return `fadeUp .5s cubic-bezier(.2,.8,.2,1) ${delay}ms both`;
}

// Spicy performance emoji based on average finish position last race
// 👑 Win  🚀 Podium  😤 P4-6  🥱 P7-10  🤡 P11-15  💩 P16-20  🔥 DNF  🏗️ No data
function getConstructorEmoji(constructor, results, drivers) {
  if (!results?.length || !drivers?.length) return "🏗️";

  const racesWithResults = [...new Set(results.map(r => r.race_id))];
  if (!racesWithResults.length) return "🏗️";
  const lastRaceId = racesWithResults[racesWithResults.length - 1];

  const constructorDrivers = drivers.filter(d => d.constructor === constructor);
  if (!constructorDrivers.length) return "🏗️";

  const constructorResults = results.filter(r =>
    r.race_id === lastRaceId && constructorDrivers.some(d => d.id === r.driver_id)
  );
  if (!constructorResults.length) return "🏗️";

  const positions = constructorResults.map(r => r.finish_position ?? 25);
  const avg = positions.reduce((a, b) => a + b, 0) / positions.length;

  if (avg <= 1) return "👑";
  if (avg <= 3) return "🚀";
  if (avg <= 6) return "😤";
  if (avg <= 10) return "🥱";
  if (avg <= 15) return "🤡";
  if (avg <= 20) return "💩";
  return "🔥";
}

function ConstructorLogo({ constructor, results, drivers, size = 15 }) {
  const emoji = getConstructorEmoji(constructor, results, drivers);
  return (
    <span style={{ fontSize: size, lineHeight: 1, flexShrink: 0 }} title={`${constructor} — last race performance`}>
      {emoji}
    </span>
  );
}

// ── Data hook ─────────────────────────────────────────────────
function useData() {
  const [state, setState] = useState({
    owners: [], drivers: [], races: [], drafts: [],
    results: [], raceScores: [], standings: [], payouts: [],
    loading: true, error: null,
  });

  const load = useCallback(async () => {
    setState(s => ({ ...s, loading: true, error: null }));
    try {
      const [
        { data: owners }, { data: drivers }, { data: races },
        { data: drafts }, { data: results },
        { data: raceScores }, { data: standings }, { data: payouts },
      ] = await Promise.all([
        supabase.from("owners").select("*").order("name"),
        supabase.from("drivers").select("*").order("name"),
        supabase.from("races").select("*").order("round"),
        supabase.from("drafts").select("*, owners(name), drivers(name,constructor)"),
        supabase.from("race_results").select("*, drivers(name,constructor), races(name,round)"),
        supabase.from("race_scores").select("*").order("round"),
        supabase.from("season_standings").select("*"),
        supabase.from("weekly_payouts").select("*").order("round"),
      ]);
      setState({ owners: owners ?? [], drivers: drivers ?? [], races: races ?? [], drafts: drafts ?? [], results: results ?? [], raceScores: raceScores ?? [], standings: standings ?? [], payouts: payouts ?? [], loading: false, error: null });
    } catch (err) {
      setState(s => ({ ...s, loading: false, error: err.message }));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const ch = supabase.channel("db-changes")
      .on("postgres_changes", { event: "*", schema: "public" }, () => load())
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [load]);

  return { ...state, reload: load };
}

// ── Shared small hooks ──────────────────────────────────────────
function useCountUp(deps) {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    let raf;
    const start = performance.now(), dur = 950;
    setProgress(0);
    const step = (t) => {
      const e = Math.min(1, (t - start) / dur);
      setProgress(1 - Math.pow(1 - e, 3));
      if (e < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return progress;
}

function useTick(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

function useToast() {
  const [toast, setToastState] = useState(null);
  const timerRef = useRef(null);
  const setToast = useCallback((text, kind = "success") => {
    clearTimeout(timerRef.current);
    setToastState({ text, kind });
    timerRef.current = setTimeout(() => setToastState(null), 4000);
  }, []);
  useEffect(() => () => clearTimeout(timerRef.current), []);
  return [toast, setToast];
}

// Keeps a value in localStorage so a reload (or a tab you navigated away
// from and back to) lands you back where you were, not on a blank default.
function usePersistedState(key, initialValue) {
  const [value, setValue] = useState(() => {
    try {
      const v = localStorage.getItem(key);
      return v !== null ? v : initialValue;
    } catch {
      return initialValue;
    }
  });
  const setPersisted = useCallback((next) => {
    setValue(next);
    try { localStorage.setItem(key, next); } catch {}
  }, [key]);
  return [value, setPersisted];
}

// ── Small shared components ──────────────────────────────────────
function Spinner() {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 300, gap: 16 }}>
      <div style={{ width: 40, height: 40, border: `3px solid ${C.hairline}`, borderTopColor: C.red, borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
      <p style={{ color: C.textFaint, fontSize: 14 }}>Loading race data…</p>
    </div>
  );
}

function Toast({ toast }) {
  if (!toast) return null;
  const err = toast.kind === "error";
  return (
    <div style={{
      padding: "12px 18px", borderRadius: 10, fontSize: 14,
      background: err ? "rgba(225,6,0,.1)" : "rgba(39,152,62,.1)",
      border: `1px solid ${err ? "rgba(225,6,0,.4)" : "rgba(39,152,62,.4)"}`,
      color: err ? C.redLight : C.greenLight,
      animation: anim("slide"),
    }}>{toast.text}</div>
  );
}

// ── Header ────────────────────────────────────────────────────
function Header({ spoilerMode, toggleSpoiler }) {
  return (
    <div style={{ position: "sticky", top: 0, zIndex: 40, background: "rgba(21,21,29,.92)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)", borderBottom: "1px solid rgba(225,6,0,.28)" }}>
      <div className="shell-inner" style={{ maxWidth: 1180, margin: "0 auto", height: 64, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ width: 9, height: 9, borderRadius: "50%", background: C.red, display: "inline-block", animation: "pulseDot 2.4s ease infinite" }} />
          <span style={{ fontFamily: "Orbitron,sans-serif", fontWeight: 800, fontSize: 18, letterSpacing: "0.1em", color: C.textPrimary }}>
            F1 FANTASY <span style={{ color: C.red }}>2026</span>
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <button
            onClick={toggleSpoiler}
            title={spoilerMode ? "Spoiler Shield ON — scores hidden. Click to reveal." : "Spoiler Shield OFF — click to hide scores."}
            style={{
              display: "flex", alignItems: "center", gap: 7,
              background: spoilerMode ? "rgba(227,97,0,.16)" : "rgba(255,255,255,.05)",
              border: `1px solid ${spoilerMode ? "rgba(227,97,0,.45)" : C.borderStrong}`,
              color: spoilerMode ? C.orangeLight : C.textMuted,
              padding: "7px 14px", borderRadius: 20, cursor: "pointer",
              fontFamily: "'Montserrat',sans-serif", fontWeight: 700, fontSize: 10, letterSpacing: "0.09em", textTransform: "uppercase",
              transition: "background .25s,border-color .25s,color .25s",
            }}
          >
            <span style={{ fontSize: 13 }}>{spoilerMode ? "🙈" : "👁"}</span>{spoilerMode ? "Spoilers hidden" : "Show scores"}
          </button>
          <span style={{ fontFamily: "'Montserrat',sans-serif", fontWeight: 700, fontSize: 10, letterSpacing: "0.09em", textTransform: "uppercase", background: "rgba(225,6,0,.13)", color: C.redLight, padding: "7px 14px", borderRadius: 20, border: "1px solid rgba(225,6,0,.32)", whiteSpace: "nowrap" }}>
            Steve vs Trevor
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Settlement banner ─────────────────────────────────────────
function Settlement({ standings, payouts, progress }) {
  if (!standings?.length || !payouts?.length) return null;
  const weeklyWins = {};
  for (const p of payouts) {
    if (!p.is_tie && p.winnings > 0) weeklyWins[p.owner_name] = (weeklyWins[p.owner_name] ?? 0) + p.winnings;
  }
  const s0 = standings[0], s1 = standings[1];
  if (!s0 || !s1) return null;
  const ptsDiff = Math.abs(Number(s0.season_points) - Number(s1.season_points));
  const ptsWinner = Number(s0.season_points) >= Number(s1.season_points) ? s0.owner_name : s1.owner_name;
  const totals = {};
  for (const s of standings) {
    totals[s.owner_name] = (weeklyWins[s.owner_name] ?? 0) + (ptsWinner === s.owner_name ? ptsDiff : 0);
  }
  const net = (totals[s0.owner_name] ?? 0) - (totals[s1.owner_name] ?? 0);
  const debtor = net < 0 ? s0.owner_name : s1.owner_name;
  const creditor = net < 0 ? s1.owner_name : s0.owner_name;
  const amount = Math.abs(net);

  return (
    <div style={{ position: "relative", overflow: "hidden", background: "linear-gradient(100deg,rgb(23,1,0),rgb(21,21,29) 60%)", borderBottom: "1px solid rgba(225,6,0,.24)" }}>
      <div style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: "38%", background: "linear-gradient(100deg,transparent,rgba(225,6,0,.16),transparent)", animation: "sheen 6s linear infinite" }} />
      <div className="shell-inner" style={{ position: "relative", maxWidth: 1180, margin: "0 auto", padding: "18px 28px", display: "flex", alignItems: "center", gap: 24, flexWrap: "wrap" }}>
        <span style={{ fontSize: 26 }}>🏁</span>
        <div style={{ flex: 1, minWidth: 260, display: "flex", flexDirection: "column", gap: 3 }}>
          <span style={{ fontFamily: "'Montserrat',sans-serif", fontWeight: 700, fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: C.textMuted }}>Season Settlement</span>
          <span style={{ fontSize: 17, color: C.textSecondary }}>
            <b style={{ color: C.textPrimary }}>{debtor}</b> owes <b style={{ color: C.textPrimary }}>{creditor}</b>{" "}
            <span style={{ fontFamily: "Orbitron,sans-serif", fontWeight: 800, fontSize: 23, color: C.gold, letterSpacing: "0.02em" }}>
              ${Math.round(amount * progress).toLocaleString()}
            </span>
          </span>
        </div>
        <div style={{ display: "flex", gap: 28 }}>
          {standings.map(s => (
            <div key={s.owner_id} style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
              <span style={{ fontFamily: "'Montserrat',sans-serif", fontWeight: 700, fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: C.textMuted }}>{s.owner_name}</span>
              <span style={{ fontFamily: "Orbitron,sans-serif", fontWeight: 700, fontSize: 17, color: C.textPrimary }}>
                ${Math.round((totals[s.owner_name] ?? 0) * progress).toLocaleString()}
              </span>
            </div>
          ))}
        </div>
        <span style={{ fontSize: 11, color: C.textFaint, width: "100%" }}>$20 per weekly win · purse rolls over on ties · $1 per point of season margin</span>
      </div>
    </div>
  );
}

// ── Tab nav ───────────────────────────────────────────────────
const TABS = [
  { id: "scoreboard", label: "Scoreboard", emoji: "🏆" },
  { id: "draft", label: "Draft", emoji: "📋" },
  { id: "results", label: "Results", emoji: "🏁" },
];

function TabNav({ tab, setTab }) {
  const idx = TABS.findIndex(t => t.id === tab);
  return (
    <div style={{ background: "rgba(21,21,29,.7)", borderBottom: `1px solid ${C.hairline}` }}>
      <div className="shell-inner" style={{ position: "relative", maxWidth: 1180, margin: "0 auto", display: "flex", overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
        <div style={{ position: "absolute", bottom: 0, left: 28, width: 170, height: 3, background: C.red, transform: `translateX(${idx * 170}px)`, transition: "transform .42s cubic-bezier(.65,0,.35,1)" }} />
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{ width: 170, flexShrink: 0, background: "none", border: "none", cursor: "pointer", padding: "17px 0", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, color: tab === t.id ? C.textPrimary : C.textFaint, fontFamily: "'Montserrat',sans-serif", fontWeight: 700, fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase", transition: "color .25s" }}
          >
            <span style={{ fontSize: 15 }}>{t.emoji}</span>{t.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Next race countdown card ──────────────────────────────────
function NextRaceCard({ races }) {
  const now = useTick(1000);
  const nextRace = races.find(r => !r.results_updated);
  if (!nextRace) return null;

  const target = nextRace.race_date ? new Date(nextRace.race_date).getTime() : null;
  const diff = target ? Math.max(0, target - now) : 0;
  const dd = Math.floor(diff / 86400000);
  const hh = Math.floor((diff % 86400000) / 3600000);
  const mm = Math.floor((diff % 3600000) / 60000);
  const ss = Math.floor((diff % 60000) / 1000);
  const urgentColor = dd === 0 ? C.red : dd <= 3 ? C.orange : C.green;
  const pad = n => String(n).padStart(2, "0");
  const cells = [
    { label: "Days", value: pad(dd), color: urgentColor },
    { label: "Hrs", value: pad(hh), color: C.textPrimary },
    { label: "Min", value: pad(mm), color: C.textPrimary },
    { label: "Sec", value: pad(ss), color: C.textMuted },
  ];
  const tint = dd <= 3 ? "rgba(225,6,0,.12)" : "rgba(39,152,62,.1)";
  const border = dd <= 3 ? "rgba(225,6,0,.3)" : "rgba(39,152,62,.28)";

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 22, flexWrap: "wrap", background: `linear-gradient(100deg,${tint},rgb(21,21,29) 55%)`, border: `1px solid ${border}`, borderRadius: 16, padding: "20px 26px", animation: anim("up", 0) }}>
      <span style={{ fontSize: 28 }}>🏁</span>
      <div style={{ flex: 1, minWidth: 240, display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontFamily: "'Montserrat',sans-serif", fontWeight: 700, fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: C.textMuted }}>Next Race</span>
        <span style={{ fontFamily: "Orbitron,sans-serif", fontWeight: 700, fontSize: 19, color: C.textPrimary, letterSpacing: "0.03em" }}>
          ROUND {nextRace.round} — {getRaceFlag(nextRace.name)} {nextRace.name}
        </span>
        <span style={{ fontSize: 12, color: C.textFaint }}>
          {target ? new Date(target).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }) : "Date TBD"}
        </span>
      </div>
      {nextRace.has_sprint && (
        <span style={{ fontFamily: "'Montserrat',sans-serif", fontWeight: 700, fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: C.orange, background: "rgba(227,97,0,.14)", border: "1px solid rgba(227,97,0,.35)", padding: "5px 11px", borderRadius: 6 }}>
          ⚡ Sprint
        </span>
      )}
      <div style={{ display: "flex", gap: 10 }}>
        {cells.map(c => (
          <div key={c.label} style={{ minWidth: 66, background: "rgba(0,0,0,.35)", border: `1px solid ${C.hairline}`, borderRadius: 12, padding: "10px 8px", display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
            <span style={{ fontFamily: "Orbitron,sans-serif", fontWeight: 800, fontSize: 22, color: c.color, lineHeight: 1 }}>{c.value}</span>
            <span style={{ fontFamily: "'Montserrat',sans-serif", fontWeight: 700, fontSize: 8, letterSpacing: "0.12em", textTransform: "uppercase", color: C.textFaint }}>{c.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function computeRecord(ownerName, payouts, roundsScored) {
  const wins = payouts.filter(p => p.owner_name === ownerName && !p.is_tie && p.winnings > 0).length;
  const tieRounds = new Set(payouts.filter(p => p.is_tie).map(p => p.round));
  return `${wins} race win${wins === 1 ? "" : "s"} · ${tieRounds.size} tie${tieRounds.size === 1 ? "" : "s"} · ${roundsScored} round${roundsScored === 1 ? "" : "s"} scored`;
}

// ── Points breakdown modal ─────────────────────────────────────
function PointsBreakdownModal({ race, results, drafts, owners, drivers, payouts, onClose }) {
  if (!race) return null;

  const raceResults = results.filter(r => r.race_id === race.id);
  const raceDrafts = drafts.filter(d => d.race_id === race.id);
  const racePayouts = payouts.filter(p => p.round === race.round);
  const isTie = racePayouts.some(p => p.is_tie);
  const winnerPayout = racePayouts.find(p => !p.is_tie && p.winnings > 0);
  const purseAmount = winnerPayout?.winnings ?? racePayouts[0]?.winnings ?? 20;
  const winnerText = racePayouts.length
    ? (isTie ? "🤝 Tie — purse rolls over to next race" : (winnerPayout ? `${winnerPayout.owner_name} takes the weekly purse` : ""))
    : "";

  const ownerBreakdowns = owners.map((owner, oi) => {
    const ownerDrafts = raceDrafts.filter(d => d.owner_id === owner.id);
    const driverRows = ownerDrafts.map(draft => {
      const result = raceResults.find(r => r.driver_id === draft.driver_id);
      const driver = drivers.find(d => d.id === draft.driver_id);
      if (!result || !driver) return null;

      const pos = result.finish_position;
      let base = 0;
      if (pos && pos === 1) base = 30;
      else if (pos && pos <= 3) base = 24;
      else if (pos && pos <= 6) base = 18;
      else if (pos && pos <= 10) base = 12;
      else if (pos && pos <= 15) base = 6;
      else if (pos && pos <= 20) base = 2;

      const chips = [{ label: pos ? `P${pos} → ${base}` : "DNF → 0", bg: "rgb(38,38,43)", color: "rgb(208,208,213)" }];
      if (result.pole_position) chips.push({ label: "Pole +5", bg: "rgba(64,71,255,.16)", color: "rgb(128,133,255)" });
      if (result.fastest_lap) chips.push({ label: "FL +3", bg: "rgba(227,97,0,.16)", color: "rgb(234,136,64)" });
      if (result.most_pos_gained) chips.push({ label: "MPG +2", bg: "rgba(39,152,62,.16)", color: "rgb(93,178,110)" });
      if (result.sprint_win) chips.push({ label: "SW +5", bg: "rgba(225,6,0,.16)", color: "rgb(233,68,64)" });
      if (result.sprint_pole) chips.push({ label: "SP +3", bg: "rgba(88,189,55,.16)", color: "rgb(130,205,105)" });

      let bonus = 0;
      if (result.pole_position) bonus += 5;
      if (result.fastest_lap) bonus += 3;
      if (result.most_pos_gained) bonus += 2;
      if (result.sprint_win) bonus += 5;
      if (result.sprint_pole) bonus += 3;

      const constructorMatch = driver.constructor === owner.constructor;
      const multiplier = constructorMatch ? 1.15 : 1.0;
      const total = Math.round(base * multiplier + bonus);

      return { driver, chips, total, constructorMatch, pickNumber: draft.pick_number };
    }).filter(Boolean);

    const totalPts = driverRows.reduce((s, r) => s + r.total, 0);
    return { owner, oi, driverRows, totalPts };
  });

  // Best value pick: compare where a driver was drafted (pick_number, lower
  // = earlier/more valuable slot) against how they actually ranked in
  // scoring that race. A late pick that out-scored earlier picks is a
  // "steal" — the bigger the gap, the better the value.
  const allDraftedRows = ownerBreakdowns.flatMap(({ owner, driverRows }) => driverRows.map(r => ({ ...r, ownerName: owner.name })));
  let bestValue = null;
  if (allDraftedRows.length > 1) {
    const byPerformance = [...allDraftedRows].sort((a, b) => b.total - a.total);
    const performanceRank = {};
    byPerformance.forEach((r, idx) => { performanceRank[r.driver.id] = idx + 1; });
    for (const row of allDraftedRows) {
      const value = row.pickNumber - performanceRank[row.driver.id];
      if (!bestValue || value > bestValue.value) bestValue = { ...row, value };
    }
    if (!bestValue || bestValue.value <= 0) bestValue = null;
  }

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.82)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, animation: anim("fade") }}>
      <div onClick={e => e.stopPropagation()} style={{ background: C.surface, border: `1px solid ${C.hairline}`, borderRadius: 20, width: "100%", maxWidth: 760, maxHeight: "84vh", overflowY: "auto", padding: 28, animation: anim("pop", 40) }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 22, gap: 12 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontFamily: "'Montserrat',sans-serif", fontWeight: 700, fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: C.red }}>Points Breakdown</span>
            <span style={{ fontFamily: "Orbitron,sans-serif", fontWeight: 700, fontSize: 20, color: C.textPrimary, letterSpacing: "0.03em" }}>{getRaceFlag(race.name)} {race.name} — Round {race.round}</span>
          </div>
          <button onClick={onClose} style={{ background: "none", border: `1px solid ${C.borderStrong}`, color: C.textMuted, width: 34, height: 34, borderRadius: "50%", fontSize: 15, cursor: "pointer", flexShrink: 0 }}>✕</button>
        </div>

        {bestValue && (
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", marginBottom: 18, background: "rgba(255,209,0,.08)", border: "1px solid rgba(255,209,0,.28)", borderRadius: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 16 }}>💎</span>
            <span style={{ fontSize: 13, color: C.textSecondary }}>
              <b style={{ color: C.gold }}>Best Value Pick:</b> {bestValue.driver.name} — picked #{bestValue.pickNumber} by {bestValue.ownerName}, finished as the #{bestValue.pickNumber - bestValue.value} scorer this race
            </span>
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {ownerBreakdowns.map(({ owner, oi, driverRows, totalPts }) => (
            <div key={owner.id} style={{ background: C.surfaceRaised, border: `1px solid ${C.hairline}`, borderRadius: 14, padding: 18, animation: anim("up", oi * 90) }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 10, fontFamily: "Orbitron,sans-serif", fontWeight: 700, fontSize: 15, color: C.textPrimary }}>
                  <span style={{ width: 9, height: 9, borderRadius: "50%", background: OWNER_STYLE[oi]?.color ?? C.textFaint }} />{owner.name}
                </span>
                <span style={{ fontFamily: "Orbitron,sans-serif", fontWeight: 800, fontSize: 20, color: C.red }}>{Math.round(totalPts)} pts</span>
              </div>
              {driverRows.length === 0 ? (
                <div style={{ color: C.textFaint, fontSize: 13, fontStyle: "italic" }}>No results yet</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {driverRows.map(({ driver, total, chips, constructorMatch }, ri) => {
                    const isValuePick = bestValue?.driver.id === driver.id;
                    return (
                    <div key={driver.id} style={{ background: C.surface, border: `1px solid ${isValuePick ? C.gold : (constructorMatch ? "rgba(255,209,0,.28)" : "rgb(32,32,40)")}`, borderRadius: 10, padding: "11px 14px", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", animation: anim("up", 60 + ri * 40) }}>
                      <div style={{ flex: 1, minWidth: 150, display: "flex", flexDirection: "column", gap: 3 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: C.textBody }}>{driver.name} {isValuePick && "💎"}</span>
                        <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: C.textFaint }}>
                          <ConstructorLogo constructor={driver.constructor} results={results} drivers={drivers} size={13} />{driver.constructor}
                          {constructorMatch && <b style={{ color: C.gold, marginLeft: 4 }}>+15% 🏆</b>}
                        </span>
                      </div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {chips.map((ch, ci) => (
                          <span key={ci} style={{ fontFamily: "'Montserrat',sans-serif", fontWeight: 700, fontSize: 10, letterSpacing: "0.03em", background: ch.bg, color: ch.color, padding: "3px 9px", borderRadius: 6 }}>{ch.label}</span>
                        ))}
                      </div>
                      <span style={{ fontFamily: "Orbitron,sans-serif", fontWeight: 800, fontSize: 15, color: C.textPrimary, minWidth: 44, textAlign: "right" }}>{total}</span>
                    </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}

          {winnerText && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", background: "rgba(255,209,0,.07)", border: "1px solid rgba(255,209,0,.25)", borderRadius: 12, gap: 12, flexWrap: "wrap" }}>
              <span style={{ fontSize: 13, color: C.textSecondary }}>{winnerText}</span>
              <span style={{ fontFamily: "Orbitron,sans-serif", fontWeight: 800, fontSize: 17, color: C.gold }}>${purseAmount}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Scoreboard tab ────────────────────────────────────────────
function ScoreboardTab({ standings, raceScores, payouts, races, results, drafts, owners, drivers, spoilerMode, progress, onReveal }) {
  const [breakdown, setBreakdown] = useState(null);

  const ownerNames = standings.map(s => s.owner_name);
  const byRound = {};
  for (const rs of raceScores) { if (!byRound[rs.round]) byRound[rs.round] = {}; byRound[rs.round][rs.owner_name] = Number(rs.total_points); }
  const roundsScored = races.filter(r => r.results_updated).length;
  const colTemplate = `1fr repeat(${ownerNames.length},120px) 150px`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
      {breakdown && (
        <PointsBreakdownModal race={breakdown} results={results} drafts={drafts} owners={owners} drivers={drivers} payouts={payouts} onClose={() => setBreakdown(null)} />
      )}

      <NextRaceCard races={races} />

      {spoilerMode && (
        <div style={{ display: "flex", alignItems: "center", gap: 16, background: "linear-gradient(100deg,rgb(23,10,0),rgb(21,21,29) 60%)", border: "1px solid rgba(227,97,0,.4)", borderRadius: 16, padding: "18px 24px", flexWrap: "wrap", animation: anim("up", 70) }}>
          <span style={{ fontSize: 28 }}>🙈</span>
          <div style={{ flex: 1, minWidth: 200, display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontFamily: "Orbitron,sans-serif", fontWeight: 700, fontSize: 14, color: C.orange, letterSpacing: "0.04em" }}>SPOILER SHIELD ACTIVE</span>
            <span style={{ fontSize: 13, color: C.textMuted }}>Season scores, payouts and results are hidden. Toggle <b style={{ color: C.textSecondary }}>Show Scores</b> in the header when you're ready.</span>
          </div>
          <button onClick={onReveal} style={{ background: C.red, border: "none", borderRadius: 20, padding: "11px 22px", color: "#fff", fontFamily: "'Montserrat',sans-serif", fontWeight: 700, fontSize: 11, letterSpacing: "0.07em", textTransform: "uppercase", cursor: "pointer" }}>Reveal Scores</button>
        </div>
      )}

      <div className="standings-grid">
        {standings.map((s, i) => {
          const leader = i === 0;
          return (
            <div key={s.owner_id} style={{ position: "relative", overflow: "hidden", background: leader ? "linear-gradient(120deg,rgba(225,6,0,.11),rgb(21,21,29) 60%)" : C.surface, border: `1px solid ${leader ? "rgba(225,6,0,.4)" : C.hairline}`, borderRadius: 16, padding: "24px 26px", display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap", animation: anim("up", 60 + i * 80) }}>
              <span style={{ fontFamily: "Orbitron,sans-serif", fontWeight: 900, fontSize: 56, lineHeight: 1, color: leader ? "rgba(225,6,0,.35)" : C.hairline }}>{i + 1}</span>
              <div style={{ flex: 1, minWidth: 140, display: "flex", flexDirection: "column", gap: 5 }}>
                <span style={{ fontFamily: "Orbitron,sans-serif", fontWeight: 700, fontSize: 20, color: C.textPrimary, letterSpacing: "0.03em" }}>{s.owner_name}</span>
                <span style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, color: C.textMuted }}>
                  <ConstructorLogo constructor={s.constructor} results={results} drivers={drivers} />{s.constructor}
                </span>
                <span style={{ fontFamily: "'Montserrat',sans-serif", fontWeight: 700, fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: C.textFaint }}>
                  {computeRecord(s.owner_name, payouts, roundsScored)}
                </span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
                {spoilerMode ? (
                  <span style={{ fontFamily: "Orbitron,sans-serif", fontWeight: 800, fontSize: 34, color: C.hairline }}>——</span>
                ) : (
                  <span style={{ fontFamily: "Orbitron,sans-serif", fontWeight: 800, fontSize: 34, color: leader ? C.gold : C.textPrimary }}>{Math.round(Number(s.season_points) * progress)}</span>
                )}
                <span style={{ fontFamily: "'Montserrat',sans-serif", fontWeight: 700, fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: C.textFaint }}>Season pts</span>
              </div>
            </div>
          );
        })}
      </div>

      {!spoilerMode && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14, animation: anim("up", 140) }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <span style={{ fontFamily: "'Montserrat',sans-serif", fontWeight: 700, fontSize: 10, letterSpacing: "0.16em", textTransform: "uppercase", color: C.red, whiteSpace: "nowrap" }}>Race by Race</span>
            <span style={{ flex: 1, height: 1, background: C.hairline }} />
            <span style={{ fontSize: 11, color: C.textFaint, fontStyle: "italic", whiteSpace: "nowrap" }}>Click a completed race for the breakdown</span>
          </div>
          <div style={{ border: `1px solid ${C.hairline}`, borderRadius: 14, overflow: "hidden", background: "rgba(21,21,29,.6)" }}>
            <div style={{ overflowX: "auto" }}>
              <div style={{ minWidth: 560 }}>
                <div style={{ display: "grid", gridTemplateColumns: colTemplate, padding: "12px 20px", background: C.surfaceRaised, fontFamily: "'Montserrat',sans-serif", fontWeight: 700, fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: C.textMuted }}>
                  <span>Race</span>
                  {ownerNames.map(n => <span key={n} style={{ textAlign: "center" }}>{n}</span>)}
                  <span style={{ textAlign: "center" }}>Winner</span>
                </div>
                {races.map((race, i) => {
                  const done = race.results_updated;
                  const sc = byRound[race.round] ?? {};
                  const pts = ownerNames.map(o => sc[o] ?? null);
                  const allHave = pts.every(p => p !== null);
                  const maxPts = allHave ? Math.max(...pts) : null;
                  const isTie = allHave && pts.every(p => p === maxPts);
                  const winnerIdx = allHave && !isTie ? pts.indexOf(maxPts) : null;
                  const winnerName = isTie ? "🤝 Tie" : (winnerIdx != null ? ownerNames[winnerIdx] : null);
                  const marker = done ? (isTie ? C.hairline : (OWNER_STYLE[winnerIdx]?.color ?? C.hairline)) : C.hairline;
                  return (
                    <div
                      key={race.id}
                      onClick={done ? () => setBreakdown(race) : undefined}
                      style={{ display: "grid", gridTemplateColumns: colTemplate, alignItems: "center", padding: "13px 20px", borderTop: `1px solid ${C.rowLine2}`, cursor: done ? "pointer" : "default", opacity: done ? 1 : 0.55, transition: "background .2s", animation: anim("up", 40 + i * 30) }}
                      onMouseEnter={done ? (e => e.currentTarget.style.background = "rgba(255,255,255,.035)") : undefined}
                      onMouseLeave={done ? (e => e.currentTarget.style.background = "") : undefined}
                    >
                      <span style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, color: done ? C.textBody : C.textFaint, fontWeight: 600 }}>
                        <span style={{ width: 3, height: 22, borderRadius: 2, background: marker, flexShrink: 0 }} />
                        <span style={{ fontFamily: "'Montserrat',sans-serif", fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", color: C.textFaint, width: 26, flexShrink: 0 }}>R{race.round}</span>
                        {getRaceFlag(race.name)} {race.name}
                        {race.has_sprint && <span style={{ fontFamily: "'Montserrat',sans-serif", fontSize: 8, fontWeight: 700, letterSpacing: "0.06em", color: C.orange, background: "rgba(227,97,0,.14)", border: "1px solid rgba(227,97,0,.3)", padding: "1px 5px", borderRadius: 4 }}>SPRINT</span>}
                      </span>
                      {ownerNames.map((o, oi) => (
                        <span key={o} style={{ textAlign: "center", fontFamily: "Orbitron,sans-serif", fontSize: 14, fontWeight: 700, color: done ? (allHave && pts[oi] === maxPts && !isTie ? C.greenLight : C.textSecondary) : C.textFaint }}>
                          {done ? (sc[o] != null ? Math.round(Number(sc[o])) : "—") : ""}
                        </span>
                      ))}
                      <span style={{ textAlign: "center", fontSize: 12, fontWeight: 700, color: done ? (isTie ? C.textMuted : C.greenLight) : C.textFaint }}>
                        {done ? winnerName : (race.race_date ? new Date(race.race_date).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—")}
                      </span>
                    </div>
                  );
                })}
                <div style={{ display: "grid", gridTemplateColumns: colTemplate, alignItems: "center", padding: "15px 20px", background: C.surfaceRaised, borderTop: `2px solid ${C.hairline}` }}>
                  <span style={{ fontFamily: "'Montserrat',sans-serif", fontWeight: 700, fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: C.textMuted }}>Season total</span>
                  {ownerNames.map(o => {
                    const st = standings.find(s => s.owner_name === o);
                    return <span key={o} style={{ textAlign: "center", fontFamily: "Orbitron,sans-serif", fontSize: 16, fontWeight: 800, color: C.gold }}>{st ? Math.round(Number(st.season_points)) : "—"}</span>;
                  })}
                  <span />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Draft tab ─────────────────────────────────────────────────
function DraftTab({ races, drafts, owners, drivers, payouts, results, reload }) {
  const [selRace, setSelRace] = usePersistedState("f1app.draftRace", "");
  const [picks, setPicks] = useState({});
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useToast();

  const race = races.find(r => r.id === selRace);
  const existing = drafts.filter(d => d.race_id === selRace);

  const getFirstPickerIdx = (forRace) => {
    if (!forRace || forRace.round === 1) return 0;
    const prevRaces = races
      .filter(r => r.round < forRace.round && r.results_updated)
      .sort((a, b) => b.round - a.round);
    for (const prev of prevRaces) {
      const prevPayouts = payouts.filter(p => p.round === prev.round);
      if (!prevPayouts.length) continue;
      const isTie = prevPayouts.some(p => p.is_tie);
      if (isTie) continue;
      const loserPayout = prevPayouts.find(p => p.winnings === 0);
      if (!loserPayout) continue;
      const loserIdx = owners.findIndex(o => o.name === loserPayout.owner_name);
      return loserIdx >= 0 ? loserIdx : 0;
    }
    return 0;
  };

  const firstPickerIdx = getFirstPickerIdx(race);

  const snakeOrder = [];
  for (let rnd = 1; rnd <= 8; rnd++) {
    const seq = rnd % 2 === 1 ? [firstPickerIdx, 1 - firstPickerIdx] : [1 - firstPickerIdx, firstPickerIdx];
    for (const ownerIdx of seq) snakeOrder.push({ pick: snakeOrder.length + 1, round: rnd, ownerIdx });
  }

  const usedIds = [
    ...Object.values(picks).map(p => p.driverId).filter(Boolean),
    ...existing.map(d => d.driver_id),
  ];

  const handlePick = (pick, driverId, ownerIdx) => {
    setPicks(prev => ({ ...prev, [pick]: { driverId, ownerIdx } }));
  };
  const clearPicks = () => setPicks({});

  const save = async () => {
    if (!race) return;
    setSaving(true);
    const rows = Object.entries(picks).filter(([, v]) => v.driverId).map(([pick, v]) => ({
      race_id: race.id, owner_id: owners[v.ownerIdx]?.id,
      driver_id: v.driverId, pick_number: Number(pick),
    }));
    const { error } = await supabase.from("drafts").upsert(rows, { onConflict: "race_id,driver_id" });
    setSaving(false);
    if (error) setToast(error.message, "error");
    else { setToast(`✅ Draft saved — ${rows.length} pick${rows.length > 1 ? "s" : ""} locked in for ${race.name}.`); setPicks({}); reload(); }
  };

  const nextUpcoming = races.find(r => !r.results_updated);
  const availableRaces = races.filter(r => r.results_updated || r.id === nextUpcoming?.id);
  const pickedCount = Object.values(picks).filter(v => v.driverId).length;
  const draftLocked = existing.length === 16;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, animation: anim("up", 0) }}>
        <span style={labelStyle}>Select Race Week</span>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          {availableRaces.map((r, i) => {
            const active = selRace === r.id;
            return (
              <button key={r.id} onClick={() => { setSelRace(r.id); setPicks({}); }} style={{
                display: "flex", flexDirection: "column", alignItems: "center", gap: 3, minWidth: 104,
                background: active ? (r.results_updated ? "rgba(39,152,62,.14)" : "rgba(225,6,0,.14)") : C.surface,
                border: `1px solid ${active ? (r.results_updated ? C.green : C.red) : C.hairline}`,
                borderRadius: 12, padding: "10px 14px", cursor: "pointer",
                color: active ? C.textPrimary : C.textMuted, fontSize: 12,
                transition: "transform .2s,border-color .25s,background .25s", animation: anim("up", 20 + i * 30),
              }}>
                <span style={{ fontFamily: "'Montserrat',sans-serif", fontWeight: 700, fontSize: 9, letterSpacing: "0.1em", color: r.results_updated ? C.greenLight : C.redLight }}>R{r.round}</span>
                <span style={{ fontWeight: 600, lineHeight: 1.2, textAlign: "center" }}>{getRaceFlag(r.name)} {r.name}</span>
                {r.has_sprint && <span style={{ width: 6, height: 6, borderRadius: "50%", background: C.orange }} />}
              </button>
            );
          })}
        </div>
      </div>

      {race && (
        <>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 14, animation: anim("up", 70) }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <span style={{ fontFamily: "Orbitron,sans-serif", fontWeight: 700, fontSize: 20, color: C.textPrimary, letterSpacing: "0.03em" }}>DRAFT BOARD — {race.name}</span>
              <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: C.textMuted, flexWrap: "wrap" }}>
                🎯 <b style={{ color: C.textPrimary }}>{owners[firstPickerIdx]?.name}</b> picks first{" "}
                <span style={{ color: C.textFaint }}>({race.round === 1 ? "Round 1 default" : "lost the previous race"})</span>
              </span>
            </div>
            {draftLocked ? (
              <span style={{ fontFamily: "'Montserrat',sans-serif", fontWeight: 700, fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: C.greenLight, background: "rgba(39,152,62,.13)", border: "1px solid rgba(39,152,62,.35)", padding: "8px 14px", borderRadius: 8 }}>🔒 16 picks saved</span>
            ) : (
              <span style={{ fontFamily: "Orbitron,sans-serif", fontSize: 13, color: C.textMuted }}>{existing.length}/16 picks entered</span>
            )}
          </div>

          {toast && <Toast toast={toast} />}

          <div style={{ border: `1px solid ${C.hairline}`, borderRadius: 14, overflow: "hidden", animation: anim("up", 140) }}>
            <div style={{ overflowX: "auto" }}>
              <div style={{ minWidth: 640 }}>
                <div style={{ display: "grid", gridTemplateColumns: "60px 60px 130px 1fr 190px 90px", padding: "12px 20px", background: C.surfaceRaised, fontFamily: "'Montserrat',sans-serif", fontWeight: 700, fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: C.textMuted }}>
                  <span>Pick</span><span>Rnd</span><span>Owner</span><span>Driver</span><span>Constructor</span><span style={{ textAlign: "right" }}>Bonus</span>
                </div>
                {snakeOrder.map(({ pick, round, ownerIdx }, i) => {
                  const owner = owners[ownerIdx];
                  const ident = OWNER_STYLE[ownerIdx] ?? OWNER_STYLE[0];
                  const ex = existing.find(d => d.pick_number === pick);
                  const cur = picks[pick];
                  const selId = ex?.driver_id ?? cur?.driverId;
                  const selDriver = drivers.find(d => d.id === selId);
                  const bonus = !!(selDriver && owner && selDriver.constructor === owner.constructor);
                  return (
                    <div key={pick} style={{ display: "grid", gridTemplateColumns: "60px 60px 130px 1fr 190px 90px", alignItems: "center", padding: "9px 20px", gap: 8, background: ident.row, borderTop: `1px solid ${C.rowLine}`, borderLeft: `3px solid ${ident.color}`, animation: anim("up", 20 + i * 22) }}>
                      <span style={{ fontFamily: "Orbitron,sans-serif", fontWeight: 700, fontSize: 13, color: C.textFaint }}>{pick}</span>
                      <span style={{ fontSize: 12, color: C.textMuted }}>{round}</span>
                      <span style={{ fontFamily: "'Montserrat',sans-serif", fontWeight: 700, fontSize: 10, letterSpacing: "0.06em", textTransform: "uppercase", color: ident.text, background: ident.chip, padding: "4px 9px", borderRadius: 6, justifySelf: "start" }}>{owner?.name}</span>
                      <span>
                        {ex ? (
                          <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, color: C.greenLight, fontWeight: 600 }}><span style={{ fontSize: 13 }}>✓</span>{ex.drivers?.name}</span>
                        ) : (
                          <select value={cur?.driverId ?? ""} onChange={e => handlePick(pick, e.target.value, ownerIdx)}
                            style={{ width: "100%", maxWidth: 280, background: C.surface, border: `1px solid ${cur?.driverId ? "rgba(225,6,0,.45)" : C.borderStrong}`, color: cur?.driverId ? C.textBody : C.textFaint, padding: "7px 11px", borderRadius: 8, fontSize: 13, cursor: "pointer", outline: "none", transition: "border-color .2s" }}>
                            <option value="">— Select driver —</option>
                            {drivers.filter(d => !usedIds.includes(d.id) || d.id === cur?.driverId).map(d => (
                              <option key={d.id} value={d.id}>{d.name}</option>
                            ))}
                          </select>
                        )}
                      </span>
                      <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: C.textMuted }}>
                        {selDriver && (
                          <>
                            <span style={{ width: 8, height: 8, borderRadius: "50%", background: CONSTRUCTOR_COLORS[selDriver.constructor] ?? C.textFaint, flexShrink: 0 }} />
                            {selDriver.constructor}
                          </>
                        )}
                      </span>
                      <span style={{ textAlign: "right" }}>
                        {bonus && <span style={{ fontFamily: "'Montserrat',sans-serif", fontWeight: 700, fontSize: 10, color: C.gold }}>★ +15%</span>}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            <button onClick={save} disabled={saving || !pickedCount} style={{ background: C.red, border: "none", color: "#fff", padding: "14px 30px", borderRadius: 10, fontFamily: "'Montserrat',sans-serif", fontWeight: 700, fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase", cursor: pickedCount ? "pointer" : "default", opacity: saving ? 0.5 : (pickedCount ? 1 : 0.4), boxShadow: "0 6px 20px rgba(225,6,0,.28)" }}>
              {saving ? "Saving…" : (pickedCount ? `Save ${pickedCount} pick${pickedCount > 1 ? "s" : ""}` : "Save draft")}
            </button>
            <button onClick={clearPicks} disabled={!pickedCount} style={{ background: "rgb(28,28,36)", border: `1px solid ${C.borderStrong}`, color: C.textMuted, padding: "14px 22px", borderRadius: 10, fontFamily: "'Montserrat',sans-serif", fontWeight: 700, fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase", cursor: pickedCount ? "pointer" : "default", opacity: pickedCount ? 1 : 0.4 }}>
              Clear
            </button>
            <span style={{ display: "flex", alignItems: "center", gap: 18, marginLeft: "auto", fontSize: 12, color: C.textFaint, flexWrap: "wrap" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 7 }}><span style={{ width: 10, height: 10, borderRadius: "50%", background: OWNER_STYLE[0].color }} />{owners[0]?.name}</span>
              <span style={{ display: "flex", alignItems: "center", gap: 7 }}><span style={{ width: 10, height: 10, borderRadius: "50%", background: OWNER_STYLE[1].color }} />{owners[1]?.name}</span>
              <span><span style={{ color: C.gold }}>★ +15%</span> driver matches owner's constructor</span>
            </span>
          </div>
        </>
      )}
    </div>
  );
}

// ── Results tab ───────────────────────────────────────────────
function ResultsTab({ races, results, drivers, reload }) {
  const [selRace, setSelRace] = usePersistedState("f1app.resultsRace", "");
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useToast();
  const [triggering, setTriggering] = useState(false);

  const race = races.find(r => r.id === selRace);

  useEffect(() => {
    if (!selRace) return;
    const f = {};
    for (const d of drivers) {
      const ex = results.find(r => r.race_id === selRace && r.driver_id === d.id);
      f[d.id] = { finish_position: ex?.finish_position ?? "", dnf: ex?.finish_position === null && ex?.race_id ? true : false, pole_position: ex?.pole_position ?? false, fastest_lap: ex?.fastest_lap ?? false, most_pos_gained: ex?.most_pos_gained ?? false, sprint_win: ex?.sprint_win ?? false, sprint_pole: ex?.sprint_pole ?? false };
    }
    setForm(f);
  }, [selRace, results, drivers]);

  const upd = (dId, field, val) => setForm(prev => ({ ...prev, [dId]: { ...prev[dId], [field]: val } }));

  const save = async () => {
    if (!race) return;
    setSaving(true);
    const rows = Object.entries(form).filter(([, v]) => v.finish_position !== "" || v.dnf).map(([dId, v]) => ({
      race_id: race.id, driver_id: dId, finish_position: v.dnf ? null : Number(v.finish_position),
      pole_position: v.pole_position, fastest_lap: v.fastest_lap,
      most_pos_gained: v.most_pos_gained, sprint_win: v.sprint_win, sprint_pole: v.sprint_pole,
    }));
    const { error } = await supabase.from("race_results").upsert(rows, { onConflict: "race_id,driver_id" });
    if (!error) await supabase.from("races").update({ results_updated: true, updated_at: new Date().toISOString() }).eq("id", race.id);
    setSaving(false);
    if (error) setToast(error.message, "error");
    else { setToast(`✅ Results saved for ${race.name} — ${rows.length} drivers scored, Slack notified.`); reload(); }
  };

  const triggerFetch = async () => {
    if (!race) { setToast("Select a race first, then click Auto-fetch.", "error"); return; }
    setTriggering(true);
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/update-scores-v2`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ round: race.round }),
      });
      const data = await res.json();
      if (res.ok) {
        setToast(`✅ Updated: ${data.race} — ${data.results_upserted} drivers, bonuses: pole=${data.bonuses_detected?.pole ?? "?"}, FL=${data.bonuses_detected?.fastest_lap ?? "?"}`);
        reload();
      } else {
        setToast(data.error ?? JSON.stringify(data), "error");
      }
    } catch (e) {
      setToast(e.message, "error");
    }
    setTriggering(false);
  };

  const gridCols = race?.has_sprint ? "1fr 170px 60px 80px 70px 60px 70px 60px 60px" : "1fr 170px 60px 80px 70px 60px 70px";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, animation: anim("up", 0) }}>
        <span style={labelStyle}>Select Race</span>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          {races.map((r, i) => {
            const active = selRace === r.id;
            return (
              <button key={r.id} onClick={() => setSelRace(r.id)} style={{
                display: "flex", flexDirection: "column", alignItems: "center", gap: 3, minWidth: 104,
                background: active ? (r.results_updated ? "rgba(39,152,62,.14)" : "rgba(225,6,0,.14)") : C.surface,
                border: `1px solid ${active ? (r.results_updated ? C.green : C.red) : C.hairline}`,
                borderRadius: 12, padding: "10px 14px", cursor: "pointer",
                color: active ? C.textPrimary : C.textMuted, fontSize: 12,
                transition: "transform .2s,border-color .25s,background .25s", animation: anim("up", 20 + i * 24),
              }}>
                <span style={{ fontFamily: "'Montserrat',sans-serif", fontWeight: 700, fontSize: 9, letterSpacing: "0.1em", color: r.results_updated ? C.greenLight : C.redLight }}>R{r.round}</span>
                <span style={{ fontWeight: 600, lineHeight: 1.2, textAlign: "center" }}>{getRaceFlag(r.name)} {r.name}</span>
                {r.has_sprint && <span style={{ width: 6, height: 6, borderRadius: "50%", background: C.orange }} />}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", animation: anim("up", 70) }}>
        <button onClick={triggerFetch} disabled={triggering}
          style={{ display: "flex", alignItems: "center", gap: 10, background: "rgba(225,6,0,.09)", border: "1px solid rgba(225,6,0,.4)", color: C.redLight, padding: "12px 22px", borderRadius: 10, fontFamily: "'Montserrat',sans-serif", fontWeight: 700, fontSize: 11, letterSpacing: "0.07em", textTransform: "uppercase", cursor: "pointer", opacity: triggering ? 0.6 : 1 }}>
          {triggering && <span style={{ width: 13, height: 13, border: "2px solid rgba(233,68,64,.3)", borderTopColor: C.redLight, borderRadius: "50%", animation: "spin .8s linear infinite", display: "inline-block" }} />}
          {triggering ? "Fetching…" : (race ? `🔄 Auto-fetch R${race.round} — ${race.name}` : "🔄 Auto-fetch (select a race first)")}
        </button>
        <span style={{ fontSize: 12, color: C.textFaint }}>Pulls finishing order and bonuses from the OpenF1 API, then posts to Slack</span>
      </div>

      {toast && <Toast toast={toast} />}

      {race && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14, animation: anim("up", 140) }}>
          <span style={{ fontFamily: "Orbitron,sans-serif", fontWeight: 700, fontSize: 18, color: C.textPrimary, letterSpacing: "0.03em" }}>{race.name} — MANUAL ENTRY</span>
          <div style={{ border: `1px solid ${C.hairline}`, borderRadius: 14, overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
              <div style={{ minWidth: 700 }}>
                <div style={{ display: "grid", gridTemplateColumns: gridCols, padding: "12px 20px", background: C.surfaceRaised, fontFamily: "'Montserrat',sans-serif", fontWeight: 700, fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: C.textMuted }}>
                  <span>Driver</span><span>Constructor</span><span style={{ textAlign: "center" }}>DNF</span><span style={{ textAlign: "center" }}>Pos</span><span style={{ textAlign: "center" }}>Pole</span><span style={{ textAlign: "center" }}>FL</span><span style={{ textAlign: "center" }}>MPG</span>
                  {race.has_sprint && <><span style={{ textAlign: "center" }}>SW</span><span style={{ textAlign: "center" }}>SP</span></>}
                </div>
                {drivers.map((d, i) => {
                  const f = form[d.id] ?? {};
                  return (
                    <div key={d.id} style={{ display: "grid", gridTemplateColumns: gridCols, alignItems: "center", padding: "7px 20px", borderTop: `1px solid ${C.rowLine}`, transition: "background .2s", animation: anim("up", 10 + i * 16) }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: C.textBody, whiteSpace: "nowrap" }}>{d.name}</span>
                      <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: C.textMuted }}>
                        <ConstructorLogo constructor={d.constructor} results={results} drivers={drivers} size={14} />{d.constructor}
                      </span>
                      <span style={{ textAlign: "center" }}>
                        <input type="checkbox" checked={f.dnf ?? false} onChange={e => { upd(d.id, "dnf", e.target.checked); if (e.target.checked) upd(d.id, "finish_position", ""); }} style={{ width: 15, height: 15, cursor: "pointer", accentColor: C.red }} />
                      </span>
                      <span style={{ textAlign: "center" }}>
                        <input type="number" min="1" max="22" value={f.finish_position ?? ""} onChange={e => upd(d.id, "finish_position", e.target.value)}
                          disabled={f.dnf ?? false}
                          style={{ width: 54, background: f.dnf ? "rgba(225,6,0,.08)" : C.surface, border: `1px solid ${f.dnf ? "rgba(225,6,0,.4)" : C.borderStrong}`, color: f.dnf ? C.textFaint : C.textBody, padding: "5px 8px", borderRadius: 7, fontSize: 13, textAlign: "center", outline: "none", fontFamily: "Orbitron,sans-serif", cursor: f.dnf ? "not-allowed" : "text" }} />
                      </span>
                      {["pole_position", "fastest_lap", "most_pos_gained"].map(field => (
                        <span key={field} style={{ textAlign: "center" }}>
                          <input type="checkbox" checked={f[field] ?? false} onChange={e => upd(d.id, field, e.target.checked)} style={{ width: 15, height: 15, cursor: "pointer", accentColor: C.red }} />
                        </span>
                      ))}
                      {race.has_sprint && ["sprint_win", "sprint_pole"].map(field => (
                        <span key={field} style={{ textAlign: "center" }}>
                          <input type="checkbox" checked={f[field] ?? false} onChange={e => upd(d.id, field, e.target.checked)} style={{ width: 15, height: 15, cursor: "pointer", accentColor: C.red }} />
                        </span>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
            <button onClick={save} disabled={saving} style={{ background: C.red, border: "none", color: "#fff", padding: "14px 30px", borderRadius: 10, fontFamily: "'Montserrat',sans-serif", fontWeight: 700, fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase", cursor: "pointer", boxShadow: "0 6px 20px rgba(225,6,0,.28)", opacity: saving ? 0.6 : 1 }}>
              {saving ? "Saving…" : "💾 Save results & notify"}
            </button>
            <span style={{ fontSize: 12, color: C.textFaint }}>Base 30 / 24 / 18 / 12 / 6 / 2 by finishing band · Pole +5 · FL +3 · MPG +2 · Sprint win +5 · Sprint pole +3 · ×1.15 constructor match</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────
export default function App() {
  const { owners, drivers, races, drafts, results, raceScores, standings, payouts, loading, error, reload } = useData();
  const [tab, setTab] = usePersistedState("f1app.tab", "scoreboard");
  const [spoilerMode, setSpoilerMode] = useState(() => {
    try { return localStorage.getItem("spoilerMode") === "true"; } catch { return false; }
  });
  const progress = useCountUp([tab, spoilerMode]);

  const toggleSpoiler = () => setSpoilerMode(prev => {
    const next = !prev;
    try { localStorage.setItem("spoilerMode", String(next)); } catch {}
    return next;
  });

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: C.bg, color: C.textBody, fontFamily: "'Titillium Web',sans-serif", position: "relative" }}>
      <style>{`
        .shell-inner{padding:0 28px}
        .standings-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}
        .shell-main{padding:30px 28px 70px}
        @media (max-width:700px){
          .shell-inner{padding:0 16px}
          .shell-main{padding:20px 16px 60px}
        }
        @media (max-width:640px){
          .standings-grid{grid-template-columns:1fr}
        }
      `}</style>

      <Header spoilerMode={spoilerMode} toggleSpoiler={toggleSpoiler} />
      {!loading && !error && !spoilerMode && <Settlement standings={standings} payouts={payouts} progress={progress} />}
      <TabNav tab={tab} setTab={setTab} />

      <main className="shell-main" style={{ flex: 1, maxWidth: 1180, margin: "0 auto", width: "100%" }}>
        {loading && <Spinner />}
        {error && <div style={{ background: "rgba(225,6,0,.08)", border: "1px solid rgba(225,6,0,.3)", color: C.redLight, padding: 16, borderRadius: 10 }}>⚠️ {error}</div>}
        {!loading && !error && tab === "scoreboard" && (
          <ScoreboardTab standings={standings} raceScores={raceScores} payouts={payouts} races={races} results={results} drafts={drafts} owners={owners} drivers={drivers} spoilerMode={spoilerMode} progress={progress} onReveal={toggleSpoiler} />
        )}
        {!loading && !error && tab === "draft" && (
          <DraftTab races={races} drafts={drafts} owners={owners} drivers={drivers} payouts={payouts} results={results} reload={reload} />
        )}
        {!loading && !error && tab === "results" && (
          <ResultsTab races={races} results={results} drivers={drivers} reload={reload} />
        )}
      </main>
    </div>
  );
}
