/* ===========================================================
   ファンノート  —  アプリ本体（Phase 1 / MVP）
   入っているもの：レジストリ・人カード・フィルターチップ・
   ページに飛ぶ・手動追加（新規/既存の紐付け確認つき）・削除・詳細シート
   入っていないもの（Phase 2以降）：note自動取得 / NEW / 日次チェック・沈み・リセット
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
];

const AVATAR_EMOJIS = ['🐰','🐱','🐶','🐻','🦊','🐼','🐨','🐹','🦄','🐧','🐤','🐸','🌸','🌷','⭐️','🍀','🎀','💜'];

/* -----------------------------------------------------------
   2. 状態
   ----------------------------------------------------------- */
const state = {
  people: [],     // 人の配列
  filter: 'all',  // 'all' か SNSキー
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
  if (key === 'note') acc.lastSeenArticleId = null; // Phase 2用に器だけ用意
  return acc;
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
   6. 画面を描く
   ----------------------------------------------------------- */
function renderAll() { renderChips(); renderList(); }

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
  const el = $('#list');
  el.innerHTML = '';
  let people = state.people.slice().sort((a, b) => (a.order || 0) - (b.order || 0));
  if (state.filter !== 'all') people = people.filter((p) => p.accounts && p.accounts[state.filter]);

  if (people.length === 0) { el.appendChild(emptyState()); return; }
  for (const p of people) el.appendChild(personCard(p));
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
        ? `まだ ${sns ? sns.label : ''} の人がいません。<br>下の「＋ おきに追加」から登録できます。`
        : 'まだ誰もいません。<br>下の「＋ おきに追加」から、<br>好きな人を登録してみてね。'
    }</div>`;
  return box;
}

function personCard(p) {
  const card = document.createElement('div');
  card.className = 'card';

  const top = document.createElement('div');
  top.className = 'card-top';

  const av = document.createElement('div');
  av.className = 'avatar';
  av.textContent = p.avatar || '🙂';

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
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sns-btn';
    btn.style.background = s.color;
    const lab = document.createElement('span'); lab.textContent = s.label;
    const hd = document.createElement('span'); hd.className = 'sns-handle'; hd.textContent = displayHandle(s, acc.handle);
    btn.append(lab, hd);
    btn.addEventListener('click', () => openUrl(s, acc.handle));
    snsRow.appendChild(btn);
  }
  card.appendChild(snsRow);
  return card;
}

/* ページに飛ぶ（開けないときはトーストで知らせるだけ・状態は壊さない） */
function openUrl(sns, handle) {
  const url = buildUrl(sns, handle);
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

/* -----------------------------------------------------------
   7. シート（下から出る画面）の土台
   ----------------------------------------------------------- */
function showSheet() { $('#backdrop').hidden = false; $('#sheet').hidden = false; }
function closeSheet() { $('#sheet').hidden = true; $('#backdrop').hidden = true; addDraft = null; }
function renderSheet(buildFn) {
  const sheet = $('#sheet');
  sheet.innerHTML = '';
  const h = document.createElement('div'); h.className = 'sheet-handle'; sheet.appendChild(h);
  buildFn(sheet);
  sheet.scrollTop = 0;
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

// 8-4a 新しい人（名前＋アバター）
function buildAddStepNew(sheet) {
  const sns = snsByKey(addDraft.snsKey);
  const hasWhoStep = state.people.length > 0;
  sheet.appendChild(backBtn(() => renderSheet(hasWhoStep ? buildAddStepWho : buildAddStepHandle)));
  sheet.appendChild(titleEl('新しい人'));
  sheet.appendChild(subEl(`${sns.label}：${displayHandle(sns, addDraft.handle)}`));

  const nameField = el('div', 'field');
  nameField.appendChild(el('label', 'field-label', '名前（あとで変えられます）'));
  const nameInput = el('input', 'text-input');
  nameInput.type = 'text';
  nameInput.value = addDraft.name != null ? addDraft.name : addDraft.handle;
  nameInput.placeholder = '名前';
  nameField.appendChild(nameInput);
  sheet.appendChild(nameField);

  sheet.appendChild(el('div', 'field-label', 'アイコン'));
  let chosen = addDraft.avatar || AVATAR_EMOJIS[Math.floor(Math.random() * AVATAR_EMOJIS.length)];
  const grid = buildEmojiGrid(chosen, (v) => { chosen = v; });
  sheet.appendChild(grid);

  const add = el('button', 'btn btn-primary btn-block', 'この人を追加する');
  add.type = 'button';
  add.style.marginTop = '12px';
  add.addEventListener('click', async () => {
    const name = (nameInput.value || '').trim() || addDraft.handle;
    await createPerson({ name, avatar: chosen, snsKey: addDraft.snsKey, handle: addDraft.handle });
    closeSheet();
    renderAll();
    toast(`「${name}」を追加しました`);
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
    const av = el('div', 'avatar', p.avatar || '🙂');
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

/* 既存の人にSNSを足す（重複していたら置き換え確認） */
function attachToPerson(person, snsKey, handle) {
  const sns = snsByKey(snsKey);
  if (person.accounts && person.accounts[snsKey]) {
    confirmDialog({
      title: `すでに${sns.label}登録ずみ`,
      body: `${person.name}さんは すでに ${sns.label} が登録されています。\n新しい「${displayHandle(sns, handle)}」に置き換えますか？`,
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
  toast(replaced ? `${person.name}さんの ${sns.label} を変えました` : `${person.name}さんに ${sns.label} を足しました`);
}

async function createPerson({ name, avatar, snsKey, handle }) {
  const maxOrder = state.people.reduce((m, p) => Math.max(m, p.order || 0), 0);
  const person = {
    id: uid(), name, avatar: avatar || '🙂', order: maxOrder + 1,
    accounts: {}, today: { date: todayStr(), seen: [], doneManual: false },
  };
  person.accounts[snsKey] = makeAccount(snsKey, handle);
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
  const av = el('div', 'avatar', p.avatar || '🙂');
  av.style.margin = '0 auto 8px'; av.style.width = '56px'; av.style.height = '56px'; av.style.fontSize = '30px';
  head.appendChild(av);
  head.appendChild(titleEl(p.name));
  sheet.appendChild(head);

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
  let chosen = p.avatar || '🙂';
  sheet.appendChild(buildEmojiGrid(chosen, (v) => { chosen = v; }));

  const save = el('button', 'btn btn-primary btn-block', '保存する'); save.type = 'button';
  save.style.marginTop = '12px';
  save.addEventListener('click', async () => {
    const name = (nameInput.value || '').trim();
    if (!name) { toast('名前を入れてね'); return; }
    p.name = name; p.avatar = chosen;
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
  sheet.appendChild(subEl(`${p.name}さんに追加`));
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
  sheet.appendChild(subEl(`${p.name}さんに追加`));

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
    const clean = normalizeHandle(input.value, sns);
    if (!clean) return;
    p.accounts[snsKey] = makeAccount(snsKey, clean);
    await idbPut(p);
    renderAll();
    renderSheet((s) => buildDetail(s, id));
    toast(`${sns.label} を足しました`);
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
      body: `${sns.label} は ${p.name}さんの最後のSNSです。\n外すと「${p.name}」はおきにから消えます。`,
      danger: true, okLabel: '削除する',
      onOk: () => deletePerson(id),
    });
    return;
  }
  confirmDialog({
    title: `${sns.label} を外しますか？`,
    body: `${p.name}さんから ${sns.label} を外します。`,
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
  } catch (e) {
    console.error(e);
    toast('データの読み込みに失敗しました');
  }
  renderAll();
  bindGlobal();
  registerSW();
}

init();
