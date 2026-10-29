/**
 * Moves.js — Gestes d'attaque et jeu au rebond :
 * - Finitions près du cercle : dunk (en sprintant), lay-up (sans sprint), euro step (crossover près du cercle :
 *   un pas de côté puis de l'autre, le défenseur conteste deux fois moins).
 * - Alley-oop : passe lobée vers un coéquipier qui coupe au panier ; il la reprend en l'air et la smashe.
 * - Step-back (reculer en tirant, loin du panier : un pas en arrière avant le tir) et fadeaway (reculer en tirant
 *   près du panier : le tireur part en arrière pendant le saut, le défenseur conteste moins, tir plus dur).
 * - Box-out : au moment du tir, les défenseurs se placent entre leur joueur et le cercle et le repoussent
 *   (un joueur « enfermé » prend moins bien les rebonds) ; les grands de l'attaque vont au rebond offensif.
 * Méthodes ajoutées au prototype de GameEngine (voir la fin de GameEngine.js) : `this` est le moteur.
 */

import * as THREE from 'three';
import { POSITIONS } from '../config/constants.js';

const ALLEY_OOP_RANGE = 7;    // le receveur doit être à moins de 7 m du cercle
const BOX_OUT_TIME = 0.35;    // le box-out tient tant qu'on le renouvelle (s)
const BOXED_REACH = 0.55;     // portée au rebond d'un joueur enfermé (part de la normale)
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export const MoveMethods = {
    /** Distance au cercle sous laquelle on finit en dunk ou lay-up (3,55 à 4,25 m selon la finition) */
    finishRange(player) {
        const finishStat = player.profile.attributes?.finishing || 80;
        return 3.55 + ((finishStat - 60) / 39) * 0.70;
    },

    /** Départ d'une finition (dunk, lay-up, euro step, alley-oop) : commun au local, aux bots et au réseau */
    beginFinish(player, hoop, start, target, mid, kind, duration) {
        player.isDunking = true;
        player.dunkStartPos = start;
        player.dunkTargetPos = target;
        player.dunkMid = mid;          // euro step : point de passage sur le côté (courbe)
        player.finishType = kind;      // 'DUNK' ou 'LAYUP'
        player.layupReleased = false;
        player.dunkHoop = hoop;
        player.dunkTimer = 0;
        player.dunkDuration = duration;
        player.state = kind === 'LAYUP' ? 'SHOOT' : 'DUNK';
        player.rotY = Math.atan2(hoop.rimPos.x - player.pos.x, hoop.rimPos.z - player.pos.z);
    },

    /** Position pendant la finition (appelé à chaque image par GameEngine.update) */
    stepFinish(ent, t) {
        const a = ent.dunkStartPos;
        const b = ent.dunkTargetPos;
        const m = ent.dunkMid;
        if (m) {
            const u = 1 - t;
            ent.pos.x = u * u * a.x + 2 * u * t * m.x + t * t * b.x;
            ent.pos.z = u * u * a.z + 2 * u * t * m.z + t * t * b.z;
        } else {
            ent.pos.x = THREE.MathUtils.lerp(a.x, b.x, t);
            ent.pos.z = THREE.MathUtils.lerp(a.z, b.z, t);
        }
        const layup = ent.finishType === 'LAYUP';
        ent.pos.y = Math.sin(t * Math.PI) * (layup ? 0.85 : 1.38);
        ent.state = layup ? 'SHOOT' : 'DUNK';
    },

    /** Réussite d'un lay-up selon la finition et la contestation (sert aussi aux bots pour décider) */
    finishChance(player, contest) {
        const finishStat = player.profile.attributes?.finishing || 78;
        return clamp(0.62 + ((finishStat - 60) / 39) * 0.26 - contest * 0.35, 0.3, 0.92);
    },

    /** Lay-up lâché en haut du saut (hôte) : finition contre contestation, l'euro step divise la contestation par 2 */
    finishLayup(player) {
        const hoop = player.dunkHoop || this.getAttackingHoopForTeam(player.team);
        const contest = this.calculateContestFactor(player) * (player.dunkMid ? 0.5 : 1);
        const isMake = Math.random() < this.finishChance(player, contest);
        this.launchShotBall(player, hoop, { isMake, isGreen: false, isThreePointer: false, kind: 'layup' }, false);
        if (player.isLocal) {
            this.shotMeter.showFeedback(player.dunkMid ? 'EURO STEP' : 'LAY-UP', Math.round(contest * 100),
                isMake ? 'feedback-green' : 'feedback-red', isMake);
        }
    },

    /**
     * Défenseur sur la route du cercle : devant le porteur, à moins de 0,95 m de la ligne porteur–cercle (le plus
     * proche). ahead : distance devant lui ; lat : décalage, positif à sa droite quand il fait face au cercle
     */
    laneBlocker(player, rim) {
        const dx = rim.x - player.pos.x;
        const dz = rim.z - player.pos.z;
        const len = Math.hypot(dx, dz) || 1;
        let best = null;
        for (const o of this.entities.values()) {
            if (o.team === player.team) continue;
            const ox = o.pos.x - player.pos.x;
            const oz = o.pos.z - player.pos.z;
            const ahead = (ox * dx + oz * dz) / len;
            const lat = (ox * dz - oz * dx) / len;
            if (ahead > 0.2 && ahead < len + 0.3 && Math.abs(lat) < 0.95 && (!best || ahead < best.ahead)) {
                best = { ent: o, ahead, lat };
            }
        }
        return best;
    },

    /** Distance au cercle où un bot qui attaque décolle (2,4 à 3,2 m selon la finition) */
    botFinishStart(bot) {
        return 2.4 + clamp(((bot.profile.attributes?.finishing || 75) - 60) / 39, 0, 1) * 0.8;
    },

    /**
     * Bot porteur près du cercle (hôte) : route libre, il finit (dunk s'il en est capable). Un défenseur entre lui
     * et le cercle : il compare (points attendus) ressortir le ballon vers un coéquipier, un petit tir flottant
     * et un euro step qui contourne le défenseur
     */
    botFinish(bot, hoop, dist, isTeammateOfHuman = false) {
        const blocker = this.laneBlocker(bot, hoop.rimPos);
        const contest = this.calculateContestFactor(bot);
        if (!blocker || blocker.ahead > dist) {
            // Personne devant : un défenseur à côté ou derrière n'empêche pas de dunker
            this.startBotFinish(bot, hoop, dist, { open: contest < 0.5 });
            return;
        }
        const pass = this.bestPassTarget(bot, hoop, isTeammateOfHuman);
        const noise = () => 0.85 + Math.random() * 0.3;
        const euro = 2 * this.finishChance(bot, contest * 0.5) * noise();
        const floater = dist > 2.3 ? 2 * this.floaterChance(bot, contest) * noise() : 0;
        const kick = pass ? pass.value * 0.9 * noise() : 0;
        if (kick > euro && kick > floater) this.botPass(bot, pass.ent);
        else if (floater > euro) this.botFloater(bot, hoop);
        // Euro step du côté où le défenseur n'est pas (euro = 1 : pas vers sa gauche)
        else this.startBotFinish(bot, hoop, dist, { open: false, euro: blocker.lat >= 0 ? 1 : -1 });
    },

    /** Dunk seulement route libre et pour un bon finisseur (plus facile pour un grand) ; sinon lay-up */
    startBotFinish(bot, hoop, dist, { open = true, euro = 0 } = {}) {
        const finishStat = bot.profile.attributes?.finishing || 75;
        const big = (POSITIONS[bot.profile.position]?.scaleY || 1) >= 1.05;
        const dunk = open && finishStat >= (big ? 76 : 82) && Math.random() < 0.7;
        this.startDunkDrive(bot, hoop, dist, { kind: dunk ? 'DUNK' : 'LAYUP', euro: dunk ? 0 : euro });
    },

    floaterChance(bot, contest) {
        const finishStat = bot.profile.attributes?.finishing || 75;
        return clamp(0.36 + ((finishStat - 60) / 39) * 0.2 - contest * 0.25, 0.22, 0.58);
    },

    /** Petit tir flottant par-dessus le défenseur, au-dessus de la raquette (hôte) */
    botFloater(bot, hoop) {
        const prob = this.floaterChance(bot, this.calculateContestFactor(bot));
        this.launchShotBall(bot, hoop, { isMake: Math.random() < prob, isGreen: false, isThreePointer: false });
        bot.state = 'SHOOT';
        bot.vel.y = 3.2;
        bot.aiThinkTimer = 1.6;
        bot.plan = null;
    },

    // ---------------------------------------------------------------- Alley-oop

    /** Le coéquipier peut-il recevoir un alley-oop ? (au sol, assez près du cercle) */
    canAlleyOop(receiver) {
        if (!receiver || receiver.isDunking || receiver.pos.y > 0.05) return false;
        const hoop = this.getAttackingHoopForTeam(receiver.team);
        return this.getHorizontalDist(receiver.pos, hoop.rimPos) <= ALLEY_OOP_RANGE;
    },

    /**
     * Passe lobée + envol du receveur vers le cercle. Le ballon arrive juste avant la fin de l'envol,
     * le receveur le smashe (finishDunkSlam, chez l'hôte).
     * broadcast : passeur local ; l'hôte relaie aussi quand le receveur est un invité (il doit sauter chez lui)
     */
    launchAlleyOop(passer, receiver, broadcast = passer.isLocal) {
        const hoop = this.getAttackingHoopForTeam(receiver.team);
        const dist = this.getHorizontalDist(receiver.pos, hoop.rimPos);
        const duration = clamp(0.62 + dist * 0.06, 0.7, 1.05);
        // Chez un invité, on ne fait voler que son propre joueur (les autres viennent de l'hôte)
        if (this.isAuthority || receiver.isLocal) {
            this.startDunkDrive(receiver, hoop, dist, { kind: 'DUNK', duration, silent: true });
            receiver.alleyOopFrom = passer.id;
        }
        this.launchPass(passer, receiver, false);
        this.ball.alleyOop = true;
        this.ball.flightDuration = duration * 0.85;
        this.ball.flightArcHeight = 1.6;
        this.showRuleAlert(`🚀 ALLEY-OOP ${passer.profile.playerName} → ${receiver.profile.playerName} !`);

        const relay = this.isAuthority && !receiver.isBot && !receiver.isLocal;
        if (broadcast || relay) this.network.sendGameEvent('ALLEY_OOP', { fromId: passer.id, toId: receiver.id });
    },

    /** Touche T avec le ballon : alley-oop vers le coéquipier visé (passe normale s'il est trop loin) */
    tryAlleyOop(me) {
        const target = this.findAimedTeammate(me);
        if (!target) return;
        if (this.canAlleyOop(target)) {
            this.launchAlleyOop(me, target);
        } else {
            this.showRuleAlert('TROP LOIN DU CERCLE POUR UN ALLEY-OOP : PASSE NORMALE', false);
            this.launchPass(me, target);
        }
    },

    /** Touche T sans ballon : demander un alley-oop au bot porteur de son équipe */
    requestAlleyOop(me) {
        const holder = this.entities.get(this.ball.holderId);
        if (!holder || !holder.isBot || holder.team !== me.team || this.ball.state !== 'HELD') return;
        if (!this.canAlleyOop(me)) {
            this.showRuleAlert('RAPPROCHE-TOI DU CERCLE POUR L\'ALLEY-OOP', false);
            return;
        }
        this.launchAlleyOop(holder, me, true);
    },

    /** Bot porteur : lob pour un coéquipier bot qui coupe ou roule vers le cercle, s'il est libre (hôte) */
    tryBotAlleyOop(bot, hoop) {
        if (bot.aiThinkTimer > 0 || Math.random() > 0.35) return false;
        for (const mate of this.entities.values()) {
            if (mate.team !== bot.team || mate.id === bot.id || !mate.isBot) continue;
            const cutting = mate.offBallPhase === 'CUT_BASKET' || mate.pnr?.phase === 'ROLL';
            const finishStat = mate.profile.attributes?.finishing || 70;
            if (!cutting || finishStat < 72 || !this.canAlleyOop(mate)) continue;
            if (this.getHorizontalDist(mate.pos, hoop.rimPos) > 5.5) continue;
            if (this.calculateContestFactor(mate) > 0.25) continue;
            this.launchAlleyOop(bot, mate);
            bot.aiThinkTimer = 1.2;
            return true;
        }
        return false;
    },

    // ---------------------------------------------------------------- Step-back et fadeaway

    /**
     * Joueur local qui tire en reculant (direction opposée au panier) : step-back loin du panier,
     * fadeaway près. Renvoie { contestMul, penalty } pour la jauge, ou null pour un tir normal
     */
    applyShotMove(me, hoop, dist) {
        const move = this.lastMoveDir;
        if (!move) return null;
        const toHoop = new THREE.Vector3(hoop.rimPos.x - me.pos.x, 0, hoop.rimPos.z - me.pos.z).normalize();
        if (move.x * toHoop.x + move.y * toHoop.z > -0.5) return null;
        if (dist < 5.2) {
            me.shotMove = 'FADE';
            me.fadeDir = toHoop.negate();
            this.showRuleAlert('↩️ FADEAWAY !', false);
            return { contestMul: 0.55, penalty: 0.012 };
        }
        me.pos.addScaledVector(toHoop, -0.95);
        this.clampToCourtBounds(me.pos);
        me.shotMove = 'STEPBACK';
        this.showRuleAlert('↩️ STEP-BACK !', false);
        return { contestMul: 1, penalty: 0.008 };
    },

    /** Bot tireur collé par un défenseur : step-back ou fadeaway (hôte). Renvoie la contestation après le geste */
    botShotMove(bot, hoop, dist, contest) {
        if (contest < 0.35 || Math.random() > 0.35) return contest;
        const away = new THREE.Vector3(bot.pos.x - hoop.rimPos.x, 0, bot.pos.z - hoop.rimPos.z).normalize();
        if (dist < 5.2) {
            bot.pos.addScaledVector(away, 0.5);
            this.clampToCourtBounds(bot.pos);
            return contest * 0.55;
        }
        if ((bot.profile.attributes?.shooting || 70) < 80) return contest;
        bot.pos.addScaledVector(away, 0.95);
        this.clampToCourtBounds(bot.pos);
        return this.calculateContestFactor(bot);
    },

    // ---------------------------------------------------------------- Box-out et rebond offensif

    updateMoveTimers(dt) {
        for (const ent of this.entities.values()) {
            if (ent.boxOutTimer > 0) ent.boxOutTimer -= dt;
            if (ent.boxedTimer > 0) ent.boxedTimer -= dt;
            if (ent.stealCd > 0) ent.stealCd -= dt;
            if (ent.reactTimer > 0) ent.reactTimer -= dt; // réaction animée (faute subie, célébration)
        }
    },

    /** Portée au rebond réduite pour un joueur enfermé par un box-out */
    reboundReachFactor(ent) {
        return ent.boxedTimer > 0 ? BOXED_REACH : 1;
    },

    /**
     * Collision avec un joueur qui fait box-out : il garde sa place, l'adversaire derrière lui est repoussé et
     * « enfermé ». Renvoie vrai si la paire a été traitée ici
     */
    resolveBoxOutCollision(a, b, minSeparation) {
        if (a.team === b.team) return false;
        const aBox = a.boxOutTimer > 0;
        const bBox = b.boxOutTimer > 0;
        if (aBox === bBox) return false;
        const boxer = aBox ? a : b;
        const other = aBox ? b : a;
        const rim = this.getAttackingHoopForTeam(other.team).rimPos;
        // Seulement si l'adversaire est derrière (plus loin du cercle que le joueur qui fait box-out)
        if (this.getHorizontalDist(other.pos, rim) < this.getHorizontalDist(boxer.pos, rim) - 0.2) return false;
        const dx = other.pos.x - boxer.pos.x;
        const dz = other.pos.z - boxer.pos.z;
        const dist = Math.sqrt(dx * dx + dz * dz) || 0.01;
        if (dist >= minSeparation) return true;
        const overlap = minSeparation - dist;
        other.pos.x += (dx / dist) * overlap * 0.85;
        other.pos.z += (dz / dist) * overlap * 0.85;
        boxer.pos.x -= (dx / dist) * overlap * 0.15;
        boxer.pos.z -= (dz / dist) * overlap * 0.15;
        this.clampToCourtBounds(other.pos);
        this.clampToCourtBounds(boxer.pos);
        other.boxedTimer = 0.45;
        return true;
    },

    /**
     * Bot sans ballon pendant un tir : box-out en défense, rebond offensif (grands) ou repli en attaque (hôte).
     * Renvoie vrai si le mouvement du bot est décidé ici
     */
    botReboundMove(bot, dt, speed) {
        const b = this.ball;
        if (b.state !== 'SHOT' || !b.pendingShotOutcome) return false;
        const shooterTeam = b.pendingShotOutcome.shooterTeam;
        const ft = b.pendingShotOutcome.freeThrow;
        if (ft && !ft.last) return false;
        const rim = this.getAttackingHoopForTeam(shooterTeam).rimPos;

        if (bot.team !== shooterTeam) {
            // Box-out : entre son joueur et le cercle, dos à lui
            const man = this.getAssignedMan(bot);
            if (!man) return false;
            const toRim = new THREE.Vector3(rim.x - man.pos.x, 0, rim.z - man.pos.z);
            const len = toRim.length() || 1;
            const spot = man.pos.clone().addScaledVector(toRim, Math.min(0.9, len * 0.5) / len).setY(0);
            this.moveEntityTowards(bot, spot, speed, dt);
            bot.rotY = Math.atan2(rim.x - bot.pos.x, rim.z - bot.pos.z);
            bot.boxOutTimer = BOX_OUT_TIME;
            if (bot.pos.y <= 0.05) bot.state = 'DEFENSE';
            return true;
        }
        // Attaque : les grands (pivot, ailier fort) et le plus proche du cercle vont au rebond
        const crasher = bot.profile.position === 'C' || bot.profile.position === 'PF' ||
            this.getHorizontalDist(bot.pos, rim) < 3.5;
        if (!crasher) return false;
        const side = bot.slotIndex % 2 === 0 ? -1 : 1;
        const out = rim.z > 0 ? -1 : 1;
        const spot = new THREE.Vector3(rim.x + side * 1.3, 0, rim.z + out * 1.4);
        const d = this.moveEntityTowards(bot, spot, speed * 1.1, dt);
        bot.state = d > 0.45 ? 'RUN' : 'IDLE';
        return true;
    },

    /** Le joueur local tient la touche de défense pendant un tir adverse : box-out */
    updateLocalBoxOut(me, isDefending) {
        const outcome = this.ball.pendingShotOutcome;
        const shotByOther = this.ball.state === 'SHOT' && outcome && outcome.shooterTeam !== me.team;
        const loose = this.ball.state === 'LOOSE' && this.matchRules.shotClockStopped && !this.matchRules.deadBall;
        if (isDefending && this.ball.holderId !== me.id && (shotByOther || loose)) me.boxOutTimer = BOX_OUT_TIME;
    }
};
