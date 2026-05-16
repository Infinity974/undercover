# Undercover — Édition refactorisée

Le jeu **Undercover** réécrit pour être maintenable, avec un mode hors-ligne
en bonus.

## 🎮 Modes de jeu

### Mode en ligne (Firebase)
Le mode historique. Crée ou rejoins un salon avec un code à 4 lettres.
Toute la logique est dans `js/online.js`.

### 🆕 Mode 1 téléphone (hors-ligne)
Accessible depuis le bouton **📱 Mode 1 téléphone** sur l'écran d'accueil.

Déroulé :
1. **Configuration** — nombre de joueurs (3-20), nombre d'Undercover,
   nombre de Mr White, thème
2. **Distribution** — le téléphone passe de main en main. Chacun tape son
   pseudo, voit son rôle/mot secret, puis rend le téléphone
3. **Ordre de parole** — l'écran affiche l'ordre de parole pour la manche
   (Mr White ne parle jamais en premier puisqu'il ne connaît pas le mot)
4. **Discussion à l'oral** — les joueurs discutent autour de la table
5. **Vote** — un seul tap sur le joueur à éliminer
6. **Reveal** — son rôle et son mot sont dévoilés
7. **Suite** — Mr White éliminé ? Il peut tenter de deviner le mot des
   civils (tolérance de 1-2 caractères selon longueur). Sinon on enchaîne
   sur la manche suivante jusqu'à la victoire d'un camp

Le mode solo est **totalement indépendant de Firebase** : aucune connexion
n'est requise.

## 🧩 Architecture des helpers UI partagés

`online.js` expose un petit objet `window.__undercoverUI` avec
`showScreen`, `showToast`, `showConfirm` et `escapeHTML`. `solo.js` les
réutilise via un getter (`ui()`), ce qui évite la duplication tout en
gardant les deux modes découplés (le solo a un fallback si online n'est
pas encore chargé).

## ⚙️ Conventions

- **Pas de bundler** : tout est en `import`/`export` ES modules natifs.
- **Pas de CSS framework** : utilitaires Tailwind-like recodés dans
  `01-base.css`. Pas de CDN Tailwind (3 Mo économisés).
- **Variables CSS** pour les thèmes (rouge espion par défaut, cyberpunk,
  synthwave...). Modifier `--primary-rgb`, `--secondary-rgb`, etc.
- **Animations** déjà désactivées en mode perf via `html.perf-mode`.

## 🐛 Debug rapide

- Console : `window.__undercoverUI` doit exister (sinon online.js ne s'est
  pas chargé)
- Mode solo : `import("/js/solo.js")` doit résoudre sans erreur
- Firebase : la config est dans `js/firebase-config.js`
