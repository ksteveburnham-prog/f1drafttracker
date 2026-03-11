import { useState, useEffect, useCallback } from "react";
import { supabase } from "./lib/supabase";

const CONSTRUCTOR_COLORS = {
  "McLaren":"#FF8000","Mercedes":"#00D2BE","Red Bull":"#3671C6",
  "Ferrari":"#E8002D","Aston Martin":"#358C75","Alpine":"#0093CC",
  "Williams":"#64C4FF","Racing Bulls":"#6692FF","Haas":"#B6BABD",
  "Audi":"#BB0000","Cadillac":"#333F8C",
};

// Spicy performance emoji based on average finish position last race
// 👑 Win  🚀 Podium  😤 P4-6  🥱 P7-10  🤡 P11-15  💩 P16-20  🔥 DNF  🏗️ No data
function getConstructorEmoji(constructor, results, drivers) {
  if (!results?.length || !drivers?.length) return "🏗️";

  // Find the most recent race that has results
  const racesWithResults = [...new Set(results.map(r => r.race_id))];
  if (!racesWithResults.length) return "🏗️";
  const lastRaceId = racesWithResults[racesWithResults.length - 1];

  // Get all drivers for this constructor
  const constructorDrivers = drivers.filter(d => d.constructor === constructor);
  if (!constructorDrivers.length) return "🏗️";

  // Get their results from the last race
  const constructorResults = results.filter(r =>
    r.race_id === lastRaceId &&
    constructorDrivers.some(d => d.id === r.driver_id)
  );
  if (!constructorResults.length) return "🏗️";

  // Average finish position (DNF = position 25 for scoring purposes)
  const positions = constructorResults.map(r => r.finish_position ?? 25);
  const avg = positions.reduce((a, b) => a + b, 0) / positions.length;

  if (avg <= 1)  return "👑"; // Won
  if (avg <= 3)  return "🚀"; // Podium
  if (avg <= 6)  return "😤"; // Nearly there
  if (avg <= 10) return "🥱"; // Mid
  if (avg <= 15) return "🤡"; // Clown behavior
  if (avg <= 20) return "💩"; // Dumpster fire
  return "🔥";                // DNF chaos
}

function ConstructorLogo({ constructor, results, drivers, size=20 }) {
  const emoji = getConstructorEmoji(constructor, results, drivers);
  return (
    <span style={{fontSize: size, lineHeight:1, flexShrink:0}} title={`${constructor} — last race performance`}>
      {emoji}
    </span>
  );
}

// ── Data hook ─────────────────────────────────────────────────
function useData() {
  const [state, setState] = useState({
    owners:[], drivers:[], races:[], drafts:[],
    results:[], raceScores:[], standings:[], payouts:[],
    loading:true, error:null,
  });

  const load = useCallback(async () => {
    setState(s => ({ ...s, loading:true, error:null }));
    try {
      const [
        {data:owners},{data:drivers},{data:races},
        {data:drafts},{data:results},
        {data:raceScores},{data:standings},{data:payouts},
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
      setState({ owners:owners??[],drivers:drivers??[],races:races??[],drafts:drafts??[],results:results??[],raceScores:raceScores??[],standings:standings??[],payouts:payouts??[],loading:false,error:null });
    } catch(err) {
      setState(s => ({ ...s, loading:false, error:err.message }));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const ch = supabase.channel("db-changes")
      .on("postgres_changes",{ event:"*", schema:"public" }, () => load())
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [load]);

  return { ...state, reload:load };
}

// ── Small components ──────────────────────────────────────────
function ConstructorDot({ constructor, size=10 }) {
  return <span style={{ display:"inline-block", width:size, height:size, borderRadius:"50%", background:CONSTRUCTOR_COLORS[constructor]??"#888", flexShrink:0 }} />;
}

function Flag({ round }) {
  const colors = ["#E8002D","#FF8000","#3671C6","#00D2BE","#358C75","#0093CC"];
  const c = colors[round % colors.length];
  return (
    <svg width={18} height={18} viewBox="0 0 20 20" fill="none" style={{flexShrink:0}}>
      <rect x="2" y="2" width="2" height="16" fill="#555" rx="1"/>
      <path d="M4 2 L16 5 L4 8 Z" fill={c}/>
    </svg>
  );
}

function Badge({ children, color="#E8002D" }) {
  return <span style={{fontSize:10,fontWeight:700,padding:"2px 6px",borderRadius:4,background:color+"22",color,border:`1px solid ${color}44`,textTransform:"uppercase",letterSpacing:"0.5px"}}>{children}</span>;
}

function Spinner() {
  return (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:300,gap:16}}>
      <div style={{width:40,height:40,border:"3px solid #222",borderTopColor:"#E8002D",borderRadius:"50%",animation:"spin 0.8s linear infinite"}}/>
      <p style={{color:"#666",fontSize:14}}>Loading race data…</p>
    </div>
  );
}

function Msg({ type, text }) {
  if(!text) return null;
  const styles = {
    success:{background:"#0a1a0e",border:"1px solid #27AE6044",color:"#27AE60"},
    error:  {background:"#1a0808",border:"1px solid #E8002D44",color:"#E8002D"},
  };
  return <div style={{padding:"10px 16px",borderRadius:8,fontSize:14,...styles[type]}}>{text}</div>;
}

// ── Race Countdown ─────────────────────────────────────────────
function RaceCountdown({ races }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(t);
  }, []);

  const nextRace = races.find(r => !r.results_updated && r.race_date && new Date(r.race_date.replace('+00:00', 'Z')) >= now);
  if (!nextRace) return null;

  const raceDate = new Date(nextRace.race_date.replace('+00:00', 'Z'));
  const diffMs = raceDate - now;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const diffHrs = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

  const urgency = diffDays === 0 ? "#E8002D" : diffDays <= 3 ? "#FF8000" : "#27AE60";

  return (
    <div style={{
      background:`linear-gradient(135deg, ${urgency}11, #0a0a0f)`,
      border:`1px solid ${urgency}33`,
      borderRadius:12, padding:"14px 20px",
      display:"flex", alignItems:"center", gap:16, flexWrap:"wrap",
      marginBottom:8,
    }}>
      <span style={{fontSize:24}}>🏁</span>
      <div style={{flex:1}}>
        <div style={{fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:1,color:"#666",marginBottom:2}}>Next Race</div>
        <div style={{fontSize:16,fontWeight:700}}>
          Round {nextRace.round} — {nextRace.name}
          {nextRace.has_sprint && <span style={{marginLeft:8}}><Badge color="#FF8000">Sprint</Badge></span>}
        </div>
      </div>
      <div style={{textAlign:"right"}}>
        {diffDays === 0 ? (
          <div style={{fontSize:22,fontWeight:900,color:urgency}}>TODAY 🚨</div>
        ) : (
          <div>
            <span style={{fontSize:28,fontWeight:900,color:urgency}}>{diffDays}</span>
            <span style={{fontSize:13,color:"#888",marginLeft:4}}>days {diffHrs}h</span>
          </div>
        )}
        <div style={{fontSize:11,color:"#555",marginTop:2}}>
          {raceDate.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}
        </div>
      </div>
    </div>
  );
}

// ── Points Breakdown Modal ─────────────────────────────────────
function PointsBreakdownModal({ race, results, drafts, owners, drivers, onClose }) {
  if (!race) return null;

  const raceResults = results.filter(r => r.race_id === race.id);
  const raceDrafts = drafts.filter(d => d.race_id === race.id);

  const ownerBreakdowns = owners.map(owner => {
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
      // null or 0 = DNF, scores 0

      let bonus = 0;
      if (result.pole_position) bonus += 5;
      if (result.fastest_lap) bonus += 3;
      if (result.most_pos_gained) bonus += 2;
      if (result.sprint_win) bonus += 5;
      if (result.sprint_pole) bonus += 3;

      const constructorMatch = driver.constructor === owner.constructor;
      const multiplier = constructorMatch ? 1.15 : 1.0;
      const total = Math.round(base * multiplier + bonus);

      return { driver, result, base, bonus, multiplier, total, constructorMatch };
    }).filter(Boolean);

    const totalPts = driverRows.reduce((s, r) => s + r.total, 0);
    return { owner, driverRows, totalPts };
  });

  return (
    <div style={{
      position:"fixed", inset:0, background:"rgba(0,0,0,0.85)",
      zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center",
      padding:16,
    }} onClick={onClose}>
      <div style={{
        background:"#111118", border:"1px solid #222232", borderRadius:16,
        width:"100%", maxWidth:680, maxHeight:"85vh", overflowY:"auto",
        padding:24,
      }} onClick={e => e.stopPropagation()}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20}}>
          <h2 style={{fontSize:18,fontWeight:700}}>
            <Flag round={race.round}/>&nbsp; {race.name} — Points Breakdown
          </h2>
          <button onClick={onClose} style={{background:"none",border:"none",color:"#666",fontSize:22,cursor:"pointer",lineHeight:1}}>✕</button>
        </div>

        <div style={{display:"flex",flexDirection:"column",gap:20}}>
          {ownerBreakdowns.map(({ owner, driverRows, totalPts }) => (
            <div key={owner.id} style={{background:"#0a0a14",borderRadius:12,padding:16,border:"1px solid #222232"}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
                <div style={{fontSize:15,fontWeight:700}}>{owner.name}</div>
                <div style={{fontSize:20,fontWeight:900,color:"#E8002D"}}>{Math.round(totalPts)} pts</div>
              </div>
              {driverRows.length === 0 ? (
                <div style={{color:"#444",fontSize:13,fontStyle:"italic"}}>No results yet</div>
              ) : (
                <div style={{display:"flex",flexDirection:"column",gap:8}}>
                  {driverRows.map(({ driver, result, base, bonus, multiplier, total, constructorMatch }) => (
                    <div key={driver.id} style={{
                      background:"#111118", borderRadius:8, padding:"10px 14px",
                      display:"flex", alignItems:"center", gap:12, flexWrap:"wrap",
                      border: constructorMatch ? "1px solid #D4AC0D33" : "1px solid #1a1a28",
                    }}>
                      <div style={{flex:1,minWidth:120}}>
                        <div style={{fontWeight:600,fontSize:13}}>{driver.name}</div>
                        <div style={{display:"flex",alignItems:"center",gap:4,fontSize:11,color:"#666",marginTop:2}}>
                          <ConstructorLogo constructor={driver.constructor} results={results} drivers={drivers}/>
                          {driver.constructor}
                          {constructorMatch && <span style={{color:"#D4AC0D",fontWeight:700,marginLeft:4}}>+15% 🏆</span>}
                        </div>
                      </div>
                      <div style={{display:"flex",gap:6,flexWrap:"wrap",fontSize:11}}>
                        <span style={{background:"#1a1a28",padding:"2px 8px",borderRadius:4,color:"#aaa"}}>
                          P{result.finish_position} → {base}pts
                        </span>
                        {result.pole_position && <span style={{background:"#3671C622",color:"#6692FF",padding:"2px 8px",borderRadius:4}}>Pole +5</span>}
                        {result.fastest_lap && <span style={{background:"#FF800022",color:"#FF8000",padding:"2px 8px",borderRadius:4}}>FL +3</span>}
                        {result.most_pos_gained && <span style={{background:"#27AE6022",color:"#27AE60",padding:"2px 8px",borderRadius:4}}>MPG +2</span>}
                        {result.sprint_win && <span style={{background:"#E8002D22",color:"#E8002D",padding:"2px 8px",borderRadius:4}}>SW +5</span>}
                        {result.sprint_pole && <span style={{background:"#00D2BE22",color:"#00D2BE",padding:"2px 8px",borderRadius:4}}>SP +3</span>}
                      </div>
                      <div style={{fontWeight:800,fontSize:15,color:"#fff",minWidth:50,textAlign:"right"}}>
                        {Math.round(total)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Settlement banner ─────────────────────────────────────────
function Settlement({ standings, payouts }) {
  if(!standings?.length || !payouts?.length) return null;
  const weeklyWins = {};
  for(const p of payouts) {
    if(!p.is_tie && p.winnings > 0) weeklyWins[p.owner_name] = (weeklyWins[p.owner_name]??0)+p.winnings;
  }
  const s0=standings[0], s1=standings[1];
  if(!s0||!s1) return null;
  const ptsDiff = Math.abs(Number(s0.season_points)-Number(s1.season_points));
  const ptsWinner = Number(s0.season_points)>=Number(s1.season_points)?s0.owner_name:s1.owner_name;
  const totals = {};
  for(const s of standings) {
    totals[s.owner_name] = (weeklyWins[s.owner_name]??0) + (ptsWinner===s.owner_name ? ptsDiff : 0);
  }
  const net = (totals[s0.owner_name]??0)-(totals[s1.owner_name]??0);
  const debtor   = net<0 ? s0.owner_name : s1.owner_name;
  const creditor = net<0 ? s1.owner_name : s0.owner_name;
  const amount   = Math.abs(net);
  const allSquare = amount===0;

  return (
    <div style={{background:allSquare?"linear-gradient(135deg,#051a0a,#0f0f1a)":"linear-gradient(135deg,#1a0505,#0f0f1a)",borderBottom:`1px solid ${allSquare?"#27AE6033":"#E8002D33"}`,padding:"16px 24px",display:"flex",alignItems:"center",gap:20,flexWrap:"wrap"}}>
      <div style={{fontSize:28}}>🏁</div>
      <div style={{flex:1,fontSize:18,fontWeight:600}}>
        {allSquare
          ? "🤝 All Square — No Money Owed"
          : <><span style={{color:"#fff",fontWeight:700}}>{debtor}</span> owes <span style={{color:"#fff",fontWeight:700}}>{creditor}</span> <span style={{color:"#D4AC0D",fontSize:22,fontWeight:900}}>${amount.toLocaleString()}</span></>
        }
      </div>
      <div style={{display:"flex",gap:24}}>
        {standings.map(s => (
          <div key={s.owner_id} style={{display:"flex",flexDirection:"column",alignItems:"center"}}>
            <span style={{fontSize:11,textTransform:"uppercase",letterSpacing:1,color:"#888"}}>{s.owner_name}</span>
            <span style={{fontSize:18,fontWeight:700}}>${(totals[s.owner_name]??0).toLocaleString()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Scoreboard tab ────────────────────────────────────────────
function ScoreboardTab({ standings, raceScores, payouts, races, results, drafts, owners, drivers, spoilerMode }) {
  const [breakdown, setBreakdown] = useState(null);

  const ownerNames = standings.map(s=>s.owner_name);
  const byRound = {};
  for(const rs of raceScores) {
    if(!byRound[rs.round]) byRound[rs.round]={};
    byRound[rs.round][rs.owner_name]=Number(rs.total_points);
  }
  const payoutByRound = {};
  for(const p of payouts) {
    if(!payoutByRound[p.round]) payoutByRound[p.round]={};
    payoutByRound[p.round][p.owner_name]=p;
  }

  return (
    <div style={{display:"flex",flexDirection:"column",gap:24}}>
      {breakdown && !spoilerMode && (
        <PointsBreakdownModal
          race={breakdown}
          results={results}
          drafts={drafts}
          owners={owners}
          drivers={drivers}
          onClose={() => setBreakdown(null)}
        />
      )}

      {/* Spoiler shield notice */}
      {spoilerMode && (
        <div style={{background:"linear-gradient(135deg,#1a0f00,#0a0a0f)",border:"1px solid #FF800044",borderRadius:12,padding:"16px 20px",display:"flex",alignItems:"center",gap:14}}>
          <span style={{fontSize:28}}>🙈</span>
          <div>
            <div style={{fontWeight:700,fontSize:15,color:"#FF8000",marginBottom:4}}>Spoiler Shield Active</div>
            <div style={{fontSize:13,color:"#888"}}>Race scores and results are hidden. Toggle <strong style={{color:"#aaa"}}>SHOW SCORES</strong> in the header when you're ready.</div>
          </div>
        </div>
      )}

      {/* Standing cards */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))",gap:16}}>
        {standings.map((s,i) => (
          <div key={s.owner_id} style={{background:i===0?"#1a0808":"#111118",border:`1px solid ${i===0?"#E8002D66":"#222232"}`,borderRadius:12,padding:20,display:"flex",alignItems:"center",gap:16}}>
            <div style={{fontSize:32,fontWeight:900,color:i===0?"#E8002D44":"#333",width:36}}>{i+1}</div>
            <div style={{flex:1}}>
              <div style={{fontSize:18,fontWeight:700}}>{s.owner_name}</div>
              <div style={{display:"flex",alignItems:"center",gap:6,fontSize:12,color:"#888",marginTop:4}}>
                <ConstructorLogo constructor={s.constructor} results={results} drivers={drivers}/>
                {s.constructor}
              </div>
            </div>
            <div style={{textAlign:"right"}}>
              {spoilerMode ? (
                <span style={{fontSize:20,color:"#444"}}>——</span>
              ) : (
                <>
                  <span style={{fontSize:28,fontWeight:900}}>{Math.round(Number(s.season_points))}</span>
                  <span style={{fontSize:12,color:"#666",marginLeft:2}}>pts</span>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Race table */}
      {!spoilerMode && (
        <>
          <div style={{fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:2,color:"#E8002D",paddingBottom:8,borderBottom:"1px solid #222232"}}>Race-by-Race Results</div>
          <div style={{overflowX:"auto",borderRadius:10,border:"1px solid #222232"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:14}}>
              <thead>
                <tr>
                  {["Race",...ownerNames,"Winner"].map(h=>(
                    <th key={h} style={{background:"#111118",padding:"12px 16px",textAlign:h==="Race"?"left":"center",fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:1,color:"#666",borderBottom:"1px solid #222232"}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {races.filter(r=>r.results_updated).map(race => {
                  const sc=byRound[race.round]??{};
                  const pts=ownerNames.map(o=>sc[o]??null);
                  const allHave=pts.every(p=>p!==null);
                  const maxPts=allHave?Math.max(...pts):null;
                  const isTie=allHave&&pts.every(p=>p===maxPts);
                  const winner=isTie?"Tie":ownerNames[pts.indexOf(maxPts)];
                  return (
                    <tr key={race.id}
                      onClick={() => setBreakdown(race)}
                      style={{cursor:"pointer"}}
                      onMouseEnter={e => e.currentTarget.style.background="#16161f"}
                      onMouseLeave={e => e.currentTarget.style.background=""}
                    >
                      <td style={{padding:"10px 16px",borderBottom:"1px solid #1a1a28",display:"flex",alignItems:"center",gap:8,fontWeight:500}}>
                        <Flag round={race.round}/>{race.name}
                        {race.has_sprint&&<Badge color="#FF8000">S</Badge>}
                        <span style={{fontSize:10,color:"#444",marginLeft:4}}>🔍</span>
                      </td>
                      {ownerNames.map((o,i)=>(
                        <td key={o} style={{padding:"10px 16px",borderBottom:"1px solid #1a1a28",textAlign:"center",fontWeight:600,color:allHave&&pts[i]===maxPts&&!isTie?"#27AE60":"#e8e8f0"}}>
                          {sc[o]!=null?Math.round(Number(sc[o])):"—"}
                        </td>
                      ))}
                      <td style={{padding:"10px 16px",borderBottom:"1px solid #1a1a28",textAlign:"center",fontWeight:600,color:isTie?"#888":"#fff"}}>
                        {isTie?"🤝 Tie":winner}
                      </td>
                    </tr>
                  );
                })}
                {races.filter(r=>!r.results_updated).map(race=>(
                  <tr key={race.id}>
                    <td style={{padding:"10px 16px",borderBottom:"1px solid #1a1a28",display:"flex",alignItems:"center",gap:8,color:"#444",fontWeight:500}}>
                      <Flag round={race.round}/>{race.name}
                      {race.has_sprint&&<Badge color="#FF800044">S</Badge>}
                    </td>
                    <td colSpan={ownerNames.length+2} style={{padding:"10px 16px",borderBottom:"1px solid #1a1a28",color:"#444",fontStyle:"italic"}}>
                      {race.race_date
                        ? (() => {
                            const raw = race.race_date.replace('+00:00', 'Z');
                            const d = new Date(raw);
                            return d.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})
                              + " · "
                              + d.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",timeZoneName:"short"});
                          })()
                        : "Upcoming"
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{fontSize:11,color:"#444",fontStyle:"italic"}}>💡 Tap any completed race row to see the full points breakdown</div>
        </>
      )}
    </div>
  );
}

// ── Draft tab ─────────────────────────────────────────────────
function DraftTab({ races, drafts, owners, drivers, payouts, results, reload }) {
  const [selRace, setSelRace] = useState(null);
  const [picks, setPicks] = useState({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);

  const race = races.find(r=>r.id===selRace);
  const existing = drafts.filter(d=>d.race_id===selRace);

  // Determine who picks first:
  // Round 1 → Steve (index 0)
  // Round 2+ → loser of most recent non-tied race picks first
  // Tie → look further back until a non-tie is found
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
  for(let rnd=1;rnd<=8;rnd++) {
    const seq = rnd%2===1 ? [firstPickerIdx, 1-firstPickerIdx] : [1-firstPickerIdx, firstPickerIdx];
    for(const ownerIdx of seq) snakeOrder.push({ pick:snakeOrder.length+1, round:rnd, ownerIdx });
  }

  const usedIds = [
    ...Object.values(picks).map(p=>p.driverId).filter(Boolean),
    ...existing.map(d=>d.driver_id),
  ];

  const handlePick = (pick,driverId,ownerIdx) => {
    setPicks(prev=>({...prev,[pick]:{driverId,ownerIdx}}));
  };

  const save = async () => {
    if(!race) return;
    setSaving(true); setMsg(null);
    const rows = Object.entries(picks).filter(([,v])=>v.driverId).map(([pick,v])=>({
      race_id:race.id, owner_id:owners[v.ownerIdx]?.id,
      driver_id:v.driverId, pick_number:Number(pick),
    }));
    const {error} = await supabase.from("drafts").upsert(rows,{onConflict:"race_id,driver_id"});
    setSaving(false);
    if(error) setMsg({type:"error",text:error.message});
    else { setMsg({type:"success",text:"Draft saved!"}); setPicks({}); reload(); }
  };

  const tdStyle = (ownerIdx) => ({
    padding:"8px 14px", borderBottom:"1px solid #1a1a28",
    background:ownerIdx===0?"#0d1520":"#150d0d",
  });

  return (
    <div style={{display:"flex",flexDirection:"column",gap:24}}>
      {/* Race picker */}
      <div style={{display:"flex",flexDirection:"column",gap:12}}>
        <span style={{fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:"1.5px",color:"#666"}}>Select Race Week</span>
        <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
          {(() => {
            const nextUpcoming = races.find(r => !r.results_updated);
            const availableRaces = races.filter(r => r.results_updated || r.id === nextUpcoming?.id);
            return availableRaces;
          })().map(r=>(
            <button key={r.id} onClick={()=>{setSelRace(r.id);setPicks({});setMsg(null);}} style={{
              display:"flex",flexDirection:"column",alignItems:"center",
              background:selRace===r.id?(r.results_updated?"#0a1a0e":"#1a0808"):(r.results_updated?"#0a1a0e":"#111118"),
              border:`1px solid ${selRace===r.id?(r.results_updated?"#27AE60":"#E8002D"):(r.results_updated?"#27AE6044":"#222232")}`,
              borderRadius:8, padding:"8px 12px", cursor:"pointer",
              color:selRace===r.id?"#fff":"#888", fontSize:11, gap:2, minWidth:64,
              transition:"all 0.15s",
            }}>
              <span style={{fontSize:10,fontWeight:700,color:r.results_updated?"#27AE60":"#E8002D"}}>R{r.round}</span>
              <span style={{fontWeight:600,textAlign:"center",lineHeight:1.2}}>{r.name}</span>
              {r.has_sprint&&<span style={{width:6,height:6,background:"#FF8000",borderRadius:"50%",display:"inline-block"}}/>}
            </button>
          ))}
        </div>
      </div>

      {race && (
        <div style={{display:"flex",flexDirection:"column",gap:16}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
            <h3 style={{fontSize:16,fontWeight:700}}>Draft Board — {race.name}</h3>
            <div style={{fontSize:12,color:"#888",background:"#111118",border:"1px solid #222232",borderRadius:8,padding:"8px 14px",display:"inline-flex",alignItems:"center",gap:6}}>
              🎯 <span style={{color:"#fff",fontWeight:600}}>{owners[firstPickerIdx]?.name}</span> picks first
              {race.round === 1
                ? <span style={{color:"#555"}}>(Round 1 default)</span>
                : <span style={{color:"#555"}}>(lost previous race)</span>
              }
            </div>
            {existing.length>0&&<Badge color="#27AE60">{existing.length} picks saved</Badge>}
          </div>
          <Msg {...(msg??{type:"success",text:""})} />
          <div style={{overflowX:"auto",borderRadius:10,border:"1px solid #222232"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:14}}>
              <thead>
                <tr>
                  {["Pick","Rnd","Owner","Driver","Constructor"].map(h=>(
                    <th key={h} style={{background:"#111118",padding:"10px 14px",textAlign:"left",fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:1,color:"#666",borderBottom:"1px solid #222232"}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {snakeOrder.map(({pick,round,ownerIdx})=>{
                  const owner=owners[ownerIdx];
                  const ex=existing.find(d=>d.pick_number===pick);
                  const cur=picks[pick];
                  const selId=ex?.driver_id??cur?.driverId;
                  const selDriver=drivers.find(d=>d.id===selId);
                  return (
                    <tr key={pick}>
                      <td style={{...tdStyle(ownerIdx),fontWeight:700,color:"#666",width:36}}>{pick}</td>
                      <td style={tdStyle(ownerIdx)}>{round}</td>
                      <td style={tdStyle(ownerIdx)}>
                        <span style={{fontSize:11,fontWeight:700,padding:"2px 8px",borderRadius:4,background:ownerIdx===0?"#1A527644":"#7D3C1B44",color:ownerIdx===0?"#5dade2":"#e59866"}}>{owner?.name}</span>
                      </td>
                      <td style={tdStyle(ownerIdx)}>
                        {ex ? (
                          <span style={{color:"#27AE60",fontWeight:500}}>{ex.drivers?.name}</span>
                        ) : (
                          <select value={cur?.driverId??""} onChange={e=>handlePick(pick,e.target.value,ownerIdx)}
                            style={{background:"#0a0a14",border:"1px solid #2a2a3a",color:"#e8e8f0",padding:"6px 10px",borderRadius:6,fontSize:13,width:"100%",minWidth:160,cursor:"pointer",outline:"none"}}>
                            <option value="">— Select driver —</option>
                            {drivers.filter(d=>!usedIds.includes(d.id)||d.id===cur?.driverId).map(d=>(
                              <option key={d.id} value={d.id}>{d.name}</option>
                            ))}
                          </select>
                        )}
                      </td>
                      <td style={tdStyle(ownerIdx)}>
                        {selDriver&&<span style={{display:"flex",alignItems:"center",gap:6,fontSize:12,color:"#aaa"}}><ConstructorLogo constructor={selDriver.constructor} results={results} drivers={drivers}/>{selDriver.constructor}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {Object.keys(picks).length>0&&(
            <button onClick={save} disabled={saving} style={{alignSelf:"flex-start",background:"#E8002D",color:"white",border:"none",padding:"12px 28px",borderRadius:8,fontSize:14,fontWeight:700,cursor:"pointer",opacity:saving?0.5:1}}>
              {saving?"Saving…":`Save ${Object.keys(picks).length} Pick${Object.keys(picks).length>1?"s":""}`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Results tab ───────────────────────────────────────────────
function ResultsTab({ races, results, drivers, reload }) {
  const [selRace, setSelRace] = useState(null);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const [triggering, setTriggering] = useState(false);

  const race = races.find(r=>r.id===selRace);

  useEffect(() => {
    if(!selRace) return;
    const f={};
    for(const d of drivers){
      const ex=results.find(r=>r.race_id===selRace&&r.driver_id===d.id);
      f[d.id]={finish_position:ex?.finish_position??"",dnf:ex?.finish_position===null&&ex?.race_id?true:false,pole_position:ex?.pole_position??false,fastest_lap:ex?.fastest_lap??false,most_pos_gained:ex?.most_pos_gained??false,sprint_win:ex?.sprint_win??false,sprint_pole:ex?.sprint_pole??false};
    }
    setForm(f);
  }, [selRace, results]);

  const upd = (dId,field,val) => setForm(prev=>({...prev,[dId]:{...prev[dId],[field]:val}}));

  const save = async () => {
    if(!race) return;
    setSaving(true); setMsg(null);
    const rows=Object.entries(form).filter(([,v])=>v.finish_position!==""||v.dnf).map(([dId,v])=>({
      race_id:race.id,driver_id:dId,finish_position:v.dnf?null:Number(v.finish_position),
      pole_position:v.pole_position,fastest_lap:v.fastest_lap,
      most_pos_gained:v.most_pos_gained,sprint_win:v.sprint_win,sprint_pole:v.sprint_pole,
    }));
    const {error}=await supabase.from("race_results").upsert(rows,{onConflict:"race_id,driver_id"});
    if(!error) await supabase.from("races").update({results_updated:true,updated_at:new Date().toISOString()}).eq("id",race.id);
    setSaving(false);
    if(error) setMsg({type:"error",text:error.message});
    else { setMsg({type:"success",text:"Results saved!"}); reload(); }
  };

  const triggerFetch = async () => {
    setTriggering(true); setMsg(null);
    try {
      const res=await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/update-scores-v2`,{
        method:"POST",
        headers:{"Authorization":`Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,"Content-Type":"application/json"},
        body:"{}",
      });
      const data=await res.json();
      setMsg({type:res.ok?"success":"error",text:res.ok?`Updated: ${data.race} (${data.results_upserted} drivers)`:data.error});
      if(res.ok) reload();
    } catch(e){ setMsg({type:"error",text:e.message}); }
    setTriggering(false);
  };

  const thStyle = {background:"#111118",padding:"10px 12px",fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:1,color:"#666",borderBottom:"1px solid #222232",textAlign:"center"};
  const tdStyle = {padding:"6px 12px",borderBottom:"1px solid #1a1a28",textAlign:"center"};

  return (
    <div style={{display:"flex",flexDirection:"column",gap:24}}>
      <div style={{display:"flex",alignItems:"center",gap:16,flexWrap:"wrap"}}>
        <button onClick={triggerFetch} disabled={triggering} style={{background:"#1a0a0a",border:"1px solid #E8002D66",color:"#E8002D",padding:"10px 20px",borderRadius:8,fontSize:14,fontWeight:600,cursor:"pointer",opacity:triggering?0.5:1}}>
          {triggering?"Fetching…":"🔄 Auto-fetch Latest Results"}
        </button>
        <span style={{fontSize:12,color:"#666"}}>Pulls from OpenF1 API and sends Slack notification</span>
      </div>
      {msg&&<Msg {...msg}/>}

      <div style={{display:"flex",flexDirection:"column",gap:12}}>
        <span style={{fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:"1.5px",color:"#666"}}>Or enter manually</span>
        <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
          {races.map(r=>(
            <button key={r.id} onClick={()=>{setSelRace(r.id);setMsg(null);}} style={{
              display:"flex",flexDirection:"column",alignItems:"center",
              background:selRace===r.id?(r.results_updated?"#0a1a0e":"#1a0808"):(r.results_updated?"#0a1a0e":"#111118"),
              border:`1px solid ${selRace===r.id?(r.results_updated?"#27AE60":"#E8002D"):(r.results_updated?"#27AE6044":"#222232")}`,
              borderRadius:8,padding:"8px 12px",cursor:"pointer",
              color:selRace===r.id?"#fff":"#888",fontSize:11,gap:2,minWidth:64,
            }}>
              <span style={{fontSize:10,fontWeight:700,color:r.results_updated?"#27AE60":"#E8002D"}}>R{r.round}</span>
              <span style={{fontWeight:600,textAlign:"center",lineHeight:1.2}}>{r.name}</span>
              {r.has_sprint&&<span style={{width:6,height:6,background:"#FF8000",borderRadius:"50%"}}/>}
            </button>
          ))}
        </div>
      </div>

      {race && (
        <div style={{display:"flex",flexDirection:"column",gap:16}}>
          <h3 style={{fontSize:16,fontWeight:700}}>{race.name} — Results Entry</h3>
          <div style={{overflowX:"auto",borderRadius:10,border:"1px solid #222232"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
              <thead>
                <tr>
                  <th style={{...thStyle,textAlign:"left"}}>Driver</th>
                  <th style={{...thStyle,textAlign:"left"}}>Constructor</th>
                  <th style={thStyle} title="Did Not Finish">DNF</th>
                  <th style={thStyle}>Pos</th>
                  <th style={thStyle} title="Pole Position">P</th>
                  <th style={thStyle} title="Fastest Lap">FL</th>
                  <th style={thStyle} title="Most Positions Gained">MPG</th>
                  {race.has_sprint&&<><th style={thStyle} title="Sprint Win">SW</th><th style={thStyle} title="Sprint Pole">SP</th></>}
                </tr>
              </thead>
              <tbody>
                {drivers.map(d=>{
                  const f=form[d.id]??{};
                  return (
                    <tr key={d.id}>
                      <td style={{...tdStyle,textAlign:"left",fontWeight:500,whiteSpace:"nowrap"}}>{d.name}</td>
                      <td style={{...tdStyle,textAlign:"left"}}>
                        <span style={{display:"flex",alignItems:"center",gap:6,fontSize:12,color:"#aaa"}}>
                          <ConstructorLogo constructor={d.constructor} results={results} drivers={drivers}/>{d.constructor}
                        </span>
                      </td>
                      <td style={tdStyle}>
                        <input type="checkbox" checked={f.dnf??false} onChange={e=>{upd(d.id,"dnf",e.target.checked);if(e.target.checked)upd(d.id,"finish_position","");}} style={{width:16,height:16,cursor:"pointer",accentColor:"#E8002D"}}/>
                      </td>
                      <td style={tdStyle}>
                        <input type="number" min="1" max="20" value={f.finish_position??""} onChange={e=>upd(d.id,"finish_position",e.target.value)}
                          disabled={f.dnf??false}
                          style={{width:52,background:f.dnf?"#1a0808":"#0a0a14",border:`1px solid ${f.dnf?"#E8002D44":"#2a2a3a"}`,color:f.dnf?"#444":"#e8e8f0",padding:"4px 8px",borderRadius:5,fontSize:13,textAlign:"center",outline:"none",cursor:f.dnf?"not-allowed":"text"}}/>
                      </td>
                      {["pole_position","fastest_lap","most_pos_gained"].map(field=>(
                        <td key={field} style={tdStyle}>
                          <input type="checkbox" checked={f[field]??false} onChange={e=>upd(d.id,field,e.target.checked)} style={{width:16,height:16,cursor:"pointer",accentColor:"#E8002D"}}/>
                        </td>
                      ))}
                      {race.has_sprint&&["sprint_win","sprint_pole"].map(field=>(
                        <td key={field} style={tdStyle}>
                          <input type="checkbox" checked={f[field]??false} onChange={e=>upd(d.id,field,e.target.checked)} style={{width:16,height:16,cursor:"pointer",accentColor:"#E8002D"}}/>
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <button onClick={save} disabled={saving} style={{alignSelf:"flex-start",background:"#E8002D",color:"white",border:"none",padding:"12px 28px",borderRadius:8,fontSize:14,fontWeight:700,cursor:"pointer",opacity:saving?0.5:1}}>
            {saving?"Saving…":"Save Results"}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────
export default function App() {
  const { owners,drivers,races,drafts,results,raceScores,standings,payouts,loading,error,reload } = useData();
  const [tab, setTab] = useState("scoreboard");
  const [spoilerMode, setSpoilerMode] = useState(() => {
    try { return localStorage.getItem("spoilerMode") === "true"; } catch { return false; }
  });

  const toggleSpoiler = () => setSpoilerMode(prev => {
    const next = !prev;
    try { localStorage.setItem("spoilerMode", String(next)); } catch {}
    return next;
  });

  return (
    <div style={{minHeight:"100vh",display:"flex",flexDirection:"column",background:"#0a0a0f",color:"#e8e8f0",fontFamily:"'DM Sans','Segoe UI',sans-serif"}}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #0a0a0f; }
        select option { background: #111118; color: #e8e8f0; }
        input[type=number]::-webkit-inner-spin-button { opacity:1; }
        @media (max-width: 600px) {
          .main-content { padding: 16px !important; }
          .header-title { font-size: 18px !important; }
          .tab-label-full { display: none; }
          .tab-label-short { display: inline !important; }
          .settlement-text { font-size: 15px !important; }
        }
      `}</style>

      {/* Header */}
      <header style={{background:"linear-gradient(135deg,#0d0d1a 0%,#1a0a0a 100%)",borderBottom:"2px solid #E8002D33",padding:"0 16px"}}>
        <div style={{maxWidth:1100,margin:"0 auto",display:"flex",alignItems:"center",justifyContent:"space-between",height:56,gap:8}}>
          <div style={{display:"flex",alignItems:"center",gap:10,flexShrink:0}}>
            <span style={{fontSize:24}}>🏎</span>
            <h1 className="header-title" style={{fontSize:20,fontWeight:800,letterSpacing:"-0.5px"}}>F1 Fantasy <span style={{color:"#E8002D"}}>2026</span></h1>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",justifyContent:"flex-end"}}>
            <button
              onClick={toggleSpoiler}
              title={spoilerMode ? "Spoiler Shield ON — scores hidden. Click to reveal." : "Spoiler Shield OFF — click to hide scores."}
              style={{
                display:"flex",alignItems:"center",gap:6,
                fontSize:11,fontWeight:700,letterSpacing:0.5,
                background: spoilerMode ? "#FF800033" : "#22222288",
                color: spoilerMode ? "#FF8000" : "#555",
                padding:"4px 10px",borderRadius:20,
                border: spoilerMode ? "1px solid #FF800066" : "1px solid #33333366",
                cursor:"pointer",whiteSpace:"nowrap",transition:"all 0.2s",
              }}
            >
              {spoilerMode ? "🙈 SPOILERS HIDDEN" : "👁 SHOW SCORES"}
            </button>
            <span style={{fontSize:11,fontWeight:600,letterSpacing:1,background:"#E8002D22",color:"#E8002D",padding:"4px 10px",borderRadius:20,border:"1px solid #E8002D44",textTransform:"uppercase",whiteSpace:"nowrap"}}>
              Steve vs Trevor
            </span>
          </div>
        </div>
      </header>

      {/* Settlement */}
      {!loading&&!error&&!spoilerMode&&<Settlement standings={standings} payouts={payouts}/>}

      {/* Tabs */}
      <nav style={{display:"flex",gap:2,background:"#111118",borderBottom:"1px solid #222232",padding:"0 16px",overflowX:"auto"}}>
        {[
          ["scoreboard","🏆 Scoreboard","🏆"],
          ["draft","📋 Draft","📋"],
          ["results","🏁 Results","🏁"],
        ].map(([id,label,short])=>(
          <button key={id} onClick={()=>setTab(id)} style={{background:"none",border:"none",cursor:"pointer",color:tab===id?"#fff":"#666",fontSize:14,fontWeight:600,padding:"14px 16px",borderBottom:`3px solid ${tab===id?"#E8002D":"transparent"}`,transition:"all 0.15s",whiteSpace:"nowrap"}}>
            <span className="tab-label-full">{label}</span>
            <span className="tab-label-short" style={{display:"none"}}>{short}</span>
          </button>
        ))}
      </nav>

      {/* Content */}
      <main className="main-content" style={{flex:1,padding:24,maxWidth:1100,margin:"0 auto",width:"100%"}}>
        {loading && <Spinner/>}
        {error   && <div style={{background:"#1a0808",border:"1px solid #E8002D44",color:"#E8002D",padding:16,borderRadius:8}}>⚠️ {error}</div>}
        {!loading&&!error&&(
          <>
            {tab==="scoreboard" && <RaceCountdown races={races}/>}
            {tab==="scoreboard" && <ScoreboardTab standings={standings} raceScores={raceScores} payouts={payouts} races={races} results={results} drafts={drafts} owners={owners} drivers={drivers} spoilerMode={spoilerMode}/>}
            {tab==="draft"      && <RaceCountdown races={races}/>}
            {tab==="draft"      && <DraftTab races={races} drafts={drafts} owners={owners} drivers={drivers} payouts={payouts} results={results} reload={reload}/>}
            {tab==="results"    && <ResultsTab races={races} results={results} drivers={drivers} reload={reload}/>}
          </>
        )}
      </main>
    </div>
  );
}
