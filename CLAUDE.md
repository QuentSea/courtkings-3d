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
| `js/gameplay/Fouls.js` | Fautes (sur tir, en défense, bonus) et lancers francs |
| `js/gameplay/Moves.js` | Lay-up, euro step, alley-oop, step-back, fadeaway, box-out, rebond offensif |
| `js/gameplay/Tactics.js` | Défense individuelle / zone / pressing, systèmes d'attaque, menus du HUD |
| `js/network/NetworkManager.js` | PeerJS + BroadcastChannel, salons par code (`BASKET-42`, ou `?room=BASKET-42`) |

## Gameplay (résumé)

- Postes : modifient taille 3D, vitesse et plafonds des 4 attributs (`shooting`, `defense`, `dribble`,
  `finishing`), base 60, 80 points à répartir, max 99 selon le poste.
- Clavier : ZQSD/flèches bouger, E passe, Espace (maintenir) tir (près du cercle : lay-up, + Shift : dunk), T alley-oop,
  R saut/contre, C crossover (près du cercle : euro step), F interception, Shift sprint/posture (box-out pendant un tir
  adverse), B écran, V caméra. Manette : A passe, X tir, Y saut, B crossover/interception, RT sprint, LT posture.
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
       - Corps féminin (dans le zip, non utilisé) : le joueur n'en veut pas pour le moment (28 octobre 2026).
     - Piège de mesure : quand la fenêtre de Claude n'est pas visible (contrôle à distance), le navigateur bride
       `requestAnimationFrame` (3 images/s). Mesurer le temps d'une image avec `update()` + `gl.readPixels`.
     - Créateur en fenêtre étroite (< 1150 px) : aperçu 3D en haut sur toute la largeur, panneaux dessous, la page
       défile ; le canvas est en `position: absolute` et suivi par un `ResizeObserver`.
     - **Qualité graphique** (`js/render/Quality.js`, `QualityManager` dans `GameEngine.quality`) : Haute (jusqu'à
       2 px par point, ombre 2048), Moyenne (1 px par point, ombre 1024), Basse (70 % des pixels, sans ombres ni
       public). Menu `#hud-quality` dans le HUD du match, choix gardé dans `localStorage` (`courtkings_qualite`).
       « Auto » (défaut) part de Haute et baisse d'un cran si la moyenne passe sous 45 images/s (2 s ignorées
       après un changement, mesure sur 2,5 s, images > 0,25 s ignorées : onglet caché ≠ PC lent). Ne remonte pas.
       Public allégé pour tous (capsule 2×6, tête 7×5 : ~120 triangles au lieu de 412) : 598 k → 376 k triangles.
     - Test « PC moins puissant » (28 octobre 2026) : le PC du joueur (Radeon RX 9070 XT, 32 fils) est trop rapide
       pour juger. Simulé en rendant chaque image artificiellement lente (40 ms par mégapixel + 6 à 10 ms d'ombres)
       → Auto passe en Moyenne à 3,8 s puis Basse à 8,3 s, ~28 → ~77 images/s. Pas testé sur un vrai petit PC.
  3. Actions et tactiques une par une :
     - ✅ **Écrans** (« block » = écran pour le joueur) et pick and roll — `js/gameplay/Screens.js` (28 octobre 2026) :
       - Touche **B** (manette : Rond en attaque sans ballon, ou L1) : sans ballon, poser un écran (état `'SCREEN'`,
         2,2 s maxi, bouger après 0,45 s le lève) ; avec ballon, en demander un (`callForScreen`, événement
         `SCREEN_CALL` vers l'hôte pour un invité).
       - Collision (`resolveScreenCollision`, appelée par `resolvePlayerCollisions`) : l'écran ne recule pas,
         l'adversaire est tenu à 1,2 m et ralenti à 30 % pendant 0,95 s (`screenedTimer`) ; il conteste à 40 %.
         Anneau orange au sol (`updateScreenMarker`), bras croisés (`AnimatedCharacter`, aperçu « Écran » du créateur).
       - Pick and roll des bots (hôte) : `startPickAndRoll` → `bot.pnr` phases GO (aller sur le défenseur du
         porteur), SET (écran), puis ROLL vers le panier ou POP à 3 pts si tir ≥ 84 ; le bot porteur attend, frôle
         l'écran et sert le rouleur s'il est libre. Lancé seul (`updateScreens`, cooldown 8–13 s, 35 % si porteur
         bot, 12 % si humain, porteur entre 4,5 et 10 m du panier). Défense : switch possible (`switchManId`,
         `getAssignedMan`). Tout est remis à zéro à chaque remise en jeu.
       - Testé : écran à la main, pick and roll demandé (défenseur bloqué, 2 m d'avance), 2 min de bots seuls
         (5 pick and roll, 4 roll, 1 pop), hôte + invité (écran de l'invité vu et efficace chez l'hôte, appel
         d'écran de l'invité → bot envoyé), aucune erreur.
     - ✅ **Chrono des 24 s et fin de match** — `js/gameplay/Clock.js` (29 octobre 2026) :
       - Chrono de tir (`matchRules.shotClock`, hôte) : 24 s à chaque changement d'équipe (`onPossessionGained`,
         appelé par `giveBallTo`), au moins 14 s après un rebond offensif, arrêté pendant un tir
         (`shotClockStopped`, posé par `launchShotBall` et le dunk raté). À 0 : `shotClockViolation` → balle à l'autre
         équipe. Bots porteurs : tirent tout de suite sous 3,5 s (`isShotClockHurry`), sans passe ni pick and roll.
       - Temps de match (`gameDuration` de `GAME_MODES` : 420 / 480 / 720 s) : ne tourne que balle vivante.
         5v5 : mi-temps à 6 min (ou au score, `checkHalftime`), B remet en jeu. Un tir parti avant la sirène compte.
       - Balle morte (`deadBall`, après panier / 24 s / mi-temps / fin) : pas de ramassage ni de rebond, chronos
         arrêtés ; remise en jeu par `scheduleCheckBall` (annulée si nouveau match : `matchToken`).
       - `scorePoints` (commun au tir et au dunk) : score, points du marqueur (`ent.points`), `checkMatchEnd`.
         Fin : score cible (21 / 30), temps écoulé avec un écart, sinon panier en or (`goldenPoint`, le prochain
         panier gagne). `endMatch` → `matchOver` : commandes et bots figés, écran `#match-end-overlay`
         (victoire/défaite, score, raison, meilleur marqueur ; Rejouer = hôte seul → `network.startMatch()`).
       - Affichage : HUD `#hud-game-clock` / `#hud-shot-clock` (rouge sous 5 s, dixièmes), écran géant (temps en bas),
         boîtier au-dessus de chaque planche (`CourtScene.updateShotClock`). Mis à jour seulement si le texte change.
       - Réseau : chronos, `deadBall`, `goldenPoint`, `matchOver`, `winner`, `endReason` dans `rules` du WORLD_STATE,
         points des joueurs (`pts`) ; l'invité affiche l'écran de fin (sans Rejouer).
       - Testé : 24 s (balle à B), 14 s après rebond offensif, match de bots jusqu'à 22-15 (fin au score, 2 min 44),
         Rejouer, temps écoulé à 9-7 et à 10-10 (panier en or → B gagne), mi-temps 5v5 à 6:00, hôte + invité (mêmes
         chronos, écran « DÉFAITE » chez l'invité, Rejouer de l'hôte relance les deux), aucune erreur.
     - ✅ **Feuille de match** — `js/gameplay/MatchSheet.js` (29 octobre 2026, demandée par le joueur) :
       - L'hôte compte, par joueur (`matchSheet.stats[id]`) : points, tirs à 2 et 3 pts réussis/tentés, dunks,
         rebonds offensifs/défensifs, passes décisives (passe reçue puis panier en moins de 6 s de jeu,
         `liveTime`), interceptions, contres, écrans réussis, balles perdues ; et note chaque action avec le temps
         de match (`matchSheet.log`, 400 lignes maxi ; les passes simples n'y sont pas).
       - Branchements : `giveBallTo` → `onBallGained` (rebond si `shotClockStopped`, interception si la balle était
         tenue/en passe par l'autre équipe, passe réussie → `lastPass`), sauf pendant une remise en jeu
         (`inCheckBall`) ; `launchShotBall` → tirs tentés ; `scorePoints(…, kind)` → `onScored` ; tir raté, dunk,
         contre (`executeShotBlock` et événement `BLOCK`), écran (`onScreened`), 24 s.
       - Écran de fin : onglets « Statistiques » (tableau par équipe, sa ligne en vert « (toi) », légende) et
         « Déroulé du match » (case « Seulement mes actions »). Meilleur marqueur tiré de la feuille.
       - Invités : la feuille part dans le WORLD_STATE (`sheet`) 2 fois par seconde une fois le match fini.
       - Testé : match complet (points de la feuille = score, 52 actions, filtre), tir à 3 pts d'un invité compté
         chez l'hôte et feuille reçue par l'invité, aucune erreur.
- **Audit ponytail du 29 octobre 2026 : les 9 points corrigés** (testé : aucune erreur, 7 tests verts) :
  1. Le match continue hors de l'écran du match (`gameEngine.update(dt, render)` appelé à chaque image, dessin
     seulement sur l'écran du match) et onglet caché (`document.hidden` : un Worker fait avancer le match 20 fois/s
     sans le dessiner, ~10 états du monde/s envoyés). Testé en simulant `document.hidden`.
  2. Noms et postes du salon écrits en `textContent` (un nom `<img onerror=…>` ne s'exécute plus).
  3. Mémoire : `disposeTree` (RenderSetup.js) libère l'ancien terrain dans `buildCourt` ; `AnimatedCharacter`
     libère étiquette, anneau et **tous les squelettes copiés** (chaque pièce du modèle a sa texture d'os) ;
     `CharacterMesh.disposeOwned` ajouté. Mesuré : textures stables à 85 sur 6 matchs (avant 85 → 380).
  4. `setOnlineStatus` / `#room-online-status` : « En ligne », « Hors ligne (onglets de ce PC) », « Connecté »,
     « Salon introuvable » (+ message) si l'hôte ne répond pas en 6 s ou si PeerJS dit `peer-unavailable`.
  5. L'hôte ignore un contre ou une interception d'invité arrivés trop tard (`canStillBeBlocked`,
     `canStillBeStolen` dans NetSync.js).
  6. Sauvegarde du joueur dans `try` : navigateur qui bloque les données du site = le jeu démarre quand même.
  7. `tests/regles.test.mjs` (7 tests, lancer `node --test` dans le dossier du jeu) : 24 s / 14 s, violation,
     fin au score, fin au temps, panier en or, tir à la sirène, feuille de match. Vérifié qu'ils échouent si on
     casse la règle des 14 s.
  8. Supprimés : `isCheckBall`, `targetedTeammateId`, `matchStarted` (jamais lus).
  9. Salon : seuls les joueurs nouveaux ou modifiés sont recréés (`lobbyMeshById`, clé = profil + équipe).
     - ✅ **Toutes les actions et tactiques restantes** (29 octobre 2026, « Tout » demandé par le joueur) :
       - **Fautes et lancers francs** — `js/gameplay/Fouls.js` : faute sur tir tirée au sort par l'hôte au départ du tir
         ou du lay-up (`rollShootingFoul` dans `launchShotBall`, `fouledBy` dans `pendingShotOutcome`) et à la fin du
         dunk (`finishDunkSlam`) → 2/3 lancers si raté, 1 si réussi (« and one » : `scorePoints(…, then)` remplace la
         remise en jeu) ; tir contré après la faute : lancers gardés (`foulOnBlockedShot`). Faute en voulant
         intercepter (`rollReachInFoul`, événement `FOUL` pour un invité) → remise en jeu, ou 2 lancers dès la 5e faute
         d'équipe par mi-temps (7e par match en demi-terrain, `bonusFouls`). Série : `matchRules.freeThrow`
         {shooterId, team, total, index}, `setupFreeThrow` (joueurs le long de la raquette, `checkBallSeq++` : les
         invités se placent aussi), balle morte, jauge sans contestation à 4,6 m (`FT_DISTANCE`), bots seuls
         (`updateFreeThrow`, ~70–81 %). Le dernier lancer (`freeThrow.last`) remet la balle en jeu.
       - **Gestes** — `js/gameplay/Moves.js` : près du cercle (`finishRange`) Espace = lay-up, Shift + Espace = dunk ;
         C près du cercle = euro step (courbe par `dunkMid`, contestation ÷ 2) ; T / Y = alley-oop (`launchAlleyOop` :
         passe lobée + envol du receveur, `ball.alleyOop`, événement `ALLEY_OOP` relayé par l'hôte quand le receveur
         est un invité ; sans ballon : le demander au bot porteur) ; tirer en reculant = step-back (> 5,2 m, pas de
         0,95 m) ou fadeaway (dérive arrière, contestation × 0,55), fenêtre verte un peu plus petite (`extraPenalty`).
         Finitions communes : `beginFinish` / `stepFinish` (dunk, lay-up lâché à 60 % du saut, `finishLayup`).
         Contre sur un porteur : **un seul essai par saut** (`blockTried`, avant : un tirage à chaque image).
       - **Rebonds** : box-out (bots défenseurs pendant un tir, joueur local en tenant la défense ; `boxOutTimer`,
         `resolveBoxOutCollision`, l'adversaire « enfermé » a 55 % de portée au rebond), les grands attaquants vont
         au rebond offensif (`botReboundMove`), un bot qui prend le ballon à moins de 2,5 m finit tout de suite.
       - **Tactiques** — `js/gameplay/Tactics.js` : défense individuelle / zone (`ZONES`, le plus proche sort sur le
         porteur) / pressing (prise à deux dans son camp ou loin du cercle, interceptions des bots, `stealCd` par
         joueur) ; attaque coupes / pick and roll / isolation / jeu au poste (`plays`, tiré au sort à chaque possession
         en « Auto »). « Auto » en défense : pressing si menée de 5, zone après 3 paniers adverses près du cercle,
         individuelle après 2 tirs à 3 pts. Menus `#hud-offense` / `#hud-defense` (événement `TACTIC` pour un invité,
         son équipe seulement), ligne `#hud-tactics` (tactiques et fautes d'équipe).
       - Feuille de match : colonnes LF (lancers) et F (fautes), lignes « faute », « lay-up », « alley-oop ».
       - Réseau : `teamFouls`, `freeThrow`, `tactics`, `defenseNow`, `plays` dans `rules` ; `alleyOop` dans `ball` ;
         `box` dans PLAYER_STATE ; `DUNK_START` porte `kind` et `mid`.
       - Testé : 10 tests (`node --test`, dont 3 sur les fautes) ; 5v5 de bots (fautes, and one, lancers, zone,
         pressing, 12 combinaisons de systèmes, aucune erreur) ; joueur local (3 lancers à la jauge, lay-up, step-back
         à 3 pts, euro step, alley-oop + passe décisive, menus) ; hôte + invité (tactique de l'invité appliquée,
         2 lancers de l'invité, alley-oop demandé par l'invité au bot : 2 pts comptés chez l'hôte).
       - Pas fait : exclusion à 5/6 fautes personnelles, règle des 8 s, retour en zone.
- **Touches réglables** (29 octobre 2026, demandé par le joueur) — `js/gameplay/Bindings.js` :
  - `ACTIONS` : 14 actions (4 déplacements, tir, passe, alley-oop, saut, crossover, écran, interception, sprint,
    posture, caméra), chacune avec 2 touches clavier (`KeyboardEvent.code`, physique : le nom affiché vient de
    `navigator.keyboard.getLayoutMap`, « Z » sur AZERTY pour `KeyW`) et 2 boutons de manette (disposition standard).
    `KeyBindings` : `localStorage` `courtkings_touches` (valeurs vérifiées une par une, défaut sinon), `reset`.
  - Une touche peut servir à plusieurs actions : `runActions` (Controls.js) joue la première de `ACTION_ORDER`
    qui a du sens (`canRunAction` : crossover avec ballon, écran en attaque, interception en défense, saut sans
    ballon, alley-oop si on a le ballon ou si un bot coéquipier l'a). Par défaut, la manette garde les boutons
    partagés d'avant (Rond = crossover / écran / interception, Y = alley-oop / saut).
  - Fenêtre `#bindings-overlay` (`BindingsPanel`) : bouton « 🎮 Touches » du HUD et « ⚙️ Changer les touches »
    du bandeau ; clic sur une case puis touche ou bouton (manette lue toutes les 50 ms) ; Échap annule, Retour
    arrière efface ; case orange = touche partagée. Pendant l'ouverture `engine.bindingsOpen` : le jeu ignore
    clavier et manette. Les touches ne sont plus lues quand on écrit dans un champ (`input`, `select`).
  - Bandeau du bas `#controls-legend` refait à chaque changement (`renderControlsLegend`). Croix de la manette
    = déplacement par défaut (si le stick ne bouge pas). Sticks non réglables.
  - Testé : tir passé sur G (Espace ne tire plus, G lance et relâche le tir, gardé dans le navigateur), manette
    simulée (passe sur RB, A ne passe plus, X maintenu/relâché tire, croix ↑ fait bouger), touches par défaut,
    Échap ferme. Vraie manette pas testée.
- **Animations plus réalistes** (29 octobre 2026, demandé par le joueur, sans nouveau fichier d'animation : le pack
  Quaternius n'a aucune animation de basket) — `AnimatedCharacter.js` :
  - `updateAnimation(dt, état, info)` : `info` vient de `GameEngine.animationInfo` (ballon en main, finition en cours
    `finish`/`finishT`, `release` = temps depuis le départ de son tir, box-out, réaction, fin de match), calculé pareil
    chez les invités (WORLD_STATE : `fin`, `bx`, `rx` par joueur).
  - Déplacement mesuré dans le repère du joueur (`fwdSpeed`, `latSpeed`, `turnRate`) : reculer = animation de course
    jouée à l'envers ; de côté = pas chassés procéduraux (`shufflePhase`, pieds posés par IK, jamais croisés) ;
    buste penché dans les virages, en sprint et en dribble.
  - `applyProcedural` : bassin descendu avec pieds gardés au sol (`solveTwoBone`, IK des jambes) pour l'armé du tir,
    la réception des sauts (`LAND_TIME`), la défense et le box-out ; main de dribble sur le ballon (IK du bras,
    `dribbleBallHeight` partagé avec Ball.js) ; gestes en plusieurs temps (`gesturePose`) : tir = armé devant la
    poitrine, ballon au-dessus du front en l'air, bras tendu et poignet cassé après le lâcher ; lay-up = ballon
    protégé puis bras tendu, genou levé ; dunk = bras armé derrière la tête puis smash, genoux repliés ; alley-oop =
    mains tendues vers le ballon ; faute subie (buste en arrière), poing levé après un panier (`react`, `reactTimer`),
    vainqueurs qui dansent (`Dance_Loop`), perdants penchés.
  - Tir du joueur local : le saut part à 47 % de la jauge (`SHOT_JUMP_AT`, haut du saut sur la zone verte) au lieu
    d'immédiatement ; le ballon est devant la poitrine pendant l'armé (Ball.js).
  - Testé en images (armé, montée, lâcher, lay-up, dunk, pas chassés, fin de match) ; 5v5 de bots sans erreur,
    animations ~1,3 ms par image pour 10 joueurs. Invités pas retestés.
- **Course sans patiner** (29 octobre 2026, le joueur trouvait que les personnages couraient bizarrement) :
  - Cause : `Jog_Fwd_Loop` du pack fait de grands bonds (5,5 m par cycle de 2 pas, ~6 m/s à vitesse 1) et était joué
    plus vite (référence 3,6 m/s) : les jambes moulinaient, le pied d'appui glissait en arrière (pied vraiment posé
    1 à 13 % du temps). Mesuré sur le pied (os `ball_leaf_l`), le clip tournant sur place.
  - `locomotionBlend` : `Walk_Loop` + course + sprint mélangés selon la vitesse ; cadence 0,85 à 1,4 cycle/s,
    la foulée fait le reste. `STRIDE` = foulée mesurée de chaque animation (le mélange donne une foulée
    proportionnelle aux poids) → vitesse de lecture = vitesse / foulée du mélange. Pied posé 37 à 43 % du temps entre
    3,5 et 5,5 m/s, 79 % en marchant. Pas chassés plus longs quand ça va vite (`shuffleStride`), pas pendant un demi-tour.
  - GameEngine (étape 7) : le corps pivote vers `rotY` en douceur (au plus 14 rad/s, demi-tour en ~0,25 s), d'un coup
    seulement après une remise en jeu ; Ball.js place le ballon tenu selon cette orientation affichée.
  - `faceRunningDirection` (BotAI.js, après l'IA de chaque bot) : un bot qui recule ou glisse à plus de 3 m/s
    (4,3 m/s sur le porteur) se retourne et court ; avant, les défenseurs remontaient tout le terrain à reculons.
- **IA du porteur qui réfléchit** (29 octobre 2026, « l'IA fonce tout droit sous le panier pour dunker ») :
  - Avant : un bot qui n'était pas très bon tireur (7 sur 10) allait en ligne droite au cercle et finissait sous 2,5 m,
    dunk 6 fois sur 10 ; passes au hasard. Mesuré sur 4 min de 5v5 de bots : 67 % des tirs au cercle (11 dunks),
    3 tirs à 3 points sur 43.
  - Maintenant (BotAI.js) : réception → il lit la défense 0,35 à 0,85 s (`plan` HOLD) ; puis `decideHandler` compare
    en points attendus (+ un peu de hasard) : tirer (`shotValue`, moins s'il n'est pas tireur), passer au mieux placé
    (`bestPassTarget`, ligne de passe libre, `passLaneOpen`), attaquer le cercle si la route est libre (`laneBlocker`,
    Moves.js), déborder son défenseur (crossover, accélération du côté libre), ou attendre (de moins en moins quand
    le chrono de tir baisse). Raquette encombrée : attaquer vaut moins. Un défenseur s'interpose pendant l'attaque :
    il s'arrête et relit.
  - Près du cercle (`botFinish`, Moves.js) : route libre → dunk seulement pour un bon finisseur ; défenseur devant →
    il compare ressortir le ballon, tir flottant (`botFloater`) et euro step. Alley-oops au moment des décisions.
  - Tirs à 3 points des bots : 10 % de moins qu'à 2 points (`shotMakeChance`) ; à réussite égale, ils ne tiraient
    plus que de loin. Mesuré ensuite (5 min 30 de 5v5 de bots) : 40 % au cercle (3 dunks), 36 % à 3 points, 24 % à
    mi-distance, attaques de 8,5 s au lieu de 4,7 s, points marqués proches d'avant. 3v3 : 54 % à 3 points.
  - Mesures faites dans le navigateur (match simulé image par image, minuteurs du jeu en temps simulé) ; pas de test
    `node --test` : BotAI.js et Moves.js chargent Three.js.
- **Revue de ce qu'on voit** (29 octobre 2026, « améliore ce qui a à améliorer ») — trouvé en simulant des matchs :
  - Bras levés en pleine course (4,6 % du temps des joueurs) : le geste « enfermé au rebond » (`info.boxed`) et la
    posture de box-out ne s'appliquent plus qu'à moins de 2 m/s (`gesturePose`, `applyProcedural`).
  - Lancers francs en 5v5 : deux coéquipiers placés exactement au même endroit, et la collision ne savait pas les
    écarter (pas de direction) ; 10 places distinctes (`setupFreeThrow`) et écartement de côté si distance nulle
    (`resolvePlayerCollisions`).
  - Attaque serrée (4,5 m en moyenne entre attaquants, deux par deux du même côté, coupes en même temps) :
    attaque « coupes » et pick and roll = places écartées `MOTION_SPOTS` (coins, ailes, haut) tenues par chacun, le
    porteur et les humains gardent la plus proche d'eux, le plus mauvais tireur de loin attend au « dunker spot »
    côté opposé au ballon, un seul coupeur à la fois (`updateMotion` / `assignMotionSpots`, Tactics.js, appelé par
    `updateTactics(dt)`). Écart moyen 5,9 m. Anciens champs `cutTimer` / `targetOffBallSpot` supprimés.
  - Porteur figé pendant qu'il réfléchit : petit dribble de côté, aller-retour (`plan.jab`).
  - Près du cercle, défenseur devant et contestation forte : il peut ressortir en dribblant (`plan.backOut`,
    `botFinish`) au lieu de forcer ; contre-attaque (au plus un défenseur replié) : il fonce (`plan` DRIVE).
  - Mesuré ensuite (5v5) : 43 % au cercle dont 2 dunks, 39 % à 3 points, 18 % mi-distance ; 3v3 : euro steps face à
    un défenseur 6 sur 11 au lieu de 17 sur 18.
- **Huit nouveautés** (29-30 octobre 2026, « tout » après la liste d'idées) — une par commit :
  - **Son** (`js/audio/SoundFX.js`) : Web Audio sans fichier (dribble, filet, cercle, planche, dunk, contre, sifflet,
    sirène, foule, chaussures, passes) ; démarre au premier clic ou touche ; `GameEngine.playSound(nom, pos, local)` :
    l'hôte joue et met en file (`pendingSfx`, envoyé dans WORLD_STATE `sfx`), un invité ne joue que ses sons
    `local` (dribble, calculé chez chacun par `updateDribbleSound`) et ceux reçus. Volume réglable (30 octobre, demandé
    par le joueur à la place d'un bouton couper / remettre) : curseur `#hud-volume` dans la barre du match, 0 % =
    coupé, `SoundFX.setVolume`, gardé `courtkings_son` (nombre 0-100 ; anciennes valeurs « off » / « on » lues).
  - **Difficulté** (`DIFFICULTY` dans constants.js, `botSkill` dans BotAI.js) : Facile / Normal / Difficile / Légende,
    choisie par l'hôte dans le salon (`lobbyState.difficulty`, gardée `courtkings_difficulte`) ; seulement pour les
    bots qui jouent contre au moins un humain : adresse (tirs, lay-ups, dunks, flottants), vitesse, défense,
    interceptions, hasard des choix (`think`).
  - **Effets** (`Effects.js`) : filet qui s'étire (`CourtScene.animateNet/updateNets`, géométrie accrochée par le haut),
    secousse au smash, dunk au ralenti + caméra de côté seulement en solo (`isSolo`, `gameDt`, `cinema`), étiquettes
    cachées pendant le ralenti, confettis de l'équipe gagnante.
  - **Progression** (`js/progress/Career.js`, `CareerUI.js`) : XP par match terminé (`awardCareer` dans Clock.js ;
    invité : quand sa feuille arrive), niveaux (200 XP puis +50 par niveau, 30 max), +2 points d'atouts par niveau
    dans le créateur (`getRemainingPoints`), carte « Niveau », fenêtre « Historique & records ».
  - **Modes en solo** (`Practice.js`, modes `training` / `contest3` dans GAME_MODES avec `practice`) : lancés du salon
    sans réseau ; pas de chronos ; tirs interceptés dans `resolveShotAtRim` / `finishDunkSlam` ; concours : 70 s,
    5 emplacements de 5 ballons, 5e = 2 points, record `contest3`.
  - **Tactile** : retiré le 30 octobre 2026 à la demande du joueur (« pour l'instant pas sur téléphone ») ; le code est
    dans le commit 9194ed5 (joystick + boutons lus comme une manette), annulé par 77d3796, à remettre au besoin.
  - **Tournoi** (`js/progress/Tournament.js`) : 8 équipes, tes adversaires montent d'un niveau par tour, autres matchs
    simulés ; match lancé par `main.startTournamentMatch` (`lobbyState.tournament`, `teamNames`) ; `offline` : rien
    n'est envoyé au salon ; « Suite du tournoi » sur l'écran de fin ; titre dans les records.
  - **Fatigue** (`Fatigue.js`, 5v5 seulement) : énergie selon la vitesse mesurée (`mesh.speed`), sauts, arrêts de
    jeu ; vitesse jusqu'à -14 %, tir jusqu'à -7 % (jauge plus dure pour un humain) ; 2 remplaçants par équipe de bots
    (noms à part), changement à la remise en jeu (`makeSubstitutions`, événement SUB : les invités ont le même banc) ;
    lignes des remplaçants dans la feuille de match ; barre d'énergie. Premiers changements vers 2 min de jeu.
  - Vérifié en match simulé dans le navigateur (son rendu hors ligne) ; pas retesté à plusieurs sur deux PC ni avec
    une vraie manette.
- **Menu caché pendant le match et pause** (29 octobre 2026, demandé par le joueur) : sur l'écran du match
  (`body.in-match`, posé par `switchScreen`), la barre de navigation, la barre d'outils du match et le bandeau des
  touches (`#controls-legend`) sont cachés ;
  l'écran du match prend toute la hauteur. **Échap** (fixe), **P** ou **Start** (action `pause`, réglable) →
  `setMenuOpen` (Controls.js) : classe `menu-open` (barre du haut par-dessus, tableau de score décalé de 64 px),
  carte `#pause-overlay` avec « Reprendre ». Seul contre les bots (`lobbyState.players` ≤ 1) : `paused`, `update`
  ne fait plus avancer le match (seulement la manette, pour Start). À plusieurs : le match continue, mais le joueur
  local ne reçoit plus ses commandes. Menu fermé au début d'un match et en quittant l'écran du match ; Échap dans la
  fenêtre « Touches » ne ferme que la fenêtre. Testé : barre cachée, pause (chrono arrêté), reprise, P, Échap dans
  « Touches », partie à plusieurs simulée (chrono qui tourne, joueur immobile).
- **Textes qui se chevauchent** (29 octobre 2026, corrigé) :
  - `.match-hud-top` est une grille : score à gauche, barre d'outils à droite (elle passe à la ligne, et sous le
    score sous 1100 px), puis `#hud-tactics`, `#court-rule-toast` et `#pause-overlay` centrés en dessous (ils étaient
    à des hauteurs fixes et passaient sous la barre d'outils en petite fenêtre) ;
  - sous 1100 px : menu du haut sans les parenthèses (`.nav-extra`) ni la pastille WEBGL ;
  - étiquettes 3D des joueurs : `declutterNameplates` (Camera.js) efface celle du joueur le plus loin quand deux se
    chevauchent à l'écran (la mienne puis celle du porteur passent avant) ;
  - créateur : pas d'étiquette au-dessus de la tête (`hideNameplate`), elle passait sous la carte « Note globale » ;
  - salon : le canvas 3D ne garde plus la colonne du milieu à son ancienne taille (Équipe B hors écran).
  - Vérifié à 780, 1024, 1366 et 1920 px (créateur, salon, match, pause, alerte, fenêtre « Touches »), avec un
    script qui compare les rectangles des textes et des boutons.
- **Sécurité du multijoueur** (30 octobre 2026, audit `agent-skills:security-and-hardening` demandé par le joueur) :
  l'hôte ne croit plus un invité sur parole.
  - `NetworkManager.trustPeerPacket` (paquets PeerJS reçus par l'hôte) : une identité par connexion (fixée par la
    première `JOIN_REQUEST`, jamais celle de l'hôte ni d'un autre invité), `senderId` = cette identité, `eventId` à son
    nom ; messages d'hôte (`LOBBY_SYNC`, `START_MATCH`, `WORLD_STATE`, `ROOM_FULL`) refusés. BroadcastChannel (onglets
    du même PC) reste sans contrôle. `TEAM_SWITCH` : seulement A ou B.
  - `cleanProfile` : profil reçu ramené aux choix existants, nom ≤ 14 caractères, atouts dans les plafonds du poste et
    les points du niveau maximum (`MAX_LEVEL`, Career.js).
  - `handleRemoteGameEvent` (hôte) : l'action doit nommer le joueur de l'invité (sauf passe demandée à un bot
    coéquipier, alley-oop demandé) ; interception à ≤ 3 m du porteur ou 3,2 m de la ligne de passe, une par 0,9 s ;
    contre à ≤ 2,6 m ; ballon renvoyé : position à ≤ 3 m, vitesse ±10 ; dunk : ballon en main, départ à ≤ 2,5 m de sa
    position, à portée de finition + 1,8 m ; tir : 3 points seulement à ≥ 4,85 m du cercle chez l'hôte.
  - `handleRemotePlayerState` : position non finie ignorée, gardée sur le terrain, au plus 12 m/s (+1,5 m), libre 1 s
    après chaque remise en jeu (`checkBallSeq`).
  - Reste décidé chez l'invité (comme avant) : réussite d'un tir (sa jauge) et d'une interception ou d'un contre
    dans les distances permises. Pas fait : empreinte (SRI) des scripts CDN, mot de passe de salon.
  - Testé : `tests/reseau.test.mjs` (4 tests, 3 échouent si on retire le contrôle) ; faux invité tricheur dans le
    navigateur (interception de loin, à répétition, au nom d'un autre, 3 points sous le cercle, dunk sans ballon ou
    de 12 m, contre de loin, NaN, téléportation : tout refusé ; vrais 3 points, dunk, passe demandée à un bot : acceptés) ;
    vrai invité par PeerJS seul (salon, match, positions, appel d'écran reçus ; faux salon, 2e identité, profil à 999
    refusés ou corrigés).
- **Limites connues** : l'invité est en retard d'environ 50 ms + latence ; si l'hôte quitte, le match s'arrête
  (pas de migration d'hôte) ; PeerJS entre 2 PC pas encore testé.
- La console du navigateur intégré garde les erreurs d'avant un rechargement : pour tester, compter les
  nouvelles erreurs avec `window.addEventListener('error', …)`.
- **Pas encore testé** : manette, dunks, contres, 4v4, tir réussi en maintenant la touche, PeerJS entre 2 PC.
