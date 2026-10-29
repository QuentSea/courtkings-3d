/**
 * GameEngine.js
 * Moteur de Gameplay 3D : scène, entités joueurs, boucle principale (60 FPS).
 * Le reste est rangé par thème dans ce dossier et ajouté au prototype en bas de ce fichier :
 * - Controls.js : Commandes du joueur local : clavier, manette (Gamepad API), boutons d'action et déplacement.
 * - Actions.js : Actions de basket : dunk, saut/contre, crossover, visée et passes, interceptions, contres, rebonds, contestation.
 * - Ball.js : Ballon : lancement des passes et des tirs, trajectoires, ballon libre, résolution des paniers et des dunks.
 * - Rules.js : Règles du match : panier attaqué, mi-temps, remises en jeu, possession, tableau de score et messages.
 * - BotAI.js : Intelligence des bots : attaque (appels, coupes, spacing), défense individuelle, déplacements.
 * - Camera.js : Caméra « 2K Cam » / « Vue Suivi » : suit l'action et indique si l'écran est retourné.
 * - NetSync.js : Synchronisation réseau : état du monde de l'hôte, joueurs distants, actions reçues, départs.
 * - Screens.js : Écrans (« block ») et pick and roll, défenseurs bloqués, changements de joueur (switch).
 * - Clock.js : Chrono de tir (24 s), temps de match, fin de match et écran de résultat.
 * - MatchSheet.js : Feuille de match (statistiques de chaque joueur, déroulé des actions).
 * - Fouls.js : Fautes (sur tir, en défense, bonus d'équipe) et lancers francs.
 * - Moves.js : Lay-up, euro step, alley-oop, step-back, fadeaway, box-out et rebond offensif.
 * - Tactics.js : Défense individuelle, zone ou pressing ; systèmes d'attaque (coupes, pick and roll, isolation, poste).
 */

import * as THREE from 'three';
import { CHARACTER_PRESETS, GAME_MODES, DIFFICULTY } from '../config/constants.js';
import { createCharacterMesh } from '../character/createCharacter.js';
import { CourtScene } from '../court/CourtScene.js';
import { ShotMeter } from './ShotMeter.js';
import { setupRenderer } from '../render/RenderSetup.js';
import { QualityManager } from '../render/Quality.js';
import { ControlsMethods } from './Controls.js';
import { ActionsMethods } from './Actions.js';
import { BallMethods } from './Ball.js';
import { RulesMethods } from './Rules.js';
import { BotAIMethods } from './BotAI.js';
import { CameraMethods } from './Camera.js';
import { NetSyncMethods } from './NetSync.js';
import { ScreenMethods } from './Screens.js';
import { ClockMethods } from './Clock.js';
import { MatchSheetMethods } from './MatchSheet.js';
import { FoulMethods } from './Fouls.js';
import { MoveMethods } from './Moves.js';
import { TacticMethods } from './Tactics.js';
import { KeyBindings, ACTIONS } from './Bindings.js';
import { SoundFX } from '../audio/SoundFX.js';
import { EffectsMethods } from './Effects.js';
import { PracticeMethods } from './Practice.js';

export class GameEngine {
    constructor(canvasContainerId, networkManager) {
        this.container = document.getElementById(canvasContainerId);
        this.network = networkManager;
        this.shotMeter = new ShotMeter();

        this.isRunning = false;
        this.cameraMode = '2K'; // '2K' ou 'FOLLOW'
        this.currentMode = GAME_MODES['3v3'];
        this.difficulty = DIFFICULTY.NORMAL; // bots adverses (BotAI.js, botSkill)

        // Entités Joueurs : id -> { id, team, isBot, isLocal, slotIndex, profile, mesh, pos, vel, rotY, state }
        this.entities = new Map();
        this.localPlayerId = null;

        // Direction actuelle de visée du joueur local (Clavier ou Stick Gauche Manette)
        this.aimDirection = new THREE.Vector2(0, -1);
        this.passTargetIndicator = null;

        // État Manette (Gamepad API) pour détecter les fronts montants/descendants des boutons
        this.gamepadState = {
            connected: false,
            id: '',
            prevButtons: {},
            shootButton: null // bouton qui a lancé la jauge de tir (le tir part quand on le relâche)
        };
        // Touches réglables (Bindings.js) ; bindingsOpen : fenêtre « Touches » ouverte, le jeu ignore les commandes
        this.bindings = new KeyBindings();
        this.bindingsOpen = false;
        // Menu du haut ouvert par Échap (Controls.js) ; paused : seul contre les bots, le match est arrêté
        this.menuOpen = false;
        this.paused = false;

        // État du Ballon & Règles
        this.ball = {
            mesh: null,
            shadowMesh: null,
            pos: new THREE.Vector3(0, 0.24, 2),
            vel: new THREE.Vector3(0, 0, 0),
            holderId: null,
            state: 'HELD', // 'HELD', 'PASS', 'SHOT', 'LOOSE'
            flightStart: new THREE.Vector3(),
            flightTarget: new THREE.Vector3(),
            flightTime: 0,
            flightDuration: 1.0,
            flightArcHeight: 4.5,
            pendingShotOutcome: null,
            passTargetId: null
        };

        this.matchRules = {
            scoreA: 0,
            scoreB: 0,
            shotClock: 24,
            possessionTeam: 'A',
            needsTakeBack: false,
            checkBallSeq: 0, // incrémenté à chaque remise en jeu : l'invité se replace quand il change
            sidesSwapped: false, // tout-terrain : vrai après la mi-temps (A attaque au sud, B au nord)
            // Chronos et fin de match (Clock.js)
            gameClock: 600,
            shotClockStopped: false, // tir en l'air ou rebond : le chrono de tir attend le prochain porteur
            deadBall: false,         // panier, 24 s, mi-temps : personne ne joue jusqu'à la remise en jeu
            matchOver: false,
            winner: null,
            endReason: '',
            goldenPoint: false,      // égalité à la fin du temps : le prochain panier gagne
            // Fautes et lancers francs (Fouls.js)
            teamFouls: { A: 0, B: 0 },
            freeThrow: null,         // série en cours : { shooterId, team, total, index }
            // Tactiques (Tactics.js) : choix des joueurs (gardé d'un match à l'autre), défense et système en cours
            tactics: { A: { def: 'AUTO', off: 'AUTO' }, B: { def: 'AUTO', off: 'AUTO' } },
            defenseNow: { A: 'MAN', B: 'MAN' },
            plays: { A: 'MOTION', B: 'MOTION' }
        };
        this.pendingHalftimeAlert = false;

        // Messages à l'écran de l'hôte, recopiés chez les invités
        this.alertSeq = 0;
        this.lastAlertText = '';

        this.cameraForward = new THREE.Vector3();
        this.viewFlipped = false;

        this.keys = {};
        this.crossoverCooldown = 0;
        this.networkSyncTimer = 0;

        // Sons (SoundFX.js) ; ceux de l'hôte partent aussi chez les invités avec l'état du monde (NetSync.js)
        this.sound = new SoundFX();
        this.pendingSfx = [];
        this.lastBallY = 0;
        this.crowdOn = false;

        this.initThreeScene();
        this.quality = new QualityManager(this);
        this.bindControls();
        this.bindGamepadEvents();
    }

    initThreeScene() {
        const w = window.innerWidth;
        const h = window.innerHeight;

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color('#090d16');
        this.scene.fog = new THREE.FogExp2('#090d16', 0.018);

        this.camera = new THREE.PerspectiveCamera(48, w / h, 0.1, 120);
        this.camera.position.set(0, 8.5, 11.5);

        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(w, h);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        setupRenderer(this.renderer, this.scene);

        this.container.innerHTML = '';
        this.container.appendChild(this.renderer.domElement);

        this.court = new CourtScene(this.scene);
        this.createBasketballMesh();
        this.createPassTargetIndicator();

        window.addEventListener('resize', () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        });
    }

    createBasketballMesh() {
        const ballGeo = new THREE.SphereGeometry(0.145, 24, 24);
        const ballMat = new THREE.MeshStandardMaterial({
            color: '#ea580c',
            roughness: 0.4,
            metalness: 0.05
        });
        this.ball.mesh = new THREE.Mesh(ballGeo, ballMat);
        this.ball.mesh.castShadow = true;
        this.scene.add(this.ball.mesh);

        // Ombre projetée au sol sous le ballon
        const shadowGeo = new THREE.CircleGeometry(0.18, 20);
        const shadowMat = new THREE.MeshBasicMaterial({
            color: '#000000',
            transparent: true,
            opacity: 0.45
        });
        this.ball.shadowMesh = new THREE.Mesh(shadowGeo, shadowMat);
        this.ball.shadowMesh.rotation.x = -Math.PI / 2;
        this.ball.shadowMesh.position.y = 0.015;
        this.scene.add(this.ball.shadowMesh);
    }

    /**
     * Crée le marqueur visuel 3D au sol sous le coéquipier actuellement visé pour la passe
     */
    createPassTargetIndicator() {
        const group = new THREE.Group();

        const outerRingGeo = new THREE.RingGeometry(0.58, 0.72, 32);
        const outerRingMat = new THREE.MeshBasicMaterial({
            color: '#facc15',
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.92
        });
        const outerRing = new THREE.Mesh(outerRingGeo, outerRingMat);
        outerRing.rotation.x = -Math.PI / 2;
        outerRing.position.y = 0.03;
        group.add(outerRing);

        // Flèche directionnelle pointant vers le coéquipier ciblé
        const arrowShape = new THREE.CircleGeometry(0.24, 3);
        const arrowMat = new THREE.MeshBasicMaterial({
            color: '#f97316',
            side: THREE.DoubleSide
        });
        const arrowMesh = new THREE.Mesh(arrowShape, arrowMat);
        arrowMesh.rotation.x = -Math.PI / 2;
        arrowMesh.position.set(0, 0.035, 0);
        group.add(arrowMesh);

        group.visible = false;
        this.passTargetIndicator = group;
        this.scene.add(group);
    }

    /**
     * Démarre un match à partir de la configuration du Lobby (3v3, 4v4 ou 5v5 + Bots IA)
     */
    startMatch(lobbyState, localPeerId) {
        for (const ent of this.entities.values()) {
            this.scene.remove(ent.mesh.root);
            ent.mesh.disposeOwned?.();
            if (ent.screenMarker) {
                this.scene.remove(ent.screenMarker);
                ent.screenMarker.geometry.dispose();
                ent.screenMarker.material.dispose();
            }
        }
        this.entities.clear();

        this.localPlayerId = localPeerId;
        this.currentMode = GAME_MODES[lobbyState.mode] || GAME_MODES['3v3'];
        this.difficulty = DIFFICULTY[lobbyState.difficulty] || DIFFICULTY.NORMAL;
        // Modes en solo (Practice.js) : bandeau à la place du tableau de score ; remis à zéro pour un vrai match
        this.practice = null;
        document.body.classList.toggle('practice', !!this.currentMode.practice);
        this.court.buildCourt(this.currentMode.isHalfCourt);

        this.matchRules.scoreA = 0;
        this.matchRules.scoreB = 0;
        this.matchRules.shotClock = 24;
        this.matchRules.possessionTeam = 'A';
        this.matchRules.needsTakeBack = false;
        this.matchRules.sidesSwapped = false;
        this.pendingHalftimeAlert = false;

        const playersPerTeam = this.currentMode.playersPerTeam;
        const humanPlayers = Object.values(lobbyState.players || {});

        const teamAHumans = humanPlayers.filter(p => p.team === 'A');
        const teamBHumans = humanPlayers.filter(p => p.team === 'B');

        teamAHumans.forEach((p, idx) => {
            this.spawnPlayerEntity(p.peerId, 'A', false, p.peerId === localPeerId, p.profile, idx);
        });
        teamBHumans.forEach((p, idx) => {
            this.spawnPlayerEntity(p.peerId, 'B', false, p.peerId === localPeerId, p.profile, idx);
        });

        if (lobbyState.fillWithBots !== false) {
            let presetCursor = 1;
            for (let i = teamAHumans.length; i < playersPerTeam; i++) {
                const botPreset = structuredClone(CHARACTER_PRESETS[presetCursor % CHARACTER_PRESETS.length]);
                botPreset.playerName = `[IA] ${botPreset.playerName}`;
                presetCursor++;
                this.spawnPlayerEntity(`bot_A_${i}`, 'A', true, false, botPreset, i);
            }
            for (let i = teamBHumans.length; i < playersPerTeam; i++) {
                const botPreset = structuredClone(CHARACTER_PRESETS[presetCursor % CHARACTER_PRESETS.length]);
                botPreset.playerName = `[IA] ${botPreset.playerName}`;
                presetCursor++;
                this.spawnPlayerEntity(`bot_B_${i}`, 'B', true, false, botPreset, i);
            }
        }

        this.setMenuOpen(false); // le match commence menu fermé
        this.slowMo = 0;
        this.cinema = null;
        this.resetMatchClock();
        this.resetPositionsForCheckBall('A');
        this.updateScoreboardUI();
        this.quality.resetMeasure(); // ne pas juger la fluidité pendant la préparation du match
        this.isRunning = true;
    }

    spawnPlayerEntity(id, team, isBot, isLocal, profile, slotIndex) {
        const meshConfig = { ...profile, team };
        const charMesh = createCharacterMesh(meshConfig);
        this.scene.add(charMesh.root);

        if (isLocal && charMesh.selectionRing) {
            charMesh.selectionRing.material.color.set('#22c55e');
            charMesh.selectionRing.scale.set(1.25, 1.25, 1);
        }

        const entity = {
            id,
            team,
            isBot,
            isLocal,
            slotIndex,
            profile: meshConfig,
            mesh: charMesh,
            pos: new THREE.Vector3(0, 0, 0),
            vel: new THREE.Vector3(0, 0, 0),
            rotY: 0,
            state: 'IDLE',
            aiThinkTimer: 0.8 + Math.random() * 0.8,
            offBallPhase: 'PERIMETER', // 'CUT_BASKET' quand il coupe vers le cercle (Tactics.js, updateMotion)
            // Écrans (Screens.js)
            screenTimer: 0,      // > 0 : écran posé
            screenedTimer: 0,    // > 0 : bloqué par un écran (ralenti)
            pnr: null,           // bot qui pose un écran pour le porteur : { phase, handlerId, timer, ... }
            switchManId: null,   // bot défenseur : joueur pris après un changement (switch)
            switchTimer: 0
        };

        this.entities.set(id, entity);
        return entity;
    }

    /** Bandeau du bas : rappel des touches actuelles (manette puis clavier) */
    renderControlsLegend() {
        const bar = document.getElementById('controls-legend');
        if (!bar) return;
        const b = this.bindings;
        const keysOf = (id) => b.keys[id].filter(Boolean).map(c => b.keyName(c));
        const padOf = (id) => b.pad[id].filter(v => v !== null).map(i => b.padName(i));
        const item = (keys, text) => {
            const span = document.createElement('span');
            for (const k of keys) {
                const kbd = document.createElement('kbd');
                kbd.textContent = k;
                span.append(kbd, ' ');
            }
            span.append(text);
            return span;
        };
        const moveKeys = ['up', 'left', 'down', 'right'].map(id => keysOf(id)[0]).filter(Boolean).join(' ');
        const items = [item(['Stick G', moveKeys], 'Bouger / viser la passe')];
        for (const a of ACTIONS) {
            if (['up', 'down', 'left', 'right'].includes(a.id)) continue;
            const keys = [...padOf(a.id), ...keysOf(a.id)];
            if (keys.length) items.push(item(keys, a.label));
        }
        const change = document.createElement('button');
        change.type = 'button';
        change.className = 'controls-change-btn';
        change.textContent = '⚙️ Changer les touches';
        change.addEventListener('click', () => this.bindingsPanel?.open());
        items.push(change);
        bar.replaceChildren(...items);
    }

    /**
     * Ce que l'animation doit savoir en plus de l'état (AnimatedCharacter) : ballon en main, finition en cours,
     * tir lâché, box-out, réaction, fin de match. Calculé pareil chez l'hôte et chez les invités (état du monde)
     */
    animationInfo(ent) {
        const info = ent.animInfo || (ent.animInfo = {});
        const b = this.ball;
        const r = this.matchRules;
        info.hasBall = b.holderId === ent.id;
        info.finish = ent.isDunking ? ent.finishType : (ent.netFinish || null);
        info.finishT = ent.isDunking ? ent.dunkTimer / ent.dunkDuration : (ent.netFinishT || 0);
        info.release = b.state === 'SHOT' && b.pendingShotOutcome?.shooterId === ent.id ? b.flightTime : -1;
        info.boxOut = ent.boxOutTimer > 0;
        info.boxed = ent.boxedTimer > 0;
        info.react = ent.reactTimer > 0 ? ent.react : null;
        info.matchEnd = r.matchOver && r.winner ? (ent.team === r.winner ? 'WIN' : 'LOSE') : null;
        return info;
    }

    getLocalEntity() {
        return this.entities.get(this.localPlayerId);
    }

    /**
     * Son d'une action du jeu (SoundFX.js) à l'endroit `pos`. Décidé par l'hôte : il l'envoie aussi aux invités ;
     * chez un invité, seuls les sons calculés sur place (local = true, ex. le dribble) sont joués ici
     */
    playSound(name, pos = null, local = false) {
        if (!this.isAuthority && !local) return;
        this.sound.play(name, pos, this.camera);
        this.soundEffects(name, pos); // filet, secousse (Effects.js)
        const others = Object.keys(this.network.lobbyState?.players || {}).length > 1;
        if (this.isAuthority && !local && others && this.pendingSfx.length < 8) {
            this.pendingSfx.push([name, +(pos?.x ?? 0).toFixed(1), +(pos?.z ?? 0).toFixed(1)]);
        }
    }

    /** Rebond du dribble : le ballon tenu touche le parquet (calculé chez chacun, pas envoyé) */
    updateDribbleSound() {
        const b = this.ball;
        const holder = b.state === 'HELD' ? this.entities.get(b.holderId) : null;
        const dribbling = holder && (holder.state === 'DRIBBLE' || holder.state === 'CROSSOVER');
        if (dribbling && b.pos.y > this.lastBallY && this.lastBallFalling && this.lastBallY < 0.3) {
            this.playSound('dribble', b.pos, true);
        }
        this.lastBallFalling = b.pos.y < this.lastBallY;
        this.lastBallY = b.pos.y;
    }

    /**
     * L'hôte (ou le joueur seul) décide de tout : bots, ballon, paniers, score, remises en jeu.
     * Un invité ne simule que son propre joueur et applique l'état envoyé par l'hôte.
     */
    get isAuthority() {
        return this.network.isHost;
    }

    getHorizontalDist(a, b) {
        const dx = a.x - b.x;
        const dz = a.z - b.z;
        return Math.sqrt(dx * dx + dz * dz);
    }

    clampToCourtBounds(pos) {
        const halfW = this.court.courtWidth / 2 - 0.35;
        const halfL = this.court.courtLength / 2 - 0.35;
        pos.x = Math.max(-halfW, Math.min(halfW, pos.x));
        pos.z = Math.max(-halfL, Math.min(halfL, pos.z));
    }

    /**
     * Système physique d'anti-collision / séparation entre tous les joueurs :
     * Empêche les défenseurs et les attaquants de se superposer ("tous les uns sur les autres")
     */
    resolvePlayerCollisions() {
        const list = Array.from(this.entities.values());
        const minSeparation = 1.05; // Distance minimale en mètres entre 2 joueurs

        for (let i = 0; i < list.length; i++) {
            for (let j = i + 1; j < list.length; j++) {
                const a = list[i];
                const b = list[j];
                // Un écran ne recule pas : le défenseur qui le percute est arrêté (Screens.js)
                if (this.resolveScreenCollision(a, b)) continue;
                // Box-out : le joueur placé devant garde sa place, l'adversaire derrière est repoussé (Moves.js)
                if (this.resolveBoxOutCollision(a, b, minSeparation)) continue;

                const dx = b.pos.x - a.pos.x;
                const dz = b.pos.z - a.pos.z;
                const distSq = dx * dx + dz * dz;

                if (distSq < minSeparation * minSeparation) {
                    const dist = Math.sqrt(distSq);
                    const overlap = (minSeparation - dist) * 0.5;
                    // Exactement au même endroit : pas de direction, on les écarte de côté
                    const nx = dist > 1e-4 ? dx / dist : 1;
                    const nz = dist > 1e-4 ? dz / dist : 0;

                    a.pos.x -= nx * overlap;
                    a.pos.z -= nz * overlap;
                    b.pos.x += nx * overlap;
                    b.pos.z += nz * overlap;

                    this.clampToCourtBounds(a.pos);
                    this.clampToCourtBounds(b.pos);
                }
            }
        }
    }

    /**
     * Boucle principale de mise à jour (60 FPS)
     */
    /**
     * render = false : le match avance sans être dessiné (l'hôte est sur un autre écran ou son onglet est caché ;
     * les invités dépendent de lui, voir main.js)
     */
    update(dt, render = true) {
        if (!this.isRunning) return;
        // Murmure de la foule : seulement quand on regarde un match qui se joue
        const crowd = render && !this.paused && !this.matchRules.matchOver;
        if (crowd !== this.crowdOn) {
            this.crowdOn = crowd;
            this.sound.setCrowd(crowd ? 1 : 0);
        }
        if (this.paused) {
            this.pollGamepadInput(); // Start pour reprendre
            if (render) this.renderer.render(this.scene, this.camera);
            return;
        }
        if (render) this.quality.sample(dt);
        dt = this.gameDt(dt); // dunk au ralenti (Effects.js)

        if (this.crossoverCooldown > 0) this.crossoverCooldown -= dt;

        // 0. Chronos (hôte) et leur affichage ; écrans posés, défenseurs bloqués, pick and roll lancé par l'hôte ;
        //    box-out et interceptions (Moves.js), lancer franc d'un bot (Fouls.js), tactiques (Tactics.js)
        this.updateMatchClock(dt);
        this.updateClockUI();
        const matchOver = this.matchRules.matchOver;
        this.updateScreens(dt);
        this.updateMoveTimers(dt);
        this.updateFreeThrow(dt);
        this.updateTactics(dt);
        this.updateTacticsUI();

        // 0 bis. Lire l'état de la Manette (si connectée)
        const padInput = this.pollGamepadInput();

        // 1. Mise à jour du joueur local (Clavier + Manette)
        const me = this.getLocalEntity();
        if (me && !matchOver) {
            this.updateLocalPlayerControl(me, dt, padInput);
        }

        // 2. Mise à jour de l'indicateur de visée de passe au sol
        this.updatePassTargetIndicator();

        // 3. Mise à jour de la Jauge de Tir
        if (this.shotMeter.active && me) {
            const status = this.shotMeter.update(dt);
            if (status === 'AUTO_RELEASE' && this.ball.holderId === me.id) {
                this.executeShotRelease(me);
            }
        }

        // 4. Mise à jour des Bots IA (Marquage Individuel 1v1 + Spacing Offensif) : chez l'hôte seulement
        const isAuthority = this.isAuthority;
        for (const ent of this.entities.values()) {
            if (ent.isBot && isAuthority && !matchOver) {
                const x = ent.pos.x;
                const z = ent.pos.z;
                this.updateBotAI(ent, dt);
                this.faceRunningDirection(ent, x, z, dt); // repli : il se retourne et court (BotAI.js)
            }
        }

        // 4 bis. Lissage des joueurs reçus par le réseau (20 Hz) vers leur dernière position connue
        const smoothing = Math.min(1, dt * 15);
        for (const ent of this.entities.values()) {
            if (ent.isLocal || ent.isDunking || !ent.netPos) continue;
            if (isAuthority && ent.isBot) continue;
            if (this.getHorizontalDist(ent.pos, ent.netPos) > 2.5) {
                ent.pos.x = ent.netPos.x;
                ent.pos.z = ent.netPos.z;
            } else {
                ent.pos.x += (ent.netPos.x - ent.pos.x) * smoothing;
                ent.pos.z += (ent.netPos.z - ent.pos.z) * smoothing;
            }
        }

        // 5. Physique de Saut Vertical & Vol de DUNK (Tomahawk / Poster Dunk)
        for (const ent of this.entities.values()) {
            // Chez un invité, seuls ses propres sauts sont simulés (le reste vient de l'hôte)
            if (!isAuthority && !ent.isLocal) continue;
            if (ent.jumpCooldown && ent.jumpCooldown > 0) {
                ent.jumpCooldown -= dt;
            }

            // Si le joueur est en plein envol vers le panier (dunk, lay-up, euro step, alley-oop : Moves.js) :
            if (ent.isDunking) {
                ent.dunkTimer += dt;
                const t = Math.min(1.0, ent.dunkTimer / ent.dunkDuration);
                // Courbe parabolique de décollage jusqu'au-dessus du cercle (1.35m de saut -> mains à 3m25)
                this.stepFinish(ent, t);
                const holds = this.ball.holderId === ent.id && isAuthority;

                // Lay-up : le ballon part en haut du saut
                if (ent.finishType === 'LAYUP' && t >= 0.6 && !ent.layupReleased) {
                    ent.layupReleased = true;
                    if (holds) this.finishLayup(ent);
                }
                if (t >= 1.0) {
                    ent.isDunking = false;
                    ent.pos.y = 0;
                    ent.vel.y = 0;
                    ent.state = 'IDLE';
                    if (holds && ent.finishType !== 'LAYUP') {
                        this.finishDunkSlam(ent);
                    }
                }
                continue;
            }

            if (ent.pos.y > 0 || ent.vel.y > 0) {
                ent.pos.y += ent.vel.y * dt;
                ent.vel.y -= 13.5 * dt; // Gravité dynamique basket

                // Tant que le défenseur est dans les airs, il peut contrer un tir ou gober un rebond
                if (ent.pos.y > 0.12 && this.ball.holderId !== ent.id) {
                    this.tryBlockOrRebound(ent);
                }

                // Atterrissage au sol
                if (ent.pos.y <= 0) {
                    ent.pos.y = 0;
                    ent.vel.y = 0;
                    if (ent.state === 'CONTEST' || ent.state === 'SHOOT' || ent.state === 'DUNK') {
                        ent.state = 'IDLE';
                    }
                }
            }
        }

        // 6. Résolution des collisions entre joueurs (aucun empilement)
        this.resolvePlayerCollisions();

        // 7. Appliquer les positions et animations aux Meshes 3D
        for (const ent of this.entities.values()) {
            const root = ent.mesh.root;
            // Le corps pivote vite mais pas d'un coup (rotY saute quand la direction change) ; d'un coup
            // seulement quand le joueur est replacé (remise en jeu)
            const placed = root.position.distanceToSquared(ent.pos) > 4;
            const dYaw = Math.atan2(Math.sin(ent.rotY - root.rotation.y), Math.cos(ent.rotY - root.rotation.y));
            const turn = THREE.MathUtils.clamp(dYaw * Math.min(1, dt * 16), -14 * dt, 14 * dt); // demi-tour en ~0,25 s
            root.rotation.y = placed ? ent.rotY : root.rotation.y + turn;
            root.position.copy(ent.pos);
            // Garder l'anneau de sélection plaqué sur le parquet même quand le joueur saute
            if (ent.mesh.selectionRing) {
                ent.mesh.selectionRing.position.y = Math.max(0.02, 0.02 - ent.pos.y);
            }
            ent.mesh.updateAnimation(dt, ent.state, this.animationInfo(ent));
            this.updateScreenMarker(ent);
        }

        // 7. Mise à jour de la physique du Ballon
        this.updateBallPhysics(dt);
        this.updateDribbleSound();
        this.updatePractice(dt); // entraînement, concours à 3 points (Practice.js)

        // 8. Vérification de la règle "Take Back" derrière l'arc des 3 points en Demi-terrain
        if (isAuthority && this.currentMode.isHalfCourt && this.matchRules.needsTakeBack && this.ball.holderId) {
            const carrier = this.entities.get(this.ball.holderId);
            if (carrier) {
                const hoop = this.getAttackingHoopForTeam(carrier.team);
                const dist = this.getHorizontalDist(carrier.pos, hoop.rimPos);
                if (dist >= hoop.threePointRadius + 0.15) {
                    this.matchRules.needsTakeBack = false;
                    this.showRuleAlert('BALLON RESSORTI (CLEAR) — ATTAQUEZ !');
                    this.updateScoreboardUI();
                }
            }
        }

        // 9. Caméra dynamique 2K Cam / Suivi
        this.updateCamera(dt);
        this.court.updateNets(dt);
        this.declutterNameplates(dt);

        // 10. Synchronisation Réseau Temps Réel (20 Hz) :
        // l'hôte envoie tout l'état du monde, un invité envoie seulement son joueur
        this.networkSyncTimer += dt;
        if (this.networkSyncTimer >= 0.05 && !this.currentMode.practice) { // modes en solo : rien à envoyer
            this.networkSyncTimer = 0;
            if (isAuthority) {
                this.network.sendWorldState(this.buildWorldState());
            } else if (me) {
                this.network.sendPlayerState({
                    pos: { x: me.pos.x, y: me.pos.y, z: me.pos.z },
                    rotY: me.rotY,
                    state: me.state,
                    box: me.boxOutTimer > 0 // box-out : l'hôte gère les collisions
                });
            }
        }

        if (render) this.renderer.render(this.scene, this.camera);
    }
}

Object.assign(GameEngine.prototype, ControlsMethods, ActionsMethods, BallMethods, RulesMethods, BotAIMethods, CameraMethods,
    NetSyncMethods, ScreenMethods, ClockMethods, MatchSheetMethods, FoulMethods, MoveMethods, TacticMethods, EffectsMethods,
    PracticeMethods);
