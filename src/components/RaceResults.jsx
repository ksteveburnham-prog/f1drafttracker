import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'

export default function RaceResults({ owners, drivers, races, selectedRace, onResultsSaved }) {
  const [draftedDrivers, setDraftedDrivers] = useState([]) // drivers drafted this race
  const [results, setResults] = useState({})               // driver_id → result fields
  const [saving, setSaving] = useState(false)
  const [savedMsg, setSavedMsg] = useState('')
  const [triggering, setTriggering] = useState(false)

  useEffect(() => {
    if (selectedRace) {
      loadDraftedDrivers()
      loadExistingResults()
    }
  }, [selectedRace])

  async function loadDraftedDrivers() {
    const { data } = await supabase
      .from('draft_picks')
      .select('*, drivers(*), owners(*)')
      .eq('race_id', selectedRace.id)
      .order('pick_number')
    setDraftedDrivers(data || [])
  }

  async function loadExistingResults() {
    const { data } = await supabase
      .from('race_results')
      .select('*')
      .eq('race_id', selectedRace.id)

    if (data) {
      const map = {}
      data.forEach(r => {
        map[r.driver_id] = {
          finish_position:        r.finish_position || '',
          pole_position:          r.pole_position || false,
          fastest_lap:            r.fastest_lap || false,
          most_positions_gained:  r.most_positions_gained || false,
          sprint_win:             r.sprint_win || false,
          sprint_pole:            r.sprint_pole || false,
        }
      })
      setResults(map)
    }
  }

  function setField(driverId, field, value) {
    setResults(prev => ({
      ...prev,
      [driverId]: { ...(prev[driverId] || {}), [field]: value }
    }))
  }

  // Enforce single-owner constraints for bonuses
  function handleBoolField(driverId, field, value, exclusive = false) {
    if (exclusive && value) {
      // Clear this field for all other drivers first
      setResults(prev => {
        const next = { ...prev }
        Object.keys(next).forEach(id => {
          if (Number(id) !== driverId) {
            next[id] = { ...next[id], [field]: false }
          }
        })
        next[driverId] = { ...(next[driverId] || {}), [field]: true }
        return next
      })
    } else {
      setField(driverId, field, value)
    }
  }

  async function saveResults() {
    setSaving(true)
    setSavedMsg('')

    const toUpsert = draftedDrivers
      .filter(pick => pick.driver_id)
      .map(pick => {
        const r = results[pick.driver_id] || {}
        return {
          race_id:               selectedRace.id,
          driver_id:             pick.driver_id,
          finish_position:       r.finish_position ? Number(r.finish_position) : null,
          pole_position:         r.pole_position || false,
          fastest_lap:           r.fastest_lap || false,
          most_positions_gained: r.most_positions_gained || false,
          sprint_win:            r.sprint_win || false,
          sprint_pole:           r.sprint_pole || false,
        }
      })

    // Delete existing, re-insert
    await supabase.from('race_results').delete().eq('race_id', selectedRace.id)
    const { error } = await supabase.from('race_results').insert(toUpsert)

    if (error) {
      setSavedMsg(`❌ ${error.message}`)
    } else {
      // Mark race as results_ready
      await supabase.from('races').update({ results_ready: true }).eq('id', selectedRace.id)
      setSavedMsg('✅ Results saved!')
      onResultsSaved()
    }
    setSaving(false)
    setTimeout(() => setSavedMsg(''), 3000)
  }

  async function manualTrigger() {
    setTriggering(true)
    try {
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/update-scores`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          },
          body: JSON.stringify({ race_id: selectedRace.id }),
        }
      )
      const data = await res.json()
      if (data.success) {
        setSavedMsg(`✅ Auto-fetch complete: ${data.results} driver results imported`)
        onResultsSaved()
        await loadExistingResults()
      } else {
        setSavedMsg(`❌ Auto-fetch failed: ${data.error}`)
      }
    } catch (e) {
      setSavedMsg(`❌ ${e.message}`)
    }
    setTriggering(false)
    setTimeout(() => setSavedMsg(''), 5000)
  }

  // Group by owner
  const byOwner = owners.map(owner => ({
    owner,
    picks: draftedDrivers.filter(p => p.owner_id === owner.id),
  }))

  const hasSprint = selectedRace?.has_sprint

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Header */}
      <div className="animate-fade-up" style={styles.header}>
        <div>
          <div style={styles.title}>Race Results — {selectedRace?.name}</div>
          <div style={styles.subtitle}>
            Enter finish positions and bonus flags for all drafted drivers
            {hasSprint && <span style={styles.sprintTag}>⚡ Sprint Weekend</span>}
          </div>
        </div>
        <button
          onClick={manualTrigger}
          disabled={triggering}
          style={styles.autoBtn}
        >
          {triggering ? '⏳ Fetching...' : '🔄 Auto-Fetch from F1 API'}
        </button>
      </div>

      {/* Column headers */}
      <div className="animate-fade-up-2" style={styles.colHeaders}>
        <span style={{ gridColumn: '1 / 3' }}>Driver</span>
        <span style={{ textAlign: 'center' }}>Pos</span>
        <span style={{ textAlign: 'center' }}>Pole</span>
        <span style={{ textAlign: 'center' }}>Fast Lap</span>
        <span style={{ textAlign: 'center' }}>Pos Gained</span>
        {hasSprint && <span style={{ textAlign: 'center' }}>Sprint Win</span>}
        {hasSprint && <span style={{ textAlign: 'center' }}>Sprint Pole</span>}
        <span style={{ textAlign: 'center' }}>Pts</span>
      </div>

      {/* Results by owner */}
      {byOwner.map(({ owner, picks }, oi) => (
        <div key={owner.id} className="animate-fade-up-3" style={styles.ownerBlock}>
          <div style={{ ...styles.ownerHeader, background: oi === 0 ? 'rgba(26,111,191,0.2)' : 'rgba(184,92,0,0.2)' }}>
            <span>{owner.name}</span>
            <span style={{ fontSize: 12, color: 'var(--gray)' }}>{owner.constructor}</span>
          </div>

          {picks.length === 0 ? (
            <div style={styles.empty}>No draft picks found — save the draft first</div>
          ) : (
            picks.map(pick => {
              const driver = pick.drivers
              if (!driver) return null
              const r = results[driver.id] || {}
              const bp = basePoints(r.finish_position)
              const hasBonus = driver.constructor === owner.constructor
              const bonusBase = hasBonus ? bp * 0.15 : 0
              const bonusPts = (r.pole_position ? 5 : 0) + (r.fastest_lap ? 3 : 0) +
                (r.most_positions_gained ? 2 : 0) + (r.sprint_win ? 5 : 0) + (r.sprint_pole ? 3 : 0)
              const total = bp + bonusBase + bonusPts

              return (
                <div key={driver.id} style={styles.resultRow}>
                  <div style={styles.driverInfo}>
                    <div style={styles.driverName}>
                      {driver.name}
                      {hasBonus && <span style={styles.constructorStar} title="+15% constructor bonus">★</span>}
                    </div>
                    <div style={styles.driverTeam}>{driver.constructor}</div>
                  </div>

                  {/* Finish position */}
                  <input
                    type="number"
                    min="1" max="20"
                    value={r.finish_position || ''}
                    onChange={e => setField(driver.id, 'finish_position', e.target.value)}
                    placeholder="—"
                    style={styles.posInput}
                  />

                  {/* Boolean bonus flags */}
                  <BoolToggle
                    value={r.pole_position}
                    onChange={v => handleBoolField(driver.id, 'pole_position', v, true)}
                    color="#9b59b6"
                  />
                  <BoolToggle
                    value={r.fastest_lap}
                    onChange={v => handleBoolField(driver.id, 'fastest_lap', v, true)}
                    color="#e74c3c"
                  />
                  <BoolToggle
                    value={r.most_positions_gained}
                    onChange={v => handleBoolField(driver.id, 'most_positions_gained', v, true)}
                    color="#2980b9"
                  />
                  {hasSprint && (
                    <BoolToggle
                      value={r.sprint_win}
                      onChange={v => handleBoolField(driver.id, 'sprint_win', v, true)}
                      color="#e67e22"
                    />
                  )}
                  {hasSprint && (
                    <BoolToggle
                      value={r.sprint_pole}
                      onChange={v => handleBoolField(driver.id, 'sprint_pole', v, true)}
                      color="#d35400"
                    />
                  )}

                  {/* Total points */}
                  <div style={{ textAlign: 'center' }}>
                    <span style={{
                      ...styles.totalPts,
                      ...(total > 0 ? styles.totalPtsActive : {})
                    }}>
                      {total > 0 ? total.toFixed(1) : '—'}
                    </span>
                  </div>
                </div>
              )
            })
          )}
        </div>
      ))}

      {/* Save row */}
      <div className="animate-fade-up-4" style={styles.saveRow}>
        {savedMsg && (
          <div style={{ color: savedMsg.startsWith('✅') ? 'var(--green)' : '#ff6b6b', fontSize: 14, fontWeight: 600 }}>
            {savedMsg}
          </div>
        )}
        <button
          onClick={saveResults}
          disabled={saving}
          style={{ ...styles.saveBtn, ...(saving ? styles.saveBtnDisabled : {}) }}
        >
          {saving ? 'Saving...' : '💾 Save Results & Notify'}
        </button>
      </div>

      {/* Points legend */}
      <div style={styles.legend}>
        <div style={styles.legendGrid}>
          {[['1st', 30], ['2nd–3rd', 24], ['4th–6th', 18], ['7th–10th', 12], ['11th–15th', 6], ['16th–20th', 2]].map(([label, pts]) => (
            <div key={label} style={styles.legendItem}>
              <span style={styles.legendPos}>{label}</span>
              <span style={styles.legendPts}>{pts} pts</span>
            </div>
          ))}
        </div>
        <div style={styles.legendBonuses}>
          <span>Pole +5</span>
          <span>Fastest Lap +3</span>
          <span>Positions Gained +2</span>
          {hasSprint && <span>Sprint Win +5</span>}
          {hasSprint && <span>Sprint Pole +3</span>}
          <span style={{ color: 'var(--gold)' }}>★ Constructor match +15%</span>
        </div>
      </div>
    </div>
  )
}

function BoolToggle({ value, onChange, color }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <button
        onClick={() => onChange(!value)}
        style={{
          ...styles.toggle,
          background: value ? color : 'transparent',
          borderColor: value ? color : 'var(--border)',
          color: value ? 'white' : 'var(--gray)',
        }}
      >
        {value ? '✓' : '—'}
      </button>
    </div>
  )
}

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

const COL_TEMPLATE = '1fr 60px 40px 40px 40px 40px 70px'
const COL_TEMPLATE_SPRINT = '1fr 60px 40px 40px 40px 40px 40px 40px 70px'

const styles = {
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    flexWrap: 'wrap',
    gap: 12,
  },
  title: { fontSize: 22, fontWeight: 900, letterSpacing: '0.03em' },
  subtitle: {
    fontSize: 13,
    color: 'var(--gray)',
    marginTop: 4,
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  sprintTag: {
    background: 'rgba(212,160,23,0.15)',
    color: 'var(--gold)',
    fontSize: 11, fontWeight: 700,
    padding: '2px 8px', borderRadius: 4,
    border: '1px solid rgba(212,160,23,0.3)',
  },
  autoBtn: {
    background: 'var(--navy-lt)',
    color: 'var(--gray-lt)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: '10px 18px',
    fontSize: 13, fontWeight: 600,
    cursor: 'pointer',
  },
  colHeaders: {
    display: 'grid',
    gridTemplateColumns: COL_TEMPLATE,
    padding: '8px 16px',
    background: 'var(--navy-lt)',
    borderRadius: '8px 8px 0 0',
    border: '1px solid var(--border)',
    fontSize: 10, fontWeight: 700,
    letterSpacing: '0.1em', textTransform: 'uppercase',
    color: 'var(--gray)',
    gap: 8,
  },
  ownerBlock: {
    background: 'var(--navy-mid)',
    borderRadius: 10,
    border: '1px solid var(--border)',
    overflow: 'hidden',
  },
  ownerHeader: {
    padding: '10px 16px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontWeight: 700, fontSize: 14,
  },
  empty: {
    padding: 20,
    color: 'var(--gray)',
    fontSize: 13,
    textAlign: 'center',
  },
  resultRow: {
    display: 'grid',
    gridTemplateColumns: COL_TEMPLATE,
    padding: '10px 16px',
    gap: 8,
    alignItems: 'center',
    borderBottom: '1px solid var(--border)',
  },
  driverInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  driverName: {
    fontWeight: 600, fontSize: 13,
    display: 'flex', alignItems: 'center', gap: 6,
  },
  constructorStar: {
    color: 'var(--gold)',
    fontSize: 12,
  },
  driverTeam: {
    fontSize: 11, color: 'var(--gray)',
  },
  posInput: {
    width: '100%',
    background: 'var(--navy-lt)',
    color: 'var(--white)',
    border: '1px solid var(--border)',
    borderRadius: 6,
    padding: '6px 8px',
    fontSize: 14, fontWeight: 700,
    textAlign: 'center',
    fontFamily: 'JetBrains Mono, monospace',
  },
  toggle: {
    width: 32, height: 28,
    borderRadius: 4,
    border: '1px solid',
    fontSize: 13, fontWeight: 700,
    cursor: 'pointer',
    transition: 'all 0.15s',
  },
  totalPts: {
    fontFamily: 'JetBrains Mono, monospace',
    fontWeight: 700, fontSize: 14,
    color: 'var(--gray)',
  },
  totalPtsActive: {
    color: 'var(--gold-lt)',
  },
  saveRow: {
    display: 'flex',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 16,
  },
  saveBtn: {
    background: 'var(--red)',
    color: 'var(--white)',
    fontWeight: 700, fontSize: 14,
    letterSpacing: '0.05em',
    padding: '12px 28px', borderRadius: 8,
    boxShadow: '0 4px 12px rgba(232,0,45,0.3)',
    transition: 'all 0.15s',
  },
  saveBtnDisabled: { opacity: 0.5, cursor: 'not-allowed' },
  legend: {
    background: 'var(--navy-mid)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    padding: '16px 20px',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  legendGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
    gap: 8,
  },
  legendItem: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: 12,
    padding: '4px 8px',
    background: 'var(--navy-lt)',
    borderRadius: 4,
  },
  legendPos: { color: 'var(--gray)' },
  legendPts: { fontWeight: 700, fontFamily: 'JetBrains Mono, monospace' },
  legendBonuses: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 16,
    fontSize: 12,
    color: 'var(--gray-lt)',
  },
}
