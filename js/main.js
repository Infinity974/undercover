/* ==========================================================================
   MAIN — Point d'entrée
   --------------------------------------------------------------------------
   Importe les deux modes :
   - online.js : mode multijoueur en ligne (Firebase)
   - solo.js   : mode 1 téléphone (pass-and-play hors-ligne)

   L'ordre est important : online.js s'initialise en premier et définit les
   helpers d'UI partagés (showScreen, showToast, showConfirm) sur window.
   solo.js les réutilise ensuite.
   ========================================================================== */

import "./online.js";
import "./solo.js";
