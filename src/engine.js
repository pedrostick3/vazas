/* ===== Vazas — motor de regras (sem DOM) ===== */
const VazasEngine = (() => {
  const SUITS = ['C', 'E', 'O', 'P']; // Copas, Espadas, Ouros, Paus
  const SUIT_SYM = { C: '♥', O: '♦', E: '♠', P: '♣' };
  const SUIT_NAME = { C: 'Copas', O: 'Ouros', E: 'Espadas', P: 'Paus' };
  const RED = { C: true, O: true, E: false, P: false };
  const RANKS = ['A', '7', 'K', 'J', 'Q', '10', '9', '8', '6', '5', '4', '3', '2']; // alto -> baixo (baralho de 52)
  const RANK_LABEL = { A: 'A', '7': '7', K: 'R', J: 'V', Q: 'D', '10': '10', '9': '9', '8': '8', '6': '6', '5': '5', '4': '4', '3': '3', '2': '2' };
  const ROT_ORDER = ['C', 'O', 'E', 'P'];

  const strength = r => RANKS.length - RANKS.indexOf(r);
  const MIN_PLAYERS = 3, MAX_PLAYERS = 10;
  const EXTRA = ['10', '9', '8']; // só com a variante "baralho completo"
  const ranksFor = settings => (settings && settings.fullDeck ? RANKS : RANKS.filter(r => !EXTRA.includes(r)));
  const deckSize = settings => ranksFor(settings).length * 4; // 40 por defeito, 52 com o baralho completo
  const DECK_SIZE = 40;
  const card = id => ({ id, s: id[0], r: id.slice(1) });

  function shuffle(a, rng = Math.random) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  const makeDeck = settings => SUITS.flatMap(s => ranksFor(settings).map(r => s + r));

  function maxCards(settings, N) {
    const D = deckSize(settings);
    if (settings.dealAll) return Math.floor(D / N);
    const flip = settings.trumpRotation ? 0 : 1; // é preciso sobrar uma carta para virar
    return Math.min(7, Math.floor((D - flip) / N));
  }
  function roundSizes(settings, N = 4) {
    const max = maxCards(settings, N);
    const up = Array.from({ length: max }, (_, i) => i + 1);
    return settings.upDown ? up.concat(up.slice(0, -1).reverse()) : up;
  }

  function newGame(players, settings, rng = Math.random) {
    return {
      players: players.map(p => ({ name: p.name, uid: p.uid || null, isBot: !!p.isBot, level: p.level || 'normal',
        hand: [], bid: null, tricks: 0, scores: [], hits: 0 })),
      settings: { ...settings },
      sizes: roundSizes(settings, players.length),
      roundIdx: -1,
      dealer: Math.floor(rng() * players.length),
      phase: 'idle', turn: 0, leader: 0,
      trump: null, trumpCard: null,
      trick: [], played: [], lastTrick: null, dealOrder: [], trickNo: 0, acks: {}
    };
  }

  function sortHand(hand, trump) {
    const order = [trump, ...SUITS.filter(s => s !== trump)];
    return hand.sort((a, b) => {
      const sa = order.indexOf(a[0]), sb = order.indexOf(b[0]);
      if (sa !== sb) return sa - sb;
      return strength(b.slice(1)) - strength(a.slice(1));
    });
  }

  function startRound(st, rng = Math.random) {
    st.roundIdx++;
    const N = st.players.length, n = st.sizes[st.roundIdx];
    if (st.roundIdx > 0) st.dealer = (st.dealer + 1) % N;
    const deck = shuffle(makeDeck(st.settings), rng);
    st.players.forEach(p => { p.hand = []; p.bid = null; p.tricks = 0; });
    st.dealOrder = [];
    for (let i = 0; i < n; i++) {
      for (let k = 1; k <= N; k++) {
        const p = (st.dealer + k) % N;
        const c = deck.pop();
        st.players[p].hand.push(c);
        st.dealOrder.push([p, c]);
      }
    }
    st.trumpInHand = false;
    if (st.settings.trumpRotation) {
      st.trumpCard = null;
      st.trump = ROT_ORDER[st.roundIdx % 4];
    } else if (st.settings.dealAll) {
      // a última carta dada (fica na mão do dador) define o trunfo
      st.trumpCard = st.dealOrder[st.dealOrder.length - 1][1];
      st.trump = st.trumpCard[0];
      st.trumpInHand = true;
    } else {
      st.trumpCard = deck.pop();
      st.trump = st.trumpCard[0];
    }
    st.players.forEach(p => sortHand(p.hand, st.trump));
    st.turn = st.leader = (st.dealer + 1) % N;
    st.trick = []; st.played = []; st.lastTrick = null;
    st.phase = 'bidding';
    return st;
  }

  const cardsThisRound = st => st.sizes[st.roundIdx];

  function legalBids(st, p) {
    const n = cardsThisRound(st);
    const all = Array.from({ length: n + 1 }, (_, i) => i);
    if (!st.settings.dealerRule || p !== st.dealer) return all;
    const sum = st.players.reduce((a, pl, i) => a + (i !== p && pl.bid != null ? pl.bid : 0), 0);
    const forbidden = n - sum;
    return all.filter(b => b !== forbidden);
  }

  function placeBid(st, p, b) {
    if (st.phase !== 'bidding' || st.turn !== p) throw new Error('not your bid');
    if (!legalBids(st, p).includes(b)) throw new Error('illegal bid');
    st.players[p].bid = b;
    if (st.players.every(pl => pl.bid != null)) { st.phase = 'playing'; st.turn = st.leader; }
    else st.turn = (p + 1) % st.players.length;
  }

  function legalPlays(st, p) {
    const hand = st.players[p].hand;
    if (!st.trick.length) return hand.slice();
    const lead = st.trick[0].card[0];
    const same = hand.filter(c => c[0] === lead);
    if (same.length) return same;
    if (st.settings.mustTrump) {
      const tr = hand.filter(c => c[0] === st.trump);
      if (tr.length) return tr;
    }
    return hand.slice();
  }

  // a bate b (b = carta que está a ganhar)?
  function beats(a, b, trump) {
    if (a[0] === b[0]) return strength(a.slice(1)) > strength(b.slice(1));
    return a[0] === trump;
  }

  function trickWinner(trick, trump) {
    let best = 0;
    for (let i = 1; i < trick.length; i++) if (beats(trick[i].card, trick[best].card, trump)) best = i;
    return trick[best].player;
  }

  function playCard(st, p, c) {
    if (st.phase !== 'playing' || st.turn !== p) throw new Error('not your turn');
    if (!legalPlays(st, p).includes(c)) throw new Error('illegal card ' + c);
    const hand = st.players[p].hand;
    hand.splice(hand.indexOf(c), 1);
    st.trick.push({ player: p, card: c });
    st.played.push(c);
    if (st.trick.length === st.players.length) st.phase = 'trickEnd';
    else st.turn = (p + 1) % st.players.length;
  }

  function resolveTrick(st) {
    if (st.phase !== 'trickEnd') throw new Error('trick not complete');
    const w = trickWinner(st.trick, st.trump);
    st.players[w].tricks++;
    st.lastTrick = { cards: st.trick.slice(), winner: w };
    st.trickNo = (st.trickNo || 0) + 1;
    st.trick = [];
    if (st.players.every(p => p.hand.length === 0)) { scoreRound(st); st.phase = 'roundEnd'; }
    else { st.turn = st.leader = w; st.phase = 'playing'; }
    return w;
  }

  const scoreFor = (bid, tricks) => (bid === tricks ? 10 + tricks : 0);

  function scoreRound(st) {
    st.players.forEach(p => {
      const pts = scoreFor(p.bid, p.tricks);
      p.scores.push({ bid: p.bid, tricks: p.tricks, pts, cards: cardsThisRound(st) });
      if (pts > 0) p.hits++;
    });
  }

  const total = p => p.scores.reduce((a, s) => a + s.pts, 0);
  const isLastRound = st => st.roundIdx >= st.sizes.length - 1;

  function ranking(st) {
    return st.players.map((p, i) => ({ i, name: p.name, total: total(p), hits: p.hits }))
      .sort((a, b) => b.total - a.total || b.hits - a.hits);
  }

  /* ===== IA ===== */
  const TRUMP_P = { A: .97, '7': .9, K: .7, J: .55, Q: .5, '10': .4 };
  function estimateTricks(hand, trump, N) {
    let est = 0;
    const bySuit = {};
    hand.forEach(c => (bySuit[c[0]] = (bySuit[c[0]] || 0) + 1));
    const f = Math.max(.45, 1 - .08 * (N - 3)); // mais adversários = menos hipóteses
    for (const c of hand) {
      const s = c[0], r = c.slice(1);
      if (s === trump) est += (r === 'A' || r === '7') ? TRUMP_P[r] : (TRUMP_P[r] ?? .3) * f;
      else if (r === 'A') est += .75 * f;
      else if (r === '7') est += (hand.includes(s + 'A') ? .7 : .45) * f;
      else if (r === 'K') est += .2 * f;
      else if (r === 'J' || r === 'Q') est += .05 * f;
    }
    const voids = SUITS.filter(s => s !== trump && !bySuit[s]).length;
    if (voids > 0 && hand.length > 1) {
      const lowTrumps = hand.filter(c => c[0] === trump && RANKS.indexOf(c.slice(1)) >= 5).length;
      est += .3 * lowTrumps * f;
    }
    return Math.max(0, Math.min(hand.length, est));
  }

  function aiBid(st, p, rng = Math.random) {
    const pl = st.players[p], N = st.players.length, n = cardsThisRound(st);
    let est = estimateTricks(pl.hand, st.trump, N);
    if (pl.level === 'easy') est += Math.floor(rng() * 3) - 1;
    if (pl.level === 'hard') {
      const others = st.players.filter((q, i) => i !== p && q.bid != null);
      const sum = others.reduce((a, q) => a + q.bid, 0);
      const left = n - sum;
      if (others.length >= N - 1 && est > left) est = (est + Math.max(0, left)) / 2;
    }
    let b = Math.max(0, Math.min(n, Math.round(est)));
    const legal = legalBids(st, p);
    if (!legal.includes(b)) {
      b = legal.slice().sort((x, y) => Math.abs(x - est) - Math.abs(y - est))[0];
    }
    return b;
  }

  function aiPlay(st, p, rng = Math.random) {
    const pl = st.players[p];
    const legal = legalPlays(st, p);
    if (legal.length === 1) return legal[0];
    if (pl.level === 'easy' && rng() < .25) return legal[Math.floor(rng() * legal.length)];
    const trump = st.trump;
    const val = c => strength(c.slice(1)) + (c[0] === trump ? 20 : 0);
    const asc = arr => arr.slice().sort((a, b) => val(a) - val(b));
    const need = pl.bid - pl.tricks;
    const known = new Set([...st.played, ...pl.hand, ...(st.trumpCard && !st.trumpInHand ? [st.trumpCard] : [])]);
    const ranks = ranksFor(st.settings);
    const isBoss = c => ranks.slice(0, ranks.indexOf(c.slice(1))).every(r => known.has(c[0] + r));

    if (!st.trick.length) {
      if (need > 0) {
        if (pl.level === 'hard') {
          const bosses = legal.filter(isBoss);
          if (bosses.length) return asc(bosses).pop();
        }
        return asc(legal).pop();
      }
      return asc(legal)[0];
    }
    let win = st.trick[0].card;
    for (const t of st.trick) if (beats(t.card, win, trump)) win = t.card;
    const winners = asc(legal.filter(c => beats(c, win, trump)));
    const losers = asc(legal.filter(c => !beats(c, win, trump)));
    const isLast = st.trick.length === st.players.length - 1;

    if (need > 0) {
      if (winners.length) {
        if (isLast) return winners[0];
        if (pl.level === 'hard') {
          const bosses = winners.filter(isBoss);
          if (bosses.length) return bosses[0];
        }
        return winners[winners.length - 1];
      }
      return losers[0];
    }
    if (losers.length) return losers[losers.length - 1];
    return isLast ? winners[winners.length - 1] : winners[0];
  }

  return { DECK_SIZE, deckSize, ranksFor, MIN_PLAYERS, MAX_PLAYERS, maxCards, roundSizes, SUITS, SUIT_SYM, SUIT_NAME, RED, RANKS, RANK_LABEL, strength, card, newGame, startRound,
    legalBids, placeBid, legalPlays, playCard, resolveTrick, trickWinner, beats, scoreFor, total,
    isLastRound, ranking, cardsThisRound, estimateTricks, aiBid, aiPlay, sortHand };
})();
if (typeof module !== 'undefined') module.exports = VazasEngine;
