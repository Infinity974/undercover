/* ==========================================================================
   SOLO — Mode 1 téléphone (pass-and-play, totalement hors-ligne)
   --------------------------------------------------------------------------
   Le téléphone passe de joueur en joueur. Aucun appel Firebase, aucun bot,
   aucun système réseau : tout l'état tient dans `soloState` et reste
   strictement en mémoire pendant la session.

   Rôles supportés en solo :
     CIVIL                  — mot principal
     UNDERCOVER (U)         — mot proche, vote contre les Civils
     MR WHITE (W)           — pas de mot, peut deviner s'il est éliminé
     IMITATEUR (I)          — copie le rôle d'un joueur au début (sinon → Mr White)
     PARIA (P)              — joue civil mais gagne s'il se fait éliminer au 1er tour
   (Pas d'Amoureux en mode 1 téléphone.)

   Options :
     voirRoleUnder          — afficher rôle précis (sinon Civil/Undercover → "rôle caché")
     underConnus            — les Undercovers connaissent les autres Undercovers
   ========================================================================== */

import { dictionnaireBase } from "./dictionary.js";

// Helpers d'UI partagés exposés par online.js
const ui = () => window.__undercoverUI || {
  showScreen: (id) => {
    document.querySelectorAll(".screen").forEach(s => s.classList.toggle("active", s.id === id));
  },
  showToast: (msg) => console.log("[toast]", msg),
  showConfirm: () => Promise.resolve(true),
  escapeHTML: (s) => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))
};

const $ = (sel) => document.querySelector(sel);

// ============================================================================
// ÉTAT
// ============================================================================
const soloConfig = {
  nbPlayers: 5,
  nbU: 1,
  nbW: 0,
  nbI: 0,
  nbP: 0,
  voirRoleUnder: false,
  underConnus: false,
  voirTheme: true,
  theme: null
};

const soloState = {
  active: false,
  players: [],          // [{ id, name, role, word, alive }]
  turnOrder: [],
  round: 1,
  civilWord: "",
  underWord: "",
  theme: "",
  currentNameIdx: 0,
  pendingMrWhiteId: null,
  pendingImitatorId: null,
  firstRoundEliminated: [],
  mrWhiteEndgame: false,
  pendingElimReveal: null,    // { playerId, opts } — pour restaurer l'écran d'élim
  lastWinner: null             // objet winner pour restaurer l'écran de fin
};

// API publique pour interop avec le notch settings
window.__solo = {
  isActive: () => soloState.active,
  goSetup: () => {
    fillThemeSelect();
    refreshSoloCounters();
    refreshSoloToggles();
    validateSoloConfig();
    ui().showScreen("screen-solo-setup");
  },
  exitToHome: () => {
    exitSoloToLogin();
  }
};

// ============================================================================
// PERSISTANCE — sauvegarde/restauration via localStorage
// ----------------------------------------------------------------------------
// Le mode 1 téléphone n'a aucun backend → si l'utilisateur recharge la page ou
// éteint son tel, la partie serait perdue. On sauvegarde donc l'état complet
// (config + state + écran actif) dans localStorage à chaque transition.
// Au boot, si une sauvegarde valide existe (active=true), on restaure
// automatiquement l'écran où le joueur s'était arrêté.
// ============================================================================
const SOLO_SAVE_KEY = "undercover_solo_save_v1";

const persistSolo = (screenId) => {
  if (!soloState.active) return;
  try {
    const payload = {
      version: 1,
      ts: Date.now(),
      config: { ...soloConfig },
      state: JSON.parse(JSON.stringify(soloState)), // deep clone (players, turnOrder...)
      screen: screenId
    };
    localStorage.setItem(SOLO_SAVE_KEY, JSON.stringify(payload));
  } catch (e) {
    // Mode privé, quota, etc. — on ignore silencieusement
  }
};

const clearSoloSave = () => {
  try { localStorage.removeItem(SOLO_SAVE_KEY); } catch (e) {}
};

const loadSoloSave = () => {
  try {
    const raw = localStorage.getItem(SOLO_SAVE_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || obj.version !== 1) return null;
    if (!obj.state?.active) return null;
    return obj;
  } catch (e) {
    return null;
  }
};

// Wrapper de showScreen pour les écrans solo : affiche + persiste.
const showSoloScreen = (id) => {
  ui().showScreen(id);
  persistSolo(id);
};

// Sortie propre vers l'accueil : on désactive la partie et on efface la save.
const exitSoloToLogin = () => {
  soloState.active = false;
  clearSoloSave();
  ui().showScreen("screen-login");
};

// ============================================================================
// HELPERS LOCAUX
// ============================================================================
const shuffle = (arr) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const ROLE_INFO = {
  CIVIL:          { emoji: "😇", cls: "civil",   tip: "Donne un indice qui colle au mot, sans le dire." },
  UNDERCOVER:     { emoji: "😈", cls: "under",   tip: "Tu as un mot proche. Donne un indice ambigu pour ne pas te faire démasquer." },
  "MR WHITE":     { emoji: "👻", cls: "mrwhite", tip: "Tu ne connais aucun mot ! Bluffe et écoute les autres pour deviner." },
  IMITATEUR:      { emoji: "🎭", cls: "under",   tip: "Choisis un joueur à imiter pour copier son rôle. Sinon, tu deviendras Mr White." },
  PARIA:          { emoji: "🥺", cls: "civil",   tip: "Tu joues avec les Civils. MAIS si tu te fais éliminer au 1er tour, tu voles la victoire !" }
};

const roleEmoji = (r) => ROLE_INFO[r]?.emoji || "🃏";
const roleClass = (r) => ROLE_INFO[r]?.cls || "";
const roleTip   = (r) => ROLE_INFO[r]?.tip || "";

// Sur la carte de révélation : faut-il masquer le rôle ? Seuls Mr White,
// Paria et Imitateur (avant d'avoir utilisé son pouvoir) doivent voir leur
// rôle même quand l'option voirRoleUnder est désactivée — Civil et Undercover
// voient "RÔLE CACHÉ" pour qu'ils ne sachent pas dans quel camp ils sont.
const shouldMaskOnCard = (role) => {
  if (soloConfig.voirRoleUnder) return false;
  if (role === "MR WHITE" || role === "PARIA" || role === "IMITATEUR") return false;
  return true;
};

// Distance Levenshtein (tolérance fautes du Mr White)
const lev = (a, b) => {
  a = (a || "").toUpperCase().trim();
  b = (b || "").toUpperCase().trim();
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
};

const mrWhiteGuessOk = (guess, target) => {
  const g = (guess || "").toUpperCase().trim();
  const t = (target || "").toUpperCase().trim();
  if (!g || !t) return false;
  if (g === t) return true;
  const tolerance = t.length >= 8 ? 2 : 1;
  return lev(g, t) <= tolerance;
};

const playerCamp = (p) => {
  switch (p.role) {
    case "CIVIL":
    case "PARIA":      return "CIVIL";
    case "UNDERCOVER":
    case "MR WHITE":
    case "IMITATEUR":  return "IMPOSTEUR";
    default:           return "CIVIL";
  }
};

// ============================================================================
// SETUP — Sélecteur de thème + counters + toggles
// ============================================================================
const fillThemeSelect = () => {
  const sel = $("#soloTheme");
  if (!sel) return;
  sel.innerHTML = "";
  Object.keys(dictionnaireBase).forEach(theme => {
    const opt = document.createElement("option");
    opt.value = theme;
    opt.innerText = theme;
    sel.appendChild(opt);
  });
  // Par défaut : Aléatoire (premier item du dictionnaire — clé exacte)
  const aleatoireKey = "🎲 Aléatoire (tous thèmes)";
  const aleatoireIdx = Array.from(sel.options).findIndex(o => o.value === aleatoireKey);
  sel.selectedIndex = aleatoireIdx >= 0 ? aleatoireIdx : 0;
  soloConfig.theme = sel.value;
};

const totalSpecialRoles = () =>
  soloConfig.nbU + soloConfig.nbW + soloConfig.nbI + soloConfig.nbP;

const totalImposters = () =>
  soloConfig.nbU + soloConfig.nbW + soloConfig.nbI;

const validateSoloConfig = () => {
  const { nbPlayers } = soloConfig;
  const imposters = totalImposters();
  const specials = totalSpecialRoles();
  const civils = nbPlayers - specials;
  const maxImposters = Math.floor((nbPlayers - 1) / 2);

  let msg = "", err = false;

  if (nbPlayers < 3) { msg = "⚠️ Minimum 3 joueurs"; err = true; }
  else if (imposters === 0) { msg = "⚠️ Au moins 1 imposteur"; err = true; }
  else if (civils < 1) { msg = "⚠️ Il faut au moins 1 Civil"; err = true; }
  else if (specials > nbPlayers) { msg = "⚠️ Trop de rôles spéciaux"; err = true; }
  else if (imposters > maxImposters) {
    msg = `⚠️ Trop d'imposteurs (max ${maxImposters} pour ${nbPlayers})`;
    err = true;
  }
  else {
    const bits = [];
    if (soloConfig.nbU) bits.push(`${soloConfig.nbU} 😈`);
    if (soloConfig.nbW) bits.push(`${soloConfig.nbW} 👻`);
    if (soloConfig.nbI) bits.push(`${soloConfig.nbI} 🎭`);
    if (soloConfig.nbP) bits.push(`${soloConfig.nbP} 🥺`);
    msg = `✓ ${nbPlayers} joueurs · ${civils} 😇` + (bits.length ? " · " + bits.join(" · ") : "");
  }

  const el = $("#soloBalanceInfo");
  if (el) {
    el.innerText = msg;
    el.classList.toggle("error", err);
  }
  const btn = $("#btnSoloStart");
  if (btn) btn.disabled = err;
  return !err;
};

const refreshSoloCounters = () => {
  document.querySelectorAll("[data-solo-counter]").forEach(el => {
    const key = el.getAttribute("data-solo-counter");
    const val = (key === "players") ? soloConfig.nbPlayers
              : (key === "U") ? soloConfig.nbU
              : (key === "W") ? soloConfig.nbW
              : (key === "I") ? soloConfig.nbI
              : (key === "P") ? soloConfig.nbP : 0;
    const v = el.querySelector(".counter-value");
    if (v) v.innerText = val;
  });
};

const refreshSoloToggles = () => {
  document.querySelectorAll("[data-solo-toggle]").forEach(t => {
    const key = t.getAttribute("data-solo-toggle");
    t.classList.toggle("active", !!soloConfig[key]);
  });
};

const clampRoleCount = (key, candidate) => {
  const otherSpecials = totalSpecialRoles() - soloConfig["nb" + key];
  const maxForKey = soloConfig.nbPlayers - otherSpecials - 1; // au moins 1 Civil
  const isImposterRole = (key === "U" || key === "W" || key === "I");
  let maxByImposters = Infinity;
  if (isImposterRole) {
    const otherImposters = totalImposters() - soloConfig["nb" + key];
    maxByImposters = Math.floor((soloConfig.nbPlayers - 1) / 2) - otherImposters;
  }
  const bound = Math.max(0, Math.min(maxForKey, maxByImposters));
  return Math.max(0, Math.min(bound, candidate));
};

const trimRolesToFit = () => {
  const order = ["P", "I", "W", "U"];
  let safety = 50;
  while (safety-- > 0) {
    const civilsLeft = soloConfig.nbPlayers - totalSpecialRoles();
    const maxImp = Math.floor((soloConfig.nbPlayers - 1) / 2);
    if (civilsLeft >= 1 && totalImposters() <= maxImp) break;
    let trimmed = false;
    for (const k of order) {
      if (soloConfig["nb" + k] > 0 && (k !== "U" || totalImposters() > 1)) {
        soloConfig["nb" + k]--;
        trimmed = true;
        break;
      }
    }
    if (!trimmed) break;
  }
};

// ============================================================================
// SETUP — listeners
// ============================================================================
const initSoloSetup = () => {
  // Counters
  document.querySelectorAll("[data-solo-counter]").forEach(c => {
    const key = c.getAttribute("data-solo-counter");
    c.querySelectorAll(".counter-btn").forEach(b => {
      b.addEventListener("click", () => {
        const delta = parseInt(b.getAttribute("data-delta"), 10);
        if (key === "players") {
          const next = Math.max(3, Math.min(20, soloConfig.nbPlayers + delta));
          if (next === soloConfig.nbPlayers) return;
          soloConfig.nbPlayers = next;
          trimRolesToFit();
        } else {
          const cur = soloConfig["nb" + key];
          const next = clampRoleCount(key, cur + delta);
          if (next === cur) return;
          soloConfig["nb" + key] = next;
        }
        refreshSoloCounters();
        validateSoloConfig();
      });
    });
  });

  // Toggles
  document.querySelectorAll("[data-solo-toggle]").forEach(t => {
    t.addEventListener("click", () => {
      const key = t.getAttribute("data-solo-toggle");
      soloConfig[key] = !soloConfig[key];
      refreshSoloToggles();
      validateSoloConfig();
    });
  });

  // Theme select
  $("#soloTheme")?.addEventListener("change", (e) => {
    soloConfig.theme = e.target.value;
  });

  // Back / Start
  $("#btnSoloSetupBack")?.addEventListener("click", () => {
    exitSoloToLogin();
  });

  $("#btnSoloStart")?.addEventListener("click", () => {
    if (!validateSoloConfig()) return;
    startSoloGame();
  });

  // Info bubbles → réutilise la modale `#infoModal` existante.
  // On cache le bloc des points (`#infoPts`) puisqu'on n'a pas de scoring en solo.
  document.querySelectorAll("#screen-solo-setup [data-info]").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const key = btn.getAttribute("data-info");
      const modal = $("#infoModal");
      const titleEl = $("#infoTitle");
      const descEl  = $("#infoDesc");
      const ptsEl   = $("#infoPts");
      const INFOS = {
        U: { t: "😈 Undercover", d: "Tu as un mot proche de celui des Civils. Ton but : ne pas te faire démasquer et éliminer tous les Civils." },
        W: { t: "👻 Mr White",   d: "Tu n'as PAS de mot ! Bluffe et devine celui des Civils si tu es éliminé." },
        I: { t: "🎭 Imitateur",  d: "Au début, tu choisis un joueur pour copier son rôle et son mot. Si tu refuses, tu deviens Mr White." },
        P: { t: "🥺 Paria",      d: "Tu joues comme un Civil. MAIS si tu réussis à te faire éliminer dès la 1ère manche, tu voles la victoire !" }
      };
      const info = INFOS[key];
      if (!info || !modal || !titleEl || !descEl) return;
      titleEl.innerText = info.t;
      descEl.innerText = info.d;
      // Cacher le cadre jaune des points (solo n'a pas de scoring)
      if (ptsEl) ptsEl.style.display = "none";
      modal.classList.add("active");
    });
  });

  // Quand la modale se ferme, on remet `#infoPts` visible pour ne pas
  // casser le mode online qui l'utilise.
  document.querySelectorAll(".btn-close-info").forEach(b => {
    b.addEventListener("click", () => {
      const ptsEl = $("#infoPts");
      if (ptsEl) ptsEl.style.display = "";
    });
  });
};

// ============================================================================
// TIRAGE DES MOTS
// ============================================================================
const pickWordPair = (theme) => {
  // pool d'éléments [civil, under, themeName]
  let pool = [];
  if (theme === "🎲 Aléatoire (tous thèmes)" || !dictionnaireBase[theme] || dictionnaireBase[theme].length === 0) {
    for (const t of Object.keys(dictionnaireBase)) {
      if (t === "🎲 Aléatoire (tous thèmes)") continue;
      dictionnaireBase[t].forEach(pair => pool.push([pair[0], pair[1], t]));
    }
  } else {
    dictionnaireBase[theme].forEach(pair => pool.push([pair[0], pair[1], theme]));
  }
  if (pool.length === 0) return ["MOT", "AUTRE", "?"];
  const item = pool[Math.floor(Math.random() * pool.length)];
  const [a, b, themeName] = item;
  const swap = Math.random() < 0.5;
  return [swap ? a : b, swap ? b : a, themeName];
};

// ============================================================================
// DISTRIBUTION DES RÔLES
// ============================================================================
const distributeRoles = () => {
  const civil = soloState.civilWord;
  const under = soloState.underWord;

  soloState.players.forEach(p => {
    p.role = "CIVIL";
    p.word = civil;
    p.alive = true;
  });

  const deck = shuffle(soloState.players.map(p => p.id));
  let idx = 0;

  const assignNext = (role, word) => {
    if (idx >= deck.length) return null;
    const pid = deck[idx++];
    const p = soloState.players.find(x => x.id === pid);
    if (p) { p.role = role; p.word = word; }
    return p;
  };

  for (let i = 0; i < soloConfig.nbU; i++) assignNext("UNDERCOVER", under);
  for (let i = 0; i < soloConfig.nbW; i++) assignNext("MR WHITE", "???");
  for (let i = 0; i < soloConfig.nbI; i++) assignNext("IMITATEUR", "???");
  for (let i = 0; i < soloConfig.nbP; i++) assignNext("PARIA", civil);
};

// ============================================================================
// DÉMARRAGE D'UNE PARTIE
// ============================================================================
const startSoloGame = () => {
  const [civil, under, themeName] = pickWordPair(soloConfig.theme);
  soloState.civilWord = civil;
  soloState.underWord = under;
  soloState.theme = themeName;
  soloState.round = 1;
  soloState.currentNameIdx = 0;
  soloState.pendingMrWhiteId = null;
  soloState.pendingImitatorId = null;
  soloState.firstRoundEliminated = [];

  soloState.players = [];
  for (let i = 1; i <= soloConfig.nbPlayers; i++) {
    soloState.players.push({
      id: i,
      name: "",
      role: "CIVIL",
      word: civil,
      alive: true
    });
  }

  distributeRoles();
  soloState.active = true;
  enterSoloHandoff(0);
};

// ============================================================================
// HANDOFF + CARD
// ============================================================================
const enterSoloHandoff = (idx) => {
  soloState.currentNameIdx = idx;
  const total = soloState.players.length;
  if (idx >= total) {
    startFirstRound();
    return;
  }

  $("#soloHandoffIdx").innerText = idx + 1;
  $("#soloHandoffTotal").innerText = total;
  $("#soloHandoffNum").innerText = idx + 1;

  const input = $("#soloPseudoInput");
  const existing = soloState.players[idx]?.name || "";
  if (input) {
    input.value = existing;
    input.placeholder = `Pseudo obligatoire`;
  }

  showSoloScreen("screen-solo-handoff");
  setTimeout(() => input?.focus(), 250);
};

const renderImitatorPicker = (imitator) => {
  const picker = $("#soloImitatorPicker");
  const targetsEl = $("#soloImitatorTargets");
  if (!picker || !targetsEl) return;

  targetsEl.innerHTML = "";
  soloState.players.forEach(p => {
    if (p.id === imitator.id) return;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "solo-imitator-target";
    const label = p.name ? `Joueur ${p.id} — ${p.name}` : `Joueur ${p.id}`;
    b.innerHTML = `
      <span class="solo-imitator-target-num">${p.id}</span>
      <span class="solo-imitator-target-label">${ui().escapeHTML(label)}</span>
      <span class="solo-imitator-target-go">→</span>
    `;
    b.addEventListener("click", () => onImitatorChoose(p.id));
    targetsEl.appendChild(b);
  });

  picker.style.display = "";
};

const hideImitatorPicker = () => {
  const picker = $("#soloImitatorPicker");
  if (picker) picker.style.display = "none";
};

const onImitatorChoose = (targetId) => {
  const idx = soloState.currentNameIdx;
  const imitator = soloState.players[idx];
  const target = soloState.players.find(p => p.id === targetId);
  if (!imitator || !target) return;

  let copiedRole = target.role;
  let copiedWord = target.word;
  // Cas tordu : la cible est aussi Imitateur (2 Imitateurs configurés)
  if (copiedRole === "IMITATEUR") {
    copiedRole = "UNDERCOVER";
    copiedWord = soloState.underWord;
  }
  imitator.role = copiedRole;
  imitator.word = copiedWord;
  soloState.pendingImitatorId = null;
  renderCard(imitator, { afterImitatorPick: true });
};

const onImitatorSkip = () => {
  const idx = soloState.currentNameIdx;
  const imitator = soloState.players[idx];
  if (!imitator) return;
  imitator.role = "MR WHITE";
  imitator.word = "???";
  soloState.pendingImitatorId = null;
  renderCard(imitator, { afterImitatorPick: true });
};

const renderCard = (player, { afterImitatorPick = false } = {}) => {
  // Décide si on doit masquer le rôle (option voirRoleUnder OFF + rôle non-spécial)
  const mask = shouldMaskOnCard(player.role);

  // Affichage du thème (option voirTheme — par défaut activée)
  const themeEl = $("#soloCardTheme");
  if (themeEl) {
    if (soloConfig.voirTheme) {
      const t = soloState.theme || "?";
      themeEl.innerText = `📚 Thème : ${t}`;
      themeEl.style.display = "";
    } else {
      themeEl.style.display = "none";
    }
  }

  $("#soloCardName").innerText = player.name || `Joueur ${player.id}`;
  $("#soloCardEmoji").innerText = mask ? "🕵️" : roleEmoji(player.role);
  $("#soloCardRole").innerText = mask ? "RÔLE CACHÉ" : player.role;
  $("#soloCardRole").className = "solo-card-role-label " + (mask ? "under" : roleClass(player.role));

  const wordEl   = $("#soloCardWord");
  const wordLbl  = $("#soloCardWordLabel");

  if (player.role === "IMITATEUR" && !afterImitatorPick) {
    wordLbl.innerText = "Mot secret";
    wordEl.innerText = "— à révéler —";
    renderImitatorPicker(player);
  } else {
    hideImitatorPicker();
    if (player.role === "MR WHITE") {
      wordLbl.innerText = "Ton mot";
      wordEl.innerText = "AUCUN MOT";
    } else {
      wordLbl.innerText = "Ton mot secret";
      wordEl.innerText = (player.word === "???" || !player.word) ? "—" : player.word;
    }
  }

  // Astuce : masque aussi quand rôle caché (donne un conseil générique)
  $("#soloCardTip").innerText = mask
    ? "Donne un indice qui colle au mot, sans le dire."
    : roleTip(player.role);

  // Alliés Undercover (option underConnus) — affiché UNIQUEMENT si on connaît son rôle.
  // Si le rôle est masqué, on ne peut pas afficher la liste (sinon le joueur saurait
  // qu'il est Undercover).
  const alliesBlk = $("#soloCardAlliesBlock");
  const alliesEl  = $("#soloCardAlliesList");
  if (alliesBlk && alliesEl) {
    const showAllies =
      soloConfig.underConnus &&
      !mask &&
      player.role === "UNDERCOVER";
    if (showAllies) {
      const others = soloState.players.filter(o =>
        o.id !== player.id && o.role === "UNDERCOVER"
      );
      if (others.length > 0) {
        alliesEl.innerText = others.map(o => o.name ? o.name : `Joueur ${o.id}`).join(", ");
      } else {
        alliesEl.innerText = "Tu es seul Undercover.";
      }
      alliesBlk.style.display = "";
    } else {
      alliesBlk.style.display = "none";
    }
  }

  showSoloScreen("screen-solo-card");
};

const onSoloRevealRole = () => {
  const idx = soloState.currentNameIdx;
  const player = soloState.players[idx];
  if (!player) return;

  const raw = $("#soloPseudoInput")?.value || "";
  const name = raw.trim();

  // Pseudo OBLIGATOIRE
  if (!name) {
    ui().showToast("⚠️ Tu dois saisir un pseudo");
    $("#soloPseudoInput")?.focus();
    return;
  }

  // Pseudo UNIQUE (case-insensitive pour éviter les doublons "Bob"/"bob")
  const lower = name.toLowerCase();
  const dup = soloState.players.some((p, i) => i !== idx && p.name.toLowerCase() === lower);
  if (dup) {
    ui().showToast(`⚠️ Le pseudo "${name}" est déjà pris`);
    $("#soloPseudoInput")?.focus();
    $("#soloPseudoInput")?.select();
    return;
  }

  player.name = name;

  if (player.role === "IMITATEUR") {
    soloState.pendingImitatorId = player.id;
  }

  renderCard(player);
};

const onSoloCardDone = () => {
  const idx = soloState.currentNameIdx;
  const player = soloState.players[idx];
  if (player?.role === "IMITATEUR" && soloState.pendingImitatorId === player.id) {
    ui().showToast("Choisis une cible (ou refuse pour devenir Mr White)");
    return;
  }
  enterSoloHandoff(soloState.currentNameIdx + 1);
};

// ============================================================================
// ORDRE DE PAROLE
// ============================================================================
const computeTurnOrder = () => {
  const alive = soloState.players.filter(p => p.alive);
  const shuffled = shuffle(alive);

  if (shuffled[0]?.role === "MR WHITE" && shuffled.length > 1) {
    const nonMrWhiteIdx = shuffled.findIndex(p => p.role !== "MR WHITE");
    if (nonMrWhiteIdx > 0) {
      [shuffled[0], shuffled[nonMrWhiteIdx]] = [shuffled[nonMrWhiteIdx], shuffled[0]];
    }
  }
  soloState.turnOrder = shuffled.map(p => p.id);
};

const startFirstRound = () => {
  computeTurnOrder();
  enterSoloOrder();
};

const enterSoloOrder = () => {
  $("#soloRoundNum").innerText = soloState.round;
  renderSoloOrderList();
  showSoloScreen("screen-solo-order");
};

const renderSoloOrderList = () => {
  const list = $("#soloOrderList");
  if (!list) return;
  list.innerHTML = "";

  soloState.turnOrder.forEach((pid, i) => {
    const p = soloState.players.find(x => x.id === pid);
    if (!p) return;
    const row = document.createElement("div");
    row.className = "solo-order-row";
    row.innerHTML = `
      <div class="solo-order-rank">${i + 1}</div>
      <div class="solo-order-avatar">${ui().escapeHTML((p.name[0] || "?").toUpperCase())}</div>
      <div class="solo-order-name">${ui().escapeHTML(p.name)}</div>
      <div class="solo-order-arrow">🗣️</div>
    `;
    list.appendChild(row);
  });
};

// ============================================================================
// VOTE
// ============================================================================
const enterSoloVote = () => {
  $("#soloVoteRound").innerText = soloState.round;
  renderSoloVoteList();
  showSoloScreen("screen-solo-vote");
};

const renderSoloVoteList = () => {
  const list = $("#soloVoteList");
  if (!list) return;
  list.innerHTML = "";

  const alive = soloState.players.filter(p => p.alive);
  alive.forEach(p => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "solo-vote-btn";
    btn.innerHTML = `
      <div class="solo-vote-avatar">${ui().escapeHTML((p.name[0] || "?").toUpperCase())}</div>
      <div class="solo-vote-name">${ui().escapeHTML(p.name)}</div>
      <div class="solo-vote-action">Éliminer →</div>
    `;
    btn.addEventListener("click", () => onSoloVoteClick(p.id));
    list.appendChild(btn);
  });
};

const onSoloVoteClick = async (pid) => {
  const p = soloState.players.find(x => x.id === pid);
  if (!p) return;
  const ok = await ui().showConfirm({
    title: `Éliminer ${p.name} ?`,
    message: "Cette action est définitive pour la manche.",
    emoji: "💥",
    yesLabel: "Oui, éliminer",
    noLabel: "Annuler",
    danger: true
  });
  if (!ok) return;
  eliminatePlayer(pid);
};

// ============================================================================
// ÉLIMINATION + VICTOIRE
// ============================================================================
const eliminatePlayer = (pid) => {
  const p = soloState.players.find(x => x.id === pid);
  if (!p) return;
  p.alive = false;

  if (soloState.round === 1) {
    soloState.firstRoundEliminated.push(p.id);
  }

  // Paria éliminé manche 1 → victoire solo immédiate
  if (p.role === "PARIA" && soloState.round === 1) {
    return enterSoloEnd({
      camp: "PARIA",
      reason: `${p.name} (Paria) s'est fait éliminer à la 1ère manche : exploit réussi !`,
      heroId: p.id
    });
  }

  // Mr White éliminé → guess
  if (p.role === "MR WHITE") {
    soloState.pendingMrWhiteId = pid;
    enterSoloMrWhiteGuess(p);
    return;
  }

  showSoloElimReveal(p, () => afterEliminationFlow());
};

const showSoloElimReveal = (p, onContinue, opts = {}) => {
  // Mémorise les infos nécessaires à la restauration de l'écran
  soloState.pendingElimReveal = { playerId: p.id, opts: { ...opts } };

  // À l'élimination, on montre TOUJOURS le vrai rôle (peu importe l'option
  // "rôle caché") et on ne montre PAS le mot du joueur. Seule exception :
  // si le Mr White a tenté un mot et s'est trompé, on affiche sa proposition.
  $("#soloElimName").innerText = p.name;
  const isImpostor = playerCamp(p) === "IMPOSTEUR";
  $("#soloElimEmoji").innerText = isImpostor ? "🎯" : "💔";
  $("#soloElimRole").innerText = p.role;
  $("#soloElimRole").className = "solo-card-role-label " + roleClass(p.role);
  $("#soloElimRoleEmoji").innerText = roleEmoji(p.role);

  // Bloc mot : caché par défaut, visible uniquement si Mr White a deviné faux
  const wordBlock = $("#soloElimWordBlock");
  const wordLabel = $("#soloElimWordLabel");
  const wordVal   = $("#soloElimWord");
  if (opts.mrWhiteGuess) {
    if (wordLabel) wordLabel.innerText = "Sa proposition";
    if (wordVal)   wordVal.innerText = opts.mrWhiteGuess.toUpperCase();
    if (wordBlock) wordBlock.style.display = "flex";
  } else {
    if (wordBlock) wordBlock.style.display = "none";
  }

  const btn = $("#btnSoloElimNext");
  btn.replaceWith(btn.cloneNode(true));
  $("#btnSoloElimNext").addEventListener("click", onContinue);

  showSoloScreen("screen-solo-elim");
};

const afterEliminationFlow = () => {
  const winner = checkVictory();
  if (winner) {
    if (winner.trigger === "MR_WHITE_ENDGAME") {
      // Mr White vivant + 1 Civil → on déclenche sa proposition finale
      const mrW = soloState.players.find(p => p.id === winner.mrWhiteId);
      if (mrW) {
        soloState.pendingMrWhiteId = mrW.id;
        soloState.mrWhiteEndgame = true;
        enterSoloMrWhiteGuess(mrW);
      }
      return;
    }
    return enterSoloEnd(winner);
  }
  soloState.round++;
  computeTurnOrder();
  enterSoloOrder();
};

const checkVictory = () => {
  const alive = soloState.players.filter(p => p.alive);
  const aliveCivilCamp = alive.filter(p => playerCamp(p) === "CIVIL").length;
  const aliveImpost    = alive.filter(p => playerCamp(p) === "IMPOSTEUR").length;

  if (aliveImpost === 0) return { camp: "CIVIL", reason: "Tous les imposteurs ont été démasqués !" };

  // NOUVEAU — endgame Mr White (exactement 2 vivants, dont un Mr White)
  if (alive.length === 2) {
    const mrW = alive.find(p => p.role === "MR WHITE");
    if (mrW) {
      const other = alive.find(p => p.id !== mrW.id);
      // Mr White + camp civil → on déclenche sa proposition finale
      if (playerCamp(other) === "CIVIL") {
        return { trigger: "MR_WHITE_ENDGAME", mrWhiteId: mrW.id };
      }
      // Mr White + autre imposteur (pas un autre Mr White) → l'autre gagne seul
      if (other.role !== "MR WHITE") {
        return {
          camp: "IMPOSTEUR_SOLO",
          heroId: other.id,
          reason: `${other.name} reste seul face au Mr White et l'emporte !`
        };
      }
    }
  }

  if (aliveCivilCamp === 0) return { camp: "IMPOSTEUR", reason: "Tous les Civils ont été éliminés !" };
  if (aliveImpost >= aliveCivilCamp) return { camp: "IMPOSTEUR", reason: "Les imposteurs sont à égalité avec les Civils." };
  return null;
};

// ============================================================================
// MR WHITE — GUESS
// ============================================================================
const enterSoloMrWhiteGuess = (mrWhitePlayer) => {
  $("#soloMrWhiteName").innerText = mrWhitePlayer.name;
  const input = $("#soloMrWhiteInput");
  if (input) {
    input.value = "";
    setTimeout(() => input.focus(), 250);
  }
  showSoloScreen("screen-solo-mrwhite");
};

const onSoloMrWhiteSubmit = () => {
  const pid = soloState.pendingMrWhiteId;
  if (!pid) return;
  const p = soloState.players.find(x => x.id === pid);
  if (!p) return;

  const guess = ($("#soloMrWhiteInput")?.value || "").trim();
  if (!guess) {
    ui().showToast("Saisis un mot avant de valider");
    return;
  }

  const ok = mrWhiteGuessOk(guess, soloState.civilWord);
  const isEndgame = soloState.mrWhiteEndgame === true;
  soloState.mrWhiteEndgame = false;

  if (ok) {
    p.alive = true;
    soloState.pendingMrWhiteId = null;
    return enterSoloEnd({
      camp: "MR WHITE",
      reason: `${p.name} (Mr White) a deviné le mot : « ${soloState.civilWord} ».`,
      heroId: p.id
    });
  }

  soloState.pendingMrWhiteId = null;

  if (isEndgame) {
    // Endgame raté : Mr White est éliminé, Civils gagnent
    p.alive = false;
    return enterSoloEnd({
      camp: "CIVIL",
      reason: `Mr White a proposé « ${guess.toUpperCase()} » mais le mot était « ${soloState.civilWord} ». Les Civils gagnent !`
    });
  }

  ui().showToast(`Mauvaise réponse — le mot était « ${soloState.civilWord} »`);
  showSoloElimReveal(p, () => afterEliminationFlow(), { mrWhiteGuess: guess });
};

// ============================================================================
// FIN DE PARTIE
// ============================================================================
const enterSoloEnd = (winner) => {
  soloState.active = true;
  soloState.lastWinner = winner;

  const isMrW    = winner.camp === "MR WHITE";
  const isCivil  = winner.camp === "CIVIL";
  const isParia  = winner.camp === "PARIA";
  const isImpSolo = winner.camp === "IMPOSTEUR_SOLO";

  let emoji = "😈", tag = "Victoire", title = "Les imposteurs gagnent";
  if (isMrW)         { emoji = "👻"; tag = "Victoire solo";   title = "Mr White gagne seul !"; }
  else if (isCivil)  { emoji = "🛡️"; tag = "Victoire";         title = "Les Civils gagnent"; }
  else if (isParia)  { emoji = "🥺"; tag = "Exploit du Paria"; title = "Le Paria gagne seul !"; }
  else if (isImpSolo) {
    const hero = soloState.players.find(p => p.id === winner.heroId);
    emoji = hero ? roleEmoji(hero.role) : "🎯";
    tag = "Victoire solo";
    title = hero ? `${hero.name} gagne seul !` : "Imposteur seul";
  }

  $("#soloEndEmoji").innerText = emoji;
  $("#soloEndTag").innerText = tag;
  $("#soloEndTitle").innerText = title;
  $("#soloEndSub").innerText = winner.reason || "";

  $("#soloEndCivilWord").innerText = soloState.civilWord;
  $("#soloEndUnderWord").innerText = soloState.underWord;

  const rolesEl = $("#soloEndRoles");
  rolesEl.innerHTML = "";

  const order = { "MR WHITE": 0, IMITATEUR: 1, UNDERCOVER: 2, PARIA: 3, CIVIL: 4 };
  const sortedPlayers = [...soloState.players].sort((a, b) =>
    (order[a.role] ?? 9) - (order[b.role] ?? 9)
  );

  sortedPlayers.forEach(p => {
    const row = document.createElement("div");
    const cls = roleClass(p.role);
    row.className = "solo-end-role-row " + cls + (p.alive ? "" : " solo-end-dead");
    const wordDisplay = (p.word === "???" || !p.word) ? "—" : p.word;
    row.innerHTML = `
      <div class="solo-end-role-emoji">${roleEmoji(p.role)}</div>
      <div class="solo-end-role-info">
        <div class="solo-end-role-name">${ui().escapeHTML(p.name)}</div>
        <div class="solo-end-role-role">${p.role}</div>
      </div>
      <div class="solo-end-role-word">${ui().escapeHTML(wordDisplay)}</div>
    `;
    rolesEl.appendChild(row);
  });

  showSoloScreen("screen-solo-end");
};

// ============================================================================
// REJOUER
// ============================================================================
const replayWithSamePlayers = () => {
  const [civil, under, themeName] = pickWordPair(soloConfig.theme);
  soloState.civilWord = civil;
  soloState.underWord = under;
  soloState.theme = themeName;
  soloState.round = 1;
  soloState.pendingMrWhiteId = null;
  soloState.pendingImitatorId = null;
  soloState.firstRoundEliminated = [];

  distributeRoles();

  soloState.active = true;
  soloState.currentNameIdx = 0;
  enterSoloRevealLoop(0);
};

const enterSoloRevealLoop = (idx) => {
  soloState.currentNameIdx = idx;
  const total = soloState.players.length;
  if (idx >= total) return startFirstRound();

  $("#soloHandoffIdx").innerText = idx + 1;
  $("#soloHandoffTotal").innerText = total;
  $("#soloHandoffNum").innerText = idx + 1;
  const player = soloState.players[idx];
  const input = $("#soloPseudoInput");
  if (input) input.value = player.name;
  showSoloScreen("screen-solo-handoff");
};

// ============================================================================
// NOTCH PARAMÈTRES — boutons "Retourner au salon" / "Quitter la partie"
// ============================================================================
const wireSettingsForSolo = () => {
  const modal = $("#settingsModal");

  $("#btnSettingsReturnLobby")?.addEventListener("click", async () => {
    if (!soloState.active) return;
    const ok = await ui().showConfirm({
      title: "Retourner à la configuration ?",
      message: "La partie en cours sera annulée.",
      emoji: "🏠",
      yesLabel: "Confirmer",
      noLabel: "Annuler"
    });
    if (!ok) return;
    soloState.active = false;
    clearSoloSave();
    modal?.classList.remove("active");
    window.__solo.goSetup();
  });

  $("#btnSettingsLeaveGame")?.addEventListener("click", async () => {
    if (!soloState.active) return;
    const ok = await ui().showConfirm({
      title: "Quitter la partie ?",
      message: "Tu reviendras à l'accueil. La partie en cours sera perdue.",
      emoji: "🚪",
      yesLabel: "Quitter",
      noLabel: "Rester"
    });
    if (!ok) return;
    modal?.classList.remove("active");
    exitSoloToLogin();
  });

  $("#settings-notch")?.addEventListener("click", () => {
    if (!soloState.active) return;
    const btnReturn = $("#btnSettingsReturnLobby");
    const btnLeave  = $("#btnSettingsLeaveGame");
    if (btnReturn) btnReturn.disabled = false;
    if (btnLeave)  btnLeave.disabled  = false;
  });
};

// ============================================================================
// RESTAURATION DE PARTIE (boot)
// ----------------------------------------------------------------------------
// Si une sauvegarde existe et que soloState.active était true, on restaure
// l'état complet puis on retourne automatiquement à l'écran où le joueur
// s'était arrêté. C'est le pendant du "reconnect" du mode multijoueur.
// ============================================================================
const restoreSoloFromSave = (save) => {
  // Réinitialise complètement les objets locaux pour ne pas garder de clés
  // résiduelles d'un précédent état, puis remplit avec les valeurs sauvegardées
  Object.keys(soloConfig).forEach(k => delete soloConfig[k]);
  Object.assign(soloConfig, save.config);

  Object.keys(soloState).forEach(k => delete soloState[k]);
  Object.assign(soloState, save.state);

  // On affiche l'écran sauvegardé (et on persiste à nouveau au passage)
  const screen = save.screen;
  switch (screen) {
    case "screen-solo-handoff":
      enterSoloHandoff(soloState.currentNameIdx);
      break;
    case "screen-solo-card": {
      const p = soloState.players[soloState.currentNameIdx];
      if (p) renderCard(p);
      else exitSoloToLogin();
      break;
    }
    case "screen-solo-order":
      enterSoloOrder();
      break;
    case "screen-solo-vote":
      enterSoloVote();
      break;
    case "screen-solo-elim": {
      const data = soloState.pendingElimReveal;
      const p = data ? soloState.players.find(pl => pl.id === data.playerId) : null;
      if (p) showSoloElimReveal(p, () => afterEliminationFlow(), data.opts || {});
      else afterEliminationFlow();
      break;
    }
    case "screen-solo-mrwhite": {
      const p = soloState.players.find(pl => pl.id === soloState.pendingMrWhiteId);
      if (p) enterSoloMrWhiteGuess(p);
      else exitSoloToLogin();
      break;
    }
    case "screen-solo-end":
      if (soloState.lastWinner) enterSoloEnd(soloState.lastWinner);
      else exitSoloToLogin();
      break;
    default:
      exitSoloToLogin();
  }
};

// ============================================================================
// CÂBLAGE GLOBAL
// ============================================================================
const wireSoloEventListeners = () => {
  initSoloSetup();

  $("#btnSoloRevealRole")?.addEventListener("click", onSoloRevealRole);
  $("#soloPseudoInput")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") onSoloRevealRole();
  });

  $("#btnSoloCardDone")?.addEventListener("click", onSoloCardDone);
  $("#btnSoloImitatorSkip")?.addEventListener("click", onImitatorSkip);

  $("#btnSoloGoVote")?.addEventListener("click", enterSoloVote);
  $("#btnSoloVoteBack")?.addEventListener("click", enterSoloOrder);

  $("#btnSoloMrWhiteSubmit")?.addEventListener("click", onSoloMrWhiteSubmit);
  $("#soloMrWhiteInput")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") onSoloMrWhiteSubmit();
  });

  $("#btnSoloReplay")?.addEventListener("click", replayWithSamePlayers);
  $("#btnSoloEndLobby")?.addEventListener("click", async () => {
    const ok = await ui().showConfirm({
      title: "Retourner au salon ?",
      message: "Tu vas pouvoir reconfigurer une nouvelle partie.",
      emoji: "🏠",
      yesLabel: "Oui",
      noLabel: "Annuler"
    });
    if (!ok) return;
    soloState.active = false;
    clearSoloSave();
    window.__solo.goSetup();
  });
  $("#btnSoloHome")?.addEventListener("click", async () => {
    const ok = await ui().showConfirm({
      title: "Retour à l'accueil ?",
      message: "Tu vas quitter la partie et revenir à l'écran d'accueil.",
      emoji: "🚪",
      yesLabel: "Oui, quitter",
      noLabel: "Rester"
    });
    if (!ok) return;
    exitSoloToLogin();
  });

  $("#btnSoloMode")?.addEventListener("click", () => {
    window.__solo.goSetup();
  });

  wireSettingsForSolo();

  // Reconnexion : si une partie était en cours, on la restaure automatiquement
  const save = loadSoloSave();
  if (save) {
    try { restoreSoloFromSave(save); }
    catch (e) {
      console.warn("[solo] Restauration impossible, on repart de zéro.", e);
      clearSoloSave();
    }
  }
};

// ============================================================================
// BOOT
// ============================================================================
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", wireSoloEventListeners, { once: true });
} else {
  wireSoloEventListeners();
}
