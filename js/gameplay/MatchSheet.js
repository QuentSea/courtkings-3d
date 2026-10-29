/**
 * MatchSheet.js — Feuille de match : statistiques de chaque joueur et déroulé de toutes les actions.
 * - L'hôte compte tout (tirs, paniers, dunks, rebonds, passes décisives, interceptions, contres, écrans,
 *   balles perdues) et note chaque action avec le temps de match.
 * - À la fin, la feuille part chez les invités avec l'état du monde (NetSync) et s'affiche dans l'écran de fin :
 *   onglet « Statistiques » (une ligne par joueur, la sienne en évidence) et « Déroulé du match »
 *   (avec « seulement mes actions »).
 * Méthodes ajoutées au prototype de GameEngine (voir la fin de GameEngine.js) : `this` est le moteur.
 */

import { formatClock } from './Clock.js';

const ASSIST_WINDOW = 6; // secondes de jeu entre la passe et le panier pour une passe décisive
const MAX_LOG = 400;

const EMPTY = () => ({
    pts: 0, fgm2: 0, fga2: 0, fgm3: 0, fga3: 0, dunkM: 0, dunkA: 0,
    orb: 0, drb: 0, ast: 0, stl: 0, blk: 0, scr: 0, tov: 0
});

export const MatchSheetMethods = {
    resetMatchSheet() {
        this.matchSheet = { stats: {}, log: [] };
        this.lastPass = null;
        this.liveTime = 0; // temps de jeu écoulé (balle vivante), pour les passes décisives
        this.sheetPacket = 0;
        this.sheetFilterMine = false;
        const onlyMine = document.getElementById('sheet-only-mine');
        if (onlyMine) onlyMine.checked = false;
    },

    statsOf(id) {
        if (!this.matchSheet.stats[id]) this.matchSheet.stats[id] = EMPTY();
        return this.matchSheet.stats[id];
    },

    addStat(id, key, n = 1) {
        if (!this.isAuthority || !id || !this.entities.has(id)) return;
        this.statsOf(id)[key] += n;
    },

    nameOf(id) {
        return this.entities.get(id)?.profile.playerName || '?';
    },

    /** Une ligne du déroulé : temps de match, texte, joueurs concernés (pour « mes actions ») */
    logPlay(text, ids = [], team = null) {
        if (!this.isAuthority) return;
        const r = this.matchRules;
        const log = this.matchSheet.log;
        log.push({ t: r.goldenPoint ? 'OR' : formatClock(r.gameClock), text, ids: ids.filter(Boolean), team });
        if (log.length > MAX_LOG) log.shift();
    },

    /**
     * Le ballon change de main (appelé par giveBallTo, hors remise en jeu) : rebond, interception,
     * passe réussie ou ballon récupéré
     */
    onBallGained(prev, player) {
        if (!this.isAuthority) return;
        const r = this.matchRules;
        const name = player.profile.playerName;
        const sameTeam = prev.team === player.team;
        if (prev.afterShot) {
            this.addStat(player.id, sameTeam ? 'orb' : 'drb');
            this.logPlay(`${name} prend le rebond ${sameTeam ? 'offensif' : 'défensif'}`, [player.id], player.team);
        } else if (!sameTeam && (prev.state === 'HELD' || prev.state === 'PASS')) {
            const loser = prev.state === 'HELD' ? prev.holderId : prev.passFromId;
            this.addStat(player.id, 'stl');
            this.addStat(loser, 'tov');
            const how = prev.state === 'PASS' ? 'intercepte la passe de' : 'vole le ballon à';
            this.logPlay(`${name} ${how} ${this.nameOf(loser)}`, [player.id, loser], player.team);
        } else if (sameTeam && prev.state === 'PASS' && prev.passFromId && prev.passFromId !== player.id) {
            this.lastPass = { fromId: prev.passFromId, toId: player.id, at: this.liveTime };
            return; // les passes simples ne vont pas dans le déroulé (trop nombreuses)
        } else if (!sameTeam && prev.state === 'LOOSE') {
            this.logPlay(`${name} récupère le ballon`, [player.id], player.team);
        }
        if (r.possessionTeam !== prev.team) this.lastPass = null;
    },

    onShotTaken(shooter, isThree) {
        this.addStat(shooter.id, isThree ? 'fga3' : 'fga2');
    },

    onShotMissed(outcome) {
        if (!outcome) return;
        this.logPlay(`${outcome.shooterName} rate un tir à ${outcome.isThreePointer ? 3 : 2} pts`,
            [outcome.shooterId], outcome.shooterTeam);
    },

    onDunkAttempt(dunker, made) {
        this.addStat(dunker.id, 'dunkA');
        if (!made) this.logPlay(`${dunker.profile.playerName} rate son dunk sur l'arceau`, [dunker.id], dunker.team);
    },

    /** Panier (appelé par scorePoints) : points, réussite, passe décisive éventuelle */
    onScored(team, pts, scorerId, kind) {
        if (!this.isAuthority) return;
        const s = this.statsOf(scorerId);
        s.pts += pts;
        if (kind === 'dunk') { s.dunkM++; s.fgm2++; s.fga2++; } else if (pts === 3) s.fgm3++; else s.fgm2++;

        let assistText = '';
        const lp = this.lastPass;
        if (lp && lp.toId === scorerId && this.liveTime - lp.at <= ASSIST_WINDOW && this.entities.get(lp.fromId)?.team === team) {
            this.addStat(lp.fromId, 'ast');
            assistText = ` (passe décisive de ${this.nameOf(lp.fromId)})`;
        }
        this.lastPass = null;
        const what = kind === 'dunk' ? 'dunke' : `marque à ${pts} pts`;
        const r = this.matchRules;
        this.logPlay(`${this.nameOf(scorerId)} ${what}${assistText} — ${r.scoreA}-${r.scoreB}`,
            [scorerId, assistText ? lp.fromId : null], team);
    },

    onBlock(blockerId, shooterId) {
        this.addStat(blockerId, 'blk');
        this.logPlay(`${this.nameOf(blockerId)} contre ${shooterId ? this.nameOf(shooterId) : 'le tir'}`,
            [blockerId, shooterId], this.entities.get(blockerId)?.team);
    },

    onScreenSuccess(screener, defender) {
        this.addStat(screener.id, 'scr');
        this.logPlay(`Écran de ${screener.profile.playerName} sur ${defender.profile.playerName}`,
            [screener.id, defender.id], screener.team);
    },

    onShotClockViolation(team, holderId) {
        this.addStat(holderId, 'tov');
        this.logPlay(`24 secondes : balle perdue par l'équipe ${team}`, [holderId], team);
    },

    /** Feuille compacte pour les invités (envoyée avec l'état du monde à la fin du match) */
    buildSheetPacket() {
        return { stats: this.matchSheet.stats, log: this.matchSheet.log };
    },

    applySheetPacket(sheet) {
        this.matchSheet = { stats: sheet.stats || {}, log: sheet.log || [] };
        if (!document.getElementById('match-end-overlay')?.classList.contains('hidden')) this.renderMatchSheet();
    },

    /** Remplit les deux onglets de la feuille de match dans l'écran de fin */
    renderMatchSheet() {
        const table = document.getElementById('sheet-stats');
        const logEl = document.getElementById('sheet-log');
        if (!table || !logEl) return;
        const myId = this.localPlayerId;
        const esc = (t) => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

        const rows = [];
        for (const team of ['A', 'B']) {
            const score = team === 'A' ? this.matchRules.scoreA : this.matchRules.scoreB;
            rows.push(`<tr class="sheet-team team-${team.toLowerCase()}"><th colspan="11">ÉQUIPE ${team} — ${score} pts</th></tr>`);
            const players = [...this.entities.values()].filter(e => e.team === team);
            players.sort((a, b) => (this.matchSheet.stats[b.id]?.pts || 0) - (this.matchSheet.stats[a.id]?.pts || 0));
            for (const ent of players) {
                const s = this.matchSheet.stats[ent.id] || EMPTY();
                rows.push(`<tr class="${ent.id === myId ? 'me' : ''}">
                    <td class="sheet-name">${esc(ent.profile.playerName)}${ent.id === myId ? ' (toi)' : ''}</td>
                    <td class="sheet-pts">${s.pts}</td>
                    <td>${s.fgm2}/${s.fga2}</td><td>${s.fgm3}/${s.fga3}</td><td>${s.dunkM}/${s.dunkA}</td>
                    <td>${s.orb + s.drb} <small>(${s.orb}/${s.drb})</small></td>
                    <td>${s.ast}</td><td>${s.stl}</td><td>${s.blk}</td><td>${s.scr}</td><td>${s.tov}</td></tr>`);
            }
        }
        table.innerHTML = `<thead><tr><th>Joueur</th><th title="Points">PTS</th><th title="Tirs à 2 pts réussis / tentés">2 PTS</th>
            <th title="Tirs à 3 pts réussis / tentés">3 PTS</th><th title="Dunks réussis / tentés">DUNKS</th>
            <th title="Rebonds (offensifs / défensifs)">REB</th><th title="Passes décisives">PD</th>
            <th title="Interceptions">INT</th><th title="Contres">CTR</th><th title="Écrans réussis">ÉCR</th>
            <th title="Balles perdues">BP</th></tr></thead><tbody>${rows.join('')}</tbody>`;

        const mine = this.sheetFilterMine;
        const entries = this.matchSheet.log.filter(e => !mine || e.ids.includes(myId));
        logEl.innerHTML = entries.length
            ? entries.map(e => `<li class="${e.ids.includes(myId) ? 'me' : ''} team-${(e.team || '').toLowerCase()}">
                <span class="sheet-time">${esc(e.t)}</span>${esc(e.text)}</li>`).join('')
            : `<li class="sheet-empty">${mine ? 'Aucune action de ton joueur.' : 'Aucune action.'}</li>`;
    }
};
