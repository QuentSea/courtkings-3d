/**
 * Fouls.js — Fautes et lancers francs.
 * - Faute sur tir (hôte, au départ d'un tir, d'un lay-up ou à la fin d'un dunk) : défenseur trop près
 *   → 2 lancers francs (3 sur un tir à 3 pts), 1 seul si le panier est réussi (« and one »).
 * - Faute en défense (interception ratée, pressing) : remise en jeu pour l'attaque, ou 2 lancers francs
 *   à partir de la `bonusFouls()`-ième faute d'équipe de la mi-temps (bonus).
 * - Lancers : balle morte, joueurs alignés le long de la raquette, le tireur tire avec la jauge (bots tout seuls).
 *   Le dernier lancer raté est un rebond en jeu.
 * Seul l'hôte siffle et compte ; les invités reçoivent `teamFouls` et `freeThrow` dans WORLD_STATE.
 * Méthodes ajoutées au prototype de GameEngine (voir la fin de GameEngine.js) : `this` est le moteur.
 */

export const FT_DISTANCE = 4.6;   // ligne des lancers francs (m du centre du cercle)
const FT_BOT_DELAY = 1.3;         // un bot tireur prend son temps avant de lancer (s)
const FOUL_REACH = 1.4;           // au-delà, un défenseur ne peut pas faire faute sur le tir (m)

export const FoulMethods = {
    resetFouls() {
        this.matchRules.teamFouls = { A: 0, B: 0 };
        this.matchRules.freeThrow = null;
    },

    /** Lancers francs à partir de cette faute d'équipe : 5 en 5v5 (par mi-temps), 7 en demi-terrain (par match) */
    bonusFouls() {
        return this.currentMode.isHalfCourt ? 7 : 5;
    },

    /** Faute sur le tireur ? (hôte) Renvoie l'id du défenseur fautif, ou null */
    rollShootingFoul(shooter, isDunk = false) {
        if (!this.isAuthority || this.matchRules.freeThrow) return null;
        let fouler = null;
        let best = FOUL_REACH;
        for (const ent of this.entities.values()) {
            if (ent.team === shooter.team || ent.screenedTimer > 0) continue;
            const d = this.getHorizontalDist(ent.pos, shooter.pos);
            if (d < best) { best = d; fouler = ent; }
        }
        if (!fouler) return null;
        // Collé au tireur et mauvais défenseur = plus de fautes ; ~8 à 20 % sur un tir bien contesté
        const def = (fouler.profile.attributes?.defense || 75) / 99;
        const close = (FOUL_REACH - best) / FOUL_REACH;
        const chance = close * ((isDunk ? 0.42 : 0.30) - def * 0.12) + (fouler.state === 'CONTEST' ? 0.05 : 0);
        return Math.random() < chance ? fouler.id : null;
    },

    /** Faute en essayant de prendre le ballon (après une interception ratée) ? */
    rollReachInFoul(defender, carrier, dist) {
        const def = defender.profile.attributes?.defense || 75;
        const drib = carrier.profile.attributes?.dribble || 75;
        const chance = 0.10 + (dist < 1 ? 0.06 : 0) + Math.max(0, drib - def) * 0.004;
        return Math.random() < chance;
    },

    /**
     * Faute sifflée (hôte) : compte, message, puis lancers francs ou remise en jeu.
     * shotPts : valeur du tir sur lequel il y a faute (0 = faute hors tir) ; made : le tir est rentré
     */
    commitFoul(foulerId, victimId, { shotPts = 0, made = false } = {}) {
        const r = this.matchRules;
        const fouler = this.entities.get(foulerId);
        const victim = this.entities.get(victimId);
        if (!this.isAuthority || !fouler || !victim || r.matchOver) return;
        const teamFouls = ++r.teamFouls[fouler.team];
        this.onFoul(fouler, victim, teamFouls); // feuille de match
        victim.react = 'FOULED';                // il encaisse le contact (AnimatedCharacter)
        victim.reactTimer = 0.6;
        if (!shotPts) this.playSound('whistle', victim.pos); // faute sur un tir : sifflée au départ du tir (Ball.js)

        let shots = 0;
        if (shotPts) shots = made ? 1 : shotPts;
        else if (teamFouls >= this.bonusFouls()) shots = 2;

        this.stopPlay();
        const who = fouler.profile.playerName;
        if (shots) {
            const what = shots > 1 ? `${shots} LANCERS FRANCS` : '1 LANCER FRANC';
            const bonus = !shotPts ? ` (${teamFouls}e faute d'équipe)` : '';
            this.showRuleAlert(`🟨 FAUTE DE ${who}${bonus} : ${what} POUR ${victim.profile.playerName}`);
            this.scheduleFreeThrows(victim, shots);
        } else {
            this.showRuleAlert(`🟨 FAUTE DE ${who} (${teamFouls} d'équipe) — REMISE EN JEU ÉQUIPE ${victim.team}`);
            this.scheduleCheckBall(victim.team, 1300);
        }
    },

    /** Tir contré alors qu'une faute était déjà sifflée sur le tireur : les lancers francs restent dus (hôte) */
    foulOnBlockedShot(outcome) {
        if (!this.isAuthority || !outcome?.fouledBy) return;
        this.commitFoul(outcome.fouledBy, outcome.shooterId, { shotPts: outcome.isThreePointer ? 3 : 2, made: false });
    },

    scheduleFreeThrows(shooter, total) {
        const token = this.matchToken;
        setTimeout(() => {
            if (token !== this.matchToken || this.matchRules.matchOver) return;
            this.matchRules.freeThrow = { shooterId: shooter.id, team: shooter.team, total, index: 1 };
            this.setupFreeThrow();
        }, 1300);
    },

    /** Lancer suivant de la série (après un lancer qui n'était pas le dernier) */
    nextFreeThrow() {
        const ft = this.matchRules.freeThrow;
        if (!ft) return;
        ft.index++;
        const token = this.matchToken;
        setTimeout(() => {
            if (token !== this.matchToken || this.matchRules.matchOver || this.matchRules.freeThrow !== ft) return;
            this.setupFreeThrow();
        }, 900);
    },

    /**
     * Place les joueurs pour un lancer franc et donne le ballon au tireur (hôte, puis invités quand
     * `checkBallSeq` change, voir NetSync)
     */
    setupFreeThrow() {
        const r = this.matchRules;
        const ft = r.freeThrow;
        if (!ft) return;
        const hoop = this.getAttackingHoopForTeam(ft.team);
        const out = hoop.side === 'NORTH' ? 1 : -1;
        const rim = hoop.rimPos;
        // Le long de la raquette : la défense au plus près du cercle, l'attaque ensuite, les autres derrière
        // (une place chacun : deux joueurs au même endroit ne peuvent plus être écartés)
        const lane = [[-1.9, 1.2], [1.9, 1.2], [-1.9, 2.3], [1.9, 2.3], [-1.9, 3.4], [1.9, 3.4],
            [-3.6, FT_DISTANCE + 2.2], [3.6, FT_DISTANCE + 2.2], [-1.4, FT_DISTANCE + 3.0], [1.4, FT_DISTANCE + 3.0]];
        const others = [...this.entities.values()].filter(e => e.id !== ft.shooterId)
            .sort((a, b) => (a.team === ft.team) - (b.team === ft.team));
        const shooter = this.entities.get(ft.shooterId);
        if (!shooter) { r.freeThrow = null; return; }

        const place = (ent, x, z) => {
            ent.pos.set(rim.x + x, 0, rim.z + out * z);
            this.clampToCourtBounds(ent.pos);
            ent.mesh.root.position.copy(ent.pos);
            ent.netPos = ent.pos.clone();
            ent.vel.set(0, 0, 0);
            ent.isDunking = false;
            ent.state = 'IDLE';
            ent.screenTimer = 0;
            ent.screenedTimer = 0;
            ent.pnr = null;
            ent.rotY = Math.atan2(rim.x - ent.pos.x, rim.z - ent.pos.z);
        };
        place(shooter, 0, FT_DISTANCE);
        others.forEach((ent, i) => place(ent, lane[i % lane.length][0], lane[i % lane.length][1]));

        if (this.isAuthority) r.checkBallSeq++;
        this.inCheckBall = true;
        this.giveBallTo(shooter.id, false);
        this.inCheckBall = false;
        r.deadBall = true; // chronos arrêtés jusqu'au dernier lancer
        r.shotClockStopped = true;
        this.ftTimer = FT_BOT_DELAY;
        this.showRuleAlert(`🎯 LANCER FRANC ${ft.index}/${ft.total} — ${shooter.profile.playerName}`);
    },

    /** Hôte, à chaque image : un bot tireur lance tout seul */
    updateFreeThrow(dt) {
        const ft = this.matchRules.freeThrow;
        if (!ft || !this.isAuthority || this.ball.state !== 'HELD' || this.ball.holderId !== ft.shooterId) return;
        const shooter = this.entities.get(ft.shooterId);
        if (!shooter?.isBot) return;
        this.ftTimer -= dt;
        if (this.ftTimer > 0) return;
        const shooting = shooter.profile.attributes?.shooting || 75;
        const makeProb = 0.45 + (shooting / 99) * 0.4; // ~70 à 81 %
        this.launchShotBall(shooter, this.getAttackingHoopForTeam(shooter.team), {
            isMake: Math.random() < makeProb,
            isGreen: false,
            isThreePointer: false
        });
        shooter.state = 'SHOOT';
    },

    /** Est-ce un lancer franc de ce joueur (ballon en main, série en cours) ? */
    isFreeThrowShooter(player) {
        const ft = this.matchRules.freeThrow;
        return !!ft && ft.shooterId === player.id;
    }
};
