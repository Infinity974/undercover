/* ==========================================================================
   FIREBASE CONFIG
   --------------------------------------------------------------------------
   Initialise Firebase et exporte les helpers de base de données.
   Tout le module en ligne (online.js) importe `db` et les fonctions Firebase
   depuis ce fichier.
   ========================================================================== */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import {
  getDatabase, ref, set, update, get, onValue, onDisconnect, remove, child, push, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyDHxQ1_vp6P1XKbwxjr4WTVkfqBfum2cdM",
  authDomain: "undercover-c967a.firebaseapp.com",
  databaseURL: "https://undercover-c967a-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "undercover-c967a",
  storageBucket: "undercover-c967a.firebasestorage.app",
  messagingSenderId: "1018963186527",
  appId: "1:1018963186527:web:671a7898225adfcc031cea"
};

export const app = initializeApp(firebaseConfig);
export const db  = getDatabase(app);

// On ré-exporte les utilitaires Firebase pour que tout le code en mode
// "online" puisse les importer depuis ce seul module.
export {
  ref, set, update, get, onValue, onDisconnect, remove, child, push, serverTimestamp
};
