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
 */

import * as THREE from 'three';
import { CHARACTER_PRESETS, GAME_MODES } from '../config/constants.js';
import { createCharacterMesh } from '../character/createCharacter.js';
import { CourtScene } from '../court/CourtScene.js';
import { ShotMeter } from './ShotMeter.js';
import { setupRenderer } from '../render/RenderSetup.js';
import { ControlsMethods } from './Controls.js';
import { ActionsMethods } from './Actions.js';
import { BallMethods } from './Ball.js';
import { RulesMethods } from './Rules.js';
import { BotAIMethods } from './BotAI.js';
import { CameraMethods } from './Camera.js';
import { NetSyncMethods } from './NetSync.js';

export class GameEngine {
    constructor(canvasContainerId, networkManager) {
        this.container = document.getElementById(canvasContainerId);
        this.network = networkManager;
        this.shotMeter = new ShotMeter();

        this.isRunning = false;
        this.cameraMode = '2K'; // '2K' ou 'FOLLOW'
        this.currentMode = GAME_MODES['3v3'];

        // Entités Joueurs : id -> { id, team, isBot, isLocal, slotIndex, profile, mesh, pos, vel, rotY, state }
        this.entities = new Map();
        this.localPlayerId = null;

        // Direction actuelle de visée du joueur local (Clavier ou Stick Gauche Manette)
        this.aimDirection = new THREE.Vector2(0, -1);
        this.targetedTeammateId = null;
        this.passTargetIndicator = null;

        // État Manette (Gamepad API) pour détecter les fronts montants/descendants des boutons
        this.gamepadState = {
            connected: false,
            id: '',
            prevButtons: {},
            isHoldingShoot: false
        };

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
            isCheckBall: false,
            checkBallSeq: 0, // incrémenté à chaque remise en jeu : l'invité se replace quand il change
            sidesSwapped: false // tout-terrain : vrai après la mi-temps (A attaque au sud, B au nord)
        };
        this.pendingHalftimeAlert = false;

        // Messages à l'écran de l'hôte, recopiés chez les invités
        this.alertSeq = 0;
        this.lastAlertText = '';

        this.cameraForward = new THREE.Vector3();
        this.viewFlipped = false;

        this.keys = {};
        this.crossoverCooldown = 0;
        this.stealCooldown = 0;
        this.networkSyncTimer = 0;

        this.initThreeScene();
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
        }
        this.entities.clear();

        this.localPlayerId = localPeerId;
        this.currentMode = GAME_MODES[lobbyState.mode] || GAME_MODES['3v3'];
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

        this.resetPositionsForCheckBall('A');
        this.updateScoreboardUI();
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
            cutTimer: 1.5 + slotIndex * 1.1,
            offBallPhase: 'PERIMETER', // 'PERIMETER', 'CUT_BASKET', 'POP_OUT'
            targetOffBallSpot: null
        };

        this.entities.set(id, entity);
        return entity;
    }

    getLocalEntity() {
        return this.entities.get(this.localPlayerId);
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

                const dx = b.pos.x - a.pos.x;
                const dz = b.pos.z - a.pos.z;
                const distSq = dx * dx + dz * dz;

                if (distSq < minSeparation * minSeparation) {
                    const dist = Math.sqrt(distSq) || 0.01;
                    const overlap = (minSeparation - dist) * 0.5;
                    const nx = dx / dist;
                    const nz = dz / dist;

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
    update(dt) {
        if (!this.isRunning) return;

        if (this.crossoverCooldown > 0) this.crossoverCooldown -= dt;
        if (this.stealCooldown > 0) this.stealCooldown -= dt;

        // 0. Lire l'état de la Manette (si connectée)
        const padInput = this.pollGamepadInput();

        // 1. Mise à jour du joueur local (Clavier + Manette)
        const me = this.getLocalEntity();
        if (me) {
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
            if (ent.isBot && isAuthority) {
                this.updateBotAI(ent, dt);
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

            // Si le joueur est en plein envol de DUNK vers le panier :
            if (ent.isDunking) {
                ent.dunkTimer += dt;
                const t = Math.min(1.0, ent.dunkTimer / ent.dunkDuration);
                ent.pos.x = THREE.MathUtils.lerp(ent.dunkStartPos.x, ent.dunkTargetPos.x, t);
                ent.pos.z = THREE.MathUtils.lerp(ent.dunkStartPos.z, ent.dunkTargetPos.z, t);
                // Courbe parabolique de décollage jusqu'au-dessus du cercle (1.35m de saut -> mains à 3m25)
                ent.pos.y = Math.sin(t * Math.PI) * 1.38;
                ent.state = 'DUNK';

                if (t >= 1.0) {
                    ent.isDunking = false;
                    ent.pos.y = 0;
                    ent.vel.y = 0;
                    ent.state = 'IDLE';
                    if (this.ball.holderId === ent.id && isAuthority) {
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
            ent.mesh.root.position.copy(ent.pos);
            // Garder l'anneau de sélection plaqué sur le parquet même quand le joueur saute
            if (ent.mesh.selectionRing) {
                ent.mesh.selectionRing.position.y = Math.max(0.02, 0.02 - ent.pos.y);
            }
            ent.mesh.root.rotation.y = ent.rotY;
            ent.mesh.updateAnimation(dt, ent.state);
        }

        // 7. Mise à jour de la physique du Ballon
        this.updateBallPhysics(dt);

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

        // 10. Synchronisation Réseau Temps Réel (20 Hz) :
        // l'hôte envoie tout l'état du monde, un invité envoie seulement son joueur
        this.networkSyncTimer += dt;
        if (this.networkSyncTimer >= 0.05) {
            this.networkSyncTimer = 0;
            if (isAuthority) {
                this.network.sendWorldState(this.buildWorldState());
            } else if (me) {
                this.network.sendPlayerState({
                    pos: { x: me.pos.x, y: me.pos.y, z: me.pos.z },
                    rotY: me.rotY,
                    state: me.state
                });
            }
        }

        this.renderer.render(this.scene, this.camera);
    }
}

Object.assign(GameEngine.prototype, ControlsMethods, ActionsMethods, BallMethods, RulesMethods, BotAIMethods, CameraMethods, NetSyncMethods);
