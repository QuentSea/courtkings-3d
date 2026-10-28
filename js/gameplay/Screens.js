/**
 * Screens.js — Écrans (« block ») et pick and roll.
 * - Un attaquant sans ballon pose un écran : il reste planté (état 'SCREEN') ; un défenseur qui le percute est
 *   ralenti un moment (screenedTimer) et conteste moins bien.
 * - Le porteur peut demander un écran : un bot coéquipier vient le poser sur son défenseur, puis plonge vers le
 *   panier (roll) ou ressort à 3 points (pop) s'il est bon tireur. Les bots lancent aussi le pick and roll seuls.
 * - Défense des bots : contournent l'écran (ralentis) ou changent de joueur (switch) selon leur défense.
 * Méthodes ajoutées au prototype de GameEngine (voir la fin de GameEngine.js) : `this` est le moteur.
 */

import * as THREE from 'three';

const SCREEN_DURATION = 2.2;     // durée maxi d'un écran posé à la main (s)
export const SCREEN_MIN_TIME = 0.45;   // avant ça, bouger ne lève pas l'écran (évite de l'annuler par accident)
const SCREENED_TIME = 0.95;      // durée du ralentissement d'un défenseur bloqué (s)
export const SCREENED_SPEED = 0.3; // vitesse d'un défenseur bloqué (part de sa vitesse normale)
const SCREEN_RADIUS = 1.2;       // un écran occupe plus de place qu'un joueur normal (1.05)

export const ScreenMethods = {
    isScreening(ent) {
        return ent.state === 'SCREEN';
    },

    /** Anneau orange au sol sous un joueur qui pose un écran (créé à la première utilisation) */
    updateScreenMarker(ent) {
        const on = this.isScreening(ent);
        if (!on && !ent.screenMarker) return;
        if (!ent.screenMarker) {
            const ring = new THREE.Mesh(
                new THREE.RingGeometry(SCREEN_RADIUS * 0.55, SCREEN_RADIUS * 0.68, 32),
                new THREE.MeshBasicMaterial({ color: '#f97316', side: THREE.DoubleSide, transparent: true, opacity: 0.85 })
            );
            ring.rotation.x = -Math.PI / 2;
            this.scene.add(ring);
            ent.screenMarker = ring;
        }
        ent.screenMarker.visible = on;
        if (on) ent.screenMarker.position.set(ent.pos.x, 0.025, ent.pos.z);
    },

    /**
     * Poser un écran (joueur sans ballon de l'équipe qui attaque, au sol)
     */
    trySetScreen(player) {
        if (this.ball.holderId === player.id) return false;
        if (this.matchRules.possessionTeam !== player.team) return false;
        if (player.pos.y > 0.05 || player.isDunking) return false;
        player.screenTimer = SCREEN_DURATION;
        player.screenHeld = 0;
        player.state = 'SCREEN';
        if (player.isLocal) this.showRuleAlert('🧱 ÉCRAN POSÉ', false);
        return true;
    },

    endScreen(player) {
        player.screenTimer = 0;
        if (player.state === 'SCREEN') player.state = 'IDLE';
    },

    /**
     * Le porteur demande un écran : le bot coéquipier le plus proche vient le poser
     */
    callForScreen(handler) {
        if (this.ball.holderId !== handler.id) return;
        if (!this.isAuthority) {
            this.network.sendGameEvent('SCREEN_CALL', { handlerId: handler.id });
            if (handler.isLocal) this.showRuleAlert('📣 ÉCRAN DEMANDÉ !', false);
            return;
        }
        const screener = this.startPickAndRoll(handler, true);
        if (!screener && handler.isLocal) this.showRuleAlert('AUCUN COÉQUIPIER POUR L\'ÉCRAN', false);
    },

    /**
     * Choisit un bot coéquipier et lui confie le pick and roll (hôte seulement)
     */
    startPickAndRoll(handler, called = false) {
        if (!this.isAuthority) return null;
        const defender = this.findOnBallDefender(handler);
        if (!defender) return null;
        let best = null;
        let bestDist = Infinity;
        for (const ent of this.entities.values()) {
            if (!ent.isBot || ent.team !== handler.team || ent.id === handler.id || ent.pnr) continue;
            const d = this.getHorizontalDist(ent.pos, defender.pos);
            if (d < bestDist) { best = ent; bestDist = d; }
        }
        if (!best || bestDist > 11) return null;
        best.pnr = { phase: 'GO', handlerId: handler.id, timer: 3.5 };
        this.endScreen(best);
        if (called || !handler.isBot) {
            this.showRuleAlert(`🧱 ${best.profile.playerName} VIENT POSER L'ÉCRAN !`);
        }
        return best;
    },

    /** Défenseur le plus proche du porteur (celui qu'on veut bloquer) */
    findOnBallDefender(handler) {
        let best = null;
        let bestDist = 3.5;
        for (const ent of this.entities.values()) {
            if (ent.team === handler.team) continue;
            const d = this.getHorizontalDist(ent.pos, handler.pos);
            if (d < bestDist) { best = ent; bestDist = d; }
        }
        return best;
    },

    /**
     * Minuteries des écrans et des défenseurs bloqués, lancement automatique du pick and roll par l'hôte
     */
    updateScreens(dt) {
        for (const ent of this.entities.values()) {
            if (ent.screenedTimer > 0) ent.screenedTimer -= dt;
            if (ent.screenedCooldown > 0) ent.screenedCooldown -= dt;
            if (ent.switchTimer > 0) {
                ent.switchTimer -= dt;
                if (ent.switchTimer <= 0) ent.switchManId = null;
            }
            // Seul celui qui simule le joueur gère la durée de son écran (le local, ou l'hôte pour les bots)
            const owns = ent.isLocal || (ent.isBot && this.isAuthority);
            if (owns && ent.screenTimer > 0) {
                ent.screenTimer -= dt;
                ent.screenHeld = (ent.screenHeld || 0) + dt;
                if (ent.screenTimer <= 0 || this.matchRules.possessionTeam !== ent.team || this.ball.holderId === ent.id) {
                    this.endScreen(ent);
                }
            }
        }
        if (!this.isAuthority) return;

        // Pick and roll spontané : de temps en temps, quand le porteur est marqué loin du panier
        this.pnrCooldown = (this.pnrCooldown ?? 4) - dt;
        if (this.pnrCooldown > 0) return;
        this.pnrCooldown = 1;
        const handler = this.ball.holderId ? this.entities.get(this.ball.holderId) : null;
        if (!handler || this.ball.state !== 'HELD' || this.matchRules.needsTakeBack) return;
        if ([...this.entities.values()].some(e => e.pnr)) return;
        const dist = this.getHorizontalDist(handler.pos, this.getAttackingHoopForTeam(handler.team).rimPos);
        if (dist < 4.5 || dist > 10) return;
        const chance = handler.isBot ? 0.35 : 0.12;
        if (Math.random() < chance && this.startPickAndRoll(handler)) {
            this.pnrCooldown = 8 + Math.random() * 5;
        }
    },

    /**
     * Collision avec un écran : le défenseur est arrêté (l'écran ne bouge pas) et ralenti
     * Renvoie vrai si la paire a été traitée ici
     */
    resolveScreenCollision(a, b) {
        const aScreen = this.isScreening(a) && a.team !== b.team;
        const bScreen = this.isScreening(b) && a.team !== b.team;
        if (!aScreen && !bScreen) return false;
        const screener = aScreen ? a : b;
        const other = aScreen ? b : a;
        const dx = other.pos.x - screener.pos.x;
        const dz = other.pos.z - screener.pos.z;
        const dist = Math.sqrt(dx * dx + dz * dz) || 0.01;
        if (dist >= SCREEN_RADIUS) return true;
        other.pos.x = screener.pos.x + (dx / dist) * SCREEN_RADIUS;
        other.pos.z = screener.pos.z + (dz / dist) * SCREEN_RADIUS;
        this.clampToCourtBounds(other.pos);
        if (!(other.screenedCooldown > 0)) this.onScreened(other, screener);
        return true;
    },

    onScreened(defender, screener) {
        defender.screenedTimer = SCREENED_TIME;
        defender.screenedCooldown = SCREENED_TIME + 0.8;
        if (defender.isLocal) this.showRuleAlert('🧱 BLOQUÉ PAR L\'ÉCRAN !', false);
        if (screener.isLocal) this.showRuleAlert('🧱 ÉCRAN RÉUSSI !', false);

        // Les bots défenseurs peuvent changer de joueur (switch) : celui de l'écran prend le porteur
        if (!this.isAuthority || !defender.isBot) return;
        const handlerId = this.ball.holderId;
        if (!handlerId || this.getAssignedMan(defender)?.id !== handlerId) return;
        const helper = [...this.entities.values()].find(
            e => e.isBot && e.team === defender.team && this.getAssignedMan(e)?.id === screener.id
        );
        const defStat = defender.profile.attributes?.defense || 75;
        if (helper && Math.random() < 0.25 + (defStat / 99) * 0.35) {
            helper.switchManId = handlerId;
            helper.switchTimer = 4;
            defender.switchManId = screener.id;
            defender.switchTimer = 4;
        }
    },

    /** Joueur marqué par un bot défenseur (changement après un écran, sinon même numéro de place) */
    getAssignedMan(bot) {
        if (bot.switchManId && bot.switchTimer > 0) {
            const man = this.entities.get(bot.switchManId);
            if (man) return man;
        }
        const opponents = [...this.entities.values()].filter(e => e.team !== bot.team);
        if (!opponents.length) return null;
        return opponents.find(o => o.slotIndex === bot.slotIndex) || opponents[bot.slotIndex % opponents.length];
    },

    /**
     * Bot qui pose l'écran pour le porteur, puis roule vers le panier ou ressort à 3 points.
     * Renvoie vrai si le bot est occupé par le pick and roll (le reste de son IA est sauté)
     */
    updatePickAndRollScreener(bot, dt, botSpeed) {
        const pnr = bot.pnr;
        if (!pnr) return false;
        const handler = this.entities.get(pnr.handlerId);
        const hoop = this.getAttackingHoopForTeam(bot.team);
        const stop = () => {
            bot.pnr = null;
            this.endScreen(bot);
            bot.offBallPhase = 'PERIMETER';
            bot.cutTimer = 0.6;
            return false;
        };
        if (this.matchRules.possessionTeam !== bot.team || !handler) return stop();
        pnr.timer -= dt;

        if (pnr.phase === 'GO') {
            const defender = this.findOnBallDefender(handler);
            if (this.ball.holderId !== handler.id || !defender || pnr.timer <= 0) return stop();
            // Place de l'écran : à côté du défenseur, du côté d'où vient le bot, un peu vers le porteur
            const toHoop = new THREE.Vector3().subVectors(hoop.rimPos, handler.pos).setY(0).normalize();
            const perp = new THREE.Vector3(-toHoop.z, 0, toHoop.x);
            if (perp.dot(new THREE.Vector3().subVectors(bot.pos, defender.pos)) < 0) perp.negate();
            const spot = defender.pos.clone().addScaledVector(perp, 0.85).addScaledVector(toHoop, -0.25).setY(0);
            const d = this.moveEntityTowards(bot, spot, botSpeed * 1.1, dt);
            bot.state = 'RUN';
            if (d < 0.45) {
                pnr.phase = 'SET';
                pnr.timer = 1.7;
                pnr.side = perp.clone(); // côté de l'écran par rapport au défenseur
                bot.screenTimer = 1.7;
                bot.screenHeld = 0;
                bot.state = 'SCREEN';
                bot.rotY = Math.atan2(handler.pos.x - bot.pos.x, handler.pos.z - bot.pos.z);
            }
            return true;
        }

        if (pnr.phase === 'SET') {
            const handlerPast = this.getHorizontalDist(handler.pos, hoop.rimPos) <
                this.getHorizontalDist(bot.pos, hoop.rimPos) - 0.4;
            if (bot.state === 'SCREEN' && !handlerPast && pnr.timer > 0) return true;
            this.endScreen(bot);
            const shooter = (bot.profile.attributes?.shooting || 75) >= 84;
            pnr.phase = shooter ? 'POP' : 'ROLL';
            pnr.timer = 2.6;
            if (shooter) {
                const away = new THREE.Vector3().subVectors(bot.pos, hoop.rimPos).setY(0).normalize();
                pnr.target = hoop.rimPos.clone().addScaledVector(away, 6.1).setY(0);
            } else {
                const fromHandler = new THREE.Vector3().subVectors(bot.pos, handler.pos).setY(0).normalize();
                pnr.target = hoop.rimPos.clone().addScaledVector(fromHandler, 1.2).setY(0);
                // ne pas finir derrière la planche
                const back = new THREE.Vector3().subVectors(handler.pos, hoop.rimPos).setY(0).normalize();
                pnr.target.addScaledVector(back, 0.9);
            }
            this.clampToCourtBounds(pnr.target);
        }

        // Roll / pop : appel de balle (le porteur peut lui passer, voir pickAndRollHandlerMove)
        if (pnr.timer <= 0) return stop();
        const d = this.moveEntityTowards(bot, pnr.target, botSpeed * (pnr.phase === 'ROLL' ? 1.2 : 1.05), dt);
        bot.state = d > 0.45 ? 'RUN' : 'IDLE';
        if (d <= 0.45 && handler) bot.rotY = Math.atan2(handler.pos.x - bot.pos.x, handler.pos.z - bot.pos.z);
        return true;
    },

    /**
     * Bot porteur pendant un pick and roll : attend l'écran, passe à côté, et sert le coéquipier qui roule
     * s'il est libre. Renvoie vrai si le mouvement du bot est décidé ici
     */
    pickAndRollHandlerMove(bot, dt, botSpeed, hoop) {
        const screener = [...this.entities.values()].find(e => e.pnr && e.pnr.handlerId === bot.id);
        if (!screener) return false;
        const pnr = screener.pnr;

        if (pnr.phase === 'GO') {
            // Dribble sur place en attendant l'écran
            bot.state = 'DRIBBLE';
            bot.rotY = Math.atan2(hoop.rimPos.x - bot.pos.x, hoop.rimPos.z - bot.pos.z);
            return true;
        }
        if (pnr.phase === 'SET') {
            // Frôler l'écran du côté opposé au défenseur, en direction du panier
            const target = screener.pos.clone().addScaledVector(pnr.side, 0.9);
            const toHoop = new THREE.Vector3().subVectors(hoop.rimPos, screener.pos).setY(0).normalize();
            target.addScaledVector(toHoop, 1.6).setY(0);
            this.moveEntityTowards(bot, target, botSpeed * 1.08, dt);
            bot.state = 'DRIBBLE';
            return true;
        }
        // Roll / pop : passe au coéquipier s'il est libre
        if (bot.aiThinkTimer <= 0.6 && this.ball.state === 'HELD') {
            const open = this.calculateContestFactor(screener) < 0.3;
            const good = pnr.phase === 'ROLL'
                ? this.getHorizontalDist(screener.pos, hoop.rimPos) < 3
                : this.getHorizontalDist(screener.pos, pnr.target) < 0.8;
            if (open && good && Math.random() < 0.6) {
                this.launchPass(bot, screener);
                bot.aiThinkTimer = 1.2;
                return true;
            }
        }
        return false;
    }
};
