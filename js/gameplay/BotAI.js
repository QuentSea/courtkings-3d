/**
 * BotAI.js — Intelligence des bots : attaque (appels, coupes, spacing), défense individuelle, déplacements.
 * Méthodes ajoutées au prototype de GameEngine (voir la fin de GameEngine.js) : `this` est le moteur.
 */

import * as THREE from 'three';
import { POSITIONS } from '../config/constants.js';
import { SCREENED_SPEED } from './Screens.js';

export const BotAIMethods = {
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
            if (bot.pnr) bot.pnr = null; // le bot qui roulait a reçu la balle
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

            // Fin du chrono de tir : tirer tout de suite, d'où qu'il soit (Clock.js)
            const hurry = this.isShotClockHurry();

            // Pick and roll en cours : attendre l'écran, le frôler, servir celui qui roule (Screens.js)
            if (!hurry && this.pickAndRollHandlerMove(bot, dt, botSpeed, hoop)) return;

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
            if (humanTeammate && !hurry && bot.aiThinkTimer <= 0 && Math.random() < 0.72) {
                this.launchPass(bot, humanTeammate);
                bot.aiThinkTimer = 1.2;
                return;
            }

            // Circulation de balle des Bots adverses
            if (!isTeammateOfHuman && !hurry && bot.aiThinkTimer <= 0 && Math.random() < 0.35) {
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
            if (distToHoop > idealRange && !hurry) {
                this.moveEntityTowards(bot, hoop.rimPos, botSpeed, dt);
                bot.state = 'DRIBBLE';
            } else if (bot.aiThinkTimer <= 0 || hurry) {
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
            // Écran pour le porteur, puis roll / pop (Screens.js)
            if (this.updatePickAndRollScreener(bot, dt, botSpeed)) return;

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
            if (bot.pnr) bot.pnr = null;
            if (bot.screenTimer > 0) this.endScreen(bot);
            // Même numéro de place, sauf changement de joueur après un écran (switch)
            const assignedMan = this.getAssignedMan(bot);

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
    },

    moveEntityTowards(ent, targetVec, speed, dt) {
        const dx = targetVec.x - ent.pos.x;
        const dz = targetVec.z - ent.pos.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (ent.screenedTimer > 0) speed *= SCREENED_SPEED; // bloqué par un écran
        if (dist > 0.25) {
            ent.pos.x += (dx / dist) * speed * dt;
            ent.pos.z += (dz / dist) * speed * dt;
            this.clampToCourtBounds(ent.pos);
            ent.rotY = Math.atan2(dx, dz);
        }
        return dist;
    }
};
