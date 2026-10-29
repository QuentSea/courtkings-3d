/**
 * BotAI.js — Intelligence des bots : attaque (appels, coupes, spacing, systèmes), défense (individuelle, zone,
 * pressing), rebonds, déplacements.
 * Méthodes ajoutées au prototype de GameEngine (voir la fin de GameEngine.js) : `this` est le moteur.
 */

import * as THREE from 'three';
import { POSITIONS, DIFFICULTY } from '../config/constants.js';
import { SCREENED_SPEED } from './Screens.js';

export const BotAIMethods = {
    /**
     * IA des Bots revue pour le plaisir de jeu :
     * 1. COÉQUIPIERS OFFENSIFS ACTIFS :
     *    - Enchaînent appels de balle au panier ("Basket Cuts"), sorties à 3 points ("Pop Out")
     *      et démarquages latéraux en permanence pour offrir des solutions de passe claires.
     *    - Quand un Bot allié reçoit la balle près du cercle suite à votre passe, il finit vite ("Catch & Finish").
     *    - Suivent le système d'attaque de la possession (Tactics.js).
     * 2. BOTS ADVERSES ÉQUILIBRÉS :
     *    - Défense individuelle (1v1) moins étouffante (plus de distance et léger temps de réaction)
     *      pour laisser vos coéquipiers prendre de l'avance lors de leurs coupes vers le panier.
     *    - Zone ou pressing selon la tactique de l'équipe (Tactics.js), box-out au moment des tirs (Moves.js).
     * 3. PORTEUR DU BALLON : il lit la défense avant d'agir (botHandlerPlan) : tir, passe au mieux placé,
     *    attaque du cercle si la route est libre, débordement de son défenseur, ou attente d'une solution.
     */
    updateBotAI(bot, dt) {
        if (bot.isDunking) return; // en l'air vers le cercle (dunk, lay-up, alley-oop)
        const hasBall = this.ball.holderId === bot.id;
        const hoop = this.getAttackingHoopForTeam(bot.team);
        const posData = POSITIONS[bot.profile.position] || POSITIONS.SF;
        const isTeammateOfHuman = Array.from(this.entities.values()).some(
            e => !e.isBot && e.team === bot.team
        );
        const skill = this.botSkill(bot);
        // Niveau des Bots relevé : vitesse compétitive aussi bien pour vos alliés (4.75) que pour l'équipe adverse (4.35)
        const botSpeed = (isTeammateOfHuman ? 4.75 : 4.35) * posData.baseSpeed * skill.speed;

        // Lancers francs : tout le monde reste à sa place (le tireur bot lance tout seul, Fouls.js)
        if (this.matchRules.freeThrow) {
            bot.state = hasBall ? 'DRIBBLE' : 'IDLE';
            return;
        }

        if (!hasBall) bot.hadBall = false;
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
            const play = this.matchRules.plays?.[bot.team] || 'MOTION';
            if (!bot.hadBall) {
                // Réception : il lit la défense un instant avant d'agir (presque pas s'il est seul)
                bot.hadBall = true;
                bot.plan = { kind: 'HOLD', timer: contest < 0.2 ? 0.15 : 0.35 + Math.random() * 0.5 };
            }

            // Près du cercle (pénétration, rebond offensif) : il finit selon la défense (Moves.js), sauf s'il a
            // choisi de ressortir le ballon
            if (distToHoop < 2.5 && !bot.plan?.backOut) {
                this.botFinish(bot, hoop, distToHoop, isTeammateOfHuman);
                bot.aiThinkTimer = 1.6;
                return;
            }
            // Fin du chrono de tir : tirer tout de suite, d'où qu'il soit (Clock.js)
            if (this.isShotClockHurry()) {
                this.botJumpShot(bot, hoop, isTeammateOfHuman);
                return;
            }

            // Pick and roll en cours : attendre l'écran, le frôler, servir celui qui roule (Screens.js)
            if (this.pickAndRollHandlerMove(bot, dt, botSpeed, hoop)) return;
            // Alley-oop pour un coéquipier qui coupe, au moment où il décide (Moves.js), jeu au poste (Tactics.js)
            if (!(bot.plan?.timer > 0) && this.tryBotAlleyOop(bot, hoop)) return;
            if (this.postPlayMove(bot, dt, botSpeed, hoop, distToHoop)) return;

            // Un Bot allié totalement ouvert derrière l'arc tire tout de suite
            if (isTeammateOfHuman && distToHoop >= 5.55 && contest < 0.22) {
                const makeProb = Math.max(0.55, Math.min(0.88, (bot.profile.attributes.shooting / 99) * 0.85 - contest * 0.25));
                const isMake = Math.random() < makeProb;
                this.launchShotBall(bot, hoop, { isGreen: isMake && Math.random() < 0.50, isMake, isThreePointer: true });
                bot.state = 'SHOOT';
                bot.vel.y = 3.8;
                bot.aiThinkTimer = 1.8;
                return;
            }

            // Si le joueur humain est dans son équipe et n'est pas en train de lui laisser finir une coupe, le Bot lui repasse très vite
            const humanTeammate = Array.from(this.entities.values()).find(
                e => !e.isBot && e.team === bot.team
            );
            if (humanTeammate && bot.aiThinkTimer <= 0 && Math.random() < (play === 'ISO' ? 0.3 : 0.72)) {
                this.launchPass(bot, humanTeammate);
                bot.aiThinkTimer = 1.2;
                return;
            }

            // Sinon il réfléchit : tir, passe, attaque du cercle, débordement ou attente (plus bas)
            this.botHandlerPlan(bot, dt, hoop, distToHoop, botSpeed, isTeammateOfHuman);
        } else if (this.ball.state === 'LOOSE') {
            bot.postTimer = null;
            this.moveEntityTowards(bot, this.ball.pos, botSpeed * 0.96, dt);
            bot.state = 'RUN';
            this.tryBlockOrRebound(bot);
        } else if (this.matchRules.possessionTeam === bot.team) {
            bot.postTimer = null;
            // Tir en l'air : les grands vont au rebond offensif (Moves.js)
            if (this.botReboundMove(bot, dt, botSpeed)) return;
            // Écran pour le porteur, puis roll / pop (Screens.js)
            if (this.updatePickAndRollScreener(bot, dt, botSpeed)) return;
            // Isolation et jeu au poste : places fixes (Tactics.js)
            if (this.offBallPlayMove(bot, dt, botSpeed, hoop)) return;

            // COUPES : chacun tient sa place écartée autour de l'arc, un seul coupeur à la fois vers le cercle
            // (places et coupeur choisis pour toute l'équipe : Tactics.js, updateMotion)
            const m = this.motion;
            const cutting = m?.cutterId === bot.id;
            let target = m?.spots.get(bot.id);
            if (cutting) {
                const side = Math.sign(bot.pos.x - hoop.rimPos.x) || 1;
                const out = hoop.side === 'NORTH' ? 1 : -1;
                target = _target.set(hoop.rimPos.x + side * 1.1, 0, hoop.rimPos.z + out * 1.0);
            }
            bot.offBallPhase = cutting ? 'CUT_BASKET' : 'PERIMETER';
            const d = target ? this.moveEntityTowards(bot, target, botSpeed * (cutting ? 1.18 : 0.95), dt) : 0;
            if (cutting && d < 0.5) m.cutLeft = Math.min(m.cutLeft, 0.5); // sous le cercle : il ressort bientôt

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
            // DÉFENSE : box-out pendant les tirs, puis zone, pressing ou individuelle (Tactics.js)
            if (bot.pnr) bot.pnr = null;
            if (bot.screenTimer > 0) this.endScreen(bot);
            if (this.botReboundMove(bot, dt, botSpeed)) return;
            const scheme = this.matchRules.defenseNow?.[bot.team] || 'MAN';
            if (scheme === 'ZONE' && this.zoneDefenseMove(bot, dt, botSpeed * 0.9)) return;
            if (scheme === 'PRESS' && this.pressDefenseMove(bot, dt, botSpeed)) return;

            // Même numéro de place, sauf changement de joueur après un écran (switch)
            const assignedMan = this.getAssignedMan(bot);

            if (assignedMan) {
                const defHoop = this.getAttackingHoopForTeam(assignedMan.team);
                const isGuardingBall = this.ball.holderId === assignedMan.id;

                const toHoopVec = new THREE.Vector3().subVectors(defHoop.rimPos, assignedMan.pos);
                toHoopVec.y = 0;
                const distManToHoop = toHoopVec.length() || 1;
                toHoopVec.normalize();

                // Marquage 1v1 réactif (1.50m sur le porteur, 2.05m hors ballon) ; pressing : marquage serré
                const tight = scheme === 'PRESS' ? 0.6 : 1;
                const cushion = tight * (isGuardingBall
                    ? Math.min(1.50, distManToHoop * 0.38)
                    : Math.min(2.05, distManToHoop * 0.44));

                const guardPos = new THREE.Vector3(
                    assignedMan.pos.x + toHoopVec.x * cushion,
                    0,
                    assignedMan.pos.z + toHoopVec.z * cushion
                );

                const defReactionSpeed = isTeammateOfHuman ? botSpeed * 0.92 : botSpeed * 0.86 * skill.react;
                const d = this.moveEntityTowards(bot, guardPos, defReactionSpeed, dt);
                bot.rotY = Math.atan2(assignedMan.pos.x - bot.pos.x, assignedMan.pos.z - bot.pos.z);
                this.botContest(bot, assignedMan, d);
            }
        }
    },

    /**
     * Niveau d'un bot (constants.js, DIFFICULTY) : celui choisi dans le salon pour les bots qui jouent contre au
     * moins un humain, « Normal » pour les autres (coéquipiers d'un humain, matchs entre bots)
     */
    botSkill(ent) {
        if (!ent?.isBot) return DIFFICULTY.NORMAL;
        let humanFoe = false;
        for (const e of this.entities.values()) {
            if (e.team === ent.team && !e.isBot) return DIFFICULTY.NORMAL;
            if (e.team !== ent.team && !e.isBot) humanFoe = true;
        }
        return humanFoe ? this.difficulty : DIFFICULTY.NORMAL;
    },

    /** Bot défenseur face à un attaquant : il saute pour contester s'il tire juste devant lui, sinon posture */
    botContest(bot, man, distToSpot) {
        const distToMan = this.getHorizontalDist(bot.pos, man.pos);
        const defStat = bot.profile.attributes?.defense || 75;
        if (
            (man.state === 'SHOOT' || man.state === 'DUNK') &&
            distToMan < 1.55 &&
            Math.random() < (0.025 + (defStat / 99) * 0.035) * this.botSkill(bot).react
        ) {
            this.triggerJumpBlock(bot);
        } else if (bot.pos.y <= 0.05) {
            bot.state = distToSpot > 0.45 ? 'RUN' : 'DEFENSE';
        }
    },

    // ---------------------------------------------------------------- Porteur du ballon

    /**
     * Porteur bot : il lit la défense avant d'agir au lieu de foncer tout droit au cercle. Après chaque décision
     * (decideHandler, toutes les 0,4 à 0,9 s) il suit son plan : attaquer le cercle si la route est libre,
     * déborder son défenseur (crossover puis accélération du côté libre) ou garder le ballon face au panier.
     */
    botHandlerPlan(bot, dt, hoop, dist, speed, isTeammateOfHuman) {
        const rim = hoop.rimPos;
        if (bot.plan) {
            bot.plan.timer -= dt;
            bot.plan.age = (bot.plan.age || 0) + dt;
        }

        // Contre-attaque : au plus un défenseur replié entre lui et le panier, il fonce (et finit s'il arrive seul)
        if (dist > 8.5 && bot.plan?.kind !== 'DRIVE') {
            let back = 0;
            for (const o of this.entities.values()) {
                if (o.team !== bot.team && this.getHorizontalDist(o.pos, rim) < dist - 1) back++;
            }
            if (back <= 1) bot.plan = { kind: 'DRIVE', timer: 4 };
        }
        // Remontée du ballon (tout-terrain) : il avance vers le panier adverse ; pris à deux, il cherche une passe
        if (dist > 8.5 && bot.plan?.kind !== 'DRIVE') {
            if (!(bot.plan?.timer > 0)) {
                bot.plan = { kind: 'HOLD', timer: 0.5 };
                const mate = this.calculateContestFactor(bot) > 0.5 ? this.bestPassTarget(bot, hoop, isTeammateOfHuman) : null;
                if (mate) return this.botPass(bot, mate.ent);
            }
            this.moveEntityTowards(bot, rim, speed * 0.85, dt);
            bot.state = 'DRIBBLE';
            return;
        }

        if (!(bot.plan?.timer > 0)) {
            bot.plan = this.decideHandler(bot, hoop, dist, isTeammateOfHuman);
            if (!bot.plan) return; // le tir ou la passe est parti
        }
        const plan = bot.plan;
        const toRim = _toRim.set(rim.x - bot.pos.x, 0, rim.z - bot.pos.z).normalize();

        if (plan.kind === 'GAP' || plan.kind === 'DRIVE') {
            const blocker = this.laneBlocker(bot, rim);
            if (plan.kind === 'GAP' && !blocker) plan.kind = 'DRIVE'; // défenseur passé : la route est libre
            if (plan.kind === 'GAP' && plan.age > 0.3 && this.calculateContestFactor(bot) < 0.25) {
                bot.plan = null; // il s'est fait de l'espace : il relit (tir après le crossover, passe...)
                return;
            }
            if (plan.kind === 'GAP') {
                // Débordement : crossover vers le côté libre, accélération, puis le long du défenseur vers le cercle
                const right = _right.set(toRim.z, 0, -toRim.x);
                _target.copy(blocker.ent.pos).addScaledVector(right, plan.side * 1.5).addScaledVector(toRim, 1.0).setY(0);
                this.moveEntityTowards(bot, _target, speed * (plan.age < 0.35 ? 1.25 : 1), dt);
                bot.state = plan.age < 0.25 ? 'CROSSOVER' : 'DRIBBLE';
                return;
            }
            if (dist <= this.botFinishStart(bot)) {
                bot.plan = null;
                this.botFinish(bot, hoop, dist, isTeammateOfHuman);
                return;
            }
            // (un défenseur déjà à sa hauteur est battu : il continue)
            if (!blocker || blocker.ahead < 0.7 || blocker.ahead > 1.6) {
                this.moveEntityTowards(bot, rim, speed, dt);
                bot.state = 'DRIBBLE';
                return;
            }
            // Un défenseur s'interpose : il s'arrête et relit la défense au lieu de lui rentrer dedans
            bot.plan = { kind: 'HOLD', timer: 0.15 };
        }

        // Garder le ballon face au panier ; collé par son défenseur, il recule pour se donner de l'air ; sinon il
        // reste vivant : un petit dribble de côté, aller puis retour
        if (bot.plan?.backOut || (dist < 7.5 && this.calculateContestFactor(bot) > 0.6)) {
            this.moveEntityTowards(bot, _target.copy(bot.pos).addScaledVector(toRim, -1.5), speed * (bot.plan?.backOut ? 0.6 : 0.45), dt);
        } else if (bot.plan?.kind === 'HOLD') {
            const p = bot.plan;
            p.jab = p.jab || (Math.random() < 0.5 ? 1 : -1);
            const right = _right.set(toRim.z, 0, -toRim.x);
            this.moveEntityTowards(bot, _target.copy(bot.pos).addScaledVector(right, p.jab * (p.age > 0.35 ? -1 : 1)), 1.1, dt);
        }
        bot.rotY = Math.atan2(toRim.x, toRim.z);
        bot.state = 'DRIBBLE';
    },

    /**
     * Décision du porteur : chaque option vaut des points attendus (réussite × points), avec un peu de hasard
     * pour ne pas toujours faire pareil. Renvoie le plan à suivre, ou null si le tir ou la passe est parti
     */
    decideHandler(bot, hoop, dist, isTeammateOfHuman) {
        const contest = this.calculateContestFactor(bot);
        const blocker = this.laneBlocker(bot, hoop.rimPos);
        const clock = this.matchRules.shotClock ?? 24;
        // Aide défensive : chaque défenseur dans la raquette (à moins de 3 m du cercle) rend l'attaque moins sûre
        let help = 0;
        for (const o of this.entities.values()) {
            if (o.team !== bot.team && this.getHorizontalDist(o.pos, hoop.rimPos) < 3) help++;
        }
        const crowd = Math.max(0.55, 1 - help * 0.15);
        const options = [
            { kind: 'SHOOT', v: this.shotValue(bot, hoop, dist, contest, isTeammateOfHuman) },
            // Garder le ballon (attendre une coupe, un écran) : de moins en moins quand le chrono de tir baisse
            { kind: 'HOLD', v: 0.95 - Math.max(0, 12 - clock) * 0.07 },
            // Route libre : attaquer le cercle ; défenseur devant : le déborder (meilleur dribbleur, meilleure chance)
            blocker
                ? { kind: 'GAP', v: (1.0 + ((bot.profile.attributes?.dribble || 75) - 75) / 60) * crowd }
                : { kind: 'DRIVE', v: 1.9 * this.finishChance(bot, 0.1) * crowd }
        ];
        const pass = this.bestPassTarget(bot, hoop, isTeammateOfHuman);
        if (pass) options.push({ kind: 'PASS', v: pass.value * 0.9, ent: pass.ent });

        // Hasard dans le choix : plus petit pour un bot de haut niveau (meilleure option plus souvent)
        const spread = this.botSkill(bot).think;
        let best = null;
        for (const o of options) {
            o.score = o.v * (1 - spread / 2 + Math.random() * spread);
            if (!best || o.score > best.score) best = o;
        }
        if (best.kind === 'SHOOT') {
            this.botJumpShot(bot, hoop, isTeammateOfHuman);
            return null;
        }
        if (best.kind === 'PASS') {
            this.botPass(bot, best.ent);
            return null;
        }
        if (best.kind === 'DRIVE') return { kind: 'DRIVE', timer: 2.5 };
        if (best.kind === 'HOLD') return { kind: 'HOLD', timer: 0.4 + Math.random() * 0.5 };

        // Débordement du côté où le défenseur n'est pas (centré : côté de la main de dribble), jamais vers la touche
        let side = blocker.lat > 0.15 ? -1 : blocker.lat < -0.15 ? 1 : (bot.mesh.dribbleHand === 'RIGHT' ? 1 : -1);
        const rim = hoop.rimPos;
        const toRim = _toRim.set(rim.x - bot.pos.x, 0, rim.z - bot.pos.z).normalize();
        const test = _target.copy(blocker.ent.pos).addScaledVector(_right.set(toRim.z, 0, -toRim.x), side * 1.5);
        const inside = test.clone();
        this.clampToCourtBounds(inside);
        if (inside.distanceTo(test) > 0.3) side = -side;
        bot.mesh.dribbleHand = side > 0 ? 'RIGHT' : 'LEFT'; // crossover : le ballon change de main
        this.playSound('squeak', bot.pos);
        return { kind: 'GAP', side, timer: 1.0 };
    },

    /** Points attendus d'un tir de cet endroit ; hors de son registre (3 points d'un mauvais tireur), il vaut moins */
    shotValue(ent, hoop, dist, contest, isTeammateOfHuman) {
        const shooting = ent.profile.attributes?.shooting || 70;
        const three = dist >= 5.55;
        let range = 0.5; // sous 3 m, il vaut mieux finir au cercle
        if (three) range = shooting < 78 ? 0.45 : dist > 7.3 ? 0.6 : 1;
        else if (dist > 3) range = shooting < 68 ? 0.6 : 1;
        return this.shotMakeChance(ent, dist, contest, isTeammateOfHuman) * (three ? 3 : 2) * range;
    },

    /** Réussite d'un tir en suspension de bot (la même règle sert à décider et à tirer) */
    shotMakeChance(ent, dist, contest, isTeammateOfHuman) {
        const a = ent.profile.attributes || {};
        const three = dist >= 5.55;
        const stat = (three ? a.shooting : a.finishing) || 70;
        // À 3 points, 10 % de moins qu'à 2 points : à réussite égale, les bots ne tiraient plus que de loin
        const far = three ? 0.1 : 0;
        // Bots alliés : 48 à 82 % ; bots adverses calibrés à 52-64 % ouverts à 2 points (modulé par votre contestation),
        // plus ou moins selon le niveau choisi dans le salon
        const level = this.botSkill(ent).shot;
        return isTeammateOfHuman
            ? Math.max(0.48 - far, Math.min(0.82, (stat / 99) * 0.80 - far - contest * 0.30))
            : Math.max(0.28 - far / 2 + level, Math.min(0.65 + level, 0.52 + ((stat - 60) / 39) * 0.12 - far + level - contest * 0.25));
    },

    /** Tir en suspension d'un bot (step-back ou fadeaway s'il est collé, Moves.js) */
    botJumpShot(bot, hoop, isTeammateOfHuman) {
        const before = this.getHorizontalDist(bot.pos, hoop.rimPos);
        const contest = this.botShotMove(bot, hoop, before, this.calculateContestFactor(bot));
        const dist = this.getHorizontalDist(bot.pos, hoop.rimPos);
        const isMake = Math.random() < this.shotMakeChance(bot, dist, contest, isTeammateOfHuman);
        this.launchShotBall(bot, hoop, {
            isGreen: isMake && Math.random() < 0.35,
            isMake,
            isThreePointer: dist >= 5.55
        });
        bot.state = 'SHOOT';
        bot.vel.y = 3.5;
        bot.aiThinkTimer = 1.65;
        bot.plan = null;
    },

    /**
     * Coéquipier le mieux placé pour une passe (points attendus s'il tire ou finit en la recevant), en évitant
     * les passes qu'un défenseur peut couper et les allers-retours avec celui qui vient de passer
     */
    bestPassTarget(bot, hoop, isTeammateOfHuman) {
        let best = null;
        for (const mate of this.entities.values()) {
            if (mate.team !== bot.team || mate.id === bot.id || mate.isDunking || mate.pos.y > 0.05) continue;
            if (!this.passLaneOpen(bot, mate)) continue;
            const d = this.getHorizontalDist(mate.pos, hoop.rimPos);
            const c = this.calculateContestFactor(mate);
            let v = d < 2.8 ? 1.9 * this.finishChance(mate, c) : this.shotValue(mate, hoop, d, c, isTeammateOfHuman);
            if (d < 2.8 && this.laneBlocker(mate, hoop.rimPos)) v *= 0.6; // intérieur marqué devant lui
            if (mate.id === bot.lastPasserId) v *= 0.8;
            if (this.getHorizontalDist(bot.pos, mate.pos) > 9) v *= 0.85; // longue passe : plus risquée
            if (!best || v > best.value) best = { ent: mate, value: v };
        }
        return best;
    },

    /** Aucun défenseur à moins de 0,8 m de la trajectoire (son propre défenseur, collé au passeur, ne compte pas) */
    passLaneOpen(from, to) {
        const dx = to.pos.x - from.pos.x;
        const dz = to.pos.z - from.pos.z;
        const len = Math.hypot(dx, dz) || 1;
        for (const o of this.entities.values()) {
            if (o.team === from.team) continue;
            const ox = o.pos.x - from.pos.x;
            const oz = o.pos.z - from.pos.z;
            const along = (ox * dx + oz * dz) / len;
            if (along < 1.0 || along > len - 0.3) continue;
            if (Math.abs(ox * dz - oz * dx) / len < 0.8) return false;
        }
        return true;
    },

    botPass(bot, mate) {
        this.launchPass(bot, mate);
        mate.lastPasserId = bot.id;
        bot.aiThinkTimer = 1.2;
        bot.plan = null;
    },

    /**
     * Bot qui doit couvrir du terrain dos à sa course (défenseur face à son joueur pendant un repli, zone,
     * pressing) : au-delà de 3 m/s il se retourne et court, comme un vrai joueur. Il ne recule ou ne glisse
     * en pas chassés que sur de courtes distances ; sur le porteur, il tient la glissade jusqu'à 4,3 m/s
     */
    faceRunningDirection(bot, prevX, prevZ, dt) {
        if (dt <= 0 || bot.isDunking || bot.pos.y > 0.05) return;
        const vx = (bot.pos.x - prevX) / dt;
        const vz = (bot.pos.z - prevZ) / dt;
        if (Math.hypot(vx, vz) > 12) return; // crossover, step-back : petit saut de position, pas une course
        const k = Math.min(1, dt * 8);
        bot.runVX = (bot.runVX || 0) + (vx - (bot.runVX || 0)) * k;
        bot.runVZ = (bot.runVZ || 0) + (vz - (bot.runVZ || 0)) * k;
        const speed = Math.hypot(bot.runVX, bot.runVZ);
        const holder = this.entities.get(this.ball.holderId);
        const onBall = holder && holder.team !== bot.team && this.getHorizontalDist(holder.pos, bot.pos) < 2.5;
        const limit = onBall ? 4.3 : 3.0;
        bot.runTurned = speed > (bot.runTurned ? limit - 0.8 : limit);
        if (!bot.runTurned) return;
        const moveYaw = Math.atan2(bot.runVX, bot.runVZ);
        if (Math.abs(Math.atan2(Math.sin(moveYaw - bot.rotY), Math.cos(moveYaw - bot.rotY))) > 1.2) {
            bot.rotY = moveYaw;
            if (bot.state === 'DEFENSE') bot.state = 'RUN';
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

const _toRim = new THREE.Vector3();
const _right = new THREE.Vector3();
const _target = new THREE.Vector3();
