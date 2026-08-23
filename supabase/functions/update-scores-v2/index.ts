// Supabase Edge Function: update-scores-v2
// Fetches latest F1 race results from OpenF1 API, upserts into DB,
// marks race as updated, then pings Slack.
//
// Auto-detects: finish positions, fastest lap, pole position,
//               most positions gained, sprint win, sprint pole
//
// Invoke manually:  POST /functions/v1/update-scores-v2  { "round": 3 }
// Invoke via cron:  see scheduled-update/index.ts
//
// The OpenF1 meeting_key for each race is stored on races.openf1_meeting_key
// (see migration add_openf1_meeting_key_to_races) rather than a hardcoded
// round-number map here — a hardcoded map previously went stale whenever a
// round was renumbered (e.g. the Bahrain relocation dropping the cancelled
// Saudi Arabia slot), silently pulling the wrong race's results.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL      = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY      = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SLACK_WEBHOOK_URL = Deno.env.get("SLACK_WEBHOOK_URL") ?? "";
const APP_URL           = "https://f1drafttracker.vercel.app";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── CORS headers ──────────────────────────────────────────────
const corsHeaders = {
  "Access-Control-Allow-Origin": "https://f1drafttracker.vercel.app",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const OPENF1 = "https://api.openf1.org/v1";

// ── OpenF1 API helpers ────────────────────────────────────────
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function getSessionKey(meetingKey: number, sessionName: string): Promise<number | null> {
  const url = `${OPENF1}/sessions?meeting_key=${meetingKey}&session_name=${encodeURIComponent(sessionName)}`;
  console.log(`Fetching session: ${url}`);
  const res = await fetch(url);
  const data = await res.json();
  console.log(`Session response for ${sessionName}:`, JSON.stringify(data));
  return data?.[0]?.session_key ?? null;
}

// Returns positions from session_result: { driver_number: position }
async function getFinalPositions(sessionKey: number, excludeDnf = false): Promise<Record<number, number>> {
  const url = `${OPENF1}/session_result?session_key=${sessionKey}`;
  console.log(`Fetching positions: ${url}`);
  const res = await fetch(url);
  console.log(`Position response status: ${res.status}`);
  const raw = await res.text();
  console.log(`Position raw response (first 200): ${raw.slice(0, 200)}`);
  let data: any[] = [];
  try { data = JSON.parse(raw); } catch(e) { console.error(`JSON parse error: ${e}`); }
  const entries: any[] = Array.isArray(data) ? data : [];
  console.log(`Entries count: ${entries.length}`);
  const result: Record<number, number> = {};
  for (const entry of entries) {
    if (entry.position == null) continue;
    if (excludeDnf && (entry.dnf || entry.dns || entry.dsq)) continue;
    result[entry.driver_number] = entry.position;
  }
  return result;
}

async function getFastestLapDriver(sessionKey: number): Promise<number | null> {
  const res = await fetch(`${OPENF1}/session_result?session_key=${sessionKey}`);
  const data = await res.json();
  const entries: any[] = Array.isArray(data) ? data : [];
  let best: number | null = null;
  let bestTime = Infinity;
  for (const entry of entries) {
    if (entry.duration && !entry.dnf && !entry.dns && entry.duration < bestTime) {
      bestTime = entry.duration;
      best = entry.driver_number;
    }
  }
  return best;
}

// ── Bonus detection helpers ───────────────────────────────────

function findMostPositionsGained(
  qualiPositions: Record<number, number>,
  racePositions: Record<number, number>
): number | null {
  let maxGain = 0;
  let bestDriver: number | null = null;
  for (const [driverNumStr, racePos] of Object.entries(racePositions)) {
    const driverNum = Number(driverNumStr);
    const startPos = qualiPositions[driverNum];
    if (!startPos) continue;
    const gain = startPos - racePos;
    if (gain > maxGain) {
      maxGain = gain;
      bestDriver = driverNum;
    }
  }
  return bestDriver;
}

// ── Main handler ─────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({ round: null }));
    const round = body.round ? Number(body.round) : null;

    // Find the most recent pending race if no round specified.
    // Uses a 2-day window to handle timezone differences between
    // the edge function (UTC) and race locations.
    let targetRound = round;
    if (!targetRound) {
      const twoDaysFromNow = new Date();
      twoDaysFromNow.setDate(twoDaysFromNow.getDate() + 2);

      const { data: races } = await supabase
        .from("races")
        .select("round, race_date")
        .lte("race_date", twoDaysFromNow.toISOString().split("T")[0])
        .eq("results_updated", false)
        .order("round", { ascending: true })
        .limit(1);

      if (!races?.length) {
        return new Response(
          JSON.stringify({ message: "No pending races to update. Either all races are done, or the race date is more than 2 days away." }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      targetRound = races[0].round;
      console.log(`Auto-detected round: ${targetRound} (race_date: ${races[0].race_date})`);
    } else {
      console.log(`Explicit round provided: ${targetRound}`);
    }

    // Get race from DB
    const { data: race, error: raceErr } = await supabase
      .from("races")
      .select("*")
      .eq("round", targetRound)
      .single();

    if (raceErr || !race) {
      return new Response(
        JSON.stringify({
          error: "Race not found in DB",
          debug: { targetRound, raceErr: raceErr?.message ?? null },
        }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const meetingKey: number | null = race.openf1_meeting_key ?? null;
    if (!meetingKey) {
      return new Response(
        JSON.stringify({
          error: `No OpenF1 meeting_key set for round ${targetRound} (${race.name})`,
          hint: "Set races.openf1_meeting_key for this race once OpenF1 has published its session data (e.g. a postponed/relocated race whose new date wasn't known yet).",
        }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Fetch session keys sequentially to avoid rate limiting ──
    const raceSessionKey = await getSessionKey(meetingKey, "Race");
    await sleep(400);
    const qualiSessionKey = await getSessionKey(meetingKey, "Qualifying");
    await sleep(400);
    const sprintSessionKey = race.has_sprint ? await getSessionKey(meetingKey, "Sprint") : null;
    if (race.has_sprint) await sleep(400);
    const sprintQualiSessionKey = race.has_sprint ? await getSessionKey(meetingKey, "Sprint Qualifying") : null;

    if (!raceSessionKey) {
      return new Response(
        JSON.stringify({
          error: `No OpenF1 race session found for round ${targetRound}`,
          meeting_key_used: meetingKey,
          hint: "Race may not have started yet, or OpenF1 hasn't published results. Try again after the race finishes.",
        }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Race session key: ${raceSessionKey}, Quali session key: ${qualiSessionKey}`);

    // ── Fetch session data sequentially ─────────────────────────
    const racePositions = await getFinalPositions(raceSessionKey, true);
    await sleep(400);
    const qualiPositions = qualiSessionKey ? await getFinalPositions(qualiSessionKey) : {};
    await sleep(400);
    const sprintPositions = sprintSessionKey ? await getFinalPositions(sprintSessionKey) : {};
    if (sprintSessionKey) await sleep(400);
    const sprintQualiPositions = sprintQualiSessionKey ? await getFinalPositions(sprintQualiSessionKey) : {};
    if (sprintQualiSessionKey) await sleep(400);

    // ── Build driver number → DB ID mapping ──────────────────
    const { data: dbDrivers } = await supabase.from("drivers").select("id, name");
    const driverNameToId: Record<string, string> = {};
    for (const d of dbDrivers ?? []) {
      driverNameToId[d.name.toLowerCase()] = d.id;
    }

    // Hardcoded driver number → DB name map (matches names exactly as stored in DB)
    const numToName: Record<number, string> = {
      1:  "Lando Norris",
      3:  "Max Verstappen",
      5:  "Gabriel Bortoleto",
      6:  "Isack Hadjar",
      10: "Pierre Gasly",
      11: "Sergio Perez",
      12: "Andrea Kimi Antonelli",
      14: "Fernando Alonso",
      16: "Charles Leclerc",
      18: "Lance Stroll",
      22: "Yuki Tsunoda",
      23: "Alex Albon",
      27: "Nico Hulkenberg",
      30: "Liam Lawson",
      31: "Esteban Ocon",
      41: "Arvid Lindblad",
      43: "Franco Colapinto",
      44: "Lewis Hamilton",
      55: "Carlos Sainz",
      63: "George Russell",
      77: "Valtteri Bottas",
      81: "Oscar Piastri",
      87: "Oliver Bearman",
    };

    // ── Detect bonuses ────────────────────────────────────────

    // Pole = P1 in qualifying
    const poleEntry = Object.entries(qualiPositions).find(([, pos]) => pos === 1);
    const poleDriverNum = poleEntry ? Number(poleEntry[0]) : null;

    // Fastest lap (from session_result duration field)
    const fastestLapNum = await getFastestLapDriver(raceSessionKey);

    // Most positions gained = biggest quali → race improvement
    const mostGainedNum = Object.keys(qualiPositions).length > 0
      ? findMostPositionsGained(qualiPositions, racePositions)
      : null;

    // Sprint win = P1 in sprint race
    const sprintWinEntry = Object.entries(sprintPositions).find(([, pos]) => pos === 1);
    const sprintWinNum = sprintWinEntry ? Number(sprintWinEntry[0]) : null;

    // Sprint pole = P1 in sprint qualifying
    const sprintPoleEntry = Object.entries(sprintQualiPositions).find(([, pos]) => pos === 1);
    const sprintPoleNum = sprintPoleEntry ? Number(sprintPoleEntry[0]) : null;

    // ── Build upsert payload ──────────────────────────────────
    const resultRows: any[] = [];
    for (const [driverNumStr, racePos] of Object.entries(racePositions)) {
      const driverNum = Number(driverNumStr);
      const fullName = numToName[driverNum];
      if (!fullName) continue;
      const driverId = driverNameToId[fullName.toLowerCase()];
      if (!driverId) continue;

      resultRows.push({
        race_id:         race.id,
        driver_id:       driverId,
        finish_position: racePos,
        pole_position:   driverNum === poleDriverNum,
        fastest_lap:     driverNum === fastestLapNum,
        most_pos_gained: driverNum === mostGainedNum,
        sprint_win:      driverNum === sprintWinNum,
        sprint_pole:     driverNum === sprintPoleNum,
      });
    }

    if (resultRows.length === 0) {
      return new Response(
        JSON.stringify({
          error: "No results parsed — race may not be finished yet, or OpenF1 data is still publishing",
          openf1_positions_found: Object.keys(racePositions).length,
          db_drivers_found: dbDrivers?.length ?? 0,
          hint: "Wait a few minutes after the race ends and try again",
        }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Upsert results ────────────────────────────────────────
    const { error: upsertErr } = await supabase
      .from("race_results")
      .upsert(resultRows, { onConflict: "race_id,driver_id" });

    if (upsertErr) throw upsertErr;

    // ── Insert DNF rows for drivers with no position data ────
    const driverIdsWithResults = new Set(resultRows.map(r => r.driver_id));
    const dnfRows = (dbDrivers ?? [])
      .filter(d => !driverIdsWithResults.has(d.id))
      .map(d => ({
        race_id:         race.id,
        driver_id:       d.id,
        finish_position: null,
        pole_position:   false,
        fastest_lap:     false,
        most_pos_gained: false,
        sprint_win:      false,
        sprint_pole:     false,
      }));

    if (dnfRows.length > 0) {
      await supabase
        .from("race_results")
        .upsert(dnfRows, { onConflict: "race_id,driver_id" });
    }

    await supabase
      .from("races")
      .update({ results_updated: true, updated_at: new Date().toISOString() })
      .eq("id", race.id);

    // ── Slack notification ────────────────────────────────────
    if (SLACK_WEBHOOK_URL) {
      await fetch(SLACK_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "Scores have been retrieved." }),
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        race: race.name,
        round: race.round,
        results_upserted: resultRows.length,
        dnfs_detected: dnfRows.length,
        bonuses_detected: {
          pole:                 poleDriverNum    ? numToName[poleDriverNum]    : null,
          fastest_lap:          fastestLapNum    ? numToName[fastestLapNum]    : null,
          most_positions_gained: mostGainedNum   ? numToName[mostGainedNum]    : null,
          sprint_win:           sprintWinNum     ? numToName[sprintWinNum]     : null,
          sprint_pole:          sprintPoleNum    ? numToName[sprintPoleNum]    : null,
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error(err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
