/* ==========================================================================
   ONLINE — Mode multijoueur en ligne (Firebase)
   --------------------------------------------------------------------------
   Tout le jeu en ligne : création/jonction de partie, lobby, config,
   vote des thèmes/mots, distribution des rôles, indices, votes, Mr White,
   bots, duel PFC, pouvoirs (Forceur), scoreboard.
   ========================================================================== */

import {
  db, ref, set, update, get, onValue, onDisconnect, remove, child, push, serverTimestamp
} from "./firebase-config.js";
import { dictionnaireBase } from "./dictionary.js";


// ======================================================================
// PLAYER ID LOCAL (persiste entre sessions/recharges)
// ======================================================================
const getOrCreatePlayerId = () => {
  let id = localStorage.getItem("undercover_playerId");
  if (!id) {
    id = "p_" + Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
    localStorage.setItem("undercover_playerId", id);
  }
  return id;
};

let myPlayerId = getOrCreatePlayerId();
let myName     = "";
let currentRoomCode = null;
let isHost = false;
let unsubscribeRoom = null;
let currentRoomData = null;

// Expose pour debug
window.__state = () => ({ myPlayerId, myName, currentRoomCode, isHost, currentRoomData });

// ======================================================================
// UTILS
// ======================================================================
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const escapeHTML = (str) => {
  if (!str) return "";
  const div = document.createElement("div");
  div.innerText = str;
  return div.innerHTML;
};

// Formatte un indice stocké pour l'affichage : gère le séparateur |||FORCED|||
const formatIndiceDisplay = (raw) => {
  if (!raw) return "";
  const parts = raw.split("|||FORCED|||");
  const main = parts[0];
  const forced = parts.slice(1);
  let out = main ? escapeHTML(main) : "";
  for (const f of forced) {
    if (out) out += "<br>";
    out += `<span style="color:rgba(var(--gold-rgb),1);font-weight:700;">⚡ ${escapeHTML(f)}</span>`;
  }
  return out;
};

const sanitizeName = (str) =>
  str.replace(/[.#$\[\]\/]/g, "").replace(/\(bot\)/gi, "").trim();

const showToast = (msg) => {
  const container = $("#toast-container");
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.innerText = msg;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3200);
};

const showConfirm = ({ title, message, emoji = "⚠️", yesLabel = "Oui", noLabel = "Non", danger = true }) =>
  new Promise((resolve) => {
    $("#confirmTitle").innerText = title;
    $("#confirmMessage").innerText = message;
    $("#confirmEmoji").innerText = emoji;
    $("#confirmYes").innerText = yesLabel;
    $("#confirmNo").innerText  = noLabel;
    $("#confirmYes").className = danger ? "btn btn-danger flex-1" : "btn btn-primary flex-1";

    const modal = $("#confirmModal");
    modal.classList.add("active");

    const cleanup = () => {
      modal.classList.remove("active");
      $("#confirmYes").onclick = null;
      $("#confirmNo").onclick  = null;
    };
    $("#confirmYes").onclick = () => { cleanup(); resolve(true); };
    $("#confirmNo").onclick  = () => { cleanup(); resolve(false); };
  });

const showScreen = (id) => {
  // Éviter les ré-animations si on est déjà sur le bon écran
  const target = document.getElementById(id);
  if (target && target.classList.contains("active")) return;
  $$(".screen").forEach(s => {
    if (s.id === id) s.classList.add("active");
    else s.classList.remove("active");
  });
  // Footer "Retour au salon" visible uniquement sur l'écran résultats
  const globalFooter = document.getElementById("globalScreenFooter");
  if (globalFooter) {
    globalFooter.style.display = (id === "screen-results") ? "" : "none";
  }
};

// On expose les helpers principaux sur window pour que le mode solo
// (chargé séparément depuis solo.js) puisse réutiliser les mêmes utilitaires
// sans dépendre de Firebase ni de l'état multijoueur.
window.__undercoverUI = {
  showScreen,
  showToast,
  showConfirm,
  escapeHTML
};

const genCode = () =>
  Math.random().toString(36).substring(2, 6).toUpperCase().padEnd(4, "X");

const genId = () =>
  "p_" + Math.random().toString(36).substring(2, 10) + Date.now().toString(36);

const avatarLetter = (name) => (name && name.trim()) ? name.trim()[0].toUpperCase() : "?";


// Fonction pour détecter le matériel
function isLowEndDevice() {
  const cores = navigator.hardwareConcurrency || 4;
  const ram = navigator.deviceMemory || 4;
  return cores <= 4 || ram <= 4;
}

// Récupération du bouton
const perfToggle = document.getElementById("perfModeToggle");

// --- INITIALISATION AU DÉMARRAGE ---
// On vérifie si le joueur avait déjà activé le mode fluide avant, 
// SINON on vérifie s'il a un petit PC.
const savedPerfMode = localStorage.getItem("lowEndMode");
let shouldUseLowEndMode = false;

if (savedPerfMode === "true") {
  shouldUseLowEndMode = true;
} else if (savedPerfMode === null && isLowEndDevice()) {
  // Pas de sauvegarde, mais la machine a l'air faible
  shouldUseLowEndMode = true;
}

// Application du mode
if (shouldUseLowEndMode) {
  document.body.classList.add("low-end-mode");
  if (perfToggle) perfToggle.checked = true;
}

// --- GESTION DU CLIC SUR LE BOUTON ---
if (perfToggle) {
  perfToggle.addEventListener("change", (e) => {
    if (e.target.checked) {
      document.body.classList.add("low-end-mode");
      localStorage.setItem("lowEndMode", "true"); // On sauvegarde !
    } else {
      document.body.classList.remove("low-end-mode");
      localStorage.setItem("lowEndMode", "false"); // On sauvegarde !
    }
  });
}

// ======================================================================
// SPLASH SCREEN
// ======================================================================
const runSplash = () => {
  const splash = $("#splash-screen");
  if (!splash) return;
  // Step 1 : "?" apparaît
  setTimeout(() => splash.classList.add("step-1"), 400);
  // Step 2 : "?" → 🕵️ + titre
  setTimeout(() => splash.classList.add("step-2"), 1600);
  // Step 3 : fade-out vers l'app
  setTimeout(() => splash.classList.add("step-3"), 3400);
  // Nettoyage
  setTimeout(() => splash.remove(), 4800);
};

// ======================================================================
// ÉCRAN INTRO RÈGLES (premier écran après splash)
// ======================================================================
const INTRO_SEEN_KEY = "undercover_introSeen";
const hasSeenIntro = () => localStorage.getItem(INTRO_SEEN_KEY) === "1";
const markIntroSeen = () => localStorage.setItem(INTRO_SEEN_KEY, "1");

$("#btnIntroNext").addEventListener("click", () => {
  markIntroSeen();
  showScreen("screen-login");
});
$("#btnIntroMoreRules").addEventListener("click", () => {
  $("#rulesModal").classList.add("active");
});

// ======================================================================
// NOTCH PARAMÈTRES + THÈMES + DARK/LIGHT
// ======================================================================
const notch = $("#settings-notch");
const settingsModal = $("#settingsModal");

notch.addEventListener("click", () => {
  settingsModal.classList.add("active");
  // Sync état des boutons
  const btnReturn = $("#btnSettingsReturnLobby");
  const btnLeave  = $("#btnSettingsLeaveGame");
  if (!currentRoomCode) {
    btnReturn.disabled = true;
    btnLeave.disabled = true;
  } else {
    btnLeave.disabled = false;
    btnReturn.disabled = (currentRoomData?.status === "lobby");
  }
});

document.querySelectorAll(".btn-close-settings").forEach(b =>
  b.addEventListener("click", () => settingsModal.classList.remove("active"))
);
settingsModal.addEventListener("click", (e) => {
  if (e.target === settingsModal) settingsModal.classList.remove("active");
});

// Bouton règles depuis paramètres
$("#btnSettingsRules").addEventListener("click", () => {
  settingsModal.classList.remove("active");
  setTimeout(() => $("#rulesModal").classList.add("active"), 200);
});
// Bouton scores depuis paramètres
$("#btnSettingsScores").addEventListener("click", async () => {
  settingsModal.classList.remove("active");
  setTimeout(async () => {
    const s = await fetchScores();
    document.querySelectorAll("[data-scoreboardtab]").forEach(b => b.classList.toggle("active", b.getAttribute("data-scoreboardtab") === "session"));
    renderScoreboardList($("#scoreboardList"), s.session);
    $("#scoresModal").__data = s;
    $("#scoresModal").classList.add("active");
  }, 200);
});
// Retour lobby
$("#btnSettingsReturnLobby").addEventListener("click", async () => {
  settingsModal.classList.remove("active");
  if (!currentRoomCode) return;
  if (!isHost) {
    // Un non-host ne peut pas décider de retourner tout le monde au lobby
    showToast("Seul le chef peut retourner au salon");
    return;
  }
  const ok = await showConfirm({
    title: "Retourner au salon ?",
    message: "La partie en cours sera annulée pour tout le monde.",
    emoji: "🏠",
    yesLabel: "Confirmer",
    noLabel: "Annuler"
  });
  if (!ok) return;
  await update(ref(db, `rooms/${currentRoomCode}`), {
    status: "lobby",
    gameState: null,
    resultats: null,
    votes_themes: null,
    propositions: null,
    votes_mots: null,
    selectedTheme: null,
    selectedWords: null
  });
});
// Quitter
$("#btnSettingsLeaveGame").addEventListener("click", () => {
  settingsModal.classList.remove("active");
  leaveRoom();
});

// Gestion des thèmes de couleur
const applyColorTheme = (theme) => {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("undercover_colorTheme", theme);
  document.querySelectorAll('input[name="color-theme"]').forEach(r => r.checked = (r.value === theme));
};
document.querySelectorAll('input[name="color-theme"]').forEach(radio => {
  radio.addEventListener("change", (e) => {
    if (e.target.checked) applyColorTheme(e.target.value);
  });
});
// Init theme depuis localStorage
const savedTheme = localStorage.getItem("undercover_colorTheme") || "default";
applyColorTheme(savedTheme);

// Dark/Light mode
// Convention : toggle "active" = mode clair ON, inactif = mode sombre
const applyLightMode = (isLight) => {
  if (isLight) {
    document.documentElement.classList.add("light-mode");
    document.body.classList.add("light-mode");
    $("#themeLabel").innerText = "☀️ Mode Clair";
  } else {
    document.documentElement.classList.remove("light-mode");
    document.body.classList.remove("light-mode");
    $("#themeLabel").innerText = "🌙 Mode Sombre";
  }
  localStorage.setItem("undercover_lightMode", isLight ? "1" : "0");
  // Sync toggle visuel : "active" = mode clair
  document.querySelector('[data-simple-toggle="darkMode"]')?.classList.toggle("active", isLight);
};
const savedLight = localStorage.getItem("undercover_lightMode") === "1";
applyLightMode(savedLight);

document.querySelector('[data-simple-toggle="darkMode"]')?.addEventListener("click", () => {
  // Lire l'état actuel depuis le DOM : active = actuellement en light
  const currentlyLight = document.querySelector('[data-simple-toggle="darkMode"]').classList.contains("active");
  // Inverser
  applyLightMode(!currentlyLight);
});

// ======================================================================
// MODALES — RÈGLES
// ======================================================================
const rulesModal = $("#rulesModal");
$("#btnShowRules")?.addEventListener("click", () => rulesModal.classList.add("active"));
$$(".btn-close-rules").forEach(b => b.addEventListener("click", () => rulesModal.classList.remove("active")));
rulesModal.addEventListener("click", (e) => {
  if (e.target === rulesModal) rulesModal.classList.remove("active");
});

// ======================================================================
// PRÉSENCE (onDisconnect) — marque disconnected_at au lieu de supprimer
// pour permettre la reconnexion dans les 60 secondes
// ======================================================================
const RECONNECT_WINDOW_MS = 60_000; // 60 secondes

const setupPresence = (code, playerId) => {
  const playerRef = ref(db, `rooms/${code}/players/${playerId}`);
  // Marquer le joueur comme déconnecté avec un timestamp (on le supprime PAS)
  // Cela permet de détecter la reconnexion et laisser 60s pour revenir
  onDisconnect(child(playerRef, "disconnectedAt")).set(serverTimestamp());
  // Marquer comme "online" au connect
  update(playerRef, { disconnectedAt: null, lastSeenAt: serverTimestamp() });
};

// Nettoyage périodique : retire les joueurs déconnectés depuis plus de 60s
// (seul le host fait ce ménage, pour éviter les conflits)
const cleanupDisconnectedPlayers = async () => {
  if (!currentRoomCode || !isHost) return;
  try {
    const snap = await get(ref(db, `rooms/${currentRoomCode}/players`));
    const players = snap.val() || {};
    const now = Date.now();
    const updates = {};
    for (const pid in players) {
      const disc = players[pid].disconnectedAt;
      if (disc && typeof disc === "number" && (now - disc) > RECONNECT_WINDOW_MS) {
        // Joueur déconnecté depuis plus de 60s -> on l'expulse
        updates[`rooms/${currentRoomCode}/players/${pid}`] = null;
        // Si partie en cours, marquer son rôle comme inactif (il n'attendra plus son vote/indice)
        updates[`rooms/${currentRoomCode}/gameState/kickedPlayers/${pid}`] = true;
      }
    }
    if (Object.keys(updates).length > 0) {
      await update(ref(db), updates);
    }
  } catch (e) { console.warn("Cleanup error:", e); }
};
setInterval(cleanupDisconnectedPlayers, 10_000); // check toutes les 10 secondes

// ======================================================================
// CRÉATION DE PARTIE
// ======================================================================
const createRoom = async () => {
  const name = sanitizeName($("#inputPseudo").value);
  if (name.length < 2) {
    $("#inputPseudo").classList.add("shake");
    setTimeout(() => $("#inputPseudo").classList.remove("shake"), 500);
    return showToast("👤 Pseudo trop court (min 2 caractères)");
  }

  myName = name;
  localStorage.setItem("undercover_pseudo", myName);

  const btn = $("#btnCreate");
  btn.disabled = true;
  const origText = btn.innerHTML;
  btn.innerHTML = "✨ Création...";

  // Génération d'un code unique
  let code = "", attempts = 0, unique = false;
  while (!unique && attempts < 10) {
    code = genCode();
    const snap = await get(ref(db, `rooms/${code}`));
    if (!snap.exists()) unique = true;
    attempts++;
  }
  if (!unique) {
    btn.disabled = false;
    btn.innerHTML = origText;
    return showToast("❌ Erreur de création, réessaye");
  }

  // Création de la room
  await set(ref(db, `rooms/${code}`), {
    hostId: myPlayerId,
    status: "lobby",
    createdAt: serverTimestamp(),
    players: {
      [myPlayerId]: {
        name: myName,
        isBot: false,
        isHost: true,
        pret: false,
        joinedAt: serverTimestamp()
      }
    }
  });

  currentRoomCode = code;
  isHost = true;
  localStorage.setItem("undercover_currentRoom", code);
  setupPresence(code, myPlayerId);
  listenToRoom(code);

  btn.disabled = false;
  btn.innerHTML = origText;
  showScreen("screen-lobby");
};

// ======================================================================
// REJOINDRE UNE PARTIE
// ======================================================================
const joinRoom = async () => {
  const name = sanitizeName($("#inputPseudo").value);
  const code = $("#inputCode").value.trim().toUpperCase();

  if (name.length < 2) {
    $("#inputPseudo").classList.add("shake");
    setTimeout(() => $("#inputPseudo").classList.remove("shake"), 500);
    return showToast("👤 Pseudo trop court");
  }
  if (code.length !== 4) {
    $("#inputCode").classList.add("shake");
    setTimeout(() => $("#inputCode").classList.remove("shake"), 500);
    return showToast("🔑 Code à 4 caractères");
  }

  myName = name;
  localStorage.setItem("undercover_pseudo", myName);

  const btn = $("#btnJoin");
  btn.disabled = true;
  const origText = btn.innerHTML;
  btn.innerHTML = "🔗 Connexion...";

  try {
    const snap = await get(ref(db, `rooms/${code}`));
    if (!snap.exists()) {
      showToast("❌ Salon introuvable");
      return;
    }
    const data = snap.val();
    if (data.status !== "lobby") {
      showToast("⚠️ Cette partie a déjà commencé");
      return;
    }
    // Check pseudo unique dans la room
    const nameTaken = Object.values(data.players || {}).some(
      p => p.name.toLowerCase() === myName.toLowerCase()
    );
    if (nameTaken) {
      showToast("❌ Ce pseudo est déjà pris dans ce salon");
      return;
    }

    await set(ref(db, `rooms/${code}/players/${myPlayerId}`), {
      name: myName,
      isBot: false,
      isHost: false,
      pret: false,
      joinedAt: serverTimestamp()
    });

    currentRoomCode = code;
    isHost = false;
    localStorage.setItem("undercover_currentRoom", code);
    setupPresence(code, myPlayerId);
    listenToRoom(code);

    showScreen("screen-lobby");
  } catch (err) {
    console.error(err);
    showToast("❌ Erreur de connexion");
  } finally {
    btn.disabled = false;
    btn.innerHTML = origText;
  }
};

// ======================================================================
// ÉCOUTE ROOM + RENDU
// ======================================================================
const listenToRoom = (code) => {
  if (unsubscribeRoom) unsubscribeRoom();

  const roomRef = ref(db, `rooms/${code}`);
  unsubscribeRoom = onValue(roomRef, (snap) => {
    if (!snap.exists()) {
      // Salon supprimé
      showToast("💨 Le salon a été fermé");
      leaveRoomLocal();
      return;
    }
    const data = snap.val();
    currentRoomData = data;

    // Vérifier que je suis toujours dedans
    if (!data.players || !data.players[myPlayerId]) {
      showToast("👋 Tu as été retiré du salon");
      leaveRoomLocal();
      return;
    }

    // Host transfer automatique si le host n'existe plus
    if (!data.players[data.hostId]) {
      // Le premier joueur (hors bot) devient host
      const newHostId = Object.keys(data.players).find(pid => !data.players[pid].isBot);
      if (newHostId) {
        update(ref(db, `rooms/${code}`), { hostId: newHostId });
        update(ref(db, `rooms/${code}/players/${newHostId}`), { isHost: true });
        if (newHostId === myPlayerId) {
          isHost = true;
          showToast("👑 Tu es le nouveau chef du salon");
        }
      }
    }

    isHost = (data.hostId === myPlayerId);

    // Rendu du lobby (toujours utile car le header fonctionne même sur les autres écrans)
    renderLobby(data, code);

    // Routage d'écran selon le status
    routeScreen(data);
  });
};

const renderLobby = (data, code) => {
  // Code affiché
  $("#lobbyCode").innerText = code;

  // Players
  const players = data.players || {};
  const playerIds = Object.keys(players).sort((a, b) => {
    // host en premier, puis par joinedAt
    if (a === data.hostId) return -1;
    if (b === data.hostId) return 1;
    return (players[a].joinedAt || 0) - (players[b].joinedAt || 0);
  });

  $("#playersCount").innerText = `(${playerIds.length})`;

  const listEl = $("#playersList");
  listEl.innerHTML = "";

  playerIds.forEach(pid => {
    const p = players[pid];
    const isMe = pid === myPlayerId;
    const isPlayerHost = pid === data.hostId;
    const isBot = !!p.isBot;

    const div = document.createElement("div");
    div.className = "player-card";
    if (isPlayerHost) div.classList.add("is-host");
    if (isMe) div.classList.add("is-me");
    if (isBot) div.classList.add("is-bot");

    div.innerHTML = `
      <div class="avatar">${escapeHTML(avatarLetter(p.name))}</div>
      <div style="flex:1; min-width:0;">
        <div class="player-name">
          ${escapeHTML(p.name)}
          ${isPlayerHost ? '<span style="font-size:0.95rem;">👑</span>' : ''}
          ${isMe ? '<span class="badge-me">Toi</span>' : ''}
          ${isBot ? '<span style="font-size:0.9rem;">🤖</span>' : ''}
        </div>
        <div class="player-label">
          ${isPlayerHost ? 'Chef du salon' : (isBot ? 'Bot' : 'Joueur')}
        </div>
      </div>
      ${isHost && !isMe ? `
        <button class="icon-btn kick-btn" data-kick="${pid}" title="Exclure">
          <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
          </svg>
        </button>
      ` : ''}
    `;
    listEl.appendChild(div);
  });

  // Bind kick buttons
  listEl.querySelectorAll("[data-kick]").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const targetId = btn.getAttribute("data-kick");
      const targetName = players[targetId]?.name || "ce joueur";
      const ok = await showConfirm({
        title: "Exclure ?",
        message: `Tu vas retirer ${targetName} du salon.`,
        emoji: "🚫",
        yesLabel: "Exclure",
        noLabel: "Annuler"
      });
      if (ok) {
        await remove(ref(db, `rooms/${code}/players/${targetId}`));
        showToast(`🚫 ${targetName} a été exclu·e`);
      }
    });
  });

  // Boutons host / guest
  if (isHost) {
    $("#btnHostConfig").style.display = "";
    $("#btnGuestWaiting").style.display = "none";
    $("#btnAddBot").style.display = "";
  } else {
    $("#btnHostConfig").style.display = "none";
    $("#btnGuestWaiting").style.display = "";
    $("#btnAddBot").style.display = "none";
  }
};

// ======================================================================
// AJOUTER UN BOT
// ======================================================================
const NOMS_BOTS = [
  "Le Daron", "Jean-Mi du 13", "Pablo", "Père Castor",
  "Maître Kebabier", "Bébé Requin", "Le Zinzin", "Inspecteur Gadget",
  "Gros Cerveau", "Le Forceur Fou", "Tonton René", "Miss Cata",
  "Roi du Bluff", "Pigeon Voleur", "Ninja Discret", "Le Gars Sûr",
  "Bouffon du Roi", "Monsieur Banane", "L'Imposteur Nul"
];

const addBot = async () => {
  if (!isHost || !currentRoomCode || !currentRoomData) return;
  const existingNames = Object.values(currentRoomData.players || {}).map(p => p.name);
  const available = NOMS_BOTS.filter(n => !existingNames.includes(n + " (bot)"));
  const botName = (available.length > 0
    ? available[Math.floor(Math.random() * available.length)]
    : "Clone " + Math.floor(Math.random() * 999)) + " (bot)";
  const botId = "bot_" + Math.random().toString(36).substring(2, 10);

  await set(ref(db, `rooms/${currentRoomCode}/players/${botId}`), {
    name: botName,
    isBot: true,
    isHost: false,
    pret: true,
    joinedAt: serverTimestamp()
  });
  showToast(`🤖 ${botName} a rejoint le salon`);
};

// ======================================================================
// QUITTER LE SALON
// ======================================================================
const leaveRoomLocal = () => {
  if (unsubscribeRoom) { unsubscribeRoom(); unsubscribeRoom = null; }
  currentRoomCode = null;
  currentRoomData = null;
  isHost = false;
  localStorage.removeItem("undercover_currentRoom");
  showScreen("screen-login");
};

const leaveRoom = async () => {
  if (!currentRoomCode) return;

  const players = currentRoomData?.players || {};
  const realPlayers = Object.entries(players).filter(([pid, p]) => !p.isBot);
  const iAmLastRealPlayer = realPlayers.length === 1 && realPlayers[0][0] === myPlayerId;

  const msg = iAmLastRealPlayer
    ? "Tu es le dernier joueur. Le salon sera fermé."
    : "Tu vas quitter ce salon.";

  const ok = await showConfirm({
    title: "Quitter le salon ?",
    message: msg,
    emoji: "🚪",
    yesLabel: "Quitter",
    noLabel: "Rester"
  });
  if (!ok) return;

  try {
    if (iAmLastRealPlayer) {
      // Suppression complète de la room
      await remove(ref(db, `rooms/${currentRoomCode}`));
    } else {
      // Juste me retirer
      await remove(ref(db, `rooms/${currentRoomCode}/players/${myPlayerId}`));
    }
  } catch (err) {
    console.error(err);
  }
  leaveRoomLocal();
  showToast("👋 Tu as quitté le salon");
};

// ======================================================================
// COPIER LE CODE
// ======================================================================
const copyCode = async () => {
  if (!currentRoomCode) return;
  try {
    await navigator.clipboard.writeText(currentRoomCode);
    showToast("📋 Code copié !");
  } catch {
    // Fallback
    const t = document.createElement("textarea");
    t.value = currentRoomCode;
    document.body.appendChild(t);
    t.select();
    document.execCommand("copy");
    t.remove();
    showToast("📋 Code copié !");
  }
};

// ======================================================================
// RECONNEXION AUTO (si page reload)
// ======================================================================
const tryAutoReconnect = async () => {
  const savedName = localStorage.getItem("undercover_pseudo");
  const savedCode = localStorage.getItem("undercover_currentRoom");
  const savedDisconnectTs = parseInt(localStorage.getItem("undercover_disconnectTs") || "0", 10);

  if (savedName) $("#inputPseudo").value = savedName;
  if (!savedName || !savedCode) return;

  // Si une partie solo est active dans ce navigateur, on n'auto-reconnecte
  // pas l'online (sinon le listener Firebase écraserait l'écran solo restauré).
  // On lit directement localStorage car window.__solo peut ne pas encore
  // exister au moment où tryAutoReconnect() s'exécute (parsing parallèle des modules).
  try {
    const raw = localStorage.getItem("undercover_solo_save_v1");
    if (raw) {
      const obj = JSON.parse(raw);
      if (obj?.state?.active) return;
    }
  } catch (e) { /* localStorage inaccessible — on continue normalement */ }

  // Vérifier que le joueur existe toujours dans la room
  const snap = await get(ref(db, `rooms/${savedCode}/players/${myPlayerId}`));
  if (!snap.exists()) {
    // Joueur déjà expulsé
    localStorage.removeItem("undercover_currentRoom");
    localStorage.removeItem("undercover_disconnectTs");
    return;
  }
  const roomSnap = await get(ref(db, `rooms/${savedCode}`));
  if (!roomSnap.exists()) {
    localStorage.removeItem("undercover_currentRoom");
    localStorage.removeItem("undercover_disconnectTs");
    return;
  }

  const roomData = roomSnap.val();
  const now = Date.now();
  const elapsed = savedDisconnectTs ? (now - savedDisconnectTs) : 0;
  const wasInGame = roomData.status === "playing" || (roomData.status === "config" && roomData.gameState);

  // Cas 1 : reload simple (peu de temps, < 5s) OU partie non commencée → reconnexion auto
  if (elapsed < 5_000) {
    await performReconnect(savedCode, savedName, roomData);
    return;
  }

  // Cas 2 : délai > 5s mais < 60s + partie en cours → popup
  if (elapsed <= RECONNECT_WINDOW_MS) {
    showReconnectPopup(savedCode, savedName, roomData);
    return;
  }

  // Cas 3 : délai > 60s → trop tard, on kick
  localStorage.removeItem("undercover_currentRoom");
  localStorage.removeItem("undercover_disconnectTs");
  showToast("⏰ Tu as été absent trop longtemps, retour à l'accueil.");
};

const performReconnect = async (code, name, roomData) => {
  myName = name;
  currentRoomCode = code;
  isHost = (roomData.hostId === myPlayerId);
  setupPresence(code, myPlayerId);
  listenToRoom(code);
  // Décider vers quel écran aller selon le statut de la room
  const status = roomData.status;
  if (status === "playing") {
    // Le listener routera selon gameState.phase
  } else {
    showScreen("screen-lobby");
  }
  localStorage.removeItem("undercover_disconnectTs");
  showToast("🔄 Reconnecté !");
};

const showReconnectPopup = (code, name, roomData) => {
  // Créer une modale dynamique
  const modal = document.createElement("div");
  modal.className = "modal-overlay active";
  modal.style.cssText = "z-index:100001;";
  modal.innerHTML = `
    <div class="modal-content glass" style="max-width:420px;padding:2rem 1.5rem;text-align:center;">
      <div style="font-size:2.8rem;margin-bottom:0.5rem;">🔌</div>
      <h3 class="font-display" style="font-size:1.3rem;font-weight:900;margin:0 0 0.5rem 0;">Reconnexion ?</h3>
      <p style="color:rgba(255,255,255,0.7);font-size:0.9rem;line-height:1.5;margin:0 0 1.2rem 0;">
        Tu avais une partie en cours dans le salon <strong style="color:rgba(var(--primary-rgb),1);">${escapeHTML(code)}</strong>.<br>
        Veux-tu rejoindre ?
      </p>
      <div style="display:flex;gap:0.6rem;">
        <button id="reconnectNo" class="btn btn-ghost flex-1">❌ Non, quitter</button>
        <button id="reconnectYes" class="btn btn-primary flex-1">✅ Oui, rejoindre</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  modal.querySelector("#reconnectYes").addEventListener("click", async () => {
    modal.remove();
    await performReconnect(code, name, roomData);
  });
  modal.querySelector("#reconnectNo").addEventListener("click", async () => {
    modal.remove();
    // On retire directement le joueur de la room
    try {
      await remove(ref(db, `rooms/${code}/players/${myPlayerId}`));
    } catch (e) { console.warn("Remove error:", e); }
    localStorage.removeItem("undercover_currentRoom");
    localStorage.removeItem("undercover_disconnectTs");
    showToast("👋 Tu as quitté la partie.");
  });
};

// Tracker le moment où l'utilisateur ferme l'onglet pour calculer le délai au retour
window.addEventListener("beforeunload", () => {
  if (currentRoomCode) {
    localStorage.setItem("undercover_disconnectTs", Date.now().toString());
  }
});
// Aussi quand la page devient masquée (iOS / mobile)
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" && currentRoomCode) {
    localStorage.setItem("undercover_disconnectTs", Date.now().toString());
  } else if (document.visibilityState === "visible" && currentRoomCode) {
    // Reconnexion visuelle : nettoyer le disconnect et relancer presence
    localStorage.removeItem("undercover_disconnectTs");
    if (myPlayerId && currentRoomCode) {
      update(ref(db, `rooms/${currentRoomCode}/players/${myPlayerId}`), {
        disconnectedAt: null,
        lastSeenAt: serverTimestamp()
      }).catch(() => {});
    }
  }
});

// ======================================================================
// DICTIONNAIRE DE BASE (minimal — extensible via communauté)
// ======================================================================
let dictionnaireThematique = JSON.parse(JSON.stringify(dictionnaireBase));

// Écoute des mots communautaires partagés (global, pas par room)
onValue(ref(db, 'mots_communautes'), (s) => {
  const ajouts = s.val() || {};
  dictionnaireThematique = JSON.parse(JSON.stringify(dictionnaireBase));
  for (const theme in ajouts) {
    if (!dictionnaireThematique[theme]) dictionnaireThematique[theme] = [];
    for (const id in ajouts[theme]) {
      dictionnaireThematique[theme].push(ajouts[theme][id]);
    }
  }
  // Rafraîchir les listes thèmes si visibles
  if ($("#screen-vote-theme").classList.contains("active") && currentRoomData) {
    renderVoteThemes(currentRoomData);
  }
  // Rafraîchir le select d'ajout
  refreshAddWordsSelect();
});

const refreshAddWordsSelect = () => {
  const sel = $("#addWordsTheme");
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = "";
  Object.keys(dictionnaireThematique).forEach(t => {
    const opt = document.createElement("option");
    opt.value = t; opt.innerText = t;
    sel.appendChild(opt);
  });
  if (current && dictionnaireThematique[current]) sel.value = current;
};

// ======================================================================
// CONFIG PAR DÉFAUT
// ======================================================================
const defaultConfig = () => ({
  gameMode: "classique",
  nbU: 1, nbW: 0, nbI: 0, nbF: 0, nbP: 0,
  optCouple: false,
  voteAno: false,
  voirRoleUnder: true,
  underConnus: false,
  voirTheme: true,
  emoji: false,
  aveugle: false,
  regleEgalite: "duel"
});

// ======================================================================
// LECTURE / ÉCRITURE CONFIG
// ======================================================================
let configLocal = defaultConfig();
let configWriteTimeout = null;

const pushConfig = () => {
  if (!currentRoomCode || !isHost) return;
  clearTimeout(configWriteTimeout);
  configWriteTimeout = setTimeout(() => {
    set(ref(db, `rooms/${currentRoomCode}/config`), configLocal);
  }, 200);
};

const readConfig = (data) => {
  const c = data.config || defaultConfig();
  configLocal = { ...defaultConfig(), ...c };
  $("#configCode").innerText = currentRoomCode || "";
  // Mettre à jour l'UI
  $("#cfgGameMode").value = configLocal.gameMode;
  $("#cfgRegleEgalite").value = configLocal.regleEgalite;
  ["U","W","I","F","P"].forEach(k => {
    const el = document.querySelector(`.counter[data-counter="${k}"] .counter-value`);
    if (el) el.innerText = configLocal["nb" + k];
  });
  ["optCouple","voteAno","voirRoleUnder","underConnus","voirTheme","emoji","aveugle"].forEach(k => {
    const t = document.querySelector(`.toggle[data-toggle="${k}"]`);
    if (t) t.classList.toggle("active", !!configLocal[k]);
  });
  // MJ
  const mjId = data.mjId;
  const mjBanner = $("#mjBanner");
  if (mjId && data.players?.[mjId]) {
    mjBanner.style.display = "";
    $("#mjBannerName").innerText = data.players[mjId].name;
    if (mjId === myPlayerId) {
      $("#btnDevenirMJ").style.display = "none";
      $("#btnQuitterMJ").style.display = "";
    } else {
      $("#btnDevenirMJ").style.display = "none";
      $("#btnQuitterMJ").style.display = "none";
    }
  } else {
    mjBanner.style.display = "none";
    $("#btnDevenirMJ").style.display = "";
    $("#btnQuitterMJ").style.display = "none";
  }
  updateBalance(data);
};

// ======================================================================
// BALANCE (vérifie que la config est jouable)
// ======================================================================
const updateBalance = (data) => {
  const players = data.players || {};
  const mjId = data.mjId;
  const nonBots = Object.keys(players).filter(pid => !players[pid].isBot);
  const activePlayers = Object.keys(players).filter(pid => pid !== mjId);
  const nbJ = activePlayers.length;

  const { nbU, nbW, nbI, nbP, optCouple } = configLocal;
  const imposteurs = nbU + nbW + nbI;
  const totalRolesSpe = nbU + nbW + nbI + nbP;
  const maxImposteurs = Math.floor((nbJ - 1) / 2);

  let msg = "", err = false;

  if (nbJ < 3) { msg = "⚠️ Minimum 3 joueurs actifs (hors MJ)"; err = true; }
  else if (nbJ < totalRolesSpe + 1) { msg = `⚠️ Plus de rôles que de joueurs (il faut ≥ 1 civil)`; err = true; }
  else if (imposteurs === 0) { msg = "⚠️ Au moins 1 imposteur (U / W / I) requis"; err = true; }
  else if (imposteurs > maxImposteurs) { msg = `⚠️ Trop d'imposteurs (max ${maxImposteurs} pour ${nbJ} joueurs)`; err = true; }
  else if (optCouple && nbJ < 4) { msg = "⚠️ Amoureux : min 4 joueurs"; err = true; }
  else { msg = `✓ ${nbJ} joueurs · ${imposteurs} imposteurs · ${nbJ - totalRolesSpe} civils`; }

  const el = $("#balanceInfo");
  el.innerText = msg;
  el.classList.toggle("error", err);
  $("#btnStartGame").disabled = err;
  return !err;
};

// ======================================================================
// UI CONFIG : compteurs & toggles
// ======================================================================
document.querySelectorAll(".counter").forEach(c => {
  const key = c.getAttribute("data-counter");
  c.querySelectorAll(".counter-btn").forEach(b => {
    b.addEventListener("click", () => {
      if (!isHost) return;
      const delta = parseInt(b.getAttribute("data-delta"));
      const cur = configLocal["nb" + key] || 0;

      // 1. On compte les joueurs actifs dans le salon (hors MJ)
      let nbJoueurs = 10;
      if (currentRoomData && currentRoomData.players) {
        const mjId = currentRoomData.mjId;
        nbJoueurs = Object.keys(currentRoomData.players).filter(pid => pid !== mjId).length;
      }

      // 2. Clamp en tenant compte des autres rôles déjà alloués :
      //    - il faut au moins 1 Civil (donc max = nbJoueurs - autresSpéciaux - 1)
      //    - les imposteurs (U/W/I) sont bornés par floor((nbJoueurs-1)/2)
      const nbU = configLocal.nbU || 0, nbW = configLocal.nbW || 0;
      const nbI = configLocal.nbI || 0, nbP = configLocal.nbP || 0;
      const totalSpe = nbU + nbW + nbI + nbP;
      const otherSpecials = totalSpe - cur;
      const maxForKey = nbJoueurs - otherSpecials - 1; // ≥ 1 civil restant

      const isImposterRole = (key === "U" || key === "W" || key === "I");
      let maxByImposters = Infinity;
      if (isImposterRole) {
        const totalImp = nbU + nbW + nbI;
        const otherImp = totalImp - cur;
        maxByImposters = Math.floor((nbJoueurs - 1) / 2) - otherImp;
      }
      const bound = Math.max(0, Math.min(maxForKey, maxByImposters));
      const next = Math.max(0, Math.min(bound, cur + delta));

      if (next === cur) return;

      configLocal["nb" + key] = next;
      c.querySelector(".counter-value").innerText = next;

      // La fonction updateBalance gère l'affichage des avertissements de ratio
      if (currentRoomData) updateBalance(currentRoomData);
      pushConfig();
    });
  });
});

document.querySelectorAll(".toggle").forEach(t => {
  t.addEventListener("click", () => {
    if (!isHost) return;
    const key = t.getAttribute("data-toggle");
    configLocal[key] = !configLocal[key];
    t.classList.toggle("active", configLocal[key]);
    if (currentRoomData) updateBalance(currentRoomData);
    pushConfig();
  });
});

$("#cfgGameMode").addEventListener("change", (e) => {
  if (!isHost) return;
  configLocal.gameMode = e.target.value;
  pushConfig();
});
$("#cfgRegleEgalite").addEventListener("change", (e) => {
  if (!isHost) return;
  configLocal.regleEgalite = e.target.value;
  pushConfig();
});

// ======================================================================
// RETOUR CONFIG → LOBBY
// ======================================================================
$("#btnConfigBack").addEventListener("click", async () => {
  if (!isHost || !currentRoomCode) return;
  await update(ref(db, `rooms/${currentRoomCode}`), { status: "lobby" });
});

// ======================================================================
// MJ MANUEL
// ======================================================================
$("#btnDevenirMJ").addEventListener("click", async () => {
  if (!currentRoomCode) return;
  if (!currentRoomData) return;
  if (currentRoomData.mjId) return showToast("Un MJ est déjà désigné");
  await update(ref(db, `rooms/${currentRoomCode}`), { mjId: myPlayerId });
  showToast("👑 Tu es désormais le MJ");
});
$("#btnQuitterMJ").addEventListener("click", async () => {
  if (!currentRoomCode || !currentRoomData) return;
  if (currentRoomData.mjId !== myPlayerId) return;
  await update(ref(db, `rooms/${currentRoomCode}`), { mjId: null });
  showToast("MJ abandonné");
});

// ======================================================================
// MODAL INFO (explications des rôles/modes)
// ======================================================================
const roleInfos = {
  'U': { t: "😈 Undercover", d: "Tu as un mot proche de celui des Civils. Ton but : ne pas te faire démasquer et éliminer tous les Civils.", p: "Victoire : +20 pts · Survivant : +5 pts" },
  'W': { t: "👻 Mr White",   d: "Tu n'as PAS de mot ! Tu dois bluffer et deviner celui des Civils en écoutant leurs indices pour t'en sortir si tu es éliminé.", p: "Victoire : +20 pts · Deviner le mot : +25 pts" },
  'I': { t: "🎭 Imitateur",  d: "Au début, tu choisis un joueur pour voler son rôle et son mot. Si tu n'actives pas ton pouvoir, tu deviens un Mr White !", p: "Points selon le rôle volé (ou +20 en cas d'inactivité)" },
  'F': { t: "⚡ Forceur",     d: "Une fois par partie, tu peux forcer un joueur à donner un 2ème indice. Ton camp (civil ou imposteur) dépend de ton mot secret !", p: "Gagne avec son équipe · Bonus : +5 pts" },
  'P': { t: "🥺 Paria",       d: "Tu joues avec les Civils, MAIS si tu réussis à te faire éliminer au 1er tour, tu voles la victoire !", p: "Exploit réussi : victoire solo (+40 pts)" },
  'c': { t: "💘 Amoureux",    d: "Deux joueurs sont liés secrètement. S'il ne reste qu'eux deux, ils gagnent ! Mais si l'un meurt, l'autre meurt de chagrin.", p: "Victoire couple : +30 pts" },
  'emoji':   { t: "🌟 Mode Emoji", d: "Les lettres et chiffres sont bloqués dans les indices. Exprime-toi uniquement avec des emojis !", p: "Bonus : 100% de galère 😂" },
  'aveugle': { t: "🌑 Mode Aveugle", d: "Les indices sont cachés jusqu'à la fin du tour, puis tous révélés en même temps avant le vote. Suspense total !", p: "—" }
};
document.body.addEventListener("click", (e) => {
  const btn = e.target.closest(".info-icon");
  if (!btn) return;
  const key = btn.getAttribute("data-info");
  const info = roleInfos[key];
  if (!info) return;
  $("#infoTitle").innerText = info.t;
  $("#infoDesc").innerText = info.d;
  $("#infoPts").innerText = info.p;
  $("#infoModal").classList.add("active");
});
$("#infoModal").addEventListener("click", (e) => {
  if (e.target === $("#infoModal")) $("#infoModal").classList.remove("active");
});
document.querySelectorAll(".btn-close-info").forEach(b => b.addEventListener("click", () => $("#infoModal").classList.remove("active")));

// ======================================================================
// MODAL AJOUT MOTS COMMUNAUTÉ
// ======================================================================
const openAddWords = () => {
  refreshAddWordsSelect();
  $("#addWordsMot1").value = "";
  $("#addWordsMot2").value = "";
  $("#addWordsModal").classList.add("active");
};
$("#btnAddWords").addEventListener("click", openAddWords);
document.querySelectorAll(".btn-close-add-words").forEach(b => b.addEventListener("click", () => $("#addWordsModal").classList.remove("active")));
$("#addWordsModal").addEventListener("click", (e) => {
  if (e.target === $("#addWordsModal")) $("#addWordsModal").classList.remove("active");
});

$("#btnValidateAddWords").addEventListener("click", async () => {
  const theme = $("#addWordsTheme").value;
  const m1 = sanitizeName($("#addWordsMot1").value).toUpperCase();
  const m2 = sanitizeName($("#addWordsMot2").value).toUpperCase();
  if (!theme) return showToast("Choisis un thème");
  if (!m1 || !m2) return showToast("⚠️ Remplis les 2 mots");
  if (m1 === m2) return showToast("⚠️ Les 2 mots doivent être différents");
  try {
    await push(ref(db, `mots_communautes/${theme}`), [m1, m2]);
    showToast("✅ Ajoutés à la banque !");
    $("#addWordsModal").classList.remove("active");
  } catch (e) {
    console.error(e);
    showToast("❌ Erreur d'enregistrement");
  }
});

// ======================================================================
// LANCEMENT DE LA PARTIE (Host)
// ======================================================================
$("#btnStartGame").addEventListener("click", async () => {
  if (!isHost || !currentRoomCode || !currentRoomData) return;
  if (!updateBalance(currentRoomData)) return showToast("⚠️ Config invalide");

  // Selon mode : vote_theme OU vote_mots
  const target = configLocal.gameMode === "hybride" ? "vote_mots" : "vote_theme";
  // Reset votes précédents si existaient
  const updates = {
    status: target,
    votes_themes: null,
    propositions: null,
    votes_mots: null,
    selectedTheme: null,
    selectedWords: null
  };
  await update(ref(db, `rooms/${currentRoomCode}`), updates);
  showToast("🚀 C'est parti !");
});

// ======================================================================
// RENDER VOTE THÈMES
// ======================================================================
const renderVoteThemes = (data) => {
  $("#voteThemeCode").innerText = currentRoomCode || "";
  const themes = Object.keys(dictionnaireThematique);
  const votes = data.votes_themes || {};
  const list = $("#themesList");
  list.innerHTML = "";

  // Seuls les VRAIS joueurs (non-bot, non-MJ) votent
  const voters = Object.keys(data.players || {})
    .filter(pid => pid !== data.mjId && !data.players[pid]?.isBot);
  const nbVoters = voters.length;

  let totalVotes = 0;

  themes.forEach(theme => {
    // Ne compter QUE les votes de vrais joueurs
    const voters4 = votes[theme]
      ? Object.keys(votes[theme]).filter(pid => !data.players?.[pid]?.isBot && pid !== data.mjId)
      : [];
    const myVote = voters4.includes(myPlayerId);
    totalVotes += voters4.length;

    const card = document.createElement("div");
    card.className = "vote-card" + (myVote ? " voted" : "");
    const themeCount = (theme === "🎲 Aléatoire (tous thèmes)")
      ? Object.keys(dictionnaireThematique).filter(t => t !== theme).reduce((s, t) => s + dictionnaireThematique[t].length, 0)
      : dictionnaireThematique[theme].length;
    card.innerHTML = `
      <div class="vote-card-label">
        <span>${theme.startsWith("🎲") ? "" : "🎨"}</span>
        <span>${escapeHTML(theme)}</span>
        <span style="opacity:0.5;font-size:0.72rem;font-weight:600;">(${themeCount} paires)</span>
      </div>
      <div class="vote-card-count">${voters4.length}</div>
    `;
    if (data.mjId !== myPlayerId && !data.players?.[myPlayerId]?.isBot) {
      card.addEventListener("click", async () => {
        const updates = {};
        themes.forEach(t => { updates[`votes_themes/${t}/${myPlayerId}`] = null; });
        if (!myVote) updates[`votes_themes/${theme}/${myPlayerId}`] = true;
        await update(ref(db, `rooms/${currentRoomCode}`), updates);
      });
    } else {
      card.style.opacity = 0.6;
      card.style.cursor = "default";
    }
    list.appendChild(card);
  });

  // Bouton clôturer caché — auto-clôture
  $("#btnValidateTheme").style.display = "none";

  // Auto-clôture quand tout le monde a voté (seul le host déclenche)
  if (isHost && nbVoters > 0 && totalVotes >= nbVoters && !window.__voteThemeClosing) {
    window.__voteThemeClosing = true;
    showToast("✓ Tout le monde a voté · Clôture dans 3s...");
    setTimeout(async () => {
      try {
        const freshData = (await get(ref(db, `rooms/${currentRoomCode}`))).val();
        if (!freshData || freshData.status !== "vote_theme") { window.__voteThemeClosing = false; return; }

        const freshVotes = freshData.votes_themes || {};
        const counts = {};
        themes.forEach(t => {
          counts[t] = freshVotes[t]
            ? Object.keys(freshVotes[t]).filter(pid => !freshData.players?.[pid]?.isBot && pid !== freshData.mjId).length
            : 0;
        });
        const max = Math.max(...Object.values(counts));
        if (max === 0) { window.__voteThemeClosing = false; return; }
        const winners = themes.filter(t => counts[t] === max);
        const winner = winners[Math.floor(Math.random() * winners.length)];

        let pair, trueThemeLabel; // Variables pour stocker les mots ET le vrai thème

        if (winner === "🎲 Aléatoire (tous thèmes)") {
          const allPairs = [];
          for (const th in dictionnaireThematique) {
            if (th === "🎲 Aléatoire (tous thèmes)") continue;
            
            // ASTUCE : On emballe la paire de mots avec son vrai thème !
            dictionnaireThematique[th].forEach(p => {
              allPairs.push({ mots: p, themeReel: th });
            });
          }
          
          if (allPairs.length === 0) { window.__voteThemeClosing = false; return; }
          
          // On tire au sort dans notre grand sac
          const tirage = allPairs[Math.floor(Math.random() * allPairs.length)];
          pair = tirage.mots;
          trueThemeLabel = tirage.themeReel; // <--- On récupère le VRAI thème (ex: "Animaux")
          
        } else {
          // Un thème précis a été voté
          const pool = dictionnaireThematique[winner];
          if (!pool || pool.length === 0) { window.__voteThemeClosing = false; return; }
          pair = pool[Math.floor(Math.random() * pool.length)];
          trueThemeLabel = winner;
        }

        await update(ref(db, `rooms/${currentRoomCode}`), {
          selectedTheme: trueThemeLabel, // <--- Ça sauvegarde "Animaux", "Cinéma", etc. dans Firebase
          selectedWords: { civil: pair[0], under: pair[1] }
        });

        const freshData2 = (await get(ref(db, `rooms/${currentRoomCode}`))).val();
        await distributeRolesAuto(freshData2);
        } finally {
          window.__voteThemeClosing = false;
        }
        }, 3000);
  }
};

// ======================================================================
// RENDER VOTE MOTS (hybride)
// ======================================================================
const renderVoteMots = (data) => {
  $("#voteMotsCode").innerText = currentRoomCode || "";
  const props = data.propositions || {};
  const votes = data.votes_mots || {};
  // Vrais joueurs uniquement (pas bot, pas MJ)
  const voters = Object.keys(data.players || {})
    .filter(pid => pid !== data.mjId && !data.players[pid]?.isBot);
  const nbVoters = voters.length;

  // Si j'ai déjà proposé, désactive la zone
  const myProp = props[myPlayerId];
  const iAmBot = !!data.players?.[myPlayerId]?.isBot;
  if (myProp) {
    $("#propMot1").value = myProp.mot1;
    $("#propMot2").value = myProp.mot2;
    $("#propMot1").disabled = true;
    $("#propMot2").disabled = true;
    $("#btnPropose").innerText = "✓ Paire proposée";
    $("#btnPropose").disabled = true;
  } else if (data.mjId === myPlayerId || iAmBot) {
    $("#propMot1").disabled = true;
    $("#propMot2").disabled = true;
    $("#btnPropose").innerText = "(MJ ne propose pas)";
    $("#btnPropose").disabled = true;
  } else {
    $("#propMot1").disabled = false;
    $("#propMot2").disabled = false;
    $("#btnPropose").innerText = "Proposer ma paire";
    $("#btnPropose").disabled = false;
  }

  // Liste propositions
  const listEl = $("#propositionsList");
  listEl.innerHTML = "";
  const propIds = Object.keys(props);
  let totalVotes = 0;

  if (propIds.length === 0) {
    listEl.innerHTML = `<p style="text-align:center;color:rgba(255,255,255,0.4);font-size:0.85rem;padding:1rem 0;">En attente des propositions…</p>`;
  }

  propIds.forEach(pid => {
    const p = props[pid];
    // Ne compter que les votes de vrais joueurs
    const voters4 = votes[pid]
      ? Object.keys(votes[pid]).filter(vpid => !data.players?.[vpid]?.isBot && vpid !== data.mjId)
      : [];
    const myVote = voters4.includes(myPlayerId);
    totalVotes += voters4.length;

    const author = data.players?.[pid]?.name || "?";
    const card = document.createElement("div");
    card.className = "vote-card" + (myVote ? " voted" : "");
    card.innerHTML = `
      <div class="vote-card-label" style="flex-direction:column;align-items:flex-start;gap:0.2rem;">
        <div><span style="color:rgba(var(--primary-rgb),1);">${escapeHTML(p.mot1)}</span> <span style="opacity:0.5;">/</span> <span style="color:rgba(var(--secondary-rgb),1);">${escapeHTML(p.mot2)}</span></div>
        <span style="font-size:0.7rem;font-weight:500;opacity:0.45;">proposé par ${escapeHTML(author)}</span>
      </div>
      <div class="vote-card-count">${voters4.length}</div>
    `;
    if (data.mjId !== myPlayerId && !iAmBot) {
      card.addEventListener("click", async () => {
        const updates = {};
        propIds.forEach(id => { updates[`votes_mots/${id}/${myPlayerId}`] = null; });
        if (!myVote) updates[`votes_mots/${pid}/${myPlayerId}`] = true;
        await update(ref(db, `rooms/${currentRoomCode}`), updates);
      });
    } else {
      card.style.opacity = 0.6;
      card.style.cursor = "default";
    }
    listEl.appendChild(card);
  });

  // Bouton clôturer caché — auto-clôture
  $("#btnValidateWords").style.display = "none";

  // Auto-clôture quand tous ont voté (host déclenche)
  // Prérequis : au moins 1 proposition ET tous les vrais joueurs ont voté
  if (isHost && nbVoters > 0 && propIds.length > 0 && totalVotes >= nbVoters && !window.__voteMotsClosing) {
    window.__voteMotsClosing = true;
    showToast("✓ Tout le monde a voté · Clôture dans 3s...");
    setTimeout(async () => {
      try {
        const freshData = (await get(ref(db, `rooms/${currentRoomCode}`))).val();
        if (!freshData || freshData.status !== "vote_mots") { window.__voteMotsClosing = false; return; }
        const freshVotes = freshData.votes_mots || {};
        const freshPropIds = Object.keys(freshData.propositions || {});
        if (freshPropIds.length === 0) { window.__voteMotsClosing = false; return; }
        const counts = {};
        freshPropIds.forEach(id => {
          counts[id] = freshVotes[id]
            ? Object.keys(freshVotes[id]).filter(vpid => !freshData.players?.[vpid]?.isBot && vpid !== freshData.mjId).length
            : 0;
        });
        const max = Math.max(...Object.values(counts));
        if (max === 0) { window.__voteMotsClosing = false; return; }
        const winners = freshPropIds.filter(id => counts[id] === max);
        const winnerId = winners[Math.floor(Math.random() * winners.length)];
        const w = freshData.propositions[winnerId];
        await update(ref(db, `rooms/${currentRoomCode}`), {
          selectedTheme: "Personnalisé",
          selectedWords: { civil: w.mot1, under: w.mot2 }
        });
        const freshData2 = (await get(ref(db, `rooms/${currentRoomCode}`))).val();
        await distributeRolesAuto(freshData2);
      } finally {
        window.__voteMotsClosing = false;
      }
    }, 3000);
  }
};

// Bouton proposer
$("#btnPropose").addEventListener("click", async () => {
  if (!currentRoomCode || !currentRoomData) return;
  if (currentRoomData.mjId === myPlayerId) return;
  const m1 = sanitizeName($("#propMot1").value).toUpperCase();
  const m2 = sanitizeName($("#propMot2").value).toUpperCase();
  if (!m1 || !m2) return showToast("⚠️ Remplis les 2 mots");
  if (m1 === m2) return showToast("⚠️ Les mots doivent être différents");
  await set(ref(db, `rooms/${currentRoomCode}/propositions/${myPlayerId}`), { mot1: m1, mot2: m2 });
  showToast("✓ Paire envoyée");
});

// ======================================================================
// ROUTAGE D'ÉCRANS BASÉ SUR LE STATUS
// ======================================================================
const routeScreen = (data) => {
  if (!data) return;
  // Cas spéciaux phase gameState
  if (data.status === "jeu") {
    const ph = data.gameState?.phase;
    if (ph === "MR_WHITE_GUESS") {
      showScreen("screen-mr-white");
      renderMrWhiteGuess(data);
      return;
    }
    if (ph === "IMITATEUR") {
      if (data.gameState?.imitateurActif === myPlayerId) {
        showScreen("screen-imitator");
        renderImitator(data);
      } else {
        showScreen("screen-game");
        renderGameExtended(data);
      }
      return;
    }
    if (ph === "DUEL") {
      showScreen("screen-duel");
      renderDuel(data);
      return;
    }
  }
  switch (data.status) {
    case "lobby":        showScreen("screen-lobby"); break;
    case "config":       showScreen("screen-config"); readConfig(data); break;
    case "vote_theme":   showScreen("screen-vote-theme"); renderVoteThemes(data); break;
    case "vote_mots":    showScreen("screen-vote-mots"); renderVoteMots(data); break;
    case "distribution":
      if (isHost && !data.gameState) distributeRolesAuto(data);
      showScreen("screen-lobby");
      break;
    case "jeu":          showScreen("screen-game"); renderGameExtended(data); break;
    case "resultats":    showScreen("screen-results"); renderResults(data); break;
    default:             showScreen("screen-lobby");
  }
};

// ======================================================================
// DISTRIBUTION DES RÔLES (Auto)
// ======================================================================
const shuffle = (arr) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const distributeRolesAuto = async (data) => {
  const code = currentRoomCode;
  if (!code) return;

  const c = data.config || defaultConfig();
  const sw = data.selectedWords;
  if (!sw || !sw.civil || !sw.under) {
    return showToast("⚠️ Pas de mots sélectionnés");
  }

  // Joueurs actifs (hors MJ)
  const mjId = data.mjId || null;
  const activePlayerIds = Object.keys(data.players || {}).filter(pid => pid !== mjId);
  if (activePlayerIds.length < 3) return showToast("⚠️ Minimum 3 joueurs");

  // On mélange et on distribue
  const deck = shuffle(activePlayerIds);
  const roles = {};

  const take = (n, assign) => {
    for (let i = 0; i < n; i++) {
      if (deck.length === 0) break;
      const pid = deck.pop();
      roles[pid] = assign(pid);
    }
  };

  take(c.nbU || 0, (pid) => ({ role: "UNDERCOVER", roleInitial: "UNDERCOVER", mot: sw.under, camp: "UNDERCOVER", enVie: true, pouvoirUtilise: false }));
  take(c.nbW || 0, (pid) => ({ role: "MR WHITE",   roleInitial: "MR WHITE",   mot: "???",      camp: "UNDERCOVER", enVie: true, pouvoirUtilise: false }));
  take(c.nbI || 0, (pid) => ({ role: "IMITATEUR",  roleInitial: "IMITATEUR",  mot: "???",      camp: "UNDERCOVER", enVie: true, pouvoirUtilise: false }));
  take(c.nbP || 0, (pid) => ({ role: "PARIA",      roleInitial: "PARIA",      mot: sw.civil,   camp: "CIVIL",      enVie: true, pouvoirUtilise: false }));
  // Reste = Civils
  deck.forEach(pid => {
    roles[pid] = { role: "CIVIL", roleInitial: "CIVIL", mot: sw.civil, camp: "CIVIL", enVie: true, pouvoirUtilise: false };
  });

  // Forceur (pouvoir secondaire aléatoire)
  if (c.nbF && c.nbF > 0) {
    const candidates = shuffle(Object.keys(roles));
    for (let i = 0; i < Math.min(c.nbF, candidates.length); i++) {
      roles[candidates[i]].estForceur = true;
    }
  }

  // Couple
  if (c.optCouple && activePlayerIds.length >= 4) {
    const pair = shuffle(activePlayerIds).slice(0, 2);
    roles[pair[0]].coupleAvec = pair[1];
    roles[pair[1]].coupleAvec = pair[0];
  }

  // Ordre du tour aléatoire (parmi joueurs actifs)
  const turnOrder = shuffle(activePlayerIds);

  // Y a-t-il un Imitateur humain à activer ?
  const imitateurIds = Object.entries(roles)
    .filter(([pid, r]) => r.role === "IMITATEUR" && !data.players[pid].isBot)
    .map(([pid]) => pid);

  const gameState = {
    phase: imitateurIds.length > 0 ? "IMITATEUR" : "INDICES",
    numManche: 1,
    turnOrder: turnOrder,
    indexTour: 0,
    roles: roles,
    indices: {},
    historique: [],
    votes: {},
    motCivil: sw.civil,
    motUnder: sw.under,
    selectedTheme: data.selectedTheme || "?",
    dernierElimine: null,
    stats: { // pour titres honorifiques
      accusations: {}, // qui a voté contre qui (tous tours)
      elimsFlash: {}   // qui s'est fait éliminer au 1er tour
    }
  };

  // Si Imitateur, on note qui doit jouer (le 1er)
  if (imitateurIds.length > 0) {
    gameState.imitateurActif = imitateurIds[0];
  }

  await update(ref(db, `rooms/${code}`), {
    status: "jeu",
    gameState: gameState
  });

  // Les bots imitateurs choisissent tout de suite une cible aléatoire
  const botImitateurs = Object.entries(roles)
    .filter(([pid, r]) => r.role === "IMITATEUR" && data.players[pid].isBot)
    .map(([pid]) => pid);
  for (const botId of botImitateurs) {
    const cibles = Object.entries(roles)
      .filter(([pid, r]) => pid !== botId && r.role !== "IMITATEUR")
      .map(([pid]) => pid);
    if (cibles.length > 0) {
      const cibleId = cibles[Math.floor(Math.random() * cibles.length)];
      const cibleRole = roles[cibleId];
      // Le bot vole le rôle
      await update(ref(db, `rooms/${code}/gameState/roles/${botId}`), {
        role: cibleRole.role,
        mot: cibleRole.mot,
        camp: cibleRole.camp,
        imitatedFrom: cibleId
      });
    }
  }
  showToast("🎴 Rôles distribués !");
};

// ======================================================================
// HELPER : retourner le playerId du tour courant (saute les morts)
// ======================================================================
const getCurrentTurnPid = (gs) => {
  if (!gs) return null;

  // --- NOUVEAU : LA PRIORITÉ ABSOLUE AU FORCEUR ---
  // S'il y a une interruption Forceur en cours, le tour appartient FORCÉMENT à la cible.
  if (gs.forceurInterruption && gs.forceurInterruption.cible) {
    return gs.forceurInterruption.cible;
  }
  // -----------------------------------------------

  if (!gs.turnOrder) return null;
  const kicked = gs.kickedPlayers || {};
  const n = gs.turnOrder.length;
  for (let i = 0; i < n; i++) {
    const idx = (gs.indexTour + i) % n;
    const pid = gs.turnOrder[idx];
    // Skip joueurs morts ET kickés
    if (gs.roles[pid] && gs.roles[pid].enVie && !kicked[pid]) return pid;
  }
  return null;
};

// ======================================================================
// RENDER GAME SCREEN
// ======================================================================
let flipCardEtat = false; // reveal state

const renderGame = (data) => {
  const gs = data.gameState;
  if (!gs) return;
  $("#gameRoundLabel").innerText = `Manche ${gs.numManche || 1}`;
  $("#gamePhaseLabel").innerText = gs.phase === "INDICES" ? "Phase d'indices" : "Phase de vote";

  const mjId = data.mjId;
  const iAmMj = (mjId === myPlayerId);
  const myRoleObj = gs.roles?.[myPlayerId];

  // --- NOUVEAU : Récupération du thème (Gestion du mode Aléatoire) ---
  // On regarde s'il y a un thème sélectionné après le vote (selectedTheme), 
  // sinon on prend celui de la config de base.
  const themeActuel = data.selectedTheme || data.config?.theme || "Thème Mystère";
  
  // Si les joueurs ont voté "Aléatoire", on va chercher le VRAI thème tiré au sort par le jeu
  if (themeActuel.toLowerCase().includes("aléa") || themeActuel === "Random") {
    // Le jeu cherche gs.theme ou gs.categorie selon comment tu l'as appelé dans ta base de données
    themeActuel = gs.theme || selectedTheme || "Thème Surprise 🎲"; 
  }
  // ------------------------------------------------------------------
  
  // Le bloc HTML pour afficher le thème (identique pour le MJ et les joueurs)
  const themeHTML = `
    <div class="theme-reminder fade-up">
      <div class="theme-icon">✨</div>
      <div class="theme-content">
        <span class="theme-label">Thème de la manche</span>
        <span class="theme-value" id="current-theme-display">${escapeHTML(themeActuel)}</span>
      </div>
    </div>
  `;
  // ----------------------------------------------------

  // Carte secrète
  const secretZone = $("#gameSecretZone");
  if (iAmMj) {
    // MJ voit les deux mots + le thème en dessous
    secretZone.innerHTML = `
      <div class="glass p-4" style="text-align:center;">
        <div style="font-family:'Space Grotesk',sans-serif;font-weight:900;font-size:0.75rem;letter-spacing:0.2em;text-transform:uppercase;color:rgba(var(--gold-rgb),1);margin-bottom:0.5rem;">👑 Maître du Jeu</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;">
          <div class="glass-sm p-3"><div style="font-size:0.65rem;color:rgba(var(--primary-rgb),1);font-weight:800;">CIVIL</div><div style="font-family:'Space Grotesk',sans-serif;font-weight:900;font-size:1.1rem;color:#fff;">${escapeHTML(gs.motCivil)}</div></div>
          <div class="glass-sm p-3"><div style="font-size:0.65rem;color:rgba(var(--secondary-rgb),1);font-weight:800;">UNDER</div><div style="font-family:'Space Grotesk',sans-serif;font-weight:900;font-size:1.1rem;color:#fff;">${escapeHTML(gs.motUnder)}</div></div>
        </div>
      </div>
      ${themeHTML} `;
  } else if (myRoleObj) {
    const cfg = data.config || {};
    const showTheme = cfg.voirTheme !== false; // par défaut on affiche
    let roleAffiche = myRoleObj.role;
    if (!cfg.voirRoleUnder && (myRoleObj.role === "CIVIL" || myRoleObj.role === "UNDERCOVER")) {
      roleAffiche = "RÔLE CACHÉ 🕵️";
    }
    // On garde la structure flip-card (recréée seulement si pas présente)
    if (!document.getElementById("gameFlipCard")) {
      secretZone.innerHTML = `
        <div id="gameFlipCard" class="flip-card">
          <div class="flip-card-inner">
            <div class="flip-card-face flip-card-front"><div class="emoji">🤫</div><div class="label">Clique pour révéler</div></div>
            <div class="flip-card-face flip-card-back">
              <div class="role-label"></div>
              <div class="word-label"></div>
              <div class="word-hint">Ton secret</div>
              <div class="couple-label" style="margin-top: 10px; font-size: 0.8rem; color: #f472b6; font-weight: 800; text-align: center;"></div>
            </div>
          </div>
        </div>
        ${showTheme ? themeHTML : ""}
      `;
    } else {
      const themeAffichageExistant = document.getElementById("current-theme-display");
      // Si l'option a changé en cours de route, on synchronise
      const themeReminder = document.querySelector("#gameSecretZone .theme-reminder");
      if (showTheme) {
        if (themeAffichageExistant) themeAffichageExistant.innerText = themeActuel;
        if (themeReminder) themeReminder.style.display = "";
        else $("#gameSecretZone")?.insertAdjacentHTML("beforeend", themeHTML);
      } else if (themeReminder) {
        themeReminder.style.display = "none";
      }
    }
    
    const backRole = document.querySelector("#gameFlipCard .role-label");
    const backWord = document.querySelector("#gameFlipCard .word-label");
    
    // --- NOUVEAU : Méthode blindée pour le couple ---
    let backCouple = document.querySelector("#gameFlipCard .couple-label");
    
    // Si la carte existait déjà AVANT ta modification (vieux code en cache),
    // la div couple-label n'existe pas. On la crée de force !
    if (!backCouple) {
      const backFace = document.querySelector("#gameFlipCard .flip-card-back");
      if (backFace) {
        backCouple = document.createElement("div");
        backCouple.className = "couple-label";
        backCouple.style.cssText = "margin-top: 10px; font-size: 0.8rem; color: #f472b6; font-weight: 800; text-align: center;";
        backFace.appendChild(backCouple);
      }
    }
    
    if (backRole) backRole.innerText = roleAffiche;
    if (backWord) backWord.innerText = myRoleObj.mot;
    
    // Maintenant on est sûr à 100% que backCouple existe
    if (backCouple) {
      if (myRoleObj.coupleAvec) {
        const nomPartenaire = data.players?.[myRoleObj.coupleAvec]?.name || "Inconnu";
        backCouple.innerHTML = `💘 En couple avec <strong>${escapeHTML(nomPartenaire)}</strong>`;
      } else {
        backCouple.innerHTML = ""; // Pas en couple
      }
    }

    // Re-bind flip
    const fc = document.getElementById("gameFlipCard");
    if (fc && !fc.__flipBound) {
      fc.addEventListener("click", () => {
        flipCardEtat = !flipCardEtat;
        fc.classList.toggle("flipped", flipCardEtat);
      });
      fc.__flipBound = true;
      if (flipCardEtat) fc.classList.add("flipped");
    }
  }

  // Rôles restants (comptage)
  const counts = {};
  let totalCouples = 0;
  Object.values(gs.roles || {}).forEach(r => {
    if (r.enVie) {
      counts[r.roleInitial] = (counts[r.roleInitial] || 0) + 1;
      if (r.coupleAvec) totalCouples++;
    }
  });
  const parts = [];
  if (counts["CIVIL"]) parts.push(`😇 ${counts["CIVIL"]} Civil${counts["CIVIL"] > 1 ? "s" : ""}`);
  if (counts["UNDERCOVER"]) parts.push(`😈 ${counts["UNDERCOVER"]} Undercover`);
  if (counts["MR WHITE"]) parts.push(`👻 ${counts["MR WHITE"]} Mr White`);
  if (counts["IMITATEUR"]) parts.push(`🎭 ${counts["IMITATEUR"]} Imitateur${counts["IMITATEUR"] > 1 ? "s" : ""}`);
  if (counts["PARIA"]) parts.push(`🥺 ${counts["PARIA"]} Paria${counts["PARIA"] > 1 ? "s" : ""}`);
  if (totalCouples > 0) parts.push(`<span style="color:#f472b6;">💘 ${totalCouples/2} Couple${totalCouples/2 > 1 ? "s" : ""}</span>`);
  $("#rolesRemaining").innerHTML = `<strong style="color:rgba(var(--secondary-rgb),1);">🔍 En jeu :</strong><br>` + parts.join(" · ");

  // Elimination banner
  const banner = $("#eliminationBanner");
  if (gs.dernierElimine && gs.roles?.[gs.dernierElimine]) {
    const el = gs.roles[gs.dernierElimine];
    const elName = data.players?.[gs.dernierElimine]?.name || "?";
    banner.style.display = "";
    banner.innerHTML = `💀 <strong>${escapeHTML(elName)}</strong> éliminé·e (${el.roleInitial === "CIVIL" || el.roleInitial === "UNDERCOVER" ? el.roleInitial : el.roleInitial})`;
  } else {
    banner.style.display = "none";
  }

  // Turn indicator + indice input
  const turnIndic = $("#turnIndicator");
  const indiceZone = $("#indiceInputZone");
  const voteActions = $("#voteActions");

  if (gs.phase === "INDICES") {
    const currentPid = getCurrentTurnPid(gs);
    const currentName = data.players?.[currentPid]?.name || "?";
    const isMyTurn = (currentPid === myPlayerId) && !iAmMj && myRoleObj?.enVie;

    turnIndic.style.display = "";
    turnIndic.classList.toggle("my-turn", isMyTurn);
    // On écrit tout en HTML d'un coup (pas de innerText sur un enfant qu'on va écraser juste après)
    turnIndic.innerHTML = isMyTurn
      ? `🎯 <strong>C'EST À TOI !</strong> Donne ton indice.`
      : `À <strong>${escapeHTML(currentName)}</strong> de donner un indice...`;

    indiceZone.style.display = isMyTurn ? "" : "none";
    if (isMyTurn) setTimeout(() => $("#indiceInput")?.focus(), 100);
    voteActions.style.display = "none";
  }
  else if (gs.phase === "VOTE") {
    turnIndic.style.display = "";
    turnIndic.classList.remove("my-turn");
    turnIndic.innerHTML = `🗳️ <strong>Phase de vote</strong> — accuse un joueur !`;
    indiceZone.style.display = "none";
    voteActions.style.display = (!iAmMj && myRoleObj?.enVie) ? "flex" : "none";
  }

  // Liste joueurs
  renderGamePlayers(data);

  // Historique
  renderHistorique(data);

  // BOTS AUTO : si c'est au tour d'un bot OU en phase VOTE, on programme leurs actions automatiquement
  if (isHost) scheduleBotActions(data);
};
const allBotsHaveVoted = (data) => {
  const gs = data.gameState;
  if (!gs) return true;
  const botsVivants = Object.keys(data.players || {}).filter(pid =>
    data.players[pid].isBot && gs.roles[pid]?.enVie
  );
  return botsVivants.every(pid => gs.votes?.[pid]);
};

const renderGamePlayers = (data) => {
  const gs = data.gameState;
  const list = $("#gamePlayersList");
  list.innerHTML = "";

  const mjId = data.mjId;
  const iAmMj = (mjId === myPlayerId);
  const myRoleObj = gs.roles?.[myPlayerId];
  const jeSuisVivant = myRoleObj?.enVie && !iAmMj;

  // On liste tous les joueurs actifs (hors MJ) dans l'ordre du tour
  const order = gs.turnOrder || Object.keys(data.players || {}).filter(pid => pid !== mjId);
  order.forEach(pid => {
    const p = data.players?.[pid];
    if (!p) return;
    const r = gs.roles[pid];
    if (!r) return;

    const isCurrentTurn = (gs.phase === "INDICES" && getCurrentTurnPid(gs) === pid);
    const indice = gs.indices?.[pid] || "";
    const voteFromMe = gs.votes?.[myPlayerId];
    const votedForHim = (voteFromMe === pid);

    // Compte votes reçus (affiché seulement si non anonyme)
    let votesReceived = 0;
    for (const voterId in (gs.votes || {})) {
      if (gs.votes[voterId] === pid) votesReceived++;
    }

    const div = document.createElement("div");
    div.className = "player-pill";
    if (!r.enVie) div.classList.add("is-dead");
    if (isCurrentTurn) div.classList.add("is-turn");
    if (votedForHim) div.classList.add("voted-for");

    const coupleIcon = (myRoleObj?.coupleAvec === pid) ? "💘 " : "";
    const isMeTag = (pid === myPlayerId) ? '<span class="badge-me">Toi</span>' : '';
    const showVoteCount = gs.phase === "VOTE" && !data.config?.voteAno && r.enVie;

    div.innerHTML = `
      <div class="avatar" style="width:36px;height:36px;font-size:0.95rem;">${escapeHTML(avatarLetter(p.name))}</div>
      <div style="flex:1;min-width:0;">
        <div class="pill-name">${coupleIcon}${escapeHTML(p.name)} ${isMeTag} ${p.isBot ? '🤖' : ''} ${!r.enVie ? '💀' : ''}</div>
        ${indice ? `<div class="pill-indice">💬 ${formatIndiceDisplay(indice)}</div>` : ''}
      </div>
      ${showVoteCount && votesReceived > 0 ? `<span class="vote-card-count" style="margin-right:0.3rem;">${votesReceived}</span>` : ''}
      ${(gs.phase === "VOTE" && jeSuisVivant && r.enVie && pid !== myPlayerId) ? `
        <button class="btn-vote ${votedForHim ? 'active' : ''}" data-vote="${pid}">${votedForHim ? 'Voté ✓' : 'Accuser'}</button>
      ` : ''}
    `;
    list.appendChild(div);
  });

  // Bind vote buttons
  list.querySelectorAll("[data-vote]").forEach(b => {
    b.addEventListener("click", async (e) => {
      e.stopPropagation();
      const targetId = b.getAttribute("data-vote");
      const myCurrent = data.gameState?.votes?.[myPlayerId];
      const newVal = (myCurrent === targetId) ? null : targetId;
      await set(ref(db, `rooms/${currentRoomCode}/gameState/votes/${myPlayerId}`), newVal);
    });
  });

  // Vote blanc & clôture
  const myVote = data.gameState?.votes?.[myPlayerId];
  const blancActive = (myVote === "BLANC");
  const btnBlanc = $("#btnVoteBlanc");
  btnBlanc.innerHTML = blancActive ? "✓ Vote blanc" : "🏳️ Vote blanc";
  btnBlanc.classList.toggle("btn-primary", blancActive);
  btnBlanc.classList.toggle("btn-ghost", !blancActive);

  if (gs.phase === "VOTE") {
    // Compter vivants ACTIFS (excluant kicked et joueurs absents de players)
    const kicked = gs.kickedPlayers || {};
    const players = data.players || {};
    const vivants = Object.entries(gs.roles)
      .filter(([pid, r]) => r.enVie && !kicked[pid] && players[pid])
      .map(([pid]) => pid);
    const nbVotes = Object.keys(gs.votes || {}).filter(pid => vivants.includes(pid)).length;

    // Auto-clôture : si tous les vivants actifs ont voté ET on est host → clôture dans 3s
    if (isHost && nbVotes >= vivants.length && vivants.length > 0 && !window.__voteGameClosing) {
      window.__voteGameClosing = true;
      showToast("✓ Tous ont voté · Résolution dans 3s...");
      setTimeout(() => {
        clotureVoteGame().finally(() => { window.__voteGameClosing = false; });
      }, 3000);
    }
  }
};

const renderHistorique = (data) => {
  const gs = data.gameState;
  const list = $("#gameHistList");
  list.innerHTML = "";
  if (!gs.historique || gs.historique.length === 0) {
    list.innerHTML = '<p style="color:rgba(255,255,255,0.35);font-size:0.8rem;text-align:center;padding:0.5rem 0;">Aucune preuve pour le moment...</p>';
    return;
  }
  let curRound = 0;
  // Mr White qui devine peut tout voir (ou éliminé en général)
  const myRoleObj = gs.roles?.[myPlayerId];
  const iAmMrWhiteGuessing = gs.mrWhiteGuessing === myPlayerId;
  const iAmDead = myRoleObj && !myRoleObj.enVie;
  const bypassMask = iAmMrWhiteGuessing || iAmDead;

  gs.historique.forEach(h => {
    if (h.tour !== curRound) {
      const sep = document.createElement("div");
      sep.className = "hist-round-sep";
      sep.innerText = `Manche ${h.tour}`;
      list.appendChild(sep);
      curRound = h.tour;
    }
    const item = document.createElement("div");
    item.className = "hist-item";
    const nom = data.players?.[h.playerId]?.name || "?";
    // Mode aveugle : masque les indices du tour courant SAUF si Mr White devine ou si je suis mort
    const isBlindedMask = !bypassMask
      && data.config?.aveugle
      && gs.phase === "INDICES"
      && h.tour === gs.numManche;
    const indiceAffiche = isBlindedMask ? "<i>🌑 indice caché...</i>" : formatIndiceDisplay(h.indice);
    item.innerHTML = `<strong>${escapeHTML(nom)}</strong> : ${indiceAffiche}`;
    list.appendChild(item);
  });
};

// ======================================================================
// Toggle historique
// ======================================================================
$("#btnToggleHist").addEventListener("click", () => {
  if (currentRoomData) renderHistorique(currentRoomData);
  $("#historyModal").classList.add("active");
});
document.querySelectorAll(".btn-close-history").forEach(b =>
  b.addEventListener("click", () => $("#historyModal").classList.remove("active"))
);
$("#historyModal")?.addEventListener("click", (e) => {
  if (e.target.id === "historyModal") $("#historyModal").classList.remove("active");
});

// ======================================================================
// ENVOYER INDICE
// ======================================================================
// ======================================================================
// ENVOYER INDICE (humain)
// ======================================================================
$("#btnSendIndice").addEventListener("click", sendIndice);
$("#indiceInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendIndice();
});

async function sendIndice() {
  if (!currentRoomCode) return;
  // ALWAYS refetch pour être sûr de l'état
  const freshSnap = await get(ref(db, `rooms/${currentRoomCode}`));
  const data = freshSnap.val();
  if (!data) return;
  const gs = data.gameState;
  if (!gs) return;

  // Cas Forceur interruption : si je suis la cible, j'envoie mon 2e indice
  const isInterruption = gs.forceurInterruption && gs.forceurInterruption.cible === myPlayerId;

  // Sinon vérif normale : c'est mon tour + phase indices
  if (!isInterruption) {
    if (gs.phase !== "INDICES") return showToast("Ce n'est pas la phase indice");
    const currentPid = getCurrentTurnPid(gs);
    if (currentPid !== myPlayerId) return showToast("Ce n'est pas ton tour");
  }

  let ind = $("#indiceInput").value.trim();
  if (!ind) return showToast("⚠️ Écris un indice");
  if (ind.length > 60) ind = ind.slice(0, 60);

  // Mode emoji
  if (data.config?.emoji) {
    const emojiRegex = /^[\p{Emoji}\s]+$/u;
    if (!emojiRegex.test(ind.replace(/\s/g, ""))) {
      return showToast("⚠️ Mode emoji : lettres/chiffres interdits");
    }
  }

  // Anti-triche : indice ne doit pas contenir le mot
  const myRole = gs.roles?.[myPlayerId];
  if (myRole && myRole.mot !== "???" && myRole.mot) {
    const motParts = myRole.mot.includes(" / ") ? myRole.mot.split(" / ") : [myRole.mot];
    const indClean = ind.toUpperCase().replace(/[^A-Z]/g, "");
    for (const mp of motParts) {
      const motClean = mp.toUpperCase().replace(/[^A-Z]/g, "");
      if (motClean && indClean.includes(motClean)) {
        return showToast("🚫 Ton indice contient ton mot !");
      }
    }
  }

  // Anti-duplicata : indice déjà donné dans la partie
  // En mode aveugle, on ne vérifie QUE les manches précédentes (manche courante cachée)
  const isBlind = !!data.config?.aveugle;
  const indNorm = ind.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  const historique = gs.historique || [];
  for (const h of historique) {
    // En mode aveugle : on ignore les indices de la manche en cours
    if (isBlind && h.tour === gs.numManche) continue;
    const hClean = (h.indice || "")
      .toLowerCase()
      .replace(/\|\|\|FORCED\|\|\|/g, " ")
      .replace(/⚡|\(Forcé\)/g, "")
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .trim();
    if (hClean && hClean === indNorm) {
      return showToast("🔁 Cet indice a déjà été donné !");
    }
  }

  $("#indiceInput").value = "";
  const cleaned = escapeHTML(ind);
  const updates = {};
  const hist = (gs.historique || []).slice();

  if (isInterruption) {
    // Stockage avec SÉPARATEUR BRUT (formatage HTML fait au rendu via formatIndiceDisplay)
    const prevInd = gs.indices?.[myPlayerId] || "";
    const newInd = prevInd ? `${prevInd}|||FORCED|||${cleaned}` : `|||FORCED|||${cleaned}`;
    updates[`gameState/indices/${myPlayerId}`] = newInd;
    hist.push({ tour: gs.numManche, playerId: myPlayerId, indice: `⚡ ${cleaned} (Forcé)` });
    updates[`gameState/historique`] = hist;
    updates[`gameState/forceurInterruption`] = null;
    await update(ref(db, `rooms/${currentRoomCode}`), updates);
    return;
  }

  // Indice normal
  updates[`gameState/indices/${myPlayerId}`] = cleaned;
  hist.push({ tour: gs.numManche, playerId: myPlayerId, indice: cleaned });
  updates[`gameState/historique`] = hist;
  await update(ref(db, `rooms/${currentRoomCode}`), updates);

  // Avancer le tour
  await advanceTurnSafe();
}

// ======================================================================
// AVANCER LE TOUR (lit FROM FIREBASE, pas du cache local)
// ======================================================================
async function advanceTurnSafe() {
  if (!currentRoomCode) return;
  const snap = await get(ref(db, `rooms/${currentRoomCode}/gameState`));
  const fresh = snap.val();
  if (!fresh) return;
  const kicked = fresh.kickedPlayers || {};

  // Vivants actifs (non kickés)
  const vivants = fresh.turnOrder.filter(pid => fresh.roles[pid]?.enVie && !kicked[pid]);
  const indicesDonnees = vivants.filter(pid => fresh.indices?.[pid]);

  if (indicesDonnees.length >= vivants.length) {
    // Tous les vivants actifs ont donné leur indice → phase vote
    await update(ref(db, `rooms/${currentRoomCode}/gameState`), {
      phase: "VOTE",
      votes: {}
    });
    return;
  }

  // Sinon on avance au prochain joueur vivant non-kické qui n'a pas encore joué
  const n = fresh.turnOrder.length;
  let newIdx = (fresh.indexTour + 1) % n;
  let tries = 0;
  while (tries < n) {
    const pid = fresh.turnOrder[newIdx];
    if (fresh.roles[pid]?.enVie && !kicked[pid] && !fresh.indices?.[pid]) break;
    newIdx = (newIdx + 1) % n;
    tries++;
  }
  await set(ref(db, `rooms/${currentRoomCode}/gameState/indexTour`), newIdx);
}

// ======================================================================
// VOTE BLANC
// ======================================================================
$("#btnVoteBlanc").addEventListener("click", async () => {
  if (!currentRoomCode || !currentRoomData) return;
  const gs = currentRoomData.gameState;
  if (!gs || gs.phase !== "VOTE") return;
  if (currentRoomData.mjId === myPlayerId) return;
  const myRole = gs.roles?.[myPlayerId];
  if (!myRole?.enVie) return;
  const current = gs.votes?.[myPlayerId];
  const newVal = (current === "BLANC") ? null : "BLANC";
  await set(ref(db, `rooms/${currentRoomCode}/gameState/votes/${myPlayerId}`), newVal);
});

// ======================================================================
// CLÔTURER LE VOTE (appelé automatiquement après 3s)
// ======================================================================
async function clotureVoteGame() {
  if (!currentRoomCode) return;
  // Refetch frais pour éviter race conditions
  const freshSnap = await get(ref(db, `rooms/${currentRoomCode}`));
  const data = freshSnap.val();
  if (!data) return;
  const gs = data.gameState;
  if (!gs || gs.phase !== "VOTE") return;
  if (!isHost && data.mjId !== myPlayerId) return;

  const votes = gs.votes || {};
  const counts = {};
  for (const voterId in votes) {
    const t = votes[voterId];
    if (!t) continue;
    counts[t] = (counts[t] || 0) + 1;
  }

  let max = 0;
  for (const t in counts) if (t !== "BLANC" && counts[t] > max) max = counts[t];
  const tied = Object.keys(counts).filter(t => t !== "BLANC" && counts[t] === max);
  const blancCount = counts["BLANC"] || 0;
  const totalNonBlanc = Object.values(counts).reduce((a,b)=>a+b,0) - blancCount;

  if (totalNonBlanc === 0 || blancCount > max) {
    await applyElimination(null, "VOTE_BLANC");
    return;
  }
  if (tied.length === 1) {
    await applyElimination(tied[0], "VOTE");
    return;
  }
  const regle = data.config?.regleEgalite || "duel";
  if (regle === "hasard") {
    await applyElimination(tied[Math.floor(Math.random() * tied.length)], "VOTE_HASARD");
  } else if (regle === "rien") {
    await applyElimination(null, "EGALITE_RIEN");
  } else if (regle === "duel" && tied.length === 2) {
    await update(ref(db, `rooms/${currentRoomCode}/gameState`), {
      phase: "DUEL",
      duel: { fighters: tied, choices: {}, resolved: false }
    });
    showToast("⚔️ Duel PFC !");
  } else {
    await applyElimination(tied[Math.floor(Math.random() * tied.length)], "VOTE_HASARD");
  }
}

// ======================================================================
// APPLIQUER ÉLIMINATION
// ======================================================================
async function applyElimination(targetId, raison) {
  if (!currentRoomCode) return;
  const snap = await get(ref(db, `rooms/${currentRoomCode}/gameState`));
  const gs = snap.val();
  if (!gs) return;

  const updates = {};

  // Enregistrer les accusations pour les titres honorifiques
  if (gs.votes) {
    const accSnap = gs.stats?.accusations || {};
    
    for (const voterId in gs.votes) {
      const cible = gs.votes[voterId];
      if (!cible || cible === "BLANC") continue;
      
      // C'est la CIBLE qui reçoit l'accusation, pas le votant !
      accSnap[cible] = (accSnap[cible] || 0) + 1;
    }
    
    updates[`gameState/stats/accusations`] = accSnap;
  }

  if (targetId) {
    gs.roles[targetId].enVie = false;
    updates[`gameState/roles/${targetId}/enVie`] = false;
    updates[`gameState/dernierElimine`] = targetId;

    // PARIA : s'il est éliminé au tour 1, victoire solo
    // (on utilise `role` pour que l'Imitateur qui a copié un Paria
    // déclenche aussi la victoire — cohérent avec le mode solo)
    if (gs.roles[targetId].role === "PARIA" && gs.numManche === 1) {
      await update(ref(db, `rooms/${currentRoomCode}`), updates);
      await finalizePartie({ ...gs, roles: gs.roles }, {
        camp: "PARIA",
        raison: "🥺 Le Paria a réussi son exploit : éliminé au 1er tour, il vole la victoire !",
        heroId: targetId
      }, currentRoomData);
      return;
    }

    // Amoureux : l'autre meurt
    const amant = gs.roles[targetId].coupleAvec;
    if (amant && gs.roles[amant]?.enVie) {
      gs.roles[amant].enVie = false;
      updates[`gameState/roles/${amant}/enVie`] = false;
      showToast("💔 Le/la partenaire meurt de chagrin");
    }

    // Mr White → Guess
    if (gs.roles[targetId].role === "MR WHITE") {
      updates[`gameState/mrWhiteGuessing`] = targetId;
      updates[`gameState/phase`] = "MR_WHITE_GUESS";
      await update(ref(db, `rooms/${currentRoomCode}`), updates);
      return;
    }
  }

  // Check victoire
  const victoire = checkVictoire(gs, currentRoomData);
  if (victoire) {
    if (victoire.trigger === "MR_WHITE_ENDGAME") {
      // Endgame : Mr White est encore vivant et seul face à un Civil. On le force à deviner.
      updates[`gameState/mrWhiteGuessing`] = victoire.mrWhiteId;
      updates[`gameState/mrWhiteEndgame`] = true;
      updates[`gameState/phase`] = "MR_WHITE_GUESS";
      await update(ref(db, `rooms/${currentRoomCode}`), updates);
      return;
    }
    await update(ref(db, `rooms/${currentRoomCode}`), updates);
    await finalizePartie(gs, victoire, currentRoomData);
    return;
  }

  // Manche suivante
  updates[`gameState/numManche`] = (gs.numManche || 1) + 1;
  updates[`gameState/phase`] = "INDICES";
  updates[`gameState/indices`] = {};
  updates[`gameState/votes`] = {};
  updates[`gameState/forceurInterruption`] = null;
  let startIdx = 0;
  for (let i = 0; i < gs.turnOrder.length; i++) {
    if (gs.roles[gs.turnOrder[i]]?.enVie) { startIdx = i; break; }
  }
  updates[`gameState/indexTour`] = startIdx;

  await update(ref(db, `rooms/${currentRoomCode}`), updates);
}

// ======================================================================
// CHECK VICTOIRE
// ======================================================================
function checkVictoire(gs, roomData) {
  const vivants = Object.entries(gs.roles).filter(([pid, r]) => r.enVie);
  const civilsVivants = vivants.filter(([_, r]) => r.camp === "CIVIL");
  const imposteursVivants = vivants.filter(([_, r]) => r.camp === "UNDERCOVER");

  // Amoureux : si seuls couples vivants
  if (vivants.length === 2) {
    const [a, b] = vivants;
    if (a[1].coupleAvec === b[0] && b[1].coupleAvec === a[0]) {
      return { camp: "AMOUREUX", raison: "💘 Les amoureux sont les seuls survivants !" };
    }
  }

  // Civils gagnent si plus aucun imposteur
  if (imposteursVivants.length === 0 && civilsVivants.length > 0) {
    return { camp: "CIVILS", raison: "Tous les imposteurs ont été démasqués !" };
  }

  // NOUVEAU — endgame Mr White (exactement 2 vivants, un Mr White)
  if (vivants.length === 2) {
    const mrW = vivants.find(([_, r]) => r.role === "MR WHITE");
    if (mrW) {
      const [mrWPid] = mrW;
      const [otherPid, otherR] = vivants.find(([pid, _]) => pid !== mrWPid);
      // Mr White + camp civil → on déclenche la proposition de mot
      if (otherR.camp === "CIVIL") {
        return { trigger: "MR_WHITE_ENDGAME", mrWhiteId: mrWPid };
      }
      // Mr White + autre imposteur (qui n'est pas un Mr White) → l'autre gagne seul
      if (otherR.camp === "UNDERCOVER" && otherR.role !== "MR WHITE") {
        return {
          camp: "IMPOSTEUR_SOLO",
          heroId: otherPid,
          raison: `Resté seul face au Mr White, ${roomData.players?.[otherPid]?.name || "l'imposteur"} remporte la victoire !`
        };
      }
    }
  }

  // Imposteurs gagnent si égalité numérique (ou majorité)
  if (imposteursVivants.length >= civilsVivants.length && imposteursVivants.length > 0) {
    return { camp: "UNDERCOVER", raison: "Les imposteurs sont en égalité — ils l'emportent !" };
  }

  return null;
}

// ======================================================================
// FINALISER PARTIE
// ======================================================================
async function finalizePartie(gs, victoire, roomData) {
  if (!currentRoomCode) return;
  // Attribution des scores (uniquement si host, pour éviter les doublons)
  let scoresResult = { session: {}, global: {}, diff: {} };
  if (isHost) {
    scoresResult = await attribuerScores(gs, victoire, roomData);
  } else {
    // Les non-hosts fetch les scores finaux après que le host les ait écrits
    const [sessSnap, globSnap] = await Promise.all([
      get(ref(db, `rooms/${currentRoomCode}/scores_session`)),
      get(ref(db, `scores_general`))
    ]);
    scoresResult.session = sessSnap.val() || {};
    scoresResult.global = globSnap.val() || {};
  }
  // Titres honorifiques
  const titres = calculerTitres(gs, roomData);

  await update(ref(db, `rooms/${currentRoomCode}`), {
    status: "resultats",
    resultats: {
      camp: victoire.camp,
      raison: victoire.raison,
      heroId: victoire.heroId || null,
      motCivil: gs.motCivil,
      motUnder: gs.motUnder,
      roles: gs.roles,
      players: roomData.players,
      scoresSnapshot: { session: scoresResult.session, global: scoresResult.global },
      scoresDiff: scoresResult.diff,
      titres: titres
    }
  });
}

// ======================================================================
// MR WHITE GUESS
// ======================================================================
const renderMrWhiteGuess = (data) => {
  const gs = data.gameState;
  const guesserId = gs.mrWhiteGuessing;
  const iAmGuesser = (guesserId === myPlayerId);
  const isEndgame = gs.mrWhiteEndgame === true;

  $("#mrWhiteGuesserZone").style.display = iAmGuesser ? "" : "none";
  $("#mrWhiteSpectatorZone").style.display = iAmGuesser ? "none" : "";

  // Adapter le texte d'intro selon le contexte
  const textEl = $("#mrWhiteText");
  if (textEl) {
    if (isEndgame) {
      textEl.innerHTML = `🎯 <strong style="color:#a855f7;">Endgame !</strong> Il ne reste plus que Mr White et un Civil.<br>Mr White doit deviner le mot pour voler la victoire.`;
    } else {
      textEl.innerHTML = `<strong style="color:#a855f7;">Mr White</strong> a été démasqué !<br>Mais il a une dernière chance : deviner le mot des Civils pour voler la victoire.`;
    }
  }

  if (gs.mrWhiteGuessAttempt) {
    $("#mrWhiteGuessDisplay").innerText = gs.mrWhiteGuessAttempt;
  } else {
    $("#mrWhiteGuessDisplay").innerText = "...";
  }

  // Si le guesser est un bot, on lance son action auto
  if (isHost) scheduleBotActions(data);
};

$("#btnMrWhiteGuess").addEventListener("click", async () => {
  if (!currentRoomCode || !currentRoomData) return;
  const gs = currentRoomData.gameState;
  if (gs.mrWhiteGuessing !== myPlayerId) return;
  const guess = sanitizeName($("#mrWhiteGuessInput").value).toUpperCase();
  if (!guess) return showToast("⚠️ Tape un mot");

  // On affiche le guess aux autres
  await set(ref(db, `rooms/${currentRoomCode}/gameState/mrWhiteGuessAttempt`), guess);

  // Suspense 2.5s
  setTimeout(async () => {
    const target = (gs.motCivil || "").toUpperCase();
    const win = tolerantMatch(guess, target);
    const snap = await get(ref(db, `rooms/${currentRoomCode}/gameState`));
    const freshGs = snap.val();
    const isEndgame = freshGs.mrWhiteEndgame === true;
    if (win) {
      // Mr White vole la victoire
      await finalizePartie(freshGs, {
        camp: "MR_WHITE",
        raison: `👻 Mr White a deviné le mot "${freshGs.motCivil}" et vole la victoire !`
      }, currentRoomData);
    } else if (isEndgame) {
      // Endgame raté : Mr White meurt, les Civils gagnent
      const mrWId = freshGs.mrWhiteGuessing;
      await update(ref(db, `rooms/${currentRoomCode}`), {
        [`gameState/roles/${mrWId}/enVie`]: false,
        'gameState/mrWhiteGuessing': null,
        'gameState/mrWhiteEndgame': null
      });
      const finalSnap = await get(ref(db, `rooms/${currentRoomCode}/gameState`));
      await finalizePartie(finalSnap.val(), {
        camp: "CIVILS",
        raison: `Mr White a proposé "${guess}" mais le mot était "${freshGs.motCivil}". Les Civils l'emportent !`
      }, currentRoomData);
    } else {
      // Échec : continue la partie normale
      const victoire = checkVictoire(freshGs, currentRoomData);
      if (victoire) {
        if (victoire.trigger === "MR_WHITE_ENDGAME") {
          // Un autre Mr White (rare) doit deviner à son tour
          await update(ref(db, `rooms/${currentRoomCode}`), {
            'gameState/mrWhiteGuessing': victoire.mrWhiteId,
            'gameState/mrWhiteEndgame': true,
            'gameState/mrWhiteGuessAttempt': null,
            'gameState/phase': "MR_WHITE_GUESS"
          });
        } else {
          await finalizePartie(freshGs, victoire, currentRoomData);
        }
      } else {
        // Manche suivante
        const updates = {
          'gameState/numManche':  (freshGs.numManche || 1) + 1,
          'gameState/phase':      "INDICES",
          'gameState/indices':    {},
          'gameState/votes':      {},
          'gameState/mrWhiteGuessing':    null,
          'gameState/mrWhiteGuessAttempt': null
        };
        let startIdx = 0;
        for (let i = 0; i < freshGs.turnOrder.length; i++) {
          if (freshGs.roles[freshGs.turnOrder[i]]?.enVie) { startIdx = i; break; }
        }
        updates['gameState/indexTour'] = startIdx;
        await update(ref(db, `rooms/${currentRoomCode}`), updates);
        showToast("❌ Raté ! La partie continue.");
      }
    }
  }, 2500);
});

// Distance de Levenshtein (tolérance fautes)
function tolerantMatch(a, b) {
  const clean = (s) => (s || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
  const x = clean(a), y = clean(b);
  if (x === y) return true;
  if (!x || !y) return false;
  const m = []; for (let i=0;i<=y.length;i++) m[i]=[i];
  for (let j=0;j<=x.length;j++) m[0][j]=j;
  for (let i=1;i<=y.length;i++) for (let j=1;j<=x.length;j++) {
    m[i][j] = y[i-1] === x[j-1] ? m[i-1][j-1] : Math.min(m[i-1][j-1], m[i][j-1], m[i-1][j]) + 1;
  }
  const d = m[y.length][x.length];
  return d <= (y.length <= 5 ? 1 : 2);
}

// ======================================================================
// BOTS : jouent automatiquement (scheduleBotActions)
// ======================================================================
let botActionTimer = null;

const scheduleBotActions = (data) => {
  if (!isHost) return;
  if (botActionTimer) {
    clearTimeout(botActionTimer);
    botActionTimer = null;
  }
  const gs = data.gameState;
  if (!gs) return;

  // Mr White bot à deviner
  if (gs.phase === "MR_WHITE_GUESS" && gs.mrWhiteGuessing && !gs.mrWhiteGuessAttempt) {
    if (data.players?.[gs.mrWhiteGuessing]?.isBot) {
      botActionTimer = setTimeout(() => executeBotAction(), 1800 + Math.random() * 1200);
      return;
    }
  }
  // Forceur → bot doit donner un 2e indice
  if (gs.phase === "INDICES" && gs.forceurInterruption) {
    const cible = gs.forceurInterruption.cible;
    if (data.players?.[cible]?.isBot) {
      botActionTimer = setTimeout(() => executeBotAction(), 1400 + Math.random() * 800);
      return;
    }
  }
  // Tour d'un bot en phase indices
  if (gs.phase === "INDICES") {
    const cp = getCurrentTurnPid(gs);
    if (cp && data.players?.[cp]?.isBot) {
      botActionTimer = setTimeout(() => executeBotAction(), 1500 + Math.random() * 1200);
      return;
    }
  }
  // Phase de vote : bots votent si pas encore fait
  if (gs.phase === "VOTE") {
    const botsVivants = Object.keys(data.players || {})
      .filter(pid => data.players[pid].isBot && gs.roles[pid]?.enVie && !gs.votes?.[pid]);
    if (botsVivants.length > 0) {
      botActionTimer = setTimeout(() => executeBotAction(), 1800 + Math.random() * 1200);
      return;
    }
  }
};

const executeBotAction = async () => {
  if (!currentRoomCode || !currentRoomData) return;
  if (!isHost) return;
  
  // --- SÉCURITÉ : On tue le chrono pour éviter les actions fantômes ---
  if (botActionTimer) {
    clearTimeout(botActionTimer);
    botActionTimer = null;
  }
  // ------------------------------------------------------------------

  const freshSnap = await get(ref(db, `rooms/${currentRoomCode}`));
  const data = freshSnap.val();
  if (!data) return;
  const gs = data.gameState;
  if (!gs) return;

  // Mr White bot devine
  if (gs.phase === "MR_WHITE_GUESS" && gs.mrWhiteGuessing && !gs.mrWhiteGuessAttempt) {
    const botId = gs.mrWhiteGuessing;
    if (!data.players?.[botId]?.isBot) return;
    // Le bot prend l'indice le plus récent d'un civil vivant comme guess
    const indices = gs.indices || {};
    const candidats = Object.keys(indices).filter(pid => pid !== botId);
    let guess = "INCONNU";
    if (candidats.length > 0) {
      const randPid = candidats[Math.floor(Math.random() * candidats.length)];
      const ind = (indices[randPid] || "").replace(/<[^>]*>/g, "").trim();
      guess = ind.split(/\s+/)[0] || "INCONNU";
    }
    await set(ref(db, `rooms/${currentRoomCode}/gameState/mrWhiteGuessAttempt`), guess.toUpperCase());
    setTimeout(async () => {
      const snap = await get(ref(db, `rooms/${currentRoomCode}/gameState`));
      const freshGs = snap.val();
      if (!freshGs) return;
      const win = tolerantMatch(guess, freshGs.motCivil);
      const isEndgame = freshGs.mrWhiteEndgame === true;
      if (win) {
        await finalizePartie(freshGs, { camp: "MR_WHITE", raison: `👻 Mr White (bot) a deviné "${freshGs.motCivil}" et vole la victoire !` }, data);
      } else if (isEndgame) {
        // Endgame raté : Mr White bot meurt, les Civils gagnent
        const mrWId = freshGs.mrWhiteGuessing;
        await update(ref(db, `rooms/${currentRoomCode}`), {
          [`gameState/roles/${mrWId}/enVie`]: false,
          'gameState/mrWhiteGuessing': null,
          'gameState/mrWhiteEndgame': null
        });
        const finalSnap = await get(ref(db, `rooms/${currentRoomCode}/gameState`));
        await finalizePartie(finalSnap.val(), {
          camp: "CIVILS",
          raison: `Mr White (bot) a proposé "${guess.toUpperCase()}" mais le mot était "${freshGs.motCivil}". Les Civils l'emportent !`
        }, data);
      } else {
        const victoire = checkVictoire(freshGs, data);
        if (victoire) {
          if (victoire.trigger === "MR_WHITE_ENDGAME") {
            await update(ref(db, `rooms/${currentRoomCode}`), {
              'gameState/mrWhiteGuessing': victoire.mrWhiteId,
              'gameState/mrWhiteEndgame': true,
              'gameState/mrWhiteGuessAttempt': null,
              'gameState/phase': "MR_WHITE_GUESS"
            });
          } else {
            await finalizePartie(freshGs, victoire, data);
          }
        } else {
          const upd = {
            'gameState/numManche': (freshGs.numManche || 1) + 1,
            'gameState/phase': "INDICES",
            'gameState/indices': {},
            'gameState/votes': {},
            'gameState/mrWhiteGuessing': null,
            'gameState/mrWhiteGuessAttempt': null,
            'gameState/forceurInterruption': null
          };
          let sIdx = 0;
          for (let i = 0; i < freshGs.turnOrder.length; i++) {
            if (freshGs.roles[freshGs.turnOrder[i]]?.enVie) { sIdx = i; break; }
          }
          upd['gameState/indexTour'] = sIdx;
          await update(ref(db, `rooms/${currentRoomCode}`), upd);
        }
      }
    }, 1800);
    return;
  }

  // Forceur : bot donne un 2e indice (Parce qu'un autre a forcé ce bot)
  if (gs.phase === "INDICES" && gs.forceurInterruption) {
    const cible = gs.forceurInterruption.cible;
    if (!data.players?.[cible]?.isBot) return;
    const r = gs.roles[cible];
    const previous = (gs.historique || []).filter(h => h.playerId === cible && h.tour === gs.numManche).map(h => h.indice);
    const isBlind = !!data.config?.aveugle;
    const previousGlobal = (gs.historique || []).filter(h => !(isBlind && h.tour === gs.numManche)).map(h => h.indice);
    const indice = botIndiceFor(r.role, r.mot, previous, previousGlobal);
    const prevInd = gs.indices?.[cible] || "";
    const newInd = prevInd ? `${prevInd}|||FORCED|||${indice}` : `|||FORCED|||${indice}`;
    
    const updates = {};
    updates[`gameState/indices/${cible}`] = newInd;
    const hist = (gs.historique || []).slice();
    hist.push({ tour: gs.numManche, playerId: cible, indice: `⚡ ${indice} (Forcé)` });
    updates[`gameState/historique`] = hist;
    updates[`gameState/forceurInterruption`] = null; // On libère l'interruption
    await update(ref(db, `rooms/${currentRoomCode}`), updates);
    return;
  }

  // Tour d'indices (bot normal)
  if (gs.phase === "INDICES") {
    const cp = getCurrentTurnPid(gs);
    if (!cp || !data.players?.[cp]?.isBot) return;
    const r = gs.roles[cp];
    
    // --- NOUVEAU : Logique du Bot Forceur ---
    // Avant de jouer son indice, on regarde s'il veut activer son pouvoir
    if (r.estForceur && !r.pouvoirUtilise && gs.numManche >= 2 && Math.random() < 0.3) {
      const cibles = Object.entries(gs.roles).filter(([pid, rr]) => rr.enVie && pid !== cp);
      if (cibles.length > 0) {
        const [cibleId] = cibles[Math.floor(Math.random() * cibles.length)];
        
        // On lui marque son pouvoir comme utilisé, et on lance l'interruption
        await update(ref(db, `rooms/${currentRoomCode}`), {
          'gameState/forceurInterruption': { cible: cibleId, demandeur: cp },
          [`gameState/roles/${cp}/pouvoirUtilise`]: true
        });
        // ATTENTION : On NE FAIT PLUS de "return;" ici ! 
        // On laisse Firebase s'occuper de l'interruption (ce qui bloquera le jeu sur la cible),
        // mais l'horloge du bot s'arrête net. Il rejouera son vrai tour plus tard.
        return; 
      }
    }
    // ----------------------------------------

    const previous = (gs.historique || []).filter(h => h.playerId === cp).map(h => h.indice);
    const isBlind = !!data.config?.aveugle;
    const previousGlobal = (gs.historique || []).filter(h => !(isBlind && h.tour === gs.numManche)).map(h => h.indice);
    const indice = botIndiceFor(r.role, r.mot, previous, previousGlobal);

    const updates = {};
    updates[`gameState/indices/${cp}`] = indice;
    const hist = (gs.historique || []).slice();
    hist.push({ tour: gs.numManche, playerId: cp, indice: indice });
    updates[`gameState/historique`] = hist;
    await update(ref(db, `rooms/${currentRoomCode}`), updates);
    
    await advanceTurnSafe();
  }

  // Vote phase : bots votent
  else if (gs.phase === "VOTE") {
    const botsVivants = Object.keys(data.players)
      .filter(pid => data.players[pid].isBot && gs.roles[pid]?.enVie && !gs.votes?.[pid]);
    const updates = {};
    botsVivants.forEach(botId => {
      const t = botVoteFor(botId, gs, data);
      if (t) updates[`gameState/votes/${botId}`] = t;
    });
    if (Object.keys(updates).length) await update(ref(db, `rooms/${currentRoomCode}`), updates);
  }
};

// ======================================================================
// RENDER RÉSULTATS
// ======================================================================
const renderResults = (data) => {
  const r = data.resultats;
  if (!r) return;

  const titleEl = $("#resultsTitle");
  const emojiEl = $("#resultsEmoji");
  titleEl.className = "results-title";

  let title = "Fin de partie";
  let emoji = "🏁";
  if (r.camp === "CIVILS") { title = "Victoire des Civils !"; emoji = "😇"; titleEl.classList.add("civils"); }
  else if (r.camp === "UNDERCOVER") { title = "Victoire des Imposteurs !"; emoji = "😈"; titleEl.classList.add("impost"); }
  else if (r.camp === "MR_WHITE") { title = "Mr White vole la victoire !"; emoji = "👻"; titleEl.classList.add("mrwhite"); }
  else if (r.camp === "AMOUREUX") { title = "Les Amoureux l'emportent !"; emoji = "💘"; }
  else if (r.camp === "PARIA") { title = "Le Paria triomphe !"; emoji = "🥺"; }
  else if (r.camp === "IMPOSTEUR_SOLO") {
    const heroName = r.players?.[r.heroId]?.name || "L'imposteur";
    title = `${heroName} gagne seul !`; emoji = "🎯"; titleEl.classList.add("impost");
  }

  titleEl.innerText = title;
  emojiEl.innerText = emoji;
  $("#resultsReason").innerText = r.raison || "";
  $("#resultsWordCivil").innerText = r.motCivil || "?";
  $("#resultsWordUnder").innerText = r.motUnder || "?";

  // Rôles révélés
  const listEl = $("#resultsRolesList");
  listEl.innerHTML = "";
  for (const pid in (r.roles || {})) {
    const role = r.roles[pid];
    const nom = r.players?.[pid]?.name || "?";
    let color = role.camp === "CIVIL" ? "var(--primary-rgb)" : "var(--secondary-rgb)";
    const EMOJI_BY_ROLE = { "CIVIL": "😇", "UNDERCOVER": "😈", "MR WHITE": "👻", "IMITATEUR": "🎭", "PARIA": "🥺" };
    let emoji2 = EMOJI_BY_ROLE[role.roleInitial] || "❓";
    // Si Imitateur a copié un rôle, on montre la transformation : 🎭 IMITATEUR → 🥺 PARIA
    let roleDisplay = role.roleInitial;
    if (role.roleInitial === "IMITATEUR" && role.role && role.role !== "IMITATEUR") {
      const newEmoji = EMOJI_BY_ROLE[role.role] || "";
      roleDisplay = `IMITATEUR → ${newEmoji} ${role.role}`;
    }
    const couple = role.coupleAvec ? " 💘" : "";
    const force = role.estForceur ? " ⚡" : "";
    const item = document.createElement("div");
    item.className = "results-role-item";
    item.innerHTML = `
      <div><strong style="color:#fff;">${escapeHTML(nom)}</strong>${couple}${force} ${role.enVie ? '' : ' <span style="color:rgba(255,255,255,0.3);">💀</span>'}</div>
      <div style="color:rgba(${color},1);font-family:'Space Grotesk',sans-serif;font-weight:800;font-size:0.85rem;">${emoji2} ${roleDisplay}</div>
    `;
    listEl.appendChild(item);
  }

  // (Scoreboard retiré des résultats pour gagner de la place sur mobile)

  // Titres honorifiques — avec descriptions
  const titresZone = $("#titlesZone");
  const titresList = $("#titlesList");
  if (r.titres && r.titres.length > 0) {
    titresZone.style.display = "";
    titresList.innerHTML = "";
    r.titres.forEach(t => {
      const card = document.createElement("div");
      card.className = "title-card";
      card.innerHTML = `
        <div class="title-icon">${t.icon}</div>
        <div class="title-content">
          <div class="title-header">
            <span class="title-label">${escapeHTML(t.label)}</span>
            <span class="title-winner">${escapeHTML(t.winner)}</span>
          </div>
          ${t.desc ? `<div class="title-desc">${escapeHTML(t.desc)}</div>` : ''}
        </div>
      `;
      titresList.appendChild(card);
    });
  } else {
    titresZone.style.display = "none";
  }
};

$("#btnBackToLobby").addEventListener("click", async () => {
  if (!currentRoomCode) return;
  if (!isHost) return showToast("Seul le chef peut relancer");
  // Reset : on nettoie gameState, resultats, votes, propositions, etc.
  const updates = {
    status: "lobby",
    gameState: null,
    resultats: null,
    votes_themes: null,
    propositions: null,
    votes_mots: null,
    selectedTheme: null,
    selectedWords: null,
    mjId: null
  };
  await update(ref(db, `rooms/${currentRoomCode}`), updates);
});


// ======================================================================
// ÉCRAN IMITATEUR — Choisir une cible
// ======================================================================
const renderImitator = (data) => {
  const gs = data.gameState;
  if (!gs || gs.imitateurActif !== myPlayerId) return;

  const list = $("#imitatorTargets");
  list.innerHTML = "";
  const targets = Object.entries(gs.roles)
    .filter(([pid, r]) => pid !== myPlayerId && r.role !== "IMITATEUR");

  targets.forEach(([pid, r]) => {
    const nom = data.players?.[pid]?.name || "?";
    const btn = document.createElement("button");
    btn.className = "btn btn-ghost w-full";
    btn.style.justifyContent = "flex-start";
    btn.innerHTML = `<span class="avatar" style="width:32px;height:32px;font-size:0.85rem;">${escapeHTML(avatarLetter(nom))}</span> <span style="margin-left:0.5rem;">${escapeHTML(nom)}</span>`;
    btn.addEventListener("click", async () => {
      const updates = {};
      updates[`gameState/roles/${myPlayerId}/role`] = r.role;
      updates[`gameState/roles/${myPlayerId}/mot`] = r.mot;
      updates[`gameState/roles/${myPlayerId}/camp`] = r.camp;
      updates[`gameState/roles/${myPlayerId}/imitatedFrom`] = pid;

      // Y a-t-il un autre Imitateur humain à activer ensuite ?
      const remaining = Object.entries(gs.roles)
        .filter(([opid, or]) => opid !== myPlayerId && or.role === "IMITATEUR" && !data.players?.[opid]?.isBot)
        .map(([opid]) => opid);
      if (remaining.length > 0) {
        updates[`gameState/imitateurActif`] = remaining[0];
        updates[`gameState/phase`] = "IMITATEUR";
      } else {
        updates[`gameState/imitateurActif`] = null;
        updates[`gameState/phase`] = "INDICES";
      }
      await update(ref(db, `rooms/${currentRoomCode}`), updates);
      showToast(`🎭 Tu imites ${nom} !`);
    });
    list.appendChild(btn);
  });
};

$("#btnSkipImitator").addEventListener("click", async () => {
  if (!currentRoomCode || !currentRoomData) return;
  const gs = currentRoomData.gameState;
  if (!gs || gs.imitateurActif !== myPlayerId) return;
  const updates = {};
  updates[`gameState/roles/${myPlayerId}/role`] = "MR WHITE";
  updates[`gameState/roles/${myPlayerId}/mot`] = "???";
  updates[`gameState/roles/${myPlayerId}/camp`] = "UNDERCOVER";

  // Y a-t-il un autre Imitateur humain à activer ensuite ?
  const remaining = Object.entries(gs.roles)
    .filter(([opid, or]) => opid !== myPlayerId && or.role === "IMITATEUR" && !currentRoomData.players?.[opid]?.isBot)
    .map(([opid]) => opid);
  if (remaining.length > 0) {
    updates[`gameState/imitateurActif`] = remaining[0];
    updates[`gameState/phase`] = "IMITATEUR";
  } else {
    updates[`gameState/imitateurActif`] = null;
    updates[`gameState/phase`] = "INDICES";
  }
  await update(ref(db, `rooms/${currentRoomCode}`), updates);
  showToast("👻 Tu deviens Mr White !");
});

// ======================================================================
// FORCEUR — zone pouvoirs + action
// ======================================================================
const renderPowersZone = (data) => {
  const gs = data.gameState;
  const myRoleObj = gs.roles?.[myPlayerId];
  if (!myRoleObj || !myRoleObj.enVie) return null;
  if (data.mjId === myPlayerId) return null;

  const parts = [];
  if (gs.forceurInterruption && gs.forceurInterruption.cible === myPlayerId) {
    parts.push(`
      <div class="force-alert">
        ⚡ <strong>INTERRUPTION !</strong><br>
        <span style="font-size:0.8rem;font-weight:500;opacity:0.8;">Donne immédiatement un 2ème indice.</span>
      </div>
    `);
  }
  if (myRoleObj.estForceur && !myRoleObj.pouvoirUtilise && gs.phase === "INDICES") {
    const inInterruption = !!gs.forceurInterruption;
    parts.push(`
      <div class="power-banner">
        <span class="power-icon">⚡</span>
        <div class="power-text">
          <strong>Forceur</strong> — force un joueur à donner un 2ème indice
        </div>
        <button class="power-btn" id="btnUseForceur" ${inInterruption ? 'disabled' : ''}>Utiliser</button>
      </div>
    `);
  }
  return parts.join("");
};

// Ouvre la modale de choix de cible pour le Forceur
const openForceurTargetModal = () => {
  const gs = currentRoomData.gameState;
  if (!gs) return;
  const overlay = $("#confirmModal");
  const content = overlay.querySelector(".modal-content");
  content.innerHTML = `
    <div style="font-size:2.3rem;margin-bottom:0.4rem;">⚡</div>
    <h3 class="font-display" style="font-size:1.2rem;font-weight:900;margin:0 0 0.3rem 0;">Forcer qui ?</h3>
    <p style="color:rgba(255,255,255,0.6);font-size:0.85rem;margin-bottom:1rem;">Le joueur devra immédiatement donner un 2ème indice.</p>
    <div id="forceurTargets" style="display:flex;flex-direction:column;gap:0.4rem;max-height:260px;overflow-y:auto;margin-bottom:1rem;"></div>
    <button id="btnForceurCancel" class="btn btn-ghost w-full">Annuler</button>
  `;
  overlay.classList.add("active");
  const list = content.querySelector("#forceurTargets");
  const cibles = Object.entries(gs.roles)
    .filter(([pid, r]) => r.enVie && pid !== myPlayerId);
  cibles.forEach(([pid]) => {
    const nom = currentRoomData.players?.[pid]?.name || "?";
    const b = document.createElement("button");
    b.className = "btn btn-ghost w-full";
    b.style.justifyContent = "flex-start";
    b.innerHTML = `<span class="avatar" style="width:30px;height:30px;font-size:0.8rem;">${escapeHTML(avatarLetter(nom))}</span> <span style="margin-left:0.5rem;">${escapeHTML(nom)}</span>`;
    b.addEventListener("click", async () => {
      const updates = {};
      updates[`gameState/forceurInterruption`] = { cible: pid, demandeur: myPlayerId };
      updates[`gameState/roles/${myPlayerId}/pouvoirUtilise`] = true;
      await update(ref(db, `rooms/${currentRoomCode}`), updates);
      overlay.classList.remove("active");
      setTimeout(() => restoreConfirmModal(), 500);
      showToast(`⚡ Forceur activé sur ${nom}`);
    });
    list.appendChild(b);
  });
  content.querySelector("#btnForceurCancel").addEventListener("click", () => {
    overlay.classList.remove("active");
    setTimeout(() => restoreConfirmModal(), 500);
  });
};

const restoreConfirmModal = () => {
  const overlay = $("#confirmModal");
  const content = overlay.querySelector(".modal-content");
  content.innerHTML = `
    <div style="font-size: 2.8rem; margin-bottom: 0.8rem;" id="confirmEmoji">⚠️</div>
    <h3 class="font-display" style="font-size: 1.3rem; font-weight: 900; margin: 0 0 0.5rem 0;" id="confirmTitle">Confirmer ?</h3>
    <p id="confirmMessage" style="color: rgba(255,255,255,0.6); font-size: 0.9rem; margin-bottom: 1.5rem;">Es-tu sûr ?</p>
    <div class="flex gap-3">
      <button id="confirmNo" class="btn btn-ghost flex-1">Non</button>
      <button id="confirmYes" class="btn btn-danger flex-1">Oui</button>
    </div>
  `;
};

// Délégation : bouton Forceur
document.body.addEventListener("click", (e) => {
  const btn = e.target.closest("#btnUseForceur");
  if (!btn || btn.disabled) return;
  if (!currentRoomCode || !currentRoomData) return;
  openForceurTargetModal();
});

// Hook : inject powers zone dans renderGame
const _renderGameOriginal = renderGame;
const renderGameExtended = (data) => {
  _renderGameOriginal(data);
  const listContainer = $("#gamePlayersList")?.parentElement;
  if (!listContainer) return;
  listContainer.querySelectorAll("[data-powers-zone]").forEach(x => x.remove());
  const zoneHtml = renderPowersZone(data);
  if (zoneHtml) {
    const wrapper = document.createElement("div");
    wrapper.setAttribute("data-powers-zone", "1");
    wrapper.innerHTML = zoneHtml;
    const firstChild = listContainer.firstChild;
    listContainer.insertBefore(wrapper, firstChild?.nextSibling || firstChild);
  }
};

// ======================================================================
// DUEL PFC
// ======================================================================
const renderDuel = (data) => {
  const gs = data.gameState;
  const duel = gs?.duel;
  if (!duel || !duel.fighters || duel.fighters.length !== 2) return;

  const [p1, p2] = duel.fighters;
  const n1 = data.players?.[p1]?.name || "?";
  const n2 = data.players?.[p2]?.name || "?";
  const c1 = duel.choices?.[p1];
  const c2 = duel.choices?.[p2];

  $("#duelName1").innerText = n1;
  $("#duelName2").innerText = n2;

  // Reset classes à chaque render
  $("#duelFighter1").classList.remove("winner","loser");
  $("#duelFighter2").classList.remove("winner","loser");
  $("#duelChoice1").classList.remove("revealed");
  $("#duelChoice2").classList.remove("revealed");

  if (!c1 || !c2) {
    $("#duelChoice1").innerText = c1 ? "✅" : "❓";
    $("#duelChoice2").innerText = c2 ? "✅" : "❓";
    $("#duelStatus1").innerText = c1 ? "Prêt" : "En attente...";
    $("#duelStatus2").innerText = c2 ? "Prêt" : "En attente...";
  } else {
    $("#duelChoice1").innerText = c1;
    $("#duelChoice2").innerText = c2;
    $("#duelChoice1").classList.add("revealed");
    $("#duelChoice2").classList.add("revealed");
    const winner = pfcWinner(c1, c2);
    if (winner === 1) {
      $("#duelStatus1").innerText = "GAGNANT 🏆";
      $("#duelStatus2").innerText = "ÉLIMINÉ 💀";
      $("#duelFighter1").classList.add("winner");
      $("#duelFighter2").classList.add("loser");
    } else if (winner === 2) {
      $("#duelStatus1").innerText = "ÉLIMINÉ 💀";
      $("#duelStatus2").innerText = "GAGNANT 🏆";
      $("#duelFighter2").classList.add("winner");
      $("#duelFighter1").classList.add("loser");
    } else {
      $("#duelStatus1").innerText = "ÉGALITÉ";
      $("#duelStatus2").innerText = "ÉGALITÉ";
    }
    if (!duel.resolved && isHost) {
      setTimeout(() => resolveDuel(), 2500);
    }
  }

  const amFighter = (myPlayerId === p1 || myPlayerId === p2);
  const zone = $("#duelActionZone");
  if (amFighter && !(duel.choices?.[myPlayerId])) {
    zone.style.display = "";
    zone.querySelectorAll(".pfc-btn").forEach(b => b.classList.remove("chosen"));
  } else {
    zone.style.display = "none";
  }

  const anyMissing = !c1 || !c2;
  $("#btnForceAFK").style.display = (isHost && anyMissing) ? "" : "none";

  // Auto-jouer pour les bots
  autoBotDuel(data);
};

const pfcWinner = (a, b) => {
  if (a === b) return 0;
  const wins = { "🪨": "✂️", "📄": "🪨", "✂️": "📄" };
  if (wins[a] === b) return 1;
  return 2;
};

const resolveDuel = async () => {
  if (!currentRoomCode) return;
  const snap = await get(ref(db, `rooms/${currentRoomCode}/gameState`));
  const gs = snap.val();
  if (!gs || !gs.duel || gs.duel.resolved) return;
  const [p1, p2] = gs.duel.fighters;
  const c1 = gs.duel.choices?.[p1];
  const c2 = gs.duel.choices?.[p2];
  if (!c1 || !c2) return;
  const w = pfcWinner(c1, c2);
  if (w === 0) {
    await update(ref(db, `rooms/${currentRoomCode}/gameState/duel`), { choices: {} });
    showToast("🔄 Égalité ! Rejouez");
    return;
  }
  const eliminated = (w === 1) ? p2 : p1;
  await update(ref(db, `rooms/${currentRoomCode}/gameState/duel`), { resolved: true });
  await applyElimination(eliminated, "DUEL");
  await set(ref(db, `rooms/${currentRoomCode}/gameState/duel`), null);
};

document.querySelectorAll(".pfc-btn").forEach(b => {
  b.addEventListener("click", async () => {
    if (!currentRoomCode || !currentRoomData) return;
    const gs = currentRoomData.gameState;
    if (!gs?.duel) return;
    if (!gs.duel.fighters.includes(myPlayerId)) return;
    if (gs.duel.choices?.[myPlayerId]) return;
    const choice = b.getAttribute("data-pfc");
    document.querySelectorAll(".pfc-btn").forEach(x => x.classList.remove("chosen"));
    b.classList.add("chosen");
    await set(ref(db, `rooms/${currentRoomCode}/gameState/duel/choices/${myPlayerId}`), choice);
  });
});

$("#btnForceAFK").addEventListener("click", async () => {
  if (!isHost || !currentRoomCode) return;
  const gs = currentRoomData?.gameState;
  if (!gs?.duel) return;
  const [p1, p2] = gs.duel.fighters;
  const options = ["🪨", "📄", "✂️"];
  const updates = {};
  if (!gs.duel.choices?.[p1]) updates[`gameState/duel/choices/${p1}`] = options[Math.floor(Math.random()*3)];
  if (!gs.duel.choices?.[p2]) updates[`gameState/duel/choices/${p2}`] = options[Math.floor(Math.random()*3)];
  if (Object.keys(updates).length) await update(ref(db, `rooms/${currentRoomCode}`), updates);
});

const autoBotDuel = (data) => {
  if (!isHost) return;
  const gs = data.gameState;
  if (!gs?.duel) return;
  const [p1, p2] = gs.duel.fighters;
  const options = ["🪨", "📄", "✂️"];
  const updates = {};
  if (data.players?.[p1]?.isBot && !gs.duel.choices?.[p1]) updates[`gameState/duel/choices/${p1}`] = options[Math.floor(Math.random()*3)];
  if (data.players?.[p2]?.isBot && !gs.duel.choices?.[p2]) updates[`gameState/duel/choices/${p2}`] = options[Math.floor(Math.random()*3)];
  if (Object.keys(updates).length) {
    setTimeout(() => update(ref(db, `rooms/${currentRoomCode}`), updates), 800);
  }
};

// ======================================================================
// SCORES — attribution
// ======================================================================
const POINTS = {
  CIVIL_WIN: 20, UNDER_WIN: 20, MRWHITE_WIN: 20, MRWHITE_GUESS: 25,
  PARIA_SOLO: 40, COUPLE_WIN: 30,
  SURVIVANT: 5, FORCEUR_BONUS: 5
};

const attribuerScores = async (gs, victoire, data) => {
  const code = currentRoomCode;
  if (!code) return { session: {}, global: {}, diff: {} };

  const [sessSnap, globSnap] = await Promise.all([
    get(ref(db, `rooms/${code}/scores_session`)),
    get(ref(db, `scores_general`))
  ]);
  const session = sessSnap.val() || {};
  const global = globSnap.val() || {};
  const diff = {};

  const addPoints = (playerId, name, pts) => {
    if (!pts) return;
    diff[name] = (diff[name] || 0) + pts;
    session[name] = (session[name] || 0) + pts;
    global[name]  = (global[name]  || 0) + pts;
  };

  for (const pid in gs.roles) {
    const r = gs.roles[pid];
    const name = data.players?.[pid]?.name;
    if (!name || data.players?.[pid]?.isBot) continue;
    const enVie = r.enVie;
    const camp = r.camp;
    const roleInit = r.roleInitial || r.role;

    if (victoire.camp === "AMOUREUX" && r.coupleAvec && enVie) { addPoints(pid, name, POINTS.COUPLE_WIN); continue; }
    if (victoire.camp === "MR_WHITE" && r.role === "MR WHITE") { addPoints(pid, name, POINTS.MRWHITE_GUESS); continue; }
    if (victoire.camp === "PARIA" && pid === victoire.heroId) { addPoints(pid, name, POINTS.PARIA_SOLO); continue; }
    // Fallback : pour les anciennes saves sans heroId, on utilise role actuel
    if (victoire.camp === "PARIA" && !victoire.heroId && r.role === "PARIA") { addPoints(pid, name, POINTS.PARIA_SOLO); continue; }
    if (victoire.camp === "IMPOSTEUR_SOLO" && pid === victoire.heroId) {
      addPoints(pid, name, POINTS.UNDER_WIN);
      if (enVie) addPoints(pid, name, POINTS.SURVIVANT);
      if (r.estForceur) addPoints(pid, name, POINTS.FORCEUR_BONUS);
      continue;
    }
    if (victoire.camp === "IMPOSTEUR_SOLO") continue; // les autres (Mr White inclus) ne gagnent rien

    if (victoire.camp === "CIVILS" && camp === "CIVIL") {
      addPoints(pid, name, POINTS.CIVIL_WIN);
      if (enVie) addPoints(pid, name, POINTS.SURVIVANT);
    } else if (victoire.camp === "UNDERCOVER" && camp === "UNDERCOVER") {
      addPoints(pid, name, POINTS.UNDER_WIN);
      if (enVie) addPoints(pid, name, POINTS.SURVIVANT);
      if (r.estForceur) addPoints(pid, name, POINTS.FORCEUR_BONUS);
    }
  }

  await set(ref(db, `rooms/${code}/scores_session`), session);
  await set(ref(db, `scores_general`), global);
  return { session, global, diff };
};

// ======================================================================
// TITRES HONORIFIQUES
// ======================================================================
const calculerTitres = (gs, data) => {
  const titres = [];
  const players = data.players || {};
  
  // 1. RECONSTRUCTION SÉCURISÉE DES VOTES (Le correctif est ici !)
  // On fusionne l'historique existant ET les votes de la toute dernière manche
  // qui ne sont pas encore sauvegardés dans l'historique au moment du calcul.
  const trueAcc = {};
  const historique = gs.stats?.accusations || {};
  
  // A. On copie l'historique
  for (const voter in historique) {
    trueAcc[voter] = { ...historique[voter] };
  }
  
  // B. On y ajoute les votes de la table actuelle
  if (gs.votes) {
    for (const voter in gs.votes) {
      const cible = gs.votes[voter];
      if (cible && cible !== "BLANC") {
        if (!trueAcc[voter]) trueAcc[voter] = {};
        trueAcc[voter][cible] = (trueAcc[voter][cible] || 0) + 1;
      }
    }
  }

  const eliminesParVote = Object.keys(gs.roles).filter(pid => !gs.roles[pid].enVie);
  const nameOf = (pid) => players[pid]?.name || "?";
  const isBot = (pid) => pid.includes("bot") || players[pid]?.isBot;

  // 🎯 SNIPER : a fait éliminer le plus de monde par ses votes
  const scoreSniper = {};
  for (const voter in trueAcc) { // <-- On utilise trueAcc !
    for (const cible in trueAcc[voter]) {
      if (eliminesParVote.includes(cible)) {
        scoreSniper[voter] = (scoreSniper[voter] || 0) + trueAcc[voter][cible];
      }
    }
  }
  let maxSniper = 0, sniperId = null;
  for (const pid in scoreSniper) {
    if (scoreSniper[pid] > maxSniper || (scoreSniper[pid] === maxSniper && sniperId && isBot(sniperId) && !isBot(pid))) { 
      maxSniper = scoreSniper[pid]; 
      sniperId = pid; 
    }
  }
  if (sniperId && maxSniper >= 2) {
    titres.push({
      icon: "🎯",
      label: "Sniper",
      winner: nameOf(sniperId),
      desc: `A fait éliminer ${maxSniper} joueurs par ses accusations.`
    });
  }

  // 👻 FANTÔME : vivant et jamais accusé
  const votesRecu = {};
  for (const voter in trueAcc) { // <-- On utilise trueAcc !
    for (const cible in trueAcc[voter]) {
      votesRecu[cible] = (votesRecu[cible] || 0) + trueAcc[voter][cible];
    }
  }
  
  const vivants = Object.entries(gs.roles)
    .filter(([pid, r]) => r.enVie)
    .sort(([pidA], [pidB]) => (isBot(pidA) ? 1 : 0) - (isBot(pidB) ? 1 : 0));

  for (const [pid] of vivants) {
    if (!votesRecu[pid]) {
      titres.push({
        icon: "👻",
        label: "Fantôme",
        winner: nameOf(pid),
        desc: "Zéro accusation reçue de toute la partie. Totalement invisible."
      });
      break; 
    }
  }

  // 🔥 JUSTICIER OBSESSIONNEL : a voté le plus souvent contre le MÊME joueur
  const obsession = {};
  for (const voter in trueAcc) { // <-- On utilise trueAcc !
    for (const cible in trueAcc[voter]) {
      const n = trueAcc[voter][cible];
      if (!obsession[voter] || obsession[voter].count < n) {
        obsession[voter] = { cible, count: n };
      }
    }
  }
  let maxObs = 0, justicierId = null, justicierCible = null;
  for (const v in obsession) {
    if (obsession[v].count > maxObs || (obsession[v].count === maxObs && justicierId && isBot(justicierId) && !isBot(v))) {
      maxObs = obsession[v].count;
      justicierId = v;
      justicierCible = obsession[v].cible;
    }
  }
  if (justicierId && maxObs >= 3) {
    titres.push({
      icon: "🔥",
      label: "Justicier obsessionnel",
      winner: nameOf(justicierId),
      desc: `A accusé ${nameOf(justicierCible)} à ${maxObs} reprises.`
    });
  }

  // 💘 AMOUR ÉTERNEL : membre d'un couple vivant à la fin
  const couplesDone = new Set();
  for (const pid in gs.roles) {
    const r = gs.roles[pid];
    if (r.coupleAvec && r.enVie && !couplesDone.has(pid)) {
      const partenaireVivant = gs.roles[r.coupleAvec]?.enVie;
      if (partenaireVivant) {
        titres.push({
          icon: "💘",
          label: "Amour éternel",
          winner: nameOf(pid),
          desc: "A survécu à la partie en couple. L'amour triomphe."
        });
        couplesDone.add(pid);
        couplesDone.add(r.coupleAvec);
      }
    }
  }

  // ⚡ MAÎTRE DU POUVOIR : Forceur qui a utilisé son pouvoir
  for (const pid in gs.roles) {
    const r = gs.roles[pid];
    if (r.estForceur && r.pouvoirUtilise) {
      titres.push({
        icon: "⚡",
        label: "Maître du pouvoir",
        winner: nameOf(pid),
        desc: "A utilisé son pouvoir de Forceur pour faire craquer un joueur."
      });
    }
  }

  // 🥺 MARTYR HEUREUX : Paria éliminé très tôt (exploit réussi)
  for (const pid in gs.roles) {
    const r = gs.roles[pid];
    if (r.roleInitial === "PARIA" && !r.enVie && (gs.numManche <= 2)) {
      titres.push({
        icon: "🥺",
        label: "Martyr heureux",
        winner: nameOf(pid),
        desc: "Éliminé tôt pour mieux triompher."
      });
    }
  }

  return titres;
};

// ======================================================================
// BOTS IA — indices contextuels
// ======================================================================
const BOT_INDICE_CONTEXT = {
        
        // 🍔 Nourriture & Boissons
        "PIZZA": ["Italie", "Fromage", "Four", "Pâte", "Tomate", "Rond", "Mozzarella", "Croûte", "Margarita", "Tranche", "Livraison", "Boîte", "Chaud", "Part", "Pepperoni", "Olive", "Repas", "Manger", "Cuire", "Gourmand"],
        "QUICHE": ["Lardons", "Pâte", "Four", "Œufs", "Crème", "Lorraine", "Tarte", "Salé", "Chaud", "Repas", "Cuire", "Gruyère", "Fromage", "Part", "Manger", "Plat", "Maison", "Fourchette", "Entrée", "Tradition"],
        "BURGER": ["Pain", "Viande", "Fast-food", "Frites", "Américain", "Sauce", "Steak", "Fromage", "Bacon", "Mains", "Salade", "Tomate", "Oignon", "Repas", "Gras", "Menu", "McDo", "Manger", "Rond", "Gourmand"],
        "HOT-DOG": ["Saucisse", "Pain", "Moutarde", "Américain", "Ketchup", "Rue", "Fast-food", "Saucisse", "Vite", "Manger", "Mains", "Gras", "Chaud", "Oignons", "Stade", "New York", "Repas", "Viande", "Sauce", "Long"],
        "KÉBAB": ["Viande", "Pain", "Sauce", "Fast-food", "Frites", "Oignon", "Salade", "Tomate", "Galette", "Broche", "Tourne", "Gras", "Nuit", "Soirée", "Chef", "Manger", "Mains", "Blanche", "Samouraï", "Repas"],
        "TACOS": ["Galette", "Viande", "Sauce", "Mexique", "Fromage", "Frites", "Plié", "Gras", "Fast-food", "Viande hachée", "Poulet", "Gruyère", "Chaud", "Manger", "Mains", "Lourd", "Repas", "Gourmand", "Oignons", "Piquant"],
        "PÂTES": ["Italie", "Eau", "Sauce", "Blé", "Casserole", "Long", "Spaghetti", "Coquillettes", "Bolognaise", "Fromage", "Cuire", "Chaud", "Repas", "Passoire", "Beurre", "Manger", "Gruyère", "Carbonara", "Féculent", "Rapide"],
        "RIZ": ["Asie", "Blanc", "Grain", "Eau", "Céréale", "Sushi", "Casserole", "Chaud", "Manger", "Plat", "Accompagnement", "Bol", "Cantonnais", "Cuire", "Baguettes", "Chine", "Japon", "Repas", "Féculent", "Basmati"],
        "PURÉE": ["Pomme de terre", "Lait", "Écraser", "Chaud", "Plat", "Doux", "Beurre", "Manger", "Cuillère", "Maison", "Flocons", "Accompagnement", "Enfant", "Jaune", "Saucisse", "Repas", "Casserole", "Fourchette", "Nourriture", "Mixer"],
        "COMPOTE": ["Pomme", "Dessert", "Écraser", "Doux", "Fruit", "Pot", "Cuillère", "Enfant", "Manger", "Sucré", "Froid", "Goûter", "Maison", "Casserole", "Mixer", "Jaune", "Nourriture", "Léger", "Fin de repas", "Fraise"],
        "SAUMON": ["Poisson", "Rose", "Eau", "Sushi", "Rivière", "Frais", "Fumé", "Tranche", "Océan", "Mer", "Nager", "Plat", "Cru", "Cuire", "Pavé", "Citron", "Norvège", "Gras", "Manger", "Fête"],
        "THON": ["Poisson", "Boîte", "Mer", "Gros", "Salade", "Sushi", "Océan", "Nager", "Cru", "Cuire", "Manger", "Mayonnaise", "Sandwich", "Rouge", "Pêche", "Frais", "Plat", "Eau", "Conserve", "Maki"],
        "HUÎTRE": ["Coquillage", "Mer", "Nouvel An", "Citron", "Perle", "Frais", "Fête", "Eau", "Ouvrir", "Couteau", "Coquille", "Manger", "Cru", "Salé", "Océan", "Plage", "Bourriche", "Bretagne", "Glissant", "Vivant"],
        "MOULE": ["Coquillage", "Mer", "Frites", "Noir", "Casserole", "Océan", "Eau", "Manger", "Chaud", "Plat", "Restaurant", "Coquille", "Fermé", "Ouvrir", "Bretagne", "Fruits de mer", "Salé", "Cuisine", "Marée", "Rocher"],
        "JAMBON": ["Viande", "Cochon", "Rose", "Sandwich", "Tranche", "Charcuterie", "Beurre", "Manger", "Porc", "Froid", "Supermarché", "Boucher", "Gras", "Salé", "Coquillettes", "Purée", "Plat", "Repas", "Doux", "Fumé"],
        "BACON": ["Viande", "Cochon", "Gras", "Grillé", "Burger", "Matin", "Tranche", "Poêle", "Chaud", "Américain", "Petit-déjeuner", "Œufs", "Fumé", "Porc", "Manger", "Salé", "Croustillant", "Cuire", "Odeur", "Gourmand"],
        "SALAMI": ["Charcuterie", "Porc", "Tranches", "Pizza", "Viande", "Fumé", "Gras", "Rouge", "Sandwich", "Manger", "Salé", "Apéro", "Cochon", "Boucher", "Poivre", "Sec", "Rond", "Couper", "Supermarché", "Froid"],
        "ROUGAIL LA MORUE": ["Poisson", "Réunion", "Plat", "Riz", "Sauce", "Tradition", "Marmite", "Tomate", "Piment", "Oignon", "Manger", "Créole", "Chaud", "Cuisine", "Salé", "Famille", "Épices", "Repas", "Dimanche", "Zourit"],
        "ROUGAIL SAUCISSE": ["Réunion", "Plat", "Riz", "Piment", "Marmite", "Porc", "Tomate", "Oignon", "Tradition", "Manger", "Créole", "Chaud", "Cuisine", "Épices", "Famille", "Repas", "Dimanche", "Gourmand", "Viande", "Sauce"],
        "CARRY POULET": ["Réunion", "Plat", "Riz", "Viande", "Sauce", "Marmite", "Tradition", "Manger", "Créole", "Chaud", "Cuisine", "Épices", "Tomate", "Oignon", "Curcuma", "Jaune", "Famille", "Repas", "Dimanche", "Oiseau"],
        "SUCRE": ["Blanc", "Poudre", "Doux", "Café", "Canne", "Cristal", "Gâteau", "Dessert", "Manger", "Bonbon", "Caramel", "Cuillère", "Morceau", "Chaud", "Cuisine", "Pâtisserie", "Diabète", "Roux", "Plante", "Gourmand"],
        "SEL": ["Blanc", "Assaisonnement", "Mer", "Cuisine", "Poivre", "Pincée", "Salé", "Plat", "Repas", "Manger", "Poudre", "Frites", "Grains", "Océan", "Table", "Salière", "Goût", "Sauce", "Viande", "Indispensable"],
        "POIVRE": ["Noir", "Assaisonnement", "Cuisine", "Piquant", "Éternuer", "Grains", "Moulin", "Sel", "Plat", "Repas", "Manger", "Poudre", "Épice", "Table", "Viande", "Goût", "Sauce", "Fort", "Gris", "Indispensable"],
        "PIMENT": ["Rouge", "Piquant", "Chaud", "Épice", "Cuisine", "Brûle", "Bouche", "Fort", "Sauce", "Plat", "Manger", "Légume", "Mexique", "Réunion", "Vert", "Feu", "Gout", "Assaisonnement", "Petit", "Oiseau"],
        "OIGNON": ["Légume", "Pleurer", "Couper", "Cuisine", "Blanc", "Rond", "Éplucher", "Poêle", "Plat", "Repas", "Manger", "Odeur", "Haleine", "Sauce", "Rouge", "Jaune", "Couteau", "Burger", "Fondue", "Larme"],
        "AIL": ["Gousse", "Cuisine", "Odeur", "Vampire", "Blanc", "Haleine", "Éplucher", "Plat", "Repas", "Manger", "Légume", "Poêle", "Sauce", "Fort", "Condiment", "Couper", "Bouche", "Piquer", "Assaisonnement", "Couteau"],
        "VINAIGRE": ["Liquide", "Acide", "Salade", "Bouteille", "Sauce", "Huile", "Vinaigrette", "Odeur", "Cuisine", "Plat", "Manger", "Balsamique", "Blanc", "Pomme", "Moutarde", "Condiment", "Mélanger", "Bocal", "Repas", "Goût"],
        "HUILE": ["Liquide", "Jaune", "Gras", "Poêle", "Bouteille", "Olive", "Frire", "Cuisine", "Salade", "Vinaigrette", "Cuire", "Plat", "Manger", "Tournesol", "Frites", "Bouteille", "Chaud", "Tache", "Moteur", "Glissant"],
        "MAYONNAISE": ["Sauce", "Jaune", "Frites", "Huile", "Œuf", "Pot", "Mélanger", "Batteur", "Moutarde", "Gras", "Manger", "Plat", "Burger", "Sandwich", "Ketchup", "Condiment", "Froid", "Tube", "Blanc", "Gourmand"],
        "KETCHUP": ["Sauce", "Rouge", "Tomate", "Frites", "Burger", "Bouteille", "Pot", "Sucré", "Manger", "Plat", "Américain", "Enfant", "Tube", "Pâtes", "Condiment", "Froid", "Gourmand", "Hot-dog", "Viande", "Mayonnaise"],
        "MOUTARDE": ["Jaune", "Piquant", "Sauce", "Viande", "Condiment", "Pot", "Fort", "Nez", "Dijon", "Mayonnaise", "Ketchup", "Manger", "Plat", "Saucisse", "Hot-dog", "Grains", "Cuillère", "Bouteille", "Piquer", "Froid"],
        "PIMENT CHINOIS (SAUCE)": ["Piquant", "Rouge", "Asie", "Réunion", "Fort", "Brûle", "Sauce", "Bouche", "Plat", "Manger", "Cuisine", "Épice", "Feu", "Gout", "Chaud", "Bocal", "Cuillère", "Pâte", "Condiment", "Odeur"],
        "SAMOURAÏ (SAUCE)": ["Piquant", "Orange", "Frites", "Kebab", "Belge", "Sauce", "Gras", "Mayonnaise", "Pot", "Tube", "Manger", "Plat", "Burger", "Tacos", "Viande", "Condiment", "Fort", "Froid", "Gourmand", "Fast-food"],
        "GRAISSE": ["Huile", "Lourd", "Cuisine", "Beurre", "Frire", "Gras", "Viande", "Poêle", "Chaud", "Manger", "Plat", "Kilo", "Régime", "Frites", "Cochon", "Liquide", "Tache", "Sain", "Santé", "Cuire"],
        "POMME": ["Fruit", "Arbre", "Rouge", "Vert", "Pépin", "Cidre", "Croquer", "Tarte", "Compote", "Jus", "Manger", "Sucré", "Rond", "Verger", "Nature", "Sain", "Gâteau", "Golden", "Blanche-Neige", "Matin"],
        "POIRE": ["Fruit", "Arbre", "Vert", "Jus", "Pépin", "Forme", "Doux", "Sucré", "Tarte", "Manger", "Croquer", "Verger", "Nature", "Sain", "Dessert", "Jaune", "Juteux", "Gâteau", "Automne", "Matin"],
        "CITRON": ["Jaune", "Acide", "Fruit", "Jus", "Zeste", "Agrume", "Arbre", "Presser", "Boisson", "Eau", "Manger", "Tarte", "Poisson", "Piquer", "Sain", "Soleil", "Verger", "Cocktail", "Vert", "Frais"],
        "PAMPLEMOUSSE": ["Rose", "Acide", "Fruit", "Jus", "Agrume", "Amer", "Jaune", "Arbre", "Matin", "Presser", "Manger", "Boisson", "Sain", "Gros", "Cuillère", "Sucre", "Verger", "Soleil", "Frais", "Petit-déjeuner"],
        "TOMATE": ["Rouge", "Légume", "Salade", "Jus", "Rond", "Sauce", "Plante", "Ketchup", "Pizza", "Manger", "Frais", "Eau", "Pépin", "Jardin", "Couper", "Mozzarella", "Été", "Cuisine", "Plat", "Fruit"],
        "POIVRON": ["Légume", "Rouge", "Vert", "Salade", "Croquant", "Cuisine", "Jaune", "Pépin", "Plante", "Plat", "Manger", "Chaud", "Poêle", "Frais", "Jardin", "Couper", "Soleil", "Été", "Doux", "Ratatouille"],
        "CAROTTE": ["Orange", "Légume", "Lapin", "Terre", "Long", "Croquant", "Plante", "Jardin", "Soupe", "Purée", "Manger", "Râper", "Salade", "Frais", "Couper", "Feuilles", "Vue", "Couleur", "Sain", "Cuisine"],
        "COURGETTE": ["Vert", "Légume", "Long", "Soupe", "Poêle", "Cuisine", "Plante", "Jardin", "Manger", "Chaud", "Plat", "Couper", "Frais", "Eau", "Ratatouille", "Graines", "Sain", "Été", "Doux", "Terre"],
        "MELON": ["Fruit", "Orange", "Été", "Rond", "Frais", "Sucré", "Jambon", "Jus", "Eau", "Gros", "Manger", "Couper", "Plante", "Jardin", "Soleil", "Dessert", "Entrée", "Graines", "Vert", "Chaleur"],
        "PASTÈQUE": ["Fruit", "Rouge", "Vert", "Eau", "Été", "Gros", "Pépin", "Frais", "Sucré", "Manger", "Couper", "Plante", "Soleil", "Chaleur", "Jus", "Dessert", "Lourd", "Tranche", "Croquer", "Rond"],
        "FRAISE": ["Fruit", "Rouge", "Dessert", "Sucré", "Petit", "Été", "Plante", "Gâteau", "Tarte", "Confiture", "Manger", "Jardin", "Bois", "Frais", "Gourmand", "Mignon", "Chantilly", "Graines", "Saveur", "Soleil"],
        "CERISE": ["Fruit", "Rouge", "Noyau", "Arbre", "Petit", "Été", "Dessert", "Sucré", "Manger", "Clafoutis", "Jardin", "Frais", "Gourmand", "Paire", "Oreille", "Cueillir", "Printemps", "Oiseau", "Soleil", "Gâteau"],
        "ANANAS": ["Fruit", "Jaune", "Exotique", "Piquant", "Jus", "Feuilles", "Sucré", "Dessert", "Manger", "Chaud", "Soleil", "Île", "Tropical", "Couper", "Pizza", "Gros", "Frais", "Rond", "Gourmand", "Odeur"],
        "MANGUE": ["Fruit", "Jaune", "Exotique", "Noyau", "Sucré", "Peau", "Jus", "Dessert", "Manger", "Chaud", "Soleil", "Île", "Tropical", "Couper", "Frais", "Gourmand", "Orange", "Arbre", "Doux", "Odeur"],
        "PAPAYE": ["Fruit", "Orange", "Tropical", "Graines", "Arbre", "Sucré", "Exotique", "Jus", "Dessert", "Manger", "Chaud", "Soleil", "Île", "Couper", "Frais", "Gros", "Gourmand", "Odeur", "Vert", "Doux"],
        "FRUIT DE LA PASSION": ["Fruit", "Exotique", "Graines", "Jus", "Acide", "Maracudja", "Tropical", "Dessert", "Manger", "Chaud", "Soleil", "Île", "Couper", "Frais", "Gourmand", "Odeur", "Violet", "Jaune", "Sucré", "Cocktail"],
        "AUBERGINE": ["Légume", "Violet", "Long", "Cuisine", "Plat", "Poêle", "Plante", "Jardin", "Manger", "Chaud", "Couper", "Frais", "Ratatouille", "Graines", "Sain", "Été", "Doux", "Terre", "Gros", "Emoji"],
        "BROCOLI": ["Légume", "Vert", "Arbre", "Vapeur", "Sain", "Cuisine", "Plante", "Jardin", "Manger", "Chaud", "Plat", "Couper", "Frais", "Soupe", "Eau", "Enfant", "Santé", "Chou", "Bouilli", "Repas"],
        "CROISSANT": ["Boulangerie", "Matin", "Beurre", "Pâte", "Viennoiserie", "Lune", "Chaud", "Manger", "Four", "Petit-déjeuner", "Café", "Gras", "Gourmand", "Feuilleté", "France", "Boulanger", "Sachet", "Sucré", "Doux", "Artisan"],
        "GAUFRE": ["Sucre", "Chaud", "Pâte", "Carré", "Goûter", "Fer", "Manger", "Dessert", "Gourmand", "Nutella", "Chantilly", "Fête", "Forain", "Cuire", "Belgique", "Trous", "Confiture", "Sucré", "Maison", "Fraise"],
        "LAIT": ["Blanc", "Vache", "Bouteille", "Matin", "Verre", "Céréales", "Boire", "Froid", "Chaud", "Calcium", "Pis", "Ferme", "Liquide", "Café", "Chocolat", "Petit-déjeuner", "Santé", "Brique", "Doux", "Yaourt"],
        "PAIN": ["Boulangerie", "Baguette", "Mie", "Croûte", "Farine", "Matin", "Manger", "Repas", "Sandwich", "Beurre", "Confiture", "Four", "Chaud", "Tartine", "Blé", "Céréale", "Boulanger", "Tranche", "Table", "Nourriture"],
        "FROMAGE": ["Lait", "Vache", "Odeur", "Pizza", "Pâte", "Pain", "Manger", "Repas", "Chèvre", "Brebis", "Blanc", "Jaune", "Fondue", "Raclette", "Gras", "Gourmand", "Laiterie", "Couper", "Trou", "Souris"],
        "YAOURT": ["Lait", "Dessert", "Cuillère", "Pot", "Frais", "Fruit", "Manger", "Blanc", "Sucré", "Nature", "Vache", "Fin de repas", "Gourmand", "Mélanger", "Santé", "Léger", "Plastique", "Frigo", "Doux", "Enfant"],
        "CONFITURE": ["Fruit", "Sucre", "Tartine", "Matin", "Pot", "Fraise", "Manger", "Petit-déjeuner", "Pain", "Doux", "Gourmand", "Maison", "Cuire", "Abricot", "Tartiner", "Cuillère", "Bocal", "Verre", "Grand-mère", "Collant"],
        "MIEL": ["Abeille", "Sucre", "Jaune", "Tartine", "Pot", "Nature", "Manger", "Doux", "Gourmand", "Matin", "Pain", "Thé", "Gorge", "Collant", "Ruche", "Insecte", "Fleur", "Cuillère", "Liquide", "Ours"],
        "NUTELLA": ["Chocolat", "Tartine", "Pot", "Noisette", "Sucré", "Matin", "Manger", "Gourmand", "Pain", "Crêpe", "Enfant", "Gras", "Marron", "Cuillère", "Doigt", "Petit-déjeuner", "Goûter", "Doux", "Pâte", "Huile"],
        "BEURRE DE CACAHUÈTE": ["Pot", "Tartine", "Américain", "Gras", "Arachide", "Sucré", "Manger", "Gourmand", "Pain", "Matin", "Confiture", "Marron", "Pâte", "Salé", "Lourd", "Cuillère", "Petit-déjeuner", "USA", "Doux", "Colle"],
        "GÂTEAU": ["Dessert", "Sucre", "Four", "Anniversaire", "Chocolat", "Part", "Manger", "Gourmand", "Pâtisserie", "Fête", "Bougie", "Cuire", "Pâte", "Œuf", "Farine", "Moule", "Chaud", "Goûter", "Partager", "Tranche"],
        "TARTE": ["Dessert", "Four", "Fruit", "Pâte", "Rond", "Pomme", "Manger", "Gourmand", "Pâtisserie", "Fraise", "Citron", "Cuire", "Moule", "Part", "Couper", "Chaud", "Froid", "Sucré", "Maison", "Repas"],
        "BONBON": ["Sucre", "Petit", "Enfant", "Couleur", "Sachet", "Dent", "Manger", "Gourmand", "Fête", "Halloween", "Macher", "Sucette", "Doux", "Piquant", "Fraise", "Caramel", "Gélatine", "Récompense", "Bouche", "Poche"],
        "CHEWING-GUM": ["Macher", "Bulle", "Menthe", "Bouche", "Gout", "Coller", "Sucre", "Fraise", "Manger", "Cracher", "Haleine", "Dents", "Papier", "Boîte", "Élastique", "Rose", "Long", "Avaler", "Rue", "Chaussure"],
        "CACAO": ["Poudre", "Chocolat", "Amer", "Marron", "Chaud", "Lait", "Boire", "Matin", "Petit-déjeuner", "Mélanger", "Sucre", "Gâteau", "Fève", "Arbre", "Gourmand", "Tasse", "Bol", "Boîte", "Enfant", "Doux"],
        "CHOCOLAT": ["Tablette", "Marron", "Sucre", "Cacao", "Dessert", "Lait", "Manger", "Gourmand", "Noir", "Blanc", "Gâteau", "Pâques", "Noël", "Cadeau", "Carré", "Fondre", "Chaud", "Doux", "Enfant", "Croquer"],
        "DESSERT": ["Sucre", "Fin", "Repas", "Gâteau", "Fruit", "Gourmand", "Manger", "Chocolat", "Glace", "Tarte", "Yaourt", "Doux", "Pâtisserie", "Restaurant", "Faim", "Plaisir", "Partager", "Cuillère", "Assiette", "Maison"],
        "ENTRÉE": ["Début", "Repas", "Salade", "Léger", "Plat", "Ouvrir", "Manger", "Faim", "Restaurant", "Tomate", "Soupe", "Froid", "Chaud", "Assiette", "Fourchette", "Maison", "Invités", "Préparer", "Avant", "Appétit"],
        "CHIPS": ["Apéro", "Pomme de terre", "Salé", "Sachet", "Croquant", "Gras", "Manger", "Fête", "Amis", "Soirée", "Bruit", "Jaune", "Frire", "Léger", "Doigts", "Bol", "Pique-nique", "Gourmand", "Macher", "Vite"],
        "CACAHUÈTES": ["Apéro", "Salé", "Coque", "Bar", "Grillé", "Arachide", "Manger", "Fête", "Amis", "Soirée", "Bol", "Croquant", "Gras", "Ouvrir", "Doigts", "Petit", "Graine", "Gourmand", "Pique-nique", "Boisson"],
        "CAFÉ": ["Chaud", "Matin", "Noir", "Tasse", "Énergie", "Grain", "Boire", "Réveil", "Machine", "Sucre", "Amer", "Lait", "Pause", "Travail", "Bar", "Odeur", "Goutte", "Liquide", "Filtre", "Bouillant"],
        "THÉ": ["Chaud", "Eau", "Infusion", "Feuille", "Tasse", "Matin", "Boire", "Sachet", "Sucre", "Miel", "Menthe", "Vert", "Noir", "Pause", "Détente", "Bouilloire", "Plante", "Liquide", "Après-midi", "Bouillant"],
        "CAPPUCCINO": ["Chaud", "Café", "Mousse", "Lait", "Tasse", "Italie", "Boire", "Matin", "Sucre", "Cacao", "Poudre", "Bar", "Machine", "Énergie", "Gourmand", "Doux", "Liquide", "Pause", "Tasse", "Bouillant"],
        "BIÈRE": ["Mousse", "Verre", "Alcool", "Blonde", "Soirée", "Pinte", "Boire", "Bar", "Fête", "Amis", "Pression", "Bouteille", "Capsule", "Frais", "Brune", "Houblon", "Apéro", "Tchin", "Liquide", "Soif"],
        "CIDRE": ["Pomme", "Pétillant", "Verre", "Alcool", "Bretagne", "Crêpe", "Boire", "Bouteille", "Doux", "Brut", "Fête", "Amis", "Frais", "Fruit", "Bulle", "Bol", "Liquide", "Soif", "Apéro", "Tchin"],
        "VIN": ["Raisin", "Rouge", "Verre", "Alcool", "Bouteille", "Blanc", "Boire", "Rosé", "Repas", "Fête", "Amis", "Bouchon", "Tire-bouchon", "Cave", "Vigne", "Tchin", "Apéro", "Liquide", "Verre", "Déguster"],
        "CHAMPAGNE": ["Fête", "Bulles", "Alcool", "Bouteille", "Coupe", "Luxe", "Boire", "Nouvel An", "Célébrer", "Victoire", "Bouchon", "Sauter", "Mousse", "Verre", "Tchin", "Amis", "Frais", "Liquide", "Prestige", "Or"],
        "VODKA": ["Alcool", "Transparent", "Russie", "Pomme", "Fort", "Verre", "Boire", "Fête", "Soirée", "Bouteille", "Cocktail", "Glace", "Shooter", "Amis", "Nuit", "Blanc", "Liquide", "Brûle", "Mélange", "Soif"],
        "WHISKY": ["Alcool", "Ambré", "Glace", "Écosse", "Verre", "Fort", "Boire", "Bar", "Soirée", "Bouteille", "Glaçon", "Vieux", "Bois", "Amis", "Liquide", "Brûle", "Tourbe", "Tchin", "Déguster", "Soif"],
        "RHUM": ["Alcool", "Canne", "Sucre", "Réunion", "Pirate", "Cocktail", "Boire", "Île", "Soleil", "Bouteille", "Verre", "Blanc", "Vieux", "Fête", "Soirée", "Amis", "Liquide", "Punch", "Mojito", "Brûle"],
        "COCA": ["Noir", "Bulles", "Sucre", "Soda", "Rouge", "Frais", "Boire", "Glace", "Bouteille", "Canette", "Fast-food", "Américain", "Fête", "Enfant", "Liquide", "Gazeux", "Verre", "Soif", "Pétillant", "Gourmand"],
        "PUNCH": ["Alcool", "Fruits", "Fête", "Cocktail", "Rhum", "Bol", "Boire", "Soirée", "Amis", "Jus", "Mélange", "Soleil", "Île", "Louche", "Verre", "Liquide", "Sucré", "Chaud", "Glace", "Tchin"],
        "ANISETTE (ALCOOL)": ["Alcool", "Blanc", "Glace", "Apéro", "Sud", "Pastis", "Boire", "Eau", "Verre", "Jaune", "Marseille", "Pétanque", "Soleil", "Amis", "Liquide", "Frais", "Été", "Bouteille", "Tchin", "Glaçon"],

        // 🐺 Animaux Sauvages & Compagnie
        "CHIEN": ["Animal", "Ami", "Poils", "Aboyer", "Laisse", "Os", "Niche", "Collier", "Promener", "Fidèle", "Pattes", "Queue", "Mordre", "Jouer", "Garde", "Maison", "Odorat", "Canin", "Bête", "Compagnie"],
        "LOUP": ["Forêt", "Sauvage", "Lune", "Meute", "Hurler", "Croc", "Animal", "Poils", "Chasse", "Nuit", "Gris", "Pattes", "Queue", "Viande", "Peur", "Mordre", "Canin", "Bête", "Féroce", "Contes"],
        "CHAT": ["Animal", "Miauler", "Poils", "Moustache", "Griffe", "Ronronner", "Souris", "Dormir", "Litière", "Croquettes", "Pattes", "Queue", "Félin", "Maison", "Jouer", "Sauter", "Indépendant", "Bête", "Compagnie", "Doux"],
        "TIGRE": ["Sauvage", "Rayures", "Félin", "Jungle", "Carnivore", "Gros", "Animal", "Orange", "Noir", "Chasse", "Crocs", "Griffes", "Pattes", "Queue", "Peur", "Rugir", "Asie", "Bête", "Féroce", "Rapide"],
        "POULE": ["Ferme", "Œuf", "Plumes", "Bec", "Picorer", "Volaille", "Animal", "Ailes", "Pondre", "Coq", "Graines", "Nid", "Poussin", "Courir", "Bruit", "Viande", "Plat", "Bête", "Enclos", "Matin"],
        "COQ": ["Ferme", "Matin", "Plumes", "Chanter", "Crête", "Bec", "Animal", "Ailes", "Volaille", "Poule", "Rouge", "Graines", "Réveil", "Bruit", "Ergot", "Bête", "Enclos", "Chef", "Soleil", "Picorer"],
        "TAUREAU": ["Cornes", "Vache", "Rouge", "Arène", "Ferme", "Animal", "Gros", "Puissant", "Noir", "Charge", "Courir", "Espagne", "Combat", "Bête", "Herbe", "Macho", "Peur", "Furieux", "Lourd", "Sabot"],
        "VACHE": ["Lait", "Taches", "Ferme", "Herbe", "Animal", "Meugler", "Gros", "Noir", "Blanc", "Pis", "Pré", "Manger", "Bête", "Lourd", "Sabot", "Cornes", "Cloche", "Campagne", "Viande", "Paisible"],
        "COCHON": ["Ferme", "Rose", "Boue", "Groin", "Tire-bouchon", "Jambon", "Animal", "Gras", "Gros", "Sale", "Queue", "Manger", "Bête", "Viande", "Saucisson", "Porc", "Campagne", "Enclos", "Bruit", "Grognement"],
        "SANGLIER": ["Forêt", "Sauvage", "Défenses", "Obélix", "Poils", "Chasse", "Animal", "Gros", "Cochon", "Gris", "Noir", "Courir", "Bête", "Peur", "Charge", "Viande", "Terre", "Groin", "Nature", "Féroce"],
        "CANARD": ["Eau", "Plumes", "Bec", "Coin", "Mare", "Oiseau", "Animal", "Nager", "Voler", "Ailes", "Jaune", "Vert", "Plat", "Viande", "Bête", "Plongeon", "Étang", "Palmes", "Poussin", "Chasse"],
        "OIE": ["Eau", "Plumes", "Ferme", "Blanc", "Cou", "Voler", "Animal", "Oiseau", "Nager", "Ailes", "Gros", "Bec", "Bruit", "Garde", "Bête", "Plat", "Foie gras", "Étang", "Palmes", "Troupeau"],
        "CYGNE": ["Blanc", "Beau", "Cou", "Eau", "Lac", "Oiseau", "Animal", "Plumes", "Nager", "Ailes", "Voler", "Élégant", "Bec", "Bête", "Gros", "Étang", "Pur", "Amour", "Couple", "Palmes"],
        "DAUPHIN": ["Océan", "Sauter", "Intelligent", "Bleu", "Gris", "Nager", "Animal", "Eau", "Mer", "Marin", "Poisson", "Jouer", "Aileron", "Vague", "Beau", "Bête", "Bruit", "Rapide", "Troupeau", "Spectacle"],
        "BALEINE": ["Océan", "Gros", "Eau", "Nager", "Bleu", "Plancton", "Animal", "Mer", "Marin", "Gigantesque", "Aileron", "Souffle", "Queue", "Plonger", "Bruit", "Bête", "Lourd", "Profondeur", "Pacifique", "Chant"],
        "SARDINE": ["Poisson", "Boîte", "Mer", "Petit", "Huile", "Nager", "Animal", "Eau", "Océan", "Banc", "Argenté", "Manger", "Salé", "Barbecue", "Plat", "Bête", "Écailles", "Pêche", "Conserve", "Serré"],
        "REQUIN": ["Océan", "Dents", "Aileron", "Sang", "Nager", "Peur", "Animal", "Mer", "Eau", "Marin", "Carnivore", "Gros", "Chasse", "Mordre", "Bête", "Gris", "Blanc", "Danger", "Profondeur", "Féroce"],
        "ORQUE": ["Océan", "Noir", "Blanc", "Baleine", "Chasseur", "Nager", "Animal", "Mer", "Eau", "Marin", "Carnivore", "Gros", "Aileron", "Sauter", "Bête", "Intelligent", "Danger", "Spectacle", "Dent", "Rapide"],
        "HOMARD": ["Mer", "Rouge", "Pinces", "Carapace", "Restaurant", "Eau", "Animal", "Océan", "Marin", "Manger", "Plat", "Cher", "Luxe", "Cuire", "Chaud", "Bête", "Antennes", "Fond", "Pêche", "Dur"],
        "CRABE": ["Mer", "Plage", "Pinces", "Marcher", "Carapace", "Sable", "Animal", "Océan", "Marin", "Manger", "Plat", "Eau", "Côté", "Rocher", "Bête", "Petit", "Rouge", "Pêche", "Dur", "Piquer"],
        "SINGE": ["Arbre", "Banane", "Jungle", "Poils", "Macaque", "Sauter", "Animal", "Grimper", "Intelligent", "Mains", "Queue", "Bruit", "Jouer", "Drôle", "Bête", "Forêt", "Liane", "Cousin", "Zoo", "Mignon"],
        "GORILLE": ["Gros", "Singe", "Jungle", "Poitrine", "Puissant", "Poils", "Animal", "Noir", "Arbre", "Taper", "Force", "Lourd", "Bête", "Peur", "Forêt", "Zoo", "Dos argenté", "Banane", "Féroce", "Mains"],
        "OURS": ["Gros", "Forêt", "Poils", "Miel", "Grotte", "Griffes", "Animal", "Marron", "Blanc", "Noir", "Dormir", "Hiver", "Carnivore", "Bête", "Lourd", "Peur", "Puissant", "Peluche", "Sauvage", "Debout"],
        "PANDA": ["Noir", "Blanc", "Chine", "Bambou", "Gros", "Mignon", "Animal", "Ours", "Poils", "Dormir", "Manger", "Forêt", "Asie", "Bête", "Lourd", "Peluche", "Rare", "Sauvage", "Lent", "Zoo"],
        "LION": ["Roi", "Savane", "Crinière", "Rugir", "Félin", "Carnivore", "Animal", "Afrique", "Chasse", "Gros", "Jaune", "Griffes", "Crocs", "Bête", "Puissant", "Peur", "Féroce", "Manger", "Zoo", "Chef"],
        "PANTHÈRE": ["Noir", "Félin", "Jungle", "Arbre", "Chasse", "Tache", "Animal", "Sauvage", "Carnivore", "Gros", "Griffes", "Crocs", "Bête", "Peur", "Féroce", "Vite", "Discret", "Nuit", "Zoo", "Beauté"],
        "ÉLÉPHANT": ["Gros", "Trompe", "Défenses", "Savane", "Gris", "Oreilles", "Animal", "Afrique", "Asie", "Lourd", "Ivoire", "Eau", "Bête", "Puissant", "Mémoire", "Trotter", "Barrir", "Doux", "Zoo", "Jungle"],
        "RHINOCÉROS": ["Corne", "Gros", "Gris", "Savane", "Charge", "Animal", "Afrique", "Lourd", "Cuirasse", "Poils", "Peur", "Bête", "Puissant", "Sauvage", "Zoo", "Herbe", "Courir", "Danger", "Fort", "Terre"],
        "GIRAFE": ["Long", "Cou", "Taches", "Savane", "Arbre", "Haut", "Animal", "Afrique", "Jaune", "Marron", "Feuilles", "Manger", "Grand", "Bête", "Pattes", "Courir", "Zoo", "Herbivore", "Ciel", "Langue"],
        "ZÈBRE": ["Rayures", "Noir", "Blanc", "Savane", "Cheval", "Courir", "Animal", "Afrique", "Herbe", "Troupeau", "Bête", "Lion", "Chasse", "Zoo", "Herbivore", "Pattes", "Vite", "Sabot", "Crinière", "Beauté"],
        "ÉCUREUIL": ["Arbre", "Noisette", "Queue", "Roux", "Sauter", "Forêt", "Animal", "Petit", "Grimper", "Gland", "Cacher", "Hiver", "Poils", "Bête", "Mignon", "Vite", "Parc", "Manger", "Dents", "Rongeur"],
        "LOUTRE": ["Eau", "Rivière", "Mignon", "Nager", "Poils", "Poisson", "Animal", "Petit", "Jouer", "Plonger", "Bête", "Rapide", "Mains", "Casser", "Coquillage", "Fourrure", "Doux", "Nature", "Océan", "Manger"],
        "KANGOUROU": ["Sauter", "Poche", "Australie", "Animal", "Boxe", "Bébé", "Grand", "Pattes", "Queue", "Bête", "Herbivore", "Vite", "Désert", "Roux", "Gros", "Courir", "Bond", "Marsupial", "Zoo", "Nature"],
        "LAPIN": ["Oreilles", "Carotte", "Sauter", "Poils", "Doux", "Terrier", "Animal", "Petit", "Vite", "Bête", "Blanc", "Gris", "Mignon", "Manger", "Herbe", "Chasse", "Pattes", "Rongeur", "Clapier", "Ferme"],
        "HÉRISSON": ["Piquant", "Boule", "Forêt", "Petit", "Animal", "Nuit", "Bête", "Insecte", "Manger", "Jardin", "Peur", "Cacher", "Doux", "Piquer", "Nature", "Marron", "Voiture", "Route", "Lent", "Mignon"],
        "TAUPE": ["Terre", "Creuser", "Aveugle", "Trou", "Jardin", "Griffes", "Animal", "Petit", "Noir", "Poils", "Bête", "Nuit", "Souterrain", "Monticule", "Manger", "Insecte", "Nature", "Cacher", "Vite", "Dents"],
        "TORTUE": ["Carapace", "Lent", "Vert", "Mer", "Terre", "Animal", "Reptile", "Vieux", "Bête", "Cacher", "Nager", "Manger", "Herbe", "Salade", "Gros", "Petit", "Dur", "Œuf", "Sable", "Plage"],
        "LÉZARD": ["Vert", "Mur", "Soleil", "Queue", "Reptile", "Petit", "Animal", "Vite", "Cacher", "Manger", "Insecte", "Bête", "Terre", "Chaud", "Écailles", "Ramper", "Couper", "Gris", "Nature", "Jardin"],
        "SERPENT": ["Reptile", "Ramper", "Venin", "Long", "Langue", "Écailles", "Animal", "Peur", "Mordre", "Piquer", "Danger", "Bête", "Siffler", "Cacher", "Herbe", "Terre", "Manger", "Souris", "Gros", "Petit"],
        "CROCODILE": ["Reptile", "Dents", "Eau", "Carnivore", "Larmes", "Gros", "Animal", "Peur", "Mordre", "Danger", "Bête", "Vert", "Écailles", "Nager", "Ramper", "Afrique", "Marais", "Chasse", "Manger", "Fort"],
        "GÉCKO": ["Reptile", "Mur", "Petit", "Vert", "Insectes", "Maison", "Animal", "Lézard", "Vite", "Pattes", "Coller", "Bête", "Manger", "Nuit", "Lumière", "Plafond", "Chaud", "Tropical", "Réunion", "Mignon"],
        "ARAIGNÉE": ["Pattes", "Toile", "Insecte", "Peur", "Venin", "Mordre", "Animal", "Petit", "Noir", "Poils", "Huit", "Bête", "Maison", "Coin", "Plafond", "Tisser", "Attraper", "Mouche", "Danger", "Mygale"],
        "SCORPION": ["Désert", "Venin", "Pince", "Queue", "Piquer", "Danger", "Animal", "Insecte", "Peur", "Noir", "Jaune", "Chaud", "Sable", "Bête", "Mordre", "Cacher", "Pierre", "Nuit", "Mortel", "Petit"],
        "CAFARD": ["Insecte", "Sale", "Peur", "Noir", "Maison", "Vite", "Animal", "Petit", "Dégoût", "Antennes", "Pattes", "Bête", "Cuisine", "Nuit", "Lumière", "Cacher", "Écraser", "Voler", "Sale", "Poubelle"],
        "MILLES-PATTES": ["Insecte", "Long", "Pattes", "Ramper", "Sol", "Beaucoup", "Animal", "Petit", "Peur", "Dégoût", "Bête", "Maison", "Jardin", "Terre", "Pierre", "Vite", "Rouge", "Noir", "Piquer", "Cacher"],
        "POULET": ["Viande", "Ferme", "Plumes", "Volaille", "Cuisine", "Rôti", "Animal", "Poule", "Manger", "Repas", "Oiseau", "Plat", "Bête", "Blanc", "Ailes", "Cuisses", "Four", "Frites", "Dimanche", "Chaud"],
        "T-REX": ["Dinosaure", "Disparu", "Dents", "Gros", "Carnivore", "Bras", "Animal", "Peur", "Danger", "Bête", "Préhistoire", "Féroce", "Courir", "Rugir", "Vert", "Film", "Musée", "Os", "Squelette", "Géant"],
        "MAMMOUTH": ["Disparu", "Gros", "Poils", "Trompe", "Défenses", "Préhistoire", "Animal", "Éléphant", "Lourd", "Froid", "Glace", "Neige", "Bête", "Os", "Musée", "Squelette", "Géant", "Ancien", "Chasse", "Marron"],

        // 🏥 Lieux & Bâtiments
        "L'ÎLE MAURICE": ["Océan Indien", "Plage", "Voisin", "Dodo", "Vacances", "Soleil", "Mer", "Sable", "Hôtel", "Tourisme", "Avion", "Chaud", "Tropical", "Lagon", "Bleu", "Voyage", "Détente", "Palmier", "Sucre", "Île"],
        "LA RÉUNION": ["Océan Indien", "Volcan", "Montagne", "974", "Île", "Chaleur", "Mer", "Plage", "Rougail", "Dodo", "France", "Tropical", "Randonnée", "Cirque", "Soleil", "Créole", "Voyage", "Vacances", "Avion", "Lagon"],
        "ÎLE RODRIGUE": ["Océan Indien", "Petit", "Voisin", "Maurice", "Calme", "Mer", "Plage", "Sable", "Soleil", "Vacances", "Voyage", "Avion", "Tropical", "Lagon", "Bleu", "Nature", "Tranquille", "Détente", "Poisson", "Île"],
        "SAINT PIERRE": ["Sud", "Réunion", "Ville", "Plage", "Port", "Sudiste", "Mer", "Lagon", "Soleil", "Chaud", "Shopping", "Rue", "Restaurant", "Bar", "Soirée", "Bateau", "Pêche", "Sable", "Océan", "Marché"],
        "SAINTE MARIE": ["Nord", "Réunion", "Aéroport", "Ville", "Centre", "Est", "Avion", "Voyage", "Ciné", "Shopping", "Gillot", "Piste", "Départ", "Arrivée", "Vol", "Ciel", "Bruit", "Bâtiment", "Mer", "Route"],
        "SAINT PAUL": ["Ouest", "Réunion", "Marché", "Ville", "Baie", "Chaud", "Mer", "Plage", "Soleil", "Sable", "Grotte", "Pirate", "Route", "Tourisme", "Achat", "Légume", "Fruit", "Artisanat", "Océan", "Historique"],
        "ETANG SALÉ": ["Sud", "Sable noir", "Plage", "Réunion", "Ville", "Forêt", "Mer", "Océan", "Soleil", "Chaud", "Vague", "Baignade", "Arbre", "Nature", "Route", "Sudiste", "Vacances", "Détente", "Pique-nique", "Glace"],
        "SAINT LOUIS": ["Sud", "Réunion", "Ville", "Usine", "Canne", "Chaud", "Sucre", "Route", "Montagne", "Rivière", "Étang", "Gare", "Centre", "Bâtiment", "Agriculture", "Travail", "Sudiste", "Circulation", "Bruit", "Marché"],
        "SAINT ROSE": ["Est", "Réunion", "Lave", "Volcan", "Ville", "Nature", "Mer", "Océan", "Vague", "Roche", "Noir", "Vert", "Pluie", "Vent", "Église", "Miracle", "Coulée", "Route", "Pont", "Sauvage"],
        "LE PORT": ["Ouest", "Réunion", "Bateaux", "Ville", "Chaud", "Industrie", "Mer", "Océan", "Marchandise", "Conteneur", "Grue", "Travail", "Usine", "Route", "Gros", "Commerce", "Import", "Export", "Dock", "Marin"],
        "SAINT DENIS": ["Nord", "Capitale", "Réunion", "Ville", "Préfecture", "Monde", "Bâtiment", "Rue", "Shopping", "Barachois", "Canon", "Mer", "Montagne", "Circulation", "Bruit", "Bouchon", "Centre", "Historique", "Mairie", "Gros"],
        "SAINT GILLES": ["Ouest", "Plage", "Touristes", "Soleil", "Réunion", "Sable", "Mer", "Lagon", "Bleu", "Vacances", "Détente", "Baignade", "Poisson", "Corail", "Port", "Bateau", "Restaurant", "Soirée", "Chaud", "Blanc"],
        "TOUR EIFFEL": ["Paris", "Fer", "France", "Monument", "Haut", "Dame", "Métal", "Symbole", "Capitale", "Tourisme", "Photo", "Visite", "Monter", "Ascenseur", "Escalier", "Lumière", "Nuit", "Grand", "Pointu", "Architecture"],
        "TOUR DE PISE": ["Italie", "Penché", "Monument", "Blanc", "Vieux", "Haut", "Tour", "Pierre", "Tomber", "Symbole", "Tourisme", "Photo", "Visite", "Architecture", "Europe", "Ville", "Herbe", "Place", "Cloche", "Célèbre"],
        "BURJ KHALIFA": ["Dubaï", "Très haut", "Gratte-ciel", "Monument", "Verre", "Ville", "Tour", "Record", "Ciel", "Ascenseur", "Luxe", "Riche", "Désert", "Moderne", "Architecture", "Pointu", "Argent", "Tourisme", "Vue", "Géant"],
        "EMPIRE STATE BUILDING": ["New York", "Gratte-ciel", "Haut", "USA", "Monument", "King Kong", "Tour", "Ville", "Américain", "Verre", "Acier", "Ciel", "Ascenseur", "Vue", "Tourisme", "Célèbre", "Symbole", "Manhattan", "Vieux", "Grand"],
        "TOUR DE BABEL": ["Légende", "Langues", "Haut", "Ciel", "Dieu", "Construire", "Mythe", "Histoire", "Ancien", "Brique", "Gens", "Parler", "Comprendre", "Punition", "Géant", "Projet", "Fini", "Symbole", "Livre", "Tour"],
        "VILLAGE": ["Campagne", "Mairie", "Petit", "Maison", "Tranquille", "Église", "Boulangerie", "Place", "Gens", "Voisins", "Nature", "Champs", "Agriculture", "Calme", "Loin", "Vieux", "Route", "Arbres", "Fête", "Habitant"],
        "VILLE": ["Bruit", "Bâtiments", "Voitures", "Magasins", "Grand", "Monde", "Gens", "Rue", "Route", "Trottoir", "Pollution", "Travail", "Bouchon", "Lumière", "Nuit", "Mairie", "Centre", "Boutique", "Rapide", "Urbain"],
        "CINÉMA": ["Film", "Écran", "Popcorn", "Fauteuil", "Noir", "Billet", "Regarder", "Sortie", "Amis", "Image", "Son", "Bruit", "Salle", "Affiche", "Acteur", "Réalisateur", "Ticket", "Divertissement", "Grand", "Soirée"],
        "THÉÂTRE": ["Scène", "Acteurs", "Pièce", "Fauteuil", "Rouge", "Public", "Regarder", "Rideau", "Applaudir", "Comédie", "Tragédie", "Billet", "Sortie", "Culture", "Texte", "Direct", "Balcon", "Lumière", "Silence", "Soirée"],
        "AÉROPORT": ["Avion", "Voyage", "Valise", "Passeport", "Vol", "Attente", "Billet", "Guichet", "Sécurité", "Piste", "Départ", "Arrivée", "Ciel", "Hôtesse", "Pilote", "Bruit", "Grand", "Monde", "Vacances", "Porte"],
        "GARE": ["Train", "Voyage", "Quai", "Billet", "Rails", "Attente", "Valise", "Départ", "Arrivée", "Horloge", "Guichet", "Chef", "Sifflet", "Bruit", "Monde", "Ville", "Transport", "Vite", "Retard", "Annonce"],
        "PRISON": ["Barreaux", "Enfermé", "Police", "Cellule", "Garde", "Crime", "Voleur", "Mur", "Loi", "Punition", "Juge", "Tribunal", "Fermé", "Temps", "Liberté", "Danger", "Uniforme", "Menotte", "Cour", "Isolé"],
        "COMMISSARIAT": ["Police", "Plainte", "Bureau", "Agent", "Loi", "Voiture", "Uniforme", "Voleur", "Prison", "Menotte", "Arme", "Enquête", "Interrogatoire", "Ville", "Sécurité", "Urgence", "Téléphone", "Gyrophare", "Sirène", "Garde à vue"],
        "ÉCOLE": ["Enfants", "Apprendre", "Professeur", "Classe", "Cahier", "Récréation", "Tableau", "Craie", "Stylo", "Devoir", "Livre", "Lire", "Écrire", "Maths", "Matin", "Bâtiment", "Cour", "Cartable", "Note", "Ami"],
        "BANQUE": ["Argent", "Carte", "Compte", "Billet", "Guichet", "Coffre", "Payer", "Virement", "Économie", "Riche", "Emprunt", "Dette", "Conseiller", "Sécurité", "Code", "Distributeur", "Chèque", "Monnaie", "Euro", "Voleur"],
        "POSTE": ["Lettre", "Colis", "Timbre", "Facteur", "Courrier", "Boîte", "Envoyer", "Recevoir", "Papier", "Jaune", "Guichet", "Attente", "Facture", "Adresse", "Code", "Carton", "Poids", "Payer", "Facteur", "Camion"],
        "PHARE": ["Mer", "Lumière", "Bateau", "Nuit", "Tour", "Côte", "Océan", "Guider", "Danger", "Rocher", "Haut", "Tourner", "Marin", "Tempête", "Vague", "Blanc", "Rouge", "Rayon", "Isolé", "Sauver"],
        "MOULIN": ["Vent", "Farine", "Ailes", "Blé", "Tourner", "Vieux", "Eau", "Rivière", "Pierre", "Meunier", "Bâtiment", "Pain", "Céréale", "Campagne", "Haut", "Bois", "Mécanisme", "Nature", "Force", "Énergie"],
        "BAR": ["Boire", "Verre", "Soirée", "Amis", "Comptoir", "Alcool", "Bière", "Cocktail", "Musique", "Bruit", "Serveur", "Payer", "Chaise", "Table", "Sortie", "Rencontre", "Fête", "Glace", "Tchin", "Bouteille"],
        "BOÎTE DE NUIT": ["Musique", "Danser", "Soirée", "Nuit", "Amis", "Sombre", "Lumière", "DJ", "Alcool", "Verre", "Bar", "Sortie", "Fête", "Bruit", "Monde", "Chaud", "Vigil", "Payer", "Rencontre", "Bouger"],
        "TROTTOIR": ["Marcher", "Rue", "Pied", "Ville", "Bord", "Piéton", "Route", "Voiture", "Goudron", "Béton", "Gens", "Traverser", "Passage", "Chien", "Lampadaire", "Boutique", "Sécurité", "Ligne", "Étroit", "Gris"],
        "ROUTE": ["Voiture", "Goudron", "Conduire", "Ligne", "Chemin", "Voyage", "Camion", "Vite", "Ville", "Campagne", "Asphalte", "Gris", "Trottoir", "Passage", "Roue", "Moteur", "Bruit", "Circulation", "Bouchon", "Panneau"],
        "RAIL": ["Train", "Métal", "Ligne", "Transport", "Voie", "Gare", "Voyage", "Rouler", "Vite", "Tramway", "Métro", "Fer", "Bois", "Parallèle", "Chemin", "Locomotive", "Wagon", "Direction", "Bruit", "Réseau"],
        "TUNNEL": ["Sombre", "Sous-terre", "Train", "Voiture", "Montagne", "Passage", "Noir", "Lumière", "Bruit", "Écho", "Creuser", "Trou", "Long", "Sortie", "Fermé", "Mur", "Roche", "Métro", "Souterrain", "Danger"],
        "GARAGE": ["Voiture", "Ranger", "Maison", "Outils", "Mécanicien", "Porte", "Réparer", "Huile", "Moteur", "Roue", "Ouvrir", "Fermer", "Bruit", "Sale", "Gris", "Béton", "Vélo", "Carton", "Bricolage", "Espace"],
        "PARKING": ["Voiture", "Garder", "Places", "Bande", "Souterrain", "Goudron", "Garer", "Payer", "Ticket", "Barrière", "Niveau", "Ligne", "Blanc", "Chercher", "Trouver", "Espace", "Magasin", "Ville", "Pied", "Rouler"],
        "MAISON": ["Habiter", "Toit", "Famille", "Porte", "Bâtiment", "Jardin", "Chambre", "Salon", "Cuisine", "Murs", "Fenêtre", "Vivre", "Acheter", "Construire", "Foyer", "Chaud", "Sécurité", "Garage", "Clé", "Adresse"],
        "APPARTEMENT": ["Immeuble", "Habiter", "Ville", "Voisins", "Étage", "Porte", "Louer", "Ascenseur", "Escalier", "Petit", "Balcon", "Chambre", "Salon", "Cuisine", "Clé", "Bruit", "Loyer", "Murs", "Fenêtre", "Adresse"],
        "CHAMBRE": ["Lit", "Dormir", "Maison", "Nuit", "Armoire", "Oreiller", "Couette", "Repos", "Fatigue", "Rêve", "Matin", "Réveil", "Vêtement", "Intime", "Fermé", "Porte", "Sombre", "Pyjama", "Détente", "Pièce"],
        "SALON": ["Canapé", "Télé", "Maison", "Invités", "Détente", "Tapis", "Fauteuil", "Table basse", "Regarder", "Discuter", "Vivre", "Pièce", "Grand", "Lumière", "Soir", "Famille", "Amis", "Repas", "Confort", "Espace"],
        "CUISINE": ["Manger", "Préparer", "Pièce", "Maison", "Cuisinier", "Plats", "Four", "Frigo", "Évier", "Casserole", "Poêle", "Nourriture", "Recette", "Chaud", "Odeur", "Table", "Couverts", "Vaisselle", "Faim", "Repas"],
        "CAVE": ["Sous-sol", "Sombre", "Vin", "Maison", "Froid", "Rangement", "Bouteille", "Descendre", "Escalier", "Terre", "Poussière", "Oublié", "Vieux", "Carton", "Humide", "Noir", "Lumière", "Peur", "Cacher", "Pièce"],
        "GRENIER": ["Toit", "Maison", "Poussière", "Rangement", "Vieux", "Carton", "Monter", "Escalier", "Bois", "Oublié", "Souvenir", "Araignée", "Sombre", "Chaud", "Froid", "Cacher", "Enfant", "Jouet", "Espace", "Haut"],
        "FORÊT": ["Arbres", "Nature", "Bois", "Feuilles", "Promenade", "Animaux", "Vert", "Marron", "Branche", "Oiseau", "Silence", "Perdu", "Champignon", "Ombre", "Sauvage", "Loup", "Chasse", "Bruit", "Terre", "Grand"],
        "JUNGLE": ["Chaud", "Lianes", "Arbres", "Sauvage", "Singe", "Humide", "Vert", "Forêt", "Épais", "Animaux", "Tigre", "Serpent", "Danger", "Aventure", "Perdu", "Tropical", "Pluie", "Soleil", "Bruit", "Nature"],
        "DÉSERT": ["Sable", "Chaud", "Soleil", "Sec", "Chameau", "Vide", "Jaune", "Soif", "Eau", "Oasis", "Mirage", "Dune", "Vent", "Nuit", "Froid", "Perdu", "Scorpion", "Nature", "Grand", "Silence"],
        "SAVANE": ["Chaud", "Herbe", "Lion", "Afrique", "Arbre", "Animaux", "Jaune", "Sec", "Girafe", "Éléphant", "Zèbre", "Chasse", "Soleil", "Vaste", "Nature", "Terre", "Plat", "Safari", "Voyage", "Sauvage"],
        "MONTAGNE": ["Haut", "Neige", "Ski", "Randonnée", "Rocher", "Sommet", "Froid", "Blanc", "Gris", "Grimper", "Nuage", "Ciel", "Air", "Vue", "Nature", "Pente", "Glace", "Alpinisme", "Chalet", "Grand"],
        "COLLINE": ["Herbe", "Monter", "Petit", "Nature", "Pente", "Paysage", "Vert", "Doux", "Marcher", "Vue", "Mouton", "Arbre", "Terre", "Rond", "Campagne", "Descente", "Promenade", "Soleil", "Ciel", "Horizon"],
        "GROTTE": ["Pierre", "Sombre", "Montagne", "Chauve-souris", "Trou", "Nature", "Noir", "Creux", "Froid", "Humide", "Écho", "Ours", "Préhistoire", "Cacher", "Explorer", "Danger", "Profondeur", "Stalactite", "Terre", "Secret"],
        "PISCINE": ["Eau", "Nager", "Maillot", "Plongeon", "Bleu", "Été", "Chaud", "Soleil", "Baignade", "Jeu", "Enfant", "Plongeoir", "Maison", "Jardin", "Public", "Clore", "Mouillé", "Serviette", "Sport", "Détente"],
        "BAIGNOIRE": ["Eau", "Salle de bain", "Laver", "Mousse", "Chaud", "Savon", "Bain", "Détente", "Blanc", "Robinet", "Mouillé", "Serviette", "Propre", "Laver", "Bulle", "Canard", "Corps", "Nu", "Maison", "Siphon"],
        "FONTAINE": ["Eau", "Place", "Ville", "Couler", "Boire", "Statue", "Jet", "Bruit", "Pièce", "Vœu", "Frais", "Monument", "Pierre", "Bassin", "Pigeon", "Été", "Soleil", "Public", "Art", "Décoration"],
        "PUITS": ["Eau", "Trou", "Profondeur", "Seau", "Corde", "Pierre", "Boire", "Frais", "Sombre", "Creuser", "Terre", "Village", "Ancien", "Tirer", "Rond", "Fond", "Nature", "Campagne", "Secret", "Vœu"],
        "TENTE": ["Camping", "Dormir", "Nature", "Toile", "Piquet", "Extérieur", "Nuit", "Forêt", "Montagne", "Sac de couchage", "Froid", "Monter", "Vacances", "Aventure", "Pluie", "Feu", "Amis", "Démonter", "Portable", "Petit"],
        "CABANE": ["Bois", "Arbre", "Enfant", "Construire", "Forêt", "Petit", "Jeu", "Cacher", "Nature", "Maison", "Planches", "Clou", "Marteau", "Jardin", "Secret", "Refuge", "Grimper", "Copain", "Aventure", "Rêve"],

        // 🕰️ Objets du Quotidien
        "LUNETTES": ["Yeux", "Voir", "Verres", "Monture", "Vue", "Soleil", "Mettre", "Nez", "Oreilles", "Lire", "Fatigue", "Correction", "Opticien", "Casser", "Propre", "Plastique", "Métal", "Essuyer", "Vision", "Regarder"],
        "LENTILLES": ["Yeux", "Voir", "Contact", "Mettre", "Vue", "Rond", "Transparent", "Eau", "Opticien", "Correction", "Doigt", "Œil", "Petit", "Perdre", "Invisible", "Vision", "Regarder", "Produit", "Matin", "Soir"],
        "MONTRE": ["Heure", "Poignet", "Aiguilles", "Temps", "Bracelet", "Tic-tac", "Regarder", "Matin", "Soir", "Retard", "Avance", "Pile", "Chiffres", "Cadran", "Bijou", "Cuir", "Métal", "Tic", "Tac", "Minute"],
        "HORLOGE": ["Heure", "Mur", "Aiguilles", "Temps", "Tic-tac", "Rond", "Regarder", "Matin", "Soir", "Retard", "Avance", "Pile", "Chiffres", "Cadran", "Maison", "Gros", "Bruit", "Pendule", "Minute", "Seconde"],
        "VALISE": ["Voyage", "Vêtements", "Roulettes", "Aéroport", "Porter", "Bagage", "Fermer", "Ouvrir", "Lourd", "Poids", "Avion", "Train", "Vacances", "Ranger", "Plier", "Cadenas", "Poignée", "Voyager", "Partir", "Gros"],
        "SAC À DOS": ["Porter", "Épaules", "École", "Affaires", "Randonnée", "Tissu", "Lourd", "Poids", "Marcher", "Voyage", "Bretelles", "Fermeture", "Poche", "Ranger", "Cahier", "Livre", "Gourde", "Dos", "Enfant", "Pratique"],
        "PARAPLUIE": ["Pluie", "Ouvrir", "Eau", "Météo", "Tenir", "Gouttes", "Fermer", "Noir", "Couleur", "Manche", "Vent", "Protéger", "Mouillé", "Dehors", "Nuage", "Ciel", "Automne", "Hiver", "Toile", "Baleine"],
        "PARASOL": ["Soleil", "Ombre", "Plage", "Ouvrir", "Sable", "Chaud", "Fermer", "Couleur", "Manche", "Vent", "Protéger", "Été", "Dehors", "Lumière", "Brûler", "UV", "Toile", "Planter", "Jardin", "Terrasse"],
        "BROSSE": ["Cheveux", "Coiffer", "Poils", "Main", "Dents", "Matin", "Nœuds", "Tête", "Miroir", "Plastique", "Bois", "Toilette", "Beauté", "Brosser", "Long", "Court", "Laver", "Mousse", "Dentifrice", "Propre"],
        "PEIGNE": ["Cheveux", "Coiffer", "Dents", "Plat", "Matin", "Nœuds", "Tête", "Miroir", "Plastique", "Bois", "Toilette", "Beauté", "Peigner", "Lisse", "Couper", "Coiffeur", "Poche", "Homme", "Femme", "Raie"],
        "DÉ": ["Jeu", "Hasard", "Faces", "Chiffres", "Lancer", "Rouler", "Six", "Points", "Table", "Société", "Plateau", "Chance", "Gagner", "Perdre", "Plastique", "Bois", "Petit", "Cube", "Jouer", "Main"],
        "PIÈCE": ["Argent", "Métal", "Rond", "Payer", "Pile", "Face", "Monnaie", "Euro", "Centime", "Lancer", "Hasard", "Chance", "Acheter", "Billet", "Portefeuille", "Poche", "Lourd", "Brillant", "Or", "Argent"],
        "STYLO": ["Écrire", "Encre", "Papier", "Bille", "Main", "Bouchon", "Bleu", "Noir", "Rouge", "Vert", "École", "Bureau", "Cahier", "Mot", "Phrase", "Lettre", "Dessin", "Pointe", "Plastique", "Trousse"],
        "CRAYON": ["Écrire", "Gomme", "Papier", "Bois", "Tailler", "Dessin", "Gris", "Couleur", "Mine", "École", "Trousse", "Main", "Cahier", "Mot", "Esquisse", "Art", "Enfant", "Gommer", "Pointu", "Bout"],
        "FEUTRE": ["Dessin", "Couleur", "Encre", "Papier", "Pointe", "École", "Trousse", "Enfant", "Art", "Colorier", "Bouchon", "Main", "Cahier", "Large", "Fin", "Écrire", "Plastique", "Assécher", "Tache", "Vif"],
        "CRAYON À PAPIER": ["Dessin", "Gris", "Gomme", "Écrire", "Tailler", "Mine", "Bois", "École", "Trousse", "Main", "Cahier", "Mot", "Esquisse", "Art", "Enfant", "Gommer", "Pointu", "Bout", "HB", "Brouillon"],
        "CRITÉRIUM": ["Écrire", "Mine", "Fin", "Crayon", "Plastique", "Bouton", "Pousser", "Gris", "Gomme", "École", "Trousse", "Main", "Cahier", "Mot", "Dessin", "Recharge", "Casser", "Précis", "Architecte", "Maths"],
        "4 COULEUR (STYLO)": ["École", "Écrire", "Bleu", "Rouge", "Vert", "Noir", "Stylo", "Bouton", "Pousser", "Plastique", "Bille", "Encre", "Trousse", "Cahier", "Mot", "Pratique", "Gros", "Main", "Prof", "Élève"],
        "LIVRE": ["Lire", "Pages", "Histoire", "Mots", "Papier", "Couverture", "Roman", "Auteur", "Chapitre", "Bibliothèque", "Imaginer", "Lettres", "Lourd", "Ouvrir", "Fermer", "Marque-page", "Titre", "Fin", "Début", "Cadeau"],
        "CAHIER": ["Écrire", "Pages", "École", "Lignes", "Papier", "Spirale", "Livre", "Leçon", "Stylo", "Crayon", "Mots", "Couverture", "Ouvrir", "Fermer", "Classe", "Prof", "Élève", "Devoir", "Brouillon", "Note"],
        "ENVELOPPE": ["Lettre", "Papier", "Poste", "Timbre", "Fermer", "Envoyer", "Mot", "Adresse", "Écrire", "Coller", "Lécher", "Facteur", "Courrier", "Boîte", "Ouvrir", "Déchirer", "Blanc", "Rectangle", "Secret", "Message"],
        "TIMBRE": ["Poste", "Lettre", "Coller", "Petit", "Enveloppe", "Envoyer", "Carré", "Image", "Payer", "Facteur", "Courrier", "Lécher", "Collection", "Marianne", "Voyage", "Bord", "Dentelé", "Papier", "Adresse", "Destinataire"],
        "LETTRE (COURRIER)": ["Papier", "Poste", "Envoyer", "Mot", "Facteur", "Timbre", "Enveloppe", "Écrire", "Lire", "Adresse", "Boîte", "Recevoir", "Message", "Amour", "Facture", "Ouvrir", "Stylo", "Plier", "Texte", "Nouvelles"],
        "LIT": ["Dormir", "Matelas", "Chambre", "Nuit", "Couette", "Fatigue", "Oreiller", "Drap", "Coucher", "Rêve", "Réveil", "Matin", "Confort", "Doux", "Chaud", "Sommeil", "Maison", "Meuble", "Bois", "Sommier"],
        "MATELAS": ["Dormir", "Lit", "Mousse", "Confort", "Doux", "Coucher", "Chambre", "Nuit", "Ressort", "Épais", "Lourd", "Fatigue", "Repos", "Sommier", "Drap", "Tache", "Tourner", "Maison", "Meuble", "Détente"],
        "FAUTEUIL": ["S'asseoir", "Salon", "Confort", "Canapé", "Repos", "Bras", "Meuble", "Maison", "Télé", "Doux", "Coussin", "Détente", "Lire", "Place", "Tissu", "Cuir", "Lourd", "Vieux", "Grand-père", "Pieds"],
        "PORTE": ["Ouvrir", "Fermer", "Entrer", "Poignée", "Pièce", "Bois", "Clé", "Serrure", "Maison", "Sortir", "Mur", "Passage", "Frapper", "Bruit", "Claquement", "Gond", "Verrou", "Sécurité", "Accueil", "Couloir"],
        "FENÊTRE": ["Verre", "Ouvrir", "Voir", "Lumière", "Mur", "Dehors", "Fermer", "Maison", "Soleil", "Air", "Vue", "Rideau", "Volet", "Casser", "Transparent", "Nettoyer", "Regarder", "Paysage", "Balcon", "Aérer"],
        "CLÉ": ["Serrure", "Ouvrir", "Porte", "Métal", "Maison", "Tourner", "Fermer", "Voiture", "Trousseau", "Perdre", "Trouver", "Cadenas", "Sécurité", "Entrer", "Sortir", "Poche", "Bruit", "Laiton", "Secret", "Coffre"],
        "SERRURE": ["Clé", "Porte", "Fermer", "Sécurité", "Trou", "Ouvrir", "Métal", "Maison", "Verrou", "Tourner", "Bloquer", "Voleur", "Protéger", "Entrer", "Sortir", "Mécanisme", "Cadenas", "Claquement", "Secret", "Coffre"],
        "ASCENSEUR": ["Monter", "Étage", "Bouton", "Immeuble", "Portes", "Machine", "Descendre", "Vite", "Miroir", "Musique", "Attendre", "Peur", "Bloqué", "Câble", "Lourd", "Gens", "Serré", "Cabine", "Haut", "Bas"],
        "ESCALIER": ["Monter", "Descendre", "Marches", "Maison", "Pieds", "Étage", "Rampe", "Fatigue", "Sport", "Immeuble", "Bois", "Pierre", "Tourner", "Haut", "Bas", "Tomber", "Vite", "Lent", "Marcher", "Courir"],
        "ÉLÉVATEUR": ["Monter", "Machine", "Lourd", "Chantier", "Ascenseur", "Étage", "Descendre", "Poids", "Marchandise", "Usine", "Câble", "Plateforme", "Travail", "Bruit", "Lent", "Bouton", "Haut", "Bas", "Ouvrier", "Sécurité"],
        "BOUGIE": ["Feu", "Cire", "Allumer", "Nuit", "Mèche", "Odeur", "Flamme", "Souffler", "Anniversaire", "Gâteau", "Lumière", "Sombre", "Chaud", "Fondre", "Romantique", "Dîner", "Électricité", "Panne", "Brûler", "Fumée"],
        "LAMPE": ["Lumière", "Ampoule", "Bouton", "Éclairer", "Nuit", "Électricité", "Allumer", "Fermer", "Table", "Plafond", "Salon", "Chambre", "Sombre", "Voir", "Lire", "Casser", "Verre", "Chaud", "Lustre", "Chevet"],
        "RÉVEIL": ["Matin", "Bruit", "Heure", "Sonner", "Dormir", "Lit", "Fatigue", "Lundi", "Bouton", "Éteindre", "Horloge", "Temps", "Retard", "Travail", "École", "Nuit", "Aiguilles", "Digital", "Soleil", "Snooze"],
        "FOURCHETTE": ["Manger", "Piquer", "Assiette", "Métal", "Dent", "Couverts", "Repas", "Table", "Couteau", "Main", "Pâtes", "Viande", "Restaurant", "Cuisine", "Laver", "Argent", "Midi", "Soir", "Pointe", "Outil"],
        "CUILLÈRE": ["Manger", "Soupe", "Bouche", "Métal", "Creux", "Couverts", "Repas", "Table", "Dessert", "Café", "Mélanger", "Yaourt", "Cuisine", "Restaurant", "Laver", "Argent", "Main", "Outil", "Liquide", "Doux"],
        "VERRE": ["Boire", "Eau", "Transparent", "Casser", "Table", "Liquide", "Bouche", "Soif", "Repas", "Cuisine", "Vin", "Bière", "Jus", "Laver", "Restaurant", "Mains", "Fragile", "Remplir", "Vider", "Trinquer"],
        "TASSE": ["Boire", "Café", "Thé", "Chaud", "Anse", "Matin", "Mains", "Liquide", "Table", "Cuisine", "Petit-déjeuner", "Soucoupe", "Casser", "Laver", "Porcelaine", "Brûler", "Doux", "Réveil", "Pause", "Verre"],
        "ASSIETTE": ["Manger", "Table", "Plat", "Rond", "Casser", "Nourriture", "Repas", "Cuisine", "Couverts", "Laver", "Restaurant", "Porcelaine", "Blanc", "Creuse", "Plate", "Midi", "Soir", "Servir", "Garnir", "Vider"],
        "BOL": ["Manger", "Soupe", "Céréales", "Matin", "Creux", "Rond", "Lait", "Cuisine", "Table", "Repas", "Petit-déjeuner", "Laver", "Porcelaine", "Casser", "Mains", "Chaud", "Froid", "Cuillère", "Boire", "Remplir"],
        "FOUR": ["Cuisine", "Chaud", "Cuire", "Plat", "Gâteau", "Pizza", "Manger", "Repas", "Viande", "Température", "Brûler", "Porte", "Lumière", "Minuteur", "Gants", "Odeur", "Cuisiner", "Rôtir", "Électricité", "Gaz"],
        "MICRO-ONDE": ["Cuisine", "Réchauffer", "Vite", "Plat", "Chaud", "Tourne", "Manger", "Repas", "Bouton", "Temps", "Minuteur", "Lumière", "Bruit", "Onde", "Assiette", "Rapide", "Froid", "Décongeler", "Porte", "Électricité"],
        "LAVABO": ["Eau", "Salle de bain", "Mains", "Laver", "Robinet", "Matin", "Savon", "Dents", "Brosse", "Miroir", "Propre", "Sale", "Couler", "Bouchon", "Siphon", "Blanc", "Céramique", "Visage", "Toilette", "Écouler"],
        "ÉVIER": ["Cuisine", "Vaisselle", "Eau", "Laver", "Robinet", "Éponge", "Assiette", "Sale", "Propre", "Savon", "Mousse", "Couler", "Bouchon", "Siphon", "Métal", "Plat", "Repas", "Mains", "Frotter", "Écouler"],
        "TUYAU": ["Eau", "Long", "Plombier", "Plastique", "Couler", "Jardin", "Arroser", "Plante", "Laver", "Fuite", "Réparer", "Trou", "Pression", "Flexible", "Enrouler", "Extérieur", "Gaz", "Métal", "Cylindre", "Connecter"],
        "TOILETTE JAPONAISE": ["Eau", "Boutons", "Laver", "Propre", "Technologie", "Chaud", "Toilettes", "Japon", "Siège", "Jet", "Sécher", "Bruit", "Lumière", "Luxe", "Confort", "Bizarre", "Surprise", "Caca", "Pipi", "Nettoyer"],
        "TOILETTE TURC": ["Trou", "Accroupi", "Pieds", "Toilettes", "Vieux", "Difficile", "Sale", "Eau", "Odeur", "Public", "Camping", "Fatigue", "Glissant", "Pipi", "Caca", "Papier", "Chasse", "Ancien", "Pas de siège", "Inconfort"],
        "MARTEAU": ["Clou", "Taper", "Bricolage", "Outil", "Lourd", "Manche", "Bois", "Métal", "Bruit", "Doigt", "Mal", "Construire", "Réparer", "Casser", "Frapper", "Ouvrier", "Chantier", "Mur", "Planche", "Boîte"],
        "TOURNEVIS": ["Vis", "Bricolage", "Tourner", "Outil", "Main", "Métal", "Manche", "Cruciforme", "Plat", "Réparer", "Monter", "Meuble", "Construire", "Serrer", "Desserrer", "Pointe", "Boîte", "Ouvrier", "Électricité", "Petit"],
        "CISEAUX": ["Couper", "Papier", "Outil", "Lames", "Doigts", "Coiffeur", "Cheveux", "Tissu", "École", "Trousse", "Métal", "Plastique", "Tranchant", "Deux", "Ouvrir", "Fermer", "Séparer", "Bricolage", "Couture", "Main"],
        "COUTEAU": ["Couper", "Lame", "Viande", "Cuisine", "Tranchant", "Manche", "Manger", "Repas", "Table", "Couverts", "Assiette", "Métal", "Sang", "Arme", "Cuisinier", "Aiguiser", "Pointe", "Tranche", "Pain", "Beurre"],
        "SCALPEL": ["Médecin", "Couper", "Lame", "Chirurgie", "Hôpital", "Précis", "Tranchant", "Sang", "Opération", "Patient", "Corps", "Peau", "Outil", "Petit", "Métal", "Aiguisé", "Docteur", "Bloc", "Incision", "Ouvrir"],
        "BALAI": ["Nettoyer", "Sol", "Poussière", "Manche", "Poils", "Ménage", "Maison", "Sale", "Propre", "Ramasser", "Pelle", "Sorcière", "Voler", "Frotter", "Bois", "Plastique", "Cuisine", "Cheveux", "Coin", "Outil"],
        "ASPIRATEUR": ["Nettoyer", "Sol", "Bruit", "Poussière", "Machine", "Câble", "Ménage", "Maison", "Sale", "Propre", "Aspirer", "Tapis", "Sac", "Roulettes", "Électricité", "Tuyau", "Moteur", "Poils", "Robot", "Tirer"],
        "LOUPE": ["Grossir", "Verre", "Détail", "Détective", "Œil", "Regarder", "Voir", "Petit", "Insecte", "Livre", "Texte", "Soleil", "Feu", "Lentille", "Manche", "Sherlock", "Enquête", "Chercher", "Trouver", "Outil"],
        "MICROSCOPE": ["Science", "Petit", "Grossir", "Cellule", "Laboratoire", "Lentille", "Voir", "Œil", "Regarder", "Détail", "Bactérie", "Lumière", "Chercheur", "Sang", "Verre", "Machine", "Découverte", "Biologie", "Infiniment", "Outil"],
        "TÉLÉPHONE": ["Appel", "Écran", "Poche", "Message", "Application", "Batterie", "Tactile", "Internet", "Photo", "Vidéo", "Musique", "Jeu", "Amis", "Réseau", "Sonner", "Main", "Chargeur", "Vibreur", "Clavier", "Voix"],
        "TABLETTE": ["Écran", "Tactile", "Internet", "Jeu", "Grand", "Plat", "Film", "Vidéo", "Application", "Batterie", "Doigt", "Lire", "Canapé", "Lit", "Enfant", "Appareil", "Chargeur", "Verre", "Casser", "Main"],
        "ÉCRAN": ["Regarder", "Télé", "Ordinateur", "Image", "Plat", "Allumer", "Éteindre", "Verre", "Lumière", "Couleur", "Tactile", "Film", "Vidéo", "Jeu", "Casser", "Yeux", "Grand", "Petit", "Pixel", "Affichage"],
        "CLAVIER": ["Taper", "Lettres", "Ordinateur", "Boutons", "Écrire", "Touches", "Main", "Doigts", "Internet", "Mot", "Phrase", "Espace", "Entrée", "Bruit", "Plastique", "Écran", "Souris", "Bureau", "Travail", "Jeu"],
        "SOURIS": ["Ordinateur", "Cliquer", "Main", "Écran", "Curseur", "Roulette", "Bouton", "Tapis", "Fil", "Sans fil", "Internet", "Naviguer", "Jeu", "Clic", "Plastique", "Bureau", "Travail", "Bouger", "Animal", "Chat"],
        "MANETTE": ["Jeu", "Console", "Boutons", "Main", "Jouer", "Télé", "Playstation", "Xbox", "Nintendo", "Croix", "Joystick", "Vibrer", "Sans fil", "Batterie", "Écran", "Amis", "Gagner", "Perdre", "Plastique", "Doigts"],
        "CARTE BANCAIRE": ["Payer", "Argent", "Code", "Plastique", "Acheter", "Magasin", "Banque", "Distributeur", "Billet", "Sans contact", "Puce", "Rectangle", "Portefeuille", "Poche", "Internet", "Dépenser", "Riche", "Pauvre", "Secret", "Machine"],
        "CHÈQUE": ["Payer", "Papier", "Signer", "Argent", "Banque", "Stylo", "Écrire", "Montant", "Lettre", "Carnet", "Dépenser", "Acheter", "Vieux", "Magasin", "Nom", "Date", "Déchirer", "Donner", "Recevoir", "Valeur"],
        "KATANA": ["Épée", "Lame", "Japon", "Samouraï", "Couper", "Arme", "Tranchant", "Métal", "Long", "Guerre", "Combat", "Sang", "Ninja", "Fourreau", "Poignée", "Manga", "Anime", "Honneur", "Tuer", "Acier"],
        "BOUCLIER": ["Protéger", "Arme", "Guerre", "Métal", "Défense", "Chevalier", "Épée", "Bois", "Rond", "Lourd", "Combat", "Coup", "Parer", "Bras", "Tenir", "Château", "Soldat", "Bataille", "Sécurité", "Mur"],
        "ÉPÉE": ["Arme", "Lame", "Couper", "Chevalier", "Métal", "Guerre", "Tranchant", "Pointu", "Combat", "Sang", "Bouclier", "Tuer", "Soldat", "Bataille", "Poignée", "Long", "Lourd", "Acier", "Héros", "Château"],
        "GRENADE": ["Explosion", "Arme", "Guerre", "Lancer", "Boum", "Vert", "Goupille", "Bruit", "Mort", "Soldat", "Détruire", "Métal", "Feu", "Danger", "Cacher", "Tirer", "Combat", "Fruit", "Pépin", "Rouge"],
        "MISSILE": ["Explosion", "Voler", "Arme", "Ciel", "Guerre", "Gros", "Fusée", "Feu", "Bruit", "Destruction", "Mort", "Danger", "Avion", "Bateau", "Tirer", "Cible", "Vite", "Lourd", "Métal", "Armée"],
        "MITRAILLEUSE": ["Arme", "Balles", "Tirer", "Vite", "Guerre", "Lourd", "Bruit", "Mort", "Soldat", "Combat", "Destruction", "Feu", "Métal", "Armée", "Danger", "Rafale", "Chargeur", "Viser", "Sang", "Tueur"],
        "PISTOLET": ["Arme", "Tirer", "Balles", "Main", "Police", "Petit", "Bruit", "Mort", "Voleur", "Crime", "Danger", "Métal", "Gâchette", "Viser", "Cible", "Sang", "Guerre", "Combat", "Armée", "Chargeur"],
        "ARC": ["Flèche", "Tirer", "Arme", "Bois", "Corde", "Viser", "Cible", "Tendre", "Chasse", "Indien", "Robin des Bois", "Guerre", "Combat", "Loin", "Précis", "Plume", "Pointe", "Voler", "Silencieux", "Ancien"],
        "FLÈCHE": ["Arc", "Pointe", "Arme", "Voler", "Viser", "Cible", "Plume", "Bois", "Tirer", "Sang", "Mort", "Chasse", "Indien", "Direction", "Panneau", "Ligne", "Air", "Vite", "Précis", "Empennage"],

        // 👨‍⚕️ Métiers & Personnes
        "BÉBÉ": ["Enfant", "Petit", "Pleurer", "Naître", "Lait", "Mignon", "Maman", "Papa", "Couche", "Dormir", "Biberon", "Jouet", "Marcher", "Parler", "Sourire", "Dent", "Poussette", "Berceau", "Vie", "Famille"],
        "VIEUX": ["Âge", "Rides", "Grand-père", "Temps", "Cheveux", "Sagesse", "Canne", "Fatigue", "Mémoire", "Retraite", "Lunettes", "Gris", "Blanc", "Lent", "Malade", "Hôpital", "Famille", "Histoire", "Passé", "Mort"],
        "MAMAN": ["Mère", "Parent", "Enfant", "Amour", "Famille", "Femme", "Bébé", "Fille", "Garçon", "Câlin", "Bisou", "Maison", "Nourrir", "Protéger", "Aider", "Grondée", "Cadeau", "Fête", "Vie", "Naissance"],
        "PAPA": ["Père", "Parent", "Enfant", "Famille", "Homme", "Protecteur", "Maman", "Fille", "Garçon", "Bébé", "Câlin", "Bisou", "Maison", "Travail", "Aider", "Jouer", "Cadeau", "Fête", "Fort", "Voiture"],
        "GRAND-PÈRE": ["Vieux", "Papa", "Famille", "Papy", "Âge", "Cheveux", "Blanc", "Gris", "Canne", "Lunettes", "Histoire", "Cadeau", "Enfant", "Petit-fils", "Retraite", "Jardin", "Doux", "Sagesse", "Temps", "Amour"],
        "GRAND-MÈRE": ["Vieille", "Maman", "Famille", "Mamie", "Âge", "Gâteau", "Cheveux", "Blanc", "Gris", "Tricot", "Lunettes", "Histoire", "Cadeau", "Enfant", "Petit-fils", "Retraite", "Cuisine", "Doux", "Amour", "Temps"],
        "MÉDECIN": ["Hôpital", "Soigner", "Malade", "Docteur", "Santé", "Ordonnance", "Stéthoscope", "Médicament", "Cabinet", "Infirmier", "Guérir", "Examen", "Corps", "Douleur", "Fièvre", "Blouse", "Blanc", "Études", "Urgence", "Sauver"],
        "INFIRMIER": ["Hôpital", "Soins", "Piqûre", "Santé", "Patient", "Aide", "Médecin", "Malade", "Sang", "Pansement", "Blouse", "Blanc", "Nuit", "Urgence", "Guérir", "Douleur", "Seringue", "Doux", "Travail", "Sauver"],
        "CHIRURGIEN": ["Hôpital", "Opérer", "Sang", "Bloc", "Médecin", "Scalpel", "Patient", "Dormir", "Anesthésie", "Couper", "Coudre", "Corps", "Organe", "Urgence", "Sauver", "Gants", "Masque", "Lumière", "Précis", "Vie"],
        "DENTISTE": ["Dents", "Bouche", "Soigner", "Fauteuil", "Fraise", "Douleur", "Brosser", "Blanc", "Carie", "Arracher", "Sang", "Peur", "Lumière", "Médecin", "Santé", "Sourire", "Haleine", "Gencive", "Bruit", "Outil"],
        "POMPIER": ["Feu", "Camion", "Eau", "Sauver", "Sirène", "Urgence", "Rouge", "Caserne", "Échelle", "Tuyau", "Brûler", "Fumée", "Accident", "Voiture", "Hôpital", "Héros", "Courage", "Uniforme", "Casque", "Flamme"],
        "MILITAIRE": ["Armée", "Guerre", "Arme", "Uniforme", "Soldat", "Défense", "Fusil", "Tirer", "Combat", "Pays", "Drapeau", "Ordre", "Chef", "Caserne", "Mission", "Danger", "Mort", "Vert", "Camouflage", "Hélicoptère"],
        "CHAUFFEUR": ["Conduire", "Voiture", "Bus", "Volant", "Passager", "Route", "Camion", "Taxi", "Voyage", "Transport", "Vite", "Trafic", "Bouchon", "Client", "Payer", "Trajet", "Ville", "Permis", "Métier", "Assis"],
        "PILOTE": ["Avion", "Conduire", "Ciel", "Vol", "Hélicoptère", "Aéroport", "Voyage", "Passager", "Uniforme", "Nuage", "Haut", "Vite", "Commandant", "Cabine", "Atterrir", "Décoller", "Piste", "Air", "Voiture", "Course"],
        "AVOCAT": ["Loi", "Tribunal", "Défendre", "Juge", "Justice", "Robe", "Noir", "Client", "Prison", "Coupable", "Innocent", "Parler", "Preuve", "Procès", "Argent", "Métier", "Études", "Légume", "Vert", "Manger"],
        "JUGE": ["Tribunal", "Loi", "Marteau", "Décision", "Justice", "Prison", "Avocat", "Coupable", "Innocent", "Procès", "Punition", "Robe", "Noir", "Pouvoir", "Ordre", "Frapper", "Écouter", "Métier", "Droit", "Amende"],
        "NOTAIRE": ["Maison", "Papier", "Loi", "Héritage", "Vendre", "Signature", "Acheter", "Argent", "Famille", "Mort", "Testament", "Contrat", "Bureau", "Officiel", "Timbre", "Droit", "Métier", "Riche", "Document", "Acte"],
        "HUISSIER": ["Loi", "Argent", "Saisie", "Papier", "Justice", "Dette", "Payer", "Tribunal", "Maison", "Meuble", "Prendre", "Peur", "Problème", "Visite", "Officiel", "Droit", "Métier", "Lettre", "Document", "Rembourser"],
        "ARCHITECTE": ["Plan", "Maison", "Dessin", "Bâtiment", "Construction", "Projet", "Papier", "Crayon", "Règle", "Mesure", "Chantier", "Mur", "Toit", "Ingénieur", "Design", "Idée", "Créer", "Métier", "Ville", "Espace"],
        "MAÇON": ["Mur", "Brique", "Ciment", "Construire", "Chantier", "Maison", "Béton", "Truelle", "Lourd", "Travail", "Dehors", "Poussière", "Bâtiment", "Ouvrier", "Force", "Métier", "Mains", "Pierre", "Monter", "Échafaudage"],
        "PLOMBIER": ["Eau", "Tuyau", "Fuite", "Réparer", "Outil", "Robinet", "Salle de bain", "Cuisine", "Évier", "Toilettes", "Déboucher", "Clé", "Métier", "Maison", "Urgence", "Dégât", "Mario", "Bricolage", "Soudure", "Chauffage"],
        "ÉLECTRICIEN": ["Courant", "Fil", "Lumière", "Réparer", "Prise", "Câble", "Ampoule", "Danger", "Couper", "Électricité", "Maison", "Chantier", "Outil", "Métier", "Bricolage", "Interrupteur", "Disjoncteur", "Panne", "Noir", "Étincelle"],
        "PEINTRE": ["Couleur", "Mur", "Pinceau", "Tableau", "Art", "Toile", "Artiste", "Palette", "Rouleau", "Dessin", "Créer", "Maison", "Chantier", "Tache", "Métier", "Beau", "Exposition", "Musée", "Crayon", "Imagination"],
        "SCULPTEUR": ["Art", "Statue", "Pierre", "Créer", "Taille", "Argile", "Artiste", "Marteau", "Bois", "Musée", "Exposition", "Beau", "Mains", "Outil", "Forme", "3D", "Poussière", "Métier", "Monument", "Modèle"],
        "CHANTEUR": ["Voix", "Musique", "Micro", "Scène", "Concert", "Chanson", "Public", "Artiste", "Album", "Clip", "Célèbre", "Star", "Radio", "Paroles", "Son", "Mélodie", "Applaudir", "Métier", "Groupe", "Tournée"],
        "MUSICIEN": ["Instrument", "Jouer", "Concert", "Notes", "Groupe", "Son", "Musique", "Scène", "Public", "Guitare", "Piano", "Batterie", "Artiste", "Album", "Chanteur", "Mélodie", "Rythme", "Métier", "Orchestre", "Partition"],
        "RÉALISATEUR": ["Film", "Cinéma", "Tournage", "Action", "Caméra", "Chef", "Acteur", "Scénario", "Écran", "Coupez", "Directeur", "Hollywood", "Art", "Métier", "Histoire", "Vidéo", "Image", "Oscar", "Célèbre", "Projet"],
        "PRODUCTEUR": ["Film", "Argent", "Cinéma", "Projet", "Musique", "Financer", "Album", "Artiste", "Réalisateur", "Chef", "Bureau", "Contrat", "Vendre", "Succès", "Riche", "Métier", "Spectacle", "Télé", "Studio", "Idée"],
        "PHOTOGRAPHE": ["Appareil", "Image", "Flash", "Photo", "Prendre", "Objectif", "Artiste", "Souvenir", "Lumière", "Cadre", "Portrait", "Mariage", "Mode", "Journaliste", "Métier", "Clic", "Studio", "Nature", "Modèle", "Couleur"],
        "CAMÉRAMAN": ["Film", "Vidéo", "Épaule", "Tournage", "Image", "Télé", "Caméra", "Journaliste", "Reportage", "Direct", "Réalisateur", "Objectif", "Lourd", "Regarder", "Enregistrer", "Métier", "Scène", "Action", "Lumière", "Écran"],
        "SERVEUR": ["Restaurant", "Plat", "Table", "Client", "Plateau", "Boisson", "Commander", "Manger", "Menu", "Pourboire", "Travail", "Métier", "Bar", "Verre", "Apporter", "Sourire", "Vite", "Cuisine", "Addition", "Informatique"],
        "CUISINIER": ["Restaurant", "Plat", "Cuisine", "Nourriture", "Recette", "Chef", "Préparer", "Manger", "Casserole", "Poêle", "Feu", "Chaud", "Couteau", "Couper", "Goût", "Métier", "Toque", "Tablier", "Étoile", "Service"],
        "BOUCHERE": ["Viande", "Métier", "Couteau", "Vendre", "Sang", "Femme", "Cochon", "Bœuf", "Poulet", "Couper", "Magasin", "Rouge", "Saucisse", "Hacher", "Artisan", "Froid", "Frigo", "Balance", "Client", "Nourriture"],
        "PÂTISSERIE": ["Gâteau", "Sucre", "Boutique", "Dessert", "Manger", "Boulangerie", "Fraise", "Chocolat", "Tarte", "Four", "Cuire", "Gourmand", "Vendre", "Acheter", "Artisan", "Doux", "Fête", "Anniversaire", "Vitrine", "Recette"],
        "BOULANGERE": ["Pain", "Métier", "Vendre", "Baguette", "Matin", "Femme", "Croissant", "Boutique", "Four", "Chaud", "Farine", "Artisan", "Client", "Acheter", "Manger", "Monnaie", "Sourire", "Pâtisserie", "Tôt", "Odeur"],
        "STREAMEUR": ["Twitch", "Live", "Caméra", "Direct", "PC", "Jeu", "Internet", "Vidéo", "Abonnés", "Parler", "Jouer", "Écran", "Micro", "Casque", "Don", "Argent", "Métier", "Chambre", "Chaîne", "Viewer"],
        "YOUTUBEUR": ["Vidéo", "Internet", "Abonnés", "Chaîne", "Montage", "Vlog", "Caméra", "Créateur", "Pouce bleu", "Commentaire", "Vue", "Argent", "Métier", "Célèbre", "Jeune", "Humour", "Jeu", "Studio", "Écran", "Influenceur"],
        "LA PRESSE": ["Journal", "Infos", "Papier", "Lire", "Médias", "Nouvelles", "Article", "Journaliste", "Titre", "Photo", "Matin", "Actualité", "Politique", "Vendre", "Magasin", "Internet", "Imprimer", "Mots", "Vérité", "Mensonge"],
        "LA TÉLÉ": ["Écran", "Regarder", "Chaînes", "Infos", "Émission", "Salon", "Image", "Son", "Film", "Série", "Direct", "Télécommande", "Bouton", "Allumer", "Éteindre", "Maison", "Soirée", "Publicité", "Journal", "Divertissement"],
        "LA DÉSINFORMATION": ["Faux", "Mensonge", "Infos", "Internet", "Tromper", "Cacher", "Vérité", "Médias", "Manipulation", "Complot", "Article", "Croire", "Réseau", "Social", "Danger", "Politique", "Nouvelles", "Titre", "Partager", "Rumeur"],
        "CHÔMEUR": ["Travail", "Maison", "Recherche", "Argent", "Emploi", "Aide", "Pôle", "Entretien", "CV", "Lettre", "Fatigue", "Temps", "Attente", "Difficulté", "Pauvre", "État", "Droit", "Allocation", "Bureau", "Actif"],
        "SDF": ["Rue", "Dehors", "Pauvre", "Froid", "Mendiant", "Argent", "Chien", "Carton", "Dormir", "Maison", "Rien", "Faim", "Manger", "Aide", "Triste", "Hiver", "Tente", "Ville", "Trottoir", "Pièce"],
        "MAIRE": ["Ville", "Mairie", "Élection", "Politique", "Chef", "Écharpe", "Vote", "Citoyen", "Commune", "Décision", "Pouvoir", "Réunion", "Bureau", "Discours", "Écharpe", "Gens", "Problème", "Aider", "Métier", "État"],
        "PRÉSIDENT": ["Pays", "Chef", "Élection", "Politique", "Gouvernement", "Pouvoir", "Vote", "Citoyen", "Loi", "Ministre", "Décision", "Discours", "Télé", "Avion", "Monde", "Guerre", "Paix", "Élysée", "Macron", "État"],
        "SOLITAIRE": ["Seul", "Isolé", "Tranquille", "Unique", "Sans amis", "Calme", "Silence", "Maison", "Livre", "Nature", "Ours", "Loup", "Indépendant", "Triste", "Heureux", "Choix", "Penser", "Personne", "Loin", "Caché"],
        "TIMIDE": ["Discret", "Rougir", "Introverti", "Honte", "Peur", "Parler", "Seul", "Cacher", "Silence", "Gens", "Foule", "Regard", "Baiser", "Voix", "Petit", "Gêné", "Mignon", "Retrait", "Coin", "Sociable"],
        "FEMME": ["Fille", "Dame", "Humain", "Genre", "Mère", "Personne", "Sœur", "Épouse", "Féminin", "Robe", "Cheveux", "Beauté", "Maternité", "Forte", "Droits", "Égalité", "Monde", "Travail", "Voix", "Amour"],
        "HOMME": ["Garçon", "Monsieur", "Humain", "Genre", "Père", "Personne", "Frère", "Époux", "Masculin", "Barbe", "Muscle", "Force", "Travail", "Monde", "Égalité", "Voix", "Amour", "Costume", "Guerre", "Chef"],
        "GAY": ["Homme", "Amour", "Couple", "Sexualité", "Fierté", "LGBT", "Arc-en-ciel", "Drapeau", "Mariage", "Droit", "Différent", "Normal", "Société", "Préjugé", "Fête", "Marche", "Couleur", "Secret", "Assumer", "Bisexuel"],
        "LESBIENNE": ["Femme", "Amour", "Couple", "Sexualité", "Fierté", "LGBT", "Arc-en-ciel", "Drapeau", "Mariage", "Droit", "Différent", "Normal", "Société", "Préjugé", "Fête", "Marche", "Couleur", "Secret", "Assumer", "Bisexuel"],
        "BISEXUEL": ["Amour", "Deux", "Couple", "Sexualité", "Attirance", "LGBT", "Homme", "Femme", "Choix", "Fierté", "Arc-en-ciel", "Drapeau", "Société", "Normal", "Cœur", "Différent", "Assumer", "Secret", "Liberté", "Orientation"],
        "TRANSSEXUEL": ["Genre", "Changement", "Identité", "Transition", "Corps", "LGBT", "Homme", "Femme", "Chirurgie", "Hormones", "Fierté", "Drapeau", "Courage", "Société", "Différent", "Normal", "Nom", "Assumer", "Droit", "Respect"],
        "TRAVESTIS": ["Vêtements", "Spectacle", "Maquillage", "Nuit", "Habit", "Genre", "Homme", "Femme", "Perruque", "Talon", "Robe", "Scène", "Chanter", "Danser", "Fête", "Cabaret", "Drôle", "Artiste", "Show", "Illusion"],
        "DONALD TRUMP": ["Président", "USA", "Blond", "Riche", "Milliardaire", "Politique", "Twitter", "Américain", "Mur", "Mexique", "Cheveux", "Orange", "Élection", "Scandale", "Républicain", "Golf", "Télé", "New York", "Tour", "Casquette"],
        "VLADIMIR POUTINE": ["Président", "Russie", "Guerre", "Chef", "Froid", "Moscou", "Ours", "Dictateur", "Pouvoir", "KGB", "Armée", "Nucléaire", "Espion", "Neige", "Glace", "Politique", "Tsar", "Europe", "Danger", "Fort"],
        "KIM JONG-UN": ["Corée", "Dictateur", "Nord", "Missile", "Chef", "Asie", "Gros", "Coupe", "Guerre", "Armée", "Nucléaire", "Danger", "Fermé", "Pouvoir", "Communiste", "Secret", "Isolé", "Famille", "Sourire", "Peur"],
        "EMMANUELLE MACRON": ["Président", "France", "Politique", "Chef", "Paris", "Élysée", "Jeune", "Gouvernement", "Élection", "Loi", "Discours", "Europe", "Ministre", "Brigitte", "Costume", "Télé", "Vote", "Gilet jaune", "Réforme", "État"],
        "NICOLAS SARKOZY": ["Président", "France", "Politique", "Droite", "Ancien", "Paris", "Carla", "Petit", "Élection", "Élysée", "Justice", "Procès", "Livre", "Télé", "Gouvernement", "UMP", "Chef", "Discours", "Police", "État"],
        "MARINE LEPEN": ["Politique", "France", "Droite", "Élection", "Blonde", "Parti", "Père", "Vote", "Président", "Débat", "Télé", "Discours", "Europe", "Front", "National", "Gouvernement", "Opposition", "Femme", "Affiche", "Colère"],
        "EMMANUEL MACRON": ["Président", "France", "Politique", "Chef", "Paris", "Élysée", "Jeune", "Gouvernement", "Élection", "Loi", "Discours", "Europe", "Ministre", "Brigitte", "Costume", "Télé", "Vote", "Gilet jaune", "Réforme", "État"],
        "ADAM": ["Premier", "Homme", "Pomme", "Bible", "Paradis", "Eve", "Dieu", "Création", "Jardin", "Serpent", "Nu", "Péché", "Arbre", "Terre", "Religion", "Histoire", "Mythe", "Feuille", "Ancien", "Vie"],
        "EVE": ["Première", "Femme", "Pomme", "Bible", "Paradis", "Adam", "Dieu", "Création", "Jardin", "Serpent", "Nu", "Péché", "Arbre", "Tentation", "Religion", "Histoire", "Mythe", "Feuille", "Mère", "Vie"],
        "SAMOURAÏ": ["Japon", "Épée", "Guerrier", "Honneur", "Katana", "Armure", "Combat", "Ninja", "Histoire", "Ancien", "Maître", "Lame", "Sang", "Mort", "Code", "Asie", "Casque", "Tranchant", "Bataille", "Respect"],
        "NINJA": ["Caché", "Noir", "Japon", "Guerrier", "Discret", "Arme", "Épée", "Étoile", "Lancer", "Nuit", "Ombre", "Assassin", "Rapide", "Sauter", "Toit", "Masque", "Secret", "Mission", "Combat", "Samouraï"],

        // 🚀 Transports & Véhicules
        "VOITURE": ["Roues", "Moteur", "Volant", "Conduire", "Route", "Portes", "Vite", "Voyage", "Garage", "Essence", "Permis", "Trafic", "Bouchon", "Famille", "Course", "Frein", "Phare", "Ceinture", "Clé", "Siège"],
        "CAMION": ["Lourd", "Remorque", "Marchandise", "Route", "Gros", "Transport", "Roues", "Moteur", "Conduire", "Vite", "Trafic", "Autoroute", "Chauffeur", "Livraison", "Long", "Bruit", "Diesel", "Péage", "Charger", "Cabine"],
        "VÉLO": ["Pédaler", "Roues", "Guidon", "Selle", "Avancer", "Sport", "Deux", "Route", "Piste", "Casque", "Chute", "Vite", "Fatigue", "Écologique", "Chaîne", "Frein", "Sonnette", "Course", "Montagne", "Enfant"],
        "TROTINETTE": ["Debout", "Roulettes", "Pousser", "Ville", "Électrique", "Avancer", "Pied", "Trottoir", "Vite", "Enfant", "Guidon", "Tomber", "Louer", "Rue", "Petit", "Pliable", "Batterie", "Route", "Frein", "Casque"],
        "MÉTRO": ["Sous-terre", "Ville", "Station", "Transport", "Tunnel", "Rame", "Train", "Ticket", "Rapide", "Monde", "Bruit", "Portes", "Ligne", "Souterrain", "Électricité", "Quai", "Escalator", "Retard", "Travail", "Gens"],
        "BUS": ["Ville", "Transport", "Passagers", "Roues", "Arrêt", "Gros", "Ticket", "Chauffeur", "Portes", "Moteur", "Route", "École", "Long", "Lent", "Bouchon", "Siège", "Debout", "Attendre", "Ligne", "Public"],
        "TRAIN": ["Rails", "Gare", "Wagons", "Voyage", "Vite", "Billet", "Locomotive", "Transport", "Long", "Fenêtre", "Paysage", "Bruit", "Contrôleur", "Bagage", "Électricité", "Quai", "Retard", "TGV", "Passagers", "Départ"],
        "AMBULANCE": ["Hôpital", "Urgence", "Sirène", "Malade", "Santé", "Voiture", "Blanc", "Croix", "Rouge", "Vite", "Route", "Infirmier", "Docteur", "Brancard", "Sauver", "Bruit", "Gyrophare", "Accident", "Transport", "Lit"],
        "CAMION DE POMPIER": ["Feu", "Rouge", "Sirène", "Eau", "Urgence", "Gros", "Échelle", "Tuyau", "Vite", "Route", "Sauver", "Flamme", "Gyrophare", "Bruit", "Caserne", "Accident", "Transport", "Héros", "Lourd", "Pompier"],
        "TRACTEUR": ["Ferme", "Champ", "Gros", "Terre", "Agriculture", "Roues", "Lourd", "Lent", "Moteur", "Bruit", "Paysan", "Vert", "Rouge", "Remorque", "Herbe", "Cultiver", "Campagne", "Conduire", "Machine", "Boue"],
        "PELLETEUSE": ["Chantier", "Creuser", "Terre", "Gros", "Machine", "Travaux", "Trou", "Lourd", "Moteur", "Bruit", "Ouvrier", "Jaune", "Godet", "Pelle", "Construire", "Détruire", "Chenilles", "Roues", "Cabine", "Force"],
        "LAMBORGHINI": ["Voiture", "Vite", "Luxe", "Sport", "Chère", "Italie", "Moteur", "Bruit", "Jaune", "Course", "Riche", "Design", "Aérodynamique", "Portes", "Route", "Rêve", "Puissance", "Rapide", "Roues", "Bas"],
        "FERRARI": ["Rouge", "Voiture", "Vite", "Luxe", "Sport", "Italie", "Moteur", "Bruit", "Cheval", "Course", "Riche", "Design", "Aérodynamique", "Route", "Rêve", "Puissance", "Rapide", "Formule 1", "Roues", "Bas"],
        "TOYOTA": ["Voiture", "Marque", "Japon", "Solide", "Conduire", "Route", "Moteur", "Famille", "Hybride", "Fiable", "Roues", "Vendre", "Monde", "Usine", "Transport", "Trajet", "Garage", "Modèle", "Gris", "Économique"],
        "PEUGEOT": ["Voiture", "France", "Marque", "Lion", "Conduire", "Route", "Moteur", "Famille", "Roues", "Vendre", "Usine", "Transport", "Trajet", "Garage", "Modèle", "Gris", "Citadine", "Paris", "Logo", "Français"],
        "AVION": ["Voler", "Ciel", "Ailes", "Voyage", "Aéroport", "Pilote", "Moteur", "Bruit", "Haut", "Vite", "Passagers", "Valise", "Nuage", "Hôtesse", "Billet", "Piste", "Décoller", "Atterrir", "Lourd", "Air"],
        "HÉLICOPTÈRE": ["Voler", "Hélice", "Ciel", "Bruit", "Pilote", "Air", "Sauter", "Secours", "Police", "Haut", "Tourner", "Moteur", "Rapide", "Montagne", "Atterrir", "Stationnaire", "Cabine", "Léger", "Pales", "Transport"],
        "PARACHUTE": ["Sauter", "Avion", "Ciel", "Tomber", "Toile", "Air", "Voler", "Ouvrir", "Peur", "Vide", "Cordes", "Atterrir", "Danger", "Sport", "Sac", "Secours", "Vent", "Haut", "Doux", "Soldat"],
        "DELTAPLANE": ["Voler", "Ciel", "Ailes", "Air", "Sauter", "Vent", "Toile", "Montagne", "Tomber", "Oiseau", "Pilote", "Vide", "Sport", "Extrême", "Danger", "Léger", "Triangle", "Glisser", "Haut", "Liberté"],
        "HÉLICOPTÈRE DE COMBAT": ["Guerre", "Ciel", "Arme", "Voler", "Missile", "Hélice", "Pilote", "Bruit", "Tirer", "Soldat", "Armée", "Danger", "Air", "Rapide", "Mitrailleuse", "Vert", "Camouflage", "Lourd", "Destruction", "Atterrir"],
        "TANK": ["Guerre", "Lourd", "Tirer", "Armée", "Chenilles", "Blindé", "Canon", "Obus", "Métal", "Soldat", "Bruit", "Destruction", "Avancer", "Lent", "Vert", "Camouflage", "Danger", "Explosion", "Véhicule", "Combat"],
        "YACHT": ["Bateau", "Luxe", "Mer", "Riche", "Moteur", "Vacances", "Gros", "Blanc", "Océan", "Soleil", "Plage", "Fête", "Argent", "Naviguer", "Piscine", "Cabine", "Monaco", "Milliardaire", "Eau", "Voyage"],
        "VOILIER": ["Bateau", "Mer", "Vent", "Toile", "Naviguer", "Eau", "Océan", "Mât", "Corde", "Marin", "Voyage", "Lent", "Silencieux", "Nature", "Course", "Vague", "Bois", "Blanc", "Liberté", "Capitaine"],
        "PÉDALO": ["Eau", "Pédaler", "Lac", "Vacances", "Lent", "Flotter", "Mer", "Plage", "Soleil", "Jeu", "Amis", "Enfant", "Tourisme", "Fatigue", "Jambe", "Bateau", "Plastique", "Toboggan", "Détente", "Été"],
        "CANOË": ["Eau", "Rame", "Rivière", "Bateau", "Naviguer", "Petit", "Pagayer", "Sport", "Nature", "Vague", "Rapide", "Plastique", "Bois", "Deux", "Glisser", "Courant", "Aventure", "Gilet", "Chavirer", "Indien"],
        "BATEAU": ["Mer", "Naviguer", "Eau", "Flotter", "Voyage", "Marin", "Océan", "Vague", "Port", "Moteur", "Voile", "Bois", "Capitaine", "Pêche", "Poisson", "Lourd", "Couler", "Corde", "Ancre", "Transport"],
        "SOUS MARIN": ["Eau", "Océan", "Guerre", "Plonger", "Profond", "Torpille", "Bateau", "Armée", "Métal", "Noir", "Lourd", "Marin", "Respirer", "Secret", "Radar", "Sonar", "Missile", "Pression", "Poisson", "Gros"],
        "TRAMWAY": ["Ville", "Rails", "Transport", "Électrique", "Wagon", "Ligne", "Passagers", "Rue", "Lent", "Cloche", "Arrêt", "Ticket", "Fenêtre", "Câble", "Moderne", "Écologique", "Gens", "Trajet", "Travail", "Rouler"],
        "SKATEBOARD": ["Planche", "Roulettes", "Rouler", "Sauter", "Figures", "Pieds", "Ville", "Jeune", "Sport", "Bois", "Griptape", "Parc", "Rampe", "Tomber", "Équilibre", "Vite", "Bruit", "Rue", "Glisser", "Style"],
        "ROLLER": ["Pieds", "Roulettes", "Patins", "Glisser", "Rouler", "Chaussure", "Ville", "Sport", "Vite", "Équilibre", "Tomber", "Freiner", "Ligne", "Quatre", "Rue", "Jeune", "Promenade", "Avancer", "Parc", "Piste"],
        "OVERBOARD": ["Rouler", "Pieds", "Électrique", "Avancer", "Équilibre", "Jeune", "Planche", "Roues", "Batterie", "Ville", "Tomber", "Vite", "Gyropode", "Mode", "Lumière", "Rue", "Moteur", "Jouet", "Mouvement", "Poids"],
        "FAUTEUIL ROULANT": ["Assis", "Marcher", "Roues", "Aide", "Handicap", "Pousser", "Hôpital", "Malade", "Vieux", "Bras", "Chaise", "Avancer", "Moteur", "Handicapé", "Rampe", "Ascenseur", "Accident", "Jambe", "Fatigue", "Métal"],

        // 🎩 Vêtements & Accessoires
        "CHEMISE": ["Boutons", "Col", "Habit", "Manches", "Chic", "Tissu", "Travail", "Costume", "Repasser", "Cravate", "Poche", "Blanc", "Coton", "Vêtement", "Homme", "Plier", "Ouvrir", "Serrer", "Bureau", "Élégant"],
        "T-SHIRT": ["Vêtement", "Manches", "Habit", "Coton", "Simple", "Haut", "Été", "Léger", "Couleur", "Dessin", "Laver", "Plier", "Sport", "Confort", "Col rond", "Court", "Doux", "Jeune", "Basique", "Logo"],
        "PANTALON": ["Jambes", "Vêtement", "Poches", "Habit", "Tissu", "Bas", "Ceinture", "Bouton", "Fermeture", "Long", "Enfiler", "Plier", "Trou", "Costume", "Jeans", "Couvrir", "Chaud", "Marcher", "Ourlet", "Taille"],
        "JEANS": ["Bleu", "Pantalon", "Toile", "Vêtement", "Poches", "Solide", "Couture", "Bouton", "Fermeture", "Lourd", "Trou", "Mode", "Denim", "Laver", "Serré", "Large", "Bas", "Habit", "Populaire", "Rivets"],
        "ROBE": ["Fille", "Vêtement", "Une pièce", "Tissu", "Soirée", "Été", "Femme", "Mariage", "Jupe", "Long", "Court", "Couleur", "Tourner", "Chic", "Élégant", "Léger", "Fête", "Habit", "Bretelles", "Décolleté"],
        "JUPE": ["Fille", "Jambes", "Vêtement", "Bas", "Tissu", "Tourne", "Femme", "Court", "Long", "Été", "Léger", "Collant", "Ceinture", "Plis", "Habit", "Mode", "Élégant", "Volant", "Jambe", "Froid"],
        "SOUTIEN GORGE": ["Femme", "Sous-vêtement", "Poitrine", "Lingerie", "Attacher", "Haut", "Dentelle", "Bretelles", "Cacher", "Confort", "Taille", "Bonnets", "Agrafe", "Dos", "Invisible", "Vêtement", "Serrer", "Sport", "Doux", "Maintien"],
        "BRASSIÈRE": ["Sport", "Femme", "Poitrine", "Sous-vêtement", "Haut", "Confort", "Élastique", "Courir", "Gym", "Serrer", "Maintien", "Léger", "Tissu", "Respirant", "Vêtement", "Dos", "Enfiler", "Jeune", "Bouger", "Lingerie"],
        "MAILLOT": ["Plage", "Bain", "Eau", "Nager", "Été", "Piscine", "Vêtement", "Soleil", "Mouillé", "Sable", "Vacances", "Court", "Une pièce", "Deux pièces", "Sport", "Foot", "Équipe", "Sécher", "Bronzer", "Léger"],
        "STRING": ["Sous-vêtement", "Fesse", "Petit", "Lingerie", "Culotte", "Fin", "Femme", "Invisible", "Fil", "Dentelle", "Cacher", "Serré", "Vêtement", "Sexy", "Confort", "Bas", "Plage", "Été", "Tissu", "Léger"],
        "CHAPEAU": ["Tête", "Soleil", "Couvrir", "Accessoire", "Bord", "Mettre", "Paille", "Chaud", "Hiver", "Magie", "Élégant", "Enlever", "Protéger", "Vêtement", "Forme", "Tissu", "Vent", "Ombre", "Cacher", "Tête"],
        "CASQUETTE": ["Tête", "Soleil", "Visière", "Accessoire", "Sport", "Mettre", "Jeune", "Protéger", "Ombre", "Logo", "Américain", "Baseball", "Vêtement", "Couvrir", "Régler", "Tissu", "Enlever", "Été", "Style", "Cacher"],
        "BONNET": ["Tête", "Froid", "Hiver", "Laine", "Chaud", "Couvrir", "Oreilles", "Tricot", "Mettre", "Enlever", "Pompon", "Neige", "Ski", "Vêtement", "Accessoire", "Doux", "Serré", "Couleur", "Protéger", "Glace"],
        "CAGOULE": ["Tête", "Visage", "Froid", "Cacher", "Voleur", "Hiver", "Laine", "Chaud", "Trous", "Yeux", "Nez", "Bouche", "Protéger", "Ski", "Neige", "Vêtement", "Accessoire", "Noir", "Peur", "Anonyme"],
        "ÉCHARPE": ["Cou", "Froid", "Hiver", "Chaud", "Laine", "Autour", "Tricot", "Long", "Mettre", "Enlever", "Protéger", "Vent", "Neige", "Vêtement", "Accessoire", "Doux", "Couleur", "Nœud", "Gorge", "Malade"],
        "MANTEAU": ["Froid", "Hiver", "Vêtement", "Chaud", "Dehors", "Veste", "Long", "Boutons", "Fermeture", "Poches", "Lourd", "Protéger", "Pluie", "Neige", "Mettre", "Enlever", "Capuche", "Laine", "Épais", "Couvrir"],
        "CHAUSSETTE": ["Pied", "Chaussure", "Tissu", "Mettre", "Chaud", "Paire", "Orteils", "Laver", "Trou", "Laine", "Coton", "Froid", "Hiver", "Sport", "Vêtement", "Odeur", "Sale", "Propre", "Talon", "Glisser"],
        "COLLANT": ["Jambes", "Fin", "Fille", "Vêtement", "Tissu", "Mettre", "Noir", "Couleur", "Jupe", "Robe", "Serré", "Froid", "Hiver", "Fragile", "Filer", "Trou", "Nylon", "Chaud", "Élastique", "Pied"],
        "GANT": ["Main", "Froid", "Doigts", "Hiver", "Chaud", "Protection", "Mettre", "Enlever", "Laine", "Cuir", "Moto", "Boxe", "Sport", "Neige", "Ski", "Vêtement", "Accessoire", "Paire", "Travail", "Couvrir"],
        "CHAUSSURES": ["Pieds", "Marcher", "Lacets", "Dehors", "Semelle", "Paire", "Cuir", "Tissu", "Mettre", "Enlever", "Talon", "Sport", "Courir", "Vêtement", "Odeur", "Pointure", "Acheter", "Protéger", "Boue", "Baskets"],
        "CEINTURE": ["Taille", "Pantalon", "Attacher", "Cuir", "Boucle", "Serrer", "Tenir", "Trous", "Vêtement", "Accessoire", "Sécurité", "Voiture", "Noir", "Marron", "Mettre", "Enlever", "Régler", "Mode", "Batte", "Poids"],
        "BRETELLE": ["Pantalon", "Épaules", "Tenir", "Élastique", "Vêtement", "Attacher", "Vieux", "Mode", "Tirer", "Lâcher", "Bruit", "Dos", "Bouton", "Pince", "Accessoire", "Serrer", "Soutien-gorge", "Régler", "Croix", "Rouge"],
        "CRAVATE": ["Cou", "Costume", "Nœud", "Chic", "Chemise", "Long", "Travail", "Bureau", "Mariage", "Élégant", "Serrer", "Attacher", "Homme", "Vêtement", "Accessoire", "Soie", "Couleur", "Motif", "Détacher", "Pendu"],
        "NŒUD PAPILLON": ["Cou", "Costume", "Chic", "Chemise", "Soirée", "Attacher", "Mariage", "Élégant", "Homme", "Vêtement", "Accessoire", "Soie", "Noir", "Fête", "Cravate", "Serveur", "Magicien", "Forme", "Petit", "Couleur"],
        "BAGUE": ["Doigt", "Bijou", "Mariage", "Or", "Rond", "Mettre", "Fiançailles", "Argent", "Diamant", "Briller", "Pierre", "Amour", "Couple", "Cadeau", "Cher", "Petit", "Glisser", "Enlever", "Précieux", "Alliance"],
        "BRACELET": ["Poignet", "Bijou", "Bras", "Or", "Accessoire", "Attacher", "Argent", "Montre", "Rond", "Fermoir", "Cadeau", "Mettre", "Enlever", "Perles", "Cuir", "Tissu", "Briller", "Précieux", "Fille", "Décoration"],
        "LUNETTES DE SOLEIL": ["Yeux", "Été", "Noir", "Lumière", "Protéger", "Plage", "Verres", "Monture", "Mettre", "Enlever", "Chaud", "Cacher", "Star", "Vue", "Accessoire", "Plastique", "Rayon", "Éblouir", "Soleil", "Vision"],
        "LUNETTES DE VUE": ["Yeux", "Voir", "Verres", "Correction", "Lire", "Monture", "Opticien", "Fatigue", "Flou", "Net", "Mettre", "Enlever", "Casser", "Propre", "Essuyer", "Accessoire", "Plastique", "Métal", "Vision", "Regarder"],

        // 🧠 Corps Humain & Santé
        "MAIN": ["Doigts", "Prendre", "Bras", "Paume", "Toucher", "Cinq", "Poignet", "Ongle", "Serrer", "Frapper", "Geste", "Saluer", "Tenir", "Droite", "Gauche", "Laver", "Peau", "Ligne", "Bague", "Applaudir"],
        "PIED": ["Orteils", "Marcher", "Jambe", "Chaussure", "Sol", "Talon", "Cheville", "Courir", "Sauter", "Baskets", "Chaussette", "Odeur", "Ongle", "Droit", "Gauche", "Trace", "Laver", "Peau", "Doigt", "Plat"],
        "BRAS": ["Main", "Coude", "Épaule", "Long", "Membre", "Muscle", "Plier", "Tendre", "Porter", "Lourd", "Serrer", "Câlin", "Sang", "Veine", "Poils", "Peau", "Droit", "Gauche", "Casser", "Os"],
        "JAMBE": ["Pied", "Genou", "Marcher", "Long", "Membre", "Pantalon", "Courir", "Sauter", "Cuisse", "Mollet", "Muscle", "Plier", "Tendre", "Poils", "Peau", "Droite", "Gauche", "Casser", "Os", "Debout"],
        "ÉPAULE": ["Bras", "Haut", "Cou", "Porter", "Corps", "Articulation", "Sac", "Lourd", "Large", "Tête", "Dos", "Muscle", "Plier", "Tourner", "Peau", "Os", "Droite", "Gauche", "Manteau", "Tension"],
        "HANCHE": ["Bassin", "Jambe", "Milieu", "Corps", "Os", "Côté", "Tourner", "Danser", "Plier", "Marcher", "Articuler", "Large", "Ventre", "Dos", "Ceinture", "Pantalon", "Peau", "Femme", "Droite", "Gauche"],
        "DOS": ["Derrière", "Colonne", "Mal", "Corps", "Sac", "Coucher", "Dormir", "Massage", "Droit", "Courbé", "Épaule", "Hanche", "Vertèbre", "Os", "Peau", "Poils", "Porter", "Lourd", "Tourner", "Ventre"],
        "VENTRE": ["Estomac", "Nombril", "Devant", "Gros", "Digérer", "Corps", "Manger", "Faim", "Mal", "Plat", "Bruit", "Gargouille", "Graisse", "Peau", "Poils", "Dos", "Respirer", "Bebe", "Bouton", "Ceinture"],
        "GENOU": ["Jambe", "Plier", "Milieu", "Articuler", "Os", "Tomber", "Mal", "Casser", "Marcher", "Courir", "Sauter", "Rotule", "Peau", "Terre", "Prier", "Pantalon", "Trou", "Droit", "Gauche", "Béquille"],
        "COUDE": ["Bras", "Plier", "Milieu", "Articuler", "Table", "Os", "Mal", "Casser", "Main", "Épaule", "Peau", "Pousser", "Taper", "Droit", "Gauche", "Appuyer", "Repos", "Manger", "Plier", "Tendre"],
        "CHEVILLE": ["Pied", "Jambe", "Articuler", "Tourner", "Tordre", "Bas", "Mal", "Entorse", "Os", "Marcher", "Courir", "Sauter", "Chaussette", "Chaussure", "Peau", "Droite", "Gauche", "Gonfler", "Glace", "Talon"],
        "POIGNET": ["Main", "Bras", "Articuler", "Montre", "Tourner", "Os", "Mal", "Casser", "Plier", "Prendre", "Écrire", "Taper", "Peau", "Veine", "Pouls", "Droit", "Gauche", "Bracelet", "Menotte", "Force"],
        "ŒIL": ["Voir", "Regarder", "Visage", "Couleur", "Lunettes", "Cligner", "Larme", "Pleurer", "Ouvert", "Fermé", "Dormir", "Pupille", "Cil", "Sourcil", "Bleu", "Marron", "Vert", "Aveugle", "Lumière", "Noir"],
        "OREILLE": ["Entendre", "Écouter", "Tête", "Bruit", "Son", "Côté", "Musique", "Voix", "Sourd", "Boucher", "Coton", "Percer", "Boucle", "Rouge", "Chaud", "Froid", "Peau", "Cartilage", "Droite", "Gauche"],
        "NEZ": ["Odeur", "Respirer", "Visage", "Milieu", "Sentir", "Éternuer", "Moucher", "Rhume", "Sang", "Casser", "Trou", "Poils", "Air", "Parfum", "Puer", "Rouge", "Long", "Gros", "Lunettes", "Bouche"],
        "BOUCHE": ["Parler", "Manger", "Lèvres", "Dents", "Visage", "Sourire", "Langue", "Goût", "Salive", "Boire", "Ouvrir", "Fermer", "Embrasser", "Crier", "Voix", "Respirer", "Haleine", "Rouge", "Moustache", "Bruit"],
        "DENT": ["Manger", "Bouche", "Blanc", "Mordre", "Sourire", "Dentiste", "Brosser", "Carie", "Mal", "Tomber", "Arracher", "Sang", "Langue", "Lèvre", "Croquer", "Mâcher", "Trou", "Plombage", "Lait", "Sagesse"],
        "LANGUE": ["Bouche", "Goût", "Parler", "Lécher", "Mots", "Rose", "Salive", "Manger", "Boire", "Tirer", "Dents", "Lèvres", "Avaler", "Chaud", "Brûler", "Muscle", "Mordre", "Sang", "Parole", "Bave"],
        "LÈVRE": ["Bouche", "Bisou", "Rose", "Sourire", "Parler", "Rouge", "Dents", "Langue", "Mordre", "Gercé", "Froid", "Hiver", "Baume", "Maquillage", "Embrasser", "Ouvrir", "Fermer", "Moustache", "Visage", "Peau"],
        "CIL": ["Œil", "Poil", "Visage", "Regard", "Petit", "Maquillage", "Mascara", "Noir", "Long", "Tomber", "Vœu", "Cligner", "Protéger", "Poussière", "Larme", "Paupière", "Sourcil", "Beauté", "Faux", "Œil"],
        "SOURCILS": ["Yeux", "Visage", "Poils", "Front", "Expression", "Ligne", "Épiler", "Noir", "Gros", "Froncer", "Colère", "Surprise", "Monter", "Descendre", "Protéger", "Sueur", "Maquillage", "Cil", "Beauté", "Œil"],
        "POUCE": ["Doigt", "Main", "Gros", "Premier", "Bien", "Ongle", "Sucer", "Bébé", "Auto-stop", "Appuyer", "Téléphone", "Écran", "Taper", "Empreinte", "Court", "Articuler", "Droit", "Gauche", "Gant", "Super"],
        "INDEX": ["Doigt", "Montrer", "Main", "Deuxième", "Bouton", "Pointé", "Ongle", "Direction", "Appuyer", "Écran", "Taper", "Clavier", "Empreinte", "Long", "Articuler", "Droit", "Gauche", "Gant", "Livre", "Lire"],
        "MAJEUR": ["Doigt", "Milieu", "Grand", "Main", "Geste", "Insulte", "Ongle", "Long", "Appuyer", "Taper", "Clavier", "Empreinte", "Articuler", "Droit", "Gauche", "Gant", "Troisième", "Coupable", "Malpoli", "Bague"],
        "AURICULAIRE": ["Doigt", "Petit", "Main", "Dernier", "Oreille", "Fin", "Ongle", "Nettoyer", "Taper", "Clavier", "Empreinte", "Court", "Articuler", "Droit", "Gauche", "Gant", "Cinquième", "Bout", "Faible", "Mignon"],
        "ANNULAIRE": ["Doigt", "Bague", "Main", "Mariage", "Avant-dernier", "Bijou", "Ongle", "Or", "Alliance", "Amour", "Quatrième", "Taper", "Clavier", "Empreinte", "Articuler", "Droit", "Gauche", "Gant", "Promesse", "Couple"],
        "CHEVEUX": ["Tête", "Coiffer", "Pousser", "Couper", "Couleur", "Brosse", "Peigne", "Shampoing", "Laver", "Sécher", "Long", "Court", "Bouclé", "Lisse", "Blond", "Brun", "Roux", "Gris", "Tomber", "Chauve"],
        "POILS": ["Corps", "Pousser", "Rasoir", "Bras", "Jambes", "Barbe", "Moustache", "Couper", "Épiler", "Noir", "Blond", "Roux", "Gris", "Animal", "Chien", "Chat", "Chaud", "Protéger", "Peau", "Homme"],
        "BARBE": ["Poils", "Visage", "Rasoir", "Menton", "Homme", "Pousser", "Couper", "Tondre", "Moustache", "Père Noël", "Long", "Court", "Noir", "Blond", "Gris", "Blanc", "Piquer", "Doux", "Gratte", "Hipster"],
        "MOUSTACHE": ["Poils", "Lèvre", "Visage", "Rasoir", "Homme", "Nez", "Bouche", "Couper", "Tondre", "Barbe", "Pousser", "Long", "Court", "Noir", "Gris", "Blanc", "Piquer", "Chat", "Chatouiller", "Mario"],
        "CALVITIE": ["Cheveux", "Perdre", "Tête", "Chauve", "Âge", "Haut", "Front", "Tomber", "Homme", "Vieux", "Génétique", "Complexe", "Chapeau", "Rasoir", "Briller", "Peau", "Lisse", "Rien", "Couronne", "Souci"],
        "CHAUVE": ["Cheveux", "Lisse", "Tête", "Crâne", "Rien", "Coupe", "Rasoir", "Homme", "Calvitie", "Briller", "Peau", "Boule", "Zidane", "Chapeau", "Froid", "Soleil", "Laver", "Âge", "Vieux", "Volontaire"],
        "ONGLE": ["Doigt", "Main", "Couper", "Gratter", "Vernis", "Bout", "Pied", "Pousser", "Casser", "Mordre", "Sale", "Propre", "Rouge", "Couleur", "Lime", "Griffe", "Peau", "Mal", "Long", "Court"],
        "GRIFFE": ["Animal", "Chat", "Gratter", "Ongle", "Pointu", "Pattes", "Ours", "Lion", "Tigre", "Chien", "Oiseau", "Mal", "Sang", "Déchirer", "Arbre", "Marque", "Danger", "Aiguisé", "Couper", "Rayer"],
        "BOUTON": ["Peau", "Visage", "Rouge", "Percer", "Ado", "Tache", "Acné", "Mal", "Sang", "Pus", "Blanc", "Cacher", "Crème", "Corps", "Dos", "Gêner", "Laver", "Sale", "Allergie", "Moustique"],
        "GRAIN DE BEAUTÉ": ["Peau", "Tache", "Noir", "Marron", "Visage", "Petit", "Corps", "Rond", "Soleil", "Protéger", "Docteur", "Surveiller", "Gros", "Poil", "Marque", "Naissance", "Dos", "Bras", "Jambe", "Beauté"],
        "CŒUR": ["Battre", "Sang", "Amour", "Poitrine", "Rouge", "Vie", "Organe", "Pompe", "Veine", "Rythme", "Vite", "Lent", "Maladie", "Crise", "Hôpital", "Dessin", "Sentiment", "Saint-Valentin", "Gros", "Sain"],
        "CERVEAU": ["Tête", "Penser", "Intelligent", "Idée", "Gris", "Mémoire", "Organe", "Crâne", "Réfléchir", "Comprendre", "Oublier", "Maladie", "Hôpital", "Nerf", "Corps", "Contrôle", "Rêve", "Sommeil", "Génie", "Zombies"],
        "SANG": ["Rouge", "Veine", "Cœur", "Couper", "Liquide", "Corps", "Plaie", "Mal", "Hôpital", "Don", "Aiguille", "Vampire", "Globule", "Blanc", "Circuler", "Tache", "Laver", "Peur", "Guerre", "Bataille"],
        "VEINE": ["Sang", "Bleu", "Corps", "Bras", "Circuler", "Peau", "Cœur", "Rouge", "Tuyau", "Couper", "Aiguille", "Hôpital", "Prise", "Gonfler", "Muscle", "Jambe", "Cou", "Organe", "Artère", "Vaisseau"],
        "MUSCLE": ["Force", "Bras", "Sport", "Serrer", "Corps", "Lourd", "Viande", "Gym", "Gonfler", "Douleur", "Courbature", "Entraînement", "Poids", "Jambe", "Ventre", "Dos", "Protéine", "Gros", "Fort", "Tendre"],
        "OS": ["Squelette", "Dur", "Blanc", "Corps", "Casser", "Chien", "Plâtre", "Hôpital", "Radio", "Douleur", "Calcium", "Lait", "Crâne", "Bras", "Jambe", "Côte", "Moelle", "Dinosaure", "Terre", "Fossile"],
        "ESTOMAC": ["Ventre", "Manger", "Digérer", "Nourriture", "Faim", "Mal", "Organe", "Acide", "Gargouille", "Plein", "Vide", "Repas", "Vomir", "Maladie", "Hôpital", "Douleur", "Bruit", "Corps", "Tube", "Intestin"],
        "INTESTIN": ["Ventre", "Digérer", "Long", "Corps", "Nourriture", "Tube", "Organe", "Estomac", "Caca", "Toilettes", "Mal", "Douleur", "Maladie", "Hôpital", "Gargouille", "Gaz", "Péter", "Fin", "Gros", "Manger"],
        "FOIE": ["Organe", "Ventre", "Alcool", "Corps", "Digérer", "Sang", "Maladie", "Hôpital", "Gras", "Gros", "Filtre", "Nettoyer", "Douleur", "Jaune", "Crise", "Chocolat", "Fête", "Oie", "Manger", "Santé"],
        "REIN": ["Organe", "Filtre", "Eau", "Dos", "Corps", "Deux", "Pipi", "Toilettes", "Boire", "Sang", "Maladie", "Hôpital", "Douleur", "Pierre", "Calcul", "Greffe", "Don", "Santé", "Nettoyer", "Liquide"],
        "SQUELETTE": ["Os", "Halloween", "Corps", "Blanc", "Mort", "Crâne", "Peur", "Tombe", "Cimetière", "Terre", "Déterrer", "Dinosaure", "Musée", "Science", "Humain", "Animal", "Anatomie", "Costume", "Monstre", "Casser"],
        "CRÂNE": ["Tête", "Os", "Cerveau", "Squelette", "Halloween", "Dur", "Blanc", "Mort", "Peur", "Danger", "Poison", "Pirate", "Drapeau", "Casser", "Protéger", "Visage", "Yeux", "Dents", "Tombe", "Cimetière"],
        "SALIVE": ["Bouche", "Eau", "Cracher", "Langue", "Liquide", "Manger", "Goût", "Digérer", "Bave", "Chien", "Dormir", "Oreiller", "Mouillé", "Lama", "Malade", "Gorge", "Avaler", "Sécher", "Soif", "Parler"],
        "CELLULE": ["Corps", "Petit", "Sang", "Vivant", "Microscope", "Biologie", "Science", "Organe", "Peau", "Maladie", "Cancer", "Hôpital", "Diviser", "ADN", "Noyau", "Plante", "Animal", "Humain", "Base", "Mur"],
        "LARMES": ["Pleurer", "Yeux", "Triste", "Eau", "Goutte", "Visage", "Joie", "Rire", "Oignon", "Couper", "Salé", "Joues", "Essuyer", "Mouchoir", "Chagrin", "Douleur", "Mal", "Bébé", "Émotion", "Couler"],
        "SUEUR": ["Chaud", "Sport", "Eau", "Transpirer", "Goutte", "Peau", "Été", "Soleil", "Courir", "Effort", "Fatigue", "Odeur", "Aisselle", "Front", "Essuyer", "Mouillé", "T-shirt", "Douche", "Laver", "Peur"],
        "EAU": ["Boire", "Liquide", "Mer", "Transparente", "Vie", "Pluie", "Soif", "Verre", "Bouteille", "Robinet", "Douche", "Laver", "Piscine", "Rivière", "Lac", "Océan", "Glace", "Neige", "Nuage", "Feu"],
        "COMA": ["Dormir", "Hôpital", "Inconscient", "Grave", "Long", "Réveil", "Accident", "Maladie", "Docteur", "Lit", "Machine", "Respirer", "Famille", "Attendre", "Triste", "Mort", "Vie", "Yeux", "Fermé", "Temps"],
        "SOMMEIL": ["Dormir", "Fatigue", "Nuit", "Rêve", "Lit", "Yeux", "Fermé", "Matin", "Réveil", "Heure", "Profond", "Léger", "Insomnie", "Cauchemar", "Ronfler", "Chambre", "Noir", "Silence", "Repos", "Bâiller"],
        "INSOMNIAQUE": ["Nuit", "Dormir", "Fatigue", "Réveillé", "Yeux", "Problème", "Lit", "Tourner", "Heure", "Horloge", "Matin", "Épuisé", "Maladie", "Docteur", "Pilule", "Café", "Stress", "Pensée", "Noir", "Seul"],
        "SOMNAMBULE": ["Dormir", "Marcher", "Nuit", "Inconscient", "Lit", "Yeux", "Ouvert", "Maison", "Danger", "Réveiller", "Peur", "Bizarre", "Rêve", "Action", "Inconnu", "Matin", "Souvenir", "Oublier", "Chambre", "Porte"],
        "TOUX": ["Gorge", "Malade", "Bruit", "Sirop", "Hiver", "Cracher", "Rhume", "Froid", "Docteur", "Poumon", "Respirer", "Fumer", "Cigarette", "Mal", "Douleur", "Nuit", "Déranger", "Bouche", "Main", "Médicament"],
        "ÉTERNUEMENT": ["Nez", "Bruit", "Rhume", "Souhait", "Mouchoir", "Allergie", "Poussière", "Poivre", "Chat", "Malade", "Hiver", "Froid", "Yeux", "Fermer", "Souffle", "Vite", "Goutte", "Microbe", "Main", "Santé"],
        "FIÈVRE": ["Chaud", "Malade", "Thermomètre", "Front", "Température", "Lit", "Transpirer", "Sueur", "Froid", "Frisson", "Docteur", "Médicament", "Hôpital", "Rouge", "Fatigue", "Dormir", "Maladie", "Virus", "Hiver", "Enfant"],
        "FRISSON": ["Froid", "Trembler", "Fièvre", "Peur", "Corps", "Hiver", "Neige", "Glace", "Malade", "Couette", "Manteau", "Chauffage", "Chaud", "Sueur", "Nuit", "Film", "Horreur", "Fantôme", "Surprise", "Émotion"],
        "MÉDICAMENT": ["Malade", "Soigner", "Pilule", "Docteur", "Santé", "Pharmacie", "Ordonnance", "Sirop", "Avaler", "Eau", "Douleur", "Fièvre", "Hôpital", "Boîte", "Chimie", "Drogue", "Effet", "Guérir", "Traitement", "Matin"],
        "VACCIN": ["Piqûre", "Maladie", "Prévenir", "Docteur", "Seringue", "Santé", "Hôpital", "Bras", "Aiguille", "Mal", "Peur", "Enfant", "Bébé", "Virus", "Microbe", "Protéger", "Voyage", "Carnet", "Obligatoire", "Grippe"],
        "SIROP": ["Malade", "Toux", "Boire", "Liquide", "Médicament", "Gorge", "Bouteille", "Cuillère", "Sucré", "Fraise", "Menthe", "Docteur", "Pharmacie", "Enfant", "Guérir", "Douleur", "Hiver", "Rhume", "Collant", "Verre"],
        "PILULE": ["Médicament", "Avaler", "Petit", "Eau", "Malade", "Rond", "Couleur", "Docteur", "Pharmacie", "Boîte", "Blister", "Soigner", "Douleur", "Tête", "Ventre", "Matin", "Soir", "Traitement", "Chimie", "Gélule"],
        "SOURD": ["Oreille", "Entendre", "Bruit", "Signes", "Handicap", "Silence", "Voix", "Parler", "Comprendre", "Appareil", "Maladie", "Naissance", "Vieux", "Âge", "Musique", "Cris", "Sourdine", "Volume", "Lire", "Lèvres"],
        "AVEUGLE": ["Yeux", "Voir", "Noir", "Canne", "Chien", "Handicap", "Lumière", "Couleur", "Braille", "Lire", "Toucher", "Entendre", "Maladie", "Naissance", "Lunettes", "Soleil", "Blanc", "Guider", "Aider", "Rue"],
        "BÉQUILLE": ["Marcher", "Cassé", "Jambe", "Aide", "Bras", "Bois", "Métal", "Hôpital", "Docteur", "Plâtre", "Pied", "Cheville", "Douleur", "Accident", "Tomber", "Sport", "Deux", "Soutenir", "Lent", "Handicap"],
        "ACCOUCHER": ["Bébé", "Naître", "Maman", "Hôpital", "Douleur", "Vie", "Ventre", "Enfant", "Docteur", "Sage-femme", "Pousser", "Crier", "Sang", "Cordon", "Maternité", "Heureux", "Pleurer", "Lait", "Neuf", "Mois"],
        "TUER": ["Mort", "Arme", "Crime", "Fin", "Sang", "Méchant", "Assassin", "Pistolet", "Couteau", "Poison", "Police", "Prison", "Victime", "Cacher", "Corps", "Guerre", "Combat", "Monstre", "Jeu", "Vie"],
        "JUMEAUX": ["Deux", "Pareil", "Bébés", "Frères", "Naître", "Identique", "Sœurs", "Famille", "Maman", "Ventre", "Ressembler", "Confondre", "Habit", "Double", "Clones", "Miroir", "Lien", "Enfants", "Partager", "Faux"],
        "TRIPLET": ["Trois", "Bébés", "Pareil", "Naître", "Famille", "Frères", "Sœurs", "Maman", "Ventre", "Beaucoup", "Identique", "Ressembler", "Confondre", "Rare", "Grossesse", "Enfants", "Double", "Poussette", "Bruit", "Fête"],
        "SIAMOIS (JUMEAUX)": ["Collé", "Deux", "Corps", "Bébés", "Naître", "Frères", "Sœurs", "Maman", "Hôpital", "Opération", "Séparer", "Rare", "Identique", "Vivre", "Ensemble", "Partager", "Organe", "Sang", "Chirurgie", "Lien"],

        // 🌪️ Nature, Éléments & Climat
        "SOLEIL": ["Ciel", "Chaud", "Lumière", "Été", "Jaune", "Éblouir", "Brûler", "Lunettes", "Plage", "Mer", "Bronzer", "Jour", "Matin", "Soir", "Coucher", "Se lever", "Rond", "Feu", "Astre", "Étoile"],
        "LUNE": ["Nuit", "Ciel", "Blanc", "Étoile", "Rond", "Briller", "Lumière", "Sombre", "Loup", "Dormir", "Croissant", "Pleine", "Espace", "Terre", "Astronaute", "Cratère", "Marée", "Mer", "Astre", "Soleil"],
        "ÉTOILE": ["Ciel", "Nuit", "Briller", "Espace", "Petit", "Point", "Lumière", "Soleil", "Lune", "Constellation", "Filante", "Vœu", "Galaxie", "Blanc", "Jaune", "Scintiller", "Télescope", "Astre", "Loin", "Cinq"],
        "PLANÈTE": ["Espace", "Rond", "Terre", "Tourner", "Système", "Astre", "Soleil", "Étoile", "Mars", "Jupiter", "Anneaux", "Lune", "Astronaute", "Fusée", "Galaxie", "Vie", "Gravité", "Ciel", "Loin", "Gros"],
        "ASTÉROÏDE": ["Espace", "Pierre", "Ciel", "Tomber", "Dinosaure", "Planète", "Étoile", "Filante", "Roche", "Gros", "Vite", "Feu", "Cratère", "Terre", "Destruction", "Fin", "Danger", "Orbite", "Ceinture", "Soleil"],
        "CIEL": ["Bleu", "Haut", "Nuage", "Oiseau", "Soleil", "Espace", "Nuit", "Jour", "Étoile", "Lune", "Pluie", "Gris", "Voler", "Avion", "Regarder", "Dieu", "Paradis", "Infini", "Air", "Vent"],
        "ESPACE": ["Étoiles", "Noir", "Infini", "Planète", "Fusée", "Vide", "Astronaute", "Lune", "Soleil", "Terre", "Galaxie", "Vaisseau", "Alien", "Voler", "Zéro", "Gravité", "Ciel", "Loin", "Froid", "Silence"],
        "MER": ["Eau", "Bleu", "Vagues", "Plage", "Sel", "Océan", "Sable", "Nager", "Bateau", "Poisson", "Vacances", "Soleil", "Été", "Chaud", "Froid", "Profondeur", "Côte", "Marée", "Coquillage", "Horizon"],
        "MARS": ["Planète", "Rouge", "Espace", "Système", "Rond", "Voisin", "Terre", "Soleil", "Robot", "Alien", "Mois", "Dieu", "Guerre", "Ciel", "Nuit", "Astre", "Roche", "Poussière", "Glace", "Voyage"],
        "VÉNUS": ["Planète", "Espace", "Système", "Chaud", "Femme", "Rond", "Terre", "Soleil", "Étoile", "Berger", "Briller", "Ciel", "Nuit", "Matin", "Dieu", "Amour", "Beauté", "Nuage", "Gaz", "Astre"],
        "PLUTON": ["Planète", "Espace", "Petit", "Loin", "Froid", "Système", "Soleil", "Naine", "Glace", "Roche", "Noir", "Chien", "Mickey", "Disney", "Dieu", "Enfer", "Astre", "Oublié", "Terre", "Déclassé"],
        "NEPTUNE": ["Planète", "Espace", "Bleu", "Loin", "Dieu", "Système", "Soleil", "Gaz", "Froid", "Vent", "Tempête", "Mer", "Océan", "Trident", "Eau", "Astre", "Géante", "Terre", "Nuit", "Ciel"],
        "URANUS": ["Planète", "Espace", "Bleu", "Loin", "Anneaux", "Système", "Soleil", "Gaz", "Froid", "Couché", "Tourner", "Astre", "Géante", "Terre", "Ciel", "Nuit", "Dieu", "Ciel", "Glace", "Vent"],
        "JUPITER": ["Planète", "Espace", "Gros", "Gaz", "Système", "Rond", "Soleil", "Tache", "Rouge", "Tempête", "Lune", "Gravité", "Astre", "Géante", "Terre", "Dieu", "Foudre", "Roi", "Ciel", "Nuit"],
        "AUBE": ["Matin", "Soleil", "Début", "Jour", "Ciel", "Lumière", "Réveil", "Oiseaux", "Rosée", "Frais", "Couleur", "Rose", "Orange", "Nuit", "Fin", "Tôt", "Dormir", "Ligne", "Horizon", "Naissance"],
        "CRÉPUSCULE": ["Soir", "Soleil", "Fin", "Nuit", "Ciel", "Sombre", "Coucher", "Lumière", "Orange", "Rouge", "Étoile", "Lune", "Dormir", "Tard", "Jour", "Horizon", "Couleur", "Ombre", "Triste", "Romantique"],
        "PLUIE": ["Eau", "Tomber", "Nuage", "Météo", "Mouillé", "Parapluie", "Ciel", "Gris", "Goutte", "Bruit", "Vent", "Tempête", "Froid", "Automne", "Maison", "Abri", "Flaque", "Botte", "Nature", "Pousser"],
        "NEIGE": ["Froid", "Blanc", "Hiver", "Tomber", "Flocon", "Ski", "Météo", "Nuage", "Ciel", "Glace", "Bonhomme", "Boule", "Bataille", "Noël", "Montagne", "Manteau", "Gant", "Glisser", "Eau", "Geler"],
        "VENT": ["Souffler", "Air", "Météo", "Arbre", "Froid", "Bise", "Tempête", "Nuage", "Ciel", "Invisible", "Sentir", "Force", "Pousser", "Cheveux", "Cerf-volant", "Voile", "Bateau", "Moulin", "Ouragan", "Tornade"],
        "TEMPÊTE": ["Vent", "Pluie", "Fort", "Éclair", "Météo", "Danger", "Tonnerre", "Bruit", "Ciel", "Noir", "Nuage", "Ouragan", "Maison", "Cacher", "Peur", "Mer", "Vague", "Bateau", "Dégâts", "Arbre"],
        "NUAGE": ["Ciel", "Blanc", "Pluie", "Météo", "Gris", "Coton", "Soleil", "Cacher", "Vent", "Mouton", "Forme", "Haut", "Eau", "Goutte", "Neige", "Orage", "Voler", "Avion", "Ombre", "Flotter"],
        "BROUILLARD": ["Voir", "Gris", "Matin", "Météo", "Conduire", "Épais", "Nuage", "Bas", "Terre", "Humide", "Froid", "Automne", "Hiver", "Danger", "Voiture", "Phare", "Lumière", "Cacher", "Mystère", "Londres"],
        "INONDATION": ["Eau", "Pluie", "Catastrophe", "Maison", "Trop", "Dégâts", "Rivière", "Déborder", "Mer", "Vague", "Tempête", "Danger", "Noyer", "Sauver", "Bateau", "Pompe", "Boue", "Sale", "Météo", "Climat"],
        "OURAGAN": ["Vent", "Tempête", "Catastrophe", "Pluie", "Dégâts", "Tourner", "Météo", "Fort", "Danger", "Maison", "Détruire", "Arbre", "Ciel", "Noir", "Océan", "Vague", "Nom", "Peur", "Alerte", "Cyclone"],
        "CHAUD": ["Température", "Feu", "Soleil", "Brûler", "Été", "Froid", "Eau", "Météo", "Transpirer", "Sueur", "Rouge", "Four", "Café", "Thé", "Plage", "Désert", "Chauffage", "Douche", "Vêtement", "T-shirt"],
        "FROID": ["Glace", "Neige", "Hiver", "Trembler", "Température", "Geler", "Chaud", "Météo", "Frisson", "Bleu", "Manteau", "Gant", "Bonnet", "Chauffage", "Frigo", "Eau", "Douche", "Maison", "Dehors", "Pôle"],
        "TIÈDE": ["Température", "Chaud", "Froid", "Milieu", "Eau", "Doux", "Bain", "Douche", "Boisson", "Agréable", "Lait", "Météo", "Printemps", "Automne", "Mitigé", "Peau", "Soleil", "Matin", "Soir", "Chauffer"],
        "ARBRE": ["Feuilles", "Bois", "Forêt", "Tronc", "Branches", "Nature", "Plante", "Vert", "Pousser", "Racine", "Terre", "Oiseau", "Nid", "Fruit", "Pomme", "Couper", "Papier", "Ombre", "Soleil", "Saison"],
        "FLEUR": ["Pétale", "Jardin", "Couleur", "Sentir", "Plante", "Rose", "Printemps", "Soleil", "Eau", "Pousser", "Terre", "Abeille", "Miel", "Bouquet", "Cadeau", "Amour", "Vase", "Belle", "Épine", "Tulipe"],
        "FEUILLE": ["Arbre", "Vert", "Automne", "Tomber", "Plante", "Branche", "Papier", "Cahier", "Écrire", "Stylo", "Livre", "Page", "Vent", "Saison", "Jaune", "Rouge", "Marron", "Sec", "Bruit", "Râteau"],
        "BRANCHE": ["Arbre", "Bois", "Bras", "Feuilles", "Oiseau", "Casser", "Forêt", "Nature", "Tronc", "Pousser", "Vent", "Tomber", "Bruit", "Feu", "Bâton", "Chien", "Jouer", "Nid", "Singe", "Grimper"],
        "TRONC": ["Arbre", "Bois", "Milieu", "Écorce", "Gros", "Couper", "Forêt", "Nature", "Racine", "Branche", "Hache", "Scie", "Bûcheron", "Feu", "Cheminée", "Rond", "Dur", "Cabane", "Feuille", "Pousser"],
        "RACINE": ["Arbre", "Terre", "Sous", "Plante", "Base", "Sol", "Pousser", "Eau", "Boire", "Cacher", "Forêt", "Nature", "Tronc", "Cheveux", "Couleur", "Dent", "Nerf", "Famille", "Origine", "Arracher"],
        "ÉCORCE": ["Arbre", "Peau", "Bois", "Tronc", "Rugueux", "Extérieur", "Nature", "Forêt", "Protéger", "Couper", "Arracher", "Marron", "Gris", "Insecte", "Cacher", "Dur", "Sec", "Feu", "Branche", "Racine"],
        "SÈVE": ["Arbre", "Liquide", "Sang", "Colle", "Bois", "Sirop", "Érable", "Sucre", "Pousser", "Nature", "Forêt", "Plante", "Printemps", "Couler", "Tronc", "Branche", "Feuille", "Insecte", "Manger", "Doux"],
        "MOUSSE": ["Vert", "Forêt", "Pierre", "Doux", "Humide", "Arbre", "Nature", "Nord", "Boussole", "Plante", "Sol", "Terre", "Champignon", "Savon", "Bain", "Laver", "Bière", "Verre", "Bulles", "Blanc"],
        "LIERRE": ["Plante", "Grimper", "Mur", "Vert", "Feuille", "Arbre", "Nature", "Maison", "Château", "Vieux", "Couvrir", "Pousser", "Terre", "Racine", "Poison", "Gratte", "Forêt", "Jardin", "Envahir", "Tige"],
        "ROSE": ["Fleur", "Épine", "Rouge", "Amour", "Jardin", "Odeur", "Couleur", "Fille", "Cadeau", "Bouquet", "Saint-Valentin", "Pétale", "Plante", "Terre", "Eau", "Soleil", "Piquer", "Sang", "Beauté", "Romantique"],
        "TULIPE": ["Fleur", "Jardin", "Couleur", "Plante", "Hollande", "Pétale", "Printemps", "Bulbe", "Terre", "Eau", "Soleil", "Bouquet", "Cadeau", "Vase", "Rouge", "Jaune", "Champ", "Nature", "Odeur", "Belle"],
        "SABLE": ["Plage", "Mer", "Jaune", "Chaud", "Château", "Grains", "Désert", "Sec", "Vent", "Œil", "Chaussure", "Pied", "Marcher", "Soleil", "Vacances", "Temps", "Sablier", "Verre", "Construire", "Eau"],
        "TERRE": ["Sol", "Marron", "Plante", "Sale", "Planète", "Boue", "Jardin", "Creuser", "Trou", "Graine", "Pousser", "Nature", "Monde", "Globe", "Bleu", "Rond", "Espace", "Système", "Humain", "Paysan"],
        "ÉROSION": ["Pierre", "Eau", "Vent", "Temps", "Creuser", "Nature", "Montagne", "Mer", "Vague", "Sable", "Terre", "Pluie", "Détruire", "Lent", "Changer", "Paysage", "Falaise", "Rivière", "Glace", "Roche"],
        "VOLCAN": ["Montagne", "Feu", "Lave", "Éruption", "Chaud", "Cratère", "Fumée", "Cendre", "Roche", "Rouge", "Explosion", "Danger", "Réunion", "Île", "Piton", "Dormir", "Réveil", "Magma", "Terre", "Nature"],
        "CRATÈRE": ["Trou", "Volcan", "Lune", "Rond", "Montagne", "Météorite", "Espace", "Terre", "Feu", "Lave", "Éruption", "Gros", "Profondeur", "Roche", "Glace", "Impact", "Chute", "Planète", "Astre", "Ciel"],
        "LAVE": ["Volcan", "Feu", "Chaud", "Rouge", "Roche", "Brûler", "Montagne", "Éruption", "Couler", "Liquide", "Magma", "Terre", "Danger", "Orange", "Noir", "Refroidir", "Pierre", "Île", "Réunion", "Océan"],
        "ÉRUPTION": ["Volcan", "Lave", "Explosion", "Chaud", "Montagne", "Cracher", "Feu", "Fumée", "Cendre", "Danger", "Rouge", "Bruit", "Terre", "Trembler", "Île", "Réunion", "Bouton", "Peau", "Maladie", "Ado"],
        "CUIVRE": ["Métal", "Rouge", "Fil", "Électricité", "Matière", "Tuyau", "Plombier", "Orange", "Lourd", "Chauffer", "Conducteur", "Câble", "Maison", "Construire", "Pièce", "Monnaie", "Musique", "Instrument", "Casserole", "Cuisine"],
        "FER": ["Métal", "Dur", "Gris", "Lourd", "Construire", "Matière", "Aimant", "Rouille", "Rouge", "Sang", "Corps", "Outil", "Marteau", "Clou", "Épée", "Arme", "Train", "Rail", "Tour", "Eiffel"],
        "OR": ["Bijou", "Jaune", "Riche", "Métal", "Valeur", "Lingot", "Cher", "Argent", "Monnaie", "Pièce", "Bague", "Collier", "Mine", "Chercher", "Briller", "Lourd", "Médaille", "Premier", "Gagner", "Champion"],
        "CALCIUM": ["Os", "Lait", "Corps", "Blanc", "Minéral", "Santé", "Dent", "Vache", "Fromage", "Yaourt", "Solide", "Casser", "Manger", "Boire", "Grandir", "Enfant", "Médecin", "Chimie", "Élément", "Nature"],

        // 🎾 Sports & Jeux
        "FOOTBALL": ["Ballon", "Pied", "Terrain", "But", "Onze", "Sport", "Équipe", "Joueur", "Maillot", "Arbitre", "Stade", "Herbe", "Match", "Gagner", "Coupe", "Monde", "Tirer", "Gardien", "Faute", "Carton"],
        "RUGBY": ["Ballon", "Ovale", "Plaquage", "Terrain", "Essai", "Sport", "Équipe", "Joueur", "Maillot", "Arbitre", "Stade", "Herbe", "Match", "Mêlée", "Pousser", "Lourd", "Force", "Tirer", "Pied", "Main"],
        "BASKET": ["Panier", "Ballon", "Rebond", "Orange", "Main", "Sport", "Équipe", "Joueur", "Maillot", "Terrain", "Match", "Sauter", "Grand", "Tirer", "Dribbler", "Filet", "Américain", "Chaussure", "Courir", "Points"],
        "HANDBALL": ["Main", "Ballon", "But", "Terrain", "Sport", "Équipe", "Joueur", "Maillot", "Match", "Tirer", "Sauter", "Gardien", "Filet", "Sept", "Rapide", "Courir", "Lancer", "Attraper", "Arbitre", "Salle"],
        "BASEBALL": ["Batte", "Balle", "Lancer", "Frapper", "Américain", "Sport", "Équipe", "Joueur", "Terrain", "Courir", "Bases", "Attraper", "Gant", "Casquette", "Match", "Stade", "Points", "Blanc", "Rouge", "Bois"],
        "FOOTBALL AMÉRICAIN": ["Casque", "Ballon", "Plaquage", "Ovale", "Sport", "USA", "Équipe", "Joueur", "Terrain", "Match", "Courir", "Lancer", "Attraper", "Force", "Lourd", "Protection", "Épaule", "Super Bowl", "Points", "Ligne"],
        "BASKETBALL": ["Panier", "Ballon", "Rebond", "Orange", "Main", "Sport", "Équipe", "Joueur", "Maillot", "Terrain", "Match", "Sauter", "Grand", "Tirer", "Dribbler", "Filet", "Américain", "Chaussure", "Courir", "Points"],
        "TENNIS": ["Raquette", "Balle", "Filet", "Jaune", "Court", "Sport", "Joueur", "Match", "Taper", "Rebond", "Ligne", "Blanc", "Terre battue", "Gazon", "Roland Garros", "Service", "Point", "Deux", "Quatre", "Courir"],
        "PING-PONG": ["Table", "Raquette", "Petit", "Balle", "Filet", "Sport", "Joueur", "Match", "Taper", "Rebond", "Léger", "Rapide", "Bois", "Plastique", "Blanc", "Orange", "Chine", "Service", "Point", "Deux"],
        "BADMINTON": ["Raquette", "Volant", "Filet", "Sport", "Plumes", "Léger", "Joueur", "Match", "Taper", "Rapide", "Terrain", "Sauter", "Point", "Deux", "Quatre", "En l'air", "Tirer", "Smash", "Court", "Cordage"],
        "SQUASH": ["Raquette", "Mur", "Balle", "Taper", "Fermé", "Sport", "Joueur", "Match", "Rebond", "Petit", "Noir", "Rapide", "Fatigue", "Courir", "Deux", "Point", "Salle", "Vitre", "Transpirer", "Cordage"],
        "NATATION": ["Eau", "Piscine", "Nager", "Sport", "Maillot", "Plongeon", "Ligne", "Bassin", "Chrono", "Vite", "Bras", "Jambe", "Respirer", "Couloir", "Lunettes", "Bonnet", "Crawl", "Brasse", "Papillon", "Dos"],
        "PLONGEON": ["Eau", "Piscine", "Sauter", "Haut", "Sport", "Tête", "Planche", "Voler", "Figure", "Tourner", "Tomber", "Bassin", "Maillot", "Chrono", "Points", "Juge", "Vide", "Peur", "Courage", "Profond"],
        "VOLLEYBALL": ["Filet", "Ballon", "Main", "Plage", "Sauter", "Sport", "Équipe", "Joueur", "Match", "Taper", "Passe", "Smash", "Sable", "Salle", "Six", "Deux", "Point", "Terrain", "Ligne", "Plongeon"],
        "WATER-POLO": ["Eau", "Piscine", "Ballon", "But", "Main", "Sport", "Équipe", "Joueur", "Match", "Nager", "Tirer", "Gardien", "Filet", "Lourd", "Fatigue", "Couler", "Maillot", "Bonnet", "Points", "Arbitre"],
        "VOILE": ["Bateau", "Vent", "Mer", "Naviguer", "Toile", "Eau", "Sport", "Course", "Marin", "Océan", "Vague", "Mât", "Corde", "Tirer", "Vite", "Équipe", "Seul", "Soleil", "Pluie", "Capitaine"],
        "AVIRON": ["Bateau", "Ramer", "Eau", "Sport", "Équipe", "Rivière", "Lac", "Rame", "Tirer", "Bras", "Dos", "Vite", "Course", "Chrono", "Ligne", "Assis", "Reculons", "Synchronisé", "Effort", "Fatigue"],
        "SURF": ["Vague", "Mer", "Planche", "Glisser", "Eau", "Plage", "Sport", "Soleil", "Océan", "Debout", "Équilibre", "Tomber", "Nager", "Ramer", "Combinaison", "Froid", "Chaud", "Requin", "Tube", "Cool"],
        "KITESURF": ["Vague", "Mer", "Voile", "Vent", "Planche", "Sauter", "Sport", "Eau", "Glisser", "Voler", "Ciel", "Corde", "Harnais", "Vite", "Figure", "Danger", "Plage", "Océan", "Air", "Équilibre"],
        "BOXE": ["Gants", "Frapper", "Ring", "Combat", "Sport", "Visage", "Corps", "Taper", "Poing", "K.O.", "Arbitre", "Rounds", "Cordes", "Sang", "Mal", "Esquiver", "Gagner", "Perdre", "Champion", "Ceinture"],
        "CATCH": ["Ring", "Spectacle", "Combat", "Faux", "Sauter", "Sport", "Taper", "Cordes", "Gros", "Muscle", "Costume", "Masque", "Public", "Crier", "Prise", "Tomber", "Mal", "Arbitre", "Gagner", "Télé"],
        "ESCRIME": ["Épée", "Toucher", "Masque", "Combat", "Sport", "Arme", "Blanc", "Tenue", "Fil", "Lumière", "Point", "Avancer", "Reculer", "Vite", "Précis", "Arbitre", "Piste", "Fleuret", "Sabre", "Gagner"],
        "LUTTE": ["Combat", "Tapis", "Attraper", "Corps", "Sport", "Sol", "Taper", "Pousser", "Lourd", "Muscle", "Force", "Prise", "Tomber", "Arbitre", "Points", "Gagner", "Perdre", "Cercle", "Antique", "Jeux Olympiques"],
        "DANSE": ["Musique", "Bouger", "Rythme", "Corps", "Art", "Pas", "Sport", "Spectacle", "Scène", "Couple", "Seul", "Groupe", "Classique", "Moderne", "Hip-hop", "Sauter", "Tourner", "Transpirer", "Joie", "Fête"],
        "GYMNASTIQUE": ["Souple", "Tapis", "Saut", "Corps", "Sport", "Barre", "Poutre", "Anneaux", "Figure", "Tourner", "Air", "Équilibre", "Force", "Muscle", "Points", "Juge", "Fille", "Garçon", "Jeux Olympiques", "Médaille"],
        "SKI": ["Neige", "Montagne", "Glisser", "Hiver", "Bâtons", "Sport", "Froid", "Blanc", "Piste", "Remontée", "Descendre", "Vite", "Tomber", "Chaussure", "Lourd", "Soleil", "Vacances", "Slalom", "Saut", "Manteau"],
        "SNOWBOARD": ["Neige", "Montagne", "Planche", "Glisser", "Hiver", "Sport", "Froid", "Blanc", "Piste", "Descendre", "Vite", "Tomber", "Sauter", "Figure", "Deux pieds", "Profil", "Jeune", "Vacances", "Soleil", "Manteau"],
        "PATINAGE": ["Glace", "Glisser", "Chaussure", "Lame", "Froid", "Hiver", "Sport", "Patinoire", "Tourner", "Sauter", "Figure", "Danse", "Musique", "Couple", "Seul", "Vite", "Tomber", "Dur", "Blanc", "Fête"],
        "HOCKEY": ["Glace", "Crosse", "Palet", "Patins", "But", "Sport", "Équipe", "Joueur", "Match", "Froid", "Patinoire", "Vite", "Taper", "Mur", "Bagarre", "Casque", "Protection", "Lourd", "Gardien", "Arbitre"],
        "MARATHON": ["Courir", "Long", "Course", "Distance", "Fatigue", "Sport", "Pieds", "Chaussure", "Route", "Ville", "Gens", "Monde", "Chrono", "Eau", "Boire", "Sueur", "Médaille", "Arrivée", "Départ", "Lent"],
        "SPRINT": ["Courir", "Vite", "Court", "Course", "Cent mètres", "Sport", "Pieds", "Chaussure", "Piste", "Ligne", "Chrono", "Record", "Bolt", "Départ", "Arrivée", "Explosion", "Muscle", "Fatigue", "Essoufflé", "Gagner"],
        "SAUT EN HAUTEUR": ["Sauter", "Barre", "Tapis", "Courir", "Athlétisme", "Dos", "Sport", "Haut", "Tomber", "Mou", "Points", "Record", "Juge", "Stade", "Piste", "Élan", "Air", "Toucher", "Casser", "Gagner"],
        "SAUT À LA PERCHE": ["Sauter", "Barre", "Haut", "Bâton", "Athlétisme", "Voler", "Sport", "Courir", "Élan", "Tapis", "Tomber", "Mou", "Points", "Record", "Juge", "Stade", "Piste", "Air", "Flexible", "Gagner"],
        "PARACHUTISME": ["Sauter", "Avion", "Ciel", "Voler", "Toile", "Vide", "Sport", "Extrême", "Air", "Tomber", "Vite", "Ouvrir", "Corde", "Atterrir", "Sol", "Peur", "Courage", "Paysage", "Haut", "Nuage"],
        "SAUT À L'ÉLASTIQUE": ["Sauter", "Vide", "Corde", "Pont", "Peur", "Rebond", "Sport", "Extrême", "Air", "Tomber", "Vite", "Tête", "Bas", "Pieds", "Attacher", "Courage", "Crier", "Eau", "Rivière", "Haut"],
        "PÉTANQUE": ["Boules", "Fer", "Cochonnet", "Tirer", "Pointer", "Sud", "Sport", "Jeu", "Amis", "Soleil", "Terre", "Sable", "Cercle", "Lancer", "Lourd", "Bruit", "Mesurer", "Pastis", "Apéro", "Marseille"],
        "BOWLING": ["Boule", "Lancer", "Quilles", "Lourd", "Piste", "Strike", "Sport", "Jeu", "Amis", "Salle", "Chaussure", "Trou", "Doigts", "Rouler", "Bruit", "Tomber", "Gagner", "Points", "Écran", "Soirée"],
        "BILLARD": ["Table", "Boules", "Queue", "Tapis", "Trou", "Taper", "Sport", "Jeu", "Amis", "Bar", "Vert", "Craie", "Blanc", "Noir", "Couleur", "Numéro", "Viser", "Rouler", "Bruit", "Soirée"],
        "FLIPPER": ["Machine", "Bille", "Bouton", "Taper", "Jeu", "Lumière", "Bar", "Bruit", "Musique", "Score", "Points", "Perdre", "Trou", "Ressort", "Vite", "Reflexe", "Argent", "Pièce", "Vieux", "Amis"],
        "BABY FOOT": ["Jeu", "Bar", "Ballon", "Tourner", "Table", "Amis", "Bois", "Plastique", "Bonhomme", "Rouge", "Bleu", "But", "Bruit", "Taper", "Poignée", "Vite", "Reflexe", "Argent", "Pièce", "Soirée"],
        "FLÉCHETTES": ["Cible", "Lancer", "Pointe", "Viser", "Bar", "Mur", "Jeu", "Amis", "Plume", "Trou", "Points", "Centre", "Rouge", "Vert", "Noir", "Blanc", "Calculer", "Score", "Soirée", "Précis"],
        "TIR À L'ARC": ["Flèche", "Cible", "Viser", "Corde", "Tirer", "Arme", "Sport", "Bois", "Pointe", "Plume", "Centre", "Points", "Concentration", "Calme", "Loin", "Air", "Voler", "Robin des Bois", "Jeux Olympiques", "Outil"],
        "KARTING": ["Voiture", "Petit", "Piste", "Conduire", "Course", "Vite", "Sport", "Jeu", "Amis", "Casque", "Volant", "Pédale", "Frein", "Accélérer", "Moteur", "Bruit", "Odeur", "Essence", "Tourner", "Gagner"],
        "QUAD": ["Roues", "Moteur", "Terre", "Conduire", "Casque", "Quatre", "Sport", "Véhicule", "Nature", "Forêt", "Boue", "Sable", "Bruit", "Vite", "Guidon", "Accélérer", "Frein", "Sale", "Amis", "Promenade"],
        "JEUX VIDÉO": ["Console", "Manette", "Écran", "Jouer", "Virtuel", "PC", "Internet", "Amis", "Gagner", "Perdre", "Points", "Niveau", "Boss", "Mario", "Fortnite", "Télé", "Clavier", "Souris", "Casque", "Amusement"],
        "JEUX DE SOCIÉTÉ": ["Plateau", "Dés", "Cartes", "Amis", "Table", "Jouer", "Famille", "Règles", "Gagner", "Perdre", "Pions", "Boîte", "Réfléchir", "Chance", "Hasard", "Soirée", "Amusement", "Monopoly", "Uno", "Carton"],
        "POKER": ["Cartes", "Argent", "Bluff", "Mise", "Jeu", "Jetons", "Table", "Amis", "Casino", "Gagner", "Perdre", "Chance", "Hasard", "Cacher", "Visage", "Tapis", "As", "Roi", "Paire", "Soirée"],
        "TAROT": ["Cartes", "Jeu", "Atout", "Excuse", "Poignée", "Table", "Amis", "Famille", "Soirée", "Points", "Compter", "Gagner", "Perdre", "Chien", "Prendre", "Passer", "Roi", "Dame", "Cavalier", "Valet"],
        "MONOPOLY": ["Jeu", "Argent", "Acheter", "Maison", "Dés", "Prison", "Plateau", "Amis", "Famille", "Soirée", "Riche", "Pauvre", "Payer", "Loyer", "Hôtel", "Gare", "Cartes", "Chance", "Caisse", "Long"],
        "SCRABBLE": ["Jeu", "Lettres", "Mots", "Plateau", "Points", "Dictionnaire", "Amis", "Famille", "Soirée", "Réfléchir", "Alphabet", "Pioche", "Chevalet", "Gagner", "Perdre", "Compter", "Double", "Triple", "Mot compte double", "Vieux"],
        "CACHE-CACHE": ["Trouver", "Chercher", "Compter", "Jeu", "Enfant", "Cacher", "Amis", "Cour", "Maison", "Mur", "Yeux", "Fermés", "Ouverts", "Trouvé", "Perdu", "Courir", "Peur", "Silence", "Bruit", "Amusement"],
        "LOUP-GLACÉ": ["Courir", "Toucher", "Geler", "Jeu", "Enfant", "Bouger", "Amis", "Cour", "École", "Dégeler", "Sauver", "Glace", "Statue", "Vite", "Attraper", "Fuir", "Rire", "Fatigue", "Sueur", "Amusement"],
        "ÉCHECS": ["Plateau", "Pièces", "Roi", "Réfléchir", "Jeu", "Noir et Blanc", "Reine", "Fou", "Cavalier", "Tour", "Pion", "Manger", "Mat", "Échec", "Gagner", "Perdre", "Intelligent", "Temps", "Horloge", "Stratégie"],
        "DAMES": ["Plateau", "Pions", "Manger", "Jeu", "Noir et Blanc", "Diagonale", "Sauter", "Pion", "Dame", "Couronne", "Gagner", "Perdre", "Réfléchir", "Stratégie", "Amis", "Table", "Bois", "Plastique", "Vieux", "Simple"],
        "DAME (ÉCHEC)": ["Jeu", "Pièce", "Forte", "Plateau", "Bouger", "Reine", "Échecs", "Manger", "Loin", "Droite", "Diagonale", "Protéger", "Roi", "Noir", "Blanc", "Bois", "Gagner", "Perdre", "Stratégie", "Puissante"],
        "ROI (ÉCHEC)": ["Jeu", "Pièce", "Protéger", "Plateau", "Perdre", "Chef", "Échecs", "Mat", "Mouvement", "Lent", "Croix", "Couronne", "Noir", "Blanc", "Bois", "Gagner", "Fin", "Important", "Faible", "Cacher"],
        "PION (ÉCHEC)": ["Jeu", "Pièce", "Petit", "Plateau", "Avancer", "Beaucoup", "Échecs", "Manger", "Diagonale", "Premier", "Sacrifier", "Dame", "Transformer", "Noir", "Blanc", "Bois", "Faible", "Mur", "Ligne", "Début"],
        "CAVALIER (ÉCHEC)": ["Jeu", "Cheval", "Pièce", "Sauter", "Plateau", "L", "Échecs", "Manger", "Bizarre", "Surprise", "Noir", "Blanc", "Bois", "Animal", "Mouvement", "Stratégie", "Attaque", "Défense", "Avancer", "Reculer"],
        "FOU (ÉCHEC)": ["Jeu", "Pièce", "Diagonale", "Plateau", "Loin", "Bouger", "Échecs", "Manger", "Couleur", "Noir", "Blanc", "Bois", "Rapide", "Attaque", "Défense", "Stratégie", "Fente", "Chapeau", "Avancer", "Reculer"],
        "CODENAMES (JEU)": ["Mots", "Équipe", "Espion", "Deviner", "Cartes", "Plateau", "Jeu", "Amis", "Soirée", "Indice", "Chef", "Couleur", "Rouge", "Bleu", "Gris", "Noir", "Assassin", "Toucher", "Réfléchir", "Association"],
        "GARTIC PHONE (JEU)": ["Dessin", "Internet", "Amis", "Drôle", "Deviner", "Téléphone", "Jeu", "PC", "Souris", "Mots", "Phrase", "Bizarre", "Rire", "Temps", "Vite", "Couleur", "Pinceau", "Gomme", "Tour", "Écran"],

        // 💻 Technologie & Pop Culture
        "ORDINATEUR": ["Écran", "Clavier", "Souris", "Internet", "Machine", "Taper", "Travailler", "Jouer", "PC", "Portable", "Bureau", "Électricité", "Batterie", "Allumer", "Éteindre", "Informatique", "Web", "Logiciel", "Mémoire", "Câble"],
        "SERVEUR": ["Internet", "Données", "Machine", "Réseau", "Stocker", "Informatique", "Gros", "Bruit", "Chaud", "Ventilateur", "Câble", "Connecter", "Site", "Web", "Cloud", "Mémoire", "Ordinateur", "Plante", "Lent", "Sécurité"],
        "SMARTPHONE": ["Téléphone", "Écran", "Internet", "Poche", "Application", "Tactile", "Appel", "Message", "Photo", "Vidéo", "Jeu", "Batterie", "Chargeur", "Vitre", "Casser", "Apple", "Samsung", "Main", "Doigt", "Réseau"],
        "TÉLÉPHONE FIXE": ["Maison", "Appel", "Fil", "Vieux", "Numéro", "Combiné", "Sonner", "Bruit", "Bouton", "Touche", "Parler", "Oreille", "Bouche", "Raccrocher", "Décrocher", "Mur", "Table", "Ancien", "Grand-mère", "Gris"],
        "SWITCH": ["Console", "Jeu", "Nintendo", "Écran", "Manette", "Jouer", "Mario", "Zelda", "Portable", "Télé", "Rouge", "Bleu", "Cartouche", "Ami", "Multi", "Batterie", "Chargeur", "Plastique", "Bouton", "Amusement"],
        "TABLETTE": ["Écran", "Tactile", "Internet", "Jeu", "Grand", "Plat", "iPad", "Film", "Vidéo", "Application", "Batterie", "Doigt", "Lire", "Canapé", "Lit", "Enfant", "Appareil", "Chargeur", "Vitre", "Main"],
        "BATTERIE": ["Énergie", "Téléphone", "Recharger", "Pourcent", "Vide", "Électricité", "Plein", "Rouge", "Vert", "Prise", "Câble", "Chargeur", "Lithium", "Chaud", "Exploser", "Voiture", "Machine", "Panne", "Autonomie", "Durée"],
        "CHARGEUR": ["Câble", "Prise", "Batterie", "Téléphone", "Électricité", "Brancher", "Mur", "Blanc", "Noir", "USB", "Embout", "Casser", "Perdre", "Énergie", "Remplir", "Fil", "Plastique", "Courant", "Appareil", "Pratique"],
        "CLÉ USB": ["Stocker", "Données", "Petit", "Ordinateur", "Fichier", "Mémoire", "Brancher", "Plastique", "Métal", "Poche", "Perdre", "Transférer", "Copier", "Coller", "Document", "Photo", "Vidéo", "Giga", "Capacité", "Pratique"],
        "DISQUE DUR": ["Stocker", "Mémoire", "Ordinateur", "Données", "Fichier", "Gros", "Boîte", "Métal", "Câble", "Brancher", "Sauvegarde", "Photo", "Vidéo", "Document", "Giga", "Téra", "Capacité", "Lourd", "Externe", "Interne"],
        "IPHONE": ["Téléphone", "Apple", "Cher", "Écran", "Tech", "Marque", "Pomme", "Tactile", "Application", "Photo", "Vidéo", "Steve Jobs", "iOS", "Mode", "Gens", "Poche", "Casser", "Vitre", "Batterie", "Chargeur"],
        "SAMSUNG": ["Téléphone", "Android", "Corée", "Écran", "Marque", "Tech", "Galaxy", "Tactile", "Application", "Photo", "Vidéo", "Gros", "Poche", "Télé", "Machine", "Laver", "Frigo", "Concurrence", "Batterie", "Chargeur"],
        "NOKIA": ["Téléphone", "Vieux", "Solide", "Brique", "Marque", "Touche", "3310", "Snake", "Jeu", "Casser", "Jamais", "Batterie", "Long", "Gris", "Lourd", "Poche", "Ancien", "Finlande", "Appel", "SMS"],
        "HUAWEI": ["Téléphone", "Chine", "Android", "Écran", "Marque", "Tech", "Tactile", "Photo", "Vidéo", "Application", "Gros", "Poche", "Concurrence", "Espion", "Interdit", "USA", "Batterie", "Chargeur", "Rapide", "Pas cher"],
        "PLAYSTATION": ["Console", "Jeu", "Manette", "Sony", "Télé", "Jouer", "PS5", "PS4", "Disque", "CD", "En ligne", "Amis", "Gamer", "Noir", "Blanc", "Bruit", "Chaud", "Manette", "Croix", "Carré"],
        "WIFI": ["Internet", "Sans fil", "Réseau", "Connecter", "Box", "Ondes", "Mot de passe", "Téléphone", "Ordinateur", "Rapide", "Lent", "Couper", "Antenne", "Routeur", "Maison", "Café", "Public", "Invisible", "Signal", "Barres"],
        "BLUETOOTH": ["Sans fil", "Connecter", "Téléphone", "Appareil", "Ondes", "Réseau", "Bleu", "Dent", "Musique", "Casque", "Enceinte", "Voiture", "Partager", "Fichier", "Photo", "Lent", "Proche", "Distance", "Pairer", "Code"],
        "MOT DE PASSE": ["Secret", "Connexion", "Taper", "Compte", "Sécurité", "Oublier", "Lettre", "Chiffre", "Symbole", "Internet", "Site", "Application", "Protéger", "Hacker", "Changer", "Cacher", "Étoile", "Point", "Se souvenir", "Identifiant"],
        "CODE PIN": ["Chiffres", "Téléphone", "Carte", "Secret", "Taper", "Déverrouiller", "Bancaire", "Quatre", "Oublier", "Bloquer", "PUK", "Sécurité", "Protéger", "Allumer", "Payer", "Distributeur", "Mémoire", "Cacher", "Main", "Bouton"],
        "HACKER": ["Pirate", "Ordinateur", "Code", "Internet", "Voler", "Clavier", "Sécurité", "Virus", "Mot de passe", "Compte", "Argent", "Données", "Anonyme", "Cagoule", "Noir", "Écran", "Vert", "Film", "Génie", "Malveillant"],
        "PIRATE": ["Internet", "Voler", "Bateau", "Illégal", "Télécharger", "Hacker", "Film", "Musique", "Jeu", "Gratuit", "Mer", "Caraïbes", "Épée", "Pistolet", "Borgne", "Jambe de bois", "Perroquet", "Trésor", "Carte", "Croix"],
        "ANTIVIRUS": ["Protéger", "Ordinateur", "Sécurité", "Logiciel", "Internet", "Malware", "Virus", "Hacker", "Bloquer", "Scanner", "Alerte", "Mise à jour", "Payer", "Gratuit", "Avast", "Norton", "Bouclier", "Défense", "Nettoyer", "Sain"],
        "PARE-FEU": ["Protéger", "Réseau", "Sécurité", "Internet", "Bloquer", "Ordinateur", "Mur", "Feu", "Hacker", "Virus", "Connexion", "Autoriser", "Interdire", "Règle", "Logiciel", "Matériel", "Entreprise", "Maison", "Défense", "Filtre"],
        "AZERTY": ["Clavier", "Taper", "Lettres", "France", "Ordinateur", "Touches", "A", "Z", "E", "R", "T", "Y", "Écrire", "Mot", "Phrase", "Bouton", "Plastique", "Bruit", "Main", "Doigt"],
        "QWERTY": ["Clavier", "Taper", "Lettres", "Anglais", "Ordinateur", "Touches", "Q", "W", "E", "R", "T", "Y", "Écrire", "Mot", "Phrase", "Bouton", "Plastique", "Bruit", "Main", "Doigt"],
        "CHATGPT": ["IA", "Robot", "Parler", "Internet", "Questions", "Texte", "Répondre", "Écrire", "Code", "Devoir", "École", "Triche", "Intelligent", "Générer", "OpenAI", "Ordinateur", "Aide", "Discussion", "Rapide", "Savoir"],
        "GOOGLE": ["Chercher", "Internet", "Site", "Trouver", "Questions", "Moteur", "Recherche", "Lien", "Réponse", "Savoir", "Monde", "Entreprise", "Gros", "Logo", "Couleur", "Chrome", "Mail", "Map", "GPS", "Téléphone"],
        "GEMINI": ["IA", "Robot", "Google", "Parler", "Internet", "Texte", "Répondre", "Écrire", "Code", "Intelligent", "Générer", "Ordinateur", "Aide", "Discussion", "Rapide", "Savoir", "Concurrence", "ChatGPT", "Nouveau", "Assistant"],
        "EMAIL": ["Message", "Internet", "Envoyer", "Boîte", "Lettre", "Écrire", "Lire", "Adresse", "Arobase", "Travail", "Spam", "Corbeille", "Pièce jointe", "Document", "Photo", "Rapide", "Ordinateur", "Téléphone", "Contact", "Répondre"],
        "SMS": ["Message", "Téléphone", "Texte", "Envoyer", "Écrire", "Bref", "Lire", "Ami", "Famille", "Rapide", "Sonnerie", "Notification", "Bulle", "Vert", "Bleu", "Clavier", "Pouce", "Réseau", "Discussion", "Conversation"],
        "APPEL": ["Téléphone", "Parler", "Voix", "Sonner", "Contact", "Allô", "Décrocher", "Raccrocher", "Numéro", "Ami", "Famille", "Urgence", "Oreille", "Bouche", "Micro", "Haut-parleur", "Réseau", "Bruit", "Discussion", "Conversation"],
        "MESSAGE": ["Envoyer", "Texte", "Téléphone", "Écrire", "Lire", "SMS", "Email", "WhatsApp", "Messenger", "Ami", "Famille", "Mots", "Lettre", "Bulle", "Notification", "Bruit", "Vibreur", "Écran", "Clavier", "Discussion"],
        "NOTIFICATION": ["Alerte", "Téléphone", "Bruit", "Message", "Écran", "Application", "Vibreur", "Sonnerie", "Lire", "Ignorer", "Effacer", "Rouge", "Bulle", "Pastille", "Information", "Réseau social", "Jeu", "Mise à jour", "Réveil", "Attention"],
        "EMOJI": ["Visage", "Dessin", "Message", "Sourire", "Téléphone", "Jaune", "Pleurer", "Rire", "Cœur", "Pouce", "Colère", "Clavier", "Texte", "Exprimer", "Émotion", "Symbole", "Petit", "Mignon", "Drôle", "Image"],
        "GIF": ["Image", "Bouge", "Message", "Internet", "Drôle", "Courte", "Vidéo", "Boucle", "Son", "Sans", "Mème", "Réaction", "Réseau social", "Envoyer", "Partager", "Rire", "Animation", "Film", "Extrait", "Format"],
        "RÉSEAU SOCIAL": ["Internet", "Amis", "Photos", "Partager", "Profil", "Like", "Commentaire", "Abonné", "Suivre", "Message", "Vidéo", "Scroll", "Téléphone", "Application", "Temps", "Perdre", "Gens", "Vie", "Faux", "Montrer"],
        "FORUM": ["Internet", "Discussion", "Messages", "Communauté", "Question", "Site", "Réponse", "Sujet", "Aide", "Passion", "Gens", "Anonyme", "Troll", "Modérateur", "Règle", "Lire", "Écrire", "Vieux", "Web", "Partage"],
        "SITE": ["Internet", "Web", "Page", "Adresse", "Naviguer", "Lien", "Clic", "Souris", "Ordinateur", "Téléphone", "Navigateur", "Google", "Créer", "Lire", "Acheter", "Vidéo", "Image", "Texte", "Information", "Monde"],
        "BLOG": ["Internet", "Article", "Écrire", "Site", "Journal", "Lire", "Auteur", "Passion", "Partager", "Photo", "Texte", "Avis", "Commentaire", "Voyage", "Cuisine", "Mode", "Web", "Page", "Personnel", "Public"],
        "HASHTAG": ["Dièse", "Mot", "Réseau", "Tendance", "Signe", "Social", "Twitter", "Instagram", "Clavier", "Symbole", "Recherche", "Sujet", "Actualité", "Regrouper", "Clic", "Bleu", "Internet", "Message", "Catégorie", "Populaire"],
        "AROBASE": ["Signe", "Email", "Adresse", "Internet", "Lettre", "Courrier", "Clavier", "Touche", "A", "Rond", "Symbole", "Envoyer", "Message", "Contact", "Réseau social", "Mentionner", "Tag", "Nom", "Web", "Indispensable"],
        "STREAMING": ["Vidéo", "Internet", "Regarder", "Film", "Musique", "Direct", "Live", "Twitch", "Netflix", "Youtube", "Spotify", "Abonnement", "Payer", "Gratuit", "Pub", "Écran", "Série", "Temps", "Chargement", "Flux"],
        "DIRECT": ["Live", "Maintenant", "Vidéo", "Télé", "Streaming", "Temps réel", "Caméra", "Regarder", "Événement", "Sport", "Match", "Journal", "Twitch", "Internet", "Public", "Chat", "Commentaire", "Diffuser", "Action", "Pas de montage"],
        "NETFLIX": ["Série", "Film", "Écran", "Regarder", "Internet", "Rouge", "Abonnement", "Payer", "Soirée", "Canapé", "Détente", "Nuit", "Épisode", "Saison", "Binge-watching", "Télé", "Ordinateur", "Tablette", "Catalogue", "Chill"],
        "YOUTUBE": ["Vidéo", "Internet", "Regarder", "Chaîne", "Rouge", "Créateur", "Youtuber", "Abonné", "Pouce bleu", "Commentaire", "Pub", "Gratuit", "Musique", "Tuto", "Jeu", "Humour", "Vlog", "Écran", "Temps", "Play"],
        "TIKTOK": ["Vidéo", "Court", "Internet", "Danser", "Téléphone", "Jeune", "Application", "Scroll", "Temps", "Musique", "Trend", "Défi", "Chine", "Algorithme", "Pour toi", "Abonné", "Like", "Commentaire", "Filtre", "Addiction"],
        "INSTAGRAM": ["Photo", "Réseau", "Images", "Story", "Abonnés", "Filtre", "Application", "Téléphone", "Like", "Cœur", "Commentaire", "Partager", "Vie", "Voyage", "Nourriture", "Mode", "Influenceur", "Message", "Scroll", "Carré"],
        "SNAPCHAT": ["Photo", "Message", "Fantôme", "Éphémère", "Jaune", "Filtre", "Application", "Téléphone", "Amis", "Envoyer", "Ouvrir", "Disparaître", "Temps", "Secondes", "Story", "Flamme", "Score", "Vidéo", "Chat", "Drôle"],
        "ONLYFAN": ["Internet", "Abonnement", "Argent", "Site", "Photos", "Privé", "Adulte", "Nu", "Payer", "Créateur", "Contenu", "Message", "Secret", "Cacher", "Carte bancaire", "Mois", "Riche", "Filles", "Garçons", "Modèle"],
        "TINDER": ["Rencontre", "Amour", "Match", "Téléphone", "Glisser", "Photo", "Application", "Profil", "Bio", "Droite", "Gauche", "Cœur", "Croix", "Message", "Discuter", "Rendez-vous", "Célibataire", "Couple", "Sexe", "Feu"],
        "FORTNITE": ["Jeu", "Tirer", "Construire", "Battle Royale", "Danser", "En ligne", "Amis", "Arme", "Carte", "Tempête", "Bus", "Sauter", "Parachute", "Skin", "V-Bucks", "Payer", "Gagner", "Top 1", "Console", "PC"],
        "MINECRAFT": ["Jeu", "Cubes", "Construire", "Survivre", "Blocs", "Créer", "Miner", "Terre", "Bois", "Pierre", "Zombie", "Squelette", "Nuit", "Jour", "Épée", "Pioche", "Maison", "Amis", "En ligne", "Pixel"],
        "CANDY CRUSH": ["Jeu", "Téléphone", "Bonbons", "Couleurs", "Niveaux", "Aligner", "Trois", "Exploser", "Maman", "Métro", "Temps", "Vies", "Attendre", "Payer", "Sucre", "Doux", "Addiction", "Tablette", "Casser", "Puzzle"],
        "TETRIS": ["Jeu", "Blocs", "Tomber", "Vieux", "Lignes", "Emboîter", "Formes", "Couleurs", "Tourner", "Vite", "Écran", "Console", "Musique", "Casser", "Points", "Score", "Niveau", "Stress", "Classique", "Briques"],
        "ANGRY BIRD": ["Jeu", "Oiseaux", "Cochons", "Lancer", "Téléphone", "Détruire", "Ouvrir", "Bois", "Pierre", "Glace", "Fronde", "Tirer", "Élastique", "Voler", "Pouvoir", "Niveaux", "Points", "Étoiles", "Rouge", "Vert"],
        "PLANTE VS ZOMBIES": ["Jeu", "Jardin", "Défendre", "Fleurs", "Monstres", "Drôle", "Soleil", "Tirer", "Pois", "Noix", "Maison", "Cerveau", "Manger", "Niveaux", "Stratégie", "Téléphone", "PC", "Nuit", "Jour", "Piscine"],
        "LUIGI": ["Jeu", "Vert", "Frère", "Moustache", "Mario", "Casquette", "Plombier", "Peur", "Fantôme", "Manoir", "Aspirateur", "Grand", "Maigre", "Sauter", "Nintendo", "Console", "Héros", "Second", "Salopette", "Italie"],
        "MARIO": ["Jeu", "Rouge", "Moustache", "Nintendo", "Sauter", "Plombier", "Frère", "Luigi", "Casquette", "Salopette", "Champignon", "Pièce", "Étoile", "Princesse", "Peach", "Sauver", "Château", "Tortue", "Tuyau", "Italie"],
        "PEACH": ["Jeu", "Princesse", "Rose", "Sauver", "Mario", "Château", "Enlever", "Bowser", "Couronne", "Robe", "Blonde", "Fille", "Champignon", "Toad", "Nintendo", "Console", "Héroïne", "Douce", "Gâteau", "Bisou"],
        "HARMONIE": ["Jeu", "Princesse", "Bleu", "Espace", "Mario", "Étoile", "Nintendo", "Console", "Blonde", "Couronne", "Robe", "Magie", "Baguette", "Galaxie", "Voler", "Grande", "Mère", "Luma", "Mystère", "Calme"],
        "ENFER": ["Feu", "Diable", "Mal", "Punition", "Chaud", "Sous-terre", "Mort", "Péché", "Démon", "Rouge", "Cornes", "Souffrance", "Éternité", "Religion", "Dieu", "Paradis", "Monstre", "Peur", "Noir", "Flamme"],
        "NETHER": ["Jeu", "Minecraft", "Enfer", "Feu", "Lave", "Portail", "Obsidienne", "Violet", "Monstre", "Cochon", "Zombie", "Or", "Forteresse", "Chaud", "Danger", "Mourir", "Perdre", "Lit", "Exploser", "Rouge"],
        "CRAFTER": ["Jeu", "Créer", "Minecraft", "Table", "Fabriquer", "Objets", "Outils", "Armes", "Armure", "Bois", "Pierre", "Fer", "Diamant", "Recette", "Inventaire", "Placer", "Construire", "Survivre", "Bouton", "Clic"],
        "MINER": ["Jeu", "Creuser", "Pierre", "Pioche", "Minecraft", "Souterrain", "Terre", "Trou", "Grotte", "Noir", "Lumière", "Torche", "Charbon", "Fer", "Or", "Diamant", "Danger", "Lave", "Monstre", "Richesse"],
        "CREUSER": ["Trou", "Terre", "Pelle", "Descendre", "Chercher", "Minecraft", "Miner", "Pierre", "Sable", "Chien", "Os", "Trésor", "Pirate", "Cacher", "Jardin", "Plante", "Arbre", "Grotte", "Outil", "Fatigue"],
        "NOYÉ": ["Eau", "Mort", "Zombie", "Océan", "Minecraft", "Respirer", "Manquer", "Air", "Nager", "Fond", "Trident", "Monstre", "Danger", "Nuit", "Bleu", "Vert", "Couler", "Piscine", "Mer", "Rivière"],
        "ZOMBIE": ["Mort", "Vivant", "Monstre", "Mordre", "Cerveau", "Lent", "Marcher", "Bras", "Vert", "Sang", "Peur", "Film", "Jeu", "Minecraft", "Nuit", "Infecté", "Virus", "Apocalypse", "Survivre", "Bruit"],
        "INTELLIGENCE ARTIFICIELLE": ["Robot", "Machine", "Cerveau", "Futur", "Apprendre", "Ordinateur", "Code", "Programme", "Internet", "Questions", "Réponses", "Texte", "Image", "Créer", "Penser", "Humain", "Danger", "ChatGPT", "Google", "Science"],
        "ROBOT": ["Machine", "Métal", "Futur", "Programmer", "Mécanique", "Artificiel", "Ordinateur", "Intelligence", "Bouger", "Bras", "Usine", "Travailler", "Fatigue", "Électricité", "Batterie", "Jouet", "Enfant", "Science-fiction", "Film", "Espace"],
        "HARRY POTTER": ["Magie", "Sorcier", "Poudlard", "Cicatrice", "Baguette", "Lunettes", "Livre", "Film", "École", "Balai", "Voler", "Chouette", "Ron", "Hermione", "Voldemort", "Sortilège", "Chapeau", "Choix", "Gryffondor", "Anglais"],
        "STRANGER THINGS": ["Série", "Monstre", "Onze", "Années 80", "Netflix", "Pouvoir", "Enfants", "Vélo", "Mystère", "Disparition", "Monde", "Envers", "Sombre", "Peur", "Science-fiction", "Musique", "Démogorgon", "Sang", "Nez", "Amis"],
        "BACKROOM": ["Internet", "Peur", "Labyrinthe", "Jaune", "Monstre", "Vide", "Murs", "Moquette", "Lumière", "Bruit", "Infini", "Perdu", "Sortie", "Chercher", "Cauchemar", "Réalité", "Glitch", "Niveau", "Fuir", "Seul"],
        "UPSIDE DOWN": ["Monde", "Envers", "Série", "Monstre", "Sombre", "Étrange", "Stranger Things", "Peur", "Froid", "Cendre", "Air", "Respirer", "Danger", "Cacher", "Double", "Réalité", "Portail", "Ouvrir", "Vigne", "Rouge"],
        "EXTRATERRESTRE 👽": ["Espace", "Vert", "Soucoupe", "Planète", "Vaisseau", "Alien", "Étoile", "Galaxie", "Voler", "Ciel", "OVNI", "Mystère", "Zone 51", "Film", "Science-fiction", "Gros", "Yeux", "Petit", "Gris", "Envahir"],
        "MONSTRE": ["Peur", "Créature", "Laid", "Cauchemar", "Méchant", "Cacher", "Lit", "Sous", "Placard", "Nuit", "Noir", "Dents", "Griffes", "Gros", "Crier", "Fuir", "Film", "Horreur", "Halloween", "Imaginaire"],
        "DONALD": ["Canard", "Blanc", "Disney", "Marin", "Dessin animé", "Colère", "Bec", "Jaune", "Plumes", "Chapeau", "Bleu", "Vareuse", "Voix", "Drôle", "Mickey", "Ami", "Neveu", "Oncle", "Riche", "Picsou"],
        "MICKEY": ["Souris", "Disney", "Grandes oreilles", "Dessin animé", "Rouge", "Mascotte", "Noir", "Blanc", "Gant", "Chaussure", "Jaune", "Short", "Bouton", "Sourire", "Voix", "Aiguë", "Minnie", "Pluto", "Dingo", "Parc"],
        "AVATAR (BLEU)": ["Film", "Cinéma", "Pandora", "Grands", "Extra-terrestre", "Nature", "Arbre", "Vie", "Tresse", "Lien", "Animal", "Voler", "Guerre", "Humain", "Robot", "Tirer", "Flèche", "Succès", "3D", "Beauté"],
        "AVATAR (FLÈCHE)": ["Dessin animé", "Aang", "Éléments", "Maître", "Air", "Chauve", "Tatouage", "Bleu", "Tête", "Enfant", "Sauver", "Monde", "Guerre", "Feu", "Eau", "Terre", "Apprendre", "Voyage", "Amis", "Bison"],
        "GRAVITY FALLS": ["Dessin animé", "Mystère", "Jumeaux", "Bizarre", "Forêt", "Journal", "Livre", "Main", "Six", "Doigts", "Oncle", "Arnaque", "Boutique", "Monstre", "Gnome", "Triangle", "Œil", "Chapeau", "Été", "Vacances"],
        "WAKFU": ["Dessin animé", "Magie", "France", "Aventure", "Héros", "Jeu", "Vidéo", "Dofus", "Monde", "Portail", "Bleu", "Chapeau", "Oreilles", "Épée", "Combat", "Amis", "Quête", "Dragon", "Kamas", "Temps"],
        "TOTALLY SPIES": ["Dessin animé", "Filles", "Espionnes", "Gadgets", "Mission", "Trois", "Rouge", "Jaune", "Vert", "Costume", "Combinaison", "Lycée", "Secrète", "Chef", "Jerry", "Bureau", "Cacher", "Aventure", "Sauver", "Monde"],
        "WINX": ["Dessin animé", "Fées", "Magie", "Ailes", "Filles", "Pouvoir", "École", "Apprendre", "Transformation", "Vêtement", "Couleur", "Combat", "Sorcières", "Méchant", "Sauver", "Monde", "Amour", "Garçons", "Spécialistes", "Chanson"],
        "SCOOBY DOO": ["Chien", "Dessin animé", "Mystère", "Fantôme", "Peur", "Équipe", "Amis", "Camionnette", "Machine", "Manger", "Gourmand", "Fuir", "Courir", "Cacher", "Masque", "Méchant", "Arrêter", "Détective", "Drôle", "Parler"],

        // 🎨 Arts, Musique & Divertissement
        "ROMAN": ["Livre", "Lire", "Histoire", "Pages", "Écrire", "Papier", "Auteur", "Chapitre", "Personnage", "Fiction", "Imaginer", "Mots", "Texte", "Couverture", "Bibliothèque", "Librairie", "Acheter", "Emprunter", "Long", "Fin"],
        "BANDE DESSINÉE": ["Livre", "Dessin", "Bulles", "Lire", "Case", "Héros", "Histoire", "Couleur", "Texte", "Auteur", "Dessinateur", "Humour", "Aventure", "Action", "Manga", "Comics", "Papier", "Pages", "Couverture", "Art"],
        "LIVRE": ["Lire", "Pages", "Histoire", "Mots", "Papier", "Couverture", "Roman", "Auteur", "Chapitre", "Bibliothèque", "Imaginer", "Lettres", "Lourd", "Ouvrir", "Fermer", "Marque-page", "Titre", "Fin", "Début", "Cadeau"],
        "DICTIONNAIRE": ["Livre", "Mots", "Définition", "Chercher", "Alphabétique", "Lire", "Gros", "Lourd", "Pages", "Papier", "Orthographe", "Langue", "Français", "Traduire", "Anglais", "Apprendre", "École", "Savoir", "Sens", "Ordre"],
        "LETTRES": ["Alphabet", "Écrire", "Mot", "Papier", "Lire", "Voyelle", "Consonne", "Vingt-six", "A", "Z", "Clavier", "Taper", "Message", "Phrase", "Texte", "Livre", "Imprimer", "Encre", "Stylo", "Crayon"],
        "MOTS": ["Écrire", "Parler", "Phrase", "Lire", "Sens", "Lettres", "Dictionnaire", "Définition", "Voix", "Son", "Bouche", "Langue", "Comprendre", "Communiquer", "Texte", "Livre", "Poème", "Chanson", "Scrabble", "Jeu"],
        "FABLE": ["Histoire", "Animaux", "Morale", "Lire", "Livre", "Récit", "Court", "La Fontaine", "Corbeau", "Renard", "Lièvre", "Tortue", "Apprendre", "Leçon", "École", "Poésie", "Rimes", "Ancien", "Sagesse", "Imaginaire"],
        "HISTOIRE": ["Passé", "Raconter", "Livre", "Temps", "Vrai", "Écouter", "École", "Apprendre", "Date", "Guerre", "Roi", "Château", "Ancien", "Avant", "Mémoire", "Humain", "Monde", "Pays", "Mots", "Récit"],
        "FONTAINE": ["Eau", "Couler", "Ville", "Parc", "Statue", "Boire", "Bassin", "Jet", "Bruit", "Frais", "Monument", "Pierre", "Place", "Pigeon", "Soleil", "Été", "Vœu", "Pièce", "Art", "Décoration"],
        "PEINTURE": ["Couleur", "Toile", "Pinceau", "Art", "Tableau", "Mur", "Artiste", "Palette", "Dessin", "Créer", "Maison", "Chantier", "Tache", "Métier", "Beau", "Exposition", "Musée", "Eau", "Huile", "Mélanger"],
        "AQUARELLE": ["Peinture", "Eau", "Couleur", "Papier", "Pinceau", "Art", "Léger", "Transparent", "Artiste", "Palette", "Dessin", "Créer", "Paysage", "Nature", "Doux", "Technique", "Mélanger", "Tache", "Séchage", "Rapide"],
        "SCULPTURE": ["Art", "Statue", "Pierre", "3D", "Créer", "Musée", "Artiste", "Marteau", "Bois", "Argile", "Mains", "Taille", "Forme", "Volume", "Exposition", "Beau", "Monument", "Ville", "Parc", "Outil"],
        "POTERIE": ["Terre", "Argile", "Vase", "Art", "Mains", "Tourner", "Créer", "Cuire", "Four", "Chaud", "Objet", "Bol", "Assiette", "Eau", "Sale", "Moule", "Forme", "Artisan", "Atelier", "Peindre"],
        "MUSÉES": ["Art", "Tableaux", "Visiter", "Vieux", "Culture", "Bâtiment", "Exposition", "Statue", "Histoire", "Science", "Silence", "Regarder", "Apprendre", "Tourisme", "Billet", "Guide", "Œuvre", "Peinture", "Sculpture", "Découverte"],
        "TABLEAU": ["Art", "Peinture", "Mur", "Musée", "Dessin", "Cadre", "Toile", "Couleur", "Pinceau", "Artiste", "Accrocher", "Regarder", "Exposition", "Beau", "Vieux", "Célèbre", "Mona Lisa", "École", "Craie", "Classe"],
        "BIBLIOTHÈQUE": ["Livres", "Lire", "Silence", "Étagères", "Emprunter", "Lieu", "Papier", "Mots", "Histoire", "Savoir", "Étudier", "École", "Université", "Carte", "Retour", "Date", "Chercher", "Trouver", "Calme", "Travail"],
        "MUSÉE": ["Art", "Visiter", "Histoire", "Vieux", "Exposition", "Tableaux", "Statue", "Culture", "Bâtiment", "Silence", "Regarder", "Apprendre", "Tourisme", "Billet", "Guide", "Œuvre", "Peinture", "Sculpture", "Découverte", "Passé"],
        "BLEU CLAIR": ["Couleur", "Ciel", "Clair", "Peinture", "Doux", "Yeux", "Eau", "Mer", "Piscine", "Jour", "Soleil", "Léger", "Pastel", "Mélange", "Blanc", "Nuage", "Hiver", "Froid", "Glace", "Vêtement"],
        "BLEU FONCÉ": ["Couleur", "Nuit", "Sombre", "Peinture", "Océan", "Profond", "Ciel", "Marine", "Grave", "Lourd", "Mélange", "Noir", "Vêtement", "Costume", "Mer", "Abysse", "Nuit", "Étoile", "Mystère", "Sérieux"],
        "CONCERT": ["Musique", "Scène", "Public", "Chanter", "Live", "Artiste", "Groupe", "Instrument", "Bruit", "Fort", "Danser", "Applaudir", "Billet", "Salle", "Stade", "Lumière", "Nuit", "Soirée", "Amis", "Ambiance"],
        "FESTIVAL": ["Musique", "Concert", "Public", "Fête", "Extérieur", "Scène", "Plusieurs", "Jours", "Tente", "Camping", "Boue", "Soleil", "Pluie", "Amis", "Boire", "Danser", "Bruit", "Ambiance", "Été", "Artistes"],
        "PLAYLIST": ["Musique", "Chansons", "Écouter", "Liste", "Téléphone", "Son", "Spotify", "Créer", "Ordre", "Ambiance", "Sport", "Dormir", "Voiture", "Fête", "Amis", "Partager", "Artiste", "Album", "Casque", "Enceinte"],
        "ALBUM": ["Musique", "Chansons", "Artiste", "Disque", "Écouter", "CD", "Vinyle", "Pochette", "Image", "Titre", "Sortie", "Acheter", "Magasin", "Internet", "Spotify", "Concert", "Nouveau", "Vieux", "Collection", "Photo"],
        "OPÉRA": ["Chanter", "Musique", "Voix", "Théâtre", "Classique", "Spectacle", "Scène", "Orchestre", "Instrument", "Costume", "Décor", "Histoire", "Drame", "Aigu", "Fort", "Vibrato", "Public", "Applaudir", "Billet", "Soirée"],
        "CHORÉGRAPHIE": ["Danse", "Pas", "Bouger", "Spectacle", "Rythme", "Apprendre", "Musique", "Corps", "Scène", "Groupe", "Ensemble", "Synchronisé", "Répéter", "Miroir", "Professeur", "Créer", "Art", "Mouvement", "Clip", "Vidéo"],
        "BERCEUSE": ["Chanson", "Dormir", "Bébé", "Doux", "Musique", "Nuit", "Lit", "Maman", "Papa", "Chanter", "Voix", "Calme", "Lent", "Rêve", "Sommeil", "Fatigue", "Yeux", "Fermer", "Enfant", "Mélodie"],
        "GUITARE": ["Instrument", "Cordes", "Jouer", "Musique", "Bois", "Gratter", "Doigts", "Médiator", "Acoustique", "Électrique", "Son", "Concert", "Chanson", "Groupe", "Rock", "Manche", "Note", "Accords", "Amplificateur", "Bruit"],
        "BASSE": ["Instrument", "Cordes", "Grave", "Musique", "Rythme", "Jouer", "Guitare", "Lourd", "Son", "Concert", "Groupe", "Rock", "Doigts", "Manche", "Note", "Amplificateur", "Bruit", "Quatre", "Fondation", "Électrique"],
        "PIANO": ["Instrument", "Touches", "Noir et Blanc", "Musique", "Jouer", "Classique", "Doigts", "Mains", "Son", "Concert", "Chanson", "Lourd", "Bois", "Pédale", "Note", "Accords", "Apprendre", "Professeur", "Partition", "Grand"],
        "SYNTHÉTISEUR": ["Instrument", "Touches", "Électrique", "Musique", "Son", "Clavier", "Piano", "Bouton", "Effet", "Bruit", "Moderne", "Ordinateur", "Brancher", "Concert", "Groupe", "Jouer", "Doigts", "Plastique", "Volume", "Enceinte"],
        "FLÛTE": ["Instrument", "Souffler", "Vent", "Musique", "Bois", "Trou", "Doigts", "Mains", "Son", "Aigu", "Doux", "Oiseau", "École", "Apprendre", "Plastique", "Bec", "Traversière", "Métal", "Orchestre", "Partition"],
        "TROMPETTE": ["Instrument", "Cuivre", "Souffler", "Musique", "Bruit", "Vent", "Fort", "Aigu", "Lèvre", "Bouche", "Bouton", "Piston", "Orchestre", "Jazz", "Concert", "Doré", "Briller", "Métal", "Réveil", "Armée"],
        "BATTERIE": ["Instrument", "Taper", "Baguettes", "Rythme", "Musique", "Bruit", "Fort", "Percussion", "Tambour", "Cymbale", "Pédale", "Pied", "Mains", "Concert", "Groupe", "Rock", "Assis", "Tempo", "Énergie", "Fatigue"],
        "PERCUSSION": ["Taper", "Rythme", "Instrument", "Musique", "Main", "Bruit", "Tambour", "Batterie", "Baguette", "Fort", "Tempo", "Groupe", "Concert", "Orchestre", "Peau", "Bois", "Métal", "Danser", "Bouger", "Frapper"],
        "TAMBOUR": ["Instrument", "Taper", "Bruit", "Baguette", "Musique", "Rond", "Peau", "Bois", "Rythme", "Fort", "Armée", "Marcher", "Percussion", "Main", "Concert", "Groupe", "Gros", "Caisse", "Résonner", "Frapper"],
        "CYMBALE": ["Métal", "Taper", "Batterie", "Bruit", "Instrument", "Rond", "Doré", "Briller", "Fort", "Percussion", "Baguette", "Rythme", "Concert", "Groupe", "Orchestre", "Résonner", "Crash", "Vibrer", "Fin", "Choc"],
        "FILM": ["Cinéma", "Regarder", "Écran", "Acteur", "Histoire", "Vidéo", "Réalisateur", "Caméra", "Tournage", "Image", "Son", "Bruit", "Popcorn", "Salle", "Billet", "Affiche", "Durée", "Heure", "Fin", "Générique"],
        "SÉRIE": ["Épisodes", "Saisons", "Regarder", "Télé", "Netflix", "Histoire", "Suite", "Acteur", "Vidéo", "Écran", "Attendre", "Suspense", "Fin", "Semaine", "Internet", "Streaming", "Binge-watching", "Soirée", "Canapé", "Personnage"],
        "ANIMÉ": ["Japon", "Dessin", "Série", "Regarder", "Manga", "Télé", "Épisode", "Histoire", "Action", "Magie", "Combats", "Héros", "Pouvoir", "Voix", "Sous-titres", "Générique", "Chanson", "Internet", "Streaming", "Écran"],
        "COMÉDIE": ["Rire", "Film", "Drôle", "Blague", "Acteur", "Amusant", "Histoire", "Sourire", "Joie", "Bonheur", "Famille", "Amis", "Regarder", "Écran", "Cinéma", "Télé", "Spectacle", "Théâtre", "Fin heureuse", "Détente"],
        "TRAGÉDIE": ["Triste", "Pleurer", "Pièce", "Théâtre", "Drame", "Mort", "Histoire", "Acteur", "Scène", "Public", "Malheur", "Fin", "Larme", "Émotion", "Sérieux", "Classique", "Texte", "Auteur", "Grave", "Destin"],
        "THRILLER": ["Film", "Peur", "Suspense", "Tension", "Mystère", "Police", "Enquête", "Meurtre", "Coupable", "Innocent", "Histoire", "Regarder", "Écran", "Cinéma", "Stress", "Surprise", "Fin", "Sombre", "Nuit", "Action"],
        "DRAME": ["Triste", "Film", "Pleurer", "Histoire", "Série", "Émotion", "Malheur", "Maladie", "Mort", "Amour", "Séparation", "Famille", "Problème", "Larme", "Regarder", "Écran", "Cinéma", "Acteur", "Sérieux", "Vie"],
        "SCIENCE-FICTION": ["Futur", "Espace", "Film", "Robot", "Vaisseau", "Livre", "Planète", "Étoile", "Alien", "Extraterrestre", "Technologie", "Laser", "Voyage", "Temps", "Histoire", "Imaginaire", "Science", "Cinéma", "Effets spéciaux", "Univers"],
        "FANTASTIQUE": ["Magie", "Monstre", "Film", "Livre", "Imaginaire", "Créature", "Sorcier", "Fée", "Dragon", "Épée", "Aventure", "Héros", "Quête", "Monde", "Histoire", "Sortilège", "Pouvoir", "Cinéma", "Légende", "Mythe"],
        "PLATEAU": ["Tournage", "Télé", "Film", "Caméra", "Scène", "Lumière", "Acteur", "Réalisateur", "Silence", "Action", "Décor", "Studio", "Micro", "Son", "Équipe", "Travail", "Maquillage", "Costume", "Émission", "Direct"],
        "SCÈNE": ["Théâtre", "Concert", "Public", "Spectacle", "Acteur", "Monter", "Bois", "Hauteur", "Lumière", "Rideau", "Micro", "Chanter", "Danser", "Jouer", "Applaudir", "Décor", "Espace", "Regarder", "Performance", "Direct"],
        "MICRO": ["Chanter", "Parler", "Voix", "Son", "Main", "Amplifier", "Concert", "Scène", "Public", "Bruit", "Câble", "Sans fil", "Enregistrer", "Studio", "Télé", "Radio", "Journaliste", "Tendre", "Écouter", "Volume"],
        "MÉGAPHONE": ["Crier", "Fort", "Voix", "Parler", "Manifestation", "Bruit", "Main", "Amplifier", "Son", "Public", "Rue", "Grève", "Police", "Alerte", "Attention", "Sirène", "Plastique", "Bouton", "Pile", "Entendre"],
        "UNDERCOVER": ["Jeu", "Mots", "Nous", "Imposteur", "Deviner", "Rôles", "Amis", "Téléphone", "Application", "Voter", "Éliminer", "Civil", "Mr White", "Indice", "Tour", "Gagner", "Perdre", "Secret", "Cacher"],
        "LOUP-GAROU (JEU)": ["Jeu", "Nuit", "Village", "Rôles", "Tuer", "Mentir", "Amis", "Cartes", "Cercle", "Fermer les yeux", "Ouvrir les yeux", "Voyante", "Sorcière", "Chasseur", "Petite fille", "Voter", "Éliminer", "Débat", "Gagner", "Perdre"],

        // 🌌 Concepts & Abstrait
        "AMOUR": ["Cœur", "Sentiment", "Couple", "Passion", "Rouge", "Bisou", "Mariage", "Je t'aime", "Fidélité", "Amant", "Fleur", "Rose", "Saint-Valentin", "Câlin", "Tendresse", "Partage", "Vie", "Heureux", "Joie", "Aveugle"],
        "AMITIÉ": ["Potes", "Lien", "Confiance", "Proche", "Ensemble", "Sentiment", "Aider", "Partager", "Rire", "Secret", "Fidèle", "Toujours", "Camarade", "École", "Jeu", "Soirée", "Sortir", "Discussion", "Soutien", "Frère"],
        "PEUR": ["Trembler", "Crier", "Cauchemar", "Frayeur", "Monstre", "Sombre", "Nuit", "Noir", "Danger", "Fuir", "Courir", "Cacher", "Sueur", "Cœur", "Vite", "Phobie", "Araignée", "Hauteur", "Sursaut", "Horreur"],
        "ANGOISSE": ["Stress", "Peur", "Sentiment", "Mal", "Ventre", "Anxiété", "Respirer", "Sueur", "Cœur", "Vite", "Panique", "Inquiétude", "Avenir", "Problème", "Dormir", "Nuit", "Pensée", "Lourd", "Pression", "Crise"],
        "TRISTESSE": ["Pleurer", "Malheur", "Larmes", "Chagrin", "Peine", "Sentiment", "Mal", "Cœur", "Perdre", "Mort", "Séparation", "Seul", "Noir", "Gris", "Déprime", "Dépression", "Sourire", "Manque", "Consoler", "Mélancolie"],
        "COLÈRE": ["Énervé", "Crier", "Rouge", "Fou", "Rage", "Sentiment", "Taper", "Casser", "Bruit", "Violence", "Dispute", "Mots", "Méchant", "Injustice", "Frustration", "Calmer", "Respirer", "Bouillir", "Exploser", "Sang"],
        "JOIE": ["Sourire", "Heureux", "Rire", "Bien", "Sentiment", "Fête", "Bonheur", "Amis", "Famille", "Partager", "Cadeau", "Surprise", "Gagner", "Réussir", "Sauter", "Danser", "Chanter", "Soleil", "Lumière", "Énergie"],
        "BONHEUR": ["Joie", "Bien", "Sourire", "Heureux", "Vie", "Amour", "Famille", "Santé", "Argent", "Tranquille", "Paix", "Sentiment", "Rêve", "Atteindre", "Partager", "Paradis", "Doux", "Agréable", "Chance", "Sérénité"],
        "RIRE": ["Drôle", "Joie", "Bruit", "Sourire", "Blague", "Heureux", "Humour", "Amis", "Pleurer", "Ventre", "Mal", "Bouche", "Ouvrir", "Son", "Éclat", "Comédie", "Clown", "Chatouiller", "Contagieux", "Sentiment"],
        "SOURIRE": ["Bouche", "Joie", "Heureux", "Visage", "Content", "Lèvres", "Dents", "Blanc", "Rire", "Sympa", "Aimable", "Accueil", "Photo", "Regard", "Yeux", "Doux", "Coin", "Monter", "Émotion", "Soleil"],
        "BEAUTÉ": ["Joli", "Beau", "Mignon", "Charme", "Visage", "Regarder", "Yeux", "Corps", "Nature", "Paysage", "Fleur", "Art", "Peinture", "Attirer", "Plaire", "Miroir", "Maquillage", "Mode", "Vêtement", "Esthétique"],
        "CHARME": ["Beauté", "Attirer", "Sourire", "Séduire", "Plaire", "Personne", "Voix", "Regard", "Magnétisme", "Magie", "Sortilège", "Élégance", "Classe", "Naturel", "Charisme", "Mignon", "Atout", "Secret", "Amour", "Couple"],
        "PASSÉ": ["Avant", "Hier", "Souvenir", "Temps", "Fini", "Histoire", "Ancien", "Vieux", "Mémoire", "Oublier", "Jeunesse", "Enfance", "Regret", "Nostalgie", "Retour", "Machine", "Arrière", "Loin", "Époque", "Aïeux"],
        "FUTUR": ["Demain", "Après", "Avenir", "Temps", "Plus tard", "Science-fiction", "Robot", "Voiture", "Voler", "Espace", "Planète", "Espoir", "Projet", "Rêve", "Inconnu", "Peur", "Prévoir", "Voyance", "Machine", "Avant"],
        "JOUR": ["Soleil", "Lumière", "Matin", "Clair", "Éveillé", "Temps", "Heure", "Travail", "École", "Activité", "Midi", "Après-midi", "Ciel", "Bleu", "Nuage", "Ouvrir", "Yeux", "Vivre", "Bouger", "Nuit"],
        "NUIT": ["Sombre", "Lune", "Dormir", "Noir", "Étoile", "Ciel", "Lit", "Rêve", "Cauchemar", "Peur", "Fatigue", "Repos", "Silence", "Bruit", "Animal", "Hibou", "Chauve-souris", "Fête", "Soirée", "Jour"],
        "MORT": ["Fin", "Vie", "Cimetière", "Décès", "Triste", "Squelette", "Tombe", "Enterrer", "Maladie", "Accident", "Guerre", "Tuer", "Meurtre", "Deuil", "Pleurer", "Noir", "Paradis", "Enfer", "Âme", "Fantôme"],
        "VIE": ["Naître", "Respirer", "Cœur", "Exister", "Mort", "Monde", "Humain", "Animal", "Plante", "Grandir", "Temps", "Énergie", "Mouvement", "Amour", "Joie", "Tristesse", "Expérience", "Terre", "Soleil", "Eau"],
        "ENFANT": ["Petit", "Jouer", "École", "Bébé", "Grandir", "Parents", "Maman", "Papa", "Innocent", "Rire", "Pleurer", "Jouet", "Bonbon", "Courir", "Apprendre", "Naissance", "Jeunesse", "Fils", "Fille", "Adulte"],
        "ADULTE": ["Grand", "Travail", "Majeur", "Vieux", "Parents", "Responsable", "Enfant", "Grandir", "Âge", "Permis", "Voiture", "Maison", "Argent", "Facture", "Sérieux", "Problème", "Fatigue", "Liberté", "Choix", "Dix-huit"],
        "RESSUSCITÉ": ["Vie", "Mort", "Revenir", "Miracle", "Vivant", "Dieu", "Jésus", "Pâques", "Magie", "Sortilège", "Réveil", "Tombe", "Ouvrir", "Zombie", "Monstre", "Impossible", "Croyance", "Religion", "Âme", "Corps"],
        "TUER": ["Mort", "Arme", "Crime", "Fin", "Sang", "Méchant", "Assassin", "Pistolet", "Couteau", "Poison", "Police", "Prison", "Victime", "Cacher", "Corps", "Guerre", "Combat", "Monstre", "Jeu", "Vie"],
        "JOUR DE L'AN": ["Fête", "Janvier", "Champagne", "Minuit", "Résolution", "Année", "Nouveau", "Début", "Amis", "Famille", "Repas", "Soirée", "Danser", "Musique", "Décompte", "Bruit", "Feu d'artifice", "Célébrer", "Joie", "Vœux"],
        "NOËL": ["Cadeau", "Sapin", "Décembre", "Fête", "Neige", "Famille", "Père", "Rouge", "Blanc", "Barbe", "Traineau", "Renne", "Cheminée", "Repas", "Dinde", "Bûche", "Chocolat", "Étoile", "Lumière", "Joie"],
        "JUSTICE": ["Loi", "Tribunal", "Juge", "Droit", "Équitable", "Police", "Avocat", "Prison", "Punition", "Crime", "Coupable", "Innocent", "Balance", "Aveugle", "Égalité", "Société", "Règle", "Respect", "Ordre", "Vérité"],
        "LOI": ["Règle", "Justice", "Police", "Interdit", "Droit", "Respecter", "Société", "Gouvernement", "Voter", "Texte", "Livre", "Code", "Punition", "Amende", "Prison", "Juge", "Avocat", "Ordre", "Obligation", "Autoriser"],
        "VÉRITÉ": ["Vrai", "Dire", "Réalité", "Honnête", "Mensonge", "Croire", "Preuve", "Savoir", "Découvrir", "Secret", "Cacher", "Révéler", "Juste", "Exact", "Faux", "Tromper", "Confiance", "Œil", "Lumière", "Nu"],
        "MENSONGE": ["Faux", "Cacher", "Vérité", "Tromper", "Menteur", "Dire", "Inventer", "Histoire", "Secret", "Trahison", "Confiance", "Perdre", "Nez", "Pinocchio", "Allonger", "Découvrir", "Peur", "Punition", "Mal", "Illusion"],
        "FORCE": ["Muscle", "Puissant", "Fort", "Lourd", "Physique", "Bras", "Soulever", "Pousser", "Tirer", "Casser", "Détruire", "Guerre", "Armée", "Mental", "Courage", "Résister", "Faiblesse", "Héros", "Pouvoir", "Énergie"],
        "FAIBLESSE": ["Fragile", "Fatigue", "Force", "Malade", "Corps", "Tomber", "Casser", "Doux", "Peur", "Lâche", "Pleurer", "Aide", "Besoin", "Mental", "Physique", "Défaut", "Point", "Vulnérable", "Attaquer", "Protéger"],
        "COURAGE": ["Peur", "Brave", "Héros", "Oser", "Fort", "Action", "Danger", "Risque", "Affronter", "Avancer", "Cœur", "Lion", "Force", "Mental", "Lâcheté", "Fuir", "Sauver", "Guerre", "Bataille", "Valeur"],
        "LÂCHETÉ": ["Peur", "Fuir", "Cacher", "Courage", "Honte", "Faible", "Danger", "Reculer", "Abandonner", "Trahir", "Ami", "Égoïste", "Sauver", "Peau", "Défaut", "Mépriser", "Juger", "Secret", "Mensonge", "S'échapper"],
        "INTELLIGENCE": ["Cerveau", "Malin", "Comprendre", "Génie", "Réfléchir", "Tête", "Savoir", "Apprendre", "École", "Livre", "Idée", "Solution", "Problème", "Logique", "Test", "QI", "Fort", "Penser", "Raison", "Esprit"],
        "SAGESSE": ["Vieux", "Intelligent", "Calme", "Penser", "Savoir", "Raison", "Expérience", "Âge", "Zen", "Moine", "Méditer", "Conseil", "Parler", "Écouter", "Livre", "Philosophie", "Comprendre", "Temps", "Doux", "Paix"],
        "GÉNIE": ["Intelligent", "Cerveau", "Idée", "Fort", "Talent", "Lampe", "Vœu", "Bleu", "Magie", "Einstein", "Inventer", "Créer", "Folie", "Solution", "Comprendre", "Maths", "Science", "Unique", "Rare", "Rapide"],
        "TALENT": ["Don", "Fort", "Réussir", "Doué", "Art", "Facile", "Travail", "Chant", "Danse", "Sport", "Montrer", "Public", "Unique", "Spécial", "Naturel", "Compétence", "Briller", "Star", "Impressionnant", "Bravo"],
        "BIEN": ["Bon", "Mal", "Gentil", "Action", "Positif", "Vertu", "Aider", "Amour", "Paix", "Dieu", "Ange", "Paradis", "Juste", "Vrai", "Heureux", "Sourire", "Partager", "Donner", "Réussir", "Bravo"],
        "MAL": ["Mauvais", "Bien", "Douleur", "Méchant", "Négatif", "Diable", "Démon", "Enfer", "Tuer", "Voler", "Mentir", "Triste", "Malade", "Blesser", "Souffrir", "Crime", "Noir", "Sombre", "Peur", "Danger"],
        "RAISON": ["Tête", "Penser", "Logique", "Folie", "Cerveau", "Vrai", "Tort", "Comprendre", "Expliquer", "Argument", "Calme", "Science", "Mathématiques", "Preuve", "Juste", "Savoir", "Intelligent", "Philosophie", "Juger", "Équilibre"],
        "FOLIE": ["Fou", "Tête", "Raison", "Bizarre", "Malade", "Asile", "Crier", "Rire", "Danger", "Absurde", "Illogique", "Perdu", "Contrôle", "Hôpital", "Médicament", "Génie", "Action", "Risque", "Bruit", "Psychiatre"],
        "PAIX": ["Guerre", "Calme", "Colombe", "Tranquille", "Monde", "Accord", "Traité", "Amour", "Amitié", "Fin", "Blanc", "Drapeau", "Harmonie", "Sérénité", "Sans", "Bruit", "Arme", "Joie", "Repos", "Unis"],
        "GUERRE": ["Armée", "Arme", "Paix", "Mort", "Combat", "Conflit", "Soldat", "Tuer", "Sang", "Bombe", "Explosion", "Destruction", "Pays", "Gagner", "Perdre", "Haine", "Histoire", "Avion", "Tank", "Fusil"],
        "VICTOIRE": ["Gagner", "Premier", "Coupe", "Joie", "Réussir", "Champion", "Fête", "Médaille", "Or", "Sourire", "Cri", "Succès", "Bataille", "Guerre", "Jeu", "Fin", "Récompense", "Heureux", "Bravo", "V"],
        "DÉFAITE": ["Perdre", "Triste", "Dernier", "Match", "Échec", "Jeu", "Pleurer", "Abandonner", "Zéro", "Fin", "Déception", "Colère", "Honte", "Essayer", "Recommencer", "Guerre", "Bataille", "Mal", "Tombé", "Vaincu"],
        "ALTRUISME": ["Généreux", "Aider", "Autres", "Donner", "Bien", "Qualité", "Partager", "Cœur", "Amour", "Gentil", "Bonté", "Sacrifice", "Égocentrisme", "Soin", "Penser", "Argent", "Temps", "Bénévolat", "Main", "Sourire"],
        "ÉGOCENTRISME": ["Soi", "Égoïste", "Moi", "Défaut", "Centre", "Penser", "Narcissique", "Seul", "Garder", "Miroir", "Oublier", "Autres", "Orgueil", "Vanité", "Prendre", "Attention", "Monde", "Tourner", "Image", "Fier"],
        "RÊVE": ["Dormir", "Nuit", "Tête", "Imaginer", "Bien", "Illusion", "Lit", "Sommeil", "Étoile", "Nuage", "Voler", "Impossible", "Objectif", "Avenir", "Magie", "Fantaisie", "Inconscient", "Cauchemar", "Doux", "Espoir"],
        "CAUCHEMAR": ["Peur", "Dormir", "Nuit", "Mauvais", "Rêve", "Réveil", "Monstre", "Sombre", "Crier", "Sueur", "Sursaut", "Inconscient", "Fantôme", "Noir", "Danger", "Fuir", "Tomber", "Lit", "Horreur", "Terrible"],
        "DIEU": ["Ciel", "Prier", "Religion", "Créateur", "Paradis", "Croire", "Église", "Diable", "Tout-puissant", "Homme", "Jésus", "Bible", "Foi", "Amour", "Divin", "Miracle", "Invisible", "Esprit", "Pitié", "Lumière"],
        "DIABLE": ["Enfer", "Feu", "Mal", "Rouge", "Cornes", "Démon", "Dieu", "Méchant", "Tentation", "Péché", "Fourche", "Sous-terre", "Flamme", "Punition", "Religion", "Horreur", "Monstre", "Âme", "Vendre", "Pacte"],
        "ANGE": ["Ciel", "Ailes", "Paradis", "Blanc", "Dieu", "Bien", "Plume", "Voler", "Gardien", "Protéger", "Auréole", "Magie", "Religion", "Pur", "Innocent", "Gentil", "Nuage", "Lumière", "Doux", "Messager"],
        "DÉMON": ["Enfer", "Mal", "Monstre", "Diable", "Peur", "Créature", "Rouge", "Cornes", "Ange", "Posséder", "Nuit", "Cauchemar", "Ombre", "Méchant", "Feu", "Sorcellerie", "Esprit", "Vaincre", "Obscur", "Horreur"],
        "PARADIS": ["Ciel", "Ange", "Bien", "Dieu", "Mort", "Nuage", "Enfer", "Religion", "Paix", "Éternité", "Beau", "Parfait", "Jardin", "Récompense", "Bonheur", "Lumière", "Blanc", "Joie", "Amour", "Voler"],
        "ENFER": ["Feu", "Diable", "Mal", "Punition", "Chaud", "Sous-terre", "Paradis", "Démon", "Rouge", "Flamme", "Souffrance", "Mort", "Religion", "Péché", "Brûler", "Douleur", "Éternité", "Sombre", "Peur", "Torture"],
        "PURGATOIRE": ["Milieu", "Enfer", "Paradis", "Attente", "Âme", "Religion", "Nettoyer", "Punition", "Temps", "Patienter", "Passage", "Dieu", "Purifier", "Péché", "Ciel", "Transition", "Douleur", "Prière", "Jugement", "Balance"],
        "SECRET": ["Cacher", "Mot", "Dire", "Personne", "Mystère", "Chut", "Promesse", "Confiance", "Révéler", "Oreille", "Chuchoter", "Enigme", "Trésor", "Code", "Clé", "Enfermer", "Mot de passe", "Ombre", "Garder", "Taire"],
        "MYSTÈRE": ["Inconnu", "Secret", "Cacher", "Trouver", "Étrange", "Question", "Énigme", "Enquête", "Détective", "Bizarre", "Magie", "Fantôme", "Ombre", "Brouillard", "Résoudre", "Nuit", "Sombre", "Curiosité", "Indice", "Clé"],
        "CUBE": ["Forme", "Carré", "3D", "Bloc", "Géométrie", "Faces", "Six", "Dé", "Jouet", "Rubik", "Volume", "Mathématiques", "Boîte", "Angle", "Droit", "Glaçon", "Minecraft", "Plastique", "Construire", "Solide"],
        "PYRAMIDE": ["Égypte", "Triangle", "Monument", "Désert", "Pharaon", "Forme", "3D", "Pointu", "Tombeau", "Momie", "Sable", "Géométrie", "Base", "Carré", "Mystère", "Ancien", "Construction", "Sphinx", "Soleil", "Secret"],
        "CARRÉ": ["Forme", "Quatre", "Géométrie", "Côtés", "Angles", "Égal", "Plat", "Dessin", "Boîte", "Mathématiques", "Règle", "Droit", "Ligne", "Papier", "Cahier", "Parfait", "Rubik", "Face", "Dé", "Rouge"],
        "RECTANGLE": ["Forme", "Long", "Géométrie", "Côtés", "Cahier", "Angles", "Plat", "Quatre", "Porte", "Téléphone", "Écran", "Table", "Mathématiques", "Droit", "Ligne", "Inégal", "Boîte", "Brique", "Papier", "Dessin"],
        "CHANCE": ["Gagner", "Hasard", "Bien", "Loto", "Destin", "Bol", "Trèfle", "Fer à cheval", "Jeu", "Succès", "Réussir", "Heureux", "Opportunité", "Casino", "Dés", "Tomber", "Croiser", "Probabilité", "Super", "Vie"],
        "HASARD": ["Aléatoire", "Chance", "Destin", "Imprévu", "Dés", "Tirer", "Loto", "Roulette", "Sort", "Prévoir", "Impossible", "Surprise", "Rencontre", "Jeu", "Coin", "Coïncidence", "Inattendu", "Choix", "Billet", "Vie"],
        "PROBABILITÉ": ["Maths", "Hasard", "Chance", "Pourcentage", "Calcul", "Possible", "Impossible", "Loto", "Jeu", "Risque", "Prévoir", "Statistique", "Événement", "Dés", "Chiffre", "Science", "Pile", "Face", "Certain", "Doute"],
        "KARMA": ["Destin", "Action", "Conséquence", "Retour", "Bien", "Mal", "Bouddhisme", "Justice", "Univers", "Équilibre", "Vengeance", "Payer", "Récompense", "Spirituel", "Roue", "Vie", "Philosophie", "Croyance", "Énergie", "Tourner"],
        "MALCHANCE": ["Perdre", "Hasard", "Triste", "Noir", "Problème", "Chat", "Échelle", "Vendredi 13", "Miroir", "Casser", "Sel", "Poissard", "Sort", "Destin", "Échec", "Tomber", "Malheur", "Accident", "Douleur", "Tristesse"],
        "HOMME": ["Garçon", "Monsieur", "Humain", "Genre", "Père", "Personne", "Frère", "Époux", "Masculin", "Barbe", "Muscle", "Force", "Travail", "Monde", "Égalité", "Voix", "Amour", "Costume", "Guerre", "Chef"],
        "FEMME": ["Fille", "Dame", "Humain", "Genre", "Mère", "Personne", "Sœur", "Épouse", "Féminin", "Robe", "Cheveux", "Beauté", "Maternité", "Forte", "Droits", "Égalité", "Monde", "Travail", "Voix", "Amour"],
        "GENRE": ["Homme", "Femme", "Identité", "Sexe", "Humain", "Différence", "Garçon", "Fille", "Masculin", "Féminin", "Société", "Catégorie", "Neutre", "Égalité", "Type", "Forme", "Style", "Biologie", "Choix", "Prénom"],
        "SEXE": ["Amour", "Lit", "Intime", "Adultes", "Plaisir", "Nature", "Homme", "Femme", "Biologie", "Bébé", "Reproduction", "Désir", "Passion", "Secret", "Corps", "Nu", "Embrasser", "Action", "Préservatif", "PG18"],
        "ABSTINENCE (PG18)": ["Rien", "Attendre", "Choix", "Zéro", "Sexe", "Patience", "Religion", "Chasteté", "Prier", "Lit", "Seul", "Promesse", "Vertu", "Refus", "Non", "Pur", "Esprit", "Moine", "Prêtre", "Corps"],
        "IMMIGRATION": ["Voyage", "Pays", "Frontière", "Étranger", "Changer", "Vie", "Passeport", "Valise", "Avion", "Bateau", "Nouvelle", "Travail", "Déménager", "Maison", "Douane", "Langue", "Culture", "Quitter", "Arriver", "Monde"],
        "VOYAGE": ["Partir", "Vacances", "Avion", "Pays", "Loin", "Valise", "Train", "Bateau", "Voiture", "Découvrir", "Touriste", "Hôtel", "Mer", "Monde", "Billet", "Passeport", "Bagage", "Sac", "Route", "Aventure"],
        "CENSURE": ["Interdit", "Cacher", "Couper", "Silence", "Secret", "Médias", "Télé", "Radio", "Presse", "Dictature", "Loi", "Barre", "Bip", "Flou", "Politique", "Film", "Mots", "Image", "Liberté", "Bloquer"],
        "DÉSINFORMATION": ["Faux", "Mensonge", "Infos", "Internet", "Tromper", "Cacher", "Vérité", "Médias", "Manipulation", "Complot", "Article", "Croire", "Réseau", "Social", "Danger", "Politique", "Nouvelles", "Titre", "Partager", "Rumeur"],
        "PROBLÈME": ["Souci", "Grave", "Question", "Difficile", "Solution", "Erreur", "Panne", "Mathématiques", "École", "Réfléchir", "Tête", "Stress", "Ennui", "Aide", "Bloqué", "Casser", "Gênant", "Inquiétude", "Réparer", "Vie"],
        "SOLUTION": ["Réponse", "Trouver", "Problème", "Fin", "Idée", "Réussir", "Réparer", "Clé", "Magie", "Eurêka", "Comprendre", "Facile", "Évident", "Test", "Aide", "Sortie", "Échapper", "Mathématiques", "Génie", "Mystère"],
        "CHINOIS": ["Asie", "Langue", "Pays", "Riz", "Pékin", "Muraille", "Rouge", "Dragon", "Panda", "Baguettes", "Mandarin", "Thé", "Nouilles", "Nems", "Population", "Grand", "Drapeau", "Empereur", "Caractères", "Mots"],
        "JAPONAIS": ["Asie", "Langue", "Pays", "Sushi", "Tokyo", "Manga", "Animé", "Samouraï", "Ninja", "Soleil", "Île", "Katana", "Kimono", "Sakura", "Cerisier", "Mont Fuji", "Train", "Technologie", "Riz", "Baguettes"],
        "GREC": ["Langue", "Antique", "Dieux", "Pays", "Europe", "Athènes", "Mythologie", "Zeus", "Salade", "Bleu", "Blanc", "Ruines", "Îles", "Philosophie", "Mer", "Méditerranée", "Histoire", "Sparte", "Olympique", "Alphabet"],
        "LATIN": ["Langue", "Vieux", "Romain", "Mort", "Mots", "Rome", "Église", "Empereur", "Antique", "Italie", "Jules César", "Histoire", "Collège", "Apprendre", "Traduire", "Racine", "Empire", "Gladiateur", "Toge", "Savant"],
        "ARABE (LANGUE)": ["Langue", "Mots", "Alphabet", "Parler", "Pays", "Écrire", "Droite", "Gauche", "Calligraphie", "Orient", "Maghreb", "Désert", "Coran", "Religion", "Musulman", "Poésie", "Chant", "Son", "Communication", "Dialecte"],
        "ARABE": ["Personne", "Origine", "Culture", "Pays", "Langue", "Orient", "Maghreb", "Désert", "Chameau", "Soleil", "Couscous", "Musulman", "Thé", "Menthe", "Chicha", "Histoire", "Peuple", "Hospitalité", "Tente", "Sable"],
        "JUIF": ["Religion", "Culture", "Croyance", "Peuple", "Hébreu", "Israël", "Synagogue", "Kippa", "Chabbat", "Torah", "Étoile", "David", "Fête", "Jérusalem", "Histoire", "Ancien", "Livre", "Prière", "Tradition", "Communauté"],
        "BLANC": ["Couleur", "Clair", "Neige", "Lait", "Nuage", "Noir", "Papier", "Colombe", "Paix", "Pur", "Propre", "Robe", "Mariage", "Dent", "Os", "Fantôme", "Hiver", "Lumière", "Peinture", "Vide"],
        "NOIR": ["Couleur", "Sombre", "Nuit", "Corbeau", "Ombre", "Blanc", "Peur", "Ténèbres", "Chat", "Malheur", "Deuil", "Triste", "Vêtement", "Encre", "Espace", "Trou", "Cacher", "Négatif", "Café", "Pétrole"],
        "ARGENT": ["Billet", "Payer", "Riche", "Pièce", "Banque", "Acheter", "Monnaie", "Or", "Métal", "Cher", "Prix", "Magasin", "Économie", "Portefeuille", "Carte", "Chèque", "Salaire", "Travail", "Compte", "Bijou"],
        "OR": ["Bijou", "Jaune", "Riche", "Métal", "Valeur", "Lingot", "Cher", "Argent", "Monnaie", "Pièce", "Bague", "Collier", "Mine", "Chercher", "Briller", "Lourd", "Médaille", "Premier", "Gagner", "Champion"],
        "DROITE": ["Côté", "Main", "Direction", "Politique", "Inverse", "Sens", "Gauche", "Flèche", "Tourner", "Conduire", "Écrire", "Volant", "Correct", "Chemin", "Bout", "Droitier", "Œil", "Oreille", "Pied", "Moitié"],
        "GAUCHE": ["Côté", "Main", "Direction", "Politique", "Inverse", "Sens", "Droite", "Flèche", "Tourner", "Conduire", "Gaucher", "Maladroit", "Chemin", "Bout", "Œil", "Oreille", "Pied", "Moitié", "Volant", "Cœur"],
        "FICTIF": ["Faux", "Imaginaire", "Inventé", "Histoire", "Rêve", "Créé", "Réel", "Personnage", "Film", "Livre", "Illusion", "Esprit", "Magie", "Impossible", "Mensonge", "Fantaisie", "Inexistant", "Dessin", "Conte", "Non"],
        "RÉEL": ["Vrai", "Exister", "Monde", "Vérité", "Concret", "Vie", "Fictif", "Toucher", "Voir", "Preuve", "Réalité", "Physique", "Présent", "Fait", "Solide", "Nature", "Univers", "Sûr", "Certain", "Exact"],
        "DERNIER": ["Fin", "Perdant", "Queue", "Position", "Après", "Course", "Premier", "Ligne", "Attendre", "Tard", "Clôture", "Ultime", "Zéro", "Finir", "Fermer", "Dos", "Reste", "Seul", "Temps", "Bilan"],
        "PREMIER": ["Gagnant", "Début", "Tête", "Avant", "Position", "Course", "Dernier", "Médaille", "Or", "Champion", "Ligne", "Départ", "Un", "Meilleur", "Devant", "Vite", "Chef", "Commencer", "Numéro", "Victoire"],
        "DERNIÈRE": ["Fin", "Fille", "Position", "Après", "Queue", "Ultime", "Femme", "Course", "Perdante", "Retard", "Attente", "Fermeture", "Reste", "Tard", "Zéro", "Clôture", "Finir", "Dos", "Temps", "Bilan"],
        "DEUXIÈME": ["Après", "Position", "Suivant", "Course", "Médaille", "Place", "Argent", "Podium", "Milieu", "Numéro", "Deux", "Second", "Runner-up", "Ordre", "Classement", "Derrière", "Suivre", "Vite", "Presque"],
        "BÉLIER": ["Signe", "Zodiaque", "Cornes", "Animal", "Mois", "Astrologie", "Mouton", "Tête", "Frapper", "Mars", "Avril", "Feu", "Ciel", "Étoile", "Caractère", "Fort", "Têtu", "Ferme", "Laine", "Mâle"],
        "CAPRICORNE": ["Signe", "Zodiaque", "Cornes", "Astrologie", "Mois", "Hiver", "Animal", "Chèvre", "Terre", "Décembre", "Janvier", "Caractère", "Sérieux", "Froid", "Ciel", "Étoile", "Symbole", "Montagne", "Grimper", "Naissance"],
        "TAUREAU": ["Cornes", "Vache", "Rouge", "Arène", "Ferme", "Animal", "Signe", "Zodiaque", "Astrologie", "Mois", "Mai", "Terre", "Fort", "Lourd", "Bête", "Étoile", "Ciel", "Charge", "Têtu", "Espagne"],

        // 🤪 Délires & Inside Jokes
        "ROMAN": ["Sergine", "Prénom", "Pote", "Homme", "Mec", "Ami", "Blague", "Groupe", "Rire", "Soirée", "Connaissance", "Nom", "Inside", "Joke", "Habitude", "Parler", "Secret", "Humour", "Nous", "Private"],
        "SERGINE": ["Jaune", "Pote", "Personne", "Nom", "Rire", "Groupe", "Roman", "Fille", "Femme", "Connaissance", "Inside", "Joke", "Ami", "Blague", "Soirée", "Secret", "Humour", "Nous", "Private", "Habitude"],
        "ELIAS": ["Miguel", "Prénom", "Pote", "Joueur", "Mec", "Groupe", "Homme", "Ami", "Blague", "Rire", "Soirée", "Connaissance", "Nom", "Inside", "Joke", "Secret", "Humour", "Pieds", "Nous", "Private"],
        "MIGUEL": ["Elias", "Prénom", "Pote", "Pieds", "Mec", "Groupe", "Homme", "Ami", "Blague", "Rire", "Soirée", "Nom", "Inside", "Joke", "Odeur", "Secret", "Humour", "Agréable", "Nous", "Private"],
        "LES PIEDS DE MIGUEL": ["Odeur", "Orteils", "Chaussure", "Miguel", "Blague", "Rire", "Agréable", "Chaussette", "Sentir", "Puer", "Sale", "Propre", "Laver", "Nez", "Secret", "Joke", "Groupe", "Ami", "Soirée", "Humour"],
        "ODEUR AGRÉABLE": ["Sentir", "Parfum", "Fleur", "Nez", "Bon", "Pieds", "Miguel", "Blague", "Rire", "Joke", "Ironie", "Sale", "Propre", "Respirer", "Dégoût", "Savon", "Air", "Poubelle", "Humour", "Secret"],
        "LA MER": ["Eau", "Vagues", "Bleu", "Plage", "Sel", "Mère", "Océan", "Sable", "Nager", "Vacances", "Soleil", "Été", "Poisson", "Bateau", "Maman", "Blague", "Jeu de mots", "Rire", "Confondre", "Son"],
        "MÈRE": ["Maman", "Parent", "Famille", "Femme", "Enfant", "Mer", "Eau", "Vagues", "Plage", "Bleu", "Océan", "Blague", "Jeu de mots", "Confondre", "Son", "Rire", "Amour", "Maison", "Protéger", "Bébé"],
        "MAÎTRE": ["Prof", "École", "Chef", "Chien", "Jedi", "Mètre", "Mesurer", "Règle", "Distance", "Taille", "Jeu de mots", "Confondre", "Son", "Blague", "Rire", "Classe", "Apprendre", "Savoir", "Dominer", "Yoda"],
        "MÈTRE": ["Mesurer", "Taille", "Distance", "Règle", "Centimètre", "Maître", "École", "Prof", "Chef", "Chien", "Bricolage", "Outil", "Longueur", "Jeu de mots", "Confondre", "Son", "Blague", "Rire", "Chiffre", "Bande"],
        "PAIRE": ["Deux", "Chaussure", "Chaussette", "Couple", "Double", "Père", "Papa", "Parent", "Homme", "Famille", "Jeu de mots", "Confondre", "Son", "Blague", "Rire", "Jumeaux", "Ensemble", "Gants", "Lunettes", "Inséparable"],
        "PÈRE": ["Papa", "Parent", "Famille", "Homme", "Enfant", "Paire", "Deux", "Chaussure", "Chaussette", "Double", "Jeu de mots", "Confondre", "Son", "Blague", "Rire", "Maman", "Protéger", "Maison", "Fils", "Fille"],
        "CHIER": ["Toilettes", "Caca", "Besoin", "Odeur", "Ventre", "Péter", "Toilette", "Papier", "Sale", "Bruit", "Digérer", "Trône", "Soulager", "Quotidien", "Manger", "Intestin", "Humour", "Blague", "Vulgaire", "Pressé"],
        "PÉTER": ["Bruit", "Odeur", "Gaz", "Ventre", "Fesses", "Chier", "Caca", "Toilettes", "Sale", "Digérer", "Rire", "Blague", "Humour", "Vulgaire", "Enfant", "Éclater", "Ballon", "Air", "Respirer", "Caché"],
        "CACA": ["Toilettes", "Besoin", "Marron", "Odeur", "Papier", "Pipi", "Chier", "Péter", "Sale", "Enfant", "Humour", "Blague", "Rire", "Digérer", "Ventre", "Cuvette", "Tirer", "Chasse", "Quotidien", "Animal"],
        "PIPI": ["Jaune", "Toilettes", "Eau", "Besoin", "Boire", "Caca", "Uriner", "Toilettes", "Sale", "Enfant", "Humour", "Blague", "Rire", "Ventre", "Vessie", "Tirer", "Chasse", "Quotidien", "Pressé", "Liquide"],
        "FAUTEUIL ROULANT": ["Assis", "Marcher", "Roues", "Aide", "Handicap", "Pousser", "Hôpital", "Malade", "Vieux", "Béquille", "Chaise", "Avancer", "Moteur", "Handicapé", "Rampe", "Ascenseur", "Accident", "Jambe", "Fatigue", "Métal"],
        "BÉQUILLE": ["Marcher", "Cassé", "Jambe", "Aide", "Bras", "Bois", "Métal", "Fauteuil", "Roulant", "Hôpital", "Docteur", "Plâtre", "Pied", "Cheville", "Douleur", "Accident", "Tomber", "Deux", "Soutenir", "Handicap"],
        "BURJ KHALIFA": ["Dubaï", "Très haut", "Gratte-ciel", "Monument", "Verre", "Ville", "Mia Khalifa", "Blague", "Rire", "Actrice", "Film", "Adulte", "Confondre", "Nom", "Internet", "Jeu de mots", "Humour", "Ciel", "Tour", "Record"],
        "MIA KHALIFA": ["Femme", "Internet", "Lunettes", "Connue", "Adulte", "Actrice", "Burj Khalifa", "Dubaï", "Tour", "Blague", "Rire", "Jeu de mots", "Confondre", "Nom", "Humour", "Vidéo", "Réseaux", "Star", "Secret", "Délires"],
        "DORA L'EXPLORATRICE": ["Dessin animé", "Sac à dos", "Carte", "Fille", "Voyage", "Singe", "Babouche", "Chiper", "Renard", "Anglais", "Télé", "Enfant", "Oui Oui", "Mia Khalifa", "Blague", "Aventure", "Cheveux", "Carré", "Écran", "Chercher"],
        "OUI OUI": ["Dessin animé", "Voiture", "Jaune", "Chapeau", "Grelot", "Enfant", "Dora", "Jouet", "Chauffeur", "Magie", "Ville", "Amis", "Clochette", "Télé", "Rire", "Blague", "Potiron", "Peluche", "Taxi", "Matin"],
        "PHINEAS": ["Dessin animé", "Frère", "Inventer", "Été", "Triangle", "Garçon", "Ferb", "Perry", "Ornithorynque", "Sœur", "Candice", "Jardin", "Projet", "Vacances", "Intelligence", "Rouge", "Tête", "Disney", "Télé", "Génie"],
        "FERB": ["Dessin animé", "Frère", "Vert", "Silence", "Inventer", "Garçon", "Phineas", "Perry", "Ornithorynque", "Outils", "Bricolage", "Cheveux", "Anglais", "Projet", "Vacances", "Disney", "Télé", "Intelligent", "Grand", "Complice"],
        "DR HEINZ DOOFENSHMIRTZ": ["Méchant", "Dessin animé", "Inventeur", "Blouse", "Inator", "Bizarre", "Phineas", "Ferb", "Perry", "Ornithorynque", "Savant", "Fou", "Plan", "Mal", "Échouer", "Rire", "Bruit", "Accent", "Bâtiment", "Ennemi"],
        "MAJOR FRANCIS MONOGRAM": ["Chef", "Espion", "Dessin animé", "Moustache", "Mission", "Écran", "Perry", "Ornithorynque", "Agent", "Secret", "Carl", "Base", "Donner", "Ordre", "Télé", "Disney", "Sérieux", "Lunettes", "Uniforme", "Drôle"],
        "FIN DU MONDE": ["Apocalypse", "Catastrophe", "Dernier", "Mort", "Peur", "Destruction", "Grand", "Terrassement", "Titan", "Anime", "Terre", "Exploser", "Météorite", "Feu", "Zombie", "Fin", "Plus rien", "Survivre", "Ciel", "Dangereux"],
        "GRAND TERRASSEMENT": ["Anime", "Titans", "Destruction", "Marcher", "Monde", "Géant", "Eren", "Mur", "Colossal", "Écraser", "Fin du monde", "Peur", "Sang", "Pied", "Bruit", "Tremblement", "Désespoir", "Histoire", "Manga", "Attaque"],
        "BOUTON ROUGE": ["Appuyer", "Danger", "Explosion", "Guerre", "Urgence", "Alerte", "Sous-marin", "Nucléaire", "Bombe", "Missile", "Interdit", "Doigt", "Bruit", "Fin du monde", "Catastrophe", "Machine", "Peur", "Attention", "Stop", "Panique"],
        "SOUS MARIN NUCLÉAIRE": ["Eau", "Guerre", "Océan", "Arme", "Profond", "Navire", "Bouton rouge", "Bombe", "Missile", "Explosion", "Danger", "Secret", "Armée", "Métal", "Plonger", "Silencieux", "Radar", "Pression", "Marin", "Fin du monde"]
    };

const botIndiceFor = (role, mot, previous = [], previousGlobal = []) => {
  // Normaliser pour comparaison (minuscule + sans accents + sans |||FORCED|||)
  const normalize = (s) => (s || "").toLowerCase()
    .replace(/\|\|\|FORCED\|\|\|/g, " ")
    .replace(/⚡|\(Forcé\)/g, "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .trim();
  const usedGlobal = new Set(previousGlobal.map(normalize).filter(s => s));

  const isUsed = (candidate) => {
    const c = normalize(candidate);
    return usedGlobal.has(c) || previous.some(p => normalize(p) === c);
  };

  if (!mot || mot === "???") {
    const pool = ["Intéressant","Classique","Particulier","Connu","Basique","Courant","Bizarre","Joli","Étrange","Mystérieux","Nuance","Subtil"];
    const avail = pool.filter(i => !isUsed(i));
    return (avail.length ? avail : pool)[Math.floor(Math.random() * (avail.length || pool.length))];
  }
  let targetWord = mot;
  if (mot.includes(" / ")) {
    const [a, b] = mot.split(" / ");
    targetWord = Math.random() < 0.5 ? a : b;
  }
  const pool = BOT_INDICE_CONTEXT[targetWord.toUpperCase()] || ["Intéressant","Particulier","Commun","Spécial"];
  const avail = pool.filter(i => !isUsed(i));
  // Si le pool est épuisé (tout a été dit), on pioche un mot générique non utilisé
  if (!avail.length) {
    const fallback = ["Curieux","Unique","Notable","Classique","Évident","Typique","Varié","Normal","Singulier"];
    const fallbackAvail = fallback.filter(i => !isUsed(i));
    return (fallbackAvail.length ? fallbackAvail : pool)[Math.floor(Math.random() * (fallbackAvail.length || pool.length))];
  }
  return avail[Math.floor(Math.random() * avail.length)];
};

const botVoteFor = (botId, gs, data) => {
  const r = gs.roles[botId];
  if (!r) return null;
  const kicked = gs.kickedPlayers || {};
  const cibles = Object.entries(gs.roles)
    .filter(([pid, rr]) => rr.enVie && !kicked[pid] && pid !== botId && pid !== r.coupleAvec)
    .map(([pid]) => pid);
  if (cibles.length === 0) return null;

  // Distance heuristique fine entre un indice et un mot (0 = parfait, 10 = aucun rapport)
  // Plus c'est bas, plus l'indice "colle" au mot
  const indiceColle = (indice, mot) => {
    if (!indice) return 10; // pas d'indice = très suspect
    if (!mot || mot === "???") return 5;

    // Nettoie l'indice (retire |||FORCED||| et casse accents)
    const ind = indice.toLowerCase()
      .replace(/\|\|\|FORCED\|\|\|/g, " ")
      .replace(/<[^>]*>/g, "")
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .trim();
    const motNorm = mot.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

    // 1. L'indice contient-il directement le mot ? (très rare mais tricheur)
    if (ind.includes(motNorm) || motNorm.includes(ind)) return 0;

    // 2. Match dans le pool d'indices connus du mot ?
    const pool = BOT_INDICE_CONTEXT[mot.toUpperCase()] || [];
    const indWords = ind.split(/\s+/).filter(w => w.length >= 2);
    for (const keyword of pool) {
      const k = keyword.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      // Match exact ou inclusion forte
      for (const w of indWords) {
        if (w === k) return 1; // match exact = collant
        if (w.length >= 3 && (w.includes(k) || k.includes(w))) return 2;
      }
    }

    // 3. Pénalité si l'indice ressemble à du random/touche aléatoire
    // Heuristique : indice composé uniquement de consonnes successives ou très court
    const consonantsOnly = /^[bcdfghjklmnpqrstvwxyz]+$/i;
    const hasVowels = /[aeiouy]/i;
    if (ind.length < 2) return 9;
    if (consonantsOnly.test(ind) || !hasVowels.test(ind)) return 8;
    // Indice avec caractères bizarres (chiffres mélangés, symboles)
    if (/[0-9]{2,}/.test(ind) || /[^a-z\s]{2,}/.test(ind)) return 7;
    // Indice très court (< 3 lettres) sans être un mot réel courant
    if (ind.length <= 2) return 6;

    // 4. Mot "inconnu" dans le pool mais qui a l'air d'un vrai mot français
    // → probable indice Civil légitime que le bot n'a pas dans son dico
    return 4;
  };

  const monMot = r.mot;
  if (monMot === "???" || monMot === null) {
    return cibles[Math.floor(Math.random() * cibles.length)];
  }

  // Mot de référence pour comparer aux indices
  let motRef = monMot;
  if (monMot.includes(" / ")) motRef = monMot.split(" / ")[0];

  const scores = cibles.map(pid => {
    const indice = gs.indices?.[pid];
    const dist = indiceColle(indice, motRef);
    // CIVIL/PARIA : vote contre les plus SUSPECTS (dist élevée = indice qui colle pas au mot civil)
    //   → score = dist (grand = suspect = on vote contre)
    // IMPOSTEUR : vote contre les VRAIS CIVILS (dist basse = indice qui colle au mot civil)
    //   → score = -dist (grand = proche du civil = menaçant)
    const score = r.camp === "CIVIL" ? dist : -dist;
    return { pid, score, dist, hasIndice: !!indice };
  });

  // Priorité : ceux qui ont donné un indice d'abord (sinon pas de jugement possible)
  scores.sort((a, b) => {
    if (a.hasIndice !== b.hasIndice) return a.hasIndice ? -1 : 1;
    return b.score - a.score;
  });

  // Si le meilleur score (= le plus suspect) a une dist anormalement élevée (>= 6 pour CIVIL),
  // on le cible presque à tous les coups (indice bidon quasi sûr)
  if (r.camp === "CIVIL" && scores[0].dist >= 6) {
    return Math.random() < 0.85 ? scores[0].pid : scores[Math.min(1, scores.length - 1)].pid;
  }

  // Sinon, top 40% + un peu de hasard
  const topTier = scores.slice(0, Math.max(1, Math.ceil(scores.length * 0.4)));
  return topTier[Math.floor(Math.random() * topTier.length)].pid;
};

// ======================================================================
// RENDER SCORES — scoreboard modal
// ======================================================================
const fetchScores = async () => {
  if (!currentRoomCode) return { session: {}, global: {} };
  const [sessSnap, globSnap] = await Promise.all([
    get(ref(db, `rooms/${currentRoomCode}/scores_session`)),
    get(ref(db, `scores_general`))
  ]);
  return { session: sessSnap.val() || {}, global: globSnap.val() || {} };
};

const renderScoreboardList = (targetEl, scores, diff = {}, options = {}) => {
  targetEl.innerHTML = "";
  const entries = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) {
    targetEl.innerHTML = '<p style="text-align:center;color:rgba(255,255,255,0.4);font-size:0.85rem;padding:0.5rem 0;">Aucun score pour l\'instant.</p>';
    return;
  }

  const limit = options.limit || 10;
  const showMyPosition = options.showMyPosition !== false;
  const myName_ = myName || "";
  const myIdx = entries.findIndex(([name]) => name === myName_);

  const renderRow = (name, pts, idx) => {
    const row = document.createElement("div");
    const isTop3 = idx < 3;
    const isMe = name === myName_;
    row.className = "score-row" + (isTop3 ? " top" : "") + (isMe ? " me" : "");
    const d = diff[name];
    row.innerHTML = `
      <div class="score-rank">${idx + 1}</div>
      <div class="score-name">${escapeHTML(name)}${isMe ? ' <span style="color:rgba(var(--primary-rgb),1);font-size:0.7rem;">(toi)</span>' : ''}</div>
      ${d ? `<div class="score-diff">+${d}</div>` : ''}
      <div class="score-points">${pts}</div>
    `;
    return row;
  };

  const topEntries = entries.slice(0, limit);
  topEntries.forEach(([name, pts], idx) => {
    targetEl.appendChild(renderRow(name, pts, idx));
  });

  // Si joueur hors top affiché → séparateur + sa ligne
  if (showMyPosition && myIdx >= limit && myIdx !== -1) {
    const sep = document.createElement("div");
    sep.style.cssText = "text-align:center;color:rgba(255,255,255,0.3);font-size:0.7rem;padding:0.5rem 0;letter-spacing:0.2em;font-family:'Space Grotesk',sans-serif;font-weight:800;";
    sep.textContent = "· · ·";
    targetEl.appendChild(sep);
    const [name, pts] = entries[myIdx];
    targetEl.appendChild(renderRow(name, pts, myIdx));
  }
};

const scoresModal = $("#scoresModal");
$("#btnShowScores").addEventListener("click", async () => {
  const s = await fetchScores();
  document.querySelectorAll("[data-scoreboardtab]").forEach(b => b.classList.toggle("active", b.getAttribute("data-scoreboardtab") === "session"));
  renderScoreboardList($("#scoreboardList"), s.session, {}, { limit: 100, showMyPosition: false });
  scoresModal.__data = s;
  scoresModal.classList.add("active");
});
document.querySelectorAll(".btn-close-scores").forEach(b => b.addEventListener("click", () => scoresModal.classList.remove("active")));
scoresModal.addEventListener("click", (e) => {
  if (e.target === scoresModal) scoresModal.classList.remove("active");
});
document.querySelectorAll("[data-scoreboardtab]").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll("[data-scoreboardtab]").forEach(b => b.classList.remove("active"));
    tab.classList.add("active");
    const which = tab.getAttribute("data-scoreboardtab");
    const s = scoresModal.__data || { session: {}, global: {} };
    if (which === "session") {
      renderScoreboardList($("#scoreboardList"), s.session, {}, { limit: 100, showMyPosition: false });
    } else {
      renderScoreboardList($("#scoreboardList"), s.global, {}, { limit: 10, showMyPosition: true });
    }
  });
});

// (Tabs Session/Global retirées des résultats pour optimiser l'espace mobile)


$("#btnCreate").addEventListener("click", createRoom);
$("#btnJoin").addEventListener("click", joinRoom);
$("#btnCopyCode").addEventListener("click", copyCode);
$("#btnLeaveLobby").addEventListener("click", leaveRoom);
$("#btnAddBot").addEventListener("click", addBot);

// Transition lobby → config (host)
$("#btnHostConfig").addEventListener("click", async () => {
  if (!isHost || !currentRoomCode) return;
  // Initialiser la config si absente
  const snap = await get(ref(db, `rooms/${currentRoomCode}/config`));
  if (!snap.exists()) {
    await set(ref(db, `rooms/${currentRoomCode}/config`), defaultConfig());
  }
  await update(ref(db, `rooms/${currentRoomCode}`), { status: "config" });
});

// Auto-uppercase du code
$("#inputCode").addEventListener("input", (e) => {
  e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
});

// Enter pour valider
$("#inputPseudo").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    const code = $("#inputCode").value.trim();
    if (code.length === 4) joinRoom();
    else createRoom();
  }
});
$("#inputCode").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.value.length === 4) joinRoom();
});

// ======================================================================
// BOOT
// ======================================================================
runSplash();

// On tente la reconnexion auto en parallèle du splash
tryAutoReconnect();

// Après le splash, on révèle l'écran approprié si pas de reconnexion auto
setTimeout(() => {
  if (currentRoomCode) return; // déjà reconnecté à un salon online
  if (window.__solo?.isActive?.()) return; // une partie solo a été restaurée par solo.js
  // Si première visite → écran intro règles ; sinon login direct
  if (hasSeenIntro()) {
    showScreen("screen-login");
  } else {
    showScreen("screen-intro-rules");
  }
}, 4500);

  