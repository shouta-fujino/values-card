import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getDatabase, ref, onValue, off, get, set, update, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js";
import { VALUES } from "./values.js";

const firebaseConfig = {
  apiKey: "AIzaSyBv-qyeXls4jqw4ENIpqTfIN4L-w1R5lB0",
  authDomain: "values-card-e2b64.firebaseapp.com",
  databaseURL: "https://values-card-e2b64-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "values-card-e2b64",
  storageBucket: "values-card-e2b64.firebasestorage.app",
  messagingSenderId: "607951074981",
  appId: "1:607951074981:web:36390d653e74029c31bf4c"
};

const firebaseApp = initializeApp(firebaseConfig);
const db = getDatabase(firebaseApp);

const HAND_SIZE = 5;
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LEN = 6;

const PLAYER_ID_KEY = "vc_player_id";
let playerId = sessionStorage.getItem(PLAYER_ID_KEY);
if (!playerId) {
  playerId = crypto.randomUUID();
  sessionStorage.setItem(PLAYER_ID_KEY, playerId);
}

let currentRoomCode = null;
let currentRoomData = null;
let roomRef = null;
let lastStatus = null;
let actionPending = false;

async function withLock(fn) {
  if (actionPending) return;
  actionPending = true;
  try { await fn(); }
  finally { actionPending = false; }
}

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function genCode() {
  let s = "";
  for (let i = 0; i < CODE_LEN; i++) {
    s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return s;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function sortedPlayers(players) {
  return Object.entries(players || {})
    .map(([id, p]) => ({ id, ...p }))
    .sort((a, b) => a.seat - b.seat);
}

function showScreen(name) {
  $$(".screen").forEach((s) => (s.hidden = true));
  $(`#screen-${name}`).hidden = false;
}

function showError(msg) {
  const el = $("#home-error");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(showError._t);
  showError._t = setTimeout(() => { el.hidden = true; }, 4000);
}

function resetHomeUI() {
  $("#create-form").hidden = true;
  $("#join-form").hidden = true;
  $(".home-actions").hidden = false;
  $("#home-error").hidden = true;
}

async function generateUniqueCode() {
  for (let i = 0; i < 20; i++) {
    const code = genCode();
    const snap = await get(ref(db, `rooms/${code}`));
    if (!snap.exists()) return code;
  }
  throw new Error("部屋コードの生成に失敗しました。もう一度お試しください。");
}

async function createRoom(name) {
  const code = await generateUniqueCode();
  await set(ref(db, `rooms/${code}`), {
    status: "lobby",
    hostId: playerId,
    createdAt: serverTimestamp(),
    players: {
      [playerId]: { name, seat: 0, joinedAt: Date.now() }
    }
  });
  await subscribeRoom(code);
}

async function joinRoom(code, name) {
  const snap = await get(ref(db, `rooms/${code}`));
  if (!snap.exists()) throw new Error("その部屋コードは見つかりません。");
  const data = snap.val();
  const alreadyIn = data.players && data.players[playerId];
  if (data.status !== "lobby" && !alreadyIn) {
    throw new Error("このゲームはすでに開始しています。");
  }
  if (!alreadyIn) {
    const seat = Object.keys(data.players || {}).length;
    await update(ref(db, `rooms/${code}/players/${playerId}`), {
      name, seat, joinedAt: Date.now()
    });
  } else {
    await update(ref(db, `rooms/${code}/players/${playerId}`), { name });
  }
  await subscribeRoom(code);
}

async function subscribeRoom(code) {
  if (roomRef) off(roomRef);
  currentRoomCode = code;
  lastStatus = null;
  roomRef = ref(db, `rooms/${code}`);
  onValue(roomRef, (snap) => {
    const data = snap.val();
    if (!data) {
      leaveRoom(true);
      return;
    }
    currentRoomData = data;
    render();
  });
  history.replaceState(null, "", `#${code}`);
}

async function leaveRoom(skipUpdate = false) {
  if (!skipUpdate && currentRoomCode && currentRoomData?.status === "lobby") {
    const isHost = currentRoomData.hostId === playerId;
    try {
      if (isHost) {
        await set(ref(db, `rooms/${currentRoomCode}`), null);
      } else {
        await set(ref(db, `rooms/${currentRoomCode}/players/${playerId}`), null);
      }
    } catch {}
  }
  if (roomRef) { off(roomRef); roomRef = null; }
  currentRoomCode = null;
  currentRoomData = null;
  lastStatus = null;
  history.replaceState(null, "", window.location.pathname);
  resetHomeUI();
  showScreen("home");
}

async function startGame() {
  const data = currentRoomData;
  if (!data || data.hostId !== playerId || data.status !== "lobby") return;
  const playerIds = Object.keys(data.players || {});
  if (playerIds.length < 2) {
    alert("2人以上で開始できます。");
    return;
  }
  const turnOrder = shuffle(playerIds);
  const deck = shuffle(VALUES.map((_, i) => i));
  const playersUpdate = {};
  turnOrder.forEach((pid, i) => {
    const hand = deck.splice(0, HAND_SIZE);
    playersUpdate[pid] = {
      ...data.players[pid],
      seat: i,
      hand,
      discard: [],
      finalHand: null,
      lastDrawnCard: null,
      lastDrawnFrom: null
    };
  });
  await update(ref(db, `rooms/${currentRoomCode}`), {
    status: "playing",
    deck,
    actionLog: [],
    currentSeat: 0,
    turnPhase: "draw",
    players: playersUpdate
  });
}

function mySeat() {
  return currentRoomData?.players?.[playerId]?.seat ?? -1;
}
function isMyTurn() {
  return currentRoomData?.status === "playing"
    && currentRoomData.currentSeat === mySeat();
}

async function drawFromDeck() {
  if (!isMyTurn() || currentRoomData.turnPhase !== "draw") return;
  const deck = (currentRoomData.deck || []).slice();
  if (deck.length === 0) return;
  const card = deck.pop();
  const hand = (currentRoomData.players[playerId].hand || []).slice();
  hand.push(card);
  await update(ref(db, `rooms/${currentRoomCode}`), {
    deck,
    [`players/${playerId}/hand`]: hand,
    [`players/${playerId}/lastDrawnCard`]: card,
    [`players/${playerId}/lastDrawnFrom`]: "deck",
    turnPhase: "discard"
  });
}

async function drawFromDiscard(targetPlayerId) {
  if (!isMyTurn() || currentRoomData.turnPhase !== "draw") return;
  if (targetPlayerId === playerId) return;
  const target = currentRoomData.players?.[targetPlayerId];
  if (!target) return;
  const discard = (target.discard || []).slice();
  if (discard.length === 0) return;
  const card = discard.pop();
  const hand = (currentRoomData.players[playerId].hand || []).slice();
  hand.push(card);
  await update(ref(db, `rooms/${currentRoomCode}`), {
    [`players/${targetPlayerId}/discard`]: discard,
    [`players/${playerId}/hand`]: hand,
    [`players/${playerId}/lastDrawnCard`]: card,
    [`players/${playerId}/lastDrawnFrom`]: targetPlayerId,
    turnPhase: "discard"
  });
}

async function discardCard(cardIdx) {
  if (!isMyTurn() || currentRoomData.turnPhase !== "discard") return;
  const me = currentRoomData.players[playerId];
  const hand = (me.hand || []).slice();
  const pos = hand.indexOf(cardIdx);
  if (pos === -1) return;
  hand.splice(pos, 1);
  const myDiscard = (me.discard || []).slice();
  myDiscard.push(cardIdx);

  const log = (currentRoomData.actionLog || []).slice();
  log.unshift({ playerId, cardIdx, at: Date.now() });
  if (log.length > 5) log.length = 5;

  const updates = {
    [`players/${playerId}/hand`]: hand,
    [`players/${playerId}/discard`]: myDiscard,
    [`players/${playerId}/lastDrawnCard`]: null,
    [`players/${playerId}/lastDrawnFrom`]: null,
    actionLog: log
  };

  if ((currentRoomData.deck || []).length === 0) {
    updates.status = "finished";
    const players = currentRoomData.players || {};
    for (const pid of Object.keys(players)) {
      updates[`players/${pid}/finalHand`] = pid === playerId ? hand : (players[pid].hand || []);
    }
  } else {
    const players = sortedPlayers(currentRoomData.players);
    const seats = players.map((p) => p.seat);
    const curIdx = seats.indexOf(currentRoomData.currentSeat);
    updates.currentSeat = seats[(curIdx + 1) % seats.length];
    updates.turnPhase = "draw";
  }

  await update(ref(db, `rooms/${currentRoomCode}`), updates);
}

function render() {
  const data = currentRoomData;
  if (!data) return;
  if (data.status !== lastStatus) {
    const screen = data.status === "lobby" ? "lobby"
      : data.status === "playing" ? "game"
      : "result";
    showScreen(screen);
    lastStatus = data.status;
  }
  if (data.status === "lobby") renderLobby();
  else if (data.status === "playing") renderGame();
  else if (data.status === "finished") renderResult();
}

function renderLobby() {
  const data = currentRoomData;
  $("#lobby-code").textContent = currentRoomCode;
  const players = sortedPlayers(data.players);
  $("#lobby-count").textContent = `${players.length}人`;
  const list = $("#lobby-players");
  list.innerHTML = "";
  for (const p of players) {
    const li = document.createElement("li");
    li.textContent = p.name + (p.id === playerId ? " (あなた)" : "");
    if (p.id === data.hostId) {
      const badge = document.createElement("span");
      badge.className = "host-badge";
      badge.textContent = "ホスト";
      li.appendChild(badge);
    }
    list.appendChild(li);
  }
  const isHost = data.hostId === playerId;
  const startBtn = $("#btn-start");
  startBtn.hidden = !isHost;
  startBtn.disabled = players.length < 2;
  $("#lobby-waiting").hidden = isHost;
}

function renderGame() {
  const data = currentRoomData;
  const me = data.players[playerId];
  if (!me) return;

  const players = sortedPlayers(data.players);
  const current = players.find((p) => p.seat === data.currentSeat);
  const myTurn = isMyTurn();
  const turnEl = $("#turn-indicator");
  if (myTurn) {
    turnEl.textContent = "あなたのターン";
    turnEl.classList.add("mine");
  } else {
    turnEl.textContent = `${current?.name || "?"} さんのターン`;
    turnEl.classList.remove("mine");
  }
  $("#phase-hint").textContent = myTurn
    ? (data.turnPhase === "draw" ? "山札 or 他の人の捨て札から1枚引く" : "捨てるカードを1枚タップ")
    : "";

  const deckCount = (data.deck || []).length;
  $("#deck-count").textContent = deckCount;

  const canDrawDeck = myTurn && data.turnPhase === "draw" && deckCount > 0;
  $("#pile-deck").disabled = !canDrawDeck;
  $("#pile-deck").classList.toggle("active", canDrawDeck);

  const discardsEl = $("#discards");
  discardsEl.innerHTML = "";
  for (const p of players) {
    const li = document.createElement("li");
    li.className = "discard-tile";
    const isSelf = p.id === playerId;
    const pile = p.discard || [];
    const top = pile.length ? VALUES[pile[pile.length - 1]] : "–";
    const canDrawThis = myTurn && data.turnPhase === "draw" && !isSelf && pile.length > 0;

    const owner = document.createElement("span");
    owner.className = "owner";
    owner.textContent = isSelf ? "あなた" : p.name;
    const topEl = document.createElement("span");
    topEl.className = "top-card";
    topEl.textContent = top;
    const countEl = document.createElement("span");
    countEl.className = "count";
    countEl.textContent = `${pile.length}枚`;
    li.appendChild(owner);
    li.appendChild(topEl);
    li.appendChild(countEl);

    if (canDrawThis) {
      li.classList.add("active");
      li.addEventListener("click", () => withLock(() => drawFromDiscard(p.id)));
    } else {
      li.classList.add("disabled");
    }
    discardsEl.appendChild(li);
  }

  const logEl = $("#action-log");
  logEl.innerHTML = "";
  const log = data.actionLog || [];
  for (const entry of log) {
    const p = data.players?.[entry.playerId];
    const name = entry.playerId === playerId ? "あなた" : (p?.name || "?");
    const value = VALUES[entry.cardIdx] ?? "?";
    const li = document.createElement("li");
    li.textContent = `${name} は ${value} を捨てました`;
    logEl.appendChild(li);
  }

  const canDiscard = myTurn && data.turnPhase === "discard";
  const hand = me.hand || [];
  const handList = $("#hand");
  handList.innerHTML = "";
  for (const cardIdx of hand) {
    const li = document.createElement("li");
    li.textContent = VALUES[cardIdx];
    if (canDiscard) {
      li.classList.add("selectable");
      li.addEventListener("click", () => withLock(() => discardCard(cardIdx)));
    }
    if (me.lastDrawnCard === cardIdx && data.turnPhase === "discard") {
      li.classList.add("just-drawn");
    }
    handList.appendChild(li);
  }

  const others = $("#others");
  others.innerHTML = "";
  for (const p of players) {
    if (p.id === playerId) continue;
    const li = document.createElement("li");
    if (p.seat === data.currentSeat) li.classList.add("current");
    li.textContent = `${p.name} (${(p.hand || []).length}枚)`;
    const status = document.createElement("span");
    status.className = "status";
    status.textContent = p.seat === data.currentSeat ? "思考中…" : "";
    li.appendChild(status);
    others.appendChild(li);
  }
}

function renderResult() {
  const data = currentRoomData;
  const me = data.players?.[playerId];
  const final = me?.finalHand || me?.hand || [];
  const list = $("#result-cards");
  list.innerHTML = "";
  for (const idx of final) {
    const li = document.createElement("li");
    li.textContent = VALUES[idx];
    list.appendChild(li);
  }
}

// ---- Event wiring ----
$("#btn-show-create").addEventListener("click", () => {
  $(".home-actions").hidden = true;
  $("#join-form").hidden = true;
  $("#create-form").hidden = false;
  $("#create-name").focus();
});
$("#btn-show-join").addEventListener("click", () => {
  $(".home-actions").hidden = true;
  $("#create-form").hidden = true;
  $("#join-form").hidden = false;
  const codeInput = $("#join-code");
  if (!codeInput.value) codeInput.focus();
  else $("#join-name").focus();
});
$$(".back-to-home").forEach((btn) => btn.addEventListener("click", resetHomeUI));

$("#btn-create").addEventListener("click", async () => {
  const name = $("#create-name").value.trim();
  if (!name) return showError("名前を入力してください");
  try { await createRoom(name); }
  catch (e) { showError(e.message || "作成に失敗しました"); }
});

$("#btn-join").addEventListener("click", async () => {
  const code = $("#join-code").value.trim().toUpperCase();
  const name = $("#join-name").value.trim();
  if (!code) return showError("部屋コードを入力してください");
  if (!name) return showError("名前を入力してください");
  try { await joinRoom(code, name); }
  catch (e) { showError(e.message || "参加に失敗しました"); }
});

$("#btn-start").addEventListener("click", startGame);

$("#btn-copy-invite").addEventListener("click", async () => {
  const url = `${location.origin}${location.pathname}#${currentRoomCode}`;
  const btn = $("#btn-copy-invite");
  try {
    await navigator.clipboard.writeText(url);
    btn.textContent = "コピーしました!";
    setTimeout(() => { btn.textContent = "招待リンクをコピー"; }, 2000);
  } catch {
    prompt("このURLをコピーして共有してください", url);
  }
});

$("#btn-leave-lobby").addEventListener("click", () => leaveRoom());
$("#btn-back-home").addEventListener("click", () => leaveRoom(true));

$("#pile-deck").addEventListener("click", () => withLock(drawFromDeck));

// ---- Init ----
(function init() {
  const hash = location.hash.replace("#", "").toUpperCase();
  if (hash && /^[A-Z0-9]{6}$/.test(hash)) {
    $("#btn-show-join").click();
    $("#join-code").value = hash;
    $("#join-name").focus();
  }
})();
