/**
 * Actions.js — Actions de basket : dunk, saut/contre, crossover, visée et passes, interceptions, contres, rebonds, contestation.
 * Méthodes ajoutées au prototype de GameEngine (voir la fin de GameEngine.js) : `this` est le moteur.
 */

import * as THREE from 'three';
import { POSITIONS } from '../config/constants.js';

export const ActionsMethods = {
    /**
     * Déclenche un envol vers le cercle : DUNK (Tomahawk / Poster Dunk) ou LAY-UP, avec euro step
     * (euro = 1 ou -1 : pas de côté) ; durée imposée pour un alley-oop (Moves.js)
     */
    startDunkDrive(player, hoop, distToRim, { kind = 'DUNK', euro = 0, duration = null, silent = false } = {}) {
        if (player.isLocal && this.shotMeter.active) this.shotMeter.cancel();

        const dirZ = hoop.side === 'NORTH' ? 1 : -1;
        const targetLanding = new THREE.Vector3(
            hoop.rimPos.x,
            0,
            hoop.rimPos.z + dirZ * (kind === 'LAYUP' ? 0.75 : 0.32)
        );
        let mid = null;
        if (euro) {
            // Euro step : passage par un point sur le côté de la ligne droite vers le cercle
            const dx = targetLanding.x - player.pos.x;
            const dz = targetLanding.z - player.pos.z;
            const len = Math.sqrt(dx * dx + dz * dz) || 1;
            mid = new THREE.Vector3(
                (player.pos.x + targetLanding.x) / 2 - (dz / len) * euro * 1.1,
                0,
                (player.pos.z + targetLanding.z) / 2 + (dx / len) * euro * 1.1
            );
            this.clampToCourtBounds(mid);
        }
        const dur = duration ?? (kind === 'LAYUP'
            ? Math.max(0.5, Math.min(0.8, 0.45 + distToRim * 0.09))
            : Math.max(0.38, Math.min(0.68, 0.34 + distToRim * 0.085)));
        this.beginFinish(player, hoop, player.pos.clone(), targetLanding, mid, kind, dur);

        if (player.isLocal && !silent) this.network.sendGameEvent('DUNK_START', {
            playerId: player.id,
            startPos: { x: player.dunkStartPos.x, y: 0, z: player.dunkStartPos.z },
            targetPos: { x: targetLanding.x, y: 0, z: targetLanding.z },
            mid: mid ? { x: mid.x, z: mid.z } : null,
            kind,
            duration: dur
        });
    },

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
        player.blockTried = false; // une seule chance de contrer le porteur par saut

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
    },

    triggerCrossover(entity) {
        if (this.ball.holderId !== entity.id || this.crossoverCooldown > 0 || entity.isDunking) return;
        if (this.isFreeThrowShooter(entity)) return;
        // Près du cercle : euro step (lay-up avec un pas de côté puis de l'autre, Moves.js)
        const hoop = this.getAttackingHoopForTeam(entity.team);
        const dist = this.getHorizontalDist(entity.pos, hoop.rimPos);
        if (entity.isLocal && !this.matchRules.needsTakeBack && dist <= this.finishRange(entity) + 0.8) {
            this.startDunkDrive(entity, hoop, dist, { kind: 'LAYUP', euro: entity.mesh.dribbleHand === 'RIGHT' ? 1 : -1 });
            this.showRuleAlert('💨 EURO STEP !', false);
            return;
        }
        entity.mesh.dribbleHand = entity.mesh.dribbleHand === 'RIGHT' ? 'LEFT' : 'RIGHT';
        entity.state = 'CROSSOVER';

        const dribbleAttr = entity.profile.attributes?.dribble || 80;
        const burst = 0.65 + (dribbleAttr / 99) * 0.65;
        const sideDir = entity.mesh.dribbleHand === 'RIGHT' ? 1 : -1;
        entity.pos.x += sideDir * burst;
        this.clampToCourtBounds(entity.pos);

        this.crossoverCooldown = Math.max(0.32, 0.75 - (dribbleAttr / 99) * 0.4);
    },

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
    },

    /**
     * Met à jour en continu l'anneau jaune/orange sous le coéquipier visé
     */
    updatePassTargetIndicator() {
        const me = this.getLocalEntity();
        if (!me || this.ball.holderId !== me.id || !this.passTargetIndicator) {
            if (this.passTargetIndicator) this.passTargetIndicator.visible = false;
            return;
        }

        const aimedMate = this.findAimedTeammate(me);
        if (!aimedMate) {
            this.passTargetIndicator.visible = false;
            return;
        }

        this.passTargetIndicator.visible = true;
        this.passTargetIndicator.position.set(aimedMate.pos.x, 0.02, aimedMate.pos.z);

        // Orienter la flèche depuis le porteur vers le coéquipier ciblé
        const angle = Math.atan2(aimedMate.pos.x - me.pos.x, aimedMate.pos.z - me.pos.z);
        this.passTargetIndicator.rotation.y = angle;
    },

    passToAimedTeammate(passer) {
        const target = this.findAimedTeammate(passer);
        if (!target) return;
        this.launchPass(passer, target);
    },

    requestPassFromBot(humanPlayer) {
        const holder = this.entities.get(this.ball.holderId);
        if (!holder || !holder.isBot || holder.team !== humanPlayer.team) return;
        this.launchPass(holder, humanPlayer, true);
    },

    executeShotRelease(shooter) {
        const hoop = this.getAttackingHoopForTeam(shooter.team);
        const dist = this.getHorizontalDist(shooter.pos, hoop.rimPos);
        // Lancer franc : personne ne conteste ; fadeaway : le défenseur conteste moins (Moves.js)
        const contest = this.isFreeThrowShooter(shooter) ? 0 : this.calculateContestFactor(shooter) * (shooter.shotContestMul || 1);
        shooter.shotMove = null;
        shooter.shotContestMul = 1;
        const outcome = this.shotMeter.releaseShot(shooter.profile.attributes, dist, contest);

        this.launchShotBall(shooter, hoop, outcome);
    },

    /**
     * Tentative d'interception (Steal sur le dribbleur OU Interception d'une passe en plein vol)
     */
    tryStealBall(defender) {
        if (defender.stealCd > 0 || this.matchRules.deadBall) return;
        defender.stealCd = 1.05;

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
        } else if (this.rollReachInFoul(defender, carrier, dist)) {
            // Faute en voulant prendre le ballon (Fouls.js) : décidée par l'hôte pour un invité
            if (this.isAuthority) this.commitFoul(defender.id, carrier.id);
            else this.network.sendGameEvent('FOUL', { foulerId: defender.id, victimId: carrier.id });
        } else {
            if (defender.isLocal) this.showRuleAlert(`Tentative d'interception ratée`, false);
        }
    },

    /**
     * Vérifie si un joueur (en plein saut ou au sol) contre un tir ou capte un rebond
     */
    tryBlockOrRebound(player) {
        const posScale = POSITIONS[player.profile.position]?.scaleY || 1.0;
        const defStat = player.profile.attributes?.defense || 78;
        // Un contre est décidé par l'écran du joueur qui saute (l'hôte pour les bots),
        // un rebond toujours par l'hôte
        const canBlock = player.isLocal || (player.isBot && this.isAuthority);
        const canRebound = this.isAuthority && !this.matchRules.deadBall; // balle morte : pas de rebond (Clock.js)

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
                player.pos.y > 0.22 &&
                !player.blockTried
            ) {
                const horizDist = this.getHorizontalDist(player.pos, carrier.pos);
                let blockChance = 0.25 + ((defStat - 60) / 39) * 0.45 * posScale;
                // Lancé vers le cercle (dunk, lay-up) : plus dur à contrer, encore plus après un euro step
                if (carrier.isDunking) blockChance *= carrier.dunkMid ? 0.2 : 0.35;
                if (horizDist <= 1.25 * posScale) player.blockTried = true; // un seul essai par saut (pas à chaque image)
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
            // Joueur enfermé par un box-out : il touche moins de rebonds (Moves.js)
            const reach = posScale * (player.pos.y > 0.15 ? 1.85 : 1.35) * this.reboundReachFactor(player);
            if (dist <= reach && this.ball.pos.y <= maxReboundHeight) {
                const isDefRebound = this.matchRules.possessionTeam !== player.team;
                this.giveBallTo(player.id, isDefRebound);
                this.showRuleAlert(`🏀 REBOND AÉRIEN DE ${player.profile.playerName} !`);
                return true;
            }
        }

        return false;
    },

    /**
     * Exécute physiquement le Contre (Block) : dévie violemment le ballon et affiche la bannière
     */
    executeShotBlock(blocker, shooter = null) {
        if (this.isAuthority) this.onBlock(blocker.id, shooter?.id || this.ball.pendingShotOutcome?.shooterId);
        const fouledShot = this.ball.pendingShotOutcome;
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
        this.foulOnBlockedShot(fouledShot); // faute déjà sifflée sur ce tir (Fouls.js)
    },

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
                // Défenseur pris dans un écran : il arrive en retard sur le tir
                if (ent.screenedTimer > 0) contest *= 0.4;
                if (contest > maxContest) maxContest = contest;
            }
        }
        return Math.min(1.0, maxContest);
    }
};
