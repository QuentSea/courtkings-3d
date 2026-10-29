/**
 * Controls.js — Commandes du joueur local : clavier, manette (Gamepad API), boutons d'action et déplacement.
 * Méthodes ajoutées au prototype de GameEngine (voir la fin de GameEngine.js) : `this` est le moteur.
 */

import { POSITIONS } from '../config/constants.js';
import { SCREENED_SPEED, SCREEN_MIN_TIME } from './Screens.js';
import { FT_DISTANCE } from './Fouls.js';
import { ACTION_ORDER } from './Bindings.js';

// Moment du saut dans la jauge de tir : 3,6 m/s de détente => haut du saut ~0,27 s plus tard, sur la zone verte (0,78)
const SHOT_JUMP_AT = 0.47;

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
            // Saisie dans un champ (nom du joueur, salon) ou fenêtre « Touches » ouverte : pas pour le jeu
            if (e.target.closest?.('input, textarea, select') || this.bindingsOpen) return;
            const bound = this.bindings.actionsFor('keys', e.code);
            // Échap (ou la touche de pause) : menu du haut et pause ; menu ouvert : le joueur ne bouge plus
            if ((e.code === 'Escape' || bound.includes('pause')) && this.canPause()) {
                e.preventDefault();
                if (!e.repeat) this.togglePause();
                return;
            }
            if (this.menuOpen) return;
            if (bound.length && this.isRunning) e.preventDefault(); // Espace et flèches ne font pas défiler la page
            if (!this.isRunning || this.matchRules.matchOver) return;
            this.keys[e.code] = true;

            const me = this.getLocalEntity();
            if (!me || e.repeat) return;
            this.runActions(bound, me);
        });

        window.addEventListener('keyup', (e) => {
            this.keys[e.code] = false;
            if (!this.isRunning) return;
            const me = this.getLocalEntity();
            if (!me) return;
            // Touche de tir relâchée : le tir part
            if (this.bindings.keys.shoot.includes(e.code) && this.shotMeter.active && this.ball.holderId === me.id) {
                this.executeShotRelease(me);
            }
        });
    },

    /** Pause possible : match en cours, affiché à l'écran, pas encore fini */
    canPause() {
        return this.isRunning && !this.matchRules.matchOver && document.body.classList.contains('in-match');
    },

    togglePause() {
        this.setMenuOpen(!this.menuOpen);
    },

    /**
     * Menu du haut (barre de navigation + barre d'outils du match) : caché pendant le match, affiché par Échap.
     * Seul contre les bots, le match est en pause ; à plusieurs, il continue (les autres jouent) mais ton joueur
     * ne reçoit plus tes commandes
     */
    setMenuOpen(open) {
        this.menuOpen = open;
        const solo = Object.keys(this.network.lobbyState?.players || {}).length <= 1;
        this.paused = open && solo;
        document.body.classList.toggle('menu-open', open);
        if (open) {
            this.keys = {};
            if (this.shotMeter.active) this.shotMeter.cancel();
        }
        const overlay = document.getElementById('pause-overlay');
        if (!overlay) return;
        overlay.classList.toggle('hidden', !open);
        document.getElementById('pause-title').textContent = this.paused ? '⏸ PAUSE' : '📋 MENU';
        document.getElementById('pause-text').textContent = this.paused
            ? 'Le match est arrêté. Échap (ou Start) pour reprendre.'
            : 'Partie à plusieurs : le match continue, ton joueur ne bouge plus. Échap (ou Start) pour revenir au jeu.';
    },

    /** Action tenue au clavier (déplacement, sprint, posture) */
    isKeyHeld(actionId) {
        return this.bindings.keys[actionId].some(code => code && this.keys[code]);
    },

    /** L'action a-t-elle du sens maintenant ? (une touche partagée lance la première qui en a) */
    canRunAction(actionId, me) {
        const hasBall = this.ball.holderId === me.id;
        const offense = this.matchRules.possessionTeam === me.team;
        switch (actionId) {
            case 'alleyoop': {
                const holder = this.entities.get(this.ball.holderId);
                return hasBall || (!!holder && holder.isBot && holder.team === me.team && this.ball.state === 'HELD');
            }
            case 'crossover': return hasBall;
            case 'screen': return offense;
            case 'steal': return !offense;
            case 'jump': return !hasBall;
            default: return true; // tir, passe, caméra
        }
    },

    /** Touche ou bouton appuyé : lance la première action possible parmi celles qui y sont liées */
    runActions(actionIds, me) {
        const id = ACTION_ORDER.find(a => actionIds.includes(a) && this.canRunAction(a, me));
        if (!id) return null;
        if (id === 'shoot') this.handleActionShootOrBlockPress(me);
        else if (id === 'pass') this.handleActionPassOrCall(me);
        else if (id === 'alleyoop') this.handleActionAlleyOop(me);
        else if (id === 'crossover') this.triggerCrossover(me);
        else if (id === 'screen') this.handleActionScreen(me);
        else if (id === 'steal') this.tryStealBall(me);
        else if (id === 'jump') this.triggerJumpBlock(me);
        else if (id === 'camera') this.toggleCameraMode();
        return id;
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
            // Armé d'abord (genoux fléchis), saut ensuite : le haut du saut tombe sur la zone verte
            me.shotJumpPending = true;
        } else {
            this.triggerJumpBlock(me);
        }
    },

    /** Sprint tenu (clavier ou manette) : décide dunk ou lay-up près du cercle */
    isSprintHeld() {
        return this.isKeyHeld('sprint') || !!this.padSprint || !!this.touch?.held.has('sprint');
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
     * Lecture de la Manette (disposition standard : Xbox / PlayStation). Boutons réglables dans « Touches »
     * (Bindings.js) ; stick gauche = déplacement + visée de passe, stick droit = visée de passe prioritaire.
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

        let moveX = Math.abs(rawLX) > deadzone ? rawLX : 0;
        let moveZ = Math.abs(rawLY) > deadzone ? rawLY : 0;

        const rightStickX = Math.abs(rawRX) > 0.35 ? rawRX : 0;
        const rightStickZ = Math.abs(rawRY) > 0.35 ? rawRY : 0;

        const isPressed = (idx) => {
            const b = activePad.buttons[idx];
            if (!b) return false;
            return typeof b === 'object' ? (b.pressed || b.value > 0.5) : b > 0.5;
        };
        const held = (actionId) => this.bindings.pad[actionId].some(i => i !== null && isPressed(i));
        const wasPressed = (idx) => !!this.gamepadState.prevButtons[idx];

        const me = this.getLocalEntity();
        // Bouton de pause (Start par défaut) : ouvre ou ferme le menu
        for (let i = 0; i < activePad.buttons.length; i++) {
            if (isPressed(i) && !wasPressed(i) && !this.bindingsOpen && this.canPause() &&
                this.bindings.actionsFor('pad', i).includes('pause')) this.togglePause();
        }
        // Fenêtre « Touches » ou menu ouverts : la manette ne commande plus le joueur
        const playing = !!me && !this.matchRules.matchOver && !this.bindingsOpen && !this.menuOpen;
        if (playing) {
            for (let i = 0; i < activePad.buttons.length; i++) {
                if (!isPressed(i) || wasPressed(i)) continue;
                // Le tir part quand on relâche le bouton qui l'a lancé
                if (this.runActions(this.bindings.actionsFor('pad', i), me) === 'shoot') this.gamepadState.shootButton = i;
            }
            const shootBtn = this.gamepadState.shootButton;
            if (shootBtn !== null && !isPressed(shootBtn)) {
                this.gamepadState.shootButton = null;
                if (this.shotMeter.active && this.ball.holderId === me.id) this.executeShotRelease(me);
            }
            // Boutons de déplacement (croix par défaut) quand le stick ne bouge pas
            if (moveX === 0 && moveZ === 0) {
                moveX = (held('right') ? 1 : 0) - (held('left') ? 1 : 0);
                moveZ = (held('down') ? 1 : 0) - (held('up') ? 1 : 0);
            }
        }
        this.padSprint = playing && held('sprint');

        // Sauvegarder l'état des boutons pour la frame suivante
        const nextButtons = {};
        for (let i = 0; i < activePad.buttons.length; i++) {
            nextButtons[i] = isPressed(i);
        }
        this.gamepadState.prevButtons = nextButtons;
        if (!playing) return null;

        return {
            moveX,
            moveZ,
            rightStickX,
            rightStickZ,
            sprint: this.padSprint,
            defend: held('defend')
        };
    },

    updateLocalPlayerControl(me, dt, padInput) {
        if (me.isDunking) {
            return;
        }
        if (!this.shotMeter.active) me.shotJumpPending = false;
        if (this.shotMeter.active) {
            const hoop = this.getAttackingHoopForTeam(me.team);
            me.rotY = Math.atan2(hoop.rimPos.x - me.pos.x, hoop.rimPos.z - me.pos.z);
            if (me.shotJumpPending && this.shotMeter.progress >= SHOT_JUMP_AT && me.pos.y <= 0.05) {
                me.shotJumpPending = false;
                me.vel.y = 3.6;
            }
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

        // Entrées Clavier (touches réglables, Bindings.js)
        if (this.isKeyHeld('up')) moveZ -= 1;
        if (this.isKeyHeld('down')) moveZ += 1;
        if (this.isKeyHeld('left')) moveX -= 1;
        if (this.isKeyHeld('right')) moveX += 1;

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

        const isSprinting = this.isKeyHeld('sprint') || (padInput && padInput.sprint);
        const isDefending = this.isKeyHeld('defend') || (padInput && padInput.defend);
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
