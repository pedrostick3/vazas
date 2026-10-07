(() => {
const E = VazasEngine;
const $ = s => document.querySelector(s);
const app = $('#app'), cardsLayer = $('#cards'), seatsLayer = $('#seats');
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const SAVE = 'vazas.save.v2', PREF = 'vazas.prefs.v2', ROOMKEY = 'vazas.room.v1', LOCALID = 'vazas.localid';
const BOT_NAMES = ['Pat', 'Cat', 'Leo', 'Rui', 'Ana', 'Zé', 'Bia', 'Tó', 'Mia', 'Gil'];
const COLORS = ['#E0A526', '#8FB8F0', '#F2A3A3', '#9BD39B', '#D7B7F2', '#F5C27A', '#7FD6C9', '#F59FC8', '#C2D46B', '#B3B8C7'];
const LEVEL_NAME = { easy: 'Fácil', normal: 'Normal', hard: 'Difícil' };

const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
const load = k => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } };
const drop = k => { try { localStorage.removeItem(k); } catch (e) {} };
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clone = o => JSON.parse(JSON.stringify(o));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rid = () => Math.random().toString(36).slice(2, 10);

let prefs = Object.assign({ name: 'Tu', bots: 3, localNames: ['Jogador 1', 'Jogador 2'], localBots: 1, level: 'normal', mode: 'solo', dealerRule: false, dealAll: false, upDown: true,
  trumpRotation: false, mustTrump: false, hint: false, four: false, fast: true }, load(PREF) || {});
if (!load(PREF)) { const old = load('vazas.prefs.v1'); if (old) { Object.assign(prefs, old); if (old.players) prefs.bots = old.players - 1; } }
prefs.bots = clamp(prefs.bots | 0, 2, 9);
const settingsFromPrefs = () => ({ fullDeck: !!prefs.fullDeck, dealerRule: prefs.dealerRule, dealAll: prefs.dealAll, upDown: prefs.upDown, trumpRotation: prefs.trumpRotation, mustTrump: prefs.mustTrump });

/* estado global */
let mode = null;          // 'solo' | 'local' (vários no mesmo telemóvel) | 'host' | 'guest'
let revealed = true, lastActor = -1, passing = false; // modo 'local': mão visível? quem jogou por último?
const hot = () => mode === 'local';
const you = i => i === me && !hot();
const offline = () => mode === 'solo' || mode === 'local';
let me = 0;               // o meu lugar (-1 = espectador)
let st = null;            // estado autoritativo (solo/anfitrião) ou último recebido (convidado)
let view = null;          // o que está desenhado
let gameId = 0;
let els = {}, rotMap = {}, geom = {}, selected = null, trumpVisible = false;
let queue = [], rendering = false, idleWait = [];
let driving = false, pending = false, pendingTimer = null, lastPrompt = '';
const net = { tried: false, ok: false, db: null, user: null, uid: null, code: null, room: null, members: [], unsubs: [], actionsUnsub: null, isHost: false, writing: false, dirty: false };

const mult = () => (prefs.fast ? 0.55 : 1);
const D = ms => (reduce ? 1 : ms * mult());
const sleep = ms => new Promise(r => setTimeout(r, ms * mult() * (reduce ? 0.6 : 1)));

/* ================= cartas ================= */
const NAMES = { A: 'Ás', '7': 'Sete', K: 'Rei', J: 'Valete', Q: 'Dama' };
const cardName = id => (NAMES[id.slice(1)] || id.slice(1)) + ' de ' + E.SUIT_NAME[id[0]];
function makeCard(id) {
  const s = id[0], r = id.slice(1), sym = E.SUIT_SYM[s], lab = E.RANK_LABEL[r];
  const el = document.createElement('div');
  el.className = 'card s-' + s + (E.RED[s] ? ' red' : '');
  el.dataset.id = id;
  const mid = ['K', 'J', 'Q'].includes(r) ? `<div class="faceL" data-s="${sym}">${lab}</div>` : `<div class="pip">${sym}</div>`;
  el.innerHTML = `<div class="inner"><div class="face"><div class="idx"><span>${lab}</span><span>${sym}</span></div>${mid}<div class="idx br"><span>${lab}</span><span>${sym}</span></div></div><div class="back"></div></div>`;
  return el;
}
function getEl(id) { if (!els[id]) { els[id] = makeCard(id); cardsLayer.appendChild(els[id]); } return els[id]; }
function setFace(el, up, anim) {
  if (el._face === up) return;
  el._face = up;
  if (up) { el.setAttribute('role', 'img'); el.setAttribute('aria-label', cardName(el.dataset.id)); }
  else { el.removeAttribute('role'); el.removeAttribute('aria-label'); }
  const inner = el.firstChild;
  anime.remove(inner);
  if (!anim) anime.set(inner, { rotateY: up ? 0 : 180 });
  else anime({ targets: inner, rotateY: up ? 0 : 180, duration: D(440), easing: 'easeInOutCubic' });
}
const rotOf = id => (rotMap[id] ??= (Math.random() - 0.5) * 24);
function clearCards() {
  anime.remove(cardsLayer.querySelectorAll('.card, .inner'));
  cardsLayer.innerHTML = ''; els = {}; rotMap = {}; selected = null; trumpVisible = false;
  document.querySelectorAll('.trumpLabel,.bubble,.float').forEach(n => n.remove());
}

/* ================= geometria ================= */
const NP = () => (view ? view.players.length : 4);
const meSeat = () => (me >= 0 ? me : 0);
const rel = i => (i - meSeat() + NP()) % NP();
function measure() {
  const W = app.clientWidth, H = app.clientHeight;
  const cw = Math.round(Math.max(46, Math.min(84, W / 6.2, H / 9.6)));
  const ch = Math.round(cw * 1.45);
  app.style.setProperty('--cw', cw + 'px'); app.style.setProperty('--ch', ch + 'px');
  const hud = 56, handY = H - ch * 0.5 - 14, meY = handY - ch * 0.5 - 36;
  const top = hud + 8, bottom = meY - 28;
  geom = { W, H, cw, ch, hud, handY, meY, cx: W / 2, cy: (top + bottom) / 2 + 6, rx: Math.min(W / 2 - 52, 400), ry: (bottom - top) / 2 - 10 };
  seatsLayer.classList.toggle('compact', NP() > 6);
}
function seatXY(i) {
  const r = rel(i), N = NP();
  if (r === 0) return { x: geom.cx, y: geom.meY, a: Math.PI / 2 };
  const gap = N <= 5 ? 360 / N : 60;
  const a = (90 + gap + (360 - 2 * gap) * (r - 1) / Math.max(1, N - 2)) * Math.PI / 180;
  const x = clamp(geom.cx + geom.rx * Math.cos(a), 46, geom.W - 46);
  const y = Math.max(geom.cy + geom.ry * Math.sin(a) * 0.92, geom.hud + 54);
  return { x, y, a };
}
const trumpXY = () => ({ x: 16 + geom.cw * 0.85 / 2, y: geom.hud + 10 + geom.ch * 0.85 / 2 });

function targets() {
  const T = {}, N = NP(), { cw, ch, cx, cy, handY, W } = geom;
  const big = N > 6;
  view.players.forEach((p, i) => {
    if (i === me) {
      const hand = p.hand, n = hand.length, span = Math.min(W * 0.94, 640) - cw;
      const step = n > 1 ? Math.min(cw * 0.92, span / (n - 1)) : 0, start = cx - step * (n - 1) / 2;
      hand.forEach((id, k) => {
        const t = n > 1 ? (k - (n - 1) / 2) / (n - 1) : 0;
        T[id] = { x: start + step * k, y: handY + Math.abs(t) * 10 - (selected === id ? 20 : 0), rot: t * 8, scale: 1, z: 200 + k,
          face: !hot() || revealed || (view.trumpInHand && id === view.trumpCard) };
      });
      return;
    }
    const s = seatXY(i), h = p.hand, m = h.length;
    const dx = cx - s.x, dy = cy - s.y, L = Math.hypot(dx, dy) || 1;
    const off = (big ? 52 : 62) + (big ? 26 : 40) * Math.abs(dx / L);
    const bx = s.x + dx / L * off, by = s.y + dy / L * off, px = -dy / L, py = dx / L;
    const base = Math.atan2(dy, dx) * 180 / Math.PI - 90, spread = big ? 3.5 : 7;
    h.forEach((id, k) => {
      const o = k - (m - 1) / 2, shown = view.trumpInHand && id === view.trumpCard;
      T[id] = { x: bx + px * o * spread, y: by + py * o * spread, rot: base + o * 4, scale: (big ? 0.32 : 0.42) * (shown ? 1.3 : 1), z: shown ? 199 : 150 + k, face: shown };
    });
  });
  const rX = cw * (big ? 1.15 : 0.75), rY = ch * (big ? 0.62 : 0.48), ts = big ? 0.78 : 1;
  view.trick.forEach((t, k) => {
    const a = seatXY(t.player).a;
    T[t.card] = { x: cx + Math.cos(a) * rX, y: cy + Math.sin(a) * rY, rot: rotOf(t.card), scale: ts, z: 300 + k, face: true };
  });
  if (view.trumpCard && trumpVisible && !view.trumpInHand) { const p = trumpXY(); T[view.trumpCard] = { ...p, rot: -8, scale: 0.85, z: 120, face: true }; }
  return T;
}
function applyLayout(dur = 0, easing = 'easeOutCubic') {
  const T = targets(), proms = [];
  for (const id in T) {
    const t = T[id], el = getEl(id);
    el.style.zIndex = t.z;
    const props = { translateX: t.x - geom.cw / 2, translateY: t.y - geom.ch / 2, rotate: t.rot, scale: t.scale };
    anime.remove(el);
    if (!dur) { anime.set(el, props); setFace(el, t.face, false); }
    else { proms.push(anime({ targets: el, ...props, duration: D(dur), easing }).finished); setFace(el, t.face, true); }
  }
  return Promise.all(proms);
}
function placeTrumpLabel() {
  document.querySelectorAll('.trumpLabel').forEach(n => n.remove());
  if (!view || !view.trumpCard || !trumpVisible || view.trumpInHand) return;
  const p = trumpXY(), d = document.createElement('div');
  d.className = 'trumpLabel'; d.textContent = 'trunfo';
  d.style.left = p.x + 'px'; d.style.top = (p.y + geom.ch * 0.43 + 2) + 'px';
  app.appendChild(d);
}

/* ================= HUD e lugares ================= */
function renderHUD() {
  if (!view) return;
  const n = E.cardsThisRound(view);
  $('#roundPill').innerHTML = `Ronda ${view.roundIdx + 1}/${view.sizes.length}<small>${n} ${n === 1 ? 'carta' : 'cartas'}</small>`;
  const sym = $('#trumpToken .sym');
  sym.textContent = E.SUIT_SYM[view.trump]; sym.classList.toggle('red', E.RED[view.trump]);
  $('#trumpName').textContent = E.SUIT_NAME[view.trump];
  $('#trumpToken').setAttribute('aria-label', 'Trunfo: ' + E.SUIT_NAME[view.trump]);
}
function pipsHTML(p) {
  if (p.bid == null) return '';
  let h = '';
  for (let k = 0; k < Math.max(p.bid, p.tricks); k++) h += `<span class="pipd ${k < p.tricks ? (k < p.bid ? 'on' : 'over') : ''}"></span>`;
  return h;
}
function renderSeats() {
  if (!view) return;
  seatsLayer.innerHTML = '';
  view.players.forEach((p, i) => {
    const s = seatXY(i), d = document.createElement('div');
    const active = (view.phase === 'bidding' || view.phase === 'playing') && view.turn === i;
    d.className = 'seat' + (rel(i) === 0 ? ' me' : '') + (active ? ' active' : '');
    d.style.left = s.x + 'px'; d.style.top = s.y + 'px';
    const bid = p.bid == null ? '' : `aposta <b>${p.bid}</b>`;
    d.innerHTML = `<div class="avatar" style="background:${COLORS[i % 10]}">${esc((p.name[0] || '?').toUpperCase())}${i === view.dealer ? '<span class="dealer" title="Dador">D</span>' : ''}</div>
      <div><div class="sname">${esc(p.name)} · ${E.total(p)}</div><div class="sbid">${bid}</div><div class="pips">${pipsHTML(p)}</div></div>`;
    seatsLayer.appendChild(d);
  });
}
function popPip(i) {
  const p = view.players[i], seat = seatsLayer.children[i];
  if (!seat || !p.tricks) return;
  const pip = seat.querySelectorAll('.pipd')[p.tricks - 1];
  if (pip) anime({ targets: pip, scale: [0, 1.5, 1], duration: D(500), easing: 'easeOutBack' });
}
function toast(msg, ms = 1000) {
  const t = $('#toast');
  t.textContent = msg;
  t.style.top = ((geom.cy + geom.ch * 0.98) + (geom.meY - 30)) / 2 + 'px';
  anime.remove(t);
  anime({ targets: t, opacity: [{ value: 1, duration: D(200) }, { value: 0, duration: D(300), delay: ms }],
    translateX: ['-50%', '-50%'], translateY: ['-30%', '-50%'], easing: 'easeOutQuad' });
}
function bubble(i, text) {
  const s = seatXY(i), b = document.createElement('div');
  b.className = 'bubble'; b.textContent = text;
  let bx = s.x, by = s.y - (rel(i) === 0 ? 46 : 58);
  if (by < geom.hud + 22) { bx = clamp(s.x + 84, 50, geom.W - 50); by = s.y - 8; }
  b.style.left = bx + 'px'; b.style.top = by + 'px';
  app.appendChild(b);
  anime({ targets: b, translateX: ['-50%', '-50%'], translateY: ['-10%', '-50%'], scale: [0.4, 1],
    opacity: [{ value: 1, duration: D(250) }, { value: 0, duration: D(300), delay: D(900) }],
    duration: D(400), easing: 'easeOutBack', complete: () => b.remove() });
}

/* ================= desenho por transições ================= */
function pushState(s) {
  pending = false; clearTimeout(pendingTimer);
  queue.push(clone(s));
  if (!rendering) drain();
}
async function drain() {
  rendering = true;
  const g = gameId;
  while (queue.length) {
    const next = queue.shift();
    try { await transition(view, next, g); }
    catch (e) { console.error(e); if (g === gameId) hardSync(next); }
    if (g !== gameId) { rendering = false; return; }
  }
  rendering = false;
  idleWait.splice(0).forEach(r => r());
  afterRender();
}
const idle = () => (rendering || queue.length ? new Promise(r => idleWait.push(r)) : Promise.resolve());

function hardSync(s) {
  clearCards(); view = clone(s); measure(); trumpVisible = true;
  renderHUD(); renderSeats(); applyLayout(0); placeTrumpLabel();
  if (view.trumpCard && els[view.trumpCard]) els[view.trumpCard].classList.add('win');
}
const playOrder = s => s.players.map((_, k) => (s.dealer + 1 + k) % s.players.length);

async function transition(prev, next, g) {
  const newGame = !prev || prev.gid !== next.gid;
  if (newGame || prev.roundIdx !== next.roundIdx) {
    closeModal(); hideBidPanel();
    const fresh = next.played.length === 0 && next.trick.length === 0 && (next.phase === 'bidding' || next.phase === 'playing');
    if (fresh && (newGame ? next.roundIdx === 0 : next.roundIdx === prev.roundIdx + 1)) {
      const bids = next.players.map(p => p.bid);
      view = clone(next); view.players.forEach(p => (p.bid = null));
      if (hot()) revealed = false;
      await dealAnimation(g);
      if (g !== gameId) return;
      for (const i of playOrder(next)) if (bids[i] != null) { view.players[i].bid = bids[i]; bubble(i, (you(i) ? 'aposto ' : 'aposta ') + bids[i]); }
      view = clone(next); renderSeats();
      return;
    }
    hardSync(next);
    if (next.phase === 'roundEnd') { await roundFloats(); if (g === gameId) openRoundSheet(); }
    if (next.phase === 'gameEnd') showPodium();
    return;
  }
  for (const i of playOrder(next)) {
    if (view.players[i].bid == null && next.players[i].bid != null) {
      view.players[i].bid = next.players[i].bid; view.turn = (i + 1) % NP();
      renderSeats(); bubble(i, (you(i) ? 'aposto ' : 'aposta ') + next.players[i].bid);
      await sleep(140);
    }
  }
  const done = (next.trickNo || 0) - (view.trickNo || 0);
  if (done > 1) { hardSync(next); }
  else {
    if (done === 1) {
      for (const t of next.lastTrick.cards) if (!view.trick.some(x => x.card === t.card)) { await playInto(t); if (g !== gameId) return; }
      await collect(next.lastTrick.winner, next.lastTrick.cards, g);
      if (g !== gameId) return;
      view.trickNo = next.trickNo;
    }
    for (const t of next.trick) if (!view.trick.some(x => x.card === t.card)) { await playInto(t); if (g !== gameId) return; }
  }
  const was = view.phase;
  view = clone(next); renderHUD(); renderSeats();
  await applyLayout(180);
  if (next.phase === 'roundEnd' && was !== 'roundEnd') { await roundFloats(); if (g === gameId) openRoundSheet(); }
  if (next.phase === 'gameEnd' && was !== 'gameEnd') showPodium();
}
async function playInto(t) {
  const h = view.players[t.player].hand, k = h.indexOf(t.card);
  if (k >= 0) h.splice(k, 1);
  view.trick.push(t); view.turn = (t.player + 1) % NP();
  renderSeats();
  await applyLayout(380, 'easeOutBack');
}
async function collect(w, cards, g) {
  await sleep(380);
  const wc = cards.find(t => t.player === w).card;
  els[wc]?.classList.add('win');
  view.players[w].tricks++; view.turn = -1;
  renderSeats(); popPip(w);
  toast(you(w) ? 'Ganhaste a vaza' : view.players[w].name + ' ganha a vaza', 650);
  if (els[wc]) await anime({ targets: els[wc], scale: [1, 1.12, 1], duration: D(420), easing: 'easeInOutQuad' }).finished;
  if (g !== gameId) return;
  const s = seatXY(w), list = cards.map(t => els[t.card]).filter(Boolean);
  await anime({ targets: list, translateX: s.x - geom.cw / 2, translateY: s.y - geom.ch / 2, scale: 0.25, opacity: 0, rotate: '+=25',
    delay: anime.stagger(D(50)), duration: D(450), easing: 'easeInCubic' }).finished;
  cards.forEach(t => { els[t.card]?.remove(); delete els[t.card]; });
  view.trick = [];
  await applyLayout(240);
}
async function dealAnimation(g) {
  clearCards(); measure(); renderHUD(); renderSeats();
  const ds = seatXY(view.dealer);
  const dk = { x: ds.x + (geom.cx - ds.x) * 0.35, y: ds.y + (geom.cy - ds.y) * 0.35 };
  const ids = view.dealOrder.map(d => d[1]);
  if (view.trumpCard && !view.trumpInHand) ids.push(view.trumpCard);
  ids.forEach((id, k) => {
    const el = getEl(id); setFace(el, false, false);
    anime.set(el, { translateX: dk.x - geom.cw / 2, translateY: dk.y - geom.ch / 2 - k * 0.4, rotate: (Math.random() - 0.5) * 6, scale: 0.8 });
    el.style.zIndex = 500 + ids.length - k;
  });
  toast(view.players[view.dealer].name + ' dá as cartas', 700);
  await sleep(350);
  const T = targets(), step = Math.min(90, 2600 / view.dealOrder.length);
  await Promise.all(view.dealOrder.map(([, id], k) => {
    const t = T[id], el = els[id];
    return anime({ targets: el, translateX: t.x - geom.cw / 2, translateY: t.y - geom.ch / 2, rotate: t.rot, scale: t.scale,
      delay: D(k * step), duration: D(420), easing: 'easeOutCubic', begin: () => (el.style.zIndex = t.z) }).finished;
  }));
  if (g !== gameId) return;
  const showMine = me >= 0 && (!hot() || revealed);
  if (showMine) view.players[me].hand.forEach((id, k) => setTimeout(() => els[id] && setFace(els[id], true, true), D(k * 50)));
  await sleep(300 + (showMine ? view.players[me].hand.length * 50 : 0));
  trumpVisible = true;
  if (view.trumpInHand) {
    const el = els[view.trumpCard], back = targets()[view.trumpCard];
    el.style.zIndex = 900;
    await anime({ targets: el, translateX: geom.cx - geom.cw / 2, translateY: geom.cy - geom.ch / 2, rotate: 0, scale: 1.1, duration: D(450), easing: 'easeOutCubic' }).finished;
    setFace(el, true, true); el.classList.add('win');
    toast(view.players[view.dealer].name + ' vira a última carta', 900);
    await sleep(1100);
    if (g !== gameId) return;
    el.style.zIndex = back.z;
    await anime({ targets: el, translateX: back.x - geom.cw / 2, translateY: back.y - geom.ch / 2, rotate: back.rot, scale: back.scale, duration: D(450), easing: 'easeInOutCubic' }).finished;
    setFace(el, back.face, true);
  } else if (view.trumpCard) {
    const el = els[view.trumpCard], p = trumpXY();
    el.style.zIndex = 120;
    await anime({ targets: el, translateX: p.x - geom.cw / 2, translateY: p.y - geom.ch / 2, rotate: -8, scale: [{ value: 1.15, duration: D(300) }, { value: 0.85, duration: D(300) }], duration: D(600), easing: 'easeOutCubic' }).finished;
    setFace(el, true, true); el.classList.add('win'); placeTrumpLabel();
  } else {
    anime({ targets: '#trumpToken .sym', scale: [1, 1.5, 1], rotate: [0, 360], duration: D(700), easing: 'easeInOutBack' });
  }
  toast('Trunfo: ' + E.SUIT_NAME[view.trump] + ' ' + E.SUIT_SYM[view.trump], 900);
  await sleep(700);
}

/* ================= interação ================= */
const myTurn = () => view && me >= 0 && view.turn === me && !pending && !rendering && !queue.length;
function afterRender() {
  if (!view || !mode) return;
  if (hot() && (view.phase === 'bidding' || view.phase === 'playing') && !pending && !rendering && !queue.length && !passing) {
    const t = view.turn;
    if (t >= 0 && !view.players[t].isBot && !(t === me && revealed)) {
      if (t === me && lastActor === me) { revealed = true; applyLayout(300); }
      else { handoff(t); return; }
    }
  }
  if (view.phase === 'bidding' && myTurn()) showBidPanel(); else hideBidPanel();
  if (view.phase === 'playing' && myTurn()) {
    markPlayable();
    const key = `${view.gid}:${view.roundIdx}:${view.trickNo}:${view.trick.length}`;
    if (lastPrompt !== key) { lastPrompt = key; const nm = hot() ? ', ' + view.players[me].name : ''; toast((view.trick.length ? 'A tua vez' : 'Abres tu a vaza') + nm, 900); }
  } else clearPlayable();
}
function markPlayable() {
  const legal = E.legalPlays(view, me);
  view.players[me].hand.forEach(id => {
    const ok = legal.includes(id), el = els[id];
    if (!el) return;
    el.classList.toggle('illegal', !ok); el.classList.toggle('playable', ok); el.tabIndex = ok ? 0 : -1;
  });
}
function clearPlayable() { Object.values(els).forEach(el => { el.classList.remove('illegal', 'playable'); el.tabIndex = -1; }); }

function act(type, value) {
  pending = true; hideBidPanel(); clearPlayable();
  if (hot()) lastActor = me;
  if (mode === 'guest') return sendAction(type, value);
  try { if (type === 'bid') E.placeBid(st, me, value); else E.playCard(st, me, value); }
  catch (e) { pending = false; afterRender(); return; }
  commit(); drive();
}
function tryPlay(id, direct) {
  if (!myTurn() || view.phase !== 'playing' || !view.players[me].hand.includes(id)) return;
  if (!E.legalPlays(view, me).includes(id)) {
    anime({ targets: els[id].firstChild, translateX: [0, -7, 7, -5, 5, 0], duration: D(320), easing: 'linear' });
    toast('Tens de assistir a ' + E.SUIT_NAME[view.trick[0].card[0]], 1100);
    return;
  }
  const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
  if (!direct && !fine && selected !== id) { selected = id; applyLayout(160); return; }
  selected = null;
  act('play', id);
}
cardsLayer.addEventListener('click', e => { const el = e.target.closest('.card'); if (el) tryPlay(el.dataset.id, false); });
cardsLayer.addEventListener('keydown', e => {
  const el = e.target.closest('.card'); if (!el) return;
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tryPlay(el.dataset.id, true); }
  if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && me >= 0) {
    const list = view.players[me].hand.map(id => els[id]).filter(x => x && x.tabIndex === 0);
    const k = list.indexOf(el), nx = list[(k + (e.key === 'ArrowRight' ? 1 : -1) + list.length) % list.length];
    if (nx) nx.focus();
  }
});

function showBidPanel() {
  const panel = $('#bidPanel');
  if (panel.style.display === 'block') return;
  const n = E.cardsThisRound(view), legal = E.legalBids(view, me);
  $('#bidPanel h2').textContent = hot() ? `${view.players[me].name}, quantas vazas fazes?` : 'Quantas vazas fazes?';
  $('#bidSub').textContent = `${n} ${n === 1 ? 'carta' : 'cartas'}, trunfo ${E.SUIT_SYM[view.trump]} ${E.SUIT_NAME[view.trump]}`;
  const btns = $('#bidBtns'); btns.innerHTML = '';
  for (let b = 0; b <= n; b++) {
    const bt = document.createElement('button');
    bt.textContent = b; bt.setAttribute('aria-label', 'Apostar ' + b);
    if (!legal.includes(b)) { bt.disabled = true; bt.title = 'Regra do dador: a soma não pode dar ' + n; }
    bt.onclick = () => act('bid', b);
    btns.appendChild(bt);
  }
  const done = playOrder(view).filter(i => view.players[i].bid != null);
  const sum = done.reduce((a, i) => a + view.players[i].bid, 0);
  const after = playOrder(view).slice(playOrder(view).indexOf(me) + 1).map(i => view.players[i].name);
  $('#bidOthers').textContent = (done.length
    ? `Já apostaram: ${done.map(i => view.players[i].name + ' ' + view.players[i].bid).join(', ')}. Soma ${sum} de ${n}.`
    : 'És o primeiro a apostar.') + (after.length ? ` Depois de ti: ${after.join(', ')}.` : ' És o último a apostar.');
  $('#bidHint').textContent = prefs.hint ? `A tua mão vale cerca de ${E.estimateTricks(view.players[me].hand, view.trump, NP()).toFixed(1).replace('.', ',')} vazas` : '';
  panel.style.display = 'block';
  panel.style.top = Math.max(geom.hud + panel.offsetHeight / 2 + 8, geom.meY - 34 - panel.offsetHeight / 2) + 'px';
  anime.remove(panel);
  anime({ targets: panel, translateX: ['-50%', '-50%'], translateY: ['-40%', '-50%'], opacity: [0, 1], scale: [0.94, 1], duration: D(320), easing: 'easeOutCubic' });
}
function hideBidPanel() { $('#bidPanel').style.display = 'none'; }

/* ================= folha, pódio ================= */
function sheetHTML(s, animateRow) {
  const P = s.players, totals = P.map(E.total), best = Math.max(...totals);
  let h = '<div style="overflow-x:auto"><table class="sheet"><thead><tr><th aria-label="Cartas"></th>' + P.map(p => `<th>${esc(p.name)}</th>`).join('') + '</tr></thead><tbody>';
  s.sizes.forEach((n, r) => {
    const now = r === animateRow;
    h += `<tr${now ? ' class="now"' : ''}><td>${n}</td>` + P.map(p => {
      const sc = p.scores[r];
      if (!sc) return '<td></td>';
      return `<td class="${sc.pts ? 'hit' : 'miss'}" title="Apostou ${sc.bid}, fez ${sc.tricks}"><span class="ink"${now ? ' style="clip-path:inset(0 100% 0 0)"' : ''}>${sc.pts}<small>${sc.bid}/${sc.tricks}</small></span></td>`;
    }).join('') + '</tr>';
  });
  h += '<tr class="total"><td>Total</td>' + totals.map(t => `<td><span class="ink${t === best && t > 0 ? ' lead' : ''}"${animateRow != null ? ' style="clip-path:inset(0 100% 0 0)"' : ''}>${t}</span></td>`).join('') + '</tr></tbody></table></div>';
  return h;
}
function inkIn() {
  anime({ targets: '#paper tr.now .ink, #paper tr.total .ink', clipPath: ['inset(0 100% 0 0)', 'inset(0 0% 0 0)'],
    delay: anime.stagger(D(110), { start: D(380) }), duration: D(420), easing: 'easeInOutSine' });
}
function openModal(html) {
  const m = $('#modal'), p = $('#paper');
  p.innerHTML = html; m.classList.add('open'); p.scrollTop = 0;
  anime.remove(p);
  anime({ targets: p, translateY: [40, 0], rotate: [-2.5, -0.6], opacity: [0, 1], duration: D(480), easing: 'easeOutCubic' });
  p.querySelector('.actions .btn:not(:disabled):last-child')?.focus({ preventScroll: true });
}
const closeModal = () => $('#modal').classList.remove('open');

async function roundFloats() {
  const r = view.roundIdx;
  await Promise.all(view.players.map((p, i) => {
    const s = seatXY(i), sc = p.scores[r], f = document.createElement('div');
    if (!sc) return null;
    f.className = 'float ' + (sc.pts ? 'hit' : 'miss'); f.textContent = sc.pts ? '+' + sc.pts : '0';
    f.style.left = s.x + 'px'; f.style.top = (s.y - 34) + 'px'; f.style.opacity = 0;
    app.appendChild(f);
    return anime({ targets: f, translateX: ['-50%', '-50%'], translateY: ['-50%', '-160%'], scale: [0.6, 1],
      opacity: [{ value: 1, duration: D(220) }, { value: 0, duration: D(380), delay: D(700) }],
      duration: D(1300), delay: D(i * 90), easing: 'easeOutQuad', complete: () => f.remove() }).finished;
  }));
}
const hostName = () => { const h = view.players.find(p => net.room && p.uid === net.room.host); return h ? h.name : 'o anfitrião'; };
function openRoundSheet() {
  const last = E.isLastRound(view);
  let line = '';
  if (me >= 0 && !hot()) {
    const sc = view.players[me].scores[view.roundIdx];
    line = sc.pts ? `Acertaste: apostaste ${sc.bid} e fizeste ${sc.tricks}. Ganhas ${sc.pts} pontos.` : `Apostaste ${sc.bid} e fizeste ${sc.tricks}. Esta ronda fica a zero.`;
  }
  const btn = mode === 'guest'
    ? `<button class="btn gold" disabled>À espera de ${esc(hostName())}</button>`
    : `<button class="btn gold" id="btnNext">${last ? 'Ver resultado final' : 'Próxima ronda'}</button>`;
  openModal(`<h2>Fim da ronda ${view.roundIdx + 1}</h2><p>${line}</p>${sheetHTML(view, view.roundIdx)}<div class="actions">${btn}</div>`);
  inkIn();
  const b = $('#btnNext'); if (b) b.onclick = hostNext;
}
function hostNext() {
  if (mode === 'guest' || !st) return;
  closeModal();
  if (E.isLastRound(st)) st.phase = 'gameEnd'; else E.startRound(st);
  commit(); drive();
}
function showPodium() {
  const rk = E.ranking(view), mine = rk.findIndex(r => r.i === me);
  const tie = rk.length > 1 && rk[0].total === rk[1].total && rk[0].hits === rk[1].hits;
  const title = tie ? 'Empate!' : you(rk[0].i) ? 'Ganhaste!' : rk[0].name + ' ganha!';
  const hts = [150, 105, 70];
  const pods = [1, 0, 2].filter(k => rk[k]).map(k => `<div class="pod"><div class="who">${esc(rk[k].name)}</div><div class="pts">${rk[k].total} pontos</div>
    <div class="block" data-h="${hts[k]}" style="background:${COLORS[rk[k].i % 10]};color:var(--tinta)">${k + 1}</div></div>`).join('');
  const line = mine >= 0 && !hot() ? `<p>Ficaste em ${mine + 1}.º lugar com ${rk[mine].total} pontos e acertaste ${view.players[me].hits} de ${view.sizes.length} rondas.</p>` : '';
  const btns = offline() ? '<button class="btn alt" id="btnEndMenu">Menu</button><button class="btn gold" id="btnAgain">Jogar de novo</button>'
    : mode === 'host' ? '<button class="btn alt" id="btnEndMenu">Sair da sala</button><button class="btn gold" id="btnAgain">Nova partida na sala</button>'
    : '<button class="btn alt" id="btnEndMenu">Sair da sala</button><button class="btn gold" disabled>À espera de nova partida</button>';
  openModal(`<h2>${esc(title)}</h2><div class="podium">${pods}</div>${line}${sheetHTML(view, null)}<div class="actions">${btns}</div>`);
  anime({ targets: '#paper .block', height: el => el.dataset.h + 'px', delay: anime.stagger(D(180), { start: D(300) }), duration: D(900), easing: 'spring(1, 80, 12, 0)' });
  setTimeout(confetti, D(700));
  if (offline()) drop(SAVE);
  $('#btnEndMenu').onclick = () => { closeModal(); if (offline()) { endGame(); showMenu(); } else leaveRoom(); };
  const again = $('#btnAgain');
  if (again && offline()) { const m = mode; again.onclick = () => { closeModal(); m === 'local' ? startLocal() : startSolo(); }; }
  if (again && mode === 'host') again.onclick = () => { closeModal(); hostBackToLobby(); };
}
function confetti() {
  if (reduce) return;
  const syms = ['♥', '♦', '♠', '♣'];
  for (let i = 0; i < 64; i++) {
    const c = document.createElement('div'), s = syms[i % 4];
    c.className = 'confetti'; c.textContent = s;
    c.style.left = Math.random() * 100 + 'vw';
    c.style.color = (s === '♥' || s === '♦') ? '#e2463c' : (i % 3 ? '#FBF8F0' : '#E0A526');
    c.style.fontSize = (14 + Math.random() * 20) + 'px';
    document.body.appendChild(c);
    anime({ targets: c, translateY: [0, innerHeight + 80], translateX: (Math.random() - 0.5) * 180, rotate: (Math.random() - 0.5) * 720,
      duration: 1900 + Math.random() * 1600, delay: Math.random() * 700, easing: 'easeInQuad', complete: () => c.remove() });
  }
}

/* ================= passa o telemóvel ================= */
function handoff(t) {
  passing = true; hideBidPanel(); clearPlayable(); selected = null;
  if (revealed) { revealed = false; applyLayout(260); }
  const p = view.players[t];
  $('#passAvatar').textContent = (p.name[0] || '?').toUpperCase();
  $('#passAvatar').style.background = COLORS[t % 10];
  $('#passName').textContent = p.name;
  $('#passWhat').textContent = view.phase === 'bidding' ? `Vez de apostar, ronda ${view.roundIdx + 1}` : 'Vez de jogar uma carta';
  $('#passBtn').textContent = `Sou ${p.name}, mostrar as cartas`;
  const ov = $('#pass'); ov.classList.add('open');
  anime.remove(ov.querySelectorAll('*'));
  anime({ targets: ov, opacity: [0, 1], duration: D(220), easing: 'linear' });
  anime({ targets: '#passAvatar', scale: [0.3, 1], rotate: [-90, 0], duration: D(700), easing: 'spring(1, 70, 10, 0)' });
  anime({ targets: '#pass .stagger', translateY: [14, 0], opacity: [0, 1], delay: anime.stagger(D(70), { start: D(150) }), duration: D(380), easing: 'easeOutCubic' });
  $('#passBtn').onclick = async () => {
    $('#passBtn').onclick = null;
    await anime({ targets: ov, opacity: 0, duration: D(200), easing: 'linear' }).finished;
    hidePass();
    const g = gameId;
    await spinTo(t);
    if (g !== gameId) return;
    revealed = true; passing = false;
    await applyLayout(380, 'easeOutBack');
    if (g === gameId) afterRender();
  };
  setTimeout(() => $('#passBtn').focus({ preventScroll: true }), 50);
}
function hidePass() { const ov = $('#pass'); if (ov) { ov.classList.remove('open'); ov.style.opacity = ''; } }
async function spinTo(t) {
  if (t === me) return;
  const spin = $('#spin');
  const deg = seatXY(t).a * 180 / Math.PI;
  let th = 90 - deg; th = ((th % 360) + 540) % 360 - 180;
  spin.style.transformOrigin = `${geom.cx}px ${geom.cy}px`;
  document.querySelectorAll('.trumpLabel').forEach(n => (n.style.opacity = 0));
  await anime({ targets: spin, rotate: [0, th], scale: [{ value: 0.86, duration: D(380) }, { value: 0.94, duration: D(380) }],
    duration: D(760), easing: 'easeInOutCubic' }).finished;
  me = t;
  renderHUD(); renderSeats(); applyLayout(0); placeTrumpLabel();
  anime.set(spin, { rotate: 0 });
  await anime({ targets: spin, scale: [0.94, 1], opacity: [0.75, 1], duration: D(260), easing: 'easeOutQuad' }).finished;
  if (offline()) store(SAVE, { st, mode, me });
}

/* ================= motor local (sozinho, vários no telemóvel e anfitrião) ================= */
function commit() {
  pushState(st);
  if (offline()) store(SAVE, { st, mode, me });
  if (mode === 'host') writeRoom();
}
async function drive() {
  if (driving || !st) return;
  driving = true;
  const g = gameId;
  try {
    while (st && g === gameId) {
      const ph = st.phase;
      if (ph === 'bidding' || ph === 'playing') {
        if (!st.players[st.turn].isBot) break;
        await idle(); await sleep(520 + Math.random() * 360);
        if (g !== gameId) return;
        const p = st.turn;
        if (ph === 'bidding') E.placeBid(st, p, E.aiBid(st, p)); else E.playCard(st, p, E.aiPlay(st, p));
        commit(); continue;
      }
      if (ph === 'trickEnd') { await idle(); await sleep(250); if (g !== gameId) return; E.resolveTrick(st); commit(); continue; }
      break;
    }
  } finally { driving = false; }
}
function resetTable() {
  hidePass(); passing = false; revealed = true; lastActor = -1;
  anime.set('#spin', { rotate: 0, scale: 1 });
  gameId++; queue = []; view = null; rendering = false; idleWait = []; pending = false; lastPrompt = '';
  clearCards(); closeModal(); hideBidPanel(); seatsLayer.innerHTML = '';
}
function startSolo() {
  leaveRoom(true); resetTable();
  mode = 'solo'; me = 0;
  const human = (prefs.name || 'Tu').trim() || 'Tu';
  const bots = BOT_NAMES.filter(n => n.toLowerCase() !== human.toLowerCase()).slice(0, prefs.bots);
  st = E.newGame([{ name: human }, ...bots.map(n => ({ name: n, isBot: true, level: prefs.level }))], settingsFromPrefs());
  st.gid = rid(); E.startRound(st);
  hideMenu(); commit(); drive();
}
function startLocal() {
  leaveRoom(true); resetTable();
  const names = localNames();
  if (names.length < 2) return;
  const bots = BOT_NAMES.filter(n => !names.some(h => h.toLowerCase() === n.toLowerCase())).slice(0, localBotsMax(prefs.localBots));
  mode = 'local'; me = 0; revealed = false; lastActor = -1;
  st = E.newGame([...names.map(n => ({ name: n })), ...bots.map(n => ({ name: n, isBot: true, level: prefs.level }))], settingsFromPrefs());
  st.gid = rid(); E.startRound(st);
  hideMenu(); commit(); drive();
}
function resumeSolo() {
  const saved = load(SAVE);
  if (!saved || !saved.st) return;
  leaveRoom(true); resetTable();
  mode = saved.mode === 'local' ? 'local' : 'solo'; me = saved.me || 0; st = saved.st; st.gid = st.gid || rid();
  if (hot()) { revealed = false; lastActor = -1; }
  hideMenu(); pushState(st); drive();
}
function endGame() { resetTable(); mode = null; st = null; }

/* ================= salas online ================= */
async function netReady() {
  if (net.tried) return net.ok;
  net.tried = true;
  const C = window.claude;
  if (!C || !C.use) { net.ok = false; return false; }
  try {
    const [db, user] = await Promise.all([C.use('db'), C.use('user')]);
    net.db = db; net.user = user;
    if (!db) { net.ok = false; return false; }
    let uid = user ? await user.id() : null;
    if (!uid) { uid = load(LOCALID); if (!uid) { uid = 'l-' + rid() + rid(); store(LOCALID, uid); } }
    net.uid = uid; net.ok = true;
  } catch (e) { net.ok = false; }
  return net.ok;
}
const roomRef = () => net.db.doc('rooms/' + net.code);
const memberRef = () => net.db.doc(`rooms/${net.code}/members/${net.uid}`);
const membersCol = () => net.db.collection(`rooms/${net.code}/members`);
const actionsCol = () => net.db.collection(`rooms/${net.code}/actions`);
const myName = () => ((prefs.name || 'Tu').trim() || 'Tu').slice(0, 12);
const netMsg = t => ($('#netMsg').textContent = t || '');

async function createRoom() {
  netMsg('');
  if (!(await netReady())) return netMsg('As salas online só funcionam com o jogo aberto no claude.ai.');
  const L = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code = null;
  try {
    for (let k = 0; k < 6 && !code; k++) {
      const c = Array.from({ length: 4 }, () => L[Math.floor(Math.random() * L.length)]).join('');
      const s = await net.db.doc('rooms/' + c).get();
      if (!s.exists || (s.data().updatedAt || 0) < Date.now() - 12 * 3600e3) code = c;
    }
  } catch (e) { return netMsg(writeError(e)); }
  if (!code) return netMsg('Não foi possível criar a sala. Tenta outra vez.');
  net.code = code; net.isHost = true;
  net.room = { code, host: net.uid, status: 'lobby', bots: 2, level: prefs.level, settings: settingsFromPrefs(), createdAt: Date.now(), updatedAt: Date.now(), state: null };
  try { await roomRef().set(clone(net.room)); await memberRef().set({ name: myName(), joinedAt: Date.now() }); }
  catch (e) { return netMsg(writeError(e)); }
  store(ROOMKEY, { code }); enterRoom();
}
async function joinRoom(code) {
  netMsg('');
  code = String(code || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
  if (code.length !== 4) return netMsg('O código tem 4 letras.');
  if (!(await netReady())) return netMsg('As salas online só funcionam com o jogo aberto no claude.ai.');
  let room;
  try {
    const s = await net.db.doc('rooms/' + code).get();
    if (!s.exists) return netMsg('Não existe nenhuma sala com o código ' + code + '.');
    room = clone(s.data());
  } catch (e) { return netMsg(writeError(e)); }
  net.code = code; net.isHost = room.host === net.uid;
  if (room.status === 'lobby') {
    try {
      const ms = await membersCol().get();
      const inside = ms.docs.some(d => d.id === net.uid);
      if (!inside && ms.size >= 10) return netMsg('A sala está cheia (10 lugares).');
      await memberRef().set({ name: myName(), joinedAt: inside ? ms.docs.find(d => d.id === net.uid).data().joinedAt : Date.now() });
    } catch (e) { return netMsg(writeError(e)); }
  }
  if (net.isHost) net.room = room;
  store(ROOMKEY, { code }); enterRoom();
}
function writeError(e) {
  if (e && e.code === 'invalid_argument') return 'Não tens permissão para escrever nesta página. Pede ao dono acesso de Contribuidor ou Editor.';
  if (e && e.code === 'quota_exceeded') return 'O espaço de salas está cheio. Tenta mais tarde.';
  return 'Falhou a ligação à sala. Tenta outra vez.';
}
function unsubAll() { net.unsubs.splice(0).forEach(u => { try { u(); } catch (e) {} }); if (net.actionsUnsub) { net.actionsUnsub(); net.actionsUnsub = null; } }
function enterRoom() {
  unsubAll(); resetTable(); mode = null; st = null;
  hideMenu(); showLobby(); renderLobby();
  net.unsubs.push(roomRef().onSnapshot(onRoom, () => toast('Perdeu-se a ligação à sala', 2000)));
  net.unsubs.push(membersCol().onSnapshot(qs => {
    net.members = qs.docs.map(d => ({ uid: d.id, ...d.data() })).sort((a, b) => a.joinedAt - b.joinedAt);
    if (net.isHost && net.room && net.room.status === 'lobby') {
      const max = 10 - net.members.length;
      if (net.room.bots > max) { net.room.bots = Math.max(0, max); writeRoom(); }
    }
    renderLobby();
  }));
}
function onRoom(snap) {
  if (!snap.exists) { if (net.code) { leaveRoom(true); showMenu(); netMsg('A sala foi fechada pelo anfitrião.'); } return; }
  const room = clone(snap.data());
  if (net.isHost) { if (!net.room) net.room = room; } else net.room = room;
  if (room.status === 'lobby') {
    if (mode) { resetTable(); mode = null; st = null; }
    showLobby(); renderLobby(); return;
  }
  if (room.status === 'playing' && room.state) {
    hideLobby();
    if (net.isHost) {
      if (mode !== 'host') { // anfitrião a voltar (ex.: recarregou a página)
        resetTable(); mode = 'host'; net.room = room; st = room.state;
        me = st.players.findIndex(p => p.uid === net.uid);
        listenActions(); pushState(st); drive();
      }
      return;
    }
    if (mode !== 'guest') { resetTable(); mode = 'guest'; }
    st = room.state; me = st.players.findIndex(p => p.uid === net.uid);
    pushState(st);
  }
}
async function writeRoom() {
  if (!net.isHost || !net.room) return;
  if (net.writing) { net.dirty = true; return; }
  net.writing = true;
  try {
    do {
      net.dirty = false;
      net.room.state = mode === 'host' ? st : net.room.state;
      net.room.updatedAt = Date.now();
      await roomRef().set(clone(net.room));
    } while (net.dirty);
  } catch (e) { toast('Não foi possível gravar a sala', 2000); }
  finally { net.writing = false; }
}
function listenActions() {
  if (net.actionsUnsub) net.actionsUnsub();
  net.actionsUnsub = actionsCol().onSnapshot(qs => {
    if (mode !== 'host' || !st) return;
    let changed = false;
    qs.docs.forEach(d => {
      const a = d.data(), uid = d.id;
      if (!a || !a.id || st.acks[uid] === a.id) return;
      st.acks[uid] = a.id;
      const seat = st.players.findIndex(p => p.uid === uid);
      if (seat < 0 || a.gid !== st.gid || a.round !== st.roundIdx || st.turn !== seat) return;
      try {
        if (a.type === 'bid' && st.phase === 'bidding') E.placeBid(st, seat, a.value);
        else if (a.type === 'play' && st.phase === 'playing') E.playCard(st, seat, a.value);
        else return;
        changed = true;
      } catch (e) {}
    });
    if (changed) { commit(); drive(); }
  });
}
function sendAction(type, value) {
  const a = { id: rid(), type, value, round: view.roundIdx, gid: view.gid, at: Date.now() };
  actionsCol().doc(net.uid).set(a).catch(() => { pending = false; toast('Não foi possível enviar a jogada', 1500); afterRender(); });
  clearTimeout(pendingTimer);
  pendingTimer = setTimeout(() => { pending = false; afterRender(); }, 6000);
}
function hostStart() {
  if (!net.isHost) return;
  const humans = net.members.slice(0, 10);
  if (!humans.some(h => h.uid === net.uid)) humans.unshift({ uid: net.uid, name: myName() });
  const bots = Math.min(net.room.bots, 10 - humans.length);
  if (humans.length + bots < 3) return;
  const used = new Set(humans.map(h => h.name.toLowerCase()));
  const botNames = BOT_NAMES.filter(n => !used.has(n.toLowerCase())).slice(0, bots);
  resetTable();
  st = E.newGame([...humans.map(h => ({ name: h.name, uid: h.uid })), ...botNames.map(n => ({ name: n, isBot: true, level: net.room.level }))], net.room.settings);
  st.gid = rid(); E.startRound(st);
  mode = 'host'; me = st.players.findIndex(p => p.uid === net.uid);
  net.room.status = 'playing';
  hideLobby(); listenActions(); commit(); drive();
}
function hostBackToLobby() {
  if (!net.isHost) return;
  net.room.status = 'lobby'; net.room.state = null;
  resetTable(); mode = null; st = null;
  writeRoom(); showLobby(); renderLobby();
}
async function leaveRoom(silent) {
  if (!net.code) return;
  const code = net.code, wasHost = net.isHost, status = net.room && net.room.status;
  unsubAll();
  try {
    if (wasHost) await net.db.doc('rooms/' + code).delete();
    else if (status === 'lobby') await net.db.doc(`rooms/${code}/members/${net.uid}`).delete();
  } catch (e) {}
  net.code = null; net.room = null; net.members = []; net.isHost = false;
  drop(ROOMKEY); hideLobby();
  if (mode === 'host' || mode === 'guest') { resetTable(); mode = null; st = null; }
  if (!silent) showMenu();
}
function renderLobby() {
  if (!net.room) return;
  $('#lbCode').textContent = net.code;
  const room = net.room, hostIsMe = net.isHost;
  const humans = net.members;
  const bots = Math.min(room.bots, 10 - humans.length);
  $('#lbPlayers').innerHTML = humans.map((m, k) => `<li><span class="dot" style="background:${COLORS[k % 10]}">${esc((m.name[0] || '?').toUpperCase())}</span>${esc(m.name)}<span class="tag">${[m.uid === room.host ? 'anfitrião' : '', m.uid === net.uid ? 'tu' : ''].filter(Boolean).join(', ')}</span></li>`).join('')
    + (bots ? `<li><span class="dot" style="background:#B3B8C7">B</span>${bots} ${bots === 1 ? 'bot' : 'bots'}<span class="tag">${LEVEL_NAME[room.level]}</span></li>` : '');
  $('#lbHost').hidden = !hostIsMe;
  $('#lbBots').textContent = room.bots;
  document.querySelectorAll('#lbLevel button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === room.level)));
  const total = humans.length + bots, N = Math.max(3, total);
  const sz = E.roundSizes(room.settings, N);
  const vars = [room.settings.fullDeck && 'baralho completo com 10, 9 e 8', room.settings.dealerRule && 'regra do dador', room.settings.dealAll && 'dar as cartas todas', room.settings.upDown && 'ida e volta',
    room.settings.trumpRotation && 'trunfo por rotação', room.settings.mustTrump && 'obrigatório cortar'].filter(Boolean);
  $('#lbRules').textContent = `${total} ${total === 1 ? 'jogador' : 'jogadores'} à mesa, ${sz.length} rondas até ${Math.max(...sz)} cartas. ${vars.length ? 'Variantes: ' + vars.join(', ') + '.' : 'Regras da casa, sem variantes.'}`;
  const start = $('#lbStart');
  start.hidden = !hostIsMe; start.disabled = total < 3;
  start.textContent = total < 3 ? 'São precisos pelo menos 3 jogadores' : 'Começar partida';
  $('#lbWait').hidden = hostIsMe;
}
function showLobby() { $('#lobby').classList.remove('hidden'); }
function hideLobby() { $('#lobby').classList.add('hidden'); }

/* ================= menu ================= */
const OPT = { optDealer: 'dealerRule', optAll: 'dealAll', optFull: 'fullDeck', optUpDown: 'upDown', optRot: 'trumpRotation', optMust: 'mustTrump', optHint: 'hint', optFour: 'four', optFast: 'fast' };
function syncMenu() {
  $('#inName').value = prefs.name;
  document.querySelectorAll('#segMode button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === prefs.mode)));
  document.querySelectorAll('#segLevel button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === prefs.level)));
  for (const id in OPT) $('#' + id).checked = !!prefs[OPT[id]];
  app.classList.toggle('four', !!prefs.four);
  const solo = prefs.mode === 'solo', local = prefs.mode === 'local';
  $('#localBlock').hidden = !local; $('#inName').closest('.field').hidden = local;
  if (local) renderLocal();
  $('#soloBots').hidden = !solo; $('#soloBtns').hidden = !(solo || local); $('#onlineBtns').hidden = solo || local;
  $('#botsOut').textContent = prefs.bots;
  const N = prefs.bots + 1, sz = E.roundSizes(settingsFromPrefs(), N);
  $('#botsHint').textContent = `${N} jogadores à mesa, ${sz.length} rondas até ${Math.max(...sz)} cartas.`;
  $('#upDownHint').textContent = prefs.dealAll ? 'Sobe até dar as cartas todas e volta a 1' : 'Sobe até 7 cartas e volta a 1';
  const saved = load(SAVE);
  $('#btnResume').hidden = !(saved && saved.st && saved.st.phase !== 'gameEnd');
  const r = load(ROOMKEY);
  const rj = $('#btnRejoin');
  rj.hidden = !(r && r.code);
  if (r && r.code) rj.textContent = net.code === r.code ? `Voltar à sala ${r.code}` : `Entrar outra vez na sala ${r.code}`;
}
function bindMenu() {
  $('#inName').addEventListener('input', e => { prefs.name = e.target.value.slice(0, 12); store(PREF, prefs); });
  $('#segMode').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; prefs.mode = b.dataset.v; store(PREF, prefs); syncMenu(); if (prefs.mode === 'online') probeOnline(); });
  $('#segLevel').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; prefs.level = b.dataset.v; store(PREF, prefs); syncMenu(); });
  $('#soloBots').addEventListener('click', e => { const b = e.target.closest('button[data-d]'); if (!b) return; prefs.bots = clamp(prefs.bots + +b.dataset.d, 2, 9); store(PREF, prefs); syncMenu(); });
  for (const id in OPT) $('#' + id).addEventListener('change', e => { prefs[OPT[id]] = e.target.checked; store(PREF, prefs); syncMenu(); });
  $('#btnPlay').onclick = () => (prefs.mode === 'local' ? startLocal() : startSolo());
  $('#passMenu').onclick = () => $('#btnMenu').click();
  $('#localAdd').onclick = () => {
    if (prefs.localNames.length >= 10) return;
    prefs.localNames.push('Jogador ' + (prefs.localNames.length + 1));
    prefs.localBots = localBotsMax(prefs.localBots); store(PREF, prefs); syncMenu();
    const ins = document.querySelectorAll('#localList input'); ins[ins.length - 1]?.select();
  };
  $('#localList').addEventListener('input', e => {
    const k = +e.target.dataset.k; if (isNaN(k)) return;
    prefs.localNames[k] = e.target.value.slice(0, 12); store(PREF, prefs); updateLocalHint();
  });
  $('#localList').addEventListener('click', e => {
    const b = e.target.closest('button[data-rm]'); if (!b || prefs.localNames.length <= 2) return;
    prefs.localNames.splice(+b.dataset.rm, 1); store(PREF, prefs); syncMenu();
  });
  $('#localBotsStep').addEventListener('click', e => {
    const b = e.target.closest('button[data-d]'); if (!b) return;
    prefs.localBots = localBotsMax(prefs.localBots + +b.dataset.d); store(PREF, prefs); syncMenu();
  });
  $('#btnResume').onclick = resumeSolo;
  $('#btnRules').onclick = showRules;
  $('#btnCreate').onclick = createRoom;
  $('#btnJoin').onclick = () => joinRoom($('#inCode').value);
  $('#inCode').addEventListener('keydown', e => { if (e.key === 'Enter') joinRoom($('#inCode').value); });
  $('#btnRejoin').onclick = () => {
    const r = load(ROOMKEY); if (!r) return;
    if (net.code === r.code) { hideMenu(); if (net.room && net.room.status === 'lobby') showLobby(); return; }
    joinRoom(r.code);
  };
  $('#btnMenu').onclick = () => { if (offline() && st) store(SAVE, { st, mode, me }); hideBidPanel(); showMenu(); };
  $('#btnSheet').onclick = () => {
    if (!view) return;
    openModal(`<h2>Folha de pontos</h2><p>Ronda ${view.roundIdx + 1} de ${view.sizes.length}. Cada célula mostra os pontos e, em pequeno, aposta/vazas.</p>${sheetHTML(view, null)}
      <div class="actions"><button class="btn gold" id="btnClose">Fechar</button></div>`);
    $('#btnClose').onclick = closeModal;
  };
  $('#lbStart').onclick = hostStart;
  $('#lbLeave').onclick = () => leaveRoom();
  $('#lbBotsStep').addEventListener('click', e => {
    const b = e.target.closest('button[data-d]'); if (!b || !net.isHost) return;
    net.room.bots = clamp(net.room.bots + +b.dataset.d, 0, 10 - net.members.length); writeRoom(); renderLobby();
  });
  $('#lbLevel').addEventListener('click', e => { const b = e.target.closest('button'); if (!b || !net.isHost) return; net.room.level = b.dataset.v; writeRoom(); renderLobby(); });
}
async function probeOnline() {
  const ok = await netReady();
  $('#onlineNote').textContent = ok
    ? 'Cria uma sala e partilha o código, ou entra com o código de um amigo.'
    : 'As salas online só funcionam com o jogo aberto no claude.ai. Aqui podes jogar sozinho contra bots ou com várias pessoas no mesmo telemóvel (separador "Um telemóvel").';
  $('#btnCreate').disabled = !ok; $('#btnJoin').disabled = !ok;
}
function localNames() {
  const seen = new Set();
  return prefs.localNames.map((n, k) => (n || '').trim() || 'Jogador ' + (k + 1)).map(n => {
    let x = n, i = 2; while (seen.has(x.toLowerCase())) x = n + ' ' + i++;
    seen.add(x.toLowerCase()); return x;
  }).slice(0, 10);
}
const localBotsMax = b => clamp(b | 0, Math.max(0, 3 - prefs.localNames.length), 10 - prefs.localNames.length);
function renderLocal() {
  prefs.localNames = (prefs.localNames || []).slice(0, 10);
  while (prefs.localNames.length < 2) prefs.localNames.push('Jogador ' + (prefs.localNames.length + 1));
  prefs.localBots = localBotsMax(prefs.localBots);
  $('#localList').innerHTML = prefs.localNames.map((n, k) => `<li><span class="dot" style="background:${COLORS[k % 10]}">${k + 1}</span>
    <input type="text" data-k="${k}" maxlength="12" value="${esc(n)}" aria-label="Nome do jogador ${k + 1}" autocomplete="off">
    <button data-rm="${k}" aria-label="Remover ${esc(n)}" ${prefs.localNames.length <= 2 ? 'disabled' : ''}>×</button></li>`).join('');
  $('#localAdd').disabled = prefs.localNames.length >= 10;
  $('#localBotsOut').textContent = prefs.localBots;
  updateLocalHint();
}
function updateLocalHint() {
  const N = prefs.localNames.length + prefs.localBots, sz = E.roundSizes(settingsFromPrefs(), N);
  $('#localHint').textContent = `${prefs.localNames.length} pessoas e ${prefs.localBots} ${prefs.localBots === 1 ? 'bot' : 'bots'}: ${N} à mesa, ${sz.length} rondas até ${Math.max(...sz)} cartas. Passam o telemóvel na vez de cada um.`;
}
function showMenu() {
  syncMenu();
  const m = $('#menu'); m.classList.remove('hidden');
  anime({ targets: m, opacity: [0, 1], duration: D(250), easing: 'linear' });
}
function hideMenu() { $('#menu').classList.add('hidden'); }

function showRules() {
  openModal(`<h2>Como se joga</h2><div class="rules">
    <p>Joga-se com o baralho de 40 cartas (sem 10, 9 e 8), de 3 a 10 jogadores. Na 1.ª ronda cada um recebe 1 carta, na 2.ª recebe 2, e assim por diante até 7 (com muitos jogadores, até onde o baralho chegar). Com a variante "Baralho completo" juntam-se os 10, 9 e 8 (52 cartas).</p>
    <h3>Ordem das cartas, da mais alta</h3>
    <div class="order"><span>Ás</span><span>7</span><span>Rei</span><span>Valete</span><span>Dama</span><span class="extra" title="Só com o baralho completo">10</span><span class="extra" title="Só com o baralho completo">9</span><span class="extra" title="Só com o baralho completo">8</span><span>6</span><span>5</span><span>4</span><span>3</span><span>2</span></div>
    <p class="note" style="color:#575b66;font-size:13px;margin-top:0">Os 10, 9 e 8 a tracejado só entram com o baralho completo.</p>
    <h3>Em cada ronda</h3>
    <ol><li>O dador dá as cartas e vira a carta seguinte do baralho: o naipe dela é o trunfo. Com "Dar as cartas todas", o trunfo é a última carta dada, que fica com o dador.</li>
    <li>Aposta-se pela mesma ordem em que se joga: primeiro o jogador seguinte ao dador, depois os outros no sentido dos ponteiros do relógio; o dador aposta em último. Cada um diz quantas vazas vai fazer.</li>
    <li>O jogador seguinte ao dador abre a primeira vaza.</li>
    <li>A primeira carta jogada define o naipe da vaza. Quem tiver cartas desse naipe é obrigado a jogá-lo, mesmo que tenha trunfos. Só quem não tem esse naipe pode cortar com trunfo ou largar outra carta qualquer.</li>
    <li>Quem ganha a vaza: se alguém cortou, o trunfo mais alto. Se ninguém cortou, a carta mais alta do naipe da primeira carta. Cartas de outros naipes nunca ganham.</li>
    <li>Quem ganha a vaza abre a seguinte.</li></ol>
    <h3>Pontos</h3>
    <ul><li>Acertar na aposta vale 10 + vazas feitas (apostar 2 e fazer 2 = 12).</li><li>Falhar vale 0.</li></ul>
    <p>As variantes ligadas no menu alteram estas regras.</p></div>
    <div class="actions"><button class="btn gold" id="btnClose">Percebi</button></div>`);
  $('#btnClose').onclick = closeModal;
}
function heroAnim() {
  const hero = $('#hero');
  ['EA', 'C7', 'OK', 'PJ', 'CQ'].forEach(id => {
    const el = makeCard(id); hero.appendChild(el);
    el.style.transformOrigin = '50% 95%';
    setFace(el, true, false);
    anime.set(el, { translateX: -35, translateY: -101, rotate: 0, opacity: 0 });
  });
  anime({ targets: hero.children, opacity: [{ value: 1, duration: 150 }], rotate: (el, i) => (i - 2) * 15,
    translateY: (el, i) => -101 - (2 - Math.abs(i - 2)) * 7, delay: anime.stagger(reduce ? 0 : 80, { start: reduce ? 0 : 250 }),
    duration: reduce ? 1 : 1200, easing: 'spring(1, 70, 11, 0)' });
}

window.addEventListener('resize', () => {
  measure();
  if (!view) return;
  renderSeats(); applyLayout(0); placeTrumpLabel();
  const panel = $('#bidPanel');
  if (panel.style.display === 'block') panel.style.top = Math.max(geom.hud + panel.offsetHeight / 2 + 8, geom.meY - 34 - panel.offsetHeight / 2) + 'px';
});
bindMenu(); syncMenu(); measure(); heroAnim();
if (prefs.mode === 'online') probeOnline();
})();
