/* ===========================================================
   ファンノート  —  アプリ本体（Phase 1〜2）
   入っているもの：レジストリ・人カード・フィルターチップ・
   ページに飛ぶ・手動追加（新規/既存の紐付け確認つき）・削除・詳細シート
   note自動取得＋新着NEW（中継ごし・タップで既読→消える・⟳で手動更新）
   入っていないもの（Phase 3以降）：日次チェック・沈み・リセット・カウンター
   保存：IndexedDB（この端末の中だけ）
   =========================================================== */

'use strict';

/* -----------------------------------------------------------
   1. SNSレジストリ（ここに1行足すだけで新しいSNSを増やせる）
   ----------------------------------------------------------- */
const SNS_REGISTRY = [
  {
    key: 'note', label: 'note', icon: 'n', color: '#41C9B4',
    urlTemplate: 'https://note.com/{handle}',
    handlePrefix: '',
    placeholder: '例：nem_artstory',
    help: 'note.com/ のあとの文字を入れてね（@はいりません）',
    autoFetch: true, hasNew: true, countsForDaily: true,   // ← Phase 2以降で使う旗
  },
  {
    key: 'x', label: 'X', icon: 'X', color: '#1D1D1F',
    urlTemplate: 'https://x.com/{handle}',
    handlePrefix: '@',
    placeholder: '例：jack',
    help: '@のあとのユーザー名を入れてね',
    autoFetch: false, hasNew: false, countsForDaily: true,
  },
  {
    key: 'youtube', label: 'YouTube', icon: '▶', color: '#E8463F',
    urlTemplate: 'https://www.youtube.com/@{handle}',
    handlePrefix: '@',
    placeholder: '例：MrBeast',
    help: '@ハンドル（@のあと）を入れてね',
    autoFetch: false, hasNew: false, countsForDaily: true,
  },
  {
    key: 'suno', label: 'Suno', icon: '🎵', color: '#F08A24',
    urlTemplate: 'https://suno.com/@{handle}',
    handlePrefix: '@',
    placeholder: '例：noninoni',
    help: 'suno.com/@ のあとのユーザー名を入れてね（@はあってもOK）',
    autoFetch: false, hasNew: false, countsForDaily: true,
  },
];

const AVATAR_EMOJIS = ['🐰','🐱','🐶','🐻','🦊','🐼','🐨','🐹','🦄','🐧','🐤','🐸','🌸','🌷','⭐️','🍀','🎀','💜'];

/* -----------------------------------------------------------
   2. 状態
   ----------------------------------------------------------- */
const state = {
  people: [],        // 人の配列
  filter: 'all',     // 'all' か SNSキー
  reordering: false, // 並べ替えモード中か
};

let addDraft = null; // 追加フローの一時データ

/* -----------------------------------------------------------
   3. 小さな道具
   ----------------------------------------------------------- */
const $ = (sel) => document.querySelector(sel);

function uid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'p-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9);
}

function snsByKey(key) { return SNS_REGISTRY.find((s) => s.key === key); }

function todayStr() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function getPerson(id) { return state.people.find((p) => p.id === id); }

function orderedAccountKeys(p) {
  return SNS_REGISTRY.map((s) => s.key).filter((k) => p.accounts && p.accounts[k]);
}

function makeAccount(key, handle) {
  const acc = { handle };
  if (key === 'note') {
    acc.lastSeenArticleId = null; // 既読の最新記事ID（これと違う新しい記事が来たらNEW）
    acc.latest = null;            // { id, title, url, publishAt }
    acc.lastFetchedAt = 0;        // 最後に取りに行った時刻(ms)
    acc.fetchError = false;       // 直近の取得に失敗したか
    acc.image = null;             // noteプロフィール画像URL（アイコンに使う）
    acc.nickname = null;          // noteの表示名
  }
  return acc;
}

// 同じSNS＋同じID（ハンドル）を既に持っている人を探す（重複の自動検出に使う）
// exceptId を渡すと、その人は除外して探す（自分自身との重複は無視）
function findAccountOwner(snsKey, handle, exceptId) {
  const norm = (handle || '').trim().toLowerCase();
  if (!norm) return null;
  return state.people.find((p) =>
    p.id !== exceptId &&
    p.accounts && p.accounts[snsKey] &&
    (p.accounts[snsKey].handle || '').trim().toLowerCase() === norm
  ) || null;
}

// 入力されたユーザー名をきれいにする（URLを貼っても大丈夫にする）
function normalizeHandle(raw, sns) {
  let h = (raw || '').trim();
  if (!h) return '';
  if (/https?:\/\//i.test(h) || /\.(com|tv|me)\//i.test(h)) {
    try {
      const u = new URL(h.startsWith('http') ? h : 'https://' + h);
      const seg = u.pathname.split('/').filter(Boolean);
      if (sns.key === 'youtube') {
        h = seg.find((s) => s.startsWith('@')) || seg[0] || h;
      } else {
        h = seg[0] || h; // note / X は最初の区切り
      }
    } catch (_) { /* URLとして読めなければそのまま */ }
  }
  return h.replace(/^@+/, '').trim();
}

function buildUrl(sns, handle) {
  return sns.urlTemplate.replace('{handle}', encodeURIComponent(handle));
}

function displayHandle(sns, handle) {
  return (sns.handlePrefix || '') + handle;
}

/* -----------------------------------------------------------
   4. 保存（IndexedDB）
   ----------------------------------------------------------- */
const DB_NAME = 'fannote';
const DB_VERSION = 1;
const STORE = 'people';
let _db = null;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}
function _store(mode) { return _db.transaction(STORE, mode).objectStore(STORE); }
function idbGetAll() {
  return new Promise((res, rej) => {
    const r = _store('readonly').getAll();
    r.onsuccess = () => res(r.result || []);
    r.onerror = () => rej(r.error);
  });
}
function idbPut(person) {
  return new Promise((res, rej) => {
    const r = _store('readwrite').put(person);
    r.onsuccess = () => res();
    r.onerror = () => rej(r.error);
  });
}
function idbDelete(id) {
  return new Promise((res, rej) => {
    const r = _store('readwrite').delete(id);
    r.onsuccess = () => res();
    r.onerror = () => rej(r.error);
  });
}

/* -----------------------------------------------------------
   4.5 note 取得（中継ごし）— 最新記事を見て「新着NEW」を出す
   note は外のアプリから直接読めない（CORS）ので、きろく帖の中継を流用する。
   呼び方： {NOTE_PROXY}/?path=（noteのAPIパスを encodeURIComponent）
   ※ 取れなくてもアプリは普通に使える（ランチャーとして動く・状態は壊さない）
   ----------------------------------------------------------- */
const NOTE_PROXY = 'https://note-proxy.nemcralst.workers.dev';
const NOTE_REFRESH_MS = 60 * 60 * 1000; // 同じ人は1時間に1回まで自動チェック（連打しない）

// 中継ごしに note の任意APIパスを叩くURLを作る
function noteProxyUrl(path) {
  return `${NOTE_PROXY}/?path=${encodeURIComponent(path)}`;
}
function noteApiUrl(handle) {
  return noteProxyUrl(`/api/v2/creators/${handle}/contents?kind=note&page=1`);
}

// 中継の応答を素のnote JSONにそろえる（文字列で包む形にもそなえる）
async function noteFetchJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  let json = await res.json();
  if (json && typeof json.contents === 'string') {
    try { json = JSON.parse(json.contents); } catch (_) { /* そのまま */ }
  }
  return json;
}

// note のプロフィールから「名前」「アイコン画像URL」を拾う（キー名のゆれに強く）
function pickNoteImage(o) {
  if (!o) return null;
  const v = o.userProfileImagePath || o.profileImageUrl || o.profile_image_url ||
            o.iconImagePath || o.iconUrl || o.image || null;
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  return 'https://assets.st-note.com' + (v[0] === '/' ? '' : '/') + v;
}
function pickNoteNick(o) { return (o && (o.nickname || o.name || o.displayName)) || null; }
function pickNoteUrlname(o) { return (o && (o.urlname || o.urlName)) || null; }

// note のプロフィール（名前・アイコン）を取りに行く
async function fetchNoteCreator(handle) {
  const json = await noteFetchJson(noteProxyUrl(`/api/v2/creators/${handle}`));
  const d = (json && json.data) || json || {};
  const u = d.user || d;
  return {
    urlname: pickNoteUrlname(u) || pickNoteUrlname(d) || handle,
    nickname: pickNoteNick(u) || pickNoteNick(d),
    image: pickNoteImage(u) || pickNoteImage(d),
  };
}

// 1件のデータから「note creator」を取り出す（入れ子のゆれに強く）
function extractCreator(it) {
  if (!it || typeof it !== 'object') return null;
  const cands = [it, it.user, it.creator, it.followingUser, it.followee, it.targetUser, it.note].filter(Boolean);
  for (const c of cands) {
    const urlname = pickNoteUrlname(c);
    if (urlname) return { urlname, nickname: pickNoteNick(c) || urlname, image: pickNoteImage(c) };
  }
  return null;
}

// JSON内の「creator配列」を全部あつめる（見つかったキー名つき・キー名に依存しない）
function collectCreatorArrays(node, depth, acc, key) {
  if (!node || depth > 6) return;
  if (Array.isArray(node)) {
    const mapped = [];
    for (const it of node) { const c = extractCreator(it); if (c) mapped.push(c); }
    if (mapped.length) { acc.push({ key: key || '', arr: mapped }); return; }
    for (const it of node) collectCreatorArrays(it, depth + 1, acc, key);
    return;
  }
  if (typeof node === 'object') {
    for (const k in node) collectCreatorArrays(node[k], depth + 1, acc, k);
  }
}
// その応答から本命の creator 配列を選ぶ。
// preferKey があればそのキーの配列を使う（ページ送りで「おすすめ」等の小配列に化けない）。
// 初回は「followを含むキー」を優先、無ければいちばん大きい配列。
function chooseCreatorArray(node, preferKey) {
  const acc = [];
  collectCreatorArrays(node, 0, acc, '');
  if (!acc.length) return { key: preferKey || '', arr: [] };
  if (preferKey) {
    const same = acc.filter((x) => x.key === preferKey);
    if (!same.length) return { key: preferKey, arr: [] }; // 本命キーが無い＝終端
    same.sort((a, b) => b.arr.length - a.arr.length);
    return same[0];
  }
  const follow = acc.filter((x) => /follow/i.test(x.key));
  const pool = follow.length ? follow : acc;
  pool.sort((a, b) => b.arr.length - a.arr.length);
  return pool[0];
}

// 失敗時に原因を伝えるための控えめなメモ（フォロー中の取得がうまくいかない時だけ表示）
let _followDebug = '';

// 自分のフォロー中の一覧を取りに行く（形が違っても拾えるように総当たりで解析）
async function fetchNoteFollowings(myId, maxPages = 20) {
  const out = [];
  const seen = new Set();
  const pagesInfo = [];
  let mainKey = null;
  _followDebug = '';
  for (let page = 1; page <= maxPages; page++) {
    const path = `/api/v2/creators/${myId}/followings?page=${page}`;
    const res = await fetch(noteProxyUrl(path), { headers: { Accept: 'application/json' }, cache: 'no-store' });
    const text = await res.text();
    if (page === 1) {
      let keys = '';
      try {
        const j = JSON.parse(text);
        keys = 'top:[' + Object.keys(j || {}).join(',') + '] data:[' + Object.keys((j && j.data) || {}).join(',') + ']';
      } catch (_) { keys = '(JSONではない応答)'; }
      _followDebug = `path=${path} ｜ HTTP ${res.status} ｜ ${keys} ｜ ${text.slice(0, 180)}`;
    }
    if (!res.ok) { if (page === 1) throw new Error('HTTP ' + res.status); break; }
    let json;
    try { json = JSON.parse(text); } catch (_) { json = null; }
    if (json && typeof json.contents === 'string') { try { json = JSON.parse(json.contents); } catch (_) {} }
    const chosen = chooseCreatorArray(json, mainKey);
    if (page === 1) mainKey = chosen.key;
    const arr = chosen.arr || [];
    let added = 0;
    for (const c of arr) { if (!seen.has(c.urlname)) { seen.add(c.urlname); out.push(c); added++; } }
    pagesInfo.push(`p${page}:${arr.length}/+${added}`);
    if (added === 0) break;  // 本命キーのページが尽きた
    if (!mainKey) break;     // 配列にキーが無い形は多ページ送りしない（誤混入防止）
  }
  _followDebug += ' ｜ key=' + (mainKey || '(none)') + ' pages ' + pagesInfo.join(' ');
  return out;
}

// 自分のnote ID（フォロー中一覧に使う）— 端末に保存して使い回す
const MY_NOTE_ID_KEY = 'fannote_my_note_id';
function getMyNoteId() { try { return localStorage.getItem(MY_NOTE_ID_KEY) || ''; } catch (_) { return ''; } }
function setMyNoteId(v) { try { localStorage.setItem(MY_NOTE_ID_KEY, v || ''); } catch (_) {} }

function formatNoteDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}/${m}/${day}`;
}

// note の最新記事を1件返す（記事ゼロなら null・通信や解析に失敗したら throw）
// ※ noteは「固定記事」を先頭に返すことがあるので、並び順ではなく公開日が最新のものを採用
async function fetchNoteLatest(handle) {
  const json = await noteFetchJson(noteApiUrl(handle));
  const list = (json && json.data && json.data.contents) ||
               (json && Array.isArray(json.contents) && json.contents) || [];
  if (!Array.isArray(list) || list.length === 0) return null;
  let best = null, bestT = -Infinity;
  for (const c of list) {
    if (!c) continue;
    const pa = c.publishAt || c.publish_at || null;
    const t = pa ? Date.parse(pa) : NaN;
    const tt = isNaN(t) ? -Infinity : t;
    if (best === null || tt > bestT) { best = c; bestT = tt; }
  }
  if (!best) best = list[0];
  const c = best;
  const key = c.key != null ? String(c.key) : null;
  const id = c.id != null ? String(c.id) : key;
  if (!id) return null;
  return {
    id,
    title: (c.name || '').trim() || '(無題)',
    url: c.noteUrl || (key ? `https://note.com/${handle}/n/${key}` : `https://note.com/${handle}`),
    publishAt: c.publishAt || c.publish_at || null,
  };
}

// この note アカウントに「新着」があるか（初回チェック後・既読より新しい記事）
function isNoteNew(acc) {
  return !!(acc && acc.latest && acc.lastSeenArticleId &&
            acc.lastSeenArticleId !== acc.latest.id);
}

// note の最新を見に行く。force=true で時間制限を無視（手動更新）
// 戻り値：{ tried, newCount, errCount }
let _refreshingNotes = false;
async function refreshNotes({ force = false } = {}) {
  if (_refreshingNotes) return null;
  const sns = snsByKey('note');
  if (!sns || !sns.autoFetch) return null;
  const now = Date.now();
  const targets = state.people.filter((p) => {
    const acc = p.accounts && p.accounts.note;
    if (!acc) return false;
    if (force) return true;
    return !acc.lastFetchedAt || (now - acc.lastFetchedAt) >= NOTE_REFRESH_MS;
  });
  if (targets.length === 0) return { tried: 0, newCount: 0, errCount: 0 };

  _refreshingNotes = true;
  let changed = false, newCount = 0, errCount = 0;
  try {
    for (const p of targets) {
      const acc = p.accounts.note;
      try {
        const latest = await fetchNoteLatest(acc.handle);
        acc.fetchError = false;
        if (latest) {
          const wasFirst = !acc.lastSeenArticleId;
          acc.latest = latest;
          if (wasFirst) {
            acc.lastSeenArticleId = latest.id; // 初回は基準にするだけ（NEWは出さない）
          } else if (acc.lastSeenArticleId !== latest.id) {
            newCount++;
          }
        }
      } catch (_) {
        acc.fetchError = true;
        errCount++;
      }
      // プロフィール画像・名前（まだ無ければ／手動更新なら取り直す。失敗してもNEWは止めない）
      if (!acc.image || force) {
        try {
          const cr = await fetchNoteCreator(acc.handle);
          if (cr && cr.image) acc.image = cr.image;
          if (cr && cr.nickname) acc.nickname = cr.nickname;
        } catch (_) { /* 画像は任意なので無視 */ }
      }
      acc.lastFetchedAt = Date.now(); // 連打しないよう、成否にかかわらず時刻を更新
      changed = true;
      await idbPut(p);
    }
  } finally {
    _refreshingNotes = false;
  }
  if (changed) renderAll();
  return { tried: targets.length, newCount, errCount };
}

// note を見た＝既読にして NEW を消す
async function markNoteSeen(p) {
  const acc = p.accounts && p.accounts.note;
  if (!acc || !acc.latest) return;
  if (acc.lastSeenArticleId !== acc.latest.id) {
    acc.lastSeenArticleId = acc.latest.id;
    await idbPut(p);
    renderAll();
  }
}

/* -----------------------------------------------------------
   5. はじめての起動：サンプル（ダミー）を入れる
   ----------------------------------------------------------- */
const SEED = [
  { name: 'ねこさん',   avatar: '🐱', accounts: { note: 'neko_art', x: 'neko_x' } },
  { name: 'うさぎさん', avatar: '🐰', accounts: { note: 'usagi_note' } },
  { name: 'くまさん',   avatar: '🐻', accounts: { x: 'kuma_bear', youtube: 'kumachannel' } },
  { name: 'きつねさん', avatar: '🦊', accounts: { youtube: 'foxtube' } },
  { name: 'ぱんださん', avatar: '🐼', accounts: { note: 'panda_diary', x: 'panda_x', youtube: 'pandatv' } },
];

async function seedIfFirstRun() {
  if (localStorage.getItem('fannote_seeded')) return;
  if (state.people.length > 0) { localStorage.setItem('fannote_seeded', '1'); return; }
  let order = 1;
  for (const s of SEED) {
    const person = {
      id: uid(), name: s.name, avatar: s.avatar, order: order++,
      accounts: {},
      today: { date: todayStr(), seen: [], doneManual: false },
    };
    for (const [k, h] of Object.entries(s.accounts)) person.accounts[k] = makeAccount(k, h);
    state.people.push(person);
    await idbPut(person);
  }
  localStorage.setItem('fannote_seeded', '1');
}

/* -----------------------------------------------------------
   5.5 日次チェック・沈み・リセット（Phase 3）
   ----------------------------------------------------------- */
// 沈み判定に数える account のキー（countsForDaily=true のSNS）
function countingKeys(p) {
  return orderedAccountKeys(p).filter((k) => { const s = snsByKey(k); return s && s.countsForDaily; });
}
function isSeen(p, key) { return !!(p.today && p.today.seen && p.today.seen.includes(key)); }
// 「いま見ている範囲」で done（沈み）か判定
function isDone(p, filter) {
  const t = p.today || {};
  if (t.doneManual) return true;
  if (filter && filter !== 'all') return isSeen(p, filter);   // 単一SNS表示：そのSNSを見たら済み
  const keys = countingKeys(p);                                // すべて表示：数えるSNSを全部見たら済み
  return keys.length > 0 && keys.every((k) => isSeen(p, k));
}
// 端末ローカル日付が変わっていたら今日の記録をリセット（全員上に戻る）
async function ensureToday() {
  const today = todayStr();
  let changed = false;
  for (const p of state.people) {
    if (!p.today || p.today.date !== today) {
      p.today = { date: today, seen: [], doneManual: false };
      await idbPut(p);
      changed = true;
    }
  }
  return changed;
}
// 「今日はこの人OK」/「まだに戻す」
async function setDoneManual(p, val) {
  if (!p.today) p.today = { date: todayStr(), seen: [], doneManual: false };
  if (val) p.today.doneManual = true;
  else { p.today.doneManual = false; p.today.seen = []; } // まだに戻す＝今日の記録をクリア
  await idbPut(p);
  renderAll();
}

/* -----------------------------------------------------------
   6. 画面を描く
   ----------------------------------------------------------- */
function renderAll() { renderChips(); renderReorderBtn(); renderProgress(); renderList(); }

// 今日の進捗（フィルター連動：すべて＝全員の済み人数／単一SNS＝そのSNSの済み人数）
function renderProgress() {
  const box = $('#progress');
  if (!box) return;
  if (state.reordering) { // 並べ替え中は進捗の代わりに案内を出す
    box.innerHTML = '';
    box.appendChild(el('div', 'progress-text', '並べ替え中：ドラッグで移動 ／ 右上の ✓ で完了'));
    return;
  }
  const filter = state.filter;
  let people = state.people.slice();
  let label = '';
  if (filter !== 'all') {
    const s = snsByKey(filter); label = s ? s.label + ' ' : '';
    people = people.filter((p) => p.accounts && p.accounts[filter]);
  }
  const total = people.length;
  const doneCount = people.filter((p) => isDone(p, filter)).length;
  const pct = total ? Math.round((doneCount / total) * 100) : 0;
  box.innerHTML = '';
  box.appendChild(el('div', 'progress-text', `今日 ${label}${doneCount}/${total} 見た`));
  const track = el('div', 'progress-track');
  const fill = el('div', 'progress-fill'); fill.style.width = pct + '%';
  track.appendChild(fill);
  box.appendChild(track);
}

function renderChips() {
  const el = $('#chips');
  el.innerHTML = '';
  const chips = [{ key: 'all', label: 'すべて', color: null }]
    .concat(SNS_REGISTRY.map((s) => ({ key: s.key, label: s.label, color: s.color })));
  for (const c of chips) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip' + (state.filter === c.key ? ' is-active' : '');
    if (c.color) {
      const dot = document.createElement('span');
      dot.className = 'chip-dot';
      dot.style.background = c.color;
      b.appendChild(dot);
    }
    b.appendChild(document.createTextNode(c.label));
    b.addEventListener('click', () => { state.filter = c.key; renderAll(); });
    el.appendChild(b);
  }
}

function renderList() {
  const box = $('#list');
  box.innerHTML = '';
  let people = state.people.slice().sort((a, b) => (a.order || 0) - (b.order || 0));
  if (state.filter !== 'all') people = people.filter((p) => p.accounts && p.accounts[state.filter]);

  if (people.length === 0) { box.appendChild(emptyState()); return; }

  if (state.reordering) { // 並べ替え中は沈みオフの平ら表示（仕切りなし）
    for (const p of people) box.appendChild(personCard(p, false));
    return;
  }
  const notYet = people.filter((p) => !isDone(p, state.filter));
  const done = people.filter((p) => isDone(p, state.filter));
  for (const p of notYet) box.appendChild(personCard(p, false));
  if (done.length) {
    box.appendChild(doneDivider());
    for (const p of done) box.appendChild(personCard(p, true));
  }
}
function doneDivider() {
  const d = el('div', 'done-divider');
  d.appendChild(el('span', null, '今日チェック済み'));
  return d;
}

/* -----------------------------------------------------------
   6.5 並べ替え（SortableJS によるモード式）
   ・上部 ↕ ボタンでモード出入り（「すべて」表示の時だけ）
   ・モード中は沈みオフの平ら表示／カードのタップは無効・ドラッグ優先
   ・1枚動かすたび即保存／自動スクロールあり
   ----------------------------------------------------------- */
let _sortable = null;
function toggleReorder() { state.reordering ? exitReorder() : enterReorder(); }

function enterReorder() {
  if (state.filter !== 'all') return;                 // すべて表示の時だけ
  if (typeof Sortable === 'undefined') { toast('並べ替えを読み込めませんでした'); return; }
  state.reordering = true;
  document.body.classList.add('reordering-mode');
  renderAll();                                        // 沈みオフの平ら表示にする
  _sortable = Sortable.create($('#list'), {
    animation: 150,
    draggable: '.card',
    forceFallback: true,        // PC/スマホで同じ確実なドラッグ実装を使う
    fallbackTolerance: 4,
    delay: 150,                 // 押し込みで掴む（タップ/スクロールと区別）
    delayOnTouchOnly: true,     // タッチの時だけ遅延（マウスは即）
    scroll: true,               // 端に寄ると自動スクロール
    scrollSensitivity: 70,
    scrollSpeed: 14,
    forceAutoScrollFallback: true,
    ghostClass: 'card-ghost',
    chosenClass: 'card-chosen',
    fallbackClass: 'card-fallback',
    onEnd: () => { persistOrderFromDom(); },          // 1枚動かすたび即保存
  });
  toast('並べ替え中：ドラッグで移動／右上の ✓ で完了');
}

function exitReorder() {
  if (_sortable) { try { _sortable.destroy(); } catch (_) {} _sortable = null; }
  state.reordering = false;
  document.body.classList.remove('reordering-mode');
  persistOrderFromDom();   // 念のため最終確定
  renderAll();             // 沈みを再計算して通常表示へ
}

// 画面のカード並びを order に焼き込む（並び順は全体で1つ）
async function persistOrderFromDom() {
  const ids = [...$('#list').querySelectorAll('.card')].map((c) => c.dataset.id).filter(Boolean);
  if (!ids.length) return;
  const globalIds = state.people.slice().sort((a, b) => (a.order || 0) - (b.order || 0)).map((p) => p.id);
  const visible = new Set(ids);
  const slots = [];
  globalIds.forEach((id, i) => { if (visible.has(id)) slots.push(i); });
  const newGlobal = globalIds.slice();
  ids.forEach((id, k) => { newGlobal[slots[k]] = id; }); // 表示中の枠だけ新しい順に差し替え
  for (let i = 0; i < newGlobal.length; i++) {
    const p = getPerson(newGlobal[i]);
    if (p && p.order !== i + 1) { p.order = i + 1; await idbPut(p); }
  }
}

// ↕ ボタンの表示（すべての時だけ）と状態（モード中は ✓）
function renderReorderBtn() {
  const btn = $('#reorder');
  if (!btn) return;
  btn.style.display = state.filter === 'all' ? '' : 'none';
  btn.classList.toggle('is-on', !!state.reordering);
  btn.textContent = state.reordering ? '✓' : '↕';
  btn.setAttribute('aria-label', state.reordering ? '並べ替えを完了' : '並べ替え');
}

function emptyState() {
  const box = document.createElement('div');
  box.className = 'empty';
  const isFilter = state.filter !== 'all';
  const sns = isFilter ? snsByKey(state.filter) : null;
  box.innerHTML =
    `<div class="empty-emoji">${isFilter ? '🔎' : '💜'}</div>` +
    `<div class="empty-text">${
      isFilter
        ? `まだ ${sns ? sns.label : ''} の人がいません。<br>下の「＋ 追加」から登録できます。`
        : 'まだ誰もいません。<br>下の「＋ 追加」から、<br>好きな人を登録してみてね。'
    }</div>`;
  return box;
}

function personCard(p, done) {
  const card = document.createElement('div');
  card.className = 'card' + (done ? ' is-done' : '');
  card.dataset.id = p.id;

  const top = document.createElement('div');
  top.className = 'card-top';

  const av = makeAvatar(p);

  const name = document.createElement('button');
  name.type = 'button';
  name.className = 'card-name';
  name.textContent = p.name;
  name.addEventListener('click', () => openDetailSheet(p.id));

  const menu = document.createElement('button');
  menu.type = 'button';
  menu.className = 'card-menu';
  menu.setAttribute('aria-label', p.name + ' のメニュー');
  menu.textContent = '⋯';
  menu.addEventListener('click', () => openDetailSheet(p.id));

  top.append(av, name, menu);
  card.appendChild(top);

  const snsRow = document.createElement('div');
  snsRow.className = 'card-sns';
  for (const key of orderedAccountKeys(p)) {
    const s = snsByKey(key);
    if (!s) continue;
    const acc = p.accounts[key];
    const seen = isSeen(p, key);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sns-btn' + (seen ? ' is-seen' : '');
    btn.style.background = s.color;
    if (seen) btn.appendChild(el('span', 'sns-check', '✓'));
    const lab = document.createElement('span'); lab.textContent = s.label;
    btn.append(lab); // SNS名だけ表示（IDは詳細シートで確認）
    if (key === 'note' && isNoteNew(acc)) btn.appendChild(el('span', 'new-badge', 'NEW'));
    btn.addEventListener('click', () => openAndSeen(p, key));
    snsRow.appendChild(btn);
  }
  card.appendChild(snsRow);
  return card;
}

/* ページに飛ぶ（開けないときはトーストで知らせるだけ・状態は壊さない） */
function openExternal(url) {
  try {
    const a = document.createElement('a');
    a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch (_) {
    toast('ページを開けませんでした');
  }
}
function openUrl(sns, handle) { openExternal(buildUrl(sns, handle)); }

// SNSを開く＝「今日見た」に記録（✓）。noteは新着も既読にしてNEWを消す。
async function openAndSeen(p, key) {
  const s = snsByKey(key);
  const acc = p.accounts[key];
  if (key === 'note') {
    const goNew = isNoteNew(acc) && acc.latest && acc.latest.url;
    openExternal(goNew ? acc.latest.url : buildUrl(s, acc.handle)); // ジェスチャー内で即開く
    if (acc.latest) acc.lastSeenArticleId = acc.latest.id;          // NEWを消す
  } else {
    openUrl(s, acc.handle);
  }
  if (!p.today) p.today = { date: todayStr(), seen: [], doneManual: false };
  if (!p.today.seen) p.today.seen = [];
  if (!p.today.seen.includes(key)) p.today.seen.push(key);
  await idbPut(p);
  renderAll();
}

/* -----------------------------------------------------------
   7. シート（下から出る画面）の土台
   ----------------------------------------------------------- */
function showSheet() {
  const sheet = $('#sheet');
  sheet.style.transition = ''; sheet.style.transform = '';
  $('#backdrop').hidden = false; sheet.hidden = false;
}
function closeSheet() {
  const sheet = $('#sheet');
  sheet.hidden = true; $('#backdrop').hidden = true; addDraft = null;
  sheet.style.transition = ''; sheet.style.transform = '';
}
function renderSheet(buildFn) {
  const sheet = $('#sheet');
  sheet.innerHTML = '';
  sheet.style.transform = ''; sheet.style.transition = '';
  const h = document.createElement('div'); h.className = 'sheet-handle'; sheet.appendChild(h);
  const close = el('button', 'sheet-close', '✕'); close.type = 'button';
  close.setAttribute('aria-label', '閉じる');
  close.addEventListener('click', closeSheet);
  sheet.appendChild(close);
  buildFn(sheet);
  sheet.scrollTop = 0;
}

// 下から出るシートを下スワイプで閉じる（＆そのスワイプがPWA本体に伝わって閉じるのを防ぐ）
function enableSheetDrag(sheet) {
  let startY = 0, delta = 0, dragging = false;
  sheet.addEventListener('touchstart', (e) => {
    if (sheet.hidden || e.touches.length !== 1 || sheet.scrollTop > 0) { dragging = false; return; }
    startY = e.touches[0].clientY; delta = 0; dragging = true;
    sheet.style.transition = 'none';
  }, { passive: true });
  sheet.addEventListener('touchmove', (e) => {
    if (!dragging) return;
    delta = e.touches[0].clientY - startY;
    if (delta > 0) {
      e.preventDefault(); // ← これでスワイプがPWA本体に伝わらない（勝手に閉じない）
      sheet.style.transform = `translateY(${delta}px)`;
    }
  }, { passive: false });
  const end = () => {
    if (!dragging) return;
    dragging = false;
    sheet.style.transition = 'transform 0.22s cubic-bezier(0.22,1,0.36,1)';
    if (delta > 90) closeSheet();      // しっかり下げたら閉じる
    else sheet.style.transform = '';   // 少しなら元に戻す
  };
  sheet.addEventListener('touchend', end);
  sheet.addEventListener('touchcancel', end);
}

// 部品づくりの近道
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function titleEl(text) { return el('div', 'sheet-title', text); }
function subEl(text) { return el('div', 'sheet-sub', text); }
function backBtn(onClick) {
  const b = el('button', 'btn-back', '‹ もどる');
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}
function snsBadge(sns) {
  const i = el('span', 'row-ico', sns.icon);
  i.style.background = sns.color;
  return i;
}

// アイコン要素（noteのプロフィール画像が既定／絵文字に変更されていれば絵文字）
function makeAvatar(p) {
  const av = el('div', 'avatar');
  const img = p && p.accounts && p.accounts.note && p.accounts.note.image;
  const useImg = img && p.avatarMode !== 'emoji'; // 詳細で絵文字に変えたら絵文字優先
  if (useImg) {
    const im = document.createElement('img');
    im.src = img; im.alt = ''; im.loading = 'lazy';
    im.addEventListener('error', () => { im.remove(); av.textContent = p.avatar || '🙂'; });
    av.appendChild(im);
  } else {
    av.textContent = p.avatar || '🙂';
  }
  return av;
}

/* -----------------------------------------------------------
   8. ＋おきに追加（新規 / 既存への紐付け）
   ----------------------------------------------------------- */
function openAddSheet() {
  addDraft = {};
  showSheet();
  renderSheet(buildAddStepSNS);
}

// 8-1 どのSNS？
function buildAddStepSNS(sheet) {
  sheet.appendChild(titleEl('おきに追加'));
  sheet.appendChild(subEl('どこのアカウントを追加する？'));
  for (const s of SNS_REGISTRY) {
    const b = el('button', 'row-btn'); b.type = 'button';
    b.appendChild(snsBadge(s));
    const main = el('div', 'row-main'); main.appendChild(el('span', null, s.label));
    b.appendChild(main);
    b.appendChild(el('span', 'row-arrow', '›'));
    b.addEventListener('click', () => { addDraft.snsKey = s.key; renderSheet(buildAddStepHandle); });
    sheet.appendChild(b);
  }
}

// 8-2 ユーザー名を入れる
function buildAddStepHandle(sheet) {
  const sns = snsByKey(addDraft.snsKey);
  sheet.appendChild(backBtn(() => renderSheet(buildAddStepSNS)));
  sheet.appendChild(titleEl(`${sns.label} のユーザー名`));

  // note は「フォロー中から選ぶ」も用意（自分のnote IDが要る・任意入力）
  if (sns.key === 'note') {
    const follow = el('button', 'row-btn'); follow.type = 'button';
    const fi = el('span', 'row-ico', '📋'); fi.style.background = 'var(--lavender)'; follow.appendChild(fi);
    const fm = el('div', 'row-main');
    fm.appendChild(el('span', null, 'フォロー中から選ぶ'));
    fm.appendChild(el('small', null, 'あなたのnoteのフォロー中を一覧で表示'));
    follow.appendChild(fm); follow.appendChild(el('span', 'row-arrow', '›'));
    follow.addEventListener('click', () => {
      renderSheet(getMyNoteId() ? buildAddFollowings : buildAddAskMyId);
    });
    sheet.appendChild(follow);
    sheet.appendChild(el('div', 'sheet-section-label', 'または ユーザー名を入れる'));
  }

  const field = el('div', 'field');
  field.appendChild(el('label', 'field-label', 'ユーザー名'));
  const input = el('input', 'text-input');
  input.type = 'text';
  input.placeholder = sns.placeholder;
  input.autocomplete = 'off'; input.autocapitalize = 'off'; input.spellcheck = false;
  if (addDraft.handleRaw) input.value = addDraft.handleRaw;
  field.appendChild(input);
  field.appendChild(el('div', 'field-hint', sns.help));
  const preview = el('div', 'url-preview');
  field.appendChild(preview);
  sheet.appendChild(field);

  const next = el('button', 'btn btn-primary btn-block', '次へ');
  next.type = 'button';
  sheet.appendChild(next);

  const update = () => {
    const clean = normalizeHandle(input.value, sns);
    preview.textContent = clean ? '飛び先：' + buildUrl(sns, clean) : '';
    next.disabled = !clean;
  };
  input.addEventListener('input', update);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !next.disabled) goNext(); });
  const goNext = () => {
    const clean = normalizeHandle(input.value, sns);
    if (!clean) return;
    addDraft.handle = clean;
    addDraft.handleRaw = input.value;
    // 同じSNS＋同じIDが既にある？ → 黙って別人を作らず確認（別人として追加/紐付け/やめる）
    const owner = findAccountOwner(addDraft.snsKey, clean);
    if (owner) {
      addDraft.dupOwnerId = owner.id;
      renderSheet((s) => buildAddDuplicate(s, owner.id));
      return;
    }
    addDraft.dupOwnerId = null;
    if (state.people.length === 0) renderSheet(buildAddStepNew); // 誰もいなければ新規へ直行
    else renderSheet(buildAddStepWho);
  };
  next.addEventListener('click', goNext);
  update();
  setTimeout(() => input.focus(), 50);
}

// 8-3 新しい人？ もういる人に追加？
function buildAddStepWho(sheet) {
  const sns = snsByKey(addDraft.snsKey);
  sheet.appendChild(backBtn(() => renderSheet(buildAddStepHandle)));
  sheet.appendChild(titleEl('この人は？'));
  sheet.appendChild(subEl(`${sns.label}：${displayHandle(sns, addDraft.handle)}`));

  const bNew = el('button', 'row-btn'); bNew.type = 'button';
  const iNew = el('span', 'row-ico', '＋'); iNew.style.background = 'var(--lavender)';
  bNew.appendChild(iNew);
  const mNew = el('div', 'row-main'); mNew.appendChild(el('span', null, '新しい人を追加'));
  mNew.appendChild(el('small', null, 'あたらしいカードを作ります'));
  bNew.appendChild(mNew); bNew.appendChild(el('span', 'row-arrow', '›'));
  bNew.addEventListener('click', () => renderSheet(buildAddStepNew));
  sheet.appendChild(bNew);

  const bExist = el('button', 'row-btn'); bExist.type = 'button';
  const iExist = el('span', 'row-ico', '🔗'); iExist.style.background = 'var(--lavender-dark)';
  bExist.appendChild(iExist);
  const mExist = el('div', 'row-main'); mExist.appendChild(el('span', null, 'もういる人に追加'));
  mExist.appendChild(el('small', null, '同じ人の別アカウントを1枚にまとめます'));
  bExist.appendChild(mExist); bExist.appendChild(el('span', 'row-arrow', '›'));
  bExist.addEventListener('click', () => renderSheet(buildAddStepPick));
  sheet.appendChild(bExist);
}

// 8-3b 同じSNS＋同じIDが既にある時の3択（別人として追加 / 既存に紐付け / やめる）
function buildAddDuplicate(sheet, ownerId) {
  const sns = snsByKey(addDraft.snsKey);
  const owner = getPerson(ownerId);
  if (!owner) { renderSheet(buildAddStepWho); return; }

  sheet.appendChild(backBtn(() => renderSheet(buildAddStepHandle)));
  sheet.appendChild(titleEl('もう登録ずみみたい'));
  sheet.appendChild(subEl(`「${displayHandle(sns, addDraft.handle)}」は すでに「${owner.name}」に登録されています。`));

  // 1) 既存の人に紐付け（＝同じ人だった。重複を作らない）
  const link = el('button', 'row-btn'); link.type = 'button';
  const li = el('span', 'row-ico', '🔗'); li.style.background = 'var(--lavender)'; link.appendChild(li);
  const lm = el('div', 'row-main');
  lm.appendChild(el('span', null, `「${owner.name}」に紐付け`));
  lm.appendChild(el('small', null, '同じ人にまとめます（重複を作りません）'));
  link.appendChild(lm); link.appendChild(el('span', 'row-arrow', '›'));
  link.addEventListener('click', () => {
    closeSheet();
    openDetailSheet(owner.id);
    toast(`「${owner.name}」に登録ずみです`);
  });
  sheet.appendChild(link);

  // 2) 別人として追加（サブ垢など、意図的に別カード）
  const asNew = el('button', 'row-btn'); asNew.type = 'button';
  const ni = el('span', 'row-ico', '＋'); ni.style.background = 'var(--lavender-dark)'; asNew.appendChild(ni);
  const nm = el('div', 'row-main');
  nm.appendChild(el('span', null, '別人として追加'));
  nm.appendChild(el('small', null, 'サブ垢など、別の人として新しく登録します'));
  asNew.appendChild(nm); asNew.appendChild(el('span', 'row-arrow', '›'));
  asNew.addEventListener('click', () => renderSheet(buildAddStepNew));
  sheet.appendChild(asNew);

  // 3) やめる
  const stop = el('button', 'row-btn'); stop.type = 'button';
  const si = el('span', 'row-ico', '×'); si.style.background = 'var(--ink-soft)'; stop.appendChild(si);
  const sm = el('div', 'row-main'); sm.appendChild(el('span', null, 'やめる'));
  stop.appendChild(sm);
  stop.addEventListener('click', () => closeSheet());
  sheet.appendChild(stop);
}

// 8-4a 新しい人（名前＋アバター）
function buildAddStepNew(sheet) {
  const sns = snsByKey(addDraft.snsKey);
  const back = () => {
    if (addDraft.dupOwnerId) renderSheet((s) => buildAddDuplicate(s, addDraft.dupOwnerId));
    else if (state.people.length > 0) renderSheet(buildAddStepWho);
    else renderSheet(buildAddStepHandle);
  };
  sheet.appendChild(backBtn(back));
  sheet.appendChild(titleEl('新しい人'));
  sheet.appendChild(subEl(`${sns.label}：${displayHandle(sns, addDraft.handle)}`));

  const nameField = el('div', 'field');
  nameField.appendChild(el('label', 'field-label', '名前（あとで変えられます）'));
  const nameInput = el('input', 'text-input');
  nameInput.type = 'text';
  nameInput.value = addDraft.name != null ? addDraft.name : (addDraft.prefillName || addDraft.handle);
  nameInput.placeholder = '名前';
  nameField.appendChild(nameInput);
  sheet.appendChild(nameField);

  // アイコンは自動で既定（note＝取得した本物の画像／X・YouTube＝絵文字）。ここでは選ばせない。
  const chosen = addDraft.avatar || AVATAR_EMOJIS[Math.floor(Math.random() * AVATAR_EMOJIS.length)];

  const add = el('button', 'btn btn-primary btn-block', 'この人を追加する');
  add.type = 'button';
  add.style.marginTop = '12px';
  add.addEventListener('click', async () => {
    const name = (nameInput.value || '').trim() || addDraft.handle;
    const isNote = addDraft.snsKey === 'note';
    await createPerson({
      name, avatar: chosen, snsKey: addDraft.snsKey, handle: addDraft.handle,
      noteImage: addDraft.noteImage, noteNickname: addDraft.noteNickname,
    });
    closeSheet();
    renderAll();
    toast(`「${name}」を追加しました`);
    if (isNote) refreshNotes().catch(() => {}); // 追加したらすぐ新着を見に行く
  });
  sheet.appendChild(add);
}

// 8-4b もういる人に追加（人をえらぶ）
function buildAddStepPick(sheet) {
  const sns = snsByKey(addDraft.snsKey);
  sheet.appendChild(backBtn(() => renderSheet(buildAddStepWho)));
  sheet.appendChild(titleEl('だれに追加する？'));
  sheet.appendChild(subEl(`${sns.label}：${displayHandle(sns, addDraft.handle)} を足します`));

  const people = state.people.slice().sort((a, b) => (a.order || 0) - (b.order || 0));
  for (const p of people) {
    const row = el('button', 'pick-person'); row.type = 'button';
    const av = makeAvatar(p);
    const nm = el('div', 'pp-name', p.name);
    const tags = el('div', 'pp-tags');
    for (const k of orderedAccountKeys(p)) {
      const t = el('span', 'pp-tag'); t.style.background = snsByKey(k).color; tags.appendChild(t);
    }
    row.append(av, nm, tags);
    row.addEventListener('click', () => attachToPerson(p, addDraft.snsKey, addDraft.handle));
    sheet.appendChild(row);
  }
}

// 8-5 フォロー中から選ぶ：自分のnote IDを一度だけ聞く（端末に保存して使い回す）
function buildAddAskMyId(sheet) {
  sheet.appendChild(backBtn(() => renderSheet(buildAddStepHandle)));
  sheet.appendChild(titleEl('あなたの note ID'));
  sheet.appendChild(subEl('フォロー中の一覧を出すために一度だけ教えてね（ログインではありません）'));

  const field = el('div', 'field');
  field.appendChild(el('label', 'field-label', 'あなたの note ID'));
  const input = el('input', 'text-input');
  input.type = 'text'; input.placeholder = '例：nem_artstory';
  input.autocomplete = 'off'; input.autocapitalize = 'off'; input.spellcheck = false;
  input.value = getMyNoteId();
  field.appendChild(input);
  field.appendChild(el('div', 'field-hint', 'note.com/ のあとのあなたのID（@はいりません）'));
  sheet.appendChild(field);

  const go = el('button', 'btn btn-primary btn-block', 'フォロー中を見る'); go.type = 'button';
  sheet.appendChild(go);
  const submit = () => {
    const id = normalizeHandle(input.value, snsByKey('note'));
    if (!id) { toast('IDを入れてね'); return; }
    setMyNoteId(id);
    renderSheet(buildAddFollowings);
  };
  go.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  setTimeout(() => input.focus(), 50);
}

// 8-6 フォロー中の一覧（中継ごしに取得して表示・タップで追加へ）
async function buildAddFollowings(sheet) {
  const myId = getMyNoteId();
  sheet.appendChild(backBtn(() => renderSheet(buildAddStepHandle)));
  sheet.appendChild(titleEl('フォロー中から選ぶ'));

  const sub = el('div', 'sheet-sub');
  sub.appendChild(document.createTextNode(`あなた：@${myId}　`));
  const chg = el('button', 'linklike', 'IDを変更'); chg.type = 'button';
  chg.addEventListener('click', () => renderSheet(buildAddAskMyId));
  sub.appendChild(chg);
  sheet.appendChild(sub);

  const status = el('div', 'follow-status', '読み込み中…');
  sheet.appendChild(status);
  const listWrap = el('div');
  sheet.appendChild(listWrap);

  let followings = [];
  try {
    followings = await fetchNoteFollowings(myId);
  } catch (_) {
    status.textContent = '取得できませんでした。IDが正しいか確認してね。';
    return;
  }
  if (followings.length) {
    status.remove();
    const cnt = el('div', 'follow-count', `フォロー中 ${followings.length}人`);
    sheet.insertBefore(cnt, listWrap);
  }
  if (!followings.length) {
    status.textContent = 'フォロー中が見つかりませんでした。';
    if (_followDebug) {
      const more = el('button', 'linklike', 'うまくいかない時（開発用の詳細）'); more.type = 'button';
      more.style.display = 'block'; more.style.margin = '10px auto 0';
      const dbg = el('div', 'follow-status');
      dbg.style.display = 'none'; dbg.style.fontSize = '11px'; dbg.style.wordBreak = 'break-all'; dbg.style.textAlign = 'left';
      dbg.textContent = _followDebug;
      more.addEventListener('click', () => { dbg.style.display = dbg.style.display === 'none' ? 'block' : 'none'; });
      sheet.appendChild(more); sheet.appendChild(dbg);
    }
    return;
  }
  status.remove();

  for (const c of followings) {
    const owner = findAccountOwner('note', c.urlname);
    const row = el('button', 'pick-person'); row.type = 'button';
    const av = el('div', 'avatar');
    if (c.image) {
      const im = document.createElement('img');
      im.src = c.image; im.alt = ''; im.loading = 'lazy';
      im.addEventListener('error', () => { im.remove(); av.textContent = '🙂'; });
      av.appendChild(im);
    } else { av.textContent = '🙂'; }
    const nm = el('div', 'pp-name', c.nickname || c.urlname);
    row.append(av, nm);
    if (owner) {
      row.appendChild(el('span', 'pp-added', '追加ずみ'));
      row.addEventListener('click', () => { closeSheet(); openDetailSheet(owner.id); });
    } else {
      row.appendChild(el('span', 'row-arrow', '›'));
      row.addEventListener('click', () => pickFollowing(c));
    }
    listWrap.appendChild(row);
  }
}

// フォロー中の一覧から1人えらんだ：その人を追加する流れへ（名前・アイコンを引き継ぐ）
function pickFollowing(c) {
  addDraft.snsKey = 'note';
  addDraft.handle = c.urlname;
  addDraft.handleRaw = c.urlname;
  addDraft.prefillName = c.nickname || c.urlname;
  addDraft.noteImage = c.image || null;
  addDraft.noteNickname = c.nickname || null;
  const owner = findAccountOwner('note', c.urlname);
  if (owner) { addDraft.dupOwnerId = owner.id; renderSheet((s) => buildAddDuplicate(s, owner.id)); return; }
  addDraft.dupOwnerId = null;
  renderSheet(buildAddStepNew);
}

/* 既存の人にSNSを足す（重複していたら置き換え確認） */
function attachToPerson(person, snsKey, handle) {
  const sns = snsByKey(snsKey);
  if (person.accounts && person.accounts[snsKey]) {
    confirmDialog({
      title: `すでに${sns.label}登録ずみ`,
      body: `「${person.name}」は すでに ${sns.label} が登録されています。\n新しい「${displayHandle(sns, handle)}」に置き換えますか？`,
      okLabel: '置き換える',
      onOk: () => commitAttach(person, snsKey, handle, true),
    });
  } else {
    commitAttach(person, snsKey, handle, false);
  }
}

async function commitAttach(person, snsKey, handle, replaced) {
  const sns = snsByKey(snsKey);
  person.accounts[snsKey] = makeAccount(snsKey, handle);
  await idbPut(person);
  closeSheet();
  renderAll();
  toast(replaced ? `「${person.name}」の ${sns.label} を変えました` : `「${person.name}」に ${sns.label} を足しました`);
  if (snsKey === 'note') refreshNotes().catch(() => {});
}

async function createPerson({ name, avatar, snsKey, handle, noteImage, noteNickname }) {
  const maxOrder = state.people.reduce((m, p) => Math.max(m, p.order || 0), 0);
  const person = {
    id: uid(), name, avatar: avatar || '🙂', order: maxOrder + 1,
    accounts: {}, today: { date: todayStr(), seen: [], doneManual: false },
  };
  person.accounts[snsKey] = makeAccount(snsKey, handle);
  if (snsKey === 'note') {
    if (noteImage) person.accounts.note.image = noteImage;
    if (noteNickname) person.accounts.note.nickname = noteNickname;
  }
  state.people.push(person);
  await idbPut(person);
  return person;
}

/* -----------------------------------------------------------
   9. 詳細シート（名前編集 / SNSを足す・外す / 削除）
   ----------------------------------------------------------- */
function openDetailSheet(id) {
  showSheet();
  renderSheet((s) => buildDetail(s, id));
}

function buildDetail(sheet, id) {
  const p = getPerson(id);
  if (!p) { closeSheet(); return; }

  // ヘッダー
  const head = el('div'); head.style.textAlign = 'center'; head.style.margin = '4px 0 8px';
  const av = makeAvatar(p);
  av.style.margin = '0 auto 8px'; av.style.width = '56px'; av.style.height = '56px'; av.style.fontSize = '30px';
  head.appendChild(av);
  head.appendChild(titleEl(p.name));
  sheet.appendChild(head);

  // 今日チェック（✓今日はこの人OK ／ ↩まだに戻す）
  const doneNow = isDone(p, state.filter);
  const tdy = el('button', 'row-btn'); tdy.type = 'button';
  const tdyIco = el('span', 'row-ico', doneNow ? '↩' : '✓');
  tdyIco.style.background = doneNow ? 'var(--ink-soft)' : 'var(--lavender)';
  tdy.appendChild(tdyIco);
  tdy.appendChild((() => {
    const m = el('div', 'row-main');
    m.appendChild(el('span', null, doneNow ? 'まだに戻す' : '今日はこの人OK'));
    m.appendChild(el('small', null, doneNow ? '「まだ」に戻して上に表示します' : 'チェック済みにして下に送ります'));
    return m;
  })());
  tdy.addEventListener('click', async () => { await setDoneManual(p, !doneNow); renderSheet((s) => buildDetail(s, id)); });
  sheet.appendChild(tdy);

  // 名前・アイコンを編集
  const edit = el('button', 'row-btn'); edit.type = 'button';
  const ei = el('span', 'row-ico', '✎'); ei.style.background = 'var(--lavender)';
  edit.appendChild(ei);
  edit.appendChild((() => { const m = el('div', 'row-main'); m.appendChild(el('span', null, '名前・アイコンを編集')); return m; })());
  edit.appendChild(el('span', 'row-arrow', '›'));
  edit.addEventListener('click', () => renderSheet((s) => buildEditPerson(s, id)));
  sheet.appendChild(edit);

  // SNSを足す
  const remaining = SNS_REGISTRY.filter((s) => !(p.accounts && p.accounts[s.key]));
  const addSns = el('button', 'row-btn' + (remaining.length ? '' : ' is-disabled')); addSns.type = 'button';
  const ai = el('span', 'row-ico', '＋'); ai.style.background = 'var(--lavender-dark)';
  addSns.appendChild(ai);
  addSns.appendChild((() => {
    const m = el('div', 'row-main');
    m.appendChild(el('span', null, 'SNSを足す'));
    m.appendChild(el('small', null, remaining.length ? 'この人に別のSNSを追加' : 'ぜんぶ追加ずみ'));
    return m;
  })());
  if (remaining.length) addSns.appendChild(el('span', 'row-arrow', '›'));
  addSns.addEventListener('click', () => { if (remaining.length) renderSheet((s) => buildDetailAddSNS(s, id)); });
  sheet.appendChild(addSns);

  // 登録中のSNS（外す）
  sheet.appendChild(el('div', 'sheet-section-label', '登録中のSNS'));
  for (const key of orderedAccountKeys(p)) {
    const s = snsByKey(key);
    const row = el('div', 'sns-manage-row');
    const ico = el('div', 'sns-manage-ico', s.icon); ico.style.background = s.color;
    const main = el('div', 'sns-manage-main');
    main.appendChild(el('b', null, s.label));
    main.appendChild(el('small', null, displayHandle(s, p.accounts[key].handle)));
    const rm = el('button', 'sns-manage-remove', '外す'); rm.type = 'button';
    rm.addEventListener('click', () => removeSNS(id, key));
    row.append(ico, main, rm);
    sheet.appendChild(row);
  }

  // note の最新記事（取れていれば）
  const noteAcc = p.accounts && p.accounts.note;
  if (noteAcc && noteAcc.latest) {
    sheet.appendChild(el('div', 'sheet-section-label', '最新の note'));
    const art = el('button', 'row-btn'); art.type = 'button';
    const aIco = el('span', 'row-ico', 'n'); aIco.style.background = snsByKey('note').color;
    art.appendChild(aIco);
    const am = el('div', 'row-main');
    am.appendChild(el('span', null, noteAcc.latest.title || '(無題)'));
    const meta = (isNoteNew(noteAcc) ? '🔴 新着　' : '') + (formatNoteDate(noteAcc.latest.publishAt) || '');
    if (meta.trim()) am.appendChild(el('small', null, meta));
    art.appendChild(am);
    art.appendChild(el('span', 'row-arrow', '›'));
    art.addEventListener('click', () => {
      openExternal(noteAcc.latest.url);
      if (noteAcc.latest) noteAcc.lastSeenArticleId = noteAcc.latest.id; // NEWを消す
      if (!p.today) p.today = { date: todayStr(), seen: [], doneManual: false };
      if (!p.today.seen.includes('note')) p.today.seen.push('note');     // 今日見たに記録
      idbPut(p).then(() => { renderAll(); renderSheet((s) => buildDetail(s, id)); });
    });
    sheet.appendChild(art);
  } else if (noteAcc && noteAcc.fetchError) {
    sheet.appendChild(el('div', 'sheet-section-label', '最新の note'));
    sheet.appendChild(el('div', 'note-warn', 'いまは取得できませんでした。上の ⟳ でもう一度ためせます。'));
  }

  // この人を削除
  const del = el('button', 'row-btn is-danger'); del.type = 'button';
  del.style.marginTop = '18px';
  const di = el('span', 'row-ico', '🗑'); di.style.background = 'var(--danger)';
  del.appendChild(di);
  del.appendChild((() => { const m = el('div', 'row-main'); m.appendChild(el('span', null, 'この人をおきにから削除')); return m; })());
  del.addEventListener('click', () => {
    confirmDialog({
      title: 'この人を削除しますか？',
      body: `「${p.name}」をおきにから消します。\nこの操作は取り消せません。`,
      danger: true, okLabel: '削除する',
      onOk: () => deletePerson(id),
    });
  });
  sheet.appendChild(del);
}

// 名前・アイコン編集
function buildEditPerson(sheet, id) {
  const p = getPerson(id);
  if (!p) { closeSheet(); return; }
  sheet.appendChild(backBtn(() => renderSheet((s) => buildDetail(s, id))));
  sheet.appendChild(titleEl('名前・アイコンを編集'));

  const nameField = el('div', 'field');
  nameField.appendChild(el('label', 'field-label', '名前'));
  const nameInput = el('input', 'text-input');
  nameInput.type = 'text'; nameInput.value = p.name;
  nameField.appendChild(nameInput);
  sheet.appendChild(nameField);

  sheet.appendChild(el('div', 'field-label', 'アイコン'));
  const noteImg = p.accounts && p.accounts.note && p.accounts.note.image;
  // note画像があれば既定で「画像」、絵文字に変えていれば「絵文字」
  let mode = (noteImg && p.avatarMode !== 'emoji') ? 'image' : 'emoji';
  let chosen = (p.avatar && !/^https?:/.test(p.avatar)) ? p.avatar : AVATAR_EMOJIS[0];
  if (noteImg) sheet.appendChild(el('div', 'field-hint', 'noteの人は本物の画像が既定。絵文字に変えることもできます。'));

  const grid = el('div', 'emoji-grid');
  const cells = [];
  const refresh = () => cells.forEach((c) => {
    const active = (mode === 'image' && c.dataset.kind === 'image') ||
                   (mode === 'emoji' && c.dataset.kind === 'emoji' && c.dataset.emoji === chosen);
    c.classList.toggle('is-active', active);
  });
  if (noteImg) {
    const c = el('button', 'emoji-pick'); c.type = 'button'; c.dataset.kind = 'image';
    const im = document.createElement('img'); im.src = noteImg; im.alt = 'note'; c.appendChild(im);
    c.addEventListener('click', () => { mode = 'image'; refresh(); });
    cells.push(c); grid.appendChild(c);
  }
  for (const e of AVATAR_EMOJIS) {
    const c = el('button', 'emoji-pick', e); c.type = 'button'; c.dataset.kind = 'emoji'; c.dataset.emoji = e;
    c.addEventListener('click', () => { mode = 'emoji'; chosen = e; refresh(); });
    cells.push(c); grid.appendChild(c);
  }
  refresh();
  sheet.appendChild(grid);

  const save = el('button', 'btn btn-primary btn-block', '保存する'); save.type = 'button';
  save.style.marginTop = '12px';
  save.addEventListener('click', async () => {
    const name = (nameInput.value || '').trim();
    if (!name) { toast('名前を入れてね'); return; }
    p.name = name;
    if (mode === 'emoji') { p.avatar = chosen; p.avatarMode = 'emoji'; }
    else { p.avatarMode = 'image'; } // noteの画像を使う（p.avatarは予備として残す）
    await idbPut(p);
    renderAll();
    renderSheet((s) => buildDetail(s, id));
    toast('保存しました');
  });
  sheet.appendChild(save);
}

// 既存の人にSNSを足す（SNSをえらぶ）
function buildDetailAddSNS(sheet, id) {
  const p = getPerson(id);
  if (!p) { closeSheet(); return; }
  sheet.appendChild(backBtn(() => renderSheet((s) => buildDetail(s, id))));
  sheet.appendChild(titleEl('SNSを足す'));
  sheet.appendChild(subEl(`「${p.name}」に追加`));
  const remaining = SNS_REGISTRY.filter((s) => !p.accounts[s.key]);
  for (const s of remaining) {
    const b = el('button', 'row-btn'); b.type = 'button';
    b.appendChild(snsBadge(s));
    b.appendChild((() => { const m = el('div', 'row-main'); m.appendChild(el('span', null, s.label)); return m; })());
    b.appendChild(el('span', 'row-arrow', '›'));
    b.addEventListener('click', () => renderSheet((sh) => buildDetailAddHandle(sh, id, s.key)));
    sheet.appendChild(b);
  }
}

// 既存の人にSNSを足す（ユーザー名）
function buildDetailAddHandle(sheet, id, snsKey) {
  const p = getPerson(id);
  const sns = snsByKey(snsKey);
  if (!p) { closeSheet(); return; }
  sheet.appendChild(backBtn(() => renderSheet((s) => buildDetailAddSNS(s, id))));
  sheet.appendChild(titleEl(`${sns.label} のユーザー名`));
  sheet.appendChild(subEl(`「${p.name}」に追加`));

  const field = el('div', 'field');
  field.appendChild(el('label', 'field-label', 'ユーザー名'));
  const input = el('input', 'text-input');
  input.type = 'text'; input.placeholder = sns.placeholder;
  input.autocomplete = 'off'; input.autocapitalize = 'off'; input.spellcheck = false;
  field.appendChild(input);
  field.appendChild(el('div', 'field-hint', sns.help));
  const preview = el('div', 'url-preview');
  field.appendChild(preview);
  sheet.appendChild(field);

  const add = el('button', 'btn btn-primary btn-block', '追加する'); add.type = 'button';
  add.disabled = true;
  sheet.appendChild(add);

  const update = () => {
    const clean = normalizeHandle(input.value, sns);
    preview.textContent = clean ? '飛び先：' + buildUrl(sns, clean) : '';
    add.disabled = !clean;
  };
  const submit = async () => {
    const handle = normalizeHandle(input.value, sns);
    if (!handle) return;
    const doAttach = async () => {
      p.accounts[snsKey] = makeAccount(snsKey, handle);
      await idbPut(p);
      renderAll();
      renderSheet((s) => buildDetail(s, id));
      toast(`${sns.label} を足しました`);
      if (snsKey === 'note') refreshNotes().catch(() => {});
    };
    // 同じSNS＋同じIDを別の人が持っていないか（同じ口座を2人に付けないように）
    const owner = findAccountOwner(snsKey, handle, id);
    if (owner) {
      confirmDialog({
        title: 'もう登録ずみみたい',
        body: `「${displayHandle(sns, handle)}」は すでに「${owner.name}」に登録されています。それでも「${p.name}」に付けますか？`,
        okLabel: 'それでも付ける',
        onOk: () => { doAttach(); },
      });
      return;
    }
    doAttach();
  };
  input.addEventListener('input', update);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !add.disabled) submit(); });
  add.addEventListener('click', submit);
  setTimeout(() => input.focus(), 50);
}

// SNSを外す（最後の1つなら＝その人を削除）
function removeSNS(id, key) {
  const p = getPerson(id);
  if (!p) return;
  const sns = snsByKey(key);
  const count = orderedAccountKeys(p).length;
  if (count <= 1) {
    confirmDialog({
      title: 'この人を削除しますか？',
      body: `${sns.label} は 「${p.name}」の最後のSNSです。\n外すと「${p.name}」はおきにから消えます。`,
      danger: true, okLabel: '削除する',
      onOk: () => deletePerson(id),
    });
    return;
  }
  confirmDialog({
    title: `${sns.label} を外しますか？`,
    body: `「${p.name}」から ${sns.label} を外します。`,
    danger: true, okLabel: '外す',
    onOk: async () => {
      delete p.accounts[key];
      await idbPut(p);
      renderAll();
      renderSheet((s) => buildDetail(s, id));
      toast(`${sns.label} を外しました`);
    },
  });
}

async function deletePerson(id) {
  const p = getPerson(id);
  const name = p ? p.name : '';
  state.people = state.people.filter((x) => x.id !== id);
  await idbDelete(id);
  closeSheet();
  renderAll();
  toast(`「${name}」を削除しました`);
}

/* 絵文字グリッド（選んだものを onPick で返す） */
function buildEmojiGrid(current, onPick) {
  const grid = el('div', 'emoji-grid');
  const cells = [];
  const list = AVATAR_EMOJIS.includes(current) ? AVATAR_EMOJIS : [current, ...AVATAR_EMOJIS];
  for (const e of list) {
    const c = el('button', 'emoji-pick' + (e === current ? ' is-active' : ''), e);
    c.type = 'button';
    c.addEventListener('click', () => {
      cells.forEach((x) => x.classList.remove('is-active'));
      c.classList.add('is-active');
      onPick(e);
    });
    cells.push(c);
    grid.appendChild(c);
  }
  return grid;
}

/* -----------------------------------------------------------
   10. 確認ダイアログ・トースト
   ----------------------------------------------------------- */
function confirmDialog({ title, body, okLabel = 'OK', cancelLabel = 'キャンセル', danger = false, onOk }) {
  $('#dialog-title').textContent = title;
  $('#dialog-body').textContent = body || '';
  const ok = $('#dialog-ok'); const cancel = $('#dialog-cancel');
  ok.textContent = okLabel; cancel.textContent = cancelLabel;
  document.querySelector('.dialog').classList.toggle('is-danger', !!danger);
  const bd = $('#dialog-backdrop');
  bd.hidden = false;
  const close = () => { bd.hidden = true; ok.onclick = null; cancel.onclick = null; bd.onclick = null; };
  ok.onclick = () => { close(); if (onOk) onOk(); };
  cancel.onclick = close;
  bd.onclick = (e) => { if (e.target === bd) close(); };
}

let toastTimer = null;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2200);
}

/* -----------------------------------------------------------
   11. 立ち上げ
   ----------------------------------------------------------- */
function bindGlobal() {
  $('#fab').addEventListener('click', openAddSheet);
  $('#backdrop').addEventListener('click', closeSheet);
  // 背景の上スワイプ等がPWA本体に伝わらないように（誤って閉じるのを防ぐ）
  $('#backdrop').addEventListener('touchmove', (e) => { e.preventDefault(); }, { passive: false });
  enableSheetDrag($('#sheet')); // シートを下スワイプで閉じられるように

  const reorderBtn = $('#reorder');
  if (reorderBtn) reorderBtn.addEventListener('click', toggleReorder);

  const refreshBtn = $('#refresh');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      if (refreshBtn.classList.contains('is-spinning')) return;
      refreshBtn.classList.add('is-spinning');
      let r = null;
      try { r = await refreshNotes({ force: true }); } catch (_) {}
      refreshBtn.classList.remove('is-spinning');
      if (!r || r.tried === 0) { toast('note の人がいません'); return; }
      if (r.newCount > 0) toast(`新着が ${r.newCount} 件あります`);
      else if (r.errCount === r.tried) toast('いまは更新できませんでした');
      else toast('新着はありません');
    });
  }

  // 日付がまたいだら自動リセット（起動時＋フォーカス復帰時／深夜またぎ対応）
  const onResume = async () => {
    if (document.visibilityState !== 'visible') return;
    if (await ensureToday()) renderAll();
  };
  document.addEventListener('visibilitychange', onResume);
  window.addEventListener('focus', onResume);
}

function registerSW() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    });
  }
}

async function init() {
  try {
    await openDB();
    state.people = await idbGetAll();
    await seedIfFirstRun();
    await ensureToday(); // 端末日付が変わっていれば今日の記録をリセット
  } catch (e) {
    console.error(e);
    toast('データの読み込みに失敗しました');
  }
  renderAll();
  bindGlobal();
  registerSW();
  refreshNotes().catch(() => {}); // 起動時にnoteの新着を静かにチェック
}

init();
