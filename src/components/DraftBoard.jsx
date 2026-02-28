import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'

export default function DraftBoard({ owners, drivers, races, selectedRace, onDraftSaved }) {
  const [picks, setPicks] = useState([])   // current draft picks for this race
  const [saving, setSaving] = useState(false)
  const [savedMsg, setSavedMsg] = useState('')

  useEffect(() => {
    if (selectedRace) loadPicks()
  }, [selectedRace])

  async function loadPicks() {
    const { data } = await supabase
      .from('draft_picks')
      .select('*, drivers(*), owners(*)')
      .eq('race_id', selectedRace.id)
      .order('pick_number')
    setPicks(data || [])
  }

  // Determine draft order: loser of previous race goes first
  // First race: owner 1 (Steve) goes first
  const [firstOwner, setFirstOwner] = useState(owners[0])
  const [secondOwner, setSecondOwner] = useState(owners[1])

  useEffect(() => {
    if (!selectedRace || !owners.length) return
    determineDraftOrder()
  }, [selectedRace, owners])

  async function determineDraftOrder() {
    if (selectedRace.round === 1) {
      setFirstOwner(owners[0])
      setSecondOwner(owners[1])
      return
    }
    // Find previous race
    const prevRace = races.find(r => r.round === selectedRace.round - 1)
    if (!prevRace) return

    const { data } = await supabase
      .from('owner_race_totals')
      .select('*')
      .eq('race_id', prevRace.id)

    if (!data || data.length < 2) {
      setFirstOwner(owners[0])
      setSecondOwner(owners[1])
      return
    }

    const o1 = data.find(d => d.owner_id === owners[0].id)
    const o2 = data.find(d => d.owner_id === owners[1].id)
    const o1pts = o1?.total_points || 0
    const o2pts = o2?.total_points || 0

    // Loser drafts first (lower score = first pick)
    if (o1pts <= o2pts) {
      setFirstOwner(owners[0])
      setSecondOwner(owners[1])
    } else {
      setFirstOwner(owners[1])
      setSecondOwner(owners[0])
    }
  }

  // Build 16-pick snake draft order
  // Rounds 1,3,5,7: first, second | Rounds 2,4,6,8: second, first
  const draftOrder = []
  for (let round = 1; round <= 8; round++) {
    if (round % 2 === 1) {
      draftOrder.push({ pick: draftOrder.length + 1, round, owner: firstOwner })
      draftOrder.push({ pick: draftOrder.length + 1, round, owner: secondOwner })
    } else {
      draftOrder.push({ pick: draftOrder.length + 1, round, owner: secondOwner })
      draftOrder.push({ pick: draftOrder.length + 1, round, owner: firstOwner })
    }
  }

  // Track which drivers have been selected so far
  const pickedDriverIds = picks
    .filter(p => p.driver_id)
    .map(p => p.driver_id)

  const [draftSelections, setDraftSelections] = useState({}) // pick_number → driver_id

  useEffect(() => {
    if (picks.length) {
      const sel = {}
      picks.forEach(p => { sel[p.pick_number] = p.driver_id })
      setDraftSelections(sel)
    }
  }, [picks])

  function getAvailableDrivers(pickNumber) {
    // Exclude drivers already selected in earlier picks
    const selectedSoFar = Object.entries(draftSelections)
      .filter(([pn]) => Number(pn) < pickNumber)
      .map(([, dId]) => dId)
    return drivers.filter(d => !selectedSoFar.includes(d.id))
  }

  function handleSelect(pickNumber, driverId) {
    setDraftSelections(prev => ({ ...prev, [pickNumber]: driverId ? Number(driverId) : null }))
  }

  async function saveDraft() {
    setSaving(true)
    setSavedMsg('')

    const toUpsert = draftOrder.map(({ pick, round, owner }) => ({
      race_id:     selectedRace.id,
      pick_number: pick,
      round_number: round,
      owner_id:    owner?.id,
      driver_id:   draftSelections[pick] || null,
    })).filter(p => p.driver_id)

    // Check for duplicates
    const driverIds = toUpsert.map(p => p.driver_id)
    const unique = new Set(driverIds)
    if (driverIds.length !== unique.size) {
      setSavedMsg('❌ Duplicate driver detected. Each driver can only be picked once.')
      setSaving(false)
      return
    }

    // Delete existing picks for this race, then re-insert
    await supabase.from('draft_picks').delete().eq('race_id', selectedRace.id)
    const { error } = await supabase.from('draft_picks').insert(toUpsert)

    if (error) {
      setSavedMsg(`❌ Error: ${error.message}`)
    } else {
      setSavedMsg('✅ Draft saved!')
      onDraftSaved()
      await loadPicks()
    }
    setSaving(false)
    setTimeout(() => setSavedMsg(''), 3000)
  }

  const allPicked = draftOrder.every(({ pick }) => draftSelections[pick])
  const raceHasResults = selectedRace?.results_ready

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Header */}
      <div className="animate-fade-up" style={styles.header}>
        <div>
          <div style={styles.title}>Weekly Draft — {selectedRace?.name}</div>
          <div style={styles.subtitle}>
            {selectedRace?.round === 1
              ? `${firstOwner?.name} drafts first (Round 1)`
              : `${firstOwner?.name} drafts first (lost previous race)`}
            {selectedRace?.has_sprint && <span style={styles.sprintTag}>⚡ Sprint Weekend</span>}
          </div>
        </div>
        {raceHasResults && (
          <div style={styles.lockedBadge}>🔒 Results Finalized</div>
        )}
      </div>

      {/* Draft grid */}
      <div className="animate-fade-up-2" style={styles.draftGrid}>
        {draftOrder.map(({ pick, round, owner }) => {
          const isSteve = owner?.id === owners[0]?.id
          const selectedDriverId = draftSelections[pick]
          const selectedDriver = drivers.find(d => d.id === selectedDriverId)
          const available = getAvailableDrivers(pick)

          return (
            <div
              key={pick}
              style={{
                ...styles.pickRow,
                ...(isSteve ? styles.pickRowSteve : styles.pickRowTrevor),
              }}
            >
              <div style={styles.pickMeta}>
                <span style={styles.pickNum}>#{pick}</span>
                <span style={styles.pickRound}>Rd {round}</span>
              </div>
              <div style={styles.pickOwner}>{owner?.name}</div>
              <div style={styles.pickDriver}>
                <select
                  value={selectedDriverId || ''}
                  onChange={e => handleSelect(pick, e.target.value)}
                  disabled={raceHasResults}
                  style={{
                    ...styles.driverSelect,
                    ...(selectedDriverId ? styles.driverSelectFilled : {}),
                  }}
                >
                  <option value="">— Select Driver —</option>
                  {available.map(d => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                  {/* Also show currently selected driver even if "already picked" in current state */}
                  {selectedDriverId && !available.find(d => d.id === selectedDriverId) && (
                    <option value={selectedDriverId}>
                      {drivers.find(d => d.id === selectedDriverId)?.name} (selected)
                    </option>
                  )}
                </select>
              </div>
              <div style={styles.pickConstructor}>
                {selectedDriver?.constructor || (
                  <span style={{ color: 'var(--gray)', fontSize: 12 }}>—</span>
                )}
              </div>
              {/* Constructor bonus indicator */}
              {selectedDriver && (
                <div style={styles.bonusFlag}>
                  {selectedDriver.constructor === owner?.constructor ? (
                    <span style={styles.bonusYes} title="+15% constructor bonus">★ +15%</span>
                  ) : (
                    <span style={styles.bonusNo}>—</span>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Save button */}
      {!raceHasResults && (
        <div className="animate-fade-up-3" style={styles.saveRow}>
          {savedMsg && (
            <div style={{
              ...styles.savedMsg,
              color: savedMsg.startsWith('✅') ? 'var(--green)' : '#ff6b6b'
            }}>
              {savedMsg}
            </div>
          )}
          <button
            onClick={saveDraft}
            disabled={saving}
            style={{ ...styles.saveBtn, ...(saving ? styles.saveBtnDisabled : {}) }}
          >
            {saving ? 'Saving...' : `Save Draft${allPicked ? ' ✓' : ` (${Object.values(draftSelections).filter(Boolean).length}/16)`}`}
          </button>
        </div>
      )}

      {/* Draft order legend */}
      <div style={styles.legend}>
        <div style={styles.legendItem}>
          <div style={{ ...styles.legendDot, background: 'var(--steve)' }} />
          <span>{firstOwner?.name} (drafts 1st)</span>
        </div>
        <div style={styles.legendItem}>
          <div style={{ ...styles.legendDot, background: 'var(--trevor)' }} />
          <span>{secondOwner?.name} (drafts 2nd)</span>
        </div>
        <div style={styles.legendItem}>
          <span style={{ color: 'var(--gold)' }}>★ +15%</span>
          <span>= driver matches owner's constructor</span>
        </div>
      </div>
    </div>
  )
}

const styles = {
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  title: {
    fontSize: 22,
    fontWeight: 900,
    letterSpacing: '0.03em',
  },
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
    fontSize: 11,
    fontWeight: 700,
    padding: '2px 8px',
    borderRadius: 4,
    border: '1px solid rgba(212,160,23,0.3)',
  },
  lockedBadge: {
    fontSize: 12,
    color: 'var(--gray)',
    border: '1px solid var(--border)',
    padding: '6px 12px',
    borderRadius: 6,
  },
  draftGrid: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    background: 'var(--navy-mid)',
    borderRadius: 10,
    border: '1px solid var(--border)',
    overflow: 'hidden',
  },
  pickRow: {
    display: 'grid',
    gridTemplateColumns: '60px 100px 1fr 160px 80px',
    alignItems: 'center',
    padding: '8px 16px',
    gap: 12,
    borderBottom: '1px solid var(--border)',
    transition: 'background 0.15s',
  },
  pickRowSteve: {
    background: 'rgba(26,111,191,0.06)',
    borderLeft: '3px solid var(--steve)',
  },
  pickRowTrevor: {
    background: 'rgba(184,92,0,0.06)',
    borderLeft: '3px solid var(--trevor)',
  },
  pickMeta: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  pickNum: {
    fontFamily: 'JetBrains Mono, monospace',
    fontWeight: 700,
    fontSize: 14,
    color: 'var(--white)',
  },
  pickRound: {
    fontSize: 10,
    color: 'var(--gray)',
    letterSpacing: '0.05em',
  },
  pickOwner: {
    fontWeight: 700,
    fontSize: 13,
    letterSpacing: '0.03em',
  },
  pickDriver: {
    flex: 1,
  },
  driverSelect: {
    width: '100%',
    background: 'var(--navy-lt)',
    color: 'var(--gray)',
    border: '1px solid var(--border)',
    borderRadius: 6,
    padding: '6px 10px',
    fontSize: 13,
    cursor: 'pointer',
  },
  driverSelectFilled: {
    color: 'var(--white)',
    borderColor: 'rgba(255,255,255,0.2)',
  },
  pickConstructor: {
    fontSize: 12,
    color: 'var(--gray-lt)',
    fontWeight: 600,
  },
  bonusFlag: {
    textAlign: 'right',
  },
  bonusYes: {
    color: 'var(--gold)',
    fontWeight: 700,
    fontSize: 12,
  },
  bonusNo: {
    color: 'var(--gray)',
    fontSize: 12,
  },
  saveRow: {
    display: 'flex',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 16,
  },
  savedMsg: {
    fontSize: 14,
    fontWeight: 600,
  },
  saveBtn: {
    background: 'var(--red)',
    color: 'var(--white)',
    fontWeight: 700,
    fontSize: 14,
    letterSpacing: '0.05em',
    padding: '12px 28px',
    borderRadius: 8,
    transition: 'all 0.15s',
    boxShadow: '0 4px 12px rgba(232,0,45,0.3)',
  },
  saveBtnDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed',
  },
  legend: {
    display: 'flex',
    gap: 24,
    fontSize: 12,
    color: 'var(--gray)',
    flexWrap: 'wrap',
  },
  legendItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: '50%',
  },
}
