// ═══════════════════════════════════════════════════════════
//  Squad Fitness Tracker — app.js
// ═══════════════════════════════════════════════════════════

import { db } from './firebase-config.js';
import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc,
  onSnapshot, serverTimestamp, query, orderBy, addDoc, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ── Constants ────────────────────────────────────────────────
const GOAL = 500;

const MEMBERS = [
  { id: 'alex',   name: 'Alex',   initials: 'AX', device: 'Android + Garmin',    colorVar: '--yellow' },
  { id: 'sam',    name: 'Sam',    initials: 'SM', device: 'iPhone + Apple Watch', colorVar: '--teal'   },
  { id: 'jordan', name: 'Jordan', initials: 'JD', device: 'iPhone + Fitbit',      colorVar: '--purple' },
];
const MEMBER_COLORS = ['var(--yellow)', 'var(--teal)', 'var(--purple)'];
const MEMBER_BG     = ['#3a2a1a', '#1a3a2a', '#2a1a3a'];
const RANK_COLORS   = ['#ffd700', '#c0c0c0', '#cd7f32'];

// ── State ────────────────────────────────────────────────────
let weekData   = {};   // { [memberId]: { minutes, streak, bestStreak } }
let allHistory = [];   // array of week docs
let allLogs    = [];   // array of log entries
let historyChart = null;
let unsubscribeWeek = null;
let unsubscribeLogs = null;

// ── Week helpers ──────────────────────────────────────────────
function getWeekKey(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD of Monday
}

function formatWeekRange(weekKey) {
  const mon = new Date(weekKey + 'T00:00:00');
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  const fmt = d => d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
  return `${fmt(mon)} – ${fmt(sun)}`;
}

function getPaceTarget() {
  const day = new Date().getDay();
  const elapsed = day === 0 ? 7 : day;
  return Math.round((elapsed / 7) * GOAL);
}

function getPaceClass(mins) {
  if (mins >= GOAL) return 'done';
  const r = mins / getPaceTarget();
  if (r >= 0.9) return 'on-pace';
  if (r >= 0.55) return 'behind';
  return 'way-behind';
}

function getPaceLabel(mins) {
  if (mins >= GOAL) return 'goal reached! 🎉';
  const diff = getPaceTarget() - mins;
  if (diff <= 0) return 'on pace ✓';
  return `${diff} min behind pace`;
}

function timeAgo(ts) {
  if (!ts) return '';
  const date = ts.toDate ? ts.toDate() : new Date(ts);
  const diff = Math.floor((Date.now() - date) / 1000);
  if (diff < 60)    return 'just now';
  if (diff < 3600)  return `${Math.floor(diff/60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
  return date.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
}

// ── Firebase: init week doc ───────────────────────────────────
async function ensureWeekDoc(weekKey) {
  const ref = doc(db, 'weeks', weekKey);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    const init = {};
    MEMBERS.forEach(m => {
      init[m.id] = { minutes: 0, streak: 0, bestStreak: 0 };
    });
    await setDoc(ref, { weekKey, createdAt: serverTimestamp(), members: init });
  }
}

// ── Firebase: subscribe to current week ───────────────────────
function subscribeWeek(weekKey) {
  if (unsubscribeWeek) unsubscribeWeek();
  const ref = doc(db, 'weeks', weekKey);
  unsubscribeWeek = onSnapshot(ref, snap => {
    if (snap.exists()) {
      weekData = snap.data().members || {};
    } else {
      MEMBERS.forEach(m => { weekData[m.id] = { minutes: 0, streak: 0, bestStreak: 0 }; });
    }
    renderSquad();
    renderLeaderboard();
    setStatus(true);
  }, err => {
    console.error(err);
    setStatus(false);
  });
}

// ── Firebase: subscribe to logs ───────────────────────────────
function subscribeLogs() {
  if (unsubscribeLogs) unsubscribeLogs();
  const q = query(collection(db, 'logs'), orderBy('loggedAt', 'desc'));
  unsubscribeLogs = onSnapshot(q, snap => {
    allLogs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderFeed();
  }, err => console.error(err));
}

// ── Firebase: load history ────────────────────────────────────
async function loadHistory() {
  const q = query(collection(db, 'weeks'), orderBy('weekKey', 'desc'));
  const snap = await getDocs(q);
  allHistory = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderHistory();
  renderRecords();
}

// ── Log workout ───────────────────────────────────────────────
window.logWorkout = async function() {
  const who      = parseInt(document.getElementById('log-who').value);
  const activity = document.getElementById('log-activity').value;
  const mins     = parseInt(document.getElementById('log-mins').value) || 0;
  const dateVal  = document.getElementById('log-date').value;

  if (mins <= 0 || mins > 600) { showToast('Enter 1–600 minutes', true); return; }

  const btn = document.getElementById('log-btn');
  btn.disabled = true; btn.textContent = 'saving...';

  try {
    const weekKey = getWeekKey();
    const member  = MEMBERS[who];
    const current = weekData[member.id] || { minutes: 0, streak: 0, bestStreak: 0 };
    const newMins = Math.min(current.minutes + mins, 1000);

    // Update streak: simple day-based check
    const today = new Date().toISOString().slice(0, 10);
    const newStreak = current.streak + 1;
    const newBest   = Math.max(current.bestStreak || 0, newStreak);

    // Update week doc
    const weekRef = doc(db, 'weeks', weekKey);
    await updateDoc(weekRef, {
      [`members.${member.id}.minutes`]:    newMins,
      [`members.${member.id}.streak`]:     newStreak,
      [`members.${member.id}.bestStreak`]: newBest,
      [`members.${member.id}.lastLogDate`]: today,
    });

    // Add log entry
    await addDoc(collection(db, 'logs'), {
      who:      who,
      memberId: member.id,
      name:     member.name,
      activity: activity,
      mins:     mins,
      weekKey:  weekKey,
      loggedAt: serverTimestamp(),
      logDate:  dateVal || today,
    });

    document.getElementById('log-mins').value = 30;
    document.getElementById('log-date').value = '';
    showToast(`+${mins} min for ${member.name}!`);
    await loadHistory();

  } catch(err) {
    console.error(err);
    showToast('Error saving — check your Firebase config', true);
  } finally {
    btn.disabled = false; btn.textContent = '+ log it';
  }
};

// ── Render: squad cards ───────────────────────────────────────
function renderSquad() {
  const pace = getPaceTarget();
  const sorted = MEMBERS.map((m, i) => ({
    ...m, idx: i,
    mins: (weekData[m.id] || {}).minutes || 0,
    streak: (weekData[m.id] || {}).streak || 0,
  })).sort((a, b) => b.mins - a.mins);
  const rankOf = {}; sorted.forEach((m, r) => rankOf[m.idx] = r);

  document.getElementById('squad-grid').innerHTML = MEMBERS.map((m, i) => {
    const mins  = (weekData[m.id] || {}).minutes || 0;
    const streak= (weekData[m.id] || {}).streak  || 0;
    const cls   = getPaceClass(mins);
    const pct   = Math.min(Math.round((mins / GOAL) * 100), 100);
    const rank  = rankOf[i];
    const rankEmoji = ['🥇','🥈','🥉'][rank] || '';

    return `
    <div class="member-card ${cls}">
      <div class="rank-badge">${rankEmoji}</div>
      <div class="member-top">
        <div class="avatar av-${i}">${m.initials}</div>
        <div class="member-meta">
          <div class="name">${m.name}</div>
          <div class="device">${m.device}</div>
        </div>
      </div>
      <div class="minutes-big">${mins}<span class="goal"> / ${GOAL}</span></div>
      <div class="prog-wrap"><div class="prog-fill" style="width:${pct}%"></div></div>
      <div class="pace-row">
        <span class="pace-tag">${getPaceLabel(mins)}</span>
        <span class="streak-tag">${streak > 0 ? `🔥 ${streak}d` : '—'}</span>
      </div>
    </div>`;
  }).join('');
}

// ── Render: leaderboard ───────────────────────────────────────
function renderLeaderboard() {
  const sorted = MEMBERS.map((m, i) => ({
    ...m, idx: i, mins: (weekData[m.id] || {}).minutes || 0
  })).sort((a, b) => b.mins - a.mins);

  document.getElementById('leaderboard').innerHTML =
    `<div class="lb-header">rank · standings</div>` +
    sorted.map((m, rank) => {
      const pct = Math.min(Math.round((m.mins / GOAL) * 100), 100);
      const col = RANK_COLORS[rank] || 'var(--teal)';
      return `
      <div class="lb-row">
        <div class="lb-rank ${['r1','r2','r3'][rank] || ''}">${rank+1}</div>
        <div class="avatar av-${m.idx}" style="width:30px;height:30px;font-size:10px;flex-shrink:0">${m.initials}</div>
        <div class="lb-info">
          <div class="lb-name">${m.name}</div>
          <div class="lb-sub">${m.device}</div>
        </div>
        <div class="lb-bar-wrap"><div class="lb-bar" style="width:${pct}%;background:${col}"></div></div>
        <div class="lb-right">
          <div class="lb-mins" style="color:${col}">${m.mins}</div>
          <div class="lb-pct">${pct}%</div>
        </div>
      </div>`;
    }).join('');
}

// ── Render: feed ──────────────────────────────────────────────
function renderFeed() {
  const panel = document.getElementById('feed-panel');
  const recent = allLogs.slice(0, 8);
  if (!recent.length) {
    panel.innerHTML = `<div class="feed-header">recent activity</div>
      <div class="empty-state"><div class="emoji">🏃</div>No workouts yet — log the first one!</div>`;
    return;
  }
  panel.innerHTML = `<div class="feed-header">recent activity</div>` +
    recent.map(log => {
      const i = log.who;
      return `
      <div class="feed-item">
        <div class="feed-av" style="background:${MEMBER_BG[i]};color:${MEMBER_COLORS[i]}">${MEMBERS[i].initials}</div>
        <div class="feed-text"><strong>${log.name}</strong> · ${log.activity}</div>
        <div class="feed-mins" style="color:${MEMBER_COLORS[i]}">+${log.mins}</div>
        <div class="feed-ago">${timeAgo(log.loggedAt)}</div>
      </div>`;
    }).join('');
}

// ── Render: history chart + table ─────────────────────────────
function renderHistory() {
  const weeks = allHistory.slice(0, 10).reverse(); // oldest → newest

  if (!weeks.length) {
    document.getElementById('history-table').innerHTML =
      `<div class="empty-state"><div class="emoji">📅</div>No history yet. Come back after a full week!</div>`;
    return;
  }

  const labels = weeks.map(w => formatWeekRange(w.weekKey));

  const datasets = MEMBERS.map((m, i) => ({
    label: m.name,
    data: weeks.map(w => (w.members?.[m.id]?.minutes || 0)),
    borderColor: MEMBER_COLORS[i],
    backgroundColor: MEMBER_COLORS[i] + '20',
    tension: 0.35,
    pointBackgroundColor: MEMBER_COLORS[i],
    pointRadius: 4,
    pointHoverRadius: 6,
    borderWidth: 2,
  }));

  const goalLine = {
    label: 'Goal (500)',
    data: weeks.map(() => GOAL),
    borderColor: 'rgba(255,255,255,0.15)',
    borderDash: [6, 4],
    borderWidth: 1,
    pointRadius: 0,
    fill: false,
  };

  if (historyChart) historyChart.destroy();
  const ctx = document.getElementById('history-chart').getContext('2d');
  historyChart = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets: [...datasets, goalLine] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1a1a1a',
          borderColor: 'rgba(255,255,255,0.1)',
          borderWidth: 1,
          titleColor: '#f0ede8',
          bodyColor: '#888',
        }
      },
      scales: {
        x: {
          ticks: { color: '#666', font: { family: 'Space Mono', size: 10 }, maxRotation: 30 },
          grid: { color: 'rgba(255,255,255,0.05)' },
        },
        y: {
          min: 0, max: 550,
          ticks: { color: '#666', font: { family: 'Space Mono', size: 11 }, stepSize: 100 },
          grid: { color: 'rgba(255,255,255,0.05)' },
        }
      }
    }
  });

  // History table
  const tbody = weeks.slice().reverse().map(w => {
    const cols = MEMBERS.map((m, i) => {
      const mins = w.members?.[m.id]?.minutes || 0;
      const cls  = mins >= GOAL ? 'goal-met' : mins >= GOAL * 0.8 ? 'goal-close' : 'goal-missed';
      return `<td class="${cls}">${mins}</td>`;
    }).join('');
    return `<tr>
      <td class="week-label-cell">${formatWeekRange(w.weekKey)}</td>
      ${cols}
    </tr>`;
  }).join('');

  document.getElementById('history-table').innerHTML = `
    <table class="history-table">
      <thead><tr>
        <th>week</th>
        ${MEMBERS.map(m => `<th>${m.name}</th>`).join('')}
      </tr></thead>
      <tbody>${tbody}</tbody>
    </table>`;
}

// ── Render: records ───────────────────────────────────────────
function renderRecords() {
  if (!allLogs.length && !allHistory.length) {
    document.getElementById('records-grid').innerHTML =
      `<div class="empty-state" style="grid-column:1/-1"><div class="emoji">🏆</div>Log some workouts to unlock records!</div>`;
    document.getElementById('activity-grid').innerHTML = '';
    document.getElementById('streak-panel').innerHTML = '';
    return;
  }

  // ── Fun fact cards ──
  const logsWithMins = allLogs.filter(l => l.mins);

  // Longest single session
  const longest = logsWithMins.reduce((best, l) => l.mins > (best?.mins||0) ? l : best, null);
  // Shortest session (> 0)
  const shortest = logsWithMins.reduce((best, l) => l.mins < (best?.mins||Infinity) ? l : best, null);

  // Most active week per person
  const weekBests = {};
  allHistory.forEach(w => {
    MEMBERS.forEach(m => {
      const mins = w.members?.[m.id]?.minutes || 0;
      if (!weekBests[m.id] || mins > weekBests[m.id].mins) {
        weekBests[m.id] = { mins, week: w.weekKey };
      }
    });
  });
  const topWeekEntry = MEMBERS.map(m => ({ ...m, ...weekBests[m.id] })).filter(x=>x.mins).sort((a,b)=>b.mins-a.mins)[0];

  // Most consistent (most goal-met weeks)
  const goalMetCounts = {};
  MEMBERS.forEach(m => goalMetCounts[m.id] = 0);
  allHistory.forEach(w => {
    MEMBERS.forEach(m => {
      if ((w.members?.[m.id]?.minutes || 0) >= GOAL) goalMetCounts[m.id]++;
    });
  });
  const mostConsistent = MEMBERS.slice().sort((a,b)=>goalMetCounts[b.id]-goalMetCounts[a.id])[0];

  // Total squad minutes all-time
  let totalSquadMins = 0;
  allHistory.forEach(w => MEMBERS.forEach(m => totalSquadMins += (w.members?.[m.id]?.minutes || 0)));
  totalSquadMins += MEMBERS.reduce((s, m) => s + ((weekData[m.id]?.minutes) || 0), 0);

  // Favourite activity per person → overall most logged
  const actCounts = {};
  allLogs.forEach(l => { actCounts[l.activity] = (actCounts[l.activity]||0) + 1; });
  const topAct = Object.entries(actCounts).sort((a,b)=>b[1]-a[1])[0];

  const cards = [
    {
      icon: '⚡',
      title: 'longest session',
      val: longest ? `${longest.mins} min` : '—',
      sub: longest ? `${longest.name} · ${longest.activity}` : '',
    },
    {
      icon: '🐢',
      title: 'shortest session',
      val: shortest ? `${shortest.mins} min` : '—',
      sub: shortest ? `${shortest.name} · ${shortest.activity}` : '',
    },
    {
      icon: '🔥',
      title: 'best single week',
      val: topWeekEntry ? `${topWeekEntry.mins} min` : '—',
      sub: topWeekEntry ? `${topWeekEntry.name} · ${formatWeekRange(topWeekEntry.week)}` : '',
    },
    {
      icon: '🎯',
      title: 'most consistent',
      val: mostConsistent ? mostConsistent.name : '—',
      sub: `${goalMetCounts[mostConsistent?.id]||0} goal weeks`,
    },
    {
      icon: '💪',
      title: 'squad total (all-time)',
      val: `${totalSquadMins.toLocaleString()}`,
      sub: 'active minutes combined',
    },
    {
      icon: '🏃',
      title: 'top activity',
      val: topAct ? topAct[0] : '—',
      sub: topAct ? `${topAct[1]} sessions logged` : '',
    },
  ];

  document.getElementById('records-grid').innerHTML = cards.map(c => `
    <div class="record-card">
      <div class="record-icon">${c.icon}</div>
      <div class="record-title">${c.title}</div>
      <div class="record-val">${c.val}</div>
      <div class="record-sub">${c.sub}</div>
    </div>`).join('');

  // ── Activity breakdown per person ──
  document.getElementById('activity-grid').innerHTML = MEMBERS.map((m, i) => {
    const memberLogs = allLogs.filter(l => l.who === i);
    const counts = {};
    memberLogs.forEach(l => counts[l.activity] = (counts[l.activity]||0) + 1);
    const sorted = Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0, 5);
    const max    = sorted[0]?.[1] || 1;

    return `
    <div class="activity-person">
      <div class="activity-person-name" style="color:${MEMBER_COLORS[i]}">${m.name}</div>
      ${sorted.length ? sorted.map(([act, cnt]) => `
        <div class="activity-row">
          <span class="activity-name">${act}</span>
          <div class="activity-bar-wrap">
            <div class="activity-bar" style="width:${Math.round((cnt/max)*100)}%;background:${MEMBER_COLORS[i]}"></div>
          </div>
          <span class="activity-count" style="color:${MEMBER_COLORS[i]}">${cnt}x</span>
        </div>`).join('') :
      `<div style="font-size:12px;color:var(--muted);font-family:var(--mono)">no workouts yet</div>`}
    </div>`;
  }).join('');

  // ── Streaks ──
  document.getElementById('streak-panel').innerHTML = MEMBERS.map((m, i) => {
    const streak     = weekData[m.id]?.streak     || 0;
    const bestStreak = weekData[m.id]?.bestStreak || streak;
    return `
    <div class="streak-row">
      <div class="avatar av-${i}" style="width:36px;height:36px;font-size:11px;flex-shrink:0">${m.initials}</div>
      <div class="streak-name">${m.name}</div>
      <div class="streak-current">
        <span class="num">${streak}</span>
        <span style="font-size:12px;color:var(--muted)"> day streak</span>
      </div>
      <div class="streak-best">best: ${bestStreak}d</div>
      <div class="streak-fire">${streak >= 7 ? '🔥🔥' : streak >= 3 ? '🔥' : '—'}</div>
    </div>`;
  }).join('');
}

// ── Tabs ──────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');

    if (btn.dataset.tab === 'history' || btn.dataset.tab === 'records') {
      loadHistory();
    }
  });
});

// ── Toast ─────────────────────────────────────────────────────
let toastTimer;
window.showToast = function(msg, isError = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show' + (isError ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
};

// ── Status indicator ──────────────────────────────────────────
function setStatus(online) {
  const el = document.getElementById('sync-status');
  el.className = 'sync-status' + (online ? '' : ' offline');
  el.innerHTML = `<span class="dot"></span> ${online ? 'live' : 'offline'}`;
}

// ── Init date input ───────────────────────────────────────────
function initDateInput() {
  const el = document.getElementById('log-date');
  el.max = new Date().toISOString().slice(0, 10);
}

// ── Boot ──────────────────────────────────────────────────────
(async () => {
  try {
    initDateInput();

    const weekKey = getWeekKey();
    document.getElementById('week-range').textContent = 'Week of ' + formatWeekRange(weekKey);
    document.getElementById('pace-target').textContent = getPaceTarget();

    await ensureWeekDoc(weekKey);
    subscribeWeek(weekKey);
    subscribeLogs();
    await loadHistory();
  } catch(err) {
    console.error('Boot error:', err);
    setStatus(false);
    showToast('Could not connect to Firebase — check your config', true);

    // Graceful offline fallback
    MEMBERS.forEach(m => { weekData[m.id] = { minutes: 0, streak: 0, bestStreak: 0 }; });
    renderSquad();
    renderLeaderboard();
    renderFeed();
  }
})();
