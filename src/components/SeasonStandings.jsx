import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'

export default function SeasonStandings({ owners, races }) {
  const [raceTotals, setRaceTotals] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)
    const { data } = await supabase
      .from('owner_race_totals')
      .select('*')
      .order('race_id')
    setRaceTotals(data || [])
    setLoading(false)
  }

  const completedRaces = races.filter(r => r.results_ready)

  // Season totals
  const seasonTotals = owners.map(owner => {
    const total = raceTotals
      .filter(r => r.owner_id === owner.id)
      .reduce((sum, r) => sum + (r.total_points || 0), 0)
    return { owner, total }
  }).sort((a, b) => b.total - a.total)

  const leader = seasonTotals[0]
  const trailer = seasonTotals[1]
  const gap = leader && trailer ? leader.total - trailer.total : 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>

      {/* Season leader card */}
      <div className="animate-fade-up" style={styles.leaderBanner}>
        <div style={styles.leaderLabel}>CURRENT LEADER</div>
        <div style={styles.leaderName}>{leader?.owner?.name || '—'}</div>
        <div style={styles.leaderPts}>
          <span style={styles.leaderPtsNum}>{leader?.total?.toFixed(1) || 0}</span>
          <span style={styles.leaderPtsLabel}>POINTS</span>
        </div>
        {gap > 0 && (
          <div style={styles.leaderGap}>
            +{gap.toFixed(1)} pts ahead of {trailer?.owner?.name}
          </div>
        )}
      </div>

      {/* Head-to-head comparison */}
      <div className="animate-fade-up-2" style={styles.h2hGrid}>
        {seasonTotals.map((entry, i) => {
          const isLeading = i === 0
          const raceWins = completedRaces.filter(r => {
            const o1 = raceTotals.find(t => t.race_id === r.id && t.owner_id === owners[0]?.id)
            const o2 = raceTotals.find(t => t.race_id === r.id && t.owner_id === owners[1]?.id)
            if (!o1 || !o2) return false
            if (entry.owner.id === owners[0]?.id) return o1.total_points > o2.total_points
            return o2.total_points > o1.total_points
          })
          const racesScored = raceTotals.filter(t => t.owner_id === entry.owner.id).length
          const avg = racesScored ? (entry.total / racesScored).toFixed(1) : '—'

          return (
            <div
              key={entry.owner.id}
              style={{
                ...styles.h2hCard,
                ...(entry.owner.id === owners[0]?.id ? styles.h2hCardSteve : styles.h2hCardTrevor),
              }}
            >
              {isLeading && <div style={styles.leadingBadge}>🏆 Leading</div>}
              <div style={styles.h2hName}>{entry.owner.name}</div>
              <div style={styles.h2hConstructor}>{entry.owner.constructor}</div>
              <div style={styles.h2hStats}>
                <H2HStat label="Total Points" value={entry.total.toFixed(1)} large />
                <H2HStat label="Race Wins" value={raceWins.length} />
                <H2HStat label="Avg / Race" value={avg} />
                <H2HStat label="Races Scored" value={racesScored} />
              </div>
            </div>
          )
        })}
      </div>

      {/* Race-by-race table */}
      <div className="animate-fade-up-3">
        <div style={styles.sectionHeader}>
          <div style={styles.sectionLine} />
          <span style={styles.sectionLabel}>RACE-BY-RACE BREAKDOWN</span>
          <div style={styles.sectionLine} />
        </div>

        <div style={styles.table}>
          <div style={styles.tableHeader}>
            <span>Round</span>
            <span>Race</span>
            {owners.map(o => (
              <span key={o.id} style={{ textAlign: 'right' }}>{o.name}</span>
            ))}
            <span style={{ textAlign: 'center' }}>Winner</span>
          </div>

          {races.map((race, i) => {
            const o1pts = raceTotals.find(t => t.race_id === race.id && t.owner_id === owners[0]?.id)?.total_points || 0
            const o2pts = raceTotals.find(t => t.race_id === race.id && t.owner_id === owners[1]?.id)?.total_points || 0
            const hasData = o1pts > 0 || o2pts > 0
            let winner = null
            if (hasData) {
              if (o1pts > o2pts)      winner = owners[0]?.name
              else if (o2pts > o1pts) winner = owners[1]?.name
              else                    winner = 'TIE'
            }

            return (
              <div
                key={race.id}
                style={{
                  ...styles.tableRow,
                  ...(i % 2 === 0 ? styles.tableRowAlt : {}),
                  ...(!hasData ? styles.tableRowPending : {}),
                }}
              >
                <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: 'var(--gray)' }}>
                  R{race.round}
                </span>
                <span style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                  {race.name}
                  {race.has_sprint && <span style={styles.sprintDot}>⚡</span>}
                </span>
                <span style={{ textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', color: hasData ? 'var(--steve-lt)' : 'var(--gray)' }}>
                  {hasData ? o1pts.toFixed(1) : '—'}
                </span>
                <span style={{ textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', color: hasData ? 'var(--trevor-lt)' : 'var(--gray)' }}>
                  {hasData ? o2pts.toFixed(1) : '—'}
                </span>
                <span style={{ textAlign: 'center', fontWeight: 700, color: winner === 'TIE' ? 'var(--gray)' : 'var(--green)', fontSize: 12 }}>
                  {winner || (race.results_ready ? '—' : '🔜')}
                </span>
              </div>
            )
          })}

          {/* Totals row */}
          <div style={styles.totalsRow}>
            <span />
            <span style={{ fontWeight: 700 }}>SEASON TOTAL</span>
            {seasonTotals.map(entry => (
              <span key={entry.owner.id} style={{
                textAlign: 'right',
                fontFamily: 'JetBrains Mono, monospace',
                fontWeight: 700,
                fontSize: 16,
                color: 'var(--gold-lt)'
              }}>
                {entry.total.toFixed(1)}
              </span>
            ))}
            <span />
          </div>
        </div>
      </div>
    </div>
  )
}

function H2HStat({ label, value, large }) {
  return (
    <div>
      <div style={{ fontSize: large ? 28 : 20, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace', color: large ? 'var(--gold-lt)' : 'var(--white)' }}>
        {value}
      </div>
      <div style={{ fontSize: 10, color: 'var(--gray)', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
        {label}
      </div>
    </div>
  )
}

const styles = {
  leaderBanner: {
    background: 'linear-gradient(135deg, rgba(212,160,23,0.1), rgba(10,14,26,0.9))',
    border: '1px solid rgba(212,160,23,0.3)',
    borderRadius: 12,
    padding: '28px 36px',
    textAlign: 'center',
  },
  leaderLabel: {
    fontSize: 11, fontWeight: 700, letterSpacing: '0.2em',
    color: 'var(--gray)', marginBottom: 8,
  },
  leaderName: {
    fontSize: 36, fontWeight: 900, letterSpacing: '0.05em',
  },
  leaderPts: {
    display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 8, marginTop: 8,
  },
  leaderPtsNum: {
    fontSize: 48, fontWeight: 900, fontFamily: 'JetBrains Mono, monospace', color: 'var(--gold-lt)',
  },
  leaderPtsLabel: {
    fontSize: 14, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--gray)',
  },
  leaderGap: {
    fontSize: 13, color: 'var(--gray)', marginTop: 8,
  },
  h2hGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
    gap: 20,
  },
  h2hCard: {
    borderRadius: 10, padding: '24px', border: '1px solid', position: 'relative',
  },
  h2hCardSteve: {
    background: 'linear-gradient(135deg, rgba(26,111,191,0.12), transparent)',
    borderColor: 'rgba(26,111,191,0.35)',
  },
  h2hCardTrevor: {
    background: 'linear-gradient(135deg, rgba(184,92,0,0.12), transparent)',
    borderColor: 'rgba(184,92,0,0.35)',
  },
  leadingBadge: {
    position: 'absolute', top: 12, right: 12,
    fontSize: 11, fontWeight: 700,
    color: 'var(--gold)', letterSpacing: '0.05em',
  },
  h2hName: { fontSize: 22, fontWeight: 900, letterSpacing: '0.03em', marginBottom: 2 },
  h2hConstructor: { fontSize: 11, color: 'var(--gray)', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 20 },
  h2hStats: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 },
  sectionHeader: {
    display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16,
  },
  sectionLine: { flex: 1, height: 1, background: 'var(--border)' },
  sectionLabel: {
    fontSize: 11, fontWeight: 700, letterSpacing: '0.2em', color: 'var(--gray)', whiteSpace: 'nowrap',
  },
  table: {
    background: 'var(--navy-mid)',
    borderRadius: 10,
    border: '1px solid var(--border)',
    overflow: 'hidden',
  },
  tableHeader: {
    display: 'grid',
    gridTemplateColumns: '50px 1fr 100px 100px 80px',
    padding: '10px 16px',
    background: 'var(--navy-lt)',
    fontSize: 10, fontWeight: 700,
    letterSpacing: '0.1em', textTransform: 'uppercase',
    color: 'var(--gray)', gap: 8,
  },
  tableRow: {
    display: 'grid',
    gridTemplateColumns: '50px 1fr 100px 100px 80px',
    padding: '9px 16px',
    fontSize: 13, gap: 8,
    borderBottom: '1px solid var(--border)',
    alignItems: 'center',
    transition: 'background 0.1s',
  },
  tableRowAlt: { background: 'rgba(255,255,255,0.02)' },
  tableRowPending: { opacity: 0.5 },
  sprintDot: { fontSize: 11 },
  totalsRow: {
    display: 'grid',
    gridTemplateColumns: '50px 1fr 100px 100px 80px',
    padding: '12px 16px',
    background: 'var(--navy-lt)',
    gap: 8, alignItems: 'center',
    borderTop: '2px solid var(--border)',
  },
}
