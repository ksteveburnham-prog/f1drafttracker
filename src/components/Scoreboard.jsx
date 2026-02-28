import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'

function basePoints(pos) {
  const p = Number(pos)
  if (!p) return 0
  if (p === 1)  return 30
  if (p <= 3)   return 24
  if (p <= 6)   return 18
  if (p <= 10)  return 12
  if (p <= 15)  return 6
  if (p <= 20)  return 2
  return 0
}

function calcPayouts(races, raceScores, owners) {
  if (!owners.length || !races.length) return { rows: [], weeklyWins: {} }
  const o1 = owners[0], o2 = owners[1]
  const weeklyWins = { [o1.id]: 0, [o2.id]: 0 }
  const rows = []
  let rollingPurse = 0

  for (const race of races) {
    const purse = 20 + rollingPurse
    const s1 = raceScores.find(s => s.race_id === race.id && s.owner_id === o1.id)
    const s2 = raceScores.find(s => s.race_id === race.id && s.owner_id === o2.id)
    const p1 = s1?.total_points || 0
    const p2 = s2?.total_points || 0
    let winner = null, w1 = 0, w2 = 0

    if (p1 > 0 || p2 > 0) {
      if (p1 > p2)      { winner = o1.name; w1 = purse; weeklyWins[o1.id] += purse; rollingPurse = 0 }
      else if (p2 > p1) { winner = o2.name; w2 = purse; weeklyWins[o2.id] += purse; rollingPurse = 0 }
      else              { winner = 'TIE'; rollingPurse = purse }
    }
    rows.push({ raceName: race.name, p1, p2, winner, purse: (p1 > 0 || p2 > 0) ? purse : 0, w1, w2 })
  }
  return { rows, weeklyWins }
}

export default function Scoreboard({ owners, races, selectedRace }) {
  const [scores, setScores] = useState([])
  const [raceScores, setRaceScores] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => { if (selectedRace) loadScores() }, [selectedRace])
  useEffect(() => { loadAllRaceScores() }, [races])

  async function loadScores() {
    setLoading(true)
    const { data } = await supabase.from('draft_scores').select('*').eq('race_id', selectedRace.id).order('owner_id')
    setScores(data || [])
    setLoading(false)
  }

  async function loadAllRaceScores() {
    const { data } = await supabase.from('owner_race_totals').select('*').order('race_id')
    setRaceScores(data || [])
  }

  const byOwner = owners.map(owner => {
    const ownerScores = scores.filter(s => s.owner_id === owner.id)
    const totalPts = ownerScores.reduce((sum, s) => sum + (s.base_points || 0) + (s.constructor_bonus || 0) + (s.bonus_points || 0), 0)
    return { owner, scores: ownerScores, totalPts }
  })

  const payouts = calcPayouts(races, raceScores, owners)
  const seasonTotals = owners.map(owner => ({
    owner,
    total: raceScores.filter(r => r.owner_id === owner.id).reduce((s, r) => s + (r.total_points || 0), 0)
  })).sort((a, b) => b.total - a.total)

  const ptsDiff = seasonTotals.length === 2 ? Math.abs(seasonTotals[0].total - seasonTotals[1].total) : 0
  const ptsLeader = seasonTotals[0]
  const o1 = owners[0], o2 = owners[1]
  const s1Total = (payouts.weeklyWins[o1?.id] || 0) + (ptsLeader?.owner?.id === o1?.id ? ptsDiff : 0)
  const s2Total = (payouts.weeklyWins[o2?.id] || 0) + (ptsLeader?.owner?.id === o2?.id ? ptsDiff : 0)
  const owesAmt = Math.abs(s1Total - s2Total)
  const owesName = s1Total < s2Total ? o1?.name : o2?.name
  const owedName = s1Total < s2Total ? o2?.name : o1?.name

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:32 }}>

      {/* Settlement banner */}
      <div className="animate-fade-up" style={{ background:'linear-gradient(135deg,#0a0e1a 0%,#1a0510 50%,#0a0e1a 100%)', border:'1px solid rgba(232,0,45,0.3)', borderRadius:12, padding:'32px 40px', textAlign:'center', boxShadow:'0 0 40px rgba(232,0,45,0.1)' }}>
        <div style={{ fontSize:11, fontWeight:700, letterSpacing:'0.2em', color:'var(--gray)', marginBottom:12 }}>SEASON SETTLEMENT</div>
        <div style={{ fontSize:'clamp(22px,4vw,36px)', fontWeight:900, color:'var(--gold-lt)', letterSpacing:'0.05em' }}>
          {owesAmt === 0 ? '🤝  ALL SQUARE' : `💸  ${owesName}  OWES  ${owedName}  $${owesAmt.toLocaleString()}`}
        </div>
        <div style={{ fontSize:12, color:'var(--gray)', marginTop:8 }}>Weekly wins + points advantage combined</div>
      </div>

      {/* Owner cards */}
      <div className="animate-fade-up-2" style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(320px,1fr))', gap:20 }}>
        {owners.map((owner, i) => {
          const od = byOwner.find(b => b.owner.id === owner.id)
          const weeklyWins = payouts.weeklyWins[owner.id] || 0
          const seasonPts = seasonTotals.find(s => s.owner.id === owner.id)?.total || 0
          const ptsEarned = ptsLeader?.owner?.id === owner.id ? ptsDiff : 0
          return (
            <div key={owner.id} style={{ borderRadius:10, padding:'24px 28px', border:'1px solid', background: i===0 ? 'linear-gradient(135deg,rgba(26,111,191,0.15),rgba(10,14,26,0.8))' : 'linear-gradient(135deg,rgba(184,92,0,0.15),rgba(10,14,26,0.8))', borderColor: i===0 ? 'rgba(26,111,191,0.4)' : 'rgba(184,92,0,0.4)' }}>
              <div style={{ fontSize:24, fontWeight:900, letterSpacing:'0.05em', marginBottom:2 }}>{owner.name}</div>
              <div style={{ fontSize:12, color:'var(--gray)', fontWeight:600, letterSpacing:'0.1em', textTransform:'uppercase', marginBottom:20 }}>{owner.constructor}</div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
                {[['Season Pts', seasonPts.toFixed(1), true, false], ['This Race', od?.totalPts?.toFixed(1) || '—', false, false], ['Weekly Wins', `$${weeklyWins}`, false, true], ['Total Earned', `$${weeklyWins + ptsEarned}`, false, true]].map(([label, val, big, money]) => (
                  <div key={label}>
                    <div style={{ fontSize: big ? 32 : 22, fontWeight:700, fontFamily:'JetBrains Mono,monospace', color: big ? 'var(--gold-lt)' : money ? 'var(--green)' : 'var(--white)' }}>{val}</div>
                    <div style={{ fontSize:10, color:'var(--gray)', fontWeight:600, letterSpacing:'0.1em', textTransform:'uppercase' }}>{label}</div>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {/* This race driver breakdown */}
      {selectedRace && !loading && (
        <div className="animate-fade-up-3">
          <SectionHeader>{selectedRace.name} — Driver Scores</SectionHeader>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(340px,1fr))', gap:20 }}>
            {byOwner.map(({ owner, scores: os, totalPts }) => (
              <div key={owner.id} style={{ background:'var(--navy-mid)', borderRadius:10, border:'1px solid var(--border)', overflow:'hidden' }}>
                <div style={{ background:'var(--navy-lt)', padding:'12px 16px', display:'flex', justifyContent:'space-between', fontWeight:700, fontSize:14 }}>
                  <span>{owner.name}</span>
                  <span style={{ color:'var(--gold)', fontFamily:'JetBrains Mono,monospace' }}>{totalPts.toFixed(1)} pts</span>
                </div>
                {os.length === 0 ? (
                  <div style={{ padding:16, color:'var(--gray)', fontSize:13, textAlign:'center' }}>No draft picks entered yet</div>
                ) : os.map(s => {
                  const total = (s.base_points || 0) + (s.constructor_bonus || 0) + (s.bonus_points || 0)
                  const hasBonus = s.constructor_bonus > 0
                  const icons = [s.pole_position && '🏁', s.fastest_lap && '⚡', s.most_positions_gained && '📈', s.sprint_win && '🏃', s.sprint_pole && '🎯'].filter(Boolean)
                  return (
                    <div key={s.driver_id} style={{ padding:'10px 16px', display:'flex', justifyContent:'space-between', alignItems:'center', borderBottom:'1px solid var(--border)', fontSize:13 }}>
                      <div>
                        <div style={{ fontWeight:600 }}>{s.driver_name}</div>
                        <div style={{ fontSize:11, color:'var(--gray)' }}>{s.driver_constructor}</div>
                        {icons.length > 0 && <div style={{ fontSize:12, marginTop:2 }}>{icons.join(' ')}</div>}
                      </div>
                      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                        {s.finish_position && <span style={{ fontSize:11, color:'var(--gray)', fontFamily:'JetBrains Mono,monospace' }}>P{s.finish_position}</span>}
                        <span style={{ background: hasBonus ? 'rgba(0,196,106,0.15)' : 'var(--navy-lt)', color: hasBonus ? 'var(--green)' : 'var(--white)', fontFamily:'JetBrains Mono,monospace', fontWeight:700, fontSize:13, padding:'2px 8px', borderRadius:4, minWidth:50, textAlign:'right' }}>
                          {total.toFixed(1)}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Weekly payout log */}
      <div className="animate-fade-up-4">
        <SectionHeader>Weekly Payouts</SectionHeader>
        <div style={{ background:'var(--navy-mid)', borderRadius:10, border:'1px solid var(--border)', overflow:'hidden' }}>
          <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr 1fr 1.2fr 0.8fr 1fr 1fr', padding:'10px 16px', background:'var(--navy-lt)', fontSize:10, fontWeight:700, letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--gray)', gap:8 }}>
            {['Race', `${o1?.name} Pts`, `${o2?.name} Pts`, 'Winner', 'Purse', `${o1?.name} $`, `${o2?.name} $`].map(h => <span key={h}>{h}</span>)}
          </div>
          {payouts.rows.map((row, i) => (
            <div key={i} style={{ display:'grid', gridTemplateColumns:'2fr 1fr 1fr 1.2fr 0.8fr 1fr 1fr', padding:'9px 16px', fontSize:12, gap:8, borderBottom:'1px solid var(--border)', alignItems:'center', background: i%2===0 ? 'rgba(255,255,255,0.02)' : 'transparent' }}>
              <span style={{ fontWeight:600 }}>{row.raceName}</span>
              <span style={{ color:'var(--steve-lt)', fontFamily:'JetBrains Mono,monospace' }}>{row.p1 > 0 ? row.p1.toFixed(1) : '—'}</span>
              <span style={{ color:'var(--trevor-lt)', fontFamily:'JetBrains Mono,monospace' }}>{row.p2 > 0 ? row.p2.toFixed(1) : '—'}</span>
              <span style={{ color: row.winner === 'TIE' ? 'var(--gray)' : 'var(--green)', fontWeight:700 }}>{row.winner || '—'}</span>
              <span style={{ fontFamily:'JetBrains Mono,monospace' }}>{row.purse > 0 ? `$${row.purse}` : '—'}</span>
              <span style={{ color:'var(--steve-lt)', fontWeight:700, fontFamily:'JetBrains Mono,monospace' }}>{row.w1 > 0 ? `$${row.w1}` : '—'}</span>
              <span style={{ color:'var(--trevor-lt)', fontWeight:700, fontFamily:'JetBrains Mono,monospace' }}>{row.w2 > 0 ? `$${row.w2}` : '—'}</span>
            </div>
          ))}
        </div>
        <div style={{ fontSize:11, color:'var(--gray)', marginTop:12, fontStyle:'italic' }}>
          💡 $20 per weekly win · Purse rolls over on ties · $1/pt difference at season end
        </div>
      </div>
    </div>
  )
}

function SectionHeader({ children }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:16, marginBottom:16 }}>
      <div style={{ flex:1, height:1, background:'var(--border)' }} />
      <span style={{ fontSize:11, fontWeight:700, letterSpacing:'0.15em', color:'var(--gray)', textTransform:'uppercase', whiteSpace:'nowrap' }}>{children}</span>
      <div style={{ flex:1, height:1, background:'var(--border)' }} />
    </div>
  )
}
