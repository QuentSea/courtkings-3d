/**
 * Practice.js — Modes en solo, lancés depuis le salon (sans réseau) :
 * - Entraînement : seul sur le demi-terrain, sans chrono ; le ballon revient après chaque tir ; compteur de réussite
 *   à 2 et 3 points, tirs « green », série.
 * - Concours à 3 points : 70 s, 5 emplacements de 5 ballons autour de l'arc ; le 5e ballon de chaque emplacement
 *   vaut 2 points ; record gardé dans la carrière (Career.js).
 * Le joueur est replacé à son emplacement à chaque ballon (concours). Méthodes ajoutées au prototype de GameEngine
 * (voir la fin de GameEngine.js) : `this` est le moteur.
 */

import * as THREE from 'three';
import { recordBest, loadCareer } from '../progress/Career.js';

// Emplacements du concours (x, distance au cercle vers le terrain) : coins, ailes, haut, derrière l'arc
const RACKS = [[-6.0, 0.9], [-4.8, 4.5], [0, 6.6], [4.8, 4.5], [6.0, 0.9]];
const BALLS_PER_RACK = 5;
const CONTEST_TIME = 70;

export const PracticeMethods = {
    /** Lance l'entraînement ('training') ou le concours ('contest3') avec le joueur local seul */
    startPractice(kind, localPeerId, profile) {
        this.startMatch({
            mode: kind,
            fillWithBots: false,
            players: { [localPeerId]: { peerId: localPeerId, team: 'A', profile } }
        }, localPeerId);
        this.practice = {
            kind,
            made2: 0, att2: 0, made3: 0, att3: 0, greens: 0, streak: 0, best: 0,
            returnIn: 0, // > 0 : ballon redonné dans returnIn secondes
            // Concours
            time: CONTEST_TIME, rack: 0, ball: 0, score: 0, started: false, timeUp: false, over: false
        };
        document.getElementById('practice-result')?.classList.add('hidden');
        if (kind === 'contest3') this.givePracticeBall(this.getLocalEntity()); // 1er emplacement, le chrono part
        this.showRuleAlert(kind === 'contest3'
            ? '🏀 CONCOURS : 70 SECONDES, LE 5E BALLON VAUT 2 POINTS !'
            : '🎯 ENTRAÎNEMENT : TIRE D\'OÙ TU VEUX, LE BALLON REVIENT', false);
        this.renderPracticeHud();
    },

    /** Tir arrivé au cercle en mode solo (Ball.js) : compter, faire tomber le ballon, le redonner */
    practiceShot(outcome) {
        const p = this.practice;
        this.ball.pendingShotOutcome = null;
        this.ball.state = 'LOOSE';
        if (outcome.isMake) {
            this.ball.pos.copy(this.ball.flightTarget).add(new THREE.Vector3(0, -0.2, 0));
            this.ball.vel.set(0, -3.5, 0);
        } else {
            this.ball.vel.set((Math.random() - 0.5) * 3, 3, (this.ball.pos.z < 0 ? 1 : -1) * 2);
        }
        if (p.kind === 'contest3') {
            const money = p.ball === BALLS_PER_RACK - 1;
            if (outcome.isMake && outcome.isThreePointer) p.score += money ? 2 : 1;
            p.ball++;
            if (p.ball >= BALLS_PER_RACK) {
                p.ball = 0;
                p.rack++;
            }
            if (p.rack >= RACKS.length || p.timeUp) {
                this.endContest();
                return;
            }
            p.returnIn = outcome.isMake ? 0.35 : 0.25;
        } else {
            this.countPracticeShot(outcome.isThreePointer, outcome.isMake, outcome.isGreen);
            p.returnIn = outcome.isMake ? 0.7 : 1.1;
        }
        this.renderPracticeHud();
    },

    /** Dunk en entraînement (Ball.js) : un panier à 2 points, puis le ballon revient */
    practiceDunk(isMake, hoop) {
        this.ball.holderId = null;
        this.ball.state = 'LOOSE';
        this.ball.pos.copy(hoop.rimPos).add(new THREE.Vector3(0, isMake ? -0.15 : 0.25, 0));
        this.ball.vel.set(0, isMake ? -6 : 3, 0);
        if (this.practice.kind === 'training') this.countPracticeShot(false, isMake, false);
        this.practice.returnIn = 0.8;
        this.renderPracticeHud();
    },

    countPracticeShot(three, made, green) {
        const p = this.practice;
        if (three) {
            p.att3++;
            if (made) p.made3++;
        } else {
            p.att2++;
            if (made) p.made2++;
        }
        if (green && made) p.greens++;
        p.streak = made ? p.streak + 1 : 0;
        p.best = Math.max(p.best, p.streak);
    },

    /** À chaque image en mode solo : ballon redonné, chrono du concours, affichage */
    updatePractice(dt) {
        const p = this.practice;
        if (!p || !this.currentMode.practice || p.over) return;
        const me = this.getLocalEntity();
        if (!me) return;
        if (p.returnIn > 0) {
            p.returnIn -= dt;
            if (p.returnIn <= 0 && this.ball.holderId !== me.id && this.ball.state !== 'SHOT') this.givePracticeBall(me);
        }
        if (p.kind !== 'contest3' || !p.started) return;
        p.time = Math.max(0, p.time - dt);
        if (p.time <= 0 && !p.timeUp) {
            p.timeUp = true;
            this.playSound('buzzer');
            // Un tir parti avant la sirène compte encore
            if (this.ball.state !== 'SHOT') this.endContest();
        }
        if (Math.floor(p.time * 10) !== this.lastPracticeTenth) {
            this.lastPracticeTenth = Math.floor(p.time * 10);
            this.renderPracticeHud();
        }
    },

    /** Ballon au joueur ; concours : à son emplacement, face au panier */
    givePracticeBall(me) {
        const p = this.practice;
        if (p.kind === 'contest3') {
            const hoop = this.getAttackingHoopForTeam(me.team);
            const out = hoop.side === 'NORTH' ? 1 : -1;
            const [x, z] = RACKS[p.rack];
            me.pos.set(hoop.rimPos.x + x, 0, hoop.rimPos.z + out * z);
            me.rotY = Math.atan2(hoop.rimPos.x - me.pos.x, hoop.rimPos.z - me.pos.z);
            p.started = true;
        }
        this.inCheckBall = true; // pas une action de la feuille de match
        this.giveBallTo(me.id, false);
        this.inCheckBall = false;
        me.state = 'DRIBBLE';
    },

    endContest() {
        const p = this.practice;
        p.over = true;
        this.matchRules.matchOver = true; // plus de commandes ; Rejouer ou Salon
        const previous = loadCareer().records.contest3 || 0;
        const record = recordBest('contest3', p.score);
        this.playSound(record ? 'cheer' : 'whistle');
        if (record) this.launchConfetti('A');
        const el = document.getElementById('practice-result');
        if (el) {
            document.getElementById('practice-result-score').textContent = `${p.score} point${p.score > 1 ? 's' : ''}`;
            document.getElementById('practice-result-text').textContent = record
                ? `🏆 NOUVEAU RECORD !${previous ? ` (avant : ${previous})` : ''}`
                : `Ton record : ${previous} point${previous > 1 ? 's' : ''}`;
            el.classList.remove('hidden');
        }
        this.renderPracticeHud();
    },

    /** Bandeau du mode solo (sous le haut de l'écran) */
    renderPracticeHud() {
        const el = document.getElementById('practice-hud');
        const p = this.practice;
        if (!el || !p) return;
        if (p.kind === 'contest3' && p.over) {
            el.textContent = `🏀 CONCOURS TERMINÉ — Score ${p.score} · Record ${loadCareer().records.contest3 || 0}`;
        } else if (p.kind === 'contest3') {
            const rack = Math.min(p.rack + 1, RACKS.length);
            const money = p.ball === BALLS_PER_RACK - 1 ? ' 💰 vaut 2 points' : '';
            el.textContent = `🏀 CONCOURS À 3 POINTS — ${Math.ceil(p.time)} s · Emplacement ${rack}/5 · ` +
                `Ballon ${p.ball + 1}/5${money} · Score ${p.score} · Record ${loadCareer().records.contest3 || 0}`;
        } else {
            const pct = (m, a) => (a ? ` (${Math.round((100 * m) / a)} %)` : '');
            el.textContent = `🎯 ENTRAÎNEMENT — 2 pts : ${p.made2}/${p.att2}${pct(p.made2, p.att2)} · ` +
                `3 pts : ${p.made3}/${p.att3}${pct(p.made3, p.att3)} · Green : ${p.greens} · ` +
                `Série : ${p.streak} (meilleure ${p.best})`;
        }
    }
};
