/**
 * NetSync.js — Synchronisation réseau : état du monde de l'hôte, joueurs distants, actions reçues, départs.
 * Méthodes ajoutées au prototype de GameEngine (voir la fin de GameEngine.js) : `this` est le moteur.
 */

import * as THREE from 'three';

export const NetSyncMethods = {
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
    },

    /**
     * L'hôte envoie à 20 Hz : joueurs (sauf celui de l'invité), ballon, score et règles
     */
    buildWorldState() {
        // Arrondi au centimètre : paquet ~3 fois plus léger (envoyé 20 fois/s à chacun des 9 invités max)
        const r = (n) => Math.round(n * 100) / 100;
        const v = (vec) => ({ x: r(vec.x), y: r(vec.y), z: r(vec.z) });
        const players = [];
        for (const ent of this.entities.values()) {
            players.push({
                id: ent.id,
                pos: v(ent.pos),
                rotY: r(ent.rotY),
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
                flightTime: Math.round(b.flightTime * 1000) / 1000,
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
                checkBallSeq: this.matchRules.checkBallSeq,
                sidesSwapped: this.matchRules.sidesSwapped
            },
            alert: { seq: this.alertSeq, text: this.lastAlertText }
        };
    },

    /**
     * Un joueur a quitté pendant le match : l'IA de l'hôte reprend son personnage pour garder les équipes complètes
     */
    handlePlayerLeft(peerId) {
        const ent = this.entities.get(peerId);
        if (!ent || ent.isLocal) return;
        ent.isBot = true;
        ent.netPos = null;
        if (this.isRunning) this.showRuleAlert(`${ent.profile.playerName} a quitté : l'IA le remplace`);
    },

    handleWorldState(packet) {
        if (!this.isRunning || this.isAuthority) return;

        // Remise en jeu chez l'hôte : se replacer aussi (y compris son propre joueur)
        const rules = packet.rules;
        // Côtés d'abord : la remise en jeu ci-dessous place les joueurs selon le panier attaqué
        if (rules) this.matchRules.sidesSwapped = !!rules.sidesSwapped;
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
    },

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
        } else if (eventName === 'SCREEN_CALL') {
            // Un invité porteur demande un écran : l'hôte envoie un bot
            const handler = this.entities.get(payload.handlerId);
            if (handler && this.isAuthority && this.ball.holderId === handler.id) this.startPickAndRoll(handler, true);
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
};
