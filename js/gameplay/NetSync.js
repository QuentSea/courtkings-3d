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
        ent.boxOutTimer = packet.box ? 0.15 : 0; // box-out de l'invité (collisions chez l'hôte, Moves.js)
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
                alleyOop: !!b.alleyOop,
                pendingShotOutcome: b.pendingShotOutcome
            },
            rules: {
                scoreA: this.matchRules.scoreA,
                scoreB: this.matchRules.scoreB,
                possessionTeam: this.matchRules.possessionTeam,
                needsTakeBack: this.matchRules.needsTakeBack,
                checkBallSeq: this.matchRules.checkBallSeq,
                sidesSwapped: this.matchRules.sidesSwapped,
                // Chronos et fin de match (Clock.js)
                gameClock: Math.round(this.matchRules.gameClock * 10) / 10,
                shotClock: Math.round(this.matchRules.shotClock * 10) / 10,
                shotClockStopped: this.matchRules.shotClockStopped,
                deadBall: this.matchRules.deadBall,
                goldenPoint: this.matchRules.goldenPoint,
                matchOver: this.matchRules.matchOver,
                winner: this.matchRules.winner,
                endReason: this.matchRules.endReason,
                // Fautes et lancers francs (Fouls.js), tactiques (Tactics.js)
                teamFouls: this.matchRules.teamFouls,
                freeThrow: this.matchRules.freeThrow,
                tactics: this.matchRules.tactics,
                defenseNow: this.matchRules.defenseNow,
                plays: this.matchRules.plays
            },
            alert: { seq: this.alertSeq, text: this.lastAlertText },
            // Feuille de match : seulement une fois le match fini, 2 fois par seconde (paquet plus lourd)
            sheet: this.matchRules.matchOver && (this.sheetPacket++ % 10 === 0) ? this.buildSheetPacket() : undefined
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
            // Lancer franc (Fouls.js) ou remise en jeu
            if (rules.freeThrow) {
                this.matchRules.freeThrow = rules.freeThrow;
                this.setupFreeThrow();
            } else {
                this.resetPositionsForCheckBall(rules.possessionTeam);
            }
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
        // Feuille de match (envoyée par l'hôte à la fin du match)
        if (packet.sheet) this.applySheetPacket(packet.sheet);

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
            b.alleyOop = !!nb.alleyOop;
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

            const r = this.matchRules;
            if (typeof rules.gameClock === 'number') r.gameClock = rules.gameClock;
            if (typeof rules.shotClock === 'number') r.shotClock = rules.shotClock;
            r.shotClockStopped = !!rules.shotClockStopped;
            r.deadBall = !!rules.deadBall;
            r.goldenPoint = !!rules.goldenPoint;
            const ended = !!rules.matchOver && !r.matchOver;
            r.matchOver = !!rules.matchOver;
            r.winner = rules.winner;
            r.endReason = rules.endReason || '';
            if (rules.teamFouls) r.teamFouls = rules.teamFouls;
            r.freeThrow = rules.freeThrow || null;
            if (rules.tactics) r.tactics = rules.tactics;
            if (rules.defenseNow) r.defenseNow = rules.defenseNow;
            if (rules.plays) r.plays = rules.plays;
            if (ended) {
                if (this.shotMeter?.active) this.shotMeter.cancel();
                this.showMatchEnd();
            }
        }

        if (packet.alert && packet.alert.seq !== this.alertSeq) {
            this.alertSeq = packet.alert.seq;
            if (packet.alert.text) this.showRuleAlert(packet.alert.text);
        }
    },

    /** Hôte : un tir adverse est-il encore en l'air (ou en préparation) au moment où le contre arrive ? */
    canStillBeBlocked(blocker) {
        if (!blocker || this.matchRules.deadBall) return false;
        if (this.ball.state === 'SHOT') return this.ball.pendingShotOutcome?.shooterTeam !== blocker.team;
        const carrier = this.ball.state === 'HELD' ? this.entities.get(this.ball.holderId) : null;
        return !!carrier && carrier.team !== blocker.team && (carrier.state === 'SHOOT' || carrier.state === 'DUNK');
    },

    /** Hôte : l'adversaire tient-il encore le ballon (ou le passe) au moment où l'interception arrive ? */
    canStillBeStolen(stealer) {
        if (!stealer || this.matchRules.deadBall) return false;
        if (this.ball.state === 'PASS') return this.matchRules.possessionTeam !== stealer.team;
        const carrier = this.ball.state === 'HELD' ? this.entities.get(this.ball.holderId) : null;
        return !!carrier && carrier.team !== stealer.team;
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
            // Contre arrivé en retard (ballon déjà retombé ou ramassé) : l'hôte l'ignore
            if (this.isAuthority && !this.canStillBeBlocked(blocker)) return;
            if (this.isAuthority) this.onBlock(payload.blockerId, this.ball.pendingShotOutcome?.shooterId || this.ball.holderId);
            const fouledShot = this.ball.pendingShotOutcome;
            this.ball.holderId = null;
            this.ball.pendingShotOutcome = null;
            this.ball.state = 'LOOSE';
            if (payload.pos) this.ball.pos.set(payload.pos.x, payload.pos.y, payload.pos.z);
            if (payload.vel) this.ball.vel.set(payload.vel.x, payload.vel.y, payload.vel.z);
            if (blocker) {
                this.showRuleAlert(`🚫 CONTRE ÉNORME DE ${blocker.profile.playerName} !`);
            }
            this.foulOnBlockedShot(fouledShot); // faute déjà sifflée sur ce tir (Fouls.js)
        } else if (eventName === 'STEAL') {
            const stealer = this.entities.get(payload.stealerId);
            // Interception arrivée en retard (tir parti, balle morte, ballon déjà à son équipe) : ignorée
            if (this.isAuthority && !this.canStillBeStolen(stealer)) return;
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
                this.beginFinish(
                    dunker,
                    this.getAttackingHoopForTeam(dunker.team),
                    new THREE.Vector3(payload.startPos.x, 0, payload.startPos.z),
                    new THREE.Vector3(payload.targetPos.x, 0, payload.targetPos.z),
                    payload.mid ? new THREE.Vector3(payload.mid.x, 0, payload.mid.z) : null,
                    payload.kind === 'LAYUP' ? 'LAYUP' : 'DUNK',
                    Math.max(0.3, Math.min(1.1, payload.duration || 0.5))
                );
            }
        } else if (eventName === 'ALLEY_OOP') {
            const passer = this.entities.get(payload.fromId);
            const receiver = this.entities.get(payload.toId);
            if (!passer || !receiver || passer.team !== receiver.team) return;
            if (this.isAuthority) {
                // L'hôte vérifie que le passeur a encore le ballon, puis lance (et relaie au receveur invité)
                if (this.ball.holderId !== passer.id || this.ball.state !== 'HELD') return;
                this.launchAlleyOop(passer, receiver, false);
            } else if (receiver.isLocal && !receiver.isDunking) {
                // Invité receveur : son joueur s'envole chez lui (le ballon suit l'état du monde de l'hôte)
                this.launchAlleyOop(passer, receiver, false);
            }
        } else if (eventName === 'FOUL') {
            // Faute d'un invité en voulant prendre le ballon : l'hôte la siffle si le porteur a encore le ballon
            const fouler = this.entities.get(payload.foulerId);
            if (!this.isAuthority || !fouler || packet.senderId !== fouler.id) return;
            if (this.ball.state === 'HELD' && this.ball.holderId === payload.victimId && this.canStillBeStolen(fouler)) {
                this.commitFoul(fouler.id, payload.victimId);
            }
        } else if (eventName === 'TACTIC') {
            // Tactique choisie par un invité : seulement pour sa propre équipe
            const player = this.entities.get(packet.senderId);
            if (this.isAuthority && player) this.applyTactics(player.team, payload.def, payload.off, player);
        }
    }
};
