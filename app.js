'use strict';

/* =====================================================================
   KICKOFF – Turnierplaner für Konsolen-Fußballturniere
   Alles läuft im Browser, gespeichert wird im localStorage des Geräts.
   ===================================================================== */

const STORE_KEY = 'kickoff.v1';
const MAX_PLAYERS = 24;
const GROUP_NAMES = 'ABCDEFGH';
const COLORS = ['#22d3ee', '#c6ff3d', '#f472b6', '#facc15', '#a78bfa', '#fb923c', '#34d399', '#f87171',
  '#60a5fa', '#e879f9', '#2dd4bf', '#fbbf24', '#818cf8', '#a3e635', '#fda4af', '#38bdf8'];
// Setzliste -> Paarungen der ersten K.-o.-Runde (Index in der Setzliste)
const KO_PAIRS = { 2: [[0, 1]], 4: [[0, 3], [1, 2]], 8: [[0, 7], [3, 4], [1, 6], [2, 5]] };

/* ---------------------------------------------------------------------
   Speicher
   --------------------------------------------------------------------- */
function load() {
  try {
    const d = JSON.parse(localStorage.getItem(STORE_KEY));
    if (d && Array.isArray(d.tournaments)) return { knownPlayers: [], ...d };
  } catch (e) { /* ignorieren */ }
  return { tournaments: [], knownPlayers: [] };
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(db)); } catch (e) { /* voll / privat */ }
}

let db = load();
const ui = { draft: null, sheet: null, scores: {}, toastTimer: null, lastLiveMid: null };

/* ---------------------------------------------------------------------
   Helfer
   --------------------------------------------------------------------- */
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (s, r = document) => r.querySelector(s);

function shuffle(a) {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function initials(name) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const s = parts.length > 1 ? parts[0][0] + parts[1][0] : name.trim().slice(0, 2);
  return s.toUpperCase();
}
function groupSizes(n, g) {
  return Array.from({ length: g }, (_, i) => Math.floor(n / g) + (i < n % g ? 1 : 0));
}
function defaultName() {
  const d = new Date();
  return `Turnier ${d.getDate()}.${d.getMonth() + 1}.`;
}
function fmtDate(ts) {
  return new Date(ts).toLocaleDateString('de-DE', { day: 'numeric', month: 'short', year: 'numeric' });
}
const isPlayed = (m) => m.hg != null && m.ag != null;

/* ---------------------------------------------------------------------
   Spielplan erzeugen
   --------------------------------------------------------------------- */
// Jeder gegen jeden (Kreis-Methode). Liefert Spieltage mit Paarungen.
function roundRobin(items) {
  const arr = items.slice();
  if (arr.length % 2) arr.push(null);
  const n = arr.length;
  const rounds = [];
  for (let r = 0; r < n - 1; r++) {
    const pairs = [];
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i];
      const b = arr[n - 1 - i];
      if (a == null || b == null) continue;
      const swap = i === 0 ? r % 2 === 1 : i % 2 === 1;
      pairs.push(swap ? [b, a] : [a, b]);
    }
    rounds.push(pairs);
    arr.splice(1, 0, arr.pop());
  }
  return rounds;
}

const slotKey = (s) => JSON.stringify(s);
const matchKeys = (m) => [slotKey(m.home), slotKey(m.away)];

// Reihenfolge so anpassen, dass möglichst niemand zweimal direkt hintereinander spielt.
function spread(list, prev) {
  const rest = list.slice();
  const out = [];
  let last = prev ? matchKeys(prev) : [];
  while (rest.length) {
    let i = rest.findIndex((m) => !matchKeys(m).some((k) => last.includes(k)));
    if (i < 0) i = 0;
    const m = rest.splice(i, 1)[0];
    out.push(m);
    last = matchKeys(m);
  }
  return out;
}

function koOptions(n, g) {
  const sizes = groupSizes(n, g);
  const minSize = Math.min(...sizes);
  return [2, 4, 8].filter((k) => {
    if (k > n || k < g) return false;
    const q = Math.floor(k / g);
    const rest = k - q * g;
    return minSize >= q && sizes.filter((s) => s > q).length >= rest;
  });
}

function koDescription(k, g) {
  const q = Math.floor(k / g);
  const rest = k - q * g;
  if (g === 1) return `Die ersten ${k} der Tabelle kommen weiter.`;
  let s = q === 1 ? 'Die Gruppensieger' : `Die ersten ${q} jeder Gruppe`;
  if (rest) s += ` + ${rest === 1 ? 'der beste' : `die ${rest} besten`} ${q + 1}.-Platzierte${rest === 1 ? 'n' : ''}`;
  return s + ' kommen weiter.';
}

function countMatches(d) {
  const n = d.players.length;
  const g = d.format === 'groups' ? d.groupCount : 1;
  const sizes = groupSizes(n, g);
  let total = sizes.reduce((s, x) => s + (x * (x - 1)) / 2, 0) * (d.rematch ? 2 : 1);
  const finals = d.format === 'groups' ? d.finalsGroups : d.finalsLeague;
  if (finals === 'ko') total += d.koSize === 2 ? 1 : d.koSize;
  if (finals === 'placement') {
    const maxSize = Math.max(...sizes);
    for (let r = 0; r < maxSize; r++) {
      const c = sizes.filter((s) => s > r).length;
      total += (c * (c - 1)) / 2;
    }
  }
  return total;
}

function createTournament(d) {
  const players = d.players.map((p, i) => ({ id: p.id, name: p.name, color: COLORS[i % COLORS.length] }));
  const G = d.format === 'groups' ? d.groupCount : 1;
  let groups;
  if (G === 1) {
    groups = [shuffle(players.map((p) => p.id))];
  } else {
    groups = Array.from({ length: G }, () => []);
    d.order.forEach((id, i) => groups[i % G].push(id));
  }
  const finals = d.format === 'groups' ? d.finalsGroups : d.finalsLeague;
  const t = {
    id: uid(),
    name: d.name.trim() || defaultName(),
    createdAt: Date.now(),
    players,
    format: d.format,
    rematch: d.rematch,
    groups,
    finals,
    koSize: finals === 'ko' ? d.koSize : null,
    seedMode: null,
    matches: []
  };
  let n = 0;
  const mk = (o) => ({ id: 'm' + ++n, hg: null, ag: null, pen: null, phase: 0, ko: false, ...o });

  /* Gruppenphase / Liga */
  const rr = groups.map((g) => roundRobin(g));
  const maxR = Math.max(...rr.map((r) => r.length));
  let prev = null;
  for (let leg = 0; leg < (t.rematch ? 2 : 1); leg++) {
    const list = [];
    for (let r = 0; r < maxR; r++) {
      groups.forEach((_, gi) => {
        (rr[gi][r] || []).forEach(([a, b]) => {
          const md = leg * rr[gi].length + r + 1;
          list.push(mk({
            stage: 'group', group: gi, leg, md,
            home: { p: leg ? b : a }, away: { p: leg ? a : b },
            label: (G > 1 ? `Gruppe ${GROUP_NAMES[gi]} · ` : '') + `${md}. Spieltag`
          }));
        });
      });
    }
    const ordered = spread(list, prev);
    t.matches.push(...ordered);
    if (ordered.length) prev = ordered[ordered.length - 1];
  }

  /* Platzierungsspiele: Platz gegen Platz */
  if (finals === 'placement') {
    const maxSize = Math.max(...groups.map((g) => g.length));
    const tiers = [];
    let place = 1;
    for (let r = 0; r < maxSize; r++) {
      const members = groups.map((_, gi) => gi).filter((gi) => groups[gi].length > r);
      tiers.push({ r, members, start: place });
      place += members.length;
    }
    const list = [];
    for (const { r, members, start } of tiers.slice().reverse()) {
      const c = members.length;
      if (c === 2) {
        list.push(mk({
          stage: 'place', phase: 1, tier: r, ko: true,
          home: { g: members[0], r }, away: { g: members[1], r },
          label: r === 0 ? 'Finale' : `Spiel um Platz ${start}`,
          short: r === 0 ? 'Finale' : `Platz ${start}`
        }));
      } else if (c >= 3) {
        roundRobin(members).forEach((round) => round.forEach(([a, b]) => {
          list.push(mk({
            stage: 'place', phase: 1, tier: r,
            home: { g: a, r }, away: { g: b, r },
            label: r === 0 ? `Finalrunde · Platz 1–${c}` : `Platzierungsrunde · Platz ${start}–${start + c - 1}`
          }));
        }));
      }
    }
    t.matches.push(...spread(list, prev));
  }

  /* K.-o.-Runde */
  if (finals === 'ko') {
    const K = d.koSize;
    const q = Math.floor(K / G);
    const rest = K - q * G;
    let seeds;
    if (rest === 0) {
      seeds = [];
      for (let r = 0; r < q; r++) for (let gi = 0; gi < G; gi++) seeds.push({ g: gi, r });
      t.seedMode = 'fixed';
    } else {
      seeds = Array.from({ length: K }, (_, i) => ({ pos: i }));
      t.seedMode = 'dynamic';
    }
    const first = KO_PAIRS[K].map(([a, b]) => ({ home: seeds[a], away: seeds[b] }));
    const add = (o) => { const m = mk({ stage: 'ko', ko: true, ...o }); t.matches.push(m); return m; };
    if (K === 2) {
      add({ phase: 1, key: 'F', label: 'Finale', short: 'Finale', ...first[0] });
    } else if (K === 4) {
      const s1 = add({ phase: 1, key: 'SF1', label: 'Halbfinale 1', short: 'HF 1', ...first[0] });
      const s2 = add({ phase: 1, key: 'SF2', label: 'Halbfinale 2', short: 'HF 2', ...first[1] });
      add({ phase: 2, key: 'P3', label: 'Spiel um Platz 3', short: 'Platz 3', home: { lose: s1.id }, away: { lose: s2.id } });
      add({ phase: 2, key: 'F', label: 'Finale', short: 'Finale', home: { win: s1.id }, away: { win: s2.id } });
    } else {
      const qf = first.map((p, i) => add({ phase: 1, key: 'QF' + (i + 1), label: `Viertelfinale ${i + 1}`, short: `VF ${i + 1}`, ...p }));
      const s1 = add({ phase: 2, key: 'SF1', label: 'Halbfinale 1', short: 'HF 1', home: { win: qf[0].id }, away: { win: qf[1].id } });
      const s2 = add({ phase: 2, key: 'SF2', label: 'Halbfinale 2', short: 'HF 2', home: { win: qf[2].id }, away: { win: qf[3].id } });
      add({ phase: 3, key: 'P3', label: 'Spiel um Platz 3', short: 'Platz 3', home: { lose: s1.id }, away: { lose: s2.id } });
      add({ phase: 3, key: 'F', label: 'Finale', short: 'Finale', home: { win: s1.id }, away: { win: s2.id } });
    }
  }
  return t;
}

/* ---------------------------------------------------------------------
   Auswertung: Tabellen, Paarungen auflösen, Endstand
   --------------------------------------------------------------------- */
function rowCmp(a, b) {
  return b.pts - a.pts || b.diff - a.diff || b.gf - a.gf || (b.h2h[a.pid] || 0) - (a.h2h[b.pid] || 0) || a.name.localeCompare(b.name, 'de');
}
// Vergleich über Gruppen hinweg (unterschiedlich viele Spiele möglich)
function perfCmp(a, b) {
  const sp = (x) => Math.max(x.sp, 1);
  return b.pts / sp(b) - a.pts / sp(a) || b.diff / sp(b) - a.diff / sp(a) || b.gf / sp(b) - a.gf / sp(a) || a.name.localeCompare(b.name, 'de');
}

function computeTable(t, pids, matches, c) {
  const rows = new Map();
  pids.forEach((pid) => {
    if (!pid) return;
    rows.set(pid, { pid, name: playerName(t, pid), sp: 0, s: 0, u: 0, n: 0, gf: 0, ga: 0, diff: 0, pts: 0, form: [], h2h: {} });
  });
  matches.forEach((m) => {
    if (!isPlayed(m)) return;
    const h = resolve(m.home, c);
    const a = resolve(m.away, c);
    const rh = rows.get(h);
    const ra = rows.get(a);
    if (!rh || !ra) return;
    rh.sp++; ra.sp++;
    rh.gf += m.hg; rh.ga += m.ag; ra.gf += m.ag; ra.ga += m.hg;
    if (m.hg > m.ag) {
      rh.s++; ra.n++; rh.pts += 3; rh.form.push('S'); ra.form.push('N');
      rh.h2h[a] = (rh.h2h[a] || 0) + 3;
    } else if (m.hg < m.ag) {
      ra.s++; rh.n++; ra.pts += 3; ra.form.push('S'); rh.form.push('N');
      ra.h2h[h] = (ra.h2h[h] || 0) + 3;
    } else {
      rh.u++; ra.u++; rh.pts++; ra.pts++; rh.form.push('U'); ra.form.push('U');
      rh.h2h[a] = (rh.h2h[a] || 0) + 1;
      ra.h2h[h] = (ra.h2h[h] || 0) + 1;
    }
  });
  const list = [...rows.values()];
  list.forEach((r) => { r.diff = r.gf - r.ga; });
  return list.sort(rowCmp);
}

function analyze(t) {
  const c = { t, byId: new Map(t.matches.map((m) => [m.id, m])) };
  const gm = t.matches.filter((m) => m.stage === 'group');
  c.groupDone = t.groups.map((_, gi) => gm.filter((m) => m.group === gi).every(isPlayed));
  c.allGroupsDone = c.groupDone.every(Boolean);
  c.standings = t.groups.map((ids, gi) => computeTable(t, ids, gm.filter((m) => m.group === gi), c));
  c.arranged = t.seedMode === 'dynamic' && c.allGroupsDone ? arrangeSeeds(t, c) : null;
  c.played = t.matches.filter(isPlayed).length;
  c.total = t.matches.length;
  c.finished = c.played === c.total;
  c.current = t.matches.find((m) => !isPlayed(m) && isReady(m, c)) || null;
  return c;
}

// Setzliste bei "beste Zweite/Dritte" – inkl. Vermeidung von Duellen aus derselben Gruppe.
function arrangeSeeds(t, c) {
  const G = t.groups.length;
  const K = t.koSize;
  const q = Math.floor(K / G);
  const rest = K - q * G;
  const quals = [];
  for (let r = 0; r < q; r++) {
    c.standings.forEach((st, g) => { if (st[r]) quals.push({ ...st[r], r, g }); });
  }
  const cands = c.standings.map((st, g) => (st[q] ? { ...st[q], r: q, g } : null)).filter(Boolean).sort(perfCmp);
  quals.push(...cands.slice(0, rest));
  quals.sort((a, b) => a.r - b.r || perfCmp(a, b));
  const pairs = KO_PAIRS[K];
  for (let i = 0; i < pairs.length; i++) {
    const [ia, ib] = pairs[i];
    if (quals[ia].g !== quals[ib].g) continue;
    for (let j = 0; j < pairs.length; j++) {
      if (j === i) continue;
      const [ja, jb] = pairs[j];
      if (quals[jb].g !== quals[ia].g && quals[ja].g !== quals[ib].g) {
        [quals[ib], quals[jb]] = [quals[jb], quals[ib]];
        break;
      }
    }
  }
  return quals.map((x) => x.pid);
}

function winnerSide(m) {
  if (!isPlayed(m)) return null;
  if (m.hg > m.ag) return 'home';
  if (m.ag > m.hg) return 'away';
  return m.pen || null;
}

function resolve(slot, c) {
  if (!slot) return null;
  if (slot.p) return slot.p;
  if (slot.g != null) return c.groupDone[slot.g] ? (c.standings[slot.g][slot.r] || {}).pid || null : null;
  if (slot.pos != null) return c.arranged ? c.arranged[slot.pos] : null;
  if (slot.win || slot.lose) {
    const m = c.byId.get(slot.win || slot.lose);
    const w = m && winnerSide(m);
    if (!w) return null;
    const side = slot.win ? w : w === 'home' ? 'away' : 'home';
    return resolve(m[side], c);
  }
  return null;
}
const isReady = (m, c) => !!(resolve(m.home, c) && resolve(m.away, c));
const isEditable = (t, m) => !t.matches.some((x) => isPlayed(x) && x.phase > m.phase);

function playerOf(t, pid) { return t.players.find((p) => p.id === pid); }
function playerName(t, pid) { const p = playerOf(t, pid); return p ? p.name : '?'; }

function slotLabel(t, slot, c) {
  if (slot.g != null) return t.groups.length === 1 ? `${slot.r + 1}. der Tabelle` : `${slot.r + 1}. Gruppe ${GROUP_NAMES[slot.g]}`;
  if (slot.pos != null) return 'Qualifikant';
  const m = c.byId.get(slot.win || slot.lose);
  return (slot.win ? 'Sieger ' : 'Verlierer ') + (m ? m.short || m.label : '');
}
// Spieler für einen Slot oder Platzhalter
function sideInfo(t, slot, c) {
  const pid = resolve(slot, c);
  if (pid) {
    const p = playerOf(t, pid);
    return { pid, name: p.name, color: p.color, ph: false };
  }
  return { pid: null, name: slotLabel(t, slot, c), color: null, ph: true };
}

// Endstand (nur sinnvoll, wenn alle Spiele gespielt sind)
function finalRanking(t, c) {
  const out = [];
  const seen = new Set();
  const add = (pid) => { if (pid && !seen.has(pid)) { seen.add(pid); out.push(pid); } };
  const groupInfo = new Map();
  c.standings.forEach((st, g) => st.forEach((row, r) => groupInfo.set(row.pid, { ...row, r, g })));
  const restByGroup = () => [...groupInfo.values()].filter((x) => !seen.has(x.pid)).sort((a, b) => a.r - b.r || perfCmp(a, b)).forEach((x) => add(x.pid));

  if (t.finals === 'none') {
    c.standings[0].forEach((r) => add(r.pid));
  } else if (t.finals === 'placement') {
    const maxSize = Math.max(...t.groups.map((g) => g.length));
    for (let r = 0; r < maxSize; r++) {
      const members = t.groups.map((_, gi) => gi).filter((gi) => t.groups[gi].length > r);
      const pids = members.map((gi) => resolve({ g: gi, r }, c));
      if (members.length === 1) add(pids[0]);
      else if (members.length === 2) {
        const m = t.matches.find((x) => x.stage === 'place' && x.tier === r);
        const w = winnerSide(m);
        if (w) { add(resolve(m[w], c)); add(resolve(m[w === 'home' ? 'away' : 'home'], c)); }
      } else {
        const tm = t.matches.filter((x) => x.stage === 'place' && x.tier === r);
        computeTable(t, pids, tm, c).forEach((row) => add(row.pid));
      }
    }
    restByGroup();
  } else if (t.finals === 'ko') {
    const byKey = (k) => t.matches.find((m) => m.key === k);
    const addMatch = (m) => {
      const w = m && winnerSide(m);
      if (!w) return;
      add(resolve(m[w], c));
      add(resolve(m[w === 'home' ? 'away' : 'home'], c));
    };
    addMatch(byKey('F'));
    addMatch(byKey('P3'));
    if (t.koSize === 8) {
      ['QF1', 'QF2', 'QF3', 'QF4']
        .map((k) => byKey(k))
        .map((m) => { const w = winnerSide(m); return w ? resolve(m[w === 'home' ? 'away' : 'home'], c) : null; })
        .filter(Boolean)
        .map((pid) => groupInfo.get(pid))
        .sort(perfCmp)
        .forEach((x) => add(x.pid));
    }
    restByGroup();
  }
  return out;
}

function phaseText(t, c) {
  if (c.finished) return 'Turnier beendet';
  if (!c.allGroupsDone) return t.groups.length > 1 ? 'Gruppenphase' : t.rematch ? 'Hin- & Rückrunde' : 'Jeder gegen jeden';
  return t.finals === 'ko' ? 'K.-o.-Runde' : 'Finalrunde';
}

/* ---------------------------------------------------------------------
   Setup (neues Turnier)
   --------------------------------------------------------------------- */
function newDraft(base) {
  const d = {
    name: '',
    players: [],
    order: [],
    format: 'league',
    rematch: false,
    groupCount: 2,
    finalsLeague: 'none',
    finalsGroups: 'placement',
    koSize: 4
  };
  if (base) {
    d.name = base.name;
    d.players = base.players.map((p) => ({ id: uid(), name: p.name }));
    d.order = shuffle(d.players.map((p) => p.id));
    d.format = base.format;
    d.rematch = base.rematch;
    d.groupCount = Math.max(2, base.groups.length);
    if (base.format === 'groups') d.finalsGroups = base.finals; else d.finalsLeague = base.finals;
    if (base.koSize) d.koSize = base.koSize;
  }
  return d;
}

function groupCountOptions(n) { return [2, 3, 4].filter((g) => n >= g * 2); }

function normalizeDraft(d) {
  const n = d.players.length;
  const gOpts = groupCountOptions(n);
  if (d.format === 'groups' && !gOpts.length) d.format = 'league';
  if (gOpts.length && !gOpts.includes(d.groupCount)) d.groupCount = gOpts[gOpts.length - 1];
  const g = d.format === 'groups' ? d.groupCount : 1;
  const finals = d.format === 'groups' ? d.finalsGroups : d.finalsLeague;
  if (finals === 'ko') {
    const ko = koOptions(n, g);
    if (!ko.length) {
      if (d.format === 'groups') d.finalsGroups = 'placement'; else d.finalsLeague = 'none';
    } else if (!ko.includes(d.koSize)) {
      d.koSize = ko.includes(4) ? 4 : ko[ko.length - 1];
    }
  }
}

function canStart(d) { return d.players.length >= 2; }

function addPlayer(name) {
  const d = ui.draft;
  name = name.replace(/\s+/g, ' ').trim().slice(0, 20);
  if (!name) return false;
  if (d.players.length >= MAX_PLAYERS) { toast(`Maximal ${MAX_PLAYERS} Spieler`); return false; }
  if (d.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) { toast(`${name} ist schon dabei`); return false; }
  const p = { id: uid(), name };
  d.players.push(p);
  const pos = Math.floor(Math.random() * (d.order.length + 1));
  d.order.splice(pos, 0, p.id);
  return true;
}

function rememberPlayers(names) {
  const lower = names.map((n) => n.toLowerCase());
  db.knownPlayers = [...names, ...db.knownPlayers.filter((n) => !lower.includes(n.toLowerCase()))].slice(0, 40);
}

/* ---------------------------------------------------------------------
   Icons
   --------------------------------------------------------------------- */
const ICON = {
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
  more: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>',
  live: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7l4 3-1.5 5h-5L8 10z"/></svg>',
  table: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h16"/><path d="M8 4v16" opacity=".5"/></svg>',
  list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="17" rx="3"/><path d="M8 2v4M16 2v4M8 11h8M8 15h5"/></svg>'
};

/* ---------------------------------------------------------------------
   Routing
   --------------------------------------------------------------------- */
function route() {
  const h = location.hash.replace(/^#\/?/, '');
  const parts = h.split('/').filter(Boolean);
  if (parts[0] === 'neu') return { view: 'setup' };
  if (parts[0] === 't' && parts[1]) return { view: 'tournament', id: parts[1], tab: parts[2] || 'live' };
  return { view: 'home' };
}
function go(hash, replace) {
  if (replace) { history.replaceState(null, '', hash); render(); } else location.hash = hash;
}
const currentT = () => { const r = route(); return r.view === 'tournament' ? db.tournaments.find((x) => x.id === r.id) : null; };

/* ---------------------------------------------------------------------
   Rendering
   --------------------------------------------------------------------- */
const app = $('#app');

function render() {
  const r = route();
  app.className = '';
  if (r.view === 'setup') {
    if (!ui.draft) ui.draft = newDraft();
    normalizeDraft(ui.draft);
    app.innerHTML = renderSetup(ui.draft);
    app.classList.add('has-cta');
  } else if (r.view === 'tournament') {
    const t = db.tournaments.find((x) => x.id === r.id);
    if (!t) { go('#/', true); return; }
    app.innerHTML = renderTournament(t, r.tab);
    app.classList.add('has-tabbar');
    if (r.tab === 'live') updateScoreUI('live');
  } else {
    app.innerHTML = renderHome();
  }
  renderSheet();
}

function avatar(info, size = '') {
  if (!info || info.ph) return `<span class="av q ${size}">?</span>`;
  return `<span class="av ${size}" style="--c:${info.color}">${esc(initials(info.name))}</span>`;
}

/* ----- Startseite ----- */
function renderHome() {
  const list = db.tournaments.slice().sort((a, b) => b.createdAt - a.createdAt);
  const items = list.map((t) => {
    const c = analyze(t);
    const pct = Math.round((c.played / Math.max(c.total, 1)) * 100);
    let meta = `${t.players.length} Spieler · ${c.played}/${c.total} Spiele`;
    if (c.finished) {
      const champ = finalRanking(t, c)[0];
      meta = `🏆 ${esc(playerName(t, champ))} · ${fmtDate(t.createdAt)}`;
    }
    return `
      <div class="card t-item" role="button" data-act="open" data-id="${t.id}">
        <div class="t-icon ${c.finished ? 'done' : ''}">${c.finished ? '🏆' : '⚽'}</div>
        <div class="t-body">
          <div class="t-name">${esc(t.name)}</div>
          <div class="t-meta">${meta}</div>
          ${c.finished ? '' : `<div class="t-bar"><div style="width:${pct}%"></div></div>`}
        </div>
        <button class="icon-btn t-del" data-act="del-t" data-id="${t.id}" aria-label="Turnier löschen">${ICON.trash}</button>
      </div>`;
  }).join('');
  return `
    <section class="hero">
      <span class="hero-badge">⚽ Konsolen-Turnier</span>
      <h1 class="h-display hero-title">Kick<span>off</span></h1>
      <p class="hero-sub">Spieler eintragen, Modus wählen, losspielen. Die App sagt euch, wer als Nächstes ran muss.</p>
      <button class="btn btn-primary btn-block" data-act="new">${ICON.plus.replace('<svg', '<svg width="22" height="22"')} Neues Turnier</button>
    </section>
    <div class="section-title">Deine Turniere ${list.length ? `<span class="count">${list.length}</span>` : ''}</div>
    ${items || `<div class="card empty"><div class="big">🎮</div>Noch keine Turniere.<br>Starte dein erstes!</div>`}
  `;
}

/* ----- Setup ----- */
function renderSetup(d) {
  const n = d.players.length;
  const inDraft = new Set(d.players.map((p) => p.name.toLowerCase()));
  const quick = db.knownPlayers.filter((name) => !inDraft.has(name.toLowerCase())).slice(0, 16);
  const gOpts = groupCountOptions(n);
  const G = d.format === 'groups' ? d.groupCount : 1;
  const finals = d.format === 'groups' ? d.finalsGroups : d.finalsLeague;
  const ko = koOptions(n, G);
  const colorOf = (id) => COLORS[d.players.findIndex((p) => p.id === id) % COLORS.length];

  const chips = d.players.map((p, i) => `
    <span class="pchip">${avatar({ name: p.name, color: COLORS[i % COLORS.length] }, 'sm')}${esc(p.name)}
      <button class="x" data-act="rm-player" data-id="${p.id}" aria-label="${esc(p.name)} entfernen">×</button>
    </span>`).join('');

  let groupsHtml = '';
  if (d.format === 'groups' && gOpts.length) {
    const groups = Array.from({ length: d.groupCount }, () => []);
    d.order.forEach((id, i) => groups[i % d.groupCount].push(id));
    groupsHtml = `
      <div class="section-title">Gruppen</div>
      <div class="card">
        <div class="seg">${[2, 3, 4].map((g) => `<button class="${d.groupCount === g ? 'on' : ''}" data-act="set-groups" data-v="${g}" ${gOpts.includes(g) ? '' : 'disabled'}>${g} Gruppen</button>`).join('')}</div>
        <div class="groups-preview">
          ${groups.map((ids, gi) => `
            <div class="gp">
              <div class="gp-head">Gruppe ${GROUP_NAMES[gi]}</div>
              ${ids.map((id) => { const p = d.players.find((x) => x.id === id); return `<div class="gp-row">${avatar({ name: p.name, color: colorOf(id) }, 'xs')}<span>${esc(p.name)}</span></div>`; }).join('')}
            </div>`).join('')}
        </div>
        <button class="btn btn-ghost btn-block btn-small" style="margin-top:12px" data-act="shuffle">🎲 Neu auslosen</button>
      </div>`;
  }

  let finalsHtml;
  if (d.format === 'groups') {
    const placeDesc = d.groupCount === 2
      ? '1. gegen 1. = Finale, 2. gegen 2. = Spiel um Platz 3 usw.'
      : 'Alle Gruppenersten spielen um Platz 1, alle Zweiten um die nächsten Plätze usw.';
    finalsHtml = `
      <div class="opt-grid">
        <button class="opt ${finals === 'placement' ? 'on' : ''}" data-act="set-finals" data-v="placement">
          <span class="opt-emoji">🎯</span><span class="opt-title">Platz gegen Platz</span>
          <span class="opt-desc">${placeDesc} Jeder spielt um seine Platzierung.</span>
        </button>
        <button class="opt ${finals === 'ko' ? 'on' : ''}" data-act="set-finals" data-v="ko">
          <span class="opt-emoji">⚔️</span><span class="opt-title">K.-o.-Runde</span>
          <span class="opt-desc">Die Besten kommen weiter – Halbfinale, Finale. Wer verliert, fliegt raus.</span>
        </button>
      </div>`;
  } else {
    finalsHtml = `
      <div class="opt-grid two">
        <button class="opt ${finals === 'none' ? 'on' : ''}" data-act="set-finals" data-v="none">
          <span class="opt-emoji">📊</span><span class="opt-title">Keine</span>
          <span class="opt-desc">Der Tabellenerste gewinnt.</span>
        </button>
        <button class="opt ${finals === 'ko' ? 'on' : ''}" data-act="set-finals" data-v="ko">
          <span class="opt-emoji">⚔️</span><span class="opt-title">K.-o.-Runde</span>
          <span class="opt-desc">Die Besten spielen den Sieger aus.</span>
        </button>
      </div>`;
  }
  if (finals === 'ko' && ko.length) {
    const lbl = { 2: ['Top 2', 'Finale'], 4: ['Top 4', 'Halbfinale'], 8: ['Top 8', 'Viertelf.'] };
    finalsHtml += `
      <div class="field-label" style="margin-top:16px">Wer kommt weiter?</div>
      <div class="seg">${[2, 4, 8].map((k) => `<button class="${d.koSize === k ? 'on' : ''}" data-act="set-ko" data-v="${k}" ${ko.includes(k) ? '' : 'disabled'}>${lbl[k][0]}<small>${lbl[k][1]}</small></button>`).join('')}</div>
      <div class="hint">${koDescription(d.koSize, G)}</div>`;
  }

  const total = canStart(d) ? countMatches(d) : 0;

  return `
    <header class="topbar">
      <button class="icon-btn" data-act="home" aria-label="Zurück">${ICON.back}</button>
      <div class="tb-title"><div class="tb-name">Neues Turnier</div><div class="tb-sub">Spieler & Modus festlegen</div></div>
    </header>

    <div class="section-title" style="margin-top:12px">Turniername</div>
    <input class="input" data-bind="name" value="${esc(d.name)}" placeholder="${esc(defaultName())}" maxlength="40" autocomplete="off">

    <div class="section-title">Spieler <span class="count">${n}</span></div>
    <div class="card">
      <div class="add-row">
        <input class="input" id="player-input" placeholder="Name eingeben…" maxlength="20" autocomplete="off" enterkeyhint="done">
        <button class="add-btn" data-act="add-player" aria-label="Spieler hinzufügen">${ICON.plus}</button>
      </div>
      ${n ? `<div class="chips">${chips}</div>` : '<div class="hint">Mindestens 2 Spieler. Für Gruppen mindestens 4.</div>'}
      ${quick.length ? `<div class="field-label" style="margin-top:16px">Schnell hinzufügen</div><div class="chips" style="margin-top:0">${quick.map((q) => `<button class="qchip" data-act="quick-add" data-name="${esc(q)}">+ ${esc(q)}</button>`).join('')}</div>` : ''}
    </div>

    <div class="section-title">Modus</div>
    <div class="opt-grid two">
      <button class="opt ${d.format === 'league' ? 'on' : ''}" data-act="set-format" data-v="league">
        <span class="opt-emoji">🔁</span><span class="opt-title">Jeder gegen jeden</span>
        <span class="opt-desc">Alle in einer Tabelle.</span>
      </button>
      <button class="opt ${d.format === 'groups' ? 'on' : ''}" data-act="set-format" data-v="groups" ${gOpts.length ? '' : 'disabled'}>
        <span class="opt-emoji">👥</span><span class="opt-title">Gruppen</span>
        <span class="opt-desc">${gOpts.length ? 'Kürzer! Gruppenphase + Finalrunde.' : 'Ab 4 Spielern.'}</span>
      </button>
    </div>

    <div class="card" style="margin-top:10px">
      <button class="toggle-row" data-act="toggle-rematch">
        <span class="tr-text"><span class="tr-title">Mit Rückspiel</span><br><span class="tr-desc">${d.format === 'groups' ? 'In der Gruppenphase' : 'Jedes Duell'} zweimal – Hin- und Rückrunde</span></span>
        <span class="switch ${d.rematch ? 'on' : ''}"></span>
      </button>
    </div>

    ${groupsHtml}

    <div class="section-title">${d.format === 'groups' ? 'Nach der Gruppenphase' : 'Finalrunde'}</div>
    ${finalsHtml}

    <div class="cta-bar"><div class="cta-inner">
      <div class="cta-info">${canStart(d) ? `<b>${total} Spiele</b> · ${n} Spieler` : 'Füge mindestens 2 Spieler hinzu'}</div>
      <button class="btn btn-primary btn-block" data-act="start" ${canStart(d) ? '' : 'disabled'}>Turnier starten ⚽</button>
    </div></div>
  `;
}

/* ----- Turnieransicht ----- */
function renderTournament(t, tab) {
  const c = analyze(t);
  const pct = Math.round((c.played / Math.max(c.total, 1)) * 100);
  let body;
  if (tab === 'tabelle') body = renderTables(t, c);
  else if (tab === 'spiele') body = renderMatches(t, c);
  else body = renderLive(t, c);
  const tabs = [['live', 'Spiel', ICON.live], ['tabelle', 'Tabelle', ICON.table], ['spiele', 'Spiele', ICON.list]];
  return `
    <header class="topbar">
      <button class="icon-btn" data-act="home" aria-label="Zur Startseite">${ICON.back}</button>
      <div class="tb-title"><div class="tb-name">${esc(t.name)}</div><div class="tb-sub">${phaseText(t, c)} · ${c.played}/${c.total} Spiele</div></div>
      <button class="icon-btn" data-act="menu" aria-label="Menü">${ICON.more}</button>
    </header>
    <div class="progress"><div style="width:${pct}%"></div></div>
    ${body}
    <nav class="tabbar">
      ${tabs.map(([k, l, i]) => `<button class="${tab === k ? 'on' : ''}" data-act="tab" data-v="${k}">${i}${l}</button>`).join('')}
    </nav>`;
}

function scoreEditor(scope, m, h, a) {
  const stepper = (side) => `
    <div class="stepper">
      <button class="step plus" data-act="inc" data-scope="${scope}" data-side="${side}" aria-label="Tor +1">+</button>
      <div class="score-num" data-num="${scope}-${side}">0</div>
      <button class="step" data-act="dec" data-scope="${scope}" data-side="${side}" aria-label="Tor −1">−</button>
    </div>`;
  return `
    <div class="score-row">${stepper('h')}<div class="score-colon">:</div>${stepper('a')}</div>
    ${m.ko ? `
    <div class="pen" data-pen="${scope}" hidden>
      <div class="pen-q">Unentschieden! Wer gewinnt das Elfmeterschießen?</div>
      <div class="pen-btns">
        <button data-act="pen" data-scope="${scope}" data-side="home">${esc(h.name)}</button>
        <button data-act="pen" data-scope="${scope}" data-side="away">${esc(a.name)}</button>
      </div>
    </div>` : ''}`;
}

function matchPlayers(h, a) {
  return `
    <div class="mc-players">
      <div class="mc-side">${avatar(h, 'xl')}<div class="mc-name">${esc(h.name)}</div><div class="mc-tag">Heim</div></div>
      <div class="mc-vs">VS</div>
      <div class="mc-side">${avatar(a, 'xl')}<div class="mc-name">${esc(a.name)}</div><div class="mc-tag">Gast</div></div>
    </div>`;
}

function renderLive(t, c) {
  if (c.finished) return renderChampion(t, c);
  const m = c.current;
  if (!m) {
    return `<div class="card waiting"><div style="font-size:40px">⏳</div><b>Warte auf Ergebnisse</b><div class="muted">Trage zuerst die offenen Spiele ein.</div></div>`;
  }
  const s = ui.scores.live;
  if (!s || s.mid !== m.id) ui.scores.live = { mid: m.id, h: 0, a: 0, pen: null };
  const h = sideInfo(t, m.home, c);
  const a = sideInfo(t, m.away, c);
  const idx = t.matches.indexOf(m) + 1;
  const isFinal = m.key === 'F' || (m.stage === 'place' && m.tier === 0 && m.ko);
  const upcoming = t.matches.filter((x) => !isPlayed(x) && x !== m).slice(0, 3);
  return `
    <div class="live-meta">
      <span class="chip ${isFinal ? 'gold' : ''}"><span class="live-dot"></span>${isFinal ? '🏆 ' : ''}${esc(m.label)}</span>
      <span class="muted" style="font-weight:700;font-size:13px">Spiel ${idx}/${c.total}</span>
    </div>
    <div class="match-card ${isFinal ? 'final' : ''}" data-card="live">
      ${matchPlayers(h, a)}
      ${scoreEditor('live', m, h, a)}
      <button class="btn btn-primary btn-block" data-act="save-live" style="position:relative;z-index:1">Ergebnis speichern</button>
    </div>
    ${upcoming.length ? `<div class="section-title">Danach</div><div class="next-list">${upcoming.map((x) => matchRow(t, x, c)).join('')}</div>` : ''}
  `;
}

function renderChampion(t, c) {
  const rank = finalRanking(t, c);
  const info = (pid) => sideInfo(t, { p: pid }, c);
  const champ = info(rank[0]);
  const confColors = ['#c6ff3d', '#22d3ee', '#f472b6', '#fbbf24', '#a78bfa'];
  const conf = Array.from({ length: 36 }, (_, i) => `<i style="left:${(i * 97) % 100}%;background:${confColors[i % 5]};animation-duration:${2.6 + ((i * 37) % 30) / 10}s;animation-delay:${((i * 53) % 40) / 10}s"></i>`).join('');
  const pod = (p, cls, nr) => (p ? `<div class="pod ${cls}">${avatar(info(p), '')}<div class="pod-name">${esc(playerName(t, p))}</div><div class="pod-block">${nr}</div></div>` : '<div></div>');
  return `
    <div class="champion">
      <div class="confetti">${conf}</div>
      <div class="trophy">🏆</div>
      <div class="champ-label">CHAMPION</div>
      <div class="champ-name">${esc(champ.name)}</div>
      <div class="muted" style="font-weight:600">${esc(t.name)}</div>
      ${rank.length >= 3 ? `<div class="podium">${pod(rank[1], 'p2', 2)}${pod(rank[0], 'p1', 1)}${pod(rank[2], 'p3', 3)}</div>` : ''}
    </div>
    <div class="section-title">Endstand</div>
    <div class="rank-list">
      ${rank.map((pid, i) => `<div class="rank-row r${i + 1}"><span class="rk">${i + 1}.</span>${avatar(info(pid), 'sm')}<span class="nm">${esc(playerName(t, pid))}</span>${i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : ''}</div>`).join('')}
    </div>
    <button class="btn btn-ghost btn-block" style="margin-top:18px" data-act="rematch-t">🔁 Revanche – neues Turnier, gleiche Spieler</button>
  `;
}

function matchRow(t, m, c, opts = {}) {
  const h = sideInfo(t, m.home, c);
  const a = sideInfo(t, m.away, c);
  const played = isPlayed(m);
  const w = winnerSide(m);
  const cls = (side, info) => [side, info.ph ? 'ph' : '', played && w ? (w === side ? 'win' : 'lose') : ''].join(' ');
  const isCur = c.current === m && !c.finished;
  const locked = played && !isEditable(t, m);
  const score = played
    ? `<div class="mrow-score">${m.hg}:${m.ag}${m.pen ? '<small>n. E.</small>' : ''}</div>`
    : '<div class="mrow-score open">–:–</div>';
  return `
    <button class="mrow ${isCur ? 'current' : ''} ${locked ? 'locked' : ''}" data-act="open-match" data-id="${m.id}">
      <div class="mrow-label">${opts.num ? `<span class="num">#${t.matches.indexOf(m) + 1}</span>` : ''}${esc(m.label)}${isCur ? '<span class="badge-live">JETZT</span>' : ''}</div>
      <div class="mrow-body">
        <div class="mrow-p ${cls('home', h)}">${avatar(h, 'sm')}<span class="nm">${esc(h.name)}</span></div>
        ${score}
        <div class="mrow-p ${cls('away', a)}">${avatar(a, 'sm')}<span class="nm">${esc(a.name)}</span></div>
      </div>
    </button>`;
}

function renderMatches(t, c) {
  const sections = [];
  const gm = t.matches.filter((m) => m.stage === 'group');
  if (t.rematch) {
    sections.push(['Hinrunde', gm.filter((m) => m.leg === 0)]);
    sections.push(['Rückrunde', gm.filter((m) => m.leg === 1)]);
  } else {
    sections.push([t.groups.length > 1 ? 'Gruppenphase' : 'Spiele', gm]);
  }
  const fm = t.matches.filter((m) => m.stage !== 'group');
  if (fm.length) sections.push([t.finals === 'ko' ? 'K.-o.-Runde' : 'Finalrunde', fm]);
  return sections.map(([title, list]) => `
    <div class="section-title">${title} <span class="count">${list.filter(isPlayed).length}/${list.length}</span></div>
    <div class="next-list">${list.map((m) => matchRow(t, m, c, { num: true })).join('')}</div>
  `).join('');
}

function renderTables(t, c) {
  const G = t.groups.length;
  let markQ = () => '';
  let legend = '';
  if (t.finals === 'ko') {
    const q = Math.floor(t.koSize / G);
    const rest = t.koSize - q * G;
    markQ = (r) => (r < q ? 'q' : rest && r === q ? 'q2' : '');
    legend = `<div class="legend"><span>K.-o.-Runde</span>${rest ? `<span class="gold">Beste ${q + 1}.-Platzierte</span>` : ''}</div>`;
  }
  const tables = c.standings.map((rows, gi) => {
    const gmDone = c.groupDone[gi];
    const title = G > 1 ? `Gruppe ${GROUP_NAMES[gi]}` : 'Tabelle';
    return `
      <div class="card table-card" style="margin-bottom:12px">
        <div class="table-head">
          ${G > 1 ? `<span class="g-badge">${GROUP_NAMES[gi]}</span>` : ''}
          <span class="th-title">${title}</span>
          <span class="th-state">${gmDone ? 'abgeschlossen ✓' : 'läuft'}</span>
        </div>
        ${tableHtml(t, rows, markQ)}
        ${legend}
      </div>`;
  }).join('');

  let finalsHtml = '';
  const fm = t.matches.filter((m) => m.stage !== 'group');
  if (t.finals === 'ko') {
    const rounds = {};
    fm.forEach((m) => {
      const k = m.key.startsWith('QF') ? 'Viertelfinale' : m.key.startsWith('SF') ? 'Halbfinale' : m.key === 'P3' ? 'Spiel um Platz 3' : 'Finale';
      (rounds[k] = rounds[k] || []).push(m);
    });
    finalsHtml = `<div class="section-title">K.-o.-Runde</div>` + Object.entries(rounds).map(([k, list]) => `
      <div class="ko-round">${list.length > 1 ? `<div class="ko-round-title">${k}</div>` : ''}<div class="next-list">${list.map((m) => matchRow(t, m, c)).join('')}</div></div>`).join('');
  } else if (t.finals === 'placement') {
    const maxSize = Math.max(...t.groups.map((g) => g.length));
    const blocks = [];
    for (let r = 0; r < maxSize; r++) {
      const members = t.groups.map((_, gi) => gi).filter((gi) => t.groups[gi].length > r);
      const tm = fm.filter((m) => m.tier === r);
      if (members.length >= 3 && c.allGroupsDone) {
        const pids = members.map((gi) => resolve({ g: gi, r }, c));
        const rows = computeTable(t, pids, tm, c);
        blocks.push(`<div class="card table-card" style="margin-bottom:12px"><div class="table-head"><span class="th-title">${esc(tm[0].label)}</span></div>${tableHtml(t, rows, () => '')}</div>`);
      } else if (tm.length) {
        blocks.push(`<div class="next-list" style="margin-bottom:8px">${tm.map((m) => matchRow(t, m, c)).join('')}</div>`);
      }
    }
    finalsHtml = `<div class="section-title">Platzierungsspiele</div>${blocks.join('')}`;
  }

  let rankingHtml = '';
  if (c.finished && t.finals !== 'none') {
    const rank = finalRanking(t, c);
    rankingHtml = `<div class="section-title">Endstand</div><div class="rank-list">${rank.map((pid, i) => `<div class="rank-row r${i + 1}"><span class="rk">${i + 1}.</span>${avatar(sideInfo(t, { p: pid }, c), 'sm')}<span class="nm">${esc(playerName(t, pid))}</span></div>`).join('')}</div>`;
  }

  return `${rankingHtml}${rankingHtml ? '<div class="section-title">Gruppenphase</div>' : ''}${tables}${finalsHtml}${renderStats(t, c)}`;
}

function tableHtml(t, rows, markQ) {
  return `
    <table class="tbl">
      <thead><tr><th>#</th><th class="c-name" style="text-align:left">Spieler</th><th>Sp</th><th>S</th><th>U</th><th>N</th><th>Tore</th><th>+/−</th><th>Pkt</th></tr></thead>
      <tbody>
        ${rows.map((r, i) => {
          const p = playerOf(t, r.pid);
          return `<tr class="${markQ(i)}">
            <td class="c-rank">${i + 1}</td>
            <td class="c-name"><div>${avatar({ name: p.name, color: p.color }, 'xs')}<span class="nm">${esc(p.name)}</span></div>
              ${r.form.length ? `<div class="form" style="margin:3px 0 0 28px">${r.form.slice(-5).map((f) => `<i class="${f}"></i>`).join('')}</div>` : ''}</td>
            <td class="c-sm">${r.sp}</td><td class="c-sm">${r.s}</td><td class="c-sm">${r.u}</td><td class="c-sm">${r.n}</td>
            <td class="c-goals">${r.gf}:${r.ga}</td>
            <td class="c-diff">${r.diff > 0 ? '+' : ''}${r.diff}</td>
            <td class="c-pts">${r.pts}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;
}

function renderStats(t, c) {
  const played = t.matches.filter(isPlayed);
  if (!played.length) return '';
  const goals = new Map();
  let total = 0;
  let best = null;
  played.forEach((m) => {
    const h = resolve(m.home, c);
    const a = resolve(m.away, c);
    goals.set(h, (goals.get(h) || 0) + m.hg);
    goals.set(a, (goals.get(a) || 0) + m.ag);
    total += m.hg + m.ag;
    const margin = Math.abs(m.hg - m.ag);
    if (margin > 0 && (!best || margin > best.margin || (margin === best.margin && m.hg + m.ag > best.sum))) {
      best = { margin, sum: m.hg + m.ag, m, h, a };
    }
  });
  const top = [...goals.entries()].sort((x, y) => y[1] - x[1])[0];
  const bestTxt = best ? `${Math.max(best.m.hg, best.m.ag)}:${Math.min(best.m.hg, best.m.ag)}` : '–';
  const bestSub = best ? (best.m.hg > best.m.ag ? `${playerName(t, best.h)} vs ${playerName(t, best.a)}` : `${playerName(t, best.a)} vs ${playerName(t, best.h)}`) : 'noch keiner';
  return `
    <div class="section-title">Statistik</div>
    <div class="stats">
      <div class="card stat"><div class="stat-label">⚽ Torjäger</div><div class="stat-value">${top[1]}</div><div class="stat-sub">${esc(playerName(t, top[0]))}</div></div>
      <div class="card stat"><div class="stat-label">💥 Höchster Sieg</div><div class="stat-value">${bestTxt}</div><div class="stat-sub">${esc(bestSub)}</div></div>
      <div class="card stat"><div class="stat-label">🥅 Tore gesamt</div><div class="stat-value">${total}</div><div class="stat-sub">in ${played.length} Spielen</div></div>
      <div class="card stat"><div class="stat-label">📈 Tore pro Spiel</div><div class="stat-value">${(total / played.length).toFixed(1).replace('.', ',')}</div><div class="stat-sub">Durchschnitt</div></div>
    </div>`;
}

/* ----- Bottom Sheet ----- */
function renderSheet() {
  const root = $('#sheet-root');
  const s = ui.sheet;
  const t = currentT();
  if (!s || !t) { root.innerHTML = ''; return; }
  const c = analyze(t);
  let inner = '';
  if (s.type === 'edit') {
    const m = c.byId.get(s.mid);
    if (!m) { ui.sheet = null; root.innerHTML = ''; return; }
    const h = sideInfo(t, m.home, c);
    const a = sideInfo(t, m.away, c);
    inner = `
      <h2 class="sheet-title">${isPlayed(m) ? 'Ergebnis ändern' : 'Ergebnis eintragen'}</h2>
      <p class="sheet-sub">${esc(m.label)} · Spiel ${t.matches.indexOf(m) + 1}</p>
      ${matchPlayers(h, a)}
      ${scoreEditor('sheet', m, h, a)}
      <div class="sheet-actions">
        <button class="btn btn-primary btn-block" data-act="save-sheet">Speichern</button>
        ${isPlayed(m) ? '<button class="btn btn-danger btn-block" data-act="clear-sheet">Ergebnis löschen</button>' : ''}
      </div>`;
  } else if (s.type === 'menu') {
    inner = `
      <h2 class="sheet-title">${esc(t.name)}</h2>
      <p class="sheet-sub">${t.players.length} Spieler · ${t.groups.length > 1 ? `${t.groups.length} Gruppen` : 'Jeder gegen jeden'}${t.rematch ? ' · mit Rückspiel' : ''}</p>
      <div class="sheet-actions" style="margin-top:14px">
        <button class="menu-item" data-act="rematch-t"><span class="mi-ico">🔁</span><span>Revanche<small>Neues Turnier mit gleichen Spielern & Einstellungen</small></span></button>
        <button class="menu-item" data-act="rename-t"><span class="mi-ico">✏️</span><span>Umbenennen</span></button>
        <button class="menu-item danger" data-act="del-current"><span class="mi-ico">🗑️</span><span>Turnier löschen</span></button>
      </div>`;
  }
  root.innerHTML = `<div class="sheet-backdrop" data-act="close-sheet"><div class="sheet" data-act="noop"><div class="sheet-grip"></div>${inner}</div></div>`;
  if (s.type === 'edit') updateScoreUI('sheet');
}

/* ----- Toast ----- */
function clearToast() {
  clearTimeout(ui.toastTimer);
  $('#toast-root').innerHTML = '';
  ui.toastAction = null;
}
function toast(msg, action) {
  const root = $('#toast-root');
  clearTimeout(ui.toastTimer);
  root.innerHTML = `<div class="toast">${esc(msg)}${action ? `<button data-act="toast-action">${esc(action.label)}</button>` : ''}</div>`;
  ui.toastAction = action ? action.fn : null;
  ui.toastTimer = setTimeout(() => { root.innerHTML = ''; ui.toastAction = null; }, action ? 5000 : 2200);
}

/* ---------------------------------------------------------------------
   Ergebnis-Eingabe
   --------------------------------------------------------------------- */
function scopeMatch(scope) {
  const t = currentT();
  const s = ui.scores[scope];
  if (!t || !s) return {};
  return { t, s, m: t.matches.find((x) => x.id === s.mid) };
}

function updateScoreUI(scope, bumpSide) {
  const { s, m } = scopeMatch(scope);
  if (!s || !m) return;
  const nh = $(`[data-num="${scope}-h"]`);
  const na = $(`[data-num="${scope}-a"]`);
  if (!nh || !na) return;
  nh.textContent = s.h;
  na.textContent = s.a;
  if (bumpSide) {
    const el = bumpSide === 'h' ? nh : na;
    el.classList.remove('bump');
    void el.offsetWidth;
    el.classList.add('bump');
  }
  const pen = $(`[data-pen="${scope}"]`);
  if (pen) {
    const draw = s.h === s.a;
    pen.hidden = !draw;
    if (!draw) s.pen = null;
    pen.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.side === s.pen));
  }
}

function commitResult(t, m, s) {
  if (m.ko && s.h === s.a && !s.pen) {
    const pen = $(`[data-pen]:not([hidden])`);
    if (pen) { pen.classList.remove('shake'); void pen.offsetWidth; pen.classList.add('shake'); }
    toast('Bitte den Elfmeter-Sieger wählen');
    return false;
  }
  const prev = { hg: m.hg, ag: m.ag, pen: m.pen, playedAt: m.playedAt };
  m.hg = s.h;
  m.ag = s.a;
  m.pen = m.ko && s.h === s.a ? s.pen : null;
  m.playedAt = Date.now();
  save();
  if (navigator.vibrate) navigator.vibrate(25);
  toast('Ergebnis gespeichert ✓', {
    label: 'Rückgängig',
    fn: () => { Object.assign(m, prev); save(); ui.scores.live = { mid: m.id, h: s.h, a: s.a, pen: s.pen }; render(); }
  });
  return true;
}

/* ---------------------------------------------------------------------
   Aktionen
   --------------------------------------------------------------------- */
const actions = {
  noop() {},
  home() { ui.sheet = null; go('#/'); },
  new() { ui.draft = newDraft(); go('#/neu'); },
  open(el) { go(`#/t/${el.dataset.id}`); },
  'del-t'(el, e) {
    e.stopPropagation();
    const t = db.tournaments.find((x) => x.id === el.dataset.id);
    if (t && confirm(`„${t.name}“ wirklich löschen?`)) {
      db.tournaments = db.tournaments.filter((x) => x !== t);
      save();
      render();
    }
  },

  /* Setup */
  'add-player'() {
    const input = $('#player-input');
    if (addPlayer(input.value)) { render(); }
    const again = $('#player-input');
    if (again) again.focus();
  },
  'rm-player'(el) {
    const d = ui.draft;
    d.players = d.players.filter((p) => p.id !== el.dataset.id);
    d.order = d.order.filter((id) => id !== el.dataset.id);
    render();
  },
  'quick-add'(el) { if (addPlayer(el.dataset.name)) render(); },
  'set-format'(el) { ui.draft.format = el.dataset.v; render(); },
  'toggle-rematch'() { ui.draft.rematch = !ui.draft.rematch; render(); },
  'set-groups'(el) { ui.draft.groupCount = +el.dataset.v; render(); },
  shuffle() { ui.draft.order = shuffle(ui.draft.order); render(); },
  'set-finals'(el) {
    if (ui.draft.format === 'groups') ui.draft.finalsGroups = el.dataset.v; else ui.draft.finalsLeague = el.dataset.v;
    render();
  },
  'set-ko'(el) { ui.draft.koSize = +el.dataset.v; render(); },
  start() {
    const d = ui.draft;
    if (!canStart(d)) return;
    normalizeDraft(d);
    const t = createTournament(d);
    db.tournaments.push(t);
    rememberPlayers(d.players.map((p) => p.name));
    save();
    ui.draft = null;
    ui.scores = {};
    go(`#/t/${t.id}`, true);
    window.scrollTo(0, 0);
  },

  /* Turnier */
  tab(el) {
    const t = currentT();
    if (!t) return;
    go(`#/t/${t.id}/${el.dataset.v}`, true);
    window.scrollTo(0, 0);
  },
  inc(el) { const s = ui.scores[el.dataset.scope]; if (!s) return; s[el.dataset.side] = Math.min(s[el.dataset.side] + 1, 99); updateScoreUI(el.dataset.scope, el.dataset.side); },
  dec(el) { const s = ui.scores[el.dataset.scope]; if (!s) return; s[el.dataset.side] = Math.max(s[el.dataset.side] - 1, 0); updateScoreUI(el.dataset.scope, el.dataset.side); },
  pen(el) { const s = ui.scores[el.dataset.scope]; if (!s) return; s.pen = el.dataset.side; updateScoreUI(el.dataset.scope); },
  'save-live'() {
    const { t, s, m } = scopeMatch('live');
    if (!m) return;
    if (commitResult(t, m, s)) { render(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  },
  'open-match'(el) {
    const t = currentT();
    const c = analyze(t);
    const m = c.byId.get(el.dataset.id);
    if (!m) return;
    if (!isReady(m, c)) { toast('Die Paarung steht noch nicht fest'); return; }
    if (!isEditable(t, m)) { toast('Gesperrt – die nächste Runde läuft schon'); return; }
    clearToast();
    ui.scores.sheet = { mid: m.id, h: m.hg ?? 0, a: m.ag ?? 0, pen: m.pen };
    ui.sheet = { type: 'edit', mid: m.id };
    renderSheet();
  },
  'save-sheet'() {
    const { t, s, m } = scopeMatch('sheet');
    if (!m) return;
    if (commitResult(t, m, s)) { ui.sheet = null; render(); }
  },
  'clear-sheet'() {
    const { m } = scopeMatch('sheet');
    if (!m) return;
    m.hg = null; m.ag = null; m.pen = null; m.playedAt = null;
    save();
    ui.sheet = null;
    toast('Ergebnis gelöscht');
    render();
  },
  'close-sheet'() { ui.sheet = null; renderSheet(); },
  menu() { clearToast(); ui.sheet = { type: 'menu' }; renderSheet(); },
  'rename-t'() {
    const t = currentT();
    const name = prompt('Neuer Name:', t.name);
    if (name && name.trim()) { t.name = name.trim().slice(0, 40); save(); }
    ui.sheet = null;
    render();
  },
  'del-current'() {
    const t = currentT();
    if (t && confirm(`„${t.name}“ wirklich löschen?`)) {
      db.tournaments = db.tournaments.filter((x) => x !== t);
      save();
      ui.sheet = null;
      go('#/', true);
    }
  },
  'rematch-t'() {
    const t = currentT();
    if (!t) return;
    ui.draft = newDraft(t);
    ui.sheet = null;
    go('#/neu');
  },
  'toast-action'() {
    const fn = ui.toastAction;
    $('#toast-root').innerHTML = '';
    ui.toastAction = null;
    if (fn) fn();
  }
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.act];
  if (fn) fn(el, e);
});
document.addEventListener('input', (e) => {
  if (e.target.matches('[data-bind="name"]') && ui.draft) ui.draft.name = e.target.value;
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.id === 'player-input') {
    e.preventDefault();
    actions['add-player']();
  }
});
window.addEventListener('hashchange', () => { ui.sheet = null; clearToast(); render(); window.scrollTo(0, 0); });

render();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
