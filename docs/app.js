// ═══════════════════════════════════════════════════════════════════════
//  FOOS — Kevin vs Josh
//
//  The rules, in one place:
//    · A match: the winner always scores 10. The loser scores 0–9,
//      or the score can be unknown (we still count the win).
//    · A series: best of 15 → first to 8 match wins takes it.
//    · The trophy: first to 5 series.
//
//  Everything on screen is DERIVED from the match log plus a baseline
//  (the history from before the app existed). Nothing is stored twice.
// ═══════════════════════════════════════════════════════════════════════

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, signInAnonymously, onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, persistentSingleTabManager,
  doc, collection, onSnapshot, getDoc, setDoc,
  addDoc, updateDoc, deleteDoc,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyC2bOtXmNLzwJy3QsDkk1tQRBD_wMdhzcM',
  authDomain: 'foos-6ecf3.firebaseapp.com',
  projectId: 'foos-6ecf3',
  storageBucket: 'foos-6ecf3.firebasestorage.app',
  messagingSenderId: '730132593509',
  appId: '1:730132593509:web:6379dde4e6a92be09d7f8c',
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
// Offline cache: the app keeps working in the basement, then syncs.
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentSingleTabManager() }),
});

const LEAGUE = doc(db, 'leagues', 'main');
const MATCHES = collection(db, 'leagues', 'main', 'matches');

const MATCHES_TO_WIN_SERIES = 8;
const SERIES_TO_WIN_TROPHY = 5;
const SERIES_LENGTH = 15;

const PLAYERS = ['kevin', 'josh'];
const NAME = { kevin: 'Kevin', josh: 'Josh' };
const other = (p) => (p === 'kevin' ? 'josh' : 'kevin');

// ── The state of the world before the app existed ──────────────────────
// Kevin and Josh were dead even: 3 series each, and 5–5 in the series they
// were playing. Of those 10 matches only one has a score (today's), so the
// other 9 are counted here and stay off the calendar — no date, no score.
const SEED = {
  baseline: {
    series: { kevin: 3, josh: 3 },   // series already won
    matches: { kevin: 4, josh: 5 },  // undated, unscored matches in the current series
  },
};
const SEED_MATCH = { date: '2026-07-14', winner: 'kevin', loserGoals: 7, seq: 1 };

// ═══════════════════════════════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════════════════════════════

let baseline = SEED.baseline;
let matches = [];            // [{id, date|null, winner, loserGoals|null, seq}]
let view = null;             // derived
let calMonth = null;         // {y, m} being shown on the calendar
let ready = false;

// ═══════════════════════════════════════════════════════════════════════
//  DERIVE — walk the match log and replay the league
// ═══════════════════════════════════════════════════════════════════════

function sortMatches(list) {
  return [...list].sort((a, b) => {
    // Undated matches (the pre-app ones) always come first.
    if (!a.date && b.date) return -1;
    if (a.date && !b.date) return 1;
    if (a.date !== b.date) return (a.date || '') < (b.date || '') ? -1 : 1;
    return (a.seq || 0) - (b.seq || 0);
  });
}

function derive() {
  const series = { ...baseline.series };
  let cur = { ...baseline.matches };
  let track = [
    ...Array(baseline.matches.kevin).fill('kevin'),
    ...Array(baseline.matches.josh).fill('josh'),
  ];
  let champion = null;

  for (const m of sortMatches(matches)) {
    cur[m.winner]++;
    track.push(m.winner);
    if (cur[m.winner] >= MATCHES_TO_WIN_SERIES) {
      series[m.winner]++;
      if (series[m.winner] >= SERIES_TO_WIN_TROPHY && !champion) champion = m.winner;
      cur = { kevin: 0, josh: 0 };
      track = [];
    }
  }

  return {
    series,
    cur,
    track,
    seriesNo: series.kevin + series.josh + 1,
    champion,
  };
}

// ── Per-player stats ──────────────────────────────────────────────────
function statsFor(who) {
  const opp = other(who);
  const s = {
    won: baseline.matches[who],       // the 9 pre-app matches count for the record...
    lost: baseline.matches[opp],
    scored: 0, allowed: 0, known: 0,  // ...but never for the goal stats
    shutoutsThrown: 0, shutoutsSuffered: 0, nailbiters: 0,
    allowedInWins: 0, winsKnown: 0,
    bestMargin: null,
    seq: [],
  };

  for (const m of sortMatches(matches)) {
    const won = m.winner === who;
    if (won) s.won++; else s.lost++;
    s.seq.push(won ? 'W' : 'L');

    if (m.loserGoals == null) continue; // no score → sits out of every goal stat
    s.known++;

    if (won) {
      s.scored += 10;
      s.allowed += m.loserGoals;
      s.allowedInWins += m.loserGoals;
      s.winsKnown++;
      if (m.loserGoals === 0) s.shutoutsThrown++;
      if (m.loserGoals === 9) s.nailbiters++;
      const margin = 10 - m.loserGoals;
      if (s.bestMargin == null || margin > s.bestMargin) s.bestMargin = margin;
    } else {
      s.scored += m.loserGoals;
      s.allowed += 10;
      if (m.loserGoals === 0) s.shutoutsSuffered++;
    }
  }

  const total = s.won + s.lost;
  s.winPct = total ? (s.won / total) * 100 : 0;
  s.diff = s.scored - s.allowed;
  s.avgMargin = s.known ? s.diff / s.known : 0;
  s.allowedPerWin = s.winsKnown ? s.allowedInWins / s.winsKnown : null;
  s.series = view ? view.series[who] : baseline.series[who];

  // streaks, from logged matches only — the pre-app ones have no order
  let curStreak = 0, curKind = null;
  for (let i = s.seq.length - 1; i >= 0; i--) {
    if (curKind == null) { curKind = s.seq[i]; curStreak = 1; }
    else if (s.seq[i] === curKind) curStreak++;
    else break;
  }
  s.streak = curKind ? `${curKind}${curStreak}` : '—';

  let best = 0, run = 0;
  for (const r of s.seq) {
    if (r === 'W') { run++; best = Math.max(best, run); } else run = 0;
  }
  s.longest = best ? `W${best}` : '—';

  return s;
}

// ═══════════════════════════════════════════════════════════════════════
//  BITS
// ═══════════════════════════════════════════════════════════════════════

const $ = (id) => document.getElementById(id);

function man(who, w = 46) {
  const h = Math.round((w / 46) * 58);
  const body = who === 'kevin' ? '#E23A2E' : '#2A7FE8';
  const leg = who === 'kevin' ? '#C22C22' : '#1E62BE';
  const dark = who === 'kevin' ? '#7C1710' : '#0E3A70';
  return `<svg width="${w}" height="${h}" viewBox="0 0 46 58" aria-hidden="true">
    <rect x="0" y="15" width="46" height="7" rx="3.5" fill="#C9CDD2"/>
    <circle cx="23" cy="11" r="7" fill="${body}"/>
    <circle cx="20.4" cy="10" r="1.5" fill="${dark}"/>
    <path d="M15 19h16l3 17H12l3-17Z" fill="${body}"/>
    <path d="M15 36h6l-2 20h-7l3-20Z" fill="${leg}"/>
    <path d="M31 36h-6l2 20h7l-3-20Z" fill="${leg}"/>
    <rect x="9" y="53" width="10" height="5" rx="2" fill="${dark}"/>
    <rect x="27" y="53" width="10" height="5" rx="2" fill="${dark}"/>
  </svg>`;
}

const CUP = `<svg viewBox="0 0 24 24"><path d="M7 3h10v2h3v3a4 4 0 0 1-4 4h-.6A4 4 0 0 1 13 14.9V17h3v3H8v-3h3v-2.1A4 4 0 0 1 8.6 12H8a4 4 0 0 1-4-4V5h3V3Z"/></svg>`;

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric',
  });
}

function toast(msg) {
  const old = $('toast');
  if (old) old.remove();
  const t = document.createElement('div');
  t.id = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2200);
}

function showError(msg) {
  const e = $('err');
  e.textContent = msg;
  e.classList.remove('hidden');
}

function buzz(ms = 12) {
  if (navigator.vibrate) navigator.vibrate(ms);
}

// ═══════════════════════════════════════════════════════════════════════
//  RENDER — HOME
// ═══════════════════════════════════════════════════════════════════════

function renderHome() {
  const v = view;

  for (const p of PLAYERS) {
    const wonSeries = v.series[p];
    $(`cups-${p}`).innerHTML = Array.from({ length: SERIES_TO_WIN_TROPHY }, (_, i) =>
      `<span class="cup ${i < wonSeries ? `on ${p}` : ''}">${CUP}</span>`).join('');
    $(`tally-${p}`).textContent = `${wonSeries}/${SERIES_TO_WIN_TROPHY}`;
  }

  $('champ').innerHTML = v.champion
    ? `<div class="champ">🏆 ${NAME[v.champion]} takes the trophy</div>`
    : '';

  $('series-no').textContent = `Series ${v.seriesNo}`;
  $('home-pill').textContent = `Series ${v.seriesNo}`;
  $('cur-kevin').textContent = v.cur.kevin;
  $('cur-josh').textContent = v.cur.josh;

  const played = v.cur.kevin + v.cur.josh;
  $('track').innerHTML = Array.from({ length: SERIES_LENGTH }, (_, i) =>
    `<span class="pip ${v.track[i] || ''}"></span>`).join('');

  $('played').textContent = `${played} played`;
  const leader = v.cur.kevin === v.cur.josh ? null
    : (v.cur.kevin > v.cur.josh ? 'kevin' : 'josh');
  if (leader) {
    const need = MATCHES_TO_WIN_SERIES - v.cur[leader];
    $('tocome').textContent = `${NAME[leader]} ${need} from the series`;
  } else {
    $('tocome').textContent = 'All square';
  }

  for (const p of PLAYERS) {
    const s = statsFor(p);
    $(`man-${p}`).innerHTML = man(p, 46);
    $(`rec-${p}`).textContent = `${s.won}–${s.lost}`;
    $(`streak-${p}`).textContent = s.streak === '—' ? '—' : `${s.streak} streak`;
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  RENDER — PLAYER SHEETS
// ═══════════════════════════════════════════════════════════════════════

function renderPlayer(p) {
  const s = statsFor(p);
  $(`bigman-${p}`).innerHTML = man(p, 40);
  $(`head-${p}`).textContent =
    `${s.won}–${s.lost} · ${s.winPct.toFixed(1)}% · ${s.series} series`;

  const last10 = s.seq.slice(-10);
  const form = last10.length
    ? `<div class="panel" style="padding:10px">
         <div class="label"><span>Last ${last10.length}</span>
           <span>${last10.filter((r) => r === 'W').length}–${last10.filter((r) => r === 'L').length}</span></div>
         <div class="form">${last10.map((r) =>
           `<span class="fchip ${r === 'W' ? `w ${p}` : 'l'}">${r}</span>`).join('')}</div>
       </div>`
    : '';

  const sign = s.diff > 0 ? '+' : '';
  const cls = s.diff > 0 ? 'pos' : (s.diff < 0 ? 'neg' : '');
  const mSign = s.avgMargin > 0 ? '+' : '';

  const tiles = [
    ['Goals scored', s.scored, ''],
    ['Goals allowed', s.allowed, ''],
    ['Goal difference', `${sign}${s.diff}`, cls],
    ['Avg margin', s.known ? `${mSign}${s.avgMargin.toFixed(1)}` : '—', ''],
    ['Current streak', s.streak, ''],
    ['Longest streak', s.longest, ''],
    ['Shutouts thrown', s.shutoutsThrown, ''],
    ['Shutouts suffered', s.shutoutsSuffered, ''],
    ['10–9 nailbiters', s.nailbiters, ''],
    ['Allowed per win', s.allowedPerWin == null ? '—' : s.allowedPerWin.toFixed(1), ''],
    ['Biggest win', s.bestMargin == null ? '—' : `10–${10 - s.bestMargin}`, ''],
    ['Series won', s.series, ''],
  ];

  const total = s.won + s.lost;
  const missing = total - s.known;

  $(`stats-${p}`).innerHTML = `
    ${form}
    <div class="sgrid">
      ${tiles.map(([k, v, c]) =>
        `<div class="stat"><div class="v ${c}">${v}</div><div class="k">${k}</div></div>`).join('')}
    </div>
    <div class="panel" style="padding:9px 11px">
      <div class="label" style="letter-spacing:.12em">
        <span>Goal stats from ${s.known} of ${total} matches</span>
        ${missing ? `<span style="color:var(--ball)">${missing} ?</span>` : ''}
      </div>
    </div>
    <div class="footer"></div>`;
}

// ═══════════════════════════════════════════════════════════════════════
//  RENDER — CALENDAR
// ═══════════════════════════════════════════════════════════════════════

function matchesByDate() {
  const map = new Map();
  for (const m of matches) {
    if (!m.date) continue; // pre-app matches have no day to live on
    if (!map.has(m.date)) map.set(m.date, []);
    map.get(m.date).push(m);
  }
  for (const list of map.values()) list.sort((a, b) => (a.seq || 0) - (b.seq || 0));
  return map;
}

function renderCal() {
  const { y, m } = calMonth;
  const byDate = matchesByDate();

  $('cal-month').textContent =
    new Date(y, m, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  const first = new Date(y, m, 1).getDay();
  const days = new Date(y, m + 1, 0).getDate();
  const today = todayISO();

  let kMonth = 0, jMonth = 0;
  const cells = [];

  for (let i = 0; i < first; i++) cells.push('<button class="day blank"></button>');

  for (let d = 1; d <= days; d++) {
    const iso = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const list = byDate.get(iso) || [];
    const k = list.filter((x) => x.winner === 'kevin').length;
    const j = list.length - k;
    kMonth += k; jMonth += j;

    let fill = '';
    if (list.length) {
      if (j === 0) fill = 'linear-gradient(180deg,#E23A2E,#A82419)';
      else if (k === 0) fill = 'linear-gradient(180deg,#2A7FE8,#14509C)';
      else {
        const pct = (k / list.length) * 100;
        fill = `linear-gradient(180deg,#E23A2E 0 ${pct}%,#2A7FE8 ${pct}% 100%)`;
      }
    }

    const unscored = list.some((x) => x.loserGoals == null);

    cells.push(`<button class="day ${list.length ? 'has' : ''} ${iso === today ? 'today' : ''}" data-date="${iso}">
      ${fill ? `<span class="fill" style="background:${fill}"></span>` : ''}
      <span class="n">${d}</span>
      ${unscored ? '<span class="qm">?</span>' : ''}
    </button>`);
  }

  $('cal-grid').innerHTML = cells.join('');
  $('cal-tally').innerHTML = kMonth + jMonth
    ? `<span class="kevin">Kevin ${kMonth}</span><span class="sep">—</span><span class="josh">${jMonth} Josh</span>`
    : `<span class="sep">No matches this month</span>`;

  $('cal-grid').querySelectorAll('.day[data-date]').forEach((el) => {
    el.onclick = () => openDay(el.dataset.date);
  });
}

// ═══════════════════════════════════════════════════════════════════════
//  SHEETS
// ═══════════════════════════════════════════════════════════════════════

let sheetOpen = false;

function openSheet(html) {
  const root = $('sheet-root');
  root.innerHTML = `<div class="scrim"><div class="sheet">${html}</div></div>`;
  const scrim = root.querySelector('.scrim');
  scrim.onclick = (e) => { if (e.target === scrim) closeSheet(); };
  if (!sheetOpen) {
    sheetOpen = true;
    history.pushState({ sheet: true }, ''); // so Android Back closes the sheet
  }
  return root.querySelector('.sheet');
}

function closeSheet() {
  if (sheetOpen) {
    sheetOpen = false;
    history.back();
  }
  $('sheet-root').innerHTML = '';
}

window.addEventListener('popstate', () => {
  if (sheetOpen) {
    sheetOpen = false;
    $('sheet-root').innerHTML = '';
  }
});

// ── Log / edit a match ────────────────────────────────────────────────
// `existing` = null to add a new match, or a match object to edit it.
function openMatchSheet(existing, presetDate) {
  const isEdit = !!existing;
  const st = {
    date: existing?.date || presetDate || todayISO(),
    winner: existing?.winner || null,
    // undefined = nothing picked yet · null = "don't know" · 0..9 = the score
    goals: isEdit ? (existing.loserGoals == null ? null : existing.loserGoals) : undefined,
  };

  const sheet = openSheet(`
    <div class="grab"></div>
    <div class="sheethead">
      <h2 class="q">${isEdit ? 'Fix this match' : 'Who won?'}</h2>
      <div class="qsub" id="ms-sub"></div>
    </div>
    <div class="sheetbody">
      <div class="daterow">
        <span class="dl">Played on</span>
        <span class="dv" id="ms-datetext"></span>
        <input type="date" id="ms-date" value="${st.date}">
      </div>
      <div class="winpick">
        ${PLAYERS.map((p) => `
          <button class="winbtn ${p}" data-win="${p}">
            ${man(p, 30)}
            ${NAME[p]}
          </button>`).join('')}
      </div>
      <div id="ms-score"></div>
    </div>
    <div class="sheetfoot">
      <button class="cta" id="ms-save">Save</button>
      ${isEdit ? '<button class="cta danger" id="ms-del">Delete this match</button>' : ''}
      <button class="cta ghost" id="ms-cancel">Cancel</button>
    </div>
  `);

  const paint = () => {
    sheet.querySelector('#ms-sub').textContent =
      isEdit ? fmtDate(st.date) : `Series ${view.seriesNo} · Match ${view.cur.kevin + view.cur.josh + 1}`;
    sheet.querySelector('#ms-datetext').innerHTML =
      `<svg width="13" height="13" viewBox="0 0 24 24" fill="#F2E9C8"><path d="M7 2v2h10V2h2v2h3v18H2V4h3V2h2ZM4 10v10h16V10H4Z"/></svg> ${fmtDate(st.date)} ›`;

    sheet.querySelectorAll('[data-win]').forEach((b) => {
      b.classList.toggle('sel', b.dataset.win === st.winner);
    });

    const box = sheet.querySelector('#ms-score');
    if (!st.winner) {
      box.innerHTML = '';
    } else {
      const loser = other(st.winner);
      box.innerHTML = `
        <div class="autoscore ${st.winner}">
          <div class="big">10</div>
          <div class="cap">${NAME[st.winner]} — winner, always 10</div>
        </div>
        <div style="margin-top:11px">
          <div class="label"><span>${NAME[loser]}'s goals</span><span>0–9</span></div>
          <div class="gg">
            ${Array.from({ length: 10 }, (_, n) =>
              `<button class="gnum ${st.goals === n ? `sel ${loser}` : ''}" data-g="${n}">${n}</button>`).join('')}
            <button class="dunno ${st.goals === null ? 'sel' : ''}" data-g="null">Don't know the score</button>
          </div>
        </div>`;

      box.querySelectorAll('[data-g]').forEach((b) => {
        b.onclick = () => {
          st.goals = b.dataset.g === 'null' ? null : Number(b.dataset.g);
          buzz();
          paint();
        };
      });
    }

    const save = sheet.querySelector('#ms-save');
    const done = st.winner && st.goals !== undefined;
    save.disabled = !done;
    save.textContent = !st.winner ? 'Pick a winner'
      : st.goals === undefined ? 'Pick a score'
      : st.goals === null ? 'Save the win (no score)'
      : `Save 10 – ${st.goals}`;
  };

  sheet.querySelectorAll('[data-win]').forEach((b) => {
    b.onclick = () => { st.winner = b.dataset.win; buzz(); paint(); };
  });
  sheet.querySelector('#ms-date').onchange = (e) => {
    if (e.target.value) { st.date = e.target.value; paint(); }
  };
  sheet.querySelector('#ms-cancel').onclick = closeSheet;

  sheet.querySelector('#ms-save').onclick = async () => {
    if (!st.winner || st.goals === undefined) return;
    const data = { date: st.date, winner: st.winner, loserGoals: st.goals };
    closeSheet();
    try {
      if (isEdit) {
        await updateDoc(doc(MATCHES, existing.id), data);
        toast('Match updated');
      } else {
        await addDoc(MATCHES, { ...data, seq: Date.now() });
        buzz(30);
        toast(`${NAME[st.winner]} takes it`);
      }
    } catch (e) {
      showError(`Could not save: ${e.message}`);
    }
  };

  if (isEdit) {
    sheet.querySelector('#ms-del').onclick = async () => {
      closeSheet();
      try {
        await deleteDoc(doc(MATCHES, existing.id));
        toast('Match deleted');
      } catch (e) {
        showError(`Could not delete: ${e.message}`);
      }
    };
  }

  paint();
}

// ── A day on the calendar ─────────────────────────────────────────────
function openDay(iso) {
  const list = (matchesByDate().get(iso) || []);
  const k = list.filter((m) => m.winner === 'kevin').length;
  const j = list.length - k;

  const rows = list.length ? list.map((m) => {
    const loser = other(m.winner);
    const score = m.loserGoals == null
      ? `10 — <span class="qmark">?</span>`
      : `10 — ${m.loserGoals}`;
    return `<button class="mrow ${m.loserGoals == null ? 'warn' : ''}" data-id="${m.id}">
      <span class="badge ${m.winner}"></span>
      <span class="mid">
        <span class="mt"><span class="w ${m.winner}">${NAME[m.winner]}</span> ${score} ${NAME[loser]}</span>
        <span class="ms">${m.loserGoals == null ? 'Tap to add the score' : 'Tap to fix'}</span>
      </span>
      <span class="chev">›</span>
    </button>`;
  }).join('') : '<div class="empty">No matches this day</div>';

  const sheet = openSheet(`
    <div class="grab"></div>
    <div class="sheethead left" style="padding-left:18px">
      <h2 class="q" style="color:var(--ball)">${fmtDate(iso)}</h2>
      <div class="qsub">${list.length
        ? `${list.length} match${list.length > 1 ? 'es' : ''} · Kevin ${k} — ${j} Josh`
        : 'Nothing played yet'}</div>
    </div>
    <div class="sheetbody">${rows}</div>
    <div class="sheetfoot">
      <button class="cta" id="day-add">+ Add a match on this day</button>
      <button class="cta ghost" id="day-close">Close</button>
    </div>
  `);

  sheet.querySelectorAll('.mrow[data-id]').forEach((el) => {
    el.onclick = () => {
      const m = matches.find((x) => x.id === el.dataset.id);
      if (m) { closeSheet(); setTimeout(() => openMatchSheet(m), 60); }
    };
  });
  sheet.querySelector('#day-add').onclick = () => {
    closeSheet();
    setTimeout(() => openMatchSheet(null, iso), 60);
  };
  sheet.querySelector('#day-close').onclick = closeSheet;
}

// ═══════════════════════════════════════════════════════════════════════
//  PAGER
// ═══════════════════════════════════════════════════════════════════════

const pager = $('pager');
const dots = $('dots').querySelectorAll('.dot');

function goTo(i, smooth = true) {
  pager.scrollTo({ left: i * pager.clientWidth, behavior: smooth ? 'smooth' : 'auto' });
}

pager.addEventListener('scroll', () => {
  const i = Math.round(pager.scrollLeft / pager.clientWidth);
  dots.forEach((d, n) => d.classList.toggle('on', n === i));
}, { passive: true });

document.querySelectorAll('[data-goto]').forEach((el) => {
  el.onclick = () => goTo(Number(el.dataset.goto));
});

$('btn-log').onclick = () => openMatchSheet(null);
$('cal-prev').onclick = () => {
  calMonth = { y: calMonth.m === 0 ? calMonth.y - 1 : calMonth.y, m: (calMonth.m + 11) % 12 };
  renderCal();
};
$('cal-next').onclick = () => {
  calMonth = { y: calMonth.m === 11 ? calMonth.y + 1 : calMonth.y, m: (calMonth.m + 1) % 12 };
  renderCal();
};

// Home is the landing page, not the calendar. Jump there before first paint.
function landOnHome() {
  goTo(1, false);
}
window.addEventListener('resize', () => {
  const i = [...dots].findIndex((d) => d.classList.contains('on'));
  goTo(i < 0 ? 1 : i, false);
});

// ═══════════════════════════════════════════════════════════════════════
//  RENDER ALL
// ═══════════════════════════════════════════════════════════════════════

function renderAll() {
  view = derive();
  renderHome();
  renderPlayer('kevin');
  renderPlayer('josh');
  renderCal();

  if (!ready) {
    ready = true;
    landOnHome();
    requestAnimationFrame(() => {
      landOnHome();
      $('boot').classList.add('gone');
      setTimeout(() => $('boot').remove(), 400);
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  BOOT — sign in, seed once, then listen
// ═══════════════════════════════════════════════════════════════════════

async function seedIfNeeded() {
  const snap = await getDoc(LEAGUE);
  if (snap.exists()) return;
  // First ever run: write the state Kevin gave us — 3–3 on series, 5–5 in
  // the current one, and today's 10–7. Never runs again.
  await setDoc(LEAGUE, SEED);
  await addDoc(MATCHES, SEED_MATCH);
}

function listen() {
  onSnapshot(LEAGUE, (snap) => {
    if (snap.exists() && snap.data().baseline) baseline = snap.data().baseline;
    renderAll();
  }, (e) => showError(`Sync problem: ${e.message}`));

  onSnapshot(MATCHES, (snap) => {
    matches = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderAll();
  }, (e) => showError(`Sync problem: ${e.message}`));
}

const now = new Date();
calMonth = { y: now.getFullYear(), m: now.getMonth() };

onAuthStateChanged(auth, async (user) => {
  if (!user) return;
  try {
    await seedIfNeeded();
    listen();
  } catch (e) {
    showError(`Could not load the league: ${e.message}`);
    $('boot').classList.add('gone');
  }
});

signInAnonymously(auth).catch((e) => {
  showError(`Could not sign in: ${e.message}`);
  $('boot').classList.add('gone');
});
