# CourtKings 3D - Multiplayer Basketball (Three.js + WebRTC/PeerJS + BroadcastChannel)

Jeu de basketball 3D multijoueur sur navigateur propulsé par **Three.js (WebGL)**.

## Architecture du Projet (Étape 1)

```text
f:/ProjetAppli/basketball_3d/
├── index.html                  # Point d'entrée UI, ImportMap ES Modules (Three.js, PeerJS) & HUD
├── css/
│   └── styles.css              # Design System Streetball/Pro 2K, Créateur, Lobby, Jauge de Tir
├── js/
│   ├── main.js                 # Contrôleur principal, navigation d'états & boucle de jeu
│   ├── config/
│   │   └── constants.js        # Les 10 Presets, couleurs de peau, 5 Postes (PG..C), plafonds d'atouts
│   ├── character/
│   │   ├── CharacterMesh.js    # Générateur procédural 3D modulaire (Corps, Coiffures, Barbes, Animations)
│   │   └── CharacterBuilder.js # Logique UI & Prévisualisation 3D interactive du Créateur de Personnage
│   ├── court/
│   │   └── CourtScene.js       # Scène 3D : Terrain Half-Court (3v3, 4v4) & Full-Court (5v5), paniers, lumières
│   ├── gameplay/
│   │   ├── ShotMeter.js        # Mécanique de Jauge de Tir ("Green Window"), calcul de probabilité et contestation
│   │   └── GameEngine.js       # Contrôles joueur, dribble/crossover, physique ballon, règles Streetball/5v5 & Bots IA
│   └── network/
│       └── NetworkManager.js   # Réseau temps réel Hybride (PeerJS WebRTC en ligne + BroadcastChannel multi-onglets)
└── server.py                   # Serveur HTTP local Python (zéro dépendance externe requise)
```

## Lancement Rapide

Depuis le dossier `f:\ProjetAppli\basketball_3d` :

```powershell
f:\ProjetAppli\.venv\Scripts\python.exe server.py
```

Puis ouvrez `http://localhost:8080` dans votre navigateur (et dans un second onglet ou navigateur avec le code de salon `BASKET-XX` pour tester le multijoueur instantanément).
