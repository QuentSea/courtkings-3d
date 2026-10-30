/**
 * NetSync.js — Synchronisation réseau : état du monde de l'hôte, joueurs distants, actions reçues, départs.
 * Méthodes ajoutées au prototype de GameEngine (voir la fin de GameEngine.js) : `this` est le moteur.
 */

import * as THREE from 'three';

export const NetSyncMethods = {
    handleRemotePlayerState(packet) {
        const ent = this.entities.get(packet.senderId);
        if (!ent || ent.isLocal) return;
        const p = packet.pos;
        // Position invalide (NaN, infini) ignorée : elle se propagerait à tous par les collisions
        if (p && [p.x, p.y, p.z].every(Number.isFinite)) {
            const next = new THREE.Vector3(p.x, Math.max(0, Math.min(3, p.y)), p.z);
            this.clampToCourtBounds(next);
            // Pas de téléportation : au plus 12 m/s depuis la dernière position reçue (sprint ~8 m/s, dunk ~10 m/s)
            const now = performance.now() / 1000;
            // Remise en jeu ou lancer franc : chacun est replacé d'un coup, 1 s sans limite pour suivre
            if (ent.netSeq !== this.matchRules.checkBallSeq) {
                ent.netSeq = this.matchRules.checkBallSeq;
                ent.netFreeUntil = now + 1;
            }
            if (ent.netPos && now > ent.netFreeUntil) {
                const maxStep = 12 * Math.min(1, now - ent.netTime) + 1.5;
                const dx = next.x - ent.netPos.x;
                const dz = next.z - ent.netPos.z;
                const d = Math.hypot(dx, dz);
                if (d > maxStep) {
                    next.x = ent.netPos.x + dx / d * maxStep;
                    next.z = ent.netPos.z + dz / d * maxStep;
                }
            }
            ent.netTime = now;
            // x/z lissés dans update() ; la hauteur (saut) est appliquée directement
            ent.netPos = next;
            ent.pos.y = next.y;
        }
        if (Number.isFinite(packet.rotY)) {
            ent.rotY = packet.rotY;
        }
        if (typeof packet.state === 'string' && /^[A-Z_]{2,16}$/.test(packet.state)) {
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
            const pl = {
                id: ent.id,
                pos: v(ent.pos),
                rotY: r(ent.rotY),
                state: ent.state,
                dribbleHand: ent.mesh.dribbleHand
            };
            // Pour les animations chez les invités : finition en cours, box-out, réaction
            if (ent.isDunking) pl.fin = [ent.finishType, r(ent.dunkTimer / ent.dunkDuration)];
            if (ent.boxOutTimer > 0) pl.bx = 1;
            if (ent.reactTimer > 0) pl.rx = ent.react;
            players.push(pl);
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
            // Sons de l'hôte depuis le dernier envoi (playSound) : les invités les jouent aussi
            sfx: this.pendingSfx.length ? this.pendingSfx.splice(0) : undefined,
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
            ent.netFinish = p.fin ? p.fin[0] : null;
            ent.netFinishT = p.fin ? p.fin[1] : 0;
            ent.boxOutTimer = p.bx ? 0.15 : 0;
            if (p.rx) { ent.react = p.rx; ent.reactTimer = 0.15; }
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
        for (const [name, x, z] of packet.sfx || []) {
            this.sound.play(name, { x, y: 1.5, z }, this.camera);
            this.soundEffects(name, new THREE.Vector3(x, 3, z)); // filet, secousse (Effects.js)
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

    /**
     * Hôte : distance horizontale d'un joueur au ballon en vol (segment départ → arrivée).
     * Le ballon a avancé pendant le trajet du message : on mesure à toute sa trajectoire.
     */
    distToFlight(ent) {
        const seg = new THREE.Line3(this.ball.flightStart, this.ball.flightTarget);
        return this.getHorizontalDist(ent.pos, seg.closestPointToPoint(ent.pos, true, new THREE.Vector3()));
    },

    handleRemoteGameEvent(packet) {
        const { eventName } = packet;
        const payload = packet.payload || {};
        // Hôte : un invité n'agit que pour son propre joueur (le nom dans l'action doit être le sien)
        const own = (id) => !this.isAuthority || id === packet.senderId;
        if (eventName === 'PASS') {
            const fromEnt = this.entities.get(payload.fromId);
            const toEnt = this.entities.get(payload.toId);
            // Sa propre passe, ou le ballon qu'il demande à un bot coéquipier (requestPassFromBot)
            const asked = fromEnt?.isBot && own(payload.toId) && toEnt && fromEnt.team === toEnt.team;
            if (!own(payload.fromId) && !asked) return;
            // L'hôte refuse une passe d'un joueur qui n'a plus le ballon (interception arrivée avant)
            if (this.isAuthority && this.ball.holderId !== payload.fromId) return;
            if (fromEnt && toEnt) this.launchPass(fromEnt, toEnt, false);
        } else if (eventName === 'SHOT') {
            const shooter = this.entities.get(payload.shooterId);
            if (!own(payload.shooterId)) return;
            if (this.isAuthority && this.ball.holderId !== payload.shooterId) return;
            if (shooter) {
                const hoop = this.getAttackingHoopForTeam(shooter.team);
                const o = payload.outcome || {};
                // La réussite vient de la jauge de l'invité ; les 3 points, l'hôte les vérifie à la position du tireur
                // (0,7 m de marge : sa position ici a un peu de retard)
                const deep = this.getHorizontalDist(shooter.pos, hoop.rimPos) >= 5.55 - 0.7;
                const outcome = this.isAuthority
                    ? { isMake: !!o.isMake, isGreen: !!o.isGreen, isThreePointer: !!o.isThreePointer && deep, kind: o.kind === 'layup' ? 'layup' : undefined }
                    : o;
                this.launchShotBall(shooter, hoop, outcome, false);
            }
        } else if (eventName === 'BLOCK') {
            const blocker = this.entities.get(payload.blockerId);
            if (!own(payload.blockerId)) return;
            // Contre arrivé en retard (ballon déjà retombé ou ramassé) : l'hôte l'ignore
            if (this.isAuthority && !this.canStillBeBlocked(blocker)) return;
            if (this.isAuthority) {
                // Près du ballon (ou du tireur) : pas de contre depuis l'autre bout du terrain
                const carrier = this.ball.state === 'HELD' ? this.entities.get(this.ball.holderId) : null;
                const near = carrier ? this.getHorizontalDist(blocker.pos, carrier.pos) <= 2.6 : this.distToFlight(blocker) <= 2.6;
                if (!near) return;
                this.onBlock(payload.blockerId, this.ball.pendingShotOutcome?.shooterId || this.ball.holderId);
            }
            const fouledShot = this.ball.pendingShotOutcome;
            this.ball.holderId = null;
            this.ball.pendingShotOutcome = null;
            this.ball.state = 'LOOSE';
            // Ballon renvoyé : position proche de la sienne et vitesse raisonnable, sinon l'hôte garde les siennes
            const p = payload.pos;
            if (p && [p.x, p.y, p.z].every(Number.isFinite) && Math.hypot(p.x - this.ball.pos.x, p.z - this.ball.pos.z) <= 3) {
                this.ball.pos.set(p.x, Math.max(0.2, Math.min(4.5, p.y)), p.z);
            }
            const v = payload.vel;
            if (v && [v.x, v.y, v.z].every(Number.isFinite)) {
                const clamp = (n) => Math.max(-10, Math.min(10, n));
                this.ball.vel.set(clamp(v.x), clamp(v.y), clamp(v.z));
            }
            if (blocker) {
                this.showRuleAlert(`🚫 CONTRE ÉNORME DE ${blocker.profile.playerName} !`);
            }
            this.foulOnBlockedShot(fouledShot); // faute déjà sifflée sur ce tir (Fouls.js)
        } else if (eventName === 'STEAL') {
            const stealer = this.entities.get(payload.stealerId);
            if (!own(payload.stealerId)) return;
            // Interception arrivée en retard (tir parti, balle morte, ballon déjà à son équipe) : ignorée
            if (this.isAuthority && !this.canStillBeStolen(stealer)) return;
            if (this.isAuthority) {
                // Près du porteur (1,95 m chez lui) ou de la ligne de passe (2,15 m), avec la marge du retard,
                // et pas plus d'une tentative par seconde (comme chez lui)
                const carrier = this.ball.state === 'HELD' ? this.entities.get(this.ball.holderId) : null;
                const near = carrier ? this.getHorizontalDist(stealer.pos, carrier.pos) <= 3 : this.distToFlight(stealer) <= 3.2;
                const now = performance.now() / 1000;
                if (!near || now - (stealer.netStealAt || 0) < 0.9) return;
                stealer.netStealAt = now;
            }
            if (stealer) {
                this.giveBallTo(stealer.id, true);
                this.showRuleAlert(`⚡ INTERCEPTION DE ${stealer.profile.playerName} !`);
            }
        } else if (eventName === 'SCREEN_CALL') {
            // Un invité porteur demande un écran : l'hôte envoie un bot
            const handler = this.entities.get(payload.handlerId);
            if (handler && own(handler.id) && this.isAuthority && this.ball.holderId === handler.id) this.startPickAndRoll(handler, true);
        } else if (eventName === 'DUNK_START') {
            const dunker = this.entities.get(payload.playerId);
            // Chez un invité, le dunk d'un autre est déjà visible par l'état du monde de l'hôte
            if (dunker && this.isAuthority && own(dunker.id) && !dunker.isDunking) {
                const hoop = this.getAttackingHoopForTeam(dunker.team);
                const pt = (q) => (q && Number.isFinite(q.x) && Number.isFinite(q.z) ? new THREE.Vector3(q.x, 0, q.z) : null);
                const start = pt(payload.startPos);
                const target = pt(payload.targetPos);
                const mid = payload.mid ? pt(payload.mid) : null;
                // Ballon en main, départ là où il est, à portée de finition (+ marge du retard), arrivée sous le cercle
                const ok = this.ball.state === 'HELD' && this.ball.holderId === dunker.id && start && target &&
                    this.getHorizontalDist(start, dunker.pos) <= 2.5 &&
                    this.getHorizontalDist(start, hoop.rimPos) <= this.finishRange(dunker) + 1.8 &&
                    this.getHorizontalDist(target, hoop.rimPos) <= 1.5 &&
                    (!payload.mid || (mid && this.getHorizontalDist(mid, hoop.rimPos) <= 5));
                if (!ok) return;
                this.beginFinish(
                    dunker,
                    hoop,
                    start,
                    target,
                    mid,
                    payload.kind === 'LAYUP' ? 'LAYUP' : 'DUNK',
                    Math.max(0.3, Math.min(1.1, Number(payload.duration) || 0.5))
                );
            }
        } else if (eventName === 'ALLEY_OOP') {
            const passer = this.entities.get(payload.fromId);
            const receiver = this.entities.get(payload.toId);
            if (!passer || !receiver || passer.team !== receiver.team) return;
            // Le passeur, ou le receveur qui la demande au bot porteur
            if (!own(passer.id) && !own(receiver.id)) return;
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
        } else if (eventName === 'SUB') {
            // Changement de joueur décidé par l'hôte (Fatigue.js) : même banc chez l'invité, on échange pareil
            const ent = this.entities.get(payload.id);
            const bench = ent && this.bench?.[ent.team]?.find(b => b.id === payload.benchId);
            if (!this.isAuthority && ent?.isBot && bench) this.swapWithBench(ent, bench);
        }
    }
};
