// Supabase Edge Function: update-scores
// Fetches latest F1 race results from OpenF1 API, upserts into DB,
// marks race as updated, then pings Slack.
//
// Invoke manually:  POST /functions/v1/update-scores  { "round": 1 }
// Invoke via cron:  see scheduled-update/index.ts

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL      = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY      = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SLACK_WEBHOOK_URL = Deno.env.get("SLACK_WEBHOOK_URL")!;
const APP_URL           = Deno.env.get("APP_URL") ?? "https://your-app.vercel.app";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── OpenF1 API helpers ────────────────────────────────────────
// OpenF1 is free, no key needed. Docs: https://openf1.org
const OPENF1 = "https://api.openf1.org/v1";

async function getSessionKey(year: number, round: number): Promise<number | null> {
  const res = await fetch(
    `${OPENF1}/sessions?year=${year}&session_name=Race&meeting_key=${round}`
  );
  const data = await res.json();
  return data?.[0]?.session_key ?? null;
}

async function getRacePositions(sessionKey: number) {
  const res = await fetch(`${OPENF1}/position?session_key=${sessionKey}`);
  const data: any[] = await res.json();
  // Final positions: last entry per driver
  const byDriver: Record<number, any> = {};
  for (const entry of data) {
    byDriver[entry.driver_number] = entry;
  }
  return Object.values(byDriver);
}

async function getDriverInfo(sessionKey: number) {
  const res = await fetch(`${OPENF1}/drivers?session_key=${sessionKey}`);
  return (await res.json()) as any[];
}

async function getLapData(sessionKey: number) {
  const res = await fetch(
    `${OPENF1}/laps?session_key=${sessionKey}&is_pit_out_lap=false`
  );
  return (await res.json()) as any[];
}

// ── Bonus detection helpers ───────────────────────────────────
function findFastestLapDriver(laps: any[]): number | null {
  let best: number | null = null;
  let bestTime = Infinity;
  for (const lap of laps) {
    if (lap.lap_duration && lap.lap_duration < bestTime) {
      bestTime = lap.lap_duration;
      best = lap.driver_number;
    }
  }
  return best;
}

function findMostPositionsGained(
  qualifyingPositions: Record<number, number>,
  racePositions: any[]
): number | null {
  let maxGain = 0;
  let bestDriver: number | null = null;
  for (const entry of racePositions) {
    const startPos = qualifyingPositions[entry.driver_number] ?? entry.position;
    const gain = startPos - entry.position;
    if (gain > maxGain) {
      maxGain = gain;
      bestDriver = entry.driver_number;
    }
  }
  return bestDriver;
}

// ── Main handler ─────────────────────────────────────────────
Deno.serve(async (req) => {
  try {
    const { round } = await req.json().catch(() => ({ round: null }));

    // If no round specified, find the most recent completed race
    let targetRound = round;
    if (!targetRound) {
      const { data: races } = await supabase
        .from("races")
        .select("round, race_date")
        .lte("race_date", new Date().toISOString().split("T")[0])
        .eq("results_updated", false)
        .order("round", { ascending: true })
        .limit(1);
      if (!races?.length) {
        return new Response(
          JSON.stringify({ message: "No pending races to update" }),
          { status: 200 }
        );
      }
      targetRound = races[0].round;
    }

    // Get race from DB
    const { data: race, error: raceErr } = await supabase
      .from("races")
      .select("*")
      .eq("round", targetRound)
      .single();

    if (raceErr || !race) {
      return new Response(JSON.stringify({ error: "Race not found" }), { status: 404 });
    }

    // Fetch OpenF1 session
    const sessionKey = await getSessionKey(2026, targetRound);
    if (!sessionKey) {
      return new Response(
        JSON.stringify({ error: `No OpenF1 session found for round ${targetRound}` }),
        { status: 404 }
      );
    }

    const [positions, driverInfo, laps] = await Promise.all([
      getRacePositions(sessionKey),
      getDriverInfo(sessionKey),
      getLapData(sessionKey),
    ]);

    // Build driver number → DB driver mapping
    const { data: dbDrivers } = await supabase.from("drivers").select("id, name");
    const driverNameToId: Record<string, string> = {};
    for (const d of dbDrivers ?? []) {
      driverNameToId[d.name.toLowerCase()] = d.id;
    }

    // Map OpenF1 driver_number → full name
    const numToName: Record<number, string> = {};
    for (const d of driverInfo) {
      numToName[d.driver_number] = `${d.first_name} ${d.last_name}`;
    }

    // Fastest lap
    const fastestLapNum = findFastestLapDriver(laps);

    // Pole position = P1 in qualifying session
    // (In a full impl you'd fetch the quali session too; here we mark it as unknown
    //  and let the commissioner set it manually if needed)
    const poleDriverNum: number | null = null; // set manually in app

    // Most positions gained (approximate — needs quali data)
    const mostGainedNum: number | null = null;

    // Build upsert payload
    const resultRows: any[] = [];
    for (const pos of positions) {
      const fullName = numToName[pos.driver_number];
      if (!fullName) continue;
      const driverId = driverNameToId[fullName.toLowerCase()];
      if (!driverId) continue;

      resultRows.push({
        race_id:         race.id,
        driver_id:       driverId,
        finish_position: pos.position,
        pole_position:   pos.driver_number === poleDriverNum,
        fastest_lap:     pos.driver_number === fastestLapNum,
        most_pos_gained: pos.driver_number === mostGainedNum,
        sprint_win:      false,
        sprint_pole:     false,
      });
    }

    if (resultRows.length === 0) {
      return new Response(
        JSON.stringify({ error: "No results parsed — race may not be finished yet" }),
        { status: 422 }
      );
    }

    // Upsert results
    const { error: upsertErr } = await supabase
      .from("race_results")
      .upsert(resultRows, { onConflict: "race_id,driver_id" });

    if (upsertErr) throw upsertErr;

    // Mark race as updated
    await supabase
      .from("races")
      .update({ results_updated: true, updated_at: new Date().toISOString() })
      .eq("id", race.id);

    // Send Slack notification
    await fetch(SLACK_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: [
          `🏁 *F1 Fantasy — Round ${race.round}: ${race.name} results are in!*`,
          `Check the latest scores and standings at ${APP_URL}`,
        ].join("\n"),
      }),
    });

    return new Response(
      JSON.stringify({
        success: true,
        race: race.name,
        round: race.round,
        results_upserted: resultRows.length,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
