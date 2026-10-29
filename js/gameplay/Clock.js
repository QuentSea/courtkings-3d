/**
 * Clock.js — Chrono de tir (24 s), temps de match, mi-temps au temps, fin de match et écran de résultat.
 * - Chrono de tir : 24 s à chaque changement de possession, 14 s après un rebond offensif (au moins),
 *   arrêté pendant un tir ; à 0, la balle passe à l'autre équipe.
 * - Temps de match (`gameDuration` du mode) : il ne tourne que balle vivante (pas pendant les remises en jeu).
 * - Fin : score cible atteint, ou temps écoulé avec un vainqueur ; égalité = panier en or (le prochain gagne).
 * Seul l'hôte fait tourner les chronos et décide de la fin ; les invités reçoivent tout par WORLD_STATE.
 * Méthodes ajoutées au prototype de GameEngine (voir la fin de GameEngine.js) : `this` est le moteur.
 */

export const SHOT_CLOCK = 24;
const OFFENSIVE_REBOUND_CLOCK = 14;
const BOT_HURRY = 3.5; // sous ce temps de tir, un bot porteur tire tout de suite

export const ClockMethods = {
    /** Début de match : chronos pleins, scores individuels à zéro, écran de fin caché */
    resetMatchClock() {
        const r = this.matchRules;
        r.gameClock = this.currentMode.gameDuration || 600;
        r.shotClock = SHOT_CLOCK;
        r.shotClockStopped = false;
        r.deadBall = false;
        r.matchOver = false;
        r.winner = null;
        r.endReason = '';
        r.goldenPoint = false;
        this.matchToken = (this.matchToken || 0) + 1;
        this.resetMatchSheet();
        this.resetFouls();   // Fouls.js
        this.resetTactics(); // Tactics.js
        this.hideMatchEnd();
        this.lastClockText = null;
        this.lastShotText = null;
    },

    /** Un bot porteur doit-il tirer tout de suite (fin du chrono de tir) ? */
    isShotClockHurry() {
        return this.matchRules.shotClock < BOT_HURRY && !this.matchRules.shotClockStopped;
    },

    /** Remise en jeu après un délai, annulée si un nouveau match a commencé ou si le match est fini */
    scheduleCheckBall(team, delayMs) {
        const token = this.matchToken;
        setTimeout(() => {
            if (token !== this.matchToken || this.matchRules.matchOver) return;
            this.resetPositionsForCheckBall(team);
        }, delayMs);
    },

    /**
     * Hôte, à chaque image : temps de match, mi-temps au temps (tout-terrain), chrono de tir
     */
    updateMatchClock(dt) {
        const r = this.matchRules;
        if (!this.isAuthority || r.matchOver || r.deadBall) return;
        this.liveTime += dt; // temps de jeu réel, pour les passes décisives (MatchSheet.js)

        if (!r.goldenPoint) {
            r.gameClock = Math.max(0, r.gameClock - dt);
            const duration = this.currentMode.gameDuration || 600;
            if (!this.currentMode.isHalfCourt && !r.sidesSwapped && r.gameClock <= duration / 2 && this.ball.state !== 'SHOT') {
                // Mi-temps au temps : changement de côté, l'équipe B (qui n'a pas commencé) remet en jeu
                r.sidesSwapped = true;
                r.teamFouls = { A: 0, B: 0 }; // fautes d'équipe remises à zéro à la mi-temps
                this.pendingHalftimeAlert = true;
                this.stopPlay();
                this.showRuleAlert('⏱️ FIN DE LA 1RE MI-TEMPS !');
                this.scheduleCheckBall('B', 1800);
                return;
            }
            // Un tir parti avant la sirène compte : attendre qu'il soit joué
            if (r.gameClock <= 0 && this.ball.state !== 'SHOT') {
                this.onGameTimeUp();
                return;
            }
        }

        const live = this.ball.state !== 'SHOT' && !r.shotClockStopped;
        if (live) {
            r.shotClock = Math.max(0, r.shotClock - dt);
            if (r.shotClock <= 0) this.shotClockViolation();
        }
    },

    /** Balle morte : plus de ramassage ni de chrono jusqu'à la remise en jeu */
    stopPlay() {
        const r = this.matchRules;
        r.deadBall = true;
        if (this.ball.state === 'HELD' || this.ball.state === 'PASS') {
            const holder = this.entities.get(this.ball.holderId);
            this.ball.holderId = null;
            this.ball.state = 'LOOSE';
            if (holder) this.ball.pos.set(holder.pos.x, 1.0, holder.pos.z);
            this.ball.vel.set(0, 1.5, 0);
        }
        if (this.shotMeter?.active) this.shotMeter.cancel();
    },

    shotClockViolation() {
        const team = this.matchRules.possessionTeam;
        const other = team === 'A' ? 'B' : 'A';
        this.onShotClockViolation(team, this.ball.state === 'HELD' ? this.ball.holderId : null);
        this.stopPlay();
        this.showRuleAlert(`⏱️ 24 SECONDES ! BALLE À L'ÉQUIPE ${other}`);
        this.scheduleCheckBall(other, 1500);
    },

    /** Chrono de tir quand quelqu'un prend le ballon (appelé par giveBallTo) */
    onPossessionGained(prevTeam, team) {
        const r = this.matchRules;
        if (prevTeam !== team) {
            r.shotClock = SHOT_CLOCK;
            this.pickPossessionPlay(team); // système d'attaque de la nouvelle possession (Tactics.js)
        } else if (r.shotClockStopped) {
            r.shotClock = Math.max(r.shotClock, OFFENSIVE_REBOUND_CLOCK);
        }
        r.shotClockStopped = false;
    },

    /**
     * Points marqués (tir, dunk ou lancer franc, hôte) : score, marqueur, fin de match ou mi-temps, puis remise
     * en jeu. then : à la place de la remise en jeu (lancers francs après une faute, lancer suivant d'une série)
     */
    scorePoints(team, pts, scorerId, kind = 'shot', then = null) {
        const r = this.matchRules;
        if (team === 'A') r.scoreA += pts; else r.scoreB += pts;
        this.onScored(team, pts, scorerId, kind); // feuille de match
        if (kind !== 'ft') this.noteScoreForTactics(team, pts); // défense « Auto » de l'adversaire (Tactics.js)
        r.deadBall = true;
        r.shotClockStopped = true;
        this.updateScoreboardUI();

        if (this.checkMatchEnd()) return;
        if (then) {
            then();
            return;
        }
        this.checkHalftime();
        this.scheduleCheckBall(team === 'A' ? 'B' : 'A', 1200);
    },

    /** Vrai si le match vient de se terminer (score cible, panier en or, ou temps écoulé après un panier) */
    checkMatchEnd() {
        const r = this.matchRules;
        if (r.matchOver) return true;
        const target = this.currentMode.targetScore || 21;
        const lead = r.scoreA === r.scoreB ? null : (r.scoreA > r.scoreB ? 'A' : 'B');
        if (Math.max(r.scoreA, r.scoreB) >= target) {
            this.endMatch(lead, `PREMIÈRE ÉQUIPE À ${target} POINTS`);
            return true;
        }
        if (r.goldenPoint && lead) {
            this.endMatch(lead, 'PANIER EN OR');
            return true;
        }
        if (r.gameClock <= 0 && !r.goldenPoint && lead) {
            this.endMatch(lead, 'FIN DU TEMPS RÉGLEMENTAIRE');
            return true;
        }
        return false;
    },

    onGameTimeUp() {
        const r = this.matchRules;
        if (this.checkMatchEnd()) return;
        // Égalité : panier en or, le temps ne compte plus
        r.goldenPoint = true;
        this.stopPlay();
        this.showRuleAlert('🏆 ÉGALITÉ ! PANIER EN OR : LE PROCHAIN PANIER GAGNE');
        const next = r.possessionTeam === 'A' ? 'B' : 'A';
        this.scheduleCheckBall(next, 2000);
    },

    endMatch(winner, reason) {
        const r = this.matchRules;
        r.matchOver = true;
        r.winner = winner;
        r.endReason = reason;
        r.freeThrow = null;
        this.stopPlay();
        this.showRuleAlert(`🏆 VICTOIRE DE L'ÉQUIPE ${winner} !`);
        this.showMatchEnd();
    },

    /** Écran de fin (hôte et invités) : vainqueur, score, meilleur marqueur, boutons */
    showMatchEnd() {
        const overlay = document.getElementById('match-end-overlay');
        if (!overlay) return;
        const r = this.matchRules;
        const me = this.getLocalEntity();
        const title = document.getElementById('match-end-title');
        const score = document.getElementById('match-end-score');
        const reason = document.getElementById('match-end-reason');
        const mvp = document.getElementById('match-end-mvp');
        const replay = document.getElementById('btn-match-end-replay');
        const wait = document.getElementById('match-end-wait');

        const won = me && me.team === r.winner;
        title.textContent = me ? (won ? '🏆 VICTOIRE !' : 'DÉFAITE') : `VICTOIRE DE L'ÉQUIPE ${r.winner}`;
        overlay.classList.toggle('lost', !!me && !won);
        score.textContent = `ÉQUIPE A ${r.scoreA} — ${r.scoreB} ÉQUIPE B`;
        reason.textContent = `Victoire de l'équipe ${r.winner} : ${r.endReason.toLowerCase()}`;

        const pts = (ent) => this.matchSheet.stats[ent.id]?.pts || 0;
        let best = null;
        for (const ent of this.entities.values()) {
            if (!best || pts(ent) > pts(best)) best = ent;
        }
        mvp.textContent = best && pts(best) > 0
            ? `Meilleur marqueur : ${best.profile.playerName} (équipe ${best.team}) — ${pts(best)} pts`
            : '';
        this.renderMatchSheet();

        // Seul l'hôte peut relancer (il décide pour tout le salon)
        const isHost = this.network.isHost;
        replay.classList.toggle('hidden', !isHost);
        wait.classList.toggle('hidden', isHost);
        overlay.classList.remove('hidden');
    },

    hideMatchEnd() {
        document.getElementById('match-end-overlay')?.classList.add('hidden');
    },

    /** HUD, écran géant et chronos au-dessus des planches : mis à jour seulement quand l'affichage change */
    updateClockUI() {
        const r = this.matchRules;
        const clockText = r.goldenPoint ? 'PANIER EN OR' : formatClock(r.gameClock);
        const shotText = r.shotClock < 5 ? r.shotClock.toFixed(1) : String(Math.ceil(r.shotClock));

        if (clockText !== this.lastClockText) {
            this.lastClockText = clockText;
            const el = document.getElementById('hud-game-clock');
            if (el) el.textContent = clockText;
            this.court?.updateScoreboard(r.scoreA, r.scoreB, clockText);
        }
        if (shotText !== this.lastShotText) {
            this.lastShotText = shotText;
            const el = document.getElementById('hud-shot-clock');
            if (el) {
                el.textContent = shotText;
                el.classList.toggle('low', r.shotClock < 5);
            }
            this.court?.updateShotClock(Math.ceil(r.shotClock));
        }
    }
};

export function formatClock(seconds) {
    const s = Math.ceil(Math.max(0, seconds));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
