"use strict";

// One shared bar. A correct spell refills it. A wrong invoke costs half a second.
// Each spell is either invoke (orbs + R) or invoke and cast (orbs + R + D).

const SPELL_MS = 2000;
const PENALTY_MS = 500;
const BEST_KEY = "invoker-survival-best";
const MUTE_KEY = "invoker-survival-muted";

const ORB_SRC = {
  Q: "assets/quas.webp",
  W: "assets/wex.webp",
  E: "assets/exort.webp",
};

const SPELLS = [
  { id: "cold_snap", file: "cold-snap", name: "Cold Snap", orbs: ["Q", "Q", "Q"], color: "#7ecbff" },
  { id: "emp", file: "emp", name: "E.M.P.", orbs: ["W", "W", "W"], color: "#c084fc" },
  { id: "sun_strike", file: "sun-strike", name: "Sun Strike", orbs: ["E", "E", "E"], color: "#fb923c" },
  { id: "ghost_walk", file: "ghost-walk", name: "Ghost Walk", orbs: ["Q", "Q", "W"], color: "#a78bfa" },
  { id: "ice_wall", file: "ice-wall", name: "Ice Wall", orbs: ["Q", "Q", "E"], color: "#67e8f9" },
  { id: "tornado", file: "tornado", name: "Tornado", orbs: ["Q", "W", "W"], color: "#c4b5fd" },
  { id: "alacrity", file: "alacrity", name: "Alacrity", orbs: ["W", "W", "E"], color: "#e879f9" },
  { id: "forge_spirit", file: "forge-spirit", name: "Forge Spirit", orbs: ["Q", "E", "E"], color: "#fdba74" },
  { id: "chaos_meteor", file: "chaos-meteor", name: "Chaos Meteor", orbs: ["W", "E", "E"], color: "#f97316" },
  { id: "deafening_blast", file: "deafening-blast", name: "Deafening Blast", orbs: ["Q", "W", "E"], color: "#facc15" },
];

const state = {
  phase: "ready",
  queue: [],
  spell: null,
  cast: false,
  armed: false,
  score: 0,
  best: 0,
  mistakes: 0,
  timeLeft: SPELL_MS,
  survived: 0,
  lastFrame: 0,
  raf: 0,
  count: 3,
  isNewRecord: false,
};

let runId = 0;
let audioCtx = null;
let muted = false;
let feedbackTimer = 0;

function artImg(src) {
  const img = document.createElement("img");
  img.src = src;
  img.alt = "";
  img.draggable = false;
  return img;
}

function spellSrc(spell) {
  return `assets/${spell.file}.webp`;
}

function counts(orbs) {
  return {
    Q: orbs.filter((orb) => orb === "Q").length,
    W: orbs.filter((orb) => orb === "W").length,
    E: orbs.filter((orb) => orb === "E").length,
  };
}

function sameRecipe(orbs, recipe) {
  const left = counts(orbs);
  const right = counts(recipe);
  return left.Q === right.Q && left.W === right.W && left.E === right.E;
}

function spellFromOrbs(orbs) {
  if (orbs.length < 3) return null;
  return SPELLS.find((spell) => sameRecipe(orbs, spell.orbs)) || null;
}

function formatClock(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function loadBest() {
  try {
    const value = Number(localStorage.getItem(BEST_KEY));
    state.best = Number.isFinite(value) ? value : 0;
    muted = localStorage.getItem(MUTE_KEY) === "1";
  } catch (error) {
    state.best = 0;
  }
}

function saveBest() {
  try {
    localStorage.setItem(BEST_KEY, String(state.best));
  } catch (error) {
    // Private mode can block storage. The run still works.
  }
}

function applyMute() {
  const button = document.getElementById("mute");
  button.setAttribute("aria-pressed", muted ? "true" : "false");
  button.textContent = muted ? "Без звука" : "Звук";
}

function toggleMute() {
  muted = !muted;
  try {
    localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
  } catch (error) {
    // Ignore storage failures.
  }
  applyMute();
}

function ensureAudio() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  if (!audioCtx) audioCtx = new Ctx();
  if (audioCtx.state === "suspended") audioCtx.resume();
}

function tone(freq, delay, duration, volume, type) {
  if (muted || !audioCtx) return;
  const start = audioCtx.currentTime + delay;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type || "sine";
  osc.frequency.setValueAtTime(freq, start);
  gain.gain.setValueAtTime(volume, start);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

function miniOrb(letter) {
  const img = artImg(ORB_SRC[letter]);
  img.className = "mini";
  img.alt = letter;
  return img;
}

function keycap(letter) {
  const cap = document.createElement("i");
  cap.className = "kbd";
  cap.textContent = letter;
  return cap;
}

function plusSign() {
  const plus = document.createElement("span");
  plus.className = "plus";
  plus.textContent = "+";
  return plus;
}

function buildList() {
  const list = document.getElementById("spell-list");
  SPELLS.forEach((spell) => {
    const item = document.createElement("li");
    item.className = "spell-row";
    item.dataset.id = spell.id;

    const icon = document.createElement("span");
    icon.className = "ability ability-sm";
    icon.style.setProperty("--c", spell.color);
    icon.append(artImg(spellSrc(spell)));

    const meta = document.createElement("span");
    meta.className = "spell-meta";
    const name = document.createElement("span");
    name.className = "spell-name";
    name.textContent = spell.name;
    const recipe = document.createElement("span");
    recipe.className = "recipe";
    spell.orbs.forEach((orb) => recipe.append(miniOrb(orb)));
    meta.append(name, recipe);
    item.append(icon, meta);
    list.append(item);
  });
}

function feedback(text, kind) {
  const node = document.getElementById("feedback");
  node.textContent = text;
  node.classList.remove("is-bad", "is-good");
  if (kind) node.classList.add(kind);
  clearTimeout(feedbackTimer);
  if (!text) return;
  feedbackTimer = setTimeout(() => {
    if (node.textContent === text) {
      node.textContent = "";
      node.classList.remove("is-bad", "is-good");
    }
  }, 800);
}

function flashStage(kind) {
  const stage = document.getElementById("stage");
  stage.classList.remove("flash-ok", "flash-bad");
  void stage.offsetWidth;
  stage.classList.add(kind === "ok" ? "flash-ok" : "flash-bad");
}

function flashPad(key) {
  const pad = document.querySelector(`.pad[data-key="${key}"]`);
  if (!pad) return;
  pad.classList.add("is-down");
  setTimeout(() => pad.classList.remove("is-down"), 90);
}

function nextSpell() {
  const pool = SPELLS.filter((spell) => !state.spell || spell.id !== state.spell.id);
  state.spell = pool[Math.floor(Math.random() * pool.length)];
  state.cast = Math.random() < 0.5;
  state.armed = false;
}

function pushOrb(key) {
  if (state.queue.length < 3) state.queue.push(key);
  else {
    state.queue.shift();
    state.queue.push(key);
  }
}

function succeed() {
  state.score += 1;
  state.timeLeft = SPELL_MS;
  state.armed = false;
  if (state.score > state.best) {
    state.best = state.score;
    state.isNewRecord = true;
    saveBest();
  }
  nextSpell();
  feedback("");
  flashStage("ok");
  const timer = document.getElementById("timer");
  timer.classList.add("flash");
  setTimeout(() => timer.classList.remove("flash"), 160);
  tone(523, 0, 0.08, 0.05);
  tone(784, 0.07, 0.12, 0.05);
  render();
}

function failInvoke() {
  state.armed = false;
  state.mistakes += 1;
  state.timeLeft -= PENALTY_MS;
  feedback("Неверная связка", "is-bad");
  flashStage("bad");
  tone(140, 0, 0.12, 0.04, "square");
  if (state.timeLeft <= 0) {
    state.timeLeft = 0;
    paintBar();
    endGame();
    return;
  }
  render();
}

function invoke() {
  if (state.queue.length < 3) {
    feedback("Сначала три сферы");
    return;
  }
  const made = spellFromOrbs(state.queue);
  if (!made || made.id !== state.spell.id) {
    failInvoke();
    return;
  }
  if (state.cast) {
    const wasArmed = state.armed;
    state.armed = true;
    if (!wasArmed) feedback("Нажмите D", "is-good");
    tone(698, 0, 0.07, 0.04);
    render();
    return;
  }
  succeed();
}

function castSlot() {
  if (!state.cast) return;
  if (!state.armed) {
    feedback("Сначала Invoke");
    return;
  }
  succeed();
}

function press(key) {
  if (state.phase !== "play") return;
  flashPad(key);
  if (key === "Q" || key === "W" || key === "E") {
    pushOrb(key);
    render();
    return;
  }
  if (key === "R") invoke();
  if (key === "D") castSlot();
}

function paintBar() {
  const ratio = Math.max(0, Math.min(1, state.timeLeft / SPELL_MS));
  document.getElementById("timer-fill").style.transform = `scaleX(${ratio})`;
  document.getElementById("timer-readout").textContent = (Math.max(0, state.timeLeft) / 1000).toFixed(1);
  document.getElementById("timer").classList.toggle("is-low", state.phase === "play" && ratio < 0.28);
  document.getElementById("stat-time").textContent = formatClock(state.survived);
}

function paintStats() {
  document.getElementById("stat-score").textContent = String(state.score);
  document.getElementById("live-score").textContent = String(state.score);
  document.getElementById("stat-best").textContent = String(state.best);
  document.getElementById("stat-miss").textContent = String(state.mistakes);
  const task = document.getElementById("stat-task");
  const active = state.spell && (state.phase === "play" || state.phase === "countdown");
  if (!active) task.textContent = "—";
  else if (state.armed) task.textContent = "Каст D";
  else if (state.cast) task.textContent = "Собрать и применить";
  else task.textContent = "Собрать";
}

function renderTarget() {
  const icon = document.getElementById("target-icon");
  icon.style.setProperty("--c", state.spell.color);
  icon.replaceChildren(artImg(spellSrc(state.spell)));
  document.getElementById("spell-title").textContent = state.spell.name;

  const pill = document.getElementById("task-pill");
  const help = document.getElementById("task-help");
  pill.className = "task-pill";
  if (state.armed) {
    pill.classList.add("ready");
    pill.textContent = "Нажмите D";
    help.textContent = "Спелл уже в слоте";
  } else if (state.cast) {
    pill.classList.add("cast");
    pill.textContent = "Собрать и применить";
    help.textContent = "Три сферы, Invoke, затем D";
  } else {
    pill.classList.add("assemble");
    pill.textContent = "Собрать";
    help.textContent = "Три сферы и Invoke";
  }

  const recipe = document.getElementById("target-recipe");
  recipe.replaceChildren();
  state.spell.orbs.forEach((orb) => recipe.append(miniOrb(orb)));
  recipe.append(plusSign(), keycap("R"));
  if (state.cast) recipe.append(plusSign(), keycap("D"));
}

function renderQueue() {
  const queue = document.getElementById("queue");
  queue.replaceChildren();
  for (let index = 0; index < 3; index += 1) {
    const orb = state.queue[index] || null;
    const slot = document.createElement("div");
    slot.className = orb ? "slot filled" : "slot";
    if (orb) slot.append(artImg(ORB_SRC[orb]));
    queue.append(slot);
  }
  const made = spellFromOrbs(state.queue);
  const label = document.getElementById("queue-spell");
  label.className = "queue-spell";
  if (!made) {
    label.textContent = state.queue.length ? "Соберите три сферы" : "Пусто";
    queue.classList.remove("is-match");
    return;
  }
  label.textContent = made.name;
  const active = state.phase === "play" || state.phase === "countdown";
  const matches = !!(active && state.spell && made.id === state.spell.id);
  if (matches) label.classList.add("is-match");
  else if (active) label.classList.add("is-wrong");
  queue.classList.toggle("is-match", matches);
}

function renderPads() {
  const matched = !!(state.spell && spellFromOrbs(state.queue) && spellFromOrbs(state.queue).id === state.spell.id);
  document.querySelector('[data-key="R"]').classList.toggle("is-go", state.phase === "play" && matched);
  const castPad = document.getElementById("cast-pad");
  castPad.classList.toggle("is-idle", !(state.cast && (state.phase === "play" || state.phase === "countdown")));
  castPad.classList.toggle("is-needed", state.cast && state.phase === "play" && !state.armed);
  castPad.classList.toggle("is-armed", state.armed && state.phase === "play");
  const face = document.getElementById("cast-face");
  if (state.armed && state.spell) {
    face.style.color = state.spell.color;
    face.replaceChildren(artImg(spellSrc(state.spell)));
    castPad.style.setProperty("--c", state.spell.color);
  } else {
    face.style.color = "";
    face.textContent = "D";
  }
}

function markList() {
  document.querySelectorAll(".spell-row").forEach((row) => {
    const active = state.spell && (state.phase === "play" || state.phase === "countdown");
    row.classList.toggle("is-current", !!(active && row.dataset.id === state.spell.id));
  });
}

function render() {
  const active = state.phase === "play" || state.phase === "countdown";
  document.getElementById("gate").hidden = active;
  document.getElementById("play").hidden = !active;
  document.getElementById("countdown").hidden = state.phase !== "countdown";

  if (state.phase === "over") {
    document.getElementById("gate-title").textContent = "Время вышло";
    document.getElementById("gate-text").textContent = "Полоска опустела. Пока каждый спелл успеваешь закрыть, забег не кончается.";
    document.getElementById("start-btn").textContent = "Ещё раз";
    document.getElementById("result").hidden = false;
    document.getElementById("r-score").textContent = String(state.score);
    document.getElementById("r-time").textContent = formatClock(state.survived);
    document.getElementById("r-miss").textContent = String(state.mistakes);
    document.getElementById("record-note").hidden = !state.isNewRecord;
  } else {
    document.getElementById("gate-title").textContent = "Выживание";
    document.getElementById("gate-text").textContent = "Полоска уходит сама. Верный спелл заполняет её целиком. Неверный снимает 0,5 секунды. Задание каждый раз случайное: только Invoke или Invoke и каст на D.";
    document.getElementById("start-btn").textContent = "Начать";
    document.getElementById("result").hidden = true;
    document.getElementById("record-note").hidden = true;
  }

  if (state.phase === "countdown") {
    document.getElementById("countdown").textContent = String(state.count);
  }
  if (active && state.spell) renderTarget();
  renderQueue();
  renderPads();
  paintStats();
  paintBar();
  markList();
}

function loop(now) {
  if (state.phase !== "play") return;
  const delta = Math.min(100, now - state.lastFrame);
  state.lastFrame = now;
  state.timeLeft -= delta;
  state.survived += delta;
  if (state.timeLeft <= 0) {
    state.timeLeft = 0;
    paintBar();
    endGame();
    return;
  }
  paintBar();
  state.raf = requestAnimationFrame(loop);
}

function endGame() {
  if (state.phase === "over") return;
  state.phase = "over";
  cancelAnimationFrame(state.raf);
  tone(440, 0, 0.14, 0.05);
  tone(330, 0.12, 0.16, 0.05);
  tone(220, 0.26, 0.22, 0.05);
  render();
}

function startRun() {
  runId += 1;
  const id = runId;
  cancelAnimationFrame(state.raf);
  ensureAudio();
  state.phase = "countdown";
  state.score = 0;
  state.mistakes = 0;
  state.queue = [];
  state.armed = false;
  state.survived = 0;
  state.timeLeft = SPELL_MS;
  state.isNewRecord = false;
  state.spell = null;
  nextSpell();
  feedback("");
  let step = 3;
  const tick = () => {
    if (id !== runId) return;
    if (step === 0) {
      state.phase = "play";
      state.lastFrame = performance.now();
      render();
      tone(880, 0, 0.1, 0.04);
      state.raf = requestAnimationFrame(loop);
      return;
    }
    state.count = step;
    state.phase = "countdown";
    render();
    tone(620, 0, 0.07, 0.03);
    step -= 1;
    setTimeout(tick, 650);
  };
  tick();
}

function onKey(event) {
  const map = { KeyQ: "Q", KeyW: "W", KeyE: "E", KeyR: "R", KeyD: "D" };
  if (map[event.code] || event.code === "Space" || event.code === "Enter") event.preventDefault();
  if (event.repeat) return;
  if ((event.code === "Space" || event.code === "Enter") && (state.phase === "ready" || state.phase === "over")) {
    startRun();
    return;
  }
  const key = map[event.code];
  if (key) press(key);
}

function onHide() {
  if (state.phase !== "play") return;
  if (document.hidden) {
    cancelAnimationFrame(state.raf);
    state.raf = 0;
    return;
  }
  state.lastFrame = performance.now();
  state.raf = requestAnimationFrame(loop);
}

loadBest();
applyMute();
document.getElementById("spell-seconds").textContent = String(SPELL_MS / 1000);
buildList();
render();
document.getElementById("start-btn").addEventListener("click", startRun);
document.getElementById("mute").addEventListener("click", toggleMute);
document.querySelectorAll(".pad").forEach((pad) => {
  pad.addEventListener("click", () => press(pad.dataset.key));
});
window.addEventListener("keydown", onKey);
document.addEventListener("visibilitychange", onHide);
