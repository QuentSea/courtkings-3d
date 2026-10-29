/**
 * Ball.js — Ballon : lancement des passes et des tirs, trajectoires, ballon libre, résolution des paniers et des dunks.
 * Méthodes ajoutées au prototype de GameEngine (voir la fin de GameEngine.js) : `this` est le moteur.
 */

import * as THREE from 'three';
import { POSITIONS } from '../config/constants.js';
import { dribbleBallHeight } from '../character/AnimatedCharacter.js';

export const BallMethods = {
    // broadcast : seules les actions du joueur local sont envoyées (une action reçue n'est jamais renvoyée)
    launchPass(fromEnt, toEnt, broadcast = fromEnt.isLocal) {
        this.ball.holderId = null;
        this.ball.state = 'PASS';
        this.ball.passTargetId = toEnt.id;
        this.ball.passFromId = fromEnt.id; // passes décisives et interceptions (feuille de match)
        this.ball.alleyOop = false;        // passe lobée : posé ensuite par launchAlleyOop (Moves.js)
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
    },

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
        // Chrono de tir arrêté jusqu'au prochain porteur (24 s s'il change d'équipe, 14 s mini sinon)
        this.matchRules.shotClockStopped = true;
        // Lancer franc (Fouls.js) : le dernier de la série remet la balle en jeu (rebond)
        const ft = this.isFreeThrowShooter(shooter) ? this.matchRules.freeThrow : null;
        const freeThrow = ft ? { index: ft.index, total: ft.total, last: ft.index >= ft.total } : null;
        if (freeThrow?.last) {
            this.matchRules.freeThrow = null;
            this.matchRules.deadBall = false;
        }
        if (this.isAuthority) this.onShotTaken(shooter, !!outcome.isThreePointer, !!freeThrow);
        // Faute sur le tireur (hôte) : sifflée tout de suite, lancers francs une fois le tir retombé
        const fouledBy = this.isAuthority && !freeThrow ? this.rollShootingFoul(shooter) : null;
        if (fouledBy) this.showRuleAlert(`🟨 FAUTE SUR LE TIR DE ${shooter.profile.playerName} !`);
        this.ball.pendingShotOutcome = {
            ...outcome,
            freeThrow,
            fouledBy,
            shooterId: shooter.id,
            shooterTeam: shooter.team,
            shooterName: shooter.profile.playerName
        };

        if (broadcast) this.network.sendGameEvent('SHOT', {
            shooterId: shooter.id,
            outcome: this.ball.pendingShotOutcome
        });
    },

    updateBallPhysics(dt) {
        if (this.ball.state === 'HELD' && this.ball.holderId) {
            const holder = this.entities.get(this.ball.holderId);
            if (holder) {
                if (holder.state === 'DUNK') {
                    // Pendant le Dunk, le ballon est armé très haut dans la main droite au-dessus du joueur
                    const posScale = POSITIONS[holder.profile.position]?.scaleY || 1.0;
                    const yaw = holder.mesh.root.rotation.y; // orientation affichée (elle pivote en douceur)
                    const forwardX = Math.sin(yaw) * 0.22;
                    const forwardZ = Math.cos(yaw) * 0.22;
                    this.ball.pos.set(
                        holder.pos.x + forwardX,
                        holder.pos.y + 2.28 * posScale,
                        holder.pos.z + forwardZ
                    );
                } else {
                    // Tir : devant la poitrine pendant l'armé (au sol), au-dessus du front en l'air ;
                    // dribble : la main suit le même rebond (AnimatedCharacter)
                    const posScale = POSITIONS[holder.profile.position]?.scaleY || 1.0;
                    const shooting = holder.state === 'SHOOT';
                    // Lay-up : ballon protégé contre la poitrine pendant la montée (même pose que l'animation)
                    const inAir = holder.pos.y > 0.05 &&
                        !(holder.isDunking && holder.dunkTimer / holder.dunkDuration < 0.45);
                    const bounceY = shooting
                        ? holder.pos.y + (inAir ? 2.15 : 1.25) * posScale
                        : dribbleBallHeight(holder.mesh.animTime);
                    const side = holder.mesh.dribbleHand === 'RIGHT' ? 1 : -1;
                    const handSide = shooting ? side * (inAir ? 0.12 : 0) : side * 0.34;
                    const fwd = shooting && !inAir ? 0.34 : 0.28;
                    const yaw = holder.mesh.root.rotation.y; // orientation affichée : le ballon reste dans la main
                    const forwardX = Math.sin(yaw) * fwd + Math.cos(yaw) * handSide;
                    const forwardZ = Math.cos(yaw) * fwd - Math.sin(yaw) * handSide;

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
                // Alley-oop : le ballon va dans les mains levées du receveur en plein vol
                this.ball.flightTarget.copy(receiver.pos).add(new THREE.Vector3(0, this.ball.alleyOop ? 2.3 : 1.35, 0));
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
                // Balle morte (panier, 24 s, fin) : personne ne la ramasse avant la remise en jeu
                if (!this.isAuthority || this.matchRules.deadBall) break;
                if (this.getHorizontalDist(ent.pos, this.ball.pos) < 0.85 * this.reboundReachFactor(ent) && this.ball.pos.y < 1.8) {
                    const isDefChange = this.matchRules.possessionTeam !== ent.team;
                    this.giveBallTo(ent.id, isDefChange);
                    break;
                }
            }
        }

        this.syncBallMeshes(dt);
    },

    syncBallMeshes(dt) {
        if (this.ball.mesh) {
            this.ball.mesh.position.copy(this.ball.pos);
            this.ball.mesh.rotation.x += dt * 4;
        }
        if (this.ball.shadowMesh) {
            this.ball.shadowMesh.position.set(this.ball.pos.x, 0.015, this.ball.pos.z);
        }
    },

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
        // Faute sur le dunkeur (Fouls.js) ; alley-oop = dunk sur une passe lobée (Moves.js)
        const foulerId = this.rollShootingFoul(dunker, true);
        const alleyOop = !!dunker.alleyOopFrom;
        dunker.alleyOopFrom = null;

        if (isMake) {
            // Le ballon est violemment écrasé à travers le filet vers le parquet
            this.ball.holderId = null;
            this.ball.state = 'LOOSE';
            this.ball.pos.copy(hoop.rimPos).add(new THREE.Vector3(0, -0.15, 0));
            this.ball.vel.set((Math.random() - 0.5) * 1.2, -7.5, (Math.random() - 0.5) * 1.2);

            const isPoster = contest > 0.35;
            const title = alleyOop ? '🚀 ALLEY-OOP (+2 PTS) !'
                : (isPoster ? '💥 POSTER DUNK MONSTRUEUX (+2 PTS) !' : '💥 SLAM DUNK (+2 PTS) !');
            this.showRuleAlert(`${title} (${dunker.profile.playerName})${foulerId ? ' + FAUTE !' : ''}`);
            if (this.shotMeter && dunker.isLocal) {
                this.shotMeter.showFeedback(alleyOop ? 'ALLEY-OOP !' : (isPoster ? 'POSTER DUNK !' : 'SLAM DUNK !'), Math.round(contest * 100), 'feedback-green', true);
            }
            // Score, fin de match ou mi-temps, puis remise en jeu (Clock.js) ; « and one » s'il y a faute
            this.onDunkAttempt(dunker, true);
            this.scorePoints(dunker.team, 2, dunker.id, alleyOop ? 'alleyoop' : 'dunk',
                foulerId ? () => this.commitFoul(foulerId, dunker.id, { shotPts: 2, made: true }) : null);
        } else {
            // Dunk raté sur l'arceau (Rim Out) : rebond, le chrono de tir repart à 14 s si l'attaque le reprend
            this.matchRules.shotClockStopped = true;
            this.onDunkAttempt(dunker, false);
            this.ball.holderId = null;
            this.ball.state = 'LOOSE';
            this.ball.pos.copy(hoop.rimPos).add(new THREE.Vector3(0, 0.25, 0));
            this.ball.vel.set((Math.random() - 0.5) * 4.5, 4.2, (this.ball.pos.z < 0 ? 1 : -1) * 3.2);
            if (this.shotMeter && dunker.isLocal) {
                this.shotMeter.showFeedback('DUNK CONTESTÉ (RIM OUT)', Math.round(contest * 100), 'feedback-red', false);
            }
            if (foulerId) {
                this.commitFoul(foulerId, dunker.id, { shotPts: 2, made: false });
            } else {
                this.showRuleAlert(`DUNK MANQUÉ SUR L'ARCEAU ! REBOND !`);
            }
        }
    },

    resolveShotAtRim() {
        const outcome = this.ball.pendingShotOutcome;
        if (!outcome) return;
        const ft = outcome.freeThrow;          // lancer franc (Fouls.js)
        const foulerId = outcome.fouledBy;     // faute sur le tireur : lancers francs après le tir
        const pts = ft ? 1 : (outcome.isThreePointer ? 3 : 2);

        if (outcome.isMake) {
            // Le ballon tombe à travers le filet : sinon le panier serait recompté à chaque image
            // jusqu'à la remise en jeu
            this.ball.pendingShotOutcome = null;
            this.ball.state = 'LOOSE';
            this.ball.pos.copy(this.ball.flightTarget).add(new THREE.Vector3(0, -0.2, 0));
            this.ball.vel.set(0, -3.5, 0);

            let label;
            if (ft) label = `🎯 LANCER FRANC RÉUSSI (${ft.index}/${ft.total})`;
            else if (outcome.kind === 'layup') label = '🏀 LAY-UP RÉUSSI (+2 PTS) !';
            else label = outcome.isThreePointer
                ? '🔥 PANIER À 3 POINTS (HORS CERCLE : +3 PTS) !'
                : '🏀 PANIER À 2 POINTS (DANS LE CERCLE : +2 PTS) !';
            this.showRuleAlert(`${label} (${outcome.shooterName})${foulerId ? ' + FAUTE !' : ''}`);
            // Score, fin de match ou mi-temps, puis remise en jeu (Clock.js) ;
            // « and one » après une faute, lancer suivant au milieu d'une série
            let then = null;
            if (foulerId) then = () => this.commitFoul(foulerId, outcome.shooterId, { shotPts: pts, made: true });
            else if (ft && !ft.last) then = () => this.nextFreeThrow();
            this.scorePoints(outcome.shooterTeam, pts, outcome.shooterId, ft ? 'ft' : (outcome.kind || 'shot'), then);
        } else {
            if (ft) this.onFreeThrowMissed(outcome); else this.onShotMissed(outcome);
            this.ball.pendingShotOutcome = null;
            this.ball.state = 'LOOSE';
            this.ball.vel.set(
                (Math.random() - 0.5) * 3.8,
                3.2,
                (this.ball.pos.z < 0 ? 1 : -1) * (1.8 + Math.random() * 2.2)
            );
            if (foulerId) {
                this.commitFoul(foulerId, outcome.shooterId, { shotPts: pts, made: false });
            } else if (ft && !ft.last) {
                this.showRuleAlert(`LANCER FRANC MANQUÉ (${ft.index}/${ft.total})`);
                this.nextFreeThrow();
            } else {
                this.showRuleAlert('REBOND EN JEU !');
            }
        }
    }
};
