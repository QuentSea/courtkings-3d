/**
 * Tournament.js — Tournoi contre les bots, en solo (sans réseau) :
 * - 8 équipes (la tienne + 7 équipes de bots), quarts, demies, finale ; format du salon (3v3, 4v4 ou 5v5) ;
 * - tes adversaires montent d'un niveau à chaque tour, en partant du niveau choisi dans le salon ;
 * - les autres matchs se jouent tout seuls (la meilleure équipe gagne plus souvent) ;
 * - gardé dans le navigateur (clé `courtkings_tournoi`) ; un titre compte dans les records (Career.js).
 */

import { DIFFICULTY } from '../config/constants.js';
import { addToRecord } from './Career.js';

const STORAGE_KEY = 'courtkings_tournoi';
const BOT_TEAMS = ['Street Kings', 'Les Requins', 'Night Owls', 'Les Volcans', 'Golden Hawks', 'Les Titans', 'Blue Storm'];
const ROUNDS = ['Quart de finale', 'Demi-finale', 'Finale'];
const PLAY_LABELS = ['Jouer le quart de finale', 'Jouer la demi-finale', 'Jouer la finale'];
const LEVELS = Object.keys(DIFFICULTY); // FACILE, NORMAL, DIFFICILE, LEGENDE
export const MY_TEAM = 'Ton équipe';

export class Tournament {
    /** onPlay(opponentName, difficultyKey, mode) : lance ton prochain match (main.js) */
    constructor(onPlay) {
        this.onPlay = onPlay;
        this.state = this.load();
        this.overlay = document.getElementById('tournament-overlay');
        document.getElementById('btn-tournament-play')?.addEventListener('click', () => this.playNext());
        // Nouveau tableau tout de suite, au format et au niveau du salon
        document.getElementById('btn-tournament-new')?.addEventListener('click', () => {
            this.create(this.mode, this.difficulty);
            this.render();
        });
        document.getElementById('btn-tournament-close')?.addEventListener('click', () => this.close());
    }

    load() {
        try {
            return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
        } catch {
            return null;
        }
    }

    save() {
        try {
            if (this.state) localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
            else localStorage.removeItem(STORAGE_KEY);
        } catch { /* pas de sauvegarde : le tournoi tient jusqu'à la fermeture */ }
    }

    /** Nouveau tableau : ta place est tirée au sort, les équipes de bots ont une force entre 70 et 90 */
    create(mode, difficulty) {
        const teams = [{ name: MY_TEAM, rating: 80, me: true },
            ...BOT_TEAMS.map(name => ({ name, rating: 70 + Math.round(Math.random() * 20) }))];
        for (let i = teams.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [teams[i], teams[j]] = [teams[j], teams[i]];
        }
        const pairs = [];
        for (let i = 0; i < teams.length; i += 2) pairs.push({ a: teams[i], b: teams[i + 1], winner: null, score: '' });
        this.state = { mode, base: LEVELS.includes(difficulty) ? difficulty : 'NORMAL', rounds: [pairs], status: 'playing' };
        this.save();
    }

    /** Fenêtre du tournoi ; sans tournoi en cours, un nouveau tableau au format et au niveau du salon */
    open(mode, difficulty) {
        this.mode = mode;
        this.difficulty = difficulty;
        if (!this.state) this.create(mode, difficulty);
        this.render();
        this.overlay?.classList.remove('hidden');
    }

    close() {
        this.overlay?.classList.add('hidden');
    }

    /** Ton match du tour en cours (null si tu es éliminé ou champion) */
    myMatch() {
        const s = this.state;
        if (!s || s.status !== 'playing') return null;
        return s.rounds[s.rounds.length - 1].find(p => (p.a.me || p.b.me) && !p.winner) || null;
    }

    /** Niveau de ton adversaire : celui du salon au premier tour, puis un cran de plus à chaque tour */
    levelForRound(round) {
        return LEVELS[Math.min(LEVELS.length - 1, LEVELS.indexOf(this.state.base) + round)];
    }

    playNext() {
        const match = this.myMatch();
        if (!match) return;
        const opponent = match.a.me ? match.b : match.a;
        this.close();
        this.onPlay(opponent.name, this.levelForRound(this.state.rounds.length - 1), this.state.mode);
    }

    /** Fin de ton match (Clock.js) : résultat, autres matchs du tour, tour suivant ou fin du tournoi */
    recordMyResult(won, mine, theirs) {
        const match = this.myMatch();
        if (!match) return;
        const me = match.a.me ? match.a : match.b;
        const opp = match.a.me ? match.b : match.a;
        match.winner = won ? me : opp;
        match.score = match.a.me ? `${mine}-${theirs}` : `${theirs}-${mine}`;
        const round = this.state.rounds[this.state.rounds.length - 1];
        for (const p of round) if (!p.winner) this.simulate(p);
        if (!won) {
            this.state.status = 'out';
        } else if (round.length === 1) {
            this.state.status = 'champion';
            addToRecord('tournaments');
        } else {
            const next = [];
            for (let i = 0; i < round.length; i += 2) next.push({ a: round[i].winner, b: round[i + 1].winner, winner: null, score: '' });
            this.state.rounds.push(next);
        }
        this.save();
    }

    /** Match entre deux équipes de bots : la plus forte gagne plus souvent ; score du format 21 points */
    simulate(p) {
        const chanceA = 1 / (1 + Math.exp((p.b.rating - p.a.rating) / 8));
        const aWins = Math.random() < chanceA;
        p.winner = aWins ? p.a : p.b;
        const lose = 10 + Math.floor(Math.random() * 10);
        p.score = aWins ? `21-${lose}` : `${lose}-21`;
    }

    /** Fenêtre du tournoi : état, tableau des trois tours, bouton du prochain match */
    render() {
        const s = this.state;
        const status = document.getElementById('tournament-status');
        const bracket = document.getElementById('tournament-bracket');
        const play = document.getElementById('btn-tournament-play');
        if (!status || !bracket || !play) return;
        const match = this.myMatch();
        if (!s) {
            status.textContent = 'Pas de tournoi en cours.';
        } else if (s.status === 'champion') {
            status.textContent = '🏆 CHAMPION ! Tu as gagné le tournoi.';
        } else if (s.status === 'out') {
            status.textContent = `Éliminé en ${ROUNDS[s.rounds.length - 1].toLowerCase()}. Lance un nouveau tournoi pour retenter ta chance.`;
        } else {
            const opponent = match.a.me ? match.b : match.a;
            const level = DIFFICULTY[this.levelForRound(s.rounds.length - 1)].label;
            status.textContent = `${ROUNDS[s.rounds.length - 1]} contre ${opponent.name} (bots : ${level}) — format ${s.mode}.`;
        }
        play.classList.toggle('hidden', !match);
        play.textContent = match ? PLAY_LABELS[s.rounds.length - 1] : '';

        // Colonnes des tours : noms et scores écrits comme du texte
        const columns = ROUNDS.map((title, r) => {
            const col = document.createElement('div');
            col.className = 'tournament-round';
            const h = document.createElement('h3');
            h.textContent = title;
            col.appendChild(h);
            const pairs = s?.rounds[r] || [];
            for (let i = 0; i < (4 >> r); i++) {
                const p = pairs[i];
                const box = document.createElement('div');
                box.className = 'tournament-match';
                for (const side of ['a', 'b']) {
                    const team = p?.[side];
                    const row = document.createElement('div');
                    row.className = 'tournament-team' + (team?.me ? ' me' : '') + (p?.winner && p.winner === team ? ' won' : '') +
                        (p?.winner && p.winner !== team ? ' lost' : '');
                    row.textContent = team ? team.name : '…';
                    box.appendChild(row);
                }
                if (p?.score) {
                    const sc = document.createElement('div');
                    sc.className = 'tournament-score';
                    sc.textContent = p.score;
                    box.appendChild(sc);
                }
                col.appendChild(box);
            }
            return col;
        });
        bracket.replaceChildren(...columns);
    }
}
