# Projet : CourtKings 3D — basket 3D multijoueur (navigateur)

## L'utilisateur

- Tout en français (interface, messages). Il n'est pas développeur : expliquer simplement, par étapes
  courtes, et demander avant toute action risquée (suppression, installation).
- PC Windows.

## Stack

- JavaScript « vanilla » (modules ES), **Three.js 0.169** et **PeerJS 1.5.4** chargés par ImportMap (CDN),
  **BroadcastChannel** pour le multijoueur entre onglets d'un même PC.
- Aucune étape de build (pas de Node, pas de Vite).
- Serveur : `server.py` (Python `http.server`, sans dépendance, cache désactivé), port 8080 par défaut
  ou passé en argument : `F:\ProjetAppli\.venv\Scripts\python.exe server.py 8080`, puis `http://localhost:8080`.

## Fichiers

| Fichier | Rôle |
|---|---|
| `index.html` | 3 écrans (Créateur, Salon, Match), ImportMap, HUD |
| `css/styles.css` | Thème sombre « arène 2K », jauges, salon, HUD |
| `js/main.js` | Navigation entre écrans, scène 3D du salon, boucle 60 FPS |
| `js/config/constants.js` | 10 presets, 7 peaux, 7 coiffures, 6 barbes, 5 postes (PG..C), modes 3v3/4v4/5v5 |
| `js/character/CharacterMesh.js` | Personnage 3D procédural (corps, visage, accessoires, animations) |
| `js/character/CharacterBuilder.js` | Créateur + aperçu 3D, sauvegarde `localStorage` |
| `js/court/CourtScene.js` | Demi-terrain (3v3, 4v4) et terrain entier (5v5), paniers, zones 2/3 pts (`threePointRadius = 5.55`) |
| `js/gameplay/ShotMeter.js` | Jauge de tir (fenêtre verte), réussite selon timing, attributs, distance, contestation |
| `js/gameplay/GameEngine.js` | Gameplay, clavier + manette (Gamepad API), dunks, contres, passes visées, IA (`updateBotAI`), règles |
| `js/network/NetworkManager.js` | PeerJS + BroadcastChannel, salons par code (`BASKET-42`, ou `?room=BASKET-42`) |

## Gameplay (résumé)

- Postes : modifient taille 3D, vitesse et plafonds des 4 attributs (`shooting`, `defense`, `dribble`,
  `finishing`), base 60, 80 points à répartir, max 99 selon le poste.
- Clavier : ZQSD/flèches bouger, E passe, Espace (maintenir) tir, R saut/contre, C crossover, F interception,
  Shift sprint/posture, V caméra. Manette : A passe, X tir, Y saut, B crossover/interception, RT sprint, LT posture.
- Dunk si tir à moins de 3,55–4,25 m (selon `finishing`). Interception sur porteur 14–32 %.
- Demi-terrain : check ball en haut de la raquette, « take back » derrière l'arc après rebond défensif ou interception.
- IA : anti-collision 1,05 m (`resolvePlayerCollisions`), coéquipiers `CUT_BASKET` / `POP_OUT` / `PERIMETER`,
  défense individuelle par `slotIndex`, tirs adverses 50–60 %.

## Tests

- 28 octobre 2026 (navigateur intégré de Claude, clavier) : créateur affiché, match 3v3 lancé
  (« Check ball »), déplacement Z, tir Espace (« Trop tôt » en appui bref, normal), passe E, bascule en 5v5
  terrain entier. Aucune erreur dans la console.
- 28 octobre 2026, multijoueur 2 onglets (salon BASKET-18, l'hôte crée, l'invité ouvre `?room=BASKET-18`
  puis va sur l'écran Salon) : salon synchronisé des deux côtés, PeerJS connecté (`peers.size = 1`) en plus
  de BroadcastChannel, match lancé dans les deux onglets par l'hôte. Accès console : `window.courtKingsApp`.
- **Corrigé le 28 octobre 2026** (retesté à 2 onglets : 1 passe envoyée = 1 reçue, aucune erreur) :
  1. `NetworkManager` appelait `callbacks.onGameEvent` au lieu de `onRemoteGameEvent` (nom utilisé par `main.js`) :
     les actions n'étaient jamais reçues.
  2. `resetPositionsForCheckBall` donnait le ballon au joueur local : maintenant au 1er joueur de l'équipe
     en attaque, dans l'ordre du salon (identique dans tous les onglets).
  3. `JOIN_REQUEST` reçu deux fois (BroadcastChannel + PeerJS) : un joueur déjà présent n'est plus recompté.
     Les `GAME_EVENT` portent un `eventId` et les doublons sont ignorés (`seenEventIds`).
  4. Une fois le 1 corrigé, les actions rebondissaient à l'infini (l'onglet qui reçoit une passe la rejouait
     et la renvoyait). Règle : seules les actions du joueur **local** sont envoyées (`broadcast` dans
     `launchPass` / `launchShotBall`, `isLocal` pour STEAL, BLOCK, DUNK_START). Exception : un bot qui passe
     au joueur local à sa demande (`requestPassFromBot`).
- **Autorité de l'hôte (28 octobre 2026)** : `GameEngine.isAuthority` (= `network.isHost`, vrai aussi en solo).
  - L'hôte simule tout (bots, ballon, interceptions de passe, rebonds, paniers, score, take back, remises en jeu)
    et envoie `WORLD_STATE` à 20 Hz (`buildWorldState` : joueurs, ballon, règles, dernier message à l'écran).
  - L'invité (`handleWorldState`) ne simule que son joueur, lisse les autres vers `ent.netPos`, et se replace
    quand `matchRules.checkBallSeq` change. Il envoie `PLAYER_STATE` et ses actions (`GAME_EVENT`).
  - Contres : décidés par l'écran du joueur qui saute (l'hôte pour les bots) ; rebonds : toujours l'hôte.
    L'hôte ignore une passe ou un tir d'un joueur qui n'a plus le ballon.
  - `showRuleAlert(msg, shareWithGuests)` : caméra et manette ne sont pas recopiées chez l'invité.
  - Testé à 2 onglets : bots aux mêmes positions, panier de l'hôte (2-0) et de l'invité (3 pts → 2-3) comptés
    pareil des deux côtés, remises en jeu suivies, aucune erreur.
- **Bug d'origine corrigé** : un panier réussi était recompté à chaque image pendant 1,2 s (346 points pour un tir).
  `resolveShotAtRim` fait maintenant tomber le ballon à travers le filet (état `LOOSE`).
- **Test dans le navigateur intégré** : si le panneau est masqué, `requestAnimationFrame` ne tourne pas
  (0 image/s) ; l'afficher et mettre l'onglet de l'hôte devant.
- **Codes de salon** (28 octobre 2026) : `BASKET-` + 4 caractères sans 0/O/1/I/L (~700 000 codes), pour ne pas
  croiser d'autres joueurs sur le serveur PeerJS public.
- **En ligne sur GitHub Pages** (28 octobre 2026) : **https://quentsea.github.io/courtkings-3d/**
  - Dépôt public `QuentSea/courtkings-3d` (branche `main`, racine publiée telle quelle). Ce dossier est un dépôt
    Git (identité locale `QuentSea` + adresse noreply GitHub). Git, GitHub CLI et Node.js 24 installés via winget
    (`C:\Program Files\Git\cmd\git.exe`, `C:\Program Files\GitHub CLI\gh.exe`).
  - **Mettre à jour le jeu en ligne** : commit puis `git push` ; GitHub Pages republie en ~1 min
    (suivi : `gh api repos/QuentSea/courtkings-3d/pages/builds/latest --jq .status`).
  - Testé en ligne : invité branché **uniquement par PeerJS** (BroadcastChannel coupé) → salon, match, panier
    2-0 et remise en jeu identiques des deux côtés, aucune erreur.
  - Le lien rapide du salon prend l'adresse de la page (`origin + pathname`) : il marche tel quel en ligne.
- **Netlify abandonné** : site `courtkings-3d` créé mais vide (publication refusée : crédits du compte épuisés).
  `netlify.toml` reste dans le dossier, sans effet sur GitHub Pages.
- **Limites connues** : l'invité est en retard d'environ 50 ms + latence ; si l'hôte quitte, le match s'arrête
  (pas de migration d'hôte) ; PeerJS entre 2 PC pas encore testé.
- La console du navigateur intégré garde les erreurs d'avant un rechargement : pour tester, compter les
  nouvelles erreurs avec `window.addEventListener('error', …)`.
- **Pas encore testé** : manette, dunks, contres, 4v4, tir réussi en maintenant la touche, PeerJS entre 2 PC.
