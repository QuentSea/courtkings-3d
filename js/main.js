/**
 * main.js
 * Point d'entrée principal de CourtKings 3D :
 * Coordonne :
 * 1. L'écran du Créateur de Personnage 3D (Étape 2)
 * 2. Le Salon Multijoueur en Ligne avec Code d'Invitation & Prévisualisation 3D des Équipes (Étape 4)
 * 3. Le Match 3D en Temps Réel (3v3, 4v4, 5v5) avec Jauge de Tir et Bots IA (Étapes 3 et 4)
 */

import * as THREE from 'three';
import { GAME_MODES, POSITIONS } from './config/constants.js';
import { CharacterBuilder } from './character/CharacterBuilder.js';
import { createCharacterMesh } from './character/createCharacter.js';
import { loadCharacterAssets } from './character/CharacterAssets.js';
import { NetworkManager } from './network/NetworkManager.js';
import { GameEngine } from './gameplay/GameEngine.js';
import { BindingsPanel } from './gameplay/Bindings.js';
import { setupRenderer } from './render/RenderSetup.js';

class CourtKingsApp {
    constructor() {
        this.currentScreen = 'builder'; // 'builder' | 'lobby' | 'match'

        // 1. Initialiser le Créateur de Personnage (Étape 2)
        this.builder = new CharacterBuilder('builder-3d-viewport', (confirmedProfile) => {
            this.network.updateLocalProfile(confirmedProfile);
            this.switchScreen('lobby');
        });

        // 2. Initialiser le Gestionnaire Réseau Temps Réel (Étape 4)
        this.network = new NetworkManager({
            onLobbyUpdate: (lobbyState) => this.renderLobbyUI(lobbyState),
            onMatchStart: (lobbyState) => this.enterMatchScreen(lobbyState),
            onRemotePlayerState: (packet) => this.gameEngine?.handleRemotePlayerState(packet),
            onRemoteGameEvent: (packet) => this.gameEngine?.handleRemoteGameEvent(packet),
            onWorldState: (packet) => this.gameEngine?.handleWorldState(packet),
            onPlayerLeft: (peerId) => this.gameEngine?.handlePlayerLeft(peerId),
            onHostLeft: () => this.notifyPlayer("L'hôte a quitté la partie : le match est terminé."),
            onOnlineStatus: (status, isHost) => this.showOnlineStatus(status, isHost),
            onRoomFull: () => this.notifyPlayer('Salon complet : il y a déjà 10 joueurs (5 contre 5).'),
            onTeamFull: (team) => this.notifyPlayer(`L'équipe ${team} est complète (5 joueurs).`),
            onOnlyHostCanStart: () => this.notifyPlayer("Seul l'hôte (celui qui a créé le salon) peut lancer le match.")
        });

        // 3. Initialiser la Scène 3D du Salon Multijoueur (aperçu des joueurs connectés)
        this.lobbySceneMeshes = [];
        this.initLobby3DViewport();

        // 4. Initialiser le Moteur de Jeu 3D (Étapes 3 et 4)
        this.gameEngine = new GameEngine('match-3d-viewport', this.network);

        this.bindGlobalNavigation();
        this.checkURLInviteCode();
        this.startMainLoop();
    }

    initLobby3DViewport() {
        const container = document.getElementById('lobby-3d-viewport');
        if (!container) return;

        const w = container.clientWidth || 700;
        const h = container.clientHeight || 340;

        this.lobbyScene = new THREE.Scene();
        this.lobbyScene.background = new THREE.Color('#090d16');

        this.lobbyCamera = new THREE.PerspectiveCamera(42, w / h, 0.1, 40);
        this.lobbyCamera.position.set(0, 1.85, 5.8);
        this.lobbyCamera.lookAt(0, 1.15, 0);

        this.lobbyRenderer = new THREE.WebGLRenderer({ antialias: true });
        this.lobbyRenderer.setSize(w, h);
        this.lobbyRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        setupRenderer(this.lobbyRenderer, this.lobbyScene);
        container.innerHTML = '';
        container.appendChild(this.lobbyRenderer.domElement);

        const ambient = new THREE.AmbientLight('#ffffff', 0.8);
        const dirLight = new THREE.DirectionalLight('#fffbeb', 1.4);
        dirLight.position.set(4, 7, 5);
        this.lobbyScene.add(ambient, dirLight);

        const floor = new THREE.Mesh(
            new THREE.PlaneGeometry(16, 8),
            new THREE.MeshStandardMaterial({ color: '#1e293b', roughness: 0.4 })
        );
        floor.rotation.x = -Math.PI / 2;
        this.lobbyScene.add(floor);

        window.addEventListener('resize', () => {
            if (!container || container.clientWidth === 0) return;
            this.lobbyCamera.aspect = container.clientWidth / container.clientHeight;
            this.lobbyCamera.updateProjectionMatrix();
            this.lobbyRenderer.setSize(container.clientWidth, container.clientHeight);
        });
    }

    bindGlobalNavigation() {
        // Navigation par onglets en haut
        document.querySelectorAll('[data-nav-screen]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const target = btn.dataset.navScreen;
                if (target === 'match' && !this.gameEngine.isRunning) {
                    // Si aucun match n'est lancé, lancer un match rapide avec la config actuelle
                    this.network.startMatch();
                    return;
                }
                this.switchScreen(target);
            });
        });

        // Bouton "Jouer Directement (Test Terrain 3D)" depuis le Créateur
        const quickPlayBtn = document.getElementById('btn-quick-play');
        if (quickPlayBtn) {
            quickPlayBtn.addEventListener('click', async () => {
                this.builder.saveProfile();
                const profile = this.builder.getProfile();
                if (!this.network.roomCode) {
                    await this.network.createRoom(profile, '3v3');
                } else {
                    this.network.updateLocalProfile(profile);
                }
                this.network.startMatch();
            });
        }

        // Actions du Lobby : Créer un salon, Rejoindre par code, Copier lien/code
        const createRoomBtn = document.getElementById('btn-create-room');
        if (createRoomBtn) {
            createRoomBtn.addEventListener('click', async () => {
                const code = await this.network.createRoom(
                    this.builder.getProfile(),
                    this.network.lobbyState.mode || '3v3'
                );
                this.updateInviteURLDisplay(code);
            });
        }

        const joinRoomBtn = document.getElementById('btn-join-room');
        const joinInput = document.getElementById('join-room-code-input');
        if (joinRoomBtn && joinInput) {
            joinRoomBtn.addEventListener('click', async () => {
                const code = joinInput.value.trim().toUpperCase();
                if (!code) return;
                await this.network.joinRoom(code, this.builder.getProfile());
                this.updateInviteURLDisplay(code);
            });
        }

        const copyCodeBtn = document.getElementById('btn-copy-room-code');
        if (copyCodeBtn) {
            copyCodeBtn.addEventListener('click', () => {
                const code = this.network.roomCode || 'BASKET-42';
                navigator.clipboard?.writeText(code);
                copyCodeBtn.textContent = 'CODE COPIÉ ✓';
                setTimeout(() => { copyCodeBtn.textContent = 'COPIER LE CODE'; }, 1800);
            });
        }

        const copyLinkBtn = document.getElementById('btn-copy-invite-link');
        if (copyLinkBtn) {
            copyLinkBtn.addEventListener('click', () => {
                const code = this.network.roomCode || 'BASKET-42';
                const url = `${window.location.origin}${window.location.pathname}?room=${code}`;
                navigator.clipboard?.writeText(url);
                copyLinkBtn.textContent = 'LIEN COPIÉ ✓';
                setTimeout(() => { copyLinkBtn.textContent = 'COPIER LE LIEN RAPIDE'; }, 1800);
            });
        }

        // Sélection du Mode de Jeu (3v3, 4v4, 5v5)
        document.querySelectorAll('[data-mode-select]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const mode = btn.dataset.modeSelect;
                this.network.setGameMode(mode);
            });
        });

        // Toggle Bots IA
        const botsCheckbox = document.getElementById('toggle-fill-bots');
        if (botsCheckbox) {
            botsCheckbox.addEventListener('change', (e) => {
                this.network.setFillWithBots(e.target.checked);
            });
        }

        // Niveau des bots adverses (l'hôte choisit)
        document.getElementById('lobby-difficulty')?.addEventListener('change', (e) => {
            this.network.setDifficulty(e.target.value);
        });

        // Choix d'équipe (Équipe A / Équipe B)
        const btnTeamA = document.getElementById('btn-join-team-a');
        const btnTeamB = document.getElementById('btn-join-team-b');
        if (btnTeamA) btnTeamA.addEventListener('click', () => this.network.switchLocalTeam('A'));
        if (btnTeamB) btnTeamB.addEventListener('click', () => this.network.switchLocalTeam('B'));

        // Bouton Lancer la Partie depuis le Lobby
        const startMatchBtn = document.getElementById('btn-start-lobby-match');
        if (startMatchBtn) {
            startMatchBtn.addEventListener('click', () => {
                this.network.startMatch();
            });
        }

        // Boutons HUD en cours de match (Changer de Mode à la volée, Retour Salon/Créateur)
        const hudExitBtn = document.getElementById('btn-hud-lobby');
        if (hudExitBtn) {
            hudExitBtn.addEventListener('click', () => {
                this.switchScreen('lobby');
            });
        }

        const hudBuilderBtn = document.getElementById('btn-hud-builder');
        if (hudBuilderBtn) {
            hudBuilderBtn.addEventListener('click', () => {
                this.switchScreen('builder');
            });
        }

        // Écran de fin de match : l'hôte relance pour tout le salon ; tout le monde peut revenir au salon
        document.getElementById('btn-match-end-replay')?.addEventListener('click', () => {
            this.network.startMatch();
        });
        // Feuille de match : onglets et filtre « seulement mes actions »
        document.querySelectorAll('[data-sheet-tab]').forEach((tab) => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('[data-sheet-tab]').forEach(t => t.classList.toggle('active', t === tab));
                document.querySelectorAll('[data-sheet-panel]').forEach((panel) => {
                    panel.classList.toggle('hidden', panel.dataset.sheetPanel !== tab.dataset.sheetTab);
                });
            });
        });
        document.getElementById('sheet-only-mine')?.addEventListener('change', (e) => {
            this.gameEngine.sheetFilterMine = e.target.checked;
            this.gameEngine.renderMatchSheet();
        });
        document.getElementById('btn-match-end-lobby')?.addEventListener('click', () => {
            this.gameEngine.hideMatchEnd();
            this.switchScreen('lobby');
        });

        // Pause : bouton « Reprendre »
        document.getElementById('btn-pause-resume')?.addEventListener('click', () => this.gameEngine.setMenuOpen(false));

        // Touches réglables (Bindings.js) : fenêtre « Touches » et rappel en bas de l'écran du match
        this.gameEngine.bindingsPanel = new BindingsPanel(this.gameEngine);
        this.gameEngine.renderControlsLegend();
        document.getElementById('btn-hud-bindings')?.addEventListener('click', (e) => {
            e.currentTarget.blur();
            this.gameEngine.bindingsPanel.open();
        });

        // Son (SoundFX.js) : couper ou remettre, gardé dans le navigateur
        const soundBtn = document.getElementById('btn-hud-sound');
        const showSound = () => {
            if (soundBtn) soundBtn.textContent = this.gameEngine.sound.muted ? '🔇 Son coupé' : '🔊 Son';
        };
        showSound();
        soundBtn?.addEventListener('click', (e) => {
            this.gameEngine.sound.setMuted(!this.gameEngine.sound.muted);
            showSound();
            e.currentTarget.blur();
        });

        // Tactiques de l'équipe du joueur (Tactics.js) : l'hôte décide, un invité envoie son choix
        const offenseSelect = document.getElementById('hud-offense');
        const defenseSelect = document.getElementById('hud-defense');
        [offenseSelect, defenseSelect].forEach((sel) => {
            sel?.addEventListener('change', () => {
                this.gameEngine.setMyTactics(defenseSelect.value, offenseSelect.value);
                sel.blur(); // rendre les touches au jeu
            });
        });

        // Qualité graphique (Auto / Haute / Moyenne / Basse) pour les PC moins puissants
        const qualitySelect = document.getElementById('hud-quality');
        if (qualitySelect) {
            this.gameEngine.quality.updateSelect();
            qualitySelect.addEventListener('change', () => {
                this.gameEngine.quality.setMode(qualitySelect.value);
                qualitySelect.blur(); // rendre les touches au jeu
            });
        }

        document.querySelectorAll('[data-hud-mode]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const mode = btn.dataset.hudMode;
                this.network.setGameMode(mode);
                this.network.startMatch();
            });
        });
    }

    async checkURLInviteCode() {
        const params = new URLSearchParams(window.location.search);
        const roomParam = params.get('room');
        if (roomParam) {
            const code = roomParam.trim().toUpperCase();
            await this.network.joinRoom(code, this.builder.getProfile());
            this.updateInviteURLDisplay(code);
            this.switchScreen('lobby');
        } else {
            // Créer un salon par défaut prêt à accueillir des amis
            const defaultCode = await this.network.createRoom(this.builder.getProfile(), '3v3');
            this.updateInviteURLDisplay(defaultCode);
        }
    }

    updateInviteURLDisplay(code) {
        const codeDisplay = document.getElementById('active-room-code');
        const joinInput = document.getElementById('join-room-code-input');
        if (codeDisplay) codeDisplay.textContent = code;
        if (joinInput && !joinInput.value) joinInput.value = code;
    }

    // État de la connexion du salon, affiché à côté du code ; message si le salon rejoint est introuvable
    showOnlineStatus(status, isHost) {
        const el = document.getElementById('room-online-status');
        const texts = {
            connecting: 'Connexion…',
            online: isHost ? '🟢 En ligne : tes amis peuvent rejoindre' : "🟢 Connecté à l'hôte",
            local: isHost ? '🟠 Hors ligne : seuls les onglets de ce PC peuvent rejoindre' : '🟢 Connecté (même PC)',
            'not-found': '🔴 Salon introuvable'
        };
        if (el) {
            el.textContent = texts[status] || '';
            el.dataset.status = status;
        }
        if (status === 'not-found') {
            this.notifyPlayer('Salon introuvable : vérifie le code (exemple : BASKET-4K7Q) et que ton ami a bien le jeu ouvert.');
        }
    }

    // Message au joueur : bandeau du terrain pendant un match, fenêtre simple ailleurs
    notifyPlayer(message) {
        if (this.currentScreen === 'match' && this.gameEngine?.isRunning) {
            this.gameEngine.showRuleAlert(message, false);
        } else {
            window.alert(message);
        }
    }

    switchScreen(screenName) {
        this.currentScreen = screenName;
        // Sur le terrain, le menu du haut est caché (Échap l'affiche) ; ailleurs, le match reprend sans pause
        document.body.classList.toggle('in-match', screenName === 'match');
        if (screenName !== 'match' && this.gameEngine?.menuOpen) this.gameEngine.setMenuOpen(false);
        document.querySelectorAll('.app-screen').forEach((sec) => {
            sec.classList.toggle('active', sec.id === `screen-${screenName}`);
        });
        document.querySelectorAll('[data-nav-screen]').forEach((btn) => {
            btn.classList.toggle('active', btn.dataset.navScreen === screenName);
        });

        setTimeout(() => {
            window.dispatchEvent(new Event('resize'));
        }, 50);
    }

    renderLobbyUI(lobbyState) {
        this.updateInviteURLDisplay(lobbyState.roomCode || 'BASKET-42');

        // Mettre à jour les boutons de mode 3v3 / 4v4 / 5v5
        document.querySelectorAll('[data-mode-select]').forEach((btn) => {
            btn.classList.toggle('active', btn.dataset.modeSelect === lobbyState.mode);
        });

        const difficultySelect = document.getElementById('lobby-difficulty');
        if (difficultySelect) {
            difficultySelect.value = lobbyState.difficulty || 'NORMAL';
            difficultySelect.disabled = !this.network.isHost;
        }

        const modeInfo = GAME_MODES[lobbyState.mode] || GAME_MODES['3v3'];
        const modeDescEl = document.getElementById('lobby-mode-description');
        if (modeDescEl) {
            const minutes = Math.round((modeInfo.gameDuration || 600) / 60);
            modeDescEl.textContent = `${modeInfo.name} — ${modeInfo.description} Victoire : premier à ` +
                `${modeInfo.targetScore} pts ou meilleur score après ${minutes} min (égalité : panier en or).`;
        }

        // Afficher les joueurs dans les colonnes Équipe A et Équipe B
        const listA = document.getElementById('lobby-team-a-list');
        const listB = document.getElementById('lobby-team-b-list');
        if (!listA || !listB) return;

        listA.innerHTML = '';
        listB.innerHTML = '';

        const players = Object.values(lobbyState.players || {});
        const teamA = players.filter(p => p.team === 'A');
        const teamB = players.filter(p => p.team === 'B');

        const renderSlotCard = (p, isBot = false) => {
            const div = document.createElement('div');
            div.className = `lobby-player-card ${isBot ? 'bot-slot' : 'human-slot'}`;
            const prof = p.profile;
            const a = prof.attributes || { shooting: 80, defense: 80, dribble: 80, finishing: 80 };
            const ovr = Math.round((a.shooting + a.defense + a.dribble + a.finishing) / 4);
            // Nom et poste viennent des autres joueurs : toujours écrits comme du texte, jamais comme du HTML
            const el = (cls, text, parent = div) => {
                const node = document.createElement('div');
                node.className = cls;
                node.textContent = text;
                parent.appendChild(node);
                return node;
            };
            el('lp-badge', prof.position);
            const info = el('lp-info', '');
            el('lp-name', `${prof.playerName} ${p.peerId === this.network.localPeerId ? '(VOUS)' : ''}`, info);
            el('lp-sub', `${POSITIONS[prof.position]?.shortName || prof.position} • OVR ${ovr}`, info);
            el('lp-status', isBot ? 'IA BOT' : 'PRÊT');
            return div;
        };

        teamA.forEach(p => listA.appendChild(renderSlotCard(p, false)));
        teamB.forEach(p => listB.appendChild(renderSlotCard(p, false)));

        if (lobbyState.fillWithBots) {
            for (let i = teamA.length; i < modeInfo.playersPerTeam; i++) {
                listA.appendChild(renderSlotCard({
                    profile: { playerName: `Bot IA #${i + 1}`, position: 'SF', attributes: { shooting: 78, defense: 78, dribble: 78, finishing: 78 } }
                }, true));
            }
            for (let i = teamB.length; i < modeInfo.playersPerTeam; i++) {
                listB.appendChild(renderSlotCard({
                    profile: { playerName: `Bot IA #${i + 1}`, position: 'PF', attributes: { shooting: 78, defense: 78, dribble: 78, finishing: 78 } }
                }, true));
            }
        }

        // Mettre à jour la scène 3D du Lobby avec les personnages des joueurs humains connectés
        this.rebuildLobby3DCharacters(players);
    }

    rebuildLobby3DCharacters(players) {
        if (!this.lobbyScene) return;
        // Ne refaire que les joueurs nouveaux ou modifiés (profil ou équipe) ; les autres sont gardés
        const previous = this.lobbyMeshById || new Map();
        const next = new Map();
        for (const p of players) {
            const key = JSON.stringify(p.profile) + p.team;
            const kept = previous.get(p.peerId);
            if (kept && kept.key === key) {
                next.set(p.peerId, kept);
                previous.delete(p.peerId);
            } else {
                next.set(p.peerId, { key, mesh: createCharacterMesh({ ...p.profile, team: p.team }) });
            }
        }
        for (const { mesh } of previous.values()) {
            this.lobbyScene.remove(mesh.root);
            mesh.disposeOwned?.();
        }
        this.lobbyMeshById = next;
        this.lobbySceneMeshes = [...next.values()].map(entry => entry.mesh);

        // Resserrer quand il y a beaucoup de joueurs (jusqu'à 10) pour qu'ils tiennent tous à l'écran
        const total = this.lobbySceneMeshes.length;
        const spacing = Math.min(1.65, 11 / Math.max(total, 1));
        this.lobbySceneMeshes.forEach((mesh, idx) => {
            mesh.root.position.set((idx - (total - 1) / 2) * spacing, 0, 0);
            if (!mesh.root.parent) this.lobbyScene.add(mesh.root);
        });
    }

    enterMatchScreen(lobbyState) {
        this.switchScreen('match');
        this.gameEngine.startMatch(lobbyState, this.network.localPeerId);

        document.querySelectorAll('[data-hud-mode]').forEach((btn) => {
            btn.classList.toggle('active', btn.dataset.hudMode === lobbyState.mode);
        });
    }

    startMainLoop() {
        let lastTime = performance.now();
        const loop = (now) => {
            requestAnimationFrame(loop);
            const dt = Math.min(0.05, (now - lastTime) / 1000);
            lastTime = now;

            if (this.currentScreen === 'lobby' && this.lobbyRenderer) {
                this.lobbySceneMeshes.forEach(m => m.updateAnimation(dt, 'IDLE'));
                this.lobbyRenderer.render(this.lobbyScene, this.lobbyCamera);
            }
            // Le match continue même si on regarde le salon ou le créateur : chez l'hôte, il calcule
            // le jeu de tout le monde (dessiné seulement sur l'écran du match)
            this.gameEngine.update(dt, this.currentScreen === 'match');
        };
        requestAnimationFrame(loop);

        // Onglet caché ou fenêtre réduite : le navigateur arrête requestAnimationFrame. Un petit Worker
        // (non freiné en arrière-plan) fait alors avancer le match 20 fois par seconde, sans le dessiner.
        try {
            const tick = new Worker(URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 50);'])));
            let lastTick = performance.now();
            tick.onmessage = () => {
                const now = performance.now();
                const dt = Math.min(0.1, (now - lastTick) / 1000);
                lastTick = now;
                if (document.hidden) {
                    this.gameEngine.update(dt, false);
                    lastTime = now; // au retour, pas de grand saut dans la boucle normale
                }
            };
        } catch (e) {
            console.warn('Minuterie de secours indisponible :', e);
        }
    }
}

window.addEventListener('DOMContentLoaded', async () => {
    // Personnages animés (~2 Mo) chargés avant de construire les scènes ;
    // en cas d'échec ou de lenteur (> 20 s), l'ancien modèle procédural est utilisé
    try {
        await Promise.race([
            loadCharacterAssets(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('délai dépassé')), 20000))
        ]);
    } catch (err) {
        console.warn('Personnages animés non chargés :', err);
    }
    window.courtKingsApp = new CourtKingsApp();
});
