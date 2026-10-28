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
| `js/gameplay/GameEngine.js` | Cœur : scène, entités, `startMatch`, boucle `update`, collisions. Mélange les modules ci-dessous dans son prototype (`Object.assign` en bas du fichier) |
| `js/gameplay/Controls.js` | Clavier, manette, boutons d'action, déplacement du joueur local |
| `js/gameplay/Actions.js` | Dunk, saut/contre, crossover, visée et passes, interceptions, contres, rebonds, contestation |
| `js/gameplay/Ball.js` | Lancement des passes/tirs, trajectoires, ballon libre, paniers et dunks |
| `js/gameplay/Rules.js` | Panier attaqué, mi-temps, remises en jeu, possession, score, messages |
| `js/gameplay/BotAI.js` | IA des bots (`updateBotAI`, `moveEntityTowards`) |
| `js/gameplay/Camera.js` | Caméra 2K / Suivi, `viewFlipped` |
| `js/gameplay/NetSync.js` | État du monde, joueurs distants, actions reçues, départs |
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
  `netlify.toml` et `.netlify/` envoyés à la Corbeille le 28 octobre 2026 avec l'accord du joueur.
- **Jusqu'à 10 joueurs** (28 octobre 2026), réseau en étoile : chaque invité n'est relié qu'à l'hôte (PeerJS).
  - `MAX_PER_TEAM = 5` (`NetworkManager`) : le 11e reçoit `ROOM_FULL` ; passage dans une équipe pleine refusé
    (en local et par l'hôte). Seul l'hôte peut lancer (`startMatch`), et il monte le mode si besoin
    (4 humains dans une équipe en 3v3 → 4v4, 5 → 5v5).
  - Départ d'un invité (fermeture PeerJS, `conn.lobbyPeerId`) : retiré du salon ; en match, l'IA de l'hôte
    reprend son joueur (`handlePlayerLeft`). Départ de l'hôte : message « match terminé » chez les invités.
  - `WORLD_STATE` arrondi au centimètre : ~1,5 Ko en 5v5, ~2 Mbit/s envoyés par l'hôte pour 9 invités.
  - Testé : hôte + 1 vrai invité + 8 invités simulés (instances `NetworkManager` sans 3D, PeerJS seul, importées
    dans un onglet) → 10 joueurs 5/5, 11e refusé, 3v3 → 5v5 avec 10 humains, ~18 états/s reçus par chacun,
    hôte à 145 images/s, départ en match remplacé par l'IA, aucune erreur. Ouvrir 10 onglets 3D sature le
    navigateur intégré (contextes WebGL) : utiliser des invités simulés.
- **5v5 tout-terrain** (28 octobre 2026) : le jeu des deux côtés existait déjà (A attaque au nord, B au sud,
  transitions des bots), mais la caméra regardait toujours le nord : en défense, l'action était derrière elle.
  - `getCameraFocusHoop` : en tout-terrain, la caméra (2K et Suivi) regarde le panier attaqué par l'équipe qui a
    le ballon. `viewFlipped` (caméra tournée vers +Z) inverse clavier et sticks : « haut » = haut de l'écran.
  - Mi-temps : `checkHalftime` (hôte, après chaque panier) → à `ceil(targetScore / 2)` = 15 pts en 5v5,
    `matchRules.sidesSwapped` = vrai, les équipes changent de panier (`getAttackingHoopForTeam`), message
    « MI-TEMPS » à la remise en jeu. Places de remise en jeu retournées selon le panier attaqué (`mirror`).
    `sidesSwapped` est dans `WORLD_STATE`, appliqué avant la remise en jeu chez l'invité.
  - Testé (hôte + invité) : caméra et « haut » retournés quand B attaque, mi-temps à 15-0 identique des deux
    côtés. Pas de fin de match : `targetScore` (21 / 30) ne sert qu'à la mi-temps.
- **Feuille de route** (choisie par le joueur le 28 octobre 2026, dans cet ordre) :
  1. ✅ Réorganiser le code : `GameEngine.js` (1 960 lignes) découpé en 8 fichiers par un script, méthodes
     inchangées (empreinte de chaque fonction identique avant/après), retesté hôte + invité en 5v5.
     Les modules sont des objets de méthodes (`export const XxxMethods = { ... }`) : `this` = le moteur.
     Un getter (comme `isAuthority`) doit rester dans la classe (`Object.assign` ne copie pas les getters).
  2. Graphismes — en cours :
     - ✅ `js/render/RenderSetup.js` : `setupRenderer` (sRGB, tone mapping ACES, RoomEnvironment) sur les 3 scènes,
       `asColorTexture` sur toute texture Canvas de couleur. Étiquettes et écrans : `toneMapped: false`.
       ImportMap : `three/addons/` (examples/jsm de three 0.169).
     - ✅ `CourtScene` : parquet en lattes (`drawWoodPlanks`, graine fixe), `MeshPhysicalMaterial` vernis,
       panneaux LED, tribunes + ~880 spectateurs (2 `InstancedMesh`), écran géant (`updateScoreboard`, appelé par
       `updateScoreboardUI`), rampes de projecteurs. Coût mesuré : ~3 ms par image (≈330 images/s) en 5v5.
     - ✅ Personnages animés Quaternius (CC0, crédits dans `assets/characters/CREDITS.txt`) :
       - `assets/characters/` (~2,1 Mo) : `body_male.glb`, 5 coiffures/barbe (`hair_*.glb`), `animations.glb`
         (11 clips). Préparés par un script gltf-transform + sharp (WebP, peau claire comme base, animations
         triées) à partir des zips gratuits « [Standard] » téléchargés par le joueur dans `_telechargements/`
         (exclu de Git ; seuls les 2 zips y sont gardés, les copies décompressées sont parties à la Corbeille le
         28 octobre 2026 : les redécompresser pour refaire les fichiers). Le corps `.gltf` d'origine référence
         `T_Hair_1_Normal_png.png` et `T_Eye_Normal_png.png` absents du zip : copier les fichiers sans `_png`.
       - `CharacterAssets.js` : chargement (avant `new CourtKingsApp`, 20 s max) et analyse unique du squelette
         (repère haut/avant/côté, redressement, taille 2 m). Le corps est au repos en **pose en T** (bras à
         l'horizontale). Vêtements (`buildClothing`) : chaque pièce est une fonction f (< 0 = dedans, en tailles
         de personnage) — emmanchure en ellipse autour de l'épaule (bretelles), encolure en ellipsoïde plus
         profonde devant, ourlets droits ; `clipTriangles` coupe les triangles exactement sur la courbe (poids des
         os mélangés), puis gonflage le long des normales. UV du maillot devant/dos (`jerseyUVs`).
       - `AnimatedCharacter.js` : même interface que `CharacterMesh` (root, selectionRing, dribbleHand, animTime,
         updateAnimation, updateConfig, disposeOwned). Animation choisie selon l'état + la vitesse mesurée ;
         gestes de basket par `aimBone` (bras orientés vers une direction, mélangés à la pose).
         Coiffures pack : buzz, fade_top, long, buns ; barbes pack : full_beard, stubble, goatee, chinstrap.
         `HairStyles.js` fabrique afro, crête, locks et boucles + bandeau autour d'un crâne mesuré (ellipsoïde
         `SKULL` dans le repère de l'ancienne tête, ligne d'implantation `hairlineHeight`) ; crête, locks et
         boucles sont posés sur la coupe rase du pack (`HAIR_BASE_FROM_PACK`). La moustache rétro reprend
         `CharacterMesh.prototype.buildBeard`, posée sur l'os `Head`.
         Mélange d'animations par poids (`playBlend` / `blendActions`, pas des animations de déplacement
         synchronisés) : défense = 30 % accroupi du pack + 70 % debout (`DEFENSE_CROUCH`), une main haute,
         une main basse.
       - `createCharacter.js` : `createCharacterMesh()` = animé si chargé, sinon ancien modèle.
       - Mesuré : 10 joueurs animés en 5v5 ≈ 3,5 ms par image, 176 appels de dessin ; testé hôte + invité.
       - À faire un jour : corps féminin (dans le zip, non utilisé).
     - Piège de mesure : quand la fenêtre de Claude n'est pas visible (contrôle à distance), le navigateur bride
       `requestAnimationFrame` (3 images/s). Mesurer le temps d'une image avec `update()` + `gl.readPixels`.
     - Créateur en fenêtre étroite (< 1150 px) : aperçu 3D en haut sur toute la largeur, panneaux dessous, la page
       défile ; le canvas est en `position: absolute` et suivi par un `ResizeObserver`.
  3. Actions et tactiques une par une : **écrans** (« block » = écran pour le joueur) et pick and roll,
     alley-oop, lay-up, euro step, step-back, fadeaway, rebond offensif, box-out ; fautes et lancers francs,
     chrono des 24 s, fin de match ; défense de zone/individuelle, pressing, systèmes d'attaque.
- **Limites connues** : l'invité est en retard d'environ 50 ms + latence ; si l'hôte quitte, le match s'arrête
  (pas de migration d'hôte) ; PeerJS entre 2 PC pas encore testé.
- La console du navigateur intégré garde les erreurs d'avant un rechargement : pour tester, compter les
  nouvelles erreurs avec `window.addEventListener('error', …)`.
- **Pas encore testé** : manette, dunks, contres, 4v4, tir réussi en maintenant la touche, PeerJS entre 2 PC.
