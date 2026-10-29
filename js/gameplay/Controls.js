/**
 * Controls.js — Commandes du joueur local : clavier, manette (Gamepad API), boutons d'action et déplacement.
 * Méthodes ajoutées au prototype de GameEngine (voir la fin de GameEngine.js) : `this` est le moteur.
 */

import { POSITIONS } from '../config/constants.js';
import { SCREENED_SPEED, SCREEN_MIN_TIME } from './Screens.js';
import { FT_DISTANCE } from './Fouls.js';

export const ControlsMethods = {
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
    },

    updateGamepadStatusBadge(isConnected) {
        const badge = document.getElementById('hud-gamepad-badge');
        if (!badge) return;
        badge.classList.toggle('connected', isConnected);
        badge.textContent = isConnected ? '🎮 MANETTE ACTIVE' : '⌨️ CLAVIER / MANETTE';
    },

    bindControls() {
        window.addEventListener('keydown', (e) => {
            if (!this.isRunning || this.matchRules.matchOver) return;
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

            // T : Alley-oop (avec ballon : passe lobée au coéquipier visé ; sans : le demander au bot porteur)
            if (code === 'KeyT' && !e.repeat) {
                this.handleActionAlleyOop(me);
            }

            // C : Crossover rapide (près du cercle : euro step)
            if (code === 'KeyC' && !e.repeat) {
                this.triggerCrossover(me);
            }

            // B : Écran (« block ») — sans ballon : poser l'écran ; avec ballon : en demander un
            if (code === 'KeyB' && !e.repeat) {
                this.handleActionScreen(me);
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
    },

    handleActionShootOrBlockPress(me) {
        if (this.ball.holderId === me.id) {
            if (me.isDunking || this.shotMeter.active || this.ball.state !== 'HELD') return;
            // Lancer franc : jauge sans contestation ni saut (Fouls.js)
            if (this.isFreeThrowShooter(me)) {
                this.shotMeter.startCharge(me.profile.attributes, FT_DISTANCE, 0);
                me.state = 'SHOOT';
                return;
            }
            if (this.matchRules.needsTakeBack && this.currentMode.isHalfCourt) {
                this.showRuleAlert('RESSORS DERRIÈRE LA LIGNE DES 3 PTS !');
                return;
            }
            const hoop = this.getAttackingHoopForTeam(me.team);
            const dist = this.getHorizontalDist(me.pos, hoop.rimPos);

            // Près du cercle (3,55 à 4,25 m selon la finition) : dunk en sprintant, lay-up sinon (Moves.js)
            if (dist <= this.finishRange(me)) {
                this.startDunkDrive(me, hoop, dist, { kind: this.isSprintHeld() ? 'DUNK' : 'LAYUP' });
                return;
            }

            // En reculant : step-back (loin) ou fadeaway (près), Moves.js
            const move = this.applyShotMove(me, hoop, dist);
            me.shotContestMul = move ? move.contestMul : 1;
            const shotDist = this.getHorizontalDist(me.pos, hoop.rimPos);
            const contest = this.calculateContestFactor(me) * me.shotContestMul;
            this.shotMeter.startCharge(me.profile.attributes, shotDist, contest, move ? move.penalty : 0);
            me.state = 'SHOOT';
            me.vel.y = 3.6;
        } else {
            this.triggerJumpBlock(me);
        }
    },

    /** Sprint tenu (clavier ou manette) : décide dunk ou lay-up près du cercle */
    isSprintHeld() {
        return !!(this.keys['ShiftLeft'] || this.keys['ShiftRight'] || this.padSprint);
    },

    handleActionAlleyOop(me) {
        if (this.ball.holderId === me.id) {
            if (this.ball.state === 'HELD' && !me.isDunking && !this.isFreeThrowShooter(me)) this.tryAlleyOop(me);
        } else {
            this.requestAlleyOop(me);
        }
    },

    handleActionPassOrCall(me) {
        if (this.ball.holderId === me.id) {
            this.passToAimedTeammate(me);
        } else {
            this.requestPassFromBot(me);
        }
    },

    handleActionScreen(me) {
        if (this.ball.holderId === me.id) {
            this.callForScreen(me);
        } else if (this.isScreening(me)) {
            this.endScreen(me);
        } else {
            this.trySetScreen(me);
        }
    },

    toggleCameraMode() {
        this.cameraMode = this.cameraMode === '2K' ? 'FOLLOW' : '2K';
        this.showRuleAlert(`CAMÉRA : ${this.cameraMode === '2K' ? '2K CAM' : 'VUE SUIVI'}`, false);
    },

    /**
     * Lecture de la Manette (Standard Gamepad Mapping : Xbox / PlayStation)
     * - Stick Gauche (axes 0, 1) : Déplacement + Direction de visée de passe
     * - Stick Droit (axes 2, 3) : Direction de visée de passe prioritaire ou Crossover rapide
     * - Bouton 0 (A / Croix) : Passer au coéquipier visé / Demander la balle
     * - Bouton 2 (X / Carré) : Maintenir pour Tirer (Jauge de Tir) / Relâcher au Vert
     * - Bouton 1 (B / Rond) : Crossover (porteur) / Écran (attaquant sans ballon) / Interception (en défense)
     * - LB / L1 (Bouton 4) en attaque : Demander un écran (porteur) / Poser un écran
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
        if (me && !this.matchRules.matchOver) {
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

            // Bouton B / Rond (1) : Crossover (si porteur), Écran (attaquant sans ballon) ou Interception (défenseur)
            if (justPressed(1)) {
                if (this.ball.holderId === me.id) {
                    this.triggerCrossover(me);
                } else if (this.matchRules.possessionTeam === me.team) {
                    this.handleActionScreen(me);
                } else {
                    this.tryStealBall(me);
                }
            }

            // LB / L1 (4) en attaque : demander un écran (avec ballon) ou en poser un
            if (justPressed(4) && this.matchRules.possessionTeam === me.team) {
                this.handleActionScreen(me);
            }

            // Bouton Y / Triangle (3) : alley-oop (porteur, ou coéquipier d'un bot porteur), sinon Saut / Contre / Rebond
            if (justPressed(3)) {
                const holder = this.entities.get(this.ball.holderId);
                if (holder && holder.team === me.team && this.ball.state === 'HELD' && (holder === me || holder.isBot)) {
                    this.handleActionAlleyOop(me);
                } else {
                    this.triggerJumpBlock(me);
                }
            }

            // Bouton Back / Select (8) : Changer Caméra
            if (justPressed(8)) {
                this.toggleCameraMode();
            }
        }

        this.padSprint = isPressed(7) || isPressed(5);

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
    },

    updateLocalPlayerControl(me, dt, padInput) {
        if (me.isDunking) {
            return;
        }
        if (this.shotMeter.active) {
            const hoop = this.getAttackingHoopForTeam(me.team);
            me.rotY = Math.atan2(hoop.rimPos.x - me.pos.x, hoop.rimPos.z - me.pos.z);
            // Fadeaway : le tireur part en arrière pendant son saut (Moves.js)
            if (me.shotMove === 'FADE' && me.pos.y > 0) {
                me.pos.addScaledVector(me.fadeDir, 1.6 * dt);
                this.clampToCourtBounds(me.pos);
            }
            return;
        }
        // Lancers francs : chacun reste à sa place
        if (this.matchRules.freeThrow) {
            this.lastMoveDir = null;
            if (me.pos.y <= 0.05) me.state = this.ball.holderId === me.id ? 'DRIBBLE' : 'IDLE';
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

        // Commandes relatives à l'écran : si la caméra regarde vers le sud, haut/bas et gauche/droite s'inversent
        const flip = this.viewFlipped ? -1 : 1;
        moveX *= flip;
        moveZ *= flip;

        // Si le joueur oriente le Stick Droit de la manette, cela oriente en priorité la visée de passe
        if (padInput && (padInput.rightStickX !== 0 || padInput.rightStickZ !== 0)) {
            this.aimDirection.set(padInput.rightStickX * flip, padInput.rightStickZ * flip).normalize();
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
        // Posture défensive pendant un tir adverse : box-out (Moves.js)
        this.updateLocalBoxOut(me, isDefending);
        const screened = me.screenedTimer > 0 ? SCREENED_SPEED : 1;
        const speed = 5.2 * posData.baseSpeed * attrSpeedMod * (isSprinting ? 1.25 : 1.0) * screened;

        // Écran posé : on reste planté ; se déplacer (après un court instant) lève l'écran
        if (this.isScreening(me)) {
            if ((moveX !== 0 || moveZ !== 0) && me.screenHeld >= SCREEN_MIN_TIME) {
                this.endScreen(me);
            } else {
                return;
            }
        }

        if (moveX !== 0 || moveZ !== 0) {
            const len = Math.sqrt(moveX * moveX + moveZ * moveZ);
            const normX = moveX / len;
            const normZ = moveZ / len;
            const mag = Math.min(1.0, len);

            me.pos.x += normX * speed * mag * dt;
            me.pos.z += normZ * speed * mag * dt;
            this.clampToCourtBounds(me.pos);

            me.rotY = Math.atan2(normX, normZ);
            this.lastMoveDir = { x: normX, y: normZ }; // step-back / fadeaway : tirer en reculant
            if (me.pos.y <= 0.05) {
                me.state = hasBall ? 'DRIBBLE' : 'RUN';
            }
        } else {
            this.lastMoveDir = null;
            if (me.pos.y > 0.05) {
                me.state = hasBall ? 'SHOOT' : 'CONTEST';
            } else if (!hasBall && isDefending) {
                me.state = 'DEFENSE';
            } else {
                me.state = hasBall ? 'DRIBBLE' : 'IDLE';
            }
        }
    }
};
