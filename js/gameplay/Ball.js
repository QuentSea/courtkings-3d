/**
 * Ball.js — Ballon : lancement des passes et des tirs, trajectoires, ballon libre, résolution des paniers et des dunks.
 * Méthodes ajoutées au prototype de GameEngine (voir la fin de GameEngine.js) : `this` est le moteur.
 */

import * as THREE from 'three';
import { POSITIONS } from '../config/constants.js';

export const BallMethods = {
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
    },

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
                // Balle morte (panier, 24 s, fin) : personne ne la ramasse avant la remise en jeu
                if (!this.isAuthority || this.matchRules.deadBall) break;
                if (this.getHorizontalDist(ent.pos, this.ball.pos) < 0.85 && this.ball.pos.y < 1.8) {
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

        if (isMake) {
            // Le ballon est violemment écrasé à travers le filet vers le parquet
            this.ball.holderId = null;
            this.ball.state = 'LOOSE';
            this.ball.pos.copy(hoop.rimPos).add(new THREE.Vector3(0, -0.15, 0));
            this.ball.vel.set((Math.random() - 0.5) * 1.2, -7.5, (Math.random() - 0.5) * 1.2);

            const isPoster = contest > 0.35;
            const title = isPoster ? '💥 POSTER DUNK MONSTRUEUX (+2 PTS) !' : '💥 SLAM DUNK (+2 PTS) !';
            this.showRuleAlert(`${title} (${dunker.profile.playerName})`);
            if (this.shotMeter && dunker.isLocal) {
                this.shotMeter.showFeedback(isPoster ? 'POSTER DUNK !' : 'SLAM DUNK !', Math.round(contest * 100), 'feedback-green', true);
            }
            // Score, fin de match ou mi-temps, puis remise en jeu (Clock.js)
            this.scorePoints(dunker.team, 2, dunker.id);
        } else {
            // Dunk raté sur l'arceau (Rim Out) : rebond, le chrono de tir repart à 14 s si l'attaque le reprend
            this.matchRules.shotClockStopped = true;
            this.ball.holderId = null;
            this.ball.state = 'LOOSE';
            this.ball.pos.copy(hoop.rimPos).add(new THREE.Vector3(0, 0.25, 0));
            this.ball.vel.set((Math.random() - 0.5) * 4.5, 4.2, (this.ball.pos.z < 0 ? 1 : -1) * 3.2);
            this.showRuleAlert(`DUNK MANQUÉ SUR L'ARCEAU ! REBOND !`);
            if (this.shotMeter && dunker.isLocal) {
                this.shotMeter.showFeedback('DUNK CONTESTÉ (RIM OUT)', Math.round(contest * 100), 'feedback-red', false);
            }
        }
    },

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
            const label = outcome.isThreePointer
                ? '🔥 PANIER À 3 POINTS (HORS CERCLE : +3 PTS) !'
                : '🏀 PANIER À 2 POINTS (DANS LE CERCLE : +2 PTS) !';
            this.showRuleAlert(`${label} (${outcome.shooterName})`);
            // Score, fin de match ou mi-temps, puis remise en jeu (Clock.js)
            this.scorePoints(outcome.shooterTeam, pts, outcome.shooterId);
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
};
