/**
 * GameEngine.js
 * Moteur de Gameplay 3D, Physique du Ballon, Règles 3v3/4v4/5v5, Bots IA & Réseau :
 * - Support complet MANETTE (Gamepad API : Xbox / PlayStation / Générique) + Clavier
 * - Visée Directionnelle des Passes (Stick Gauche ou ZQSD/Flèches) avec indicateur visuel 3D
 *   sous le coéquipier ciblé en temps réel
 * - Marquage Individuel Strict (Man-to-Man 1v1) + Anti-Collision entre les joueurs pour
 *   qu'aucun défenseur ou attaquant ne s'empile l'un sur l'autre
 * - Caméra dynamique "2K Cam" ou "Vue Suivi"
 */

import * as THREE from 'three';
import { POSITIONS, CHARACTER_PRESETS, GAME_MODES } from '../config/constants.js';
import { CharacterMesh } from '../character/CharacterMesh.js';
import { CourtScene } from '../court/CourtScene.js';
import { ShotMeter } from './ShotMeter.js';

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
            checkBallSeq: 0 // incrémenté à chaque remise en jeu : l'invité se replace quand il change
        };

        // Messages à l'écran de l'hôte, recopiés chez les invités
        this.alertSeq = 0;
        this.lastAlertText = '';

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

    bindGamepadEvents() {
        window.addEventListener('gamepadconnected', (e) => {
            this.gamepadState.connected = true;
            this.gamepadState.id = e.gamepad.id;
            this.updateGamepadStatusBadge(true);
            this.showRuleAlert('🎮 MANETTE CONNECTÉE !', false);
        });

        window.addEventListener('gamepaddisconnected', () => {
            this.gamepadState.connected = false;
            this.updateGamepadStatusBadge(false);
            this.showRuleAlert('🎮 MANETTE DÉCONNECTÉE', false);
        });
    }

    updateGamepadStatusBadge(isConnected) {
        const badge = document.getElementById('hud-gamepad-badge');
        if (!badge) return;
        badge.classList.toggle('connected', isConnected);
        badge.textContent = isConnected ? '🎮 MANETTE ACTIVE' : '⌨️ CLAVIER / MANETTE';
    }

    bindControls() {
        window.addEventListener('keydown', (e) => {
            if (!this.isRunning) return;
            const code = e.code;
            this.keys[code] = true;

            const me = this.getLocalEntity();
            if (!me) return;

            // ESPACE : Tir (si porteur du ballon) ou Saut de Contre (si défenseur)
            if (code === 'Space' && !e.repeat) {
                e.preventDefault();
                this.handleActionShootOrBlockPress(me);
            }

            // R ou Clic / Y : Saut dédié pour Contre ou Rebond
            if (code === 'KeyR' && !e.repeat) {
                e.preventDefault();
                if (this.ball.holderId !== me.id) {
                    this.triggerJumpBlock(me);
                }
            }

            // E : Passe directionnelle vers le coéquipier visé (ou Demander la balle si un Bot l'a)
            if (code === 'KeyE' && !e.repeat) {
                this.handleActionPassOrCall(me);
            }

            // C : Crossover rapide
            if (code === 'KeyC' && !e.repeat) {
                this.triggerCrossover(me);
            }

            // F : Tentative d'interception (Steal)
            if (code === 'KeyF' && !e.repeat) {
                this.tryStealBall(me);
            }

            // V : Changer l'angle de caméra (2K Cam <-> Vue Suivi)
            if (code === 'KeyV' && !e.repeat) {
                this.toggleCameraMode();
            }
        });

        window.addEventListener('keyup', (e) => {
            if (!this.isRunning) return;
            const code = e.code;
            this.keys[code] = false;

            const me = this.getLocalEntity();
            if (!me) return;

            if (code === 'Space' && this.shotMeter.active && this.ball.holderId === me.id) {
                this.executeShotRelease(me);
            }
        });
    }

    handleActionShootOrBlockPress(me) {
        if (this.ball.holderId === me.id) {
            if (this.matchRules.needsTakeBack && this.currentMode.isHalfCourt) {
                this.showRuleAlert('RESSORS DERRIÈRE LA LIGNE DES 3 PTS !');
                return;
            }
            const hoop = this.getAttackingHoopForTeam(me.team);
            const dist = this.getHorizontalDist(me.pos, hoop.rimPos);
            const finishStat = me.profile.attributes?.finishing || 80;
            // Portée de Dunk : jusqu'à 3.85m du panier (et jusqu'à 4.25m pour un spécialiste Finition) !
            const maxDunkRange = 3.55 + ((finishStat - 60) / 39) * 0.70;

            if (dist <= maxDunkRange) {
                this.startDunkDrive(me, hoop, dist);
                return;
            }

            const contest = this.calculateContestFactor(me);
            this.shotMeter.startCharge(me.profile.attributes, dist, contest);
            me.state = 'SHOOT';
            me.vel.y = 3.6;
        } else {
            this.triggerJumpBlock(me);
        }
    }

    /**
     * Déclenche un envol spectaculaire vers le cercle pour écraser un DUNK (Tomahawk / Poster Dunk)
     */
    startDunkDrive(player, hoop, distToRim) {
        if (this.shotMeter.active) {
            this.shotMeter.active = false;
            if (this.shotMeter.meterEl) this.shotMeter.meterEl.classList.add('hidden');
        }

        const dirZ = hoop.side === 'NORTH' ? 1 : -1;
        const targetLanding = new THREE.Vector3(
            hoop.rimPos.x,
            0,
            hoop.rimPos.z + dirZ * 0.32
        );

        player.isDunking = true;
        player.dunkStartPos = player.pos.clone();
        player.dunkTargetPos = targetLanding;
        player.dunkHoop = hoop;
        player.dunkTimer = 0;
        player.dunkDuration = Math.max(0.38, Math.min(0.68, 0.34 + distToRim * 0.085));
        player.state = 'DUNK';
        player.rotY = Math.atan2(hoop.rimPos.x - player.pos.x, hoop.rimPos.z - player.pos.z);

        if (player.isLocal) this.network.sendGameEvent('DUNK_START', {
            playerId: player.id,
            startPos: { x: player.dunkStartPos.x, y: 0, z: player.dunkStartPos.z },
            targetPos: { x: targetLanding.x, y: 0, z: targetLanding.z },
            duration: player.dunkDuration
        });
    }

    /**
     * Déclenche un vrai Saut Vertical 3D pour Contrer un tir ou capter un Rebond
     */
    triggerJumpBlock(player) {
        if (player.pos.y > 0.08 || (player.jumpCooldown && player.jumpCooldown > 0)) return;

        const defAttr = player.profile.attributes?.defense || 78;
        const posScale = POSITIONS[player.profile.position]?.scaleY || 1.0;

        // Vélocité verticale de saut selon l'atout Défense et le Poste (jusqu'à ~1m15 de détente)
        player.vel.y = 4.4 + ((defAttr - 60) / 39) * 1.15;
        player.jumpCooldown = 0.72;
        player.state = 'CONTEST';

        // Orienter automatiquement le défenseur vers le ballon ou le tireur
        const carrier = this.ball.holderId ? this.entities.get(this.ball.holderId) : null;
        const lookAtPos = carrier ? carrier.pos : this.ball.pos;
        player.rotY = Math.atan2(lookAtPos.x - player.pos.x, lookAtPos.z - player.pos.z);

        // Petit élan aérien ("Closeout") vers le tireur s'il est proche
        if (carrier && carrier.team !== player.team) {
            const dist = this.getHorizontalDist(player.pos, carrier.pos);
            if (dist > 0.95 && dist < 3.2) {
                const dx = (carrier.pos.x - player.pos.x) / dist;
                const dz = (carrier.pos.z - player.pos.z) / dist;
                player.pos.x += dx * 0.32 * posScale;
                player.pos.z += dz * 0.32 * posScale;
                this.clampToCourtBounds(player.pos);
            }
        }

        this.tryBlockOrRebound(player);
    }

    handleActionPassOrCall(me) {
        if (this.ball.holderId === me.id) {
            this.passToAimedTeammate(me);
        } else {
            this.requestPassFromBot(me);
        }
    }

    toggleCameraMode() {
        this.cameraMode = this.cameraMode === '2K' ? 'FOLLOW' : '2K';
        this.showRuleAlert(`CAMÉRA : ${this.cameraMode === '2K' ? '2K CAM' : 'VUE SUIVI'}`, false);
    }

    /**
     * Lecture de la Manette (Standard Gamepad Mapping : Xbox / PlayStation)
     * - Stick Gauche (axes 0, 1) : Déplacement + Direction de visée de passe
     * - Stick Droit (axes 2, 3) : Direction de visée de passe prioritaire ou Crossover rapide
     * - Bouton 0 (A / Croix) : Passer au coéquipier visé / Demander la balle
     * - Bouton 2 (X / Carré) : Maintenir pour Tirer (Jauge de Tir) / Relâcher au Vert
     * - Bouton 1 (B / Rond) : Crossover rapide (en attaque) / Interception Steal (en défense)
     * - Bouton 3 (Y / Triangle) : Saut / Contre / Rebond
     * - RT / R2 (Bouton 7) ou RB (Bouton 5) : Sprint
     * - LT / L2 (Bouton 6) : Posture défensive (Lockdown)
     * - Select / Back (Bouton 8) : Changer Caméra (2K Cam / Suivi)
     */
    pollGamepadInput() {
        if (!navigator.getGamepads) return null;
        const pads = navigator.getGamepads();
        let activePad = null;
        for (let i = 0; i < pads.length; i++) {
            if (pads[i] && pads[i].connected) {
                activePad = pads[i];
                break;
            }
        }
        if (!activePad) return null;

        if (!this.gamepadState.connected) {
            this.gamepadState.connected = true;
            this.updateGamepadStatusBadge(true);
        }

        const deadzone = 0.18;
        const rawLX = activePad.axes[0] || 0;
        const rawLY = activePad.axes[1] || 0;
        const rawRX = activePad.axes[2] || 0;
        const rawRY = activePad.axes[3] || 0;

        const moveX = Math.abs(rawLX) > deadzone ? rawLX : 0;
        const moveZ = Math.abs(rawLY) > deadzone ? rawLY : 0;

        const rightStickX = Math.abs(rawRX) > 0.35 ? rawRX : 0;
        const rightStickZ = Math.abs(rawRY) > 0.35 ? rawRY : 0;

        const isPressed = (idx) => {
            const b = activePad.buttons[idx];
            if (!b) return false;
            return typeof b === 'object' ? (b.pressed || b.value > 0.5) : b > 0.5;
        };

        const wasPressed = (idx) => !!this.gamepadState.prevButtons[idx];
        const justPressed = (idx) => isPressed(idx) && !wasPressed(idx);
        const justReleased = (idx) => !isPressed(idx) && wasPressed(idx);

        const me = this.getLocalEntity();
        if (me) {
            // Bouton A / Croix (0) : Passe directionnelle ou Demander la passe
            if (justPressed(0)) {
                this.handleActionPassOrCall(me);
            }

            // Bouton X / Carré (2) : Tirer (Maintenir & Relâcher) ou Contrer en défense
            if (justPressed(2)) {
                this.gamepadState.isHoldingShoot = true;
                this.handleActionShootOrBlockPress(me);
            }
            if (justReleased(2) && this.gamepadState.isHoldingShoot) {
                this.gamepadState.isHoldingShoot = false;
                if (this.shotMeter.active && this.ball.holderId === me.id) {
                    this.executeShotRelease(me);
                }
            }

            // Bouton B / Rond (1) : Crossover (si porteur) ou Interception Steal (si défenseur)
            if (justPressed(1)) {
                if (this.ball.holderId === me.id) {
                    this.triggerCrossover(me);
                } else {
                    this.tryStealBall(me);
                }
            }

            // Bouton Y / Triangle (3) : Saut / Contre / Rebond
            if (justPressed(3)) {
                this.triggerJumpBlock(me);
            }

            // Bouton Back / Select (8) : Changer Caméra
            if (justPressed(8)) {
                this.toggleCameraMode();
            }
        }

        // Sauvegarder l'état des boutons pour la frame suivante
        const nextButtons = {};
        for (let i = 0; i < activePad.buttons.length; i++) {
            nextButtons[i] = isPressed(i);
        }
        this.gamepadState.prevButtons = nextButtons;

        return {
            moveX,
            moveZ,
            rightStickX,
            rightStickZ,
            sprint: isPressed(7) || isPressed(5),  // R2 / RT ou R1 / RB
            defend: isPressed(6) || isPressed(4)   // L2 / LT ou L1 / LB
        };
    }

    /**
     * Démarre un match à partir de la configuration du Lobby (3v3, 4v4 ou 5v5 + Bots IA)
     */
    startMatch(lobbyState, localPeerId) {
        for (const ent of this.entities.values()) {
            this.scene.remove(ent.mesh.root);
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
        const charMesh = new CharacterMesh(meshConfig);
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

    getAttackingHoopForTeam(team) {
        if (this.currentMode.isHalfCourt) {
            return this.court.getTargetHoop('NORTH');
        }
        return this.court.getTargetHoop(team === 'A' ? 'NORTH' : 'SOUTH');
    }

    /**
     * Remise en jeu ("Check Ball" en haut de la raquette en 3v3/4v4, ou remise en jeu 5v5)
     */
    resetPositionsForCheckBall(offenseTeam = 'A') {
        this.matchRules.possessionTeam = offenseTeam;
        this.matchRules.needsTakeBack = false;
        this.matchRules.shotClock = 24;
        if (this.isAuthority) this.matchRules.checkBallSeq++;

        const isHalf = this.currentMode.isHalfCourt;
        const offenseSpots = [
            new THREE.Vector3(0, 0, isHalf ? 0.6 : 1.0),
            new THREE.Vector3(-4.6, 0, isHalf ? -1.4 : -2.2),
            new THREE.Vector3(4.6, 0, isHalf ? -1.4 : -2.2),
            new THREE.Vector3(-3.2, 0, isHalf ? -4.2 : -5.0),
            new THREE.Vector3(3.2, 0, isHalf ? -4.2 : -5.0)
        ];

        const defenseSpots = [
            new THREE.Vector3(0, 0, isHalf ? -1.2 : -1.4),
            new THREE.Vector3(-3.6, 0, isHalf ? -2.4 : -3.0),
            new THREE.Vector3(3.6, 0, isHalf ? -2.4 : -3.0),
            new THREE.Vector3(-2.2, 0, isHalf ? -4.5 : -5.2),
            new THREE.Vector3(2.2, 0, isHalf ? -4.5 : -5.2)
        ];

        let offIdx = 0;
        let defIdx = 0;
        let ballCarrier = null;

        for (const ent of this.entities.values()) {
            if (ent.team === offenseTeam) {
                const spot = offenseSpots[offIdx % offenseSpots.length].clone();
                if (!isHalf && offenseTeam === 'B') spot.z *= -1;
                ent.pos.copy(spot);
                ent.slotIndex = offIdx;
                // Même porteur dans tous les onglets : le 1er de l'équipe (ordre du salon, identique partout)
                if (offIdx === 0) {
                    ballCarrier = ent;
                }
                offIdx++;
            } else {
                const spot = defenseSpots[defIdx % defenseSpots.length].clone();
                if (!isHalf && offenseTeam === 'B') spot.z *= -1;
                ent.pos.copy(spot);
                ent.slotIndex = defIdx;
                defIdx++;
            }
            ent.mesh.root.position.copy(ent.pos);
            ent.netPos = ent.pos.clone();
            ent.vel.set(0, 0, 0);
            ent.isDunking = false;
            ent.state = 'IDLE';
        }

        if (ballCarrier) {
            this.giveBallTo(ballCarrier.id, false);
        }
        this.showRuleAlert(`CHECK BALL — POSSESSION ÉQUIPE ${offenseTeam}`);
        this.updateScoreboardUI();
    }

    giveBallTo(playerId, isDefensiveChange = false) {
        const player = this.entities.get(playerId);
        if (!player) return;

        const prevTeam = this.matchRules.possessionTeam;
        this.ball.holderId = playerId;
        this.ball.state = 'HELD';
        this.matchRules.possessionTeam = player.team;

        if (this.currentMode.isHalfCourt && isDefensiveChange && prevTeam !== player.team) {
            const hoop = this.getAttackingHoopForTeam(player.team);
            const dist = this.getHorizontalDist(player.pos, hoop.rimPos);
            if (dist < hoop.threePointRadius) {
                this.matchRules.needsTakeBack = true;
                this.showRuleAlert('REBOND DÉFENSIF : RESSORS DERRIÈRE LES 3 PTS !');
            }
        }
        this.updateScoreboardUI();
    }

    triggerCrossover(entity) {
        if (this.ball.holderId !== entity.id || this.crossoverCooldown > 0) return;
        entity.mesh.dribbleHand = entity.mesh.dribbleHand === 'RIGHT' ? 'LEFT' : 'RIGHT';
        entity.state = 'CROSSOVER';

        const dribbleAttr = entity.profile.attributes?.dribble || 80;
        const burst = 0.65 + (dribbleAttr / 99) * 0.65;
        const sideDir = entity.mesh.dribbleHand === 'RIGHT' ? 1 : -1;
        entity.pos.x += sideDir * burst;
        this.clampToCourtBounds(entity.pos);

        this.crossoverCooldown = Math.max(0.32, 0.75 - (dribbleAttr / 99) * 0.4);
    }

    /**
     * Calcule quel coéquipier est visé par la direction actuelle (Clavier ZQSD/Flèches ou Stick Manette)
     */
    findAimedTeammate(passer) {
        const teammates = Array.from(this.entities.values()).filter(
            e => e.team === passer.team && e.id !== passer.id
        );
        if (teammates.length === 0) return null;

        // Direction de visée normalisée (aimDirection est mise à jour par le clavier ou le stick manette)
        let aimX = this.aimDirection.x;
        let aimZ = this.aimDirection.y;
        const aimLen = Math.sqrt(aimX * aimX + aimZ * aimZ);

        if (aimLen < 0.05) {
            // Si aucune direction n'est maintenue, utiliser l'orientation actuelle du joueur
            aimX = Math.sin(passer.rotY);
            aimZ = Math.cos(passer.rotY);
        } else {
            aimX /= aimLen;
            aimZ /= aimLen;
        }

        let bestTeammate = null;
        let bestScore = -Infinity;

        for (const mate of teammates) {
            const dx = mate.pos.x - passer.pos.x;
            const dz = mate.pos.z - passer.pos.z;
            const dist = Math.sqrt(dx * dx + dz * dz) || 0.001;

            const dirToMateX = dx / dist;
            const dirToMateZ = dz / dist;

            // Produit scalaire entre la direction visée et le vecteur vers ce coéquipier (-1 à +1)
            const dot = aimX * dirToMateX + aimZ * dirToMateZ;

            // Le score privilégie fortement l'alignement angulaire (dot) et légèrement la proximité
            const score = dot * 3.0 - (dist * 0.04);

            if (score > bestScore) {
                bestScore = score;
                bestTeammate = mate;
            }
        }

        return bestTeammate;
    }

    /**
     * Met à jour en continu l'anneau jaune/orange sous le coéquipier visé
     */
    updatePassTargetIndicator() {
        const me = this.getLocalEntity();
        if (!me || this.ball.holderId !== me.id || !this.passTargetIndicator) {
            if (this.passTargetIndicator) this.passTargetIndicator.visible = false;
            this.targetedTeammateId = null;
            return;
        }

        const aimedMate = this.findAimedTeammate(me);
        if (!aimedMate) {
            this.passTargetIndicator.visible = false;
            this.targetedTeammateId = null;
            return;
        }

        this.targetedTeammateId = aimedMate.id;
        this.passTargetIndicator.visible = true;
        this.passTargetIndicator.position.set(aimedMate.pos.x, 0.02, aimedMate.pos.z);

        // Orienter la flèche depuis le porteur vers le coéquipier ciblé
        const angle = Math.atan2(aimedMate.pos.x - me.pos.x, aimedMate.pos.z - me.pos.z);
        this.passTargetIndicator.rotation.y = angle;
    }

    passToAimedTeammate(passer) {
        const target = this.findAimedTeammate(passer);
        if (!target) return;
        this.launchPass(passer, target);
    }

    requestPassFromBot(humanPlayer) {
        const holder = this.entities.get(this.ball.holderId);
        if (!holder || !holder.isBot || holder.team !== humanPlayer.team) return;
        this.launchPass(holder, humanPlayer, true);
    }

    // broadcast : seules les actions du joueur local sont envoyées (une action reçue n'est jamais renvoyée)
    launchPass(fromEnt, toEnt, broadcast = fromEnt.isLocal) {
        this.ball.holderId = null;
        this.ball.state = 'PASS';
        this.ball.passTargetId = toEnt.id;
        this.ball.flightStart.copy(fromEnt.pos).add(new THREE.Vector3(0, 1.35, 0));
        this.ball.flightTarget.copy(toEnt.pos).add(new THREE.Vector3(0, 1.35, 0));
        this.ball.flightTime = 0;
        const dist = this.ball.flightStart.distanceTo(this.ball.flightTarget);
        this.ball.flightDuration = Math.max(0.20, Math.min(0.50, dist * 0.05));
        this.ball.flightArcHeight = 0.50;

        if (broadcast) this.network.sendGameEvent('PASS', {
            fromId: fromEnt.id,
            toId: toEnt.id
        });
    }

    executeShotRelease(shooter) {
        const hoop = this.getAttackingHoopForTeam(shooter.team);
        const dist = this.getHorizontalDist(shooter.pos, hoop.rimPos);
        const contest = this.calculateContestFactor(shooter);
        const outcome = this.shotMeter.releaseShot(shooter.profile.attributes, dist, contest);

        this.launchShotBall(shooter, hoop, outcome);
    }

    launchShotBall(shooter, hoop, outcome, broadcast = shooter.isLocal) {
        this.ball.holderId = null;
        this.ball.state = 'SHOT';
        this.ball.flightStart.copy(shooter.pos).add(new THREE.Vector3(0, 2.25, 0));

        const target = hoop.rimPos.clone();
        if (!outcome.isMake) {
            const missAngle = Math.random() * Math.PI * 2;
            target.x += Math.cos(missAngle) * 0.28;
            target.z += Math.sin(missAngle) * 0.28;
        }

        this.ball.flightTarget.copy(target);
        this.ball.flightTime = 0;
        const dist = this.getHorizontalDist(shooter.pos, hoop.rimPos);
        this.ball.flightDuration = Math.max(0.55, Math.min(1.25, 0.52 + dist * 0.08));
        this.ball.flightArcHeight = Math.max(1.2, dist * 0.34);
        this.ball.pendingShotOutcome = {
            ...outcome,
            shooterId: shooter.id,
            shooterTeam: shooter.team,
            shooterName: shooter.profile.playerName
        };

        if (broadcast) this.network.sendGameEvent('SHOT', {
            shooterId: shooter.id,
            outcome: this.ball.pendingShotOutcome
        });
    }

    /**
     * Tentative d'interception (Steal sur le dribbleur OU Interception d'une passe en plein vol)
     */
    tryStealBall(defender) {
        if (this.stealCooldown > 0) return;
        this.stealCooldown = 1.05;

        const defStat = defender.profile.attributes?.defense || 78;
        const posScale = POSITIONS[defender.profile.position]?.scaleY || 1.0;

        // Animation de fente / posture défensive active
        defender.state = 'DEFENSE';

        // CAS 1 : Une passe adverse est en l'air -> le défenseur plonge dans la ligne de passe !
        if (this.ball.state === 'PASS') {
            const distToBall = this.getHorizontalDist(defender.pos, this.ball.pos);
            if (distToBall < 2.15 * posScale) {
                const dx = (this.ball.pos.x - defender.pos.x) / (distToBall || 1);
                const dz = (this.ball.pos.z - defender.pos.z) / (distToBall || 1);
                defender.pos.x += dx * 0.40;
                defender.pos.z += dz * 0.40;
                this.clampToCourtBounds(defender.pos);
                defender.rotY = Math.atan2(dx, dz);

                const laneChance = Math.max(0.20, Math.min(0.45, 0.22 + ((defStat - 60) / 39) * 0.23));
                if (this.getHorizontalDist(defender.pos, this.ball.pos) < 1.25 * posScale && Math.random() < laneChance) {
                    this.giveBallTo(defender.id, true);
                    this.showRuleAlert(`⚡ PASSE INTERCEPTÉE PAR ${defender.profile.playerName} !`);
                    if (defender.isLocal) this.network.sendGameEvent('STEAL', { stealerId: defender.id });
                    return;
                }
            }
        }

        // CAS 2 : Un adversaire dribble avec la balle -> Fente vers le porteur et "Poke Steal"
        if (!this.ball.holderId) return;
        const carrier = this.entities.get(this.ball.holderId);
        if (!carrier || carrier.team === defender.team) return;

        const dist = this.getHorizontalDist(defender.pos, carrier.pos);
        if (dist > 1.95) return;

        // Petit pas d'attaque vers le ballon ("Reach-in lunge")
        if (dist > 0.85) {
            const dx = (carrier.pos.x - defender.pos.x) / dist;
            const dz = (carrier.pos.z - defender.pos.z) / dist;
            defender.pos.x += dx * 0.32;
            defender.pos.z += dz * 0.32;
            this.clampToCourtBounds(defender.pos);
            defender.rotY = Math.atan2(dx, dz);
        }

        const dribStat = carrier.profile.attributes?.dribble || 75;
        // Taux d'interception abaissé et réaliste (~15% à 32% selon Défense vs Dribble)
        const stealChance = Math.max(0.14, Math.min(0.32, 0.22 + (defStat - dribStat) * 0.005));

        if (Math.random() < stealChance) {
            this.giveBallTo(defender.id, true);
            this.showRuleAlert(`⚡ INTERCEPTION (STEAL) DE ${defender.profile.playerName} !`);
            if (defender.isLocal) this.network.sendGameEvent('STEAL', { stealerId: defender.id });
        } else {
            this.showRuleAlert(`Tentative d'interception ratée`);
        }
    }

    /**
     * Vérifie si un joueur (en plein saut ou au sol) contre un tir ou capte un rebond
     */
    tryBlockOrRebound(player) {
        const posScale = POSITIONS[player.profile.position]?.scaleY || 1.0;
        const defStat = player.profile.attributes?.defense || 78;
        // Un contre est décidé par l'écran du joueur qui saute (l'hôte pour les bots),
        // un rebond toujours par l'hôte
        const canBlock = player.isLocal || (player.isBot && this.isAuthority);
        const canRebound = this.isAuthority;

        // 1. CONTRE D'UN TIR EN VOL (SWAT BLOCK !)
        if (canBlock && this.ball.state === 'SHOT' && this.ball.pendingShotOutcome) {
            const shooterTeam = this.ball.pendingShotOutcome.shooterTeam;
            // On ne contre que les tirs de l'équipe adverse et dans la phase ascendante / début de trajectoire (< 68% du vol)
            if (shooterTeam !== player.team && this.ball.flightTime < this.ball.flightDuration * 0.68) {
                const horizDist = this.getHorizontalDist(player.pos, this.ball.pos);
                // Hauteur des mains levées du défenseur pendant son saut
                const defenderHandHeight = player.pos.y + 2.38 * posScale;
                const heightDiff = Math.abs(this.ball.pos.y - defenderHandHeight);
                const blockReach = (0.78 + ((defStat - 60) / 39) * 0.35) * posScale;

                if (horizDist <= blockReach && heightDiff <= 0.95 && player.pos.y > 0.12) {
                    this.executeShotBlock(player);
                    return true;
                }
            }
        }

        // 2. CONTRE SUR LE TIREUR AU MOMENT OÙ IL PRÉPARE SON TIR (SUR LA TÊTE)
        if (canBlock && this.ball.state === 'HELD' && this.ball.holderId) {
            const carrier = this.entities.get(this.ball.holderId);
            if (
                carrier &&
                carrier.team !== player.team &&
                (carrier.state === 'SHOOT' || carrier.state === 'DUNK') &&
                player.pos.y > 0.22
            ) {
                const horizDist = this.getHorizontalDist(player.pos, carrier.pos);
                const blockChance = 0.25 + ((defStat - 60) / 39) * 0.45 * posScale;
                if (horizDist <= 1.25 * posScale && Math.random() < blockChance) {
                    if (carrier.isLocal && this.shotMeter.active) {
                        this.shotMeter.active = false;
                        if (this.shotMeter.meterEl) this.shotMeter.meterEl.classList.add('hidden');
                    }
                    this.executeShotBlock(player, carrier);
                    return true;
                }
            }
        }

        // 3. REBOND SUR BALLON LIBRE (LOOSE BALL)
        if (canRebound && this.ball.state === 'LOOSE') {
            const dist = this.getHorizontalDist(player.pos, this.ball.pos);
            // Sauter permet d'attraper des rebonds beaucoup plus hauts (jusqu'à 3m20)
            const maxReboundHeight = player.pos.y + 2.35 * posScale;
            const reach = posScale * (player.pos.y > 0.15 ? 1.85 : 1.35);
            if (dist <= reach && this.ball.pos.y <= maxReboundHeight) {
                const isDefRebound = this.matchRules.possessionTeam !== player.team;
                this.giveBallTo(player.id, isDefRebound);
                this.showRuleAlert(`🏀 REBOND AÉRIEN DE ${player.profile.playerName} !`);
                return true;
            }
        }

        return false;
    }

    /**
     * Exécute physiquement le Contre (Block) : dévie violemment le ballon et affiche la bannière
     */
    executeShotBlock(blocker, shooter = null) {
        this.ball.holderId = null;
        this.ball.pendingShotOutcome = null;
        this.ball.state = 'LOOSE';

        // Direction du "Swat" (vers l'extérieur ou dans la direction où regarde le contreur)
        const swatDirX = Math.sin(blocker.rotY) * 4.5 + (Math.random() - 0.5) * 2.5;
        const swatDirZ = Math.cos(blocker.rotY) * 4.5 + (Math.random() - 0.5) * 2.5;

        this.ball.pos.y = Math.max(1.8, blocker.pos.y + 2.1);
        this.ball.vel.set(swatDirX, 2.6, swatDirZ);

        const msg = shooter
            ? `🚫 CONTRÉ PAR ${blocker.profile.playerName} SUR ${shooter.profile.playerName} !`
            : `🚫 CONTRE ÉNORME (BLOCK) DE ${blocker.profile.playerName} !`;

        this.showRuleAlert(msg);
        if (this.shotMeter) {
            this.shotMeter.showFeedback('TIR CONTRÉ (BLOCKED !)', 100, 'feedback-red', false);
        }

        if (blocker.isLocal) this.network.sendGameEvent('BLOCK', {
            blockerId: blocker.id,
            vel: { x: this.ball.vel.x, y: this.ball.vel.y, z: this.ball.vel.z },
            pos: { x: this.ball.pos.x, y: this.ball.pos.y, z: this.ball.pos.z }
        });
    }

    calculateContestFactor(shooter) {
        let maxContest = 0;
        for (const ent of this.entities.values()) {
            if (ent.team === shooter.team) continue;
            const d = this.getHorizontalDist(shooter.pos, ent.pos);
            const contestRadius = 2.45;
            if (d < contestRadius) {
                const defScore = (ent.profile.attributes?.defense || 75) / 99;
                const heightBonus = POSITIONS[ent.profile.position]?.scaleY || 1.0;
                const jumpBonus = ent.state === 'CONTEST' ? 0.30 : (ent.state === 'DEFENSE' ? 0.15 : 0);
                const proximity = (contestRadius - d) / contestRadius;
                let contest = proximity * defScore * heightBonus + jumpBonus;
                if (ent.isBot && !shooter.isBot) {
                    contest *= 0.80;
                }
                if (contest > maxContest) maxContest = contest;
            }
        }
        return Math.min(1.0, maxContest);
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

    updateLocalPlayerControl(me, dt, padInput) {
        if (me.isDunking) {
            return;
        }
        if (this.shotMeter.active) {
            const hoop = this.getAttackingHoopForTeam(me.team);
            me.rotY = Math.atan2(hoop.rimPos.x - me.pos.x, hoop.rimPos.z - me.pos.z);
            return;
        }

        let moveX = 0;
        let moveZ = 0;

        // Entrées Clavier (WASD / ZQSD / Flèches)
        if (this.keys['KeyW'] || this.keys['KeyZ'] || this.keys['ArrowUp']) moveZ -= 1;
        if (this.keys['KeyS'] || this.keys['ArrowDown']) moveZ += 1;
        if (this.keys['KeyA'] || this.keys['KeyQ'] || this.keys['ArrowLeft']) moveX -= 1;
        if (this.keys['KeyD'] || this.keys['ArrowRight']) moveX += 1;

        // Entrées Stick Gauche Manette
        if (padInput && (padInput.moveX !== 0 || padInput.moveZ !== 0)) {
            moveX = padInput.moveX;
            moveZ = padInput.moveZ;
        }

        // Si le joueur oriente le Stick Droit de la manette, cela oriente en priorité la visée de passe
        if (padInput && (padInput.rightStickX !== 0 || padInput.rightStickZ !== 0)) {
            this.aimDirection.set(padInput.rightStickX, padInput.rightStickZ).normalize();
        } else if (moveX !== 0 || moveZ !== 0) {
            this.aimDirection.set(moveX, moveZ).normalize();
        }

        const hasBall = this.ball.holderId === me.id;
        const posData = POSITIONS[me.profile.position] || POSITIONS.SF;
        const attrSpeedMod = hasBall
            ? 0.85 + ((me.profile.attributes?.dribble || 80) / 99) * 0.25
            : 0.88 + ((me.profile.attributes?.defense || 80) / 99) * 0.22;

        const isSprinting = this.keys['ShiftLeft'] || this.keys['ShiftRight'] || (padInput && padInput.sprint);
        const isDefending = this.keys['ShiftLeft'] || this.keys['KeyF'] || (padInput && padInput.defend);
        const speed = 5.2 * posData.baseSpeed * attrSpeedMod * (isSprinting ? 1.25 : 1.0);

        if (moveX !== 0 || moveZ !== 0) {
            const len = Math.sqrt(moveX * moveX + moveZ * moveZ);
            const normX = moveX / len;
            const normZ = moveZ / len;
            const mag = Math.min(1.0, len);

            me.pos.x += normX * speed * mag * dt;
            me.pos.z += normZ * speed * mag * dt;
            this.clampToCourtBounds(me.pos);

            me.rotY = Math.atan2(normX, normZ);
            if (me.pos.y <= 0.05) {
                me.state = hasBall ? 'DRIBBLE' : 'RUN';
            }
        } else {
            if (me.pos.y > 0.05) {
                me.state = hasBall ? 'SHOOT' : 'CONTEST';
            } else if (!hasBall && isDefending) {
                me.state = 'DEFENSE';
            } else {
                me.state = hasBall ? 'DRIBBLE' : 'IDLE';
            }
        }
    }

    /**
     * IA des Bots revue pour le plaisir de jeu :
     * 1. COÉQUIPIERS OFFENSIFS ACTIFS :
     *    - Enchaînent appels de balle au panier ("Basket Cuts"), sorties à 3 points ("Pop Out")
     *      et démarquages latéraux en permanence pour offrir des solutions de passe claires.
     *    - Quand un Bot allié reçoit la balle près du cercle suite à votre passe, il finit vite ("Catch & Finish").
     * 2. BOTS ADVERSES ÉQUILIBRÉS :
     *    - Défense individuelle (1v1) moins étouffante (plus de distance et léger temps de réaction)
     *      pour laisser vos coéquipiers prendre de l'avance lors de leurs coupes vers le panier.
     */
    updateBotAI(bot, dt) {
        const hasBall = this.ball.holderId === bot.id;
        const hoop = this.getAttackingHoopForTeam(bot.team);
        const posData = POSITIONS[bot.profile.position] || POSITIONS.SF;
        const isTeammateOfHuman = Array.from(this.entities.values()).some(
            e => !e.isBot && e.team === bot.team
        );
        // Niveau des Bots relevé : vitesse compétitive aussi bien pour vos alliés (4.75) que pour l'équipe adverse (4.35)
        const botSpeed = (isTeammateOfHuman ? 4.75 : 4.35) * posData.baseSpeed;

        if (hasBall) {
            // Si le Bot doit ressortir la balle derrière les 3Pts en demi-terrain
            if (this.currentMode.isHalfCourt && this.matchRules.needsTakeBack) {
                const takeBackSpot = new THREE.Vector3(0, 0, hoop.rimPos.z + hoop.threePointRadius + 0.9);
                this.moveEntityTowards(bot, takeBackSpot, botSpeed, dt);
                bot.state = 'DRIBBLE';
                return;
            }

            const distToHoop = this.getHorizontalDist(bot.pos, hoop.rimPos);
            const contest = this.calculateContestFactor(bot);
            bot.aiThinkTimer -= dt;

            // Si un Bot allié vient de recevoir votre passe en pleine coupe sous le panier (ou totalement ouvert), il tire tout de suite !
            if (isTeammateOfHuman && (distToHoop < 2.6 || (distToHoop >= 5.55 && contest < 0.22))) {
                const isThree = distToHoop >= 5.55;
                const shootStat = isThree ? bot.profile.attributes.shooting : bot.profile.attributes.finishing;
                const makeProb = Math.max(0.55, Math.min(0.88, (shootStat / 99) * 0.85 - contest * 0.25));
                const isMake = Math.random() < makeProb;
                this.launchShotBall(bot, hoop, {
                    isGreen: isMake && Math.random() < 0.50,
                    isMake,
                    isThreePointer: isThree
                });
                bot.state = distToHoop < 2.2 ? 'DUNK' : 'SHOOT';
                bot.vel.y = 3.8;
                bot.aiThinkTimer = 1.8;
                return;
            }

            // Si le joueur humain est dans son équipe et n'est pas en train de lui laisser finir une coupe, le Bot lui repasse très vite
            const humanTeammate = Array.from(this.entities.values()).find(
                e => !e.isBot && e.team === bot.team
            );
            if (humanTeammate && bot.aiThinkTimer <= 0 && Math.random() < 0.72) {
                this.launchPass(bot, humanTeammate);
                bot.aiThinkTimer = 1.2;
                return;
            }

            // Circulation de balle des Bots adverses
            if (!isTeammateOfHuman && bot.aiThinkTimer <= 0 && Math.random() < 0.35) {
                const botMates = Array.from(this.entities.values()).filter(
                    e => e.team === bot.team && e.id !== bot.id
                );
                if (botMates.length > 0) {
                    const targetMate = botMates[Math.floor(Math.random() * botMates.length)];
                    this.launchPass(bot, targetMate);
                    bot.aiThinkTimer = 1.4;
                    return;
                }
            }

            const idealRange = (bot.profile.attributes?.shooting || 75) >= 84 ? 5.75 : 2.1;
            if (distToHoop > idealRange) {
                this.moveEntityTowards(bot, hoop.rimPos, botSpeed, dt);
                bot.state = 'DRIBBLE';
            } else if (bot.aiThinkTimer <= 0) {
                const isThree = distToHoop >= 5.55;
                const shootStat = isThree ? bot.profile.attributes.shooting : bot.profile.attributes.finishing;
                // Taux de réussite des tirs adverses calibré à 50% - 60% (modulé par votre contestation)
                const baseAdversaryPct = 0.52 + ((shootStat - 60) / 39) * 0.12; // ~52% à 64% ouvert
                const makeProb = isTeammateOfHuman
                    ? Math.max(0.48, Math.min(0.82, (shootStat / 99) * 0.80 - contest * 0.30))
                    : Math.max(0.28, Math.min(0.65, baseAdversaryPct - contest * 0.25));
                const isMake = Math.random() < makeProb;

                this.launchShotBall(bot, hoop, {
                    isGreen: isMake && Math.random() < 0.35,
                    isMake,
                    isThreePointer: isThree
                });
                bot.state = distToHoop < 2.2 ? 'DUNK' : 'SHOOT';
                bot.vel.y = 3.5;
                bot.aiThinkTimer = 1.65;
            }
        } else if (this.ball.state === 'LOOSE') {
            this.moveEntityTowards(bot, this.ball.pos, botSpeed * 0.96, dt);
            bot.state = 'RUN';
            this.tryBlockOrRebound(bot);
        } else if (this.matchRules.possessionTeam === bot.team) {
            // MOUVEMENT OFFENSIF DYNAMIQUE ("GIVE & GO" / APPELS DE BALLE / COUPES AU PANIER) :
            const dirZ = hoop.side === 'NORTH' ? 1 : -1;
            const sideSign = (bot.slotIndex % 2 === 0) ? -1 : 1;

            bot.cutTimer = (bot.cutTimer ?? 1.5) - dt;
            if (bot.cutTimer <= 0 || !bot.targetOffBallSpot) {
                if (bot.offBallPhase === 'PERIMETER') {
                    // Appel de balle tranchant vers le panier (Backdoor / Basket Cut) !
                    bot.offBallPhase = 'CUT_BASKET';
                    bot.targetOffBallSpot = new THREE.Vector3(
                        sideSign * (1.1 + Math.random() * 1.1),
                        0,
                        hoop.rimPos.z + dirZ * (1.1 + Math.random() * 0.9)
                    );
                    bot.cutTimer = 2.4 + Math.random() * 1.2;
                } else if (bot.offBallPhase === 'CUT_BASKET') {
                    // Ressortir derrière l'arc à 3 points (> 5.55m) pour ouvrir l'espace (Pop Out)
                    bot.offBallPhase = 'POP_OUT';
                    const isCorner = Math.random() < 0.5;
                    bot.targetOffBallSpot = new THREE.Vector3(
                        sideSign * (isCorner ? 5.8 : 4.4),
                        0,
                        hoop.rimPos.z + dirZ * (isCorner ? 1.8 : 4.9)
                    );
                    bot.cutTimer = 2.6 + Math.random() * 1.4;
                } else {
                    // Déplacement latéral en tête de raquette ou à 45° pour proposer une ligne de passe propre
                    bot.offBallPhase = 'PERIMETER';
                    bot.targetOffBallSpot = new THREE.Vector3(
                        sideSign * (2.6 + Math.random() * 2.4),
                        0,
                        hoop.rimPos.z + dirZ * (3.6 + Math.random() * 2.2)
                    );
                    bot.cutTimer = 2.2 + Math.random() * 1.2;
                }
            }

            const moveSpeed = bot.offBallPhase === 'CUT_BASKET' ? botSpeed * 1.18 : botSpeed * 0.98;
            const d = this.moveEntityTowards(bot, bot.targetOffBallSpot, moveSpeed, dt);

            if (d <= 0.45) {
                const carrier = this.ball.holderId ? this.entities.get(this.ball.holderId) : null;
                if (carrier) {
                    bot.rotY = Math.atan2(carrier.pos.x - bot.pos.x, carrier.pos.z - bot.pos.z);
                }
                bot.state = 'IDLE';
            } else {
                bot.state = 'RUN';
            }
        } else {
            // DÉFENSE INDIVIDUELLE 1v1 COMPÉTITIVE MAIS PROPRE :
            const opponents = Array.from(this.entities.values()).filter(e => e.team !== bot.team);
            if (opponents.length === 0) return;

            const assignedMan = opponents.find(o => o.slotIndex === bot.slotIndex)
                || opponents[bot.slotIndex % opponents.length];

            if (assignedMan) {
                const defHoop = this.getAttackingHoopForTeam(assignedMan.team);
                const isGuardingBall = this.ball.holderId === assignedMan.id;

                const toHoopVec = new THREE.Vector3().subVectors(defHoop.rimPos, assignedMan.pos);
                toHoopVec.y = 0;
                const distManToHoop = toHoopVec.length() || 1;
                toHoopVec.normalize();

                // Marquage 1v1 réactif (1.50m sur le porteur, 2.05m hors ballon)
                const cushion = isGuardingBall
                    ? Math.min(1.50, distManToHoop * 0.38)
                    : Math.min(2.05, distManToHoop * 0.44);

                const guardPos = new THREE.Vector3(
                    assignedMan.pos.x + toHoopVec.x * cushion,
                    0,
                    assignedMan.pos.z + toHoopVec.z * cushion
                );

                const defReactionSpeed = isTeammateOfHuman ? botSpeed * 0.92 : botSpeed * 0.86;
                const d = this.moveEntityTowards(bot, guardPos, defReactionSpeed, dt);
                bot.rotY = Math.atan2(assignedMan.pos.x - bot.pos.x, assignedMan.pos.z - bot.pos.z);

                // Les Bots défensifs peuvent sauter pour contester/contrer si vous tirez juste devant eux
                const distToMan = this.getHorizontalDist(bot.pos, assignedMan.pos);
                const defStat = bot.profile.attributes?.defense || 75;
                if (
                    (assignedMan.state === 'SHOOT' || assignedMan.state === 'DUNK') &&
                    distToMan < 1.55 &&
                    Math.random() < (0.025 + (defStat / 99) * 0.035)
                ) {
                    this.triggerJumpBlock(bot);
                } else if (bot.pos.y <= 0.05) {
                    bot.state = d > 0.45 ? 'RUN' : 'DEFENSE';
                }
            }
        }
    }

    moveEntityTowards(ent, targetVec, speed, dt) {
        const dx = targetVec.x - ent.pos.x;
        const dz = targetVec.z - ent.pos.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist > 0.25) {
            ent.pos.x += (dx / dist) * speed * dt;
            ent.pos.z += (dz / dist) * speed * dt;
            this.clampToCourtBounds(ent.pos);
            ent.rotY = Math.atan2(dx, dz);
        }
        return dist;
    }

    updateBallPhysics(dt) {
        if (this.ball.state === 'HELD' && this.ball.holderId) {
            const holder = this.entities.get(this.ball.holderId);
            if (holder) {
                if (holder.state === 'DUNK') {
                    // Pendant le Dunk, le ballon est armé très haut dans la main droite au-dessus du joueur
                    const posScale = POSITIONS[holder.profile.position]?.scaleY || 1.0;
                    const forwardX = Math.sin(holder.rotY) * 0.22;
                    const forwardZ = Math.cos(holder.rotY) * 0.22;
                    this.ball.pos.set(
                        holder.pos.x + forwardX,
                        holder.pos.y + 2.28 * posScale,
                        holder.pos.z + forwardZ
                    );
                } else {
                    const bounceY = holder.state === 'SHOOT'
                        ? holder.pos.y + 2.15
                        : Math.abs(Math.sin(holder.mesh.animTime * 1.6)) * 0.68 + 0.16;
                    const handSide = holder.mesh.dribbleHand === 'RIGHT' ? 0.34 : -0.34;
                    const forwardX = Math.sin(holder.rotY) * 0.28 + Math.cos(holder.rotY) * handSide;
                    const forwardZ = Math.cos(holder.rotY) * 0.28 - Math.sin(holder.rotY) * handSide;

                    this.ball.pos.set(
                        holder.pos.x + forwardX,
                        bounceY,
                        holder.pos.z + forwardZ
                    );
                }
            }
        } else if (this.ball.state === 'PASS') {
            this.ball.flightTime += dt;
            // Suivre dynamiquement la position du coéquipier receveur pendant le vol de la passe
            const receiver = this.entities.get(this.ball.passTargetId);
            if (receiver) {
                this.ball.flightTarget.copy(receiver.pos).add(new THREE.Vector3(0, 1.35, 0));
            }
            const t = Math.min(1.0, this.ball.flightTime / this.ball.flightDuration);
            this.ball.pos.lerpVectors(this.ball.flightStart, this.ball.flightTarget, t);
            this.ball.pos.y += Math.sin(t * Math.PI) * this.ball.flightArcHeight;

            // INTERCEPTION DE LIGNE DE PASSE (Pass Lane Steal) :
            // Si un défenseur adverse se trouve pile sur la trajectoire de la passe, probabilité modérée de la couper
            // Chez un invité : simple affichage du vol, l'hôte décide interception et réception
            if (!this.isAuthority) {
                this.syncBallMeshes(dt);
                return;
            }
            const passTeam = receiver ? receiver.team : this.matchRules.possessionTeam;
            for (const ent of this.entities.values()) {
                if (ent.team === passTeam) continue;
                const d = this.getHorizontalDist(ent.pos, this.ball.pos);
                const defStat = ent.profile.attributes?.defense || 75;
                const isActivelyDefending = ent.state === 'DEFENSE' || ent.state === 'CONTEST';
                const interceptRadius = isActivelyDefending ? 0.78 : 0.48;

                if (d <= interceptRadius && this.ball.pos.y <= ent.pos.y + 2.25) {
                    const interceptProb = ent.isLocal ? 0.42 : (0.14 + (defStat / 99) * 0.16);
                    if (Math.random() < interceptProb) {
                        this.giveBallTo(ent.id, true);
                        this.showRuleAlert(`⚡ PASSE COUPÉE PAR ${ent.profile.playerName} !`);
                        return;
                    }
                }
            }

            if (t >= 1.0) {
                this.giveBallTo(this.ball.passTargetId, false);
            }
        } else if (this.ball.state === 'SHOT') {
            this.ball.flightTime += dt;
            const t = Math.min(1.0, this.ball.flightTime / this.ball.flightDuration);
            this.ball.pos.lerpVectors(this.ball.flightStart, this.ball.flightTarget, t);
            this.ball.pos.y += Math.sin(t * Math.PI) * this.ball.flightArcHeight;

            if (t >= 1.0 && this.isAuthority) {
                this.resolveShotAtRim();
            }
        } else if (this.ball.state === 'LOOSE') {
            this.ball.vel.y -= 9.8 * dt;
            this.ball.pos.addScaledVector(this.ball.vel, dt);

            if (this.ball.pos.y <= 0.15) {
                this.ball.pos.y = 0.15;
                this.ball.vel.y = Math.abs(this.ball.vel.y) * 0.58;
                this.ball.vel.x *= 0.82;
                this.ball.vel.z *= 0.82;
            }
            this.clampToCourtBounds(this.ball.pos);

            for (const ent of this.entities.values()) {
                if (!this.isAuthority) break;
                if (this.getHorizontalDist(ent.pos, this.ball.pos) < 0.85 && this.ball.pos.y < 1.8) {
                    const isDefChange = this.matchRules.possessionTeam !== ent.team;
                    this.giveBallTo(ent.id, isDefChange);
                    break;
                }
            }
        }

        this.syncBallMeshes(dt);
    }

    syncBallMeshes(dt) {
        if (this.ball.mesh) {
            this.ball.mesh.position.copy(this.ball.pos);
            this.ball.mesh.rotation.x += dt * 4;
        }
        if (this.ball.shadowMesh) {
            this.ball.shadowMesh.position.set(this.ball.pos.x, 0.015, this.ball.pos.z);
        }
    }

    /**
     * Termine l'envol du Dunk au-dessus de l'arceau : évalue la réussite (Finition vs Contestation) et écrase le ballon !
     */
    finishDunkSlam(dunker) {
        const hoop = dunker.dunkHoop || this.getAttackingHoopForTeam(dunker.team);
        const finishStat = dunker.profile.attributes?.finishing || 82;
        const contest = this.calculateContestFactor(dunker);

        // Le Dunk a une probabilité très élevée (85% à 98%, ou "Poster Dunk" même face à un défenseur si Finition est haute)
        const dunkProb = Math.max(0.55, Math.min(0.98, 0.78 + ((finishStat - 60) / 39) * 0.22 - contest * 0.22));
        const isMake = Math.random() <= dunkProb;

        if (isMake) {
            // Le ballon est violemment écrasé à travers le filet vers le parquet
            this.ball.holderId = null;
            this.ball.state = 'LOOSE';
            this.ball.pos.copy(hoop.rimPos).add(new THREE.Vector3(0, -0.15, 0));
            this.ball.vel.set((Math.random() - 0.5) * 1.2, -7.5, (Math.random() - 0.5) * 1.2);

            if (dunker.team === 'A') {
                this.matchRules.scoreA += 2;
            } else {
                this.matchRules.scoreB += 2;
            }

            const isPoster = contest > 0.35;
            const title = isPoster ? '💥 POSTER DUNK MONSTRUEUX (+2 PTS) !' : '💥 SLAM DUNK (+2 PTS) !';
            this.showRuleAlert(`${title} (${dunker.profile.playerName})`);
            if (this.shotMeter && dunker.isLocal) {
                this.shotMeter.showFeedback(isPoster ? 'POSTER DUNK !' : 'SLAM DUNK !', Math.round(contest * 100), 'feedback-green', true);
            }
            this.updateScoreboardUI();

            const nextTeam = dunker.team === 'A' ? 'B' : 'A';
            setTimeout(() => {
                this.resetPositionsForCheckBall(nextTeam);
            }, 1200);
        } else {
            // Dunk raté sur l'arceau (Rim Out)
            this.ball.holderId = null;
            this.ball.state = 'LOOSE';
            this.ball.pos.copy(hoop.rimPos).add(new THREE.Vector3(0, 0.25, 0));
            this.ball.vel.set((Math.random() - 0.5) * 4.5, 4.2, (this.ball.pos.z < 0 ? 1 : -1) * 3.2);
            this.showRuleAlert(`DUNK MANQUÉ SUR L'ARCEAU ! REBOND !`);
            if (this.shotMeter && dunker.isLocal) {
                this.shotMeter.showFeedback('DUNK CONTESTÉ (RIM OUT)', Math.round(contest * 100), 'feedback-red', false);
            }
        }
    }

    resolveShotAtRim() {
        const outcome = this.ball.pendingShotOutcome;
        if (!outcome) return;

        if (outcome.isMake) {
            // Le ballon tombe à travers le filet : sinon le panier serait recompté à chaque image
            // jusqu'à la remise en jeu
            this.ball.pendingShotOutcome = null;
            this.ball.state = 'LOOSE';
            this.ball.pos.copy(this.ball.flightTarget).add(new THREE.Vector3(0, -0.2, 0));
            this.ball.vel.set(0, -3.5, 0);

            const pts = outcome.isThreePointer ? 3 : 2;
            if (outcome.shooterTeam === 'A') {
                this.matchRules.scoreA += pts;
            } else {
                this.matchRules.scoreB += pts;
            }

            const label = outcome.isThreePointer
                ? '🔥 PANIER À 3 POINTS (HORS CERCLE : +3 PTS) !'
                : '🏀 PANIER À 2 POINTS (DANS LE CERCLE : +2 PTS) !';
            this.showRuleAlert(`${label} (${outcome.shooterName})`);
            this.updateScoreboardUI();

            const nextTeam = outcome.shooterTeam === 'A' ? 'B' : 'A';
            setTimeout(() => {
                this.resetPositionsForCheckBall(nextTeam);
            }, 1200);
        } else {
            this.ball.state = 'LOOSE';
            this.ball.vel.set(
                (Math.random() - 0.5) * 3.8,
                3.2,
                (this.ball.pos.z < 0 ? 1 : -1) * (1.8 + Math.random() * 2.2)
            );
            this.showRuleAlert('REBOND EN JEU !');
        }
    }

    updateCamera() {
        const me = this.getLocalEntity();
        if (!me) return;

        if (this.cameraMode === '2K') {
            const hoop = this.getAttackingHoopForTeam(me.team);
            const dirZ = hoop.side === 'NORTH' ? 1 : -1;
            const targetCamPos = new THREE.Vector3(
                me.pos.x * 0.45,
                7.6,
                me.pos.z + dirZ * 8.8
            );
            this.camera.position.lerp(targetCamPos, 0.08);
            const lookTarget = new THREE.Vector3(
                me.pos.x * 0.35,
                1.4,
                (me.pos.z + hoop.rimPos.z) * 0.5
            );
            this.camera.lookAt(lookTarget);
        } else {
            const targetCamPos = new THREE.Vector3(me.pos.x, 4.2, me.pos.z + 6.2);
            this.camera.position.lerp(targetCamPos, 0.1);
            this.camera.lookAt(me.pos.x, 1.5, me.pos.z - 2.5);
        }
    }

    handleRemotePlayerState(packet) {
        const ent = this.entities.get(packet.senderId);
        if (!ent || ent.isLocal) return;
        if (packet.pos) {
            // x/z lissés dans update() ; la hauteur (saut) est appliquée directement
            ent.netPos = new THREE.Vector3(packet.pos.x, packet.pos.y, packet.pos.z);
            ent.pos.y = packet.pos.y;
        }
        if (typeof packet.rotY === 'number') {
            ent.rotY = packet.rotY;
        }
        if (packet.state) {
            ent.state = packet.state;
        }
    }

    /**
     * L'hôte envoie à 20 Hz : joueurs (sauf celui de l'invité), ballon, score et règles
     */
    buildWorldState() {
        const v = (vec) => ({ x: vec.x, y: vec.y, z: vec.z });
        const players = [];
        for (const ent of this.entities.values()) {
            players.push({
                id: ent.id,
                pos: v(ent.pos),
                rotY: ent.rotY,
                state: ent.state,
                dribbleHand: ent.mesh.dribbleHand
            });
        }
        const b = this.ball;
        return {
            players,
            ball: {
                state: b.state,
                holderId: b.holderId,
                pos: v(b.pos),
                vel: v(b.vel),
                flightStart: v(b.flightStart),
                flightTarget: v(b.flightTarget),
                flightTime: b.flightTime,
                flightDuration: b.flightDuration,
                flightArcHeight: b.flightArcHeight,
                passTargetId: b.passTargetId,
                pendingShotOutcome: b.pendingShotOutcome
            },
            rules: {
                scoreA: this.matchRules.scoreA,
                scoreB: this.matchRules.scoreB,
                possessionTeam: this.matchRules.possessionTeam,
                needsTakeBack: this.matchRules.needsTakeBack,
                checkBallSeq: this.matchRules.checkBallSeq
            },
            alert: { seq: this.alertSeq, text: this.lastAlertText }
        };
    }

    handleWorldState(packet) {
        if (!this.isRunning || this.isAuthority) return;

        // Remise en jeu chez l'hôte : se replacer aussi (y compris son propre joueur)
        const rules = packet.rules;
        if (rules && rules.checkBallSeq !== this.matchRules.checkBallSeq) {
            this.resetPositionsForCheckBall(rules.possessionTeam);
            this.matchRules.checkBallSeq = rules.checkBallSeq;
        }

        for (const p of packet.players || []) {
            const ent = this.entities.get(p.id);
            if (!ent || ent.isLocal) continue;
            ent.netPos = new THREE.Vector3(p.pos.x, p.pos.y, p.pos.z);
            ent.pos.y = p.pos.y;
            ent.rotY = p.rotY;
            ent.state = p.state;
            if (p.dribbleHand) ent.mesh.dribbleHand = p.dribbleHand;
        }

        const nb = packet.ball;
        if (nb) {
            const b = this.ball;
            b.state = nb.state;
            b.holderId = nb.holderId;
            b.pos.set(nb.pos.x, nb.pos.y, nb.pos.z);
            b.vel.set(nb.vel.x, nb.vel.y, nb.vel.z);
            b.flightStart.set(nb.flightStart.x, nb.flightStart.y, nb.flightStart.z);
            b.flightTarget.set(nb.flightTarget.x, nb.flightTarget.y, nb.flightTarget.z);
            b.flightTime = nb.flightTime;
            b.flightDuration = nb.flightDuration;
            b.flightArcHeight = nb.flightArcHeight;
            b.passTargetId = nb.passTargetId;
            b.pendingShotOutcome = nb.pendingShotOutcome;
        }

        if (rules) {
            const changed =
                rules.scoreA !== this.matchRules.scoreA ||
                rules.scoreB !== this.matchRules.scoreB ||
                rules.possessionTeam !== this.matchRules.possessionTeam ||
                rules.needsTakeBack !== this.matchRules.needsTakeBack;
            this.matchRules.scoreA = rules.scoreA;
            this.matchRules.scoreB = rules.scoreB;
            this.matchRules.possessionTeam = rules.possessionTeam;
            this.matchRules.needsTakeBack = rules.needsTakeBack;
            if (changed) this.updateScoreboardUI();
        }

        if (packet.alert && packet.alert.seq !== this.alertSeq) {
            this.alertSeq = packet.alert.seq;
            if (packet.alert.text) this.showRuleAlert(packet.alert.text);
        }
    }

    handleRemoteGameEvent(packet) {
        const { eventName, payload } = packet;
        if (eventName === 'PASS') {
            const fromEnt = this.entities.get(payload.fromId);
            const toEnt = this.entities.get(payload.toId);
            // L'hôte refuse une passe d'un joueur qui n'a plus le ballon (interception arrivée avant)
            if (this.isAuthority && this.ball.holderId !== payload.fromId) return;
            if (fromEnt && toEnt) this.launchPass(fromEnt, toEnt, false);
        } else if (eventName === 'SHOT') {
            const shooter = this.entities.get(payload.shooterId);
            if (this.isAuthority && this.ball.holderId !== payload.shooterId) return;
            if (shooter) {
                const hoop = this.getAttackingHoopForTeam(shooter.team);
                this.launchShotBall(shooter, hoop, payload.outcome, false);
            }
        } else if (eventName === 'BLOCK') {
            const blocker = this.entities.get(payload.blockerId);
            this.ball.holderId = null;
            this.ball.pendingShotOutcome = null;
            this.ball.state = 'LOOSE';
            if (payload.pos) this.ball.pos.set(payload.pos.x, payload.pos.y, payload.pos.z);
            if (payload.vel) this.ball.vel.set(payload.vel.x, payload.vel.y, payload.vel.z);
            if (blocker) {
                this.showRuleAlert(`🚫 CONTRE ÉNORME DE ${blocker.profile.playerName} !`);
            }
        } else if (eventName === 'STEAL') {
            const stealer = this.entities.get(payload.stealerId);
            if (stealer) {
                this.giveBallTo(stealer.id, true);
                this.showRuleAlert(`⚡ INTERCEPTION DE ${stealer.profile.playerName} !`);
            }
        } else if (eventName === 'DUNK_START') {
            const dunker = this.entities.get(payload.playerId);
            // Chez un invité, le dunk d'un autre est déjà visible par l'état du monde de l'hôte
            if (dunker && this.isAuthority) {
                dunker.isDunking = true;
                dunker.dunkStartPos = new THREE.Vector3(payload.startPos.x, 0, payload.startPos.z);
                dunker.dunkTargetPos = new THREE.Vector3(payload.targetPos.x, 0, payload.targetPos.z);
                dunker.dunkHoop = this.getAttackingHoopForTeam(dunker.team);
                dunker.dunkTimer = 0;
                dunker.dunkDuration = payload.duration || 0.5;
                dunker.state = 'DUNK';
            }
        }
    }

    updateScoreboardUI() {
        const scoreAEl = document.getElementById('hud-score-a');
        const scoreBEl = document.getElementById('hud-score-b');
        const modeEl = document.getElementById('hud-mode-badge');
        const ruleEl = document.getElementById('hud-rule-status');

        if (scoreAEl) scoreAEl.textContent = this.matchRules.scoreA;
        if (scoreBEl) scoreBEl.textContent = this.matchRules.scoreB;
        if (modeEl) modeEl.textContent = this.currentMode.id;
        if (ruleEl) {
            if (this.matchRules.needsTakeBack) {
                ruleEl.textContent = '⚠️ RESSORTIR DERRIÈRE LES 3 PTS';
                ruleEl.classList.add('takeback-warning');
            } else {
                ruleEl.textContent = `POSSESSION : ÉQUIPE ${this.matchRules.possessionTeam}`;
                ruleEl.classList.remove('takeback-warning');
            }
        }
    }

    showRuleAlert(message, shareWithGuests = true) {
        if (this.isAuthority && shareWithGuests) {
            this.alertSeq++;
            this.lastAlertText = message;
        }
        const toast = document.getElementById('court-rule-toast');
        if (!toast) return;
        toast.textContent = message;
        toast.classList.remove('hidden');
        clearTimeout(this.ruleToastTimer);
        this.ruleToastTimer = setTimeout(() => {
            toast.classList.add('hidden');
        }, 2400);
    }
}
