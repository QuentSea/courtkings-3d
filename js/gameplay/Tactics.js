/**
 * Tactics.js — Tactiques d'équipe des bots.
 * - Défense : individuelle (chacun son joueur), zone (chacun sa zone, le plus proche sort sur le porteur ;
 *   2-3 en 5v5) ou pressing (prise à deux du porteur dans son camp, ou loin du panier en demi-terrain,
 *   marquage serré et tentatives d'interception).
 * - Attaque (choisie à chaque possession) : coupes, pick and roll, isolation (les autres écartent le jeu),
 *   jeu au poste (le plus grand s'installe près du cercle, on lui donne, il joue dos au panier).
 * - « Auto » : l'IA choisit. En défense : pressing si elle est menée de 5 points, zone si l'adversaire a marqué
 *   ses 3 derniers paniers près du cercle, individuelle si ses 2 derniers étaient des tirs à 3 points.
 * Les joueurs humains choisissent pour leur équipe dans le HUD ; l'hôte décide et envoie tout dans WORLD_STATE.
 * Méthodes ajoutées au prototype de GameEngine (voir la fin de GameEngine.js) : `this` est le moteur.
 */

import * as THREE from 'three';
import { POSITIONS } from '../config/constants.js';

export const DEFENSES = { AUTO: 'Auto', MAN: 'Individuelle', ZONE: 'Zone', PRESS: 'Pressing' };
export const OFFENSES = { AUTO: 'Auto', MOTION: 'Coupes', PNR: 'Pick and roll', ISO: 'Isolation', POST: 'Jeu au poste' };
const PLAY_WEIGHTS = [['MOTION', 0.35], ['PNR', 0.35], ['ISO', 0.15], ['POST', 0.15]];

// Places de zone (x, distance au cercle vers le terrain) selon le nombre de défenseurs
const ZONES = {
    3: [[0, 4.3], [-1.9, 1.6], [1.9, 1.6]],
    4: [[-1.5, 4.6], [1.5, 4.6], [-2.0, 1.5], [2.0, 1.5]],
    5: [[-1.6, 5.0], [1.6, 5.0], [-3.1, 1.4], [0, 1.0], [3.1, 1.4]]
};
// Isolation et jeu au poste : les autres attaquants dans les coins et sur les ailes
const SPACING_SPOTS = [[-5.8, 1.8], [5.8, 1.8], [-4.6, 5.0], [4.6, 5.0]];
// Coupes et pick and roll : places écartées derrière l'arc (coins, ailes, haut) ; « dunker » = près du cercle au ras
// de la ligne de fond, pour un intérieur qui ne tire pas de loin
const MOTION_SPOTS = [[-5.9, 1.0], [5.9, 1.0], [-4.6, 4.4], [4.6, 4.4], [0, 6.4]];
const DUNKER_SPOT = [2.6, 0.7];

const otherTeam = (team) => (team === 'A' ? 'B' : 'A');

export const TacticMethods = {
    resetTactics() {
        const r = this.matchRules;
        r.defenseNow = { A: 'MAN', B: 'MAN' };
        r.plays = { A: 'MOTION', B: 'MOTION' };
        this.scoreMemory = { A: [], B: [] };
        this.lastTacticsText = null;
        this.motion = null;
    },

    /** Panier marqué (hôte) : l'IA défensive adverse s'en souvient */
    noteScoreForTactics(team, pts) {
        const mem = this.scoreMemory[team];
        mem.push(pts === 3 ? 'out' : 'in');
        if (mem.length > 3) mem.shift();
    },

    /** Hôte, à chaque image : défense en place pour chaque équipe, places et coupeur de l'attaque */
    updateTactics(dt = 0) {
        if (!this.isAuthority) return;
        const r = this.matchRules;
        for (const team of ['A', 'B']) {
            const pick = r.tactics[team].def;
            r.defenseNow[team] = pick !== 'AUTO' ? pick : this.autoDefense(team);
        }
        this.updateMotion(dt);
    },

    /**
     * Attaque « coupes » et pick and roll (hôte) : chaque bot sans ballon a une place écartée (mise à jour toutes les
     * 0,5 s : le porteur garde la plus proche de lui, les autres se replacent) ; un seul coéquipier à la fois coupe
     * vers le cercle (toutes les 2,5 à 4,5 s quand le porteur est près du panier), puis reprend sa place
     */
    updateMotion(dt) {
        const team = this.matchRules.possessionTeam;
        const holder = this.ball.state === 'HELD' ? this.entities.get(this.ball.holderId) : null;
        const m = this.motion || (this.motion = { team: null, spots: new Map(), refresh: 0, cutterId: null, cutTimer: 0, cutLeft: 0 });
        if (m.team !== team) {
            Object.assign(m, { team, refresh: 0, cutterId: null, cutTimer: 2 + Math.random() * 2 });
            m.spots.clear();
        }
        m.refresh -= dt;
        if (m.refresh <= 0) {
            m.refresh = 0.5;
            this.assignMotionSpots(team, holder);
        }
        if (m.cutterId) {
            m.cutLeft -= dt;
            if (m.cutLeft <= 0) m.cutterId = null;
            return;
        }
        const rim = this.getAttackingHoopForTeam(team).rimPos;
        if (!holder || holder.team !== team || this.getHorizontalDist(holder.pos, rim) > 8) return;
        m.cutTimer -= dt;
        if (m.cutTimer > 0) return;
        m.cutTimer = 2.5 + Math.random() * 2;
        const candidates = [...m.spots.keys()].filter(id => id !== m.bigId);
        if (!candidates.length) return;
        m.cutterId = candidates[Math.floor(Math.random() * candidates.length)];
        m.cutLeft = 2.2;
    },

    /** Places de l'attaque « coupes » (voir updateMotion) */
    assignMotionSpots(team, holder) {
        const m = this.motion;
        const hoop = this.getAttackingHoopForTeam(team);
        const rim = hoop.rimPos;
        const out = hoop.side === 'NORTH' ? 1 : -1;
        const world = ([x, z]) => new THREE.Vector3(rim.x + x, 0, rim.z + out * z);
        const nearest = (list, pos) => {
            let best = -1;
            list.forEach((s, i) => { if (best < 0 || s.distanceTo(pos) < list[best].distanceTo(pos)) best = i; });
            return best;
        };
        const free = MOTION_SPOTS.map(world);
        const mates = [...this.entities.values()].filter(e => e.team === team);
        // Le porteur et les joueurs humains gardent la place la plus proche d'eux
        for (const e of mates) {
            if (e.isBot && e !== holder) continue;
            const i = nearest(free, e.pos);
            if (i >= 0) free.splice(i, 1);
        }
        const bots = mates.filter(e => e.isBot && e !== holder && !e.pnr).sort((a, b) => a.slotIndex - b.slotIndex);
        const shooting = (e) => e.profile.attributes?.shooting || 70;
        // Le plus mauvais tireur de loin (s'il tire mal) attend près du cercle, côté opposé au ballon
        const big = bots.filter(e => shooting(e) < 72).sort((a, b) => shooting(a) - shooting(b))[0];
        const prev = m.spots;
        m.spots = new Map();
        m.bigId = big?.id;
        if (big) {
            const ballSide = (holder?.pos.x ?? rim.x) > rim.x ? 1 : -1;
            m.spots.set(big.id, world([-ballSide * DUNKER_SPOT[0], DUNKER_SPOT[1]]));
        }
        for (const b of bots) {
            if (b === big || !free.length) continue;
            // Il garde sa place si elle est encore libre, sinon il prend la plus proche
            const old = prev.get(b.id);
            let i = old ? free.findIndex(s => s.distanceTo(old) < 0.5) : -1;
            if (i < 0) i = nearest(free, b.pos);
            m.spots.set(b.id, free[i]);
            free.splice(i, 1);
        }
    },

    autoDefense(team) {
        const r = this.matchRules;
        const opp = otherTeam(team);
        const diff = (team === 'A' ? r.scoreA - r.scoreB : r.scoreB - r.scoreA);
        if (diff <= -5) return 'PRESS';
        const mem = this.scoreMemory[opp];
        if (mem.length >= 3 && mem.every(k => k === 'in')) return 'ZONE';
        if (mem.length >= 2 && mem.slice(-2).every(k => k === 'out')) return 'MAN';
        return r.defenseNow[team] === 'PRESS' ? 'MAN' : r.defenseNow[team];
    },

    /** Nouvelle possession (hôte) : système d'attaque choisi par l'équipe, ou tiré au sort en « Auto » */
    pickPossessionPlay(team) {
        if (!this.isAuthority) return;
        const pick = this.matchRules.tactics[team].off;
        let play = pick;
        if (pick === 'AUTO') {
            let roll = Math.random();
            play = PLAY_WEIGHTS.find(([, w]) => (roll -= w) < 0)?.[0] || 'MOTION';
        }
        this.matchRules.plays[team] = play;
    },

    /** Choix du joueur local dans le HUD (pour toute son équipe) */
    setMyTactics(def, off) {
        const me = this.getLocalEntity();
        if (!me || !DEFENSES[def] || !OFFENSES[off]) return;
        if (this.isAuthority) this.applyTactics(me.team, def, off, me);
        else this.network.sendGameEvent('TACTIC', { def, off });
    },

    /** Hôte : tactique demandée par un joueur (son équipe uniquement, valeurs connues uniquement) */
    applyTactics(team, def, off, player) {
        if (!DEFENSES[def] || !OFFENSES[off]) return;
        this.matchRules.tactics[team] = { def, off };
        this.pickPossessionPlay(team);
        this.showRuleAlert(`📋 ÉQUIPE ${team} (${player.profile.playerName}) : attaque ${OFFENSES[off]}, défense ${DEFENSES[def]}`);
    },

    /** HUD : tactiques en cours et fautes d'équipe, mis à jour seulement quand le texte change */
    updateTacticsUI() {
        const me = this.getLocalEntity();
        const r = this.matchRules;
        if (!me || !r.plays) return;
        const opp = otherTeam(me.team);
        const fouls = r.teamFouls || { A: 0, B: 0 };
        const text = `Ton équipe : ${OFFENSES[r.plays[me.team]] || ''} · défense ${DEFENSES[r.defenseNow[me.team]] || ''}` +
            ` — Adversaire : défense ${DEFENSES[r.defenseNow[opp]] || ''} — Fautes A ${fouls.A} · B ${fouls.B}`;
        if (text === this.lastTacticsText) return;
        this.lastTacticsText = text;
        const el = document.getElementById('hud-tactics');
        if (el) el.textContent = text;
        // Un coéquipier a changé la tactique : le menu suit (sauf s'il est ouvert)
        const t = r.tactics[me.team];
        for (const [id, value] of [['hud-defense', t.def], ['hud-offense', t.off]]) {
            const sel = document.getElementById(id);
            if (sel && document.activeElement !== sel && sel.value !== value) sel.value = value;
        }
    },

    // ---------------------------------------------------------------- Défense

    /** Zone : chaque bot garde sa place (décalée vers le ballon), le plus proche du porteur sort sur lui */
    zoneDefenseMove(bot, dt, speed) {
        const mates = [...this.entities.values()].filter(e => e.team === bot.team).sort((a, b) => a.slotIndex - b.slotIndex);
        const formation = ZONES[Math.min(5, Math.max(3, mates.length))];
        const hoop = this.getAttackingHoopForTeam(otherTeam(bot.team));
        const rim = hoop.rimPos;
        const out = hoop.side === 'NORTH' ? 1 : -1;
        const baseOf = (ent) => {
            const f = formation[mates.indexOf(ent) % formation.length];
            return new THREE.Vector3(rim.x + f[0], 0, rim.z + out * f[1]);
        };

        const handler = this.ball.state === 'HELD' ? this.entities.get(this.ball.holderId) : null;
        if (handler && handler.team !== bot.team && this.getHorizontalDist(handler.pos, rim) < 8) {
            let closest = null;
            let best = Infinity;
            for (const m of mates) {
                if (!m.isBot) continue;
                const d = this.getHorizontalDist(baseOf(m), handler.pos);
                if (d < best) { best = d; closest = m; }
            }
            if (closest === bot) {
                const toRim = new THREE.Vector3(rim.x - handler.pos.x, 0, rim.z - handler.pos.z).normalize();
                const spot = handler.pos.clone().addScaledVector(toRim, 1.3).setY(0);
                const d = this.moveEntityTowards(bot, spot, speed, dt);
                bot.rotY = Math.atan2(handler.pos.x - bot.pos.x, handler.pos.z - bot.pos.z);
                this.botContest(bot, handler, d);
                return true;
            }
        }

        const base = baseOf(bot);
        const spot = base.clone().addScaledVector(new THREE.Vector3(this.ball.pos.x - base.x, 0, this.ball.pos.z - base.z), 0.28);
        const d = this.moveEntityTowards(bot, spot, speed * 0.95, dt);
        bot.rotY = Math.atan2(this.ball.pos.x - bot.pos.x, this.ball.pos.z - bot.pos.z);
        // Un attaquant qui tire dans sa zone : il saute pour contester
        for (const ent of this.entities.values()) {
            if (ent.team !== bot.team && this.getHorizontalDist(ent.pos, bot.pos) < 1.55) {
                this.botContest(bot, ent, d);
                return true;
            }
        }
        if (bot.pos.y <= 0.05) bot.state = d > 0.45 ? 'RUN' : 'DEFENSE';
        return true;
    },

    /**
     * Pressing : les deux bots les plus proches prennent le porteur à deux (dans son camp en tout-terrain,
     * loin du panier en demi-terrain) et tentent l'interception. Renvoie faux hors de la zone de pressing
     */
    pressDefenseMove(bot, dt, speed) {
        const handler = this.ball.state === 'HELD' ? this.entities.get(this.ball.holderId) : null;
        if (!handler || handler.team === bot.team) return false;
        const hoop = this.getAttackingHoopForTeam(handler.team);
        const dist = this.getHorizontalDist(handler.pos, hoop.rimPos);
        const trapZone = this.currentMode.isHalfCourt
            ? dist > hoop.threePointRadius + 0.3
            : dist > this.court.courtLength / 2;
        if (!trapZone) return false;

        const trappers = [...this.entities.values()]
            .filter(e => e.isBot && e.team === bot.team)
            .sort((a, b) => this.getHorizontalDist(a.pos, handler.pos) - this.getHorizontalDist(b.pos, handler.pos))
            .slice(0, 2);
        const idx = trappers.indexOf(bot);
        if (idx < 0) return false;

        const toRim = new THREE.Vector3(hoop.rimPos.x - handler.pos.x, 0, hoop.rimPos.z - handler.pos.z).normalize();
        const perp = new THREE.Vector3(-toRim.z, 0, toRim.x);
        const spot = handler.pos.clone().addScaledVector(toRim, 0.9).addScaledVector(perp, idx === 0 ? 0.75 : -0.75).setY(0);
        this.moveEntityTowards(bot, spot, speed * 1.05, dt);
        bot.rotY = Math.atan2(handler.pos.x - bot.pos.x, handler.pos.z - bot.pos.z);
        if (bot.pos.y <= 0.05) bot.state = 'DEFENSE';
        if (this.getHorizontalDist(bot.pos, handler.pos) < 1.6 && !(bot.stealCd > 0) && Math.random() < dt * 0.6) {
            this.tryStealBall(bot);
        }
        return true;
    },

    // ---------------------------------------------------------------- Attaque

    /** Bot sans ballon : places de l'isolation et du jeu au poste. Faux pour les coupes et le pick and roll */
    offBallPlayMove(bot, dt, speed, hoop) {
        const play = this.matchRules.plays?.[bot.team];
        if (play !== 'ISO' && play !== 'POST') return false;
        const rim = hoop.rimPos;
        const out = hoop.side === 'NORTH' ? 1 : -1;
        let target;
        if (play === 'POST' && this.postPlayer(bot.team) === bot) {
            target = this.postSpot(bot, hoop);
        } else {
            const mates = [...this.entities.values()]
                .filter(e => e.team === bot.team && e.id !== this.ball.holderId)
                .sort((a, b) => a.slotIndex - b.slotIndex);
            const s = SPACING_SPOTS[Math.max(0, mates.indexOf(bot)) % SPACING_SPOTS.length];
            target = new THREE.Vector3(rim.x + s[0], 0, rim.z + out * s[1]);
        }
        const d = this.moveEntityTowards(bot, target, speed * 0.95, dt);
        const carrier = this.entities.get(this.ball.holderId);
        if (d <= 0.45 && carrier) bot.rotY = Math.atan2(carrier.pos.x - bot.pos.x, carrier.pos.z - bot.pos.z);
        bot.state = d > 0.45 ? 'RUN' : 'IDLE';
        return true;
    },

    /** Joueur de poste : le plus grand bot de l'équipe qui n'a pas le ballon */
    postPlayer(team) {
        let best = null;
        for (const ent of this.entities.values()) {
            if (!ent.isBot || ent.team !== team || ent.id === this.ball.holderId) continue;
            const h = POSITIONS[ent.profile.position]?.scaleY || 1;
            if (!best || h > (POSITIONS[best.profile.position]?.scaleY || 1)) best = ent;
        }
        return best;
    },

    /** Place au poste bas, du côté de son numéro de place */
    postSpot(bot, hoop) {
        const out = hoop.side === 'NORTH' ? 1 : -1;
        const side = bot.slotIndex % 2 === 0 ? -1 : 1;
        return new THREE.Vector3(hoop.rimPos.x + side * 1.7, 0, hoop.rimPos.z + out * 1.3);
    },

    /**
     * Bot porteur en jeu au poste : sert le grand installé au poste, ou (s'il est lui-même au poste)
     * joue dos au panier puis finit (crochet) ou tire en fadeaway. Renvoie vrai si l'action est décidée ici
     */
    postPlayMove(bot, dt, speed, hoop, distToHoop) {
        if (this.matchRules.plays?.[bot.team] !== 'POST') return false;
        const post = this.postPlayer(bot.team);
        if (post && bot.aiThinkTimer <= 0 && this.getHorizontalDist(post.pos, this.postSpot(post, hoop)) < 0.7 &&
            this.calculateContestFactor(post) < 0.5 && Math.random() < 0.6) {
            this.launchPass(bot, post);
            bot.aiThinkTimer = 1.2;
            return true;
        }
        const isBig = (POSITIONS[bot.profile.position]?.scaleY || 1) >= 1.05;
        if (!isBig || distToHoop > 4.2) return false;
        bot.postTimer = (bot.postTimer ?? 1.4) - dt;
        if (bot.postTimer > 0) {
            // Dos au panier : il recule pas à pas vers le cercle
            this.moveEntityTowards(bot, hoop.rimPos, speed * 0.45, dt);
            bot.rotY = Math.atan2(bot.pos.x - hoop.rimPos.x, bot.pos.z - hoop.rimPos.z);
            bot.state = 'DRIBBLE';
            return true;
        }
        bot.postTimer = null;
        if (distToHoop < 2.6) {
            this.botFinish(bot, hoop, distToHoop);
        } else {
            const contest = this.botShotMove(bot, hoop, distToHoop, Math.max(0.36, this.calculateContestFactor(bot)));
            const stat = bot.profile.attributes?.shooting || 70;
            const makeProb = Math.max(0.3, Math.min(0.62, 0.42 + ((stat - 60) / 39) * 0.15 - contest * 0.25));
            this.launchShotBall(bot, hoop, { isMake: Math.random() < makeProb, isGreen: false, isThreePointer: false });
            bot.state = 'SHOOT';
            bot.vel.y = 3.5;
        }
        bot.aiThinkTimer = 1.6;
        return true;
    }
};
