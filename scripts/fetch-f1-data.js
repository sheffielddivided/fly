#!/usr/bin/env node
// Henter F1 2026-data fra OpenF1 og skriver den til data/f1-2026.json.
// Kjøres ukentlig av .github/workflows/update-f1-data.yml (søndag kveld),
// altså når ingen live-økt pågår og OpenF1 tillater anonym tilgang.
//
// Krever Node 18+ (global fetch). Ingen npm-avhengigheter.

const fs = require('fs');
const path = require('path');

const YEAR = 2026;
const BASE = 'https://api.openf1.org/v1';
const OUT = path.join('data', `f1-${YEAR}.json`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(pathAndQuery, attempt = 0) {
  const res = await fetch(`${BASE}${pathAndQuery}`, {
    headers: { 'User-Agent': 'F1-App-Cron/1.0' },
  });
  // 404 = ingen ressurs (f.eks. avlyst løp) → tom liste.
  if (res.status === 404) return [];
  // 429/401/5xx = midlertidig → vent og prøv igjen (romslig, jobben har god tid).
  if ((res.status === 429 || res.status === 401 || res.status >= 500) && attempt < 5) {
    const wait = (attempt + 1) * 3000;
    console.warn(`  ${pathAndQuery} → HTTP ${res.status}, prøver igjen om ${wait}ms`);
    await sleep(wait);
    return api(pathAndQuery, attempt + 1);
  }
  if (!res.ok) throw new Error(`${pathAndQuery} → HTTP ${res.status}`);
  return res.json();
}

// Behold bare feltene appen faktisk bruker, så filen holdes liten.
const pickDriver = (d) => ({
  driver_number: d.driver_number,
  full_name: d.full_name,
  name_acronym: d.name_acronym,
  team_name: d.team_name,
  team_colour: d.team_colour,
  country_code: d.country_code,
  headshot_url: d.headshot_url,
});

const pickMeeting = (m) => ({
  meeting_key: m.meeting_key,
  meeting_name: m.meeting_name,
  circuit_short_name: m.circuit_short_name,
  country_code: m.country_code,
});

const pickSession = (s) => ({
  session_key: s.session_key,
  meeting_key: s.meeting_key,
  date_start: s.date_start,
  date_end: s.date_end,
});

const pickResult = (r) => ({
  position: r.position,
  driver_number: r.driver_number,
  dnf: r.dnf,
  dns: r.dns,
  dsq: r.dsq,
  gap_to_leader: r.gap_to_leader,
  duration: r.duration,
  number_of_laps: r.number_of_laps,
});

async function main() {
  console.log(`Henter F1 ${YEAR}-data …`);

  const meetings = await api(`/meetings?year=${YEAR}`);
  await sleep(600);
  const sessions = await api(`/sessions?year=${YEAR}&session_type=Race`);
  await sleep(600);
  const drivers = await api(`/drivers?session_key=latest`);
  await sleep(600);

  const byMeeting = {};
  sessions.forEach((s) => { byMeeting[s.meeting_key] = s; });

  const races = meetings
    .filter((m) => byMeeting[m.meeting_key])
    .map((m) => ({ meeting: m, session: byMeeting[m.meeting_key] }))
    .sort((a, b) => new Date(a.session.date_start) - new Date(b.session.date_start));

  const now = Date.now();

  // Førere fra "latest"-økten først (gir gjeldende lag/farge for aktive
  // førere). Erstattere/engangskjørere som ikke er i den lista fylles inn
  // per løp under, så alle som har kjørt får navnet sitt.
  const driverMap = {};
  drivers.forEach((d) => { driverMap[d.driver_number] = pickDriver(d); });

  const out = { updated: new Date().toISOString(), drivers: [], races: [] };

  for (const r of races) {
    const started = new Date(r.session.date_start).getTime() < now;
    let results = [];
    if (started) {
      const raw = await api(`/session_result?session_key=${r.session.session_key}`);
      results = (Array.isArray(raw) ? raw : []).map(pickResult);
      await sleep(800); // vær snill mot OpenF1 mellom kall

      // Fyll inn førere som kjørte dette løpet, men mangler i "latest"-lista.
      const missing = results.some((x) => x.driver_number != null && !driverMap[x.driver_number]);
      if (missing) {
        const sd = await api(`/drivers?session_key=${r.session.session_key}`);
        (Array.isArray(sd) ? sd : []).forEach((d) => {
          if (!driverMap[d.driver_number]) driverMap[d.driver_number] = pickDriver(d);
        });
        await sleep(800);
      }
      console.log(`  ${r.meeting.meeting_name}: ${results.length} resultater`);
    } else {
      console.log(`  ${r.meeting.meeting_name}: ikke kjørt ennå`);
    }
    out.races.push({
      meeting: pickMeeting(r.meeting),
      session: pickSession(r.session),
      results,
    });
  }

  out.drivers = Object.values(driverMap).sort((a, b) => a.driver_number - b.driver_number);

  fs.mkdirSync('data', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out) + '\n');
  console.log(`Skrev ${OUT} (${out.races.length} løp, ${out.drivers.length} førere).`);
}

main().catch((err) => {
  console.error('Feilet:', err);
  process.exit(1);
});
