/**
 * Fatigue.js — Fatigue et remplacements, en 5 contre 5 (tout-terrain) seulement :
 * - énergie de 0 à 100 : elle baisse en courant, en sprintant et à chaque saut, remonte en soufflant (à l'arrêt) et
 *   plus vite pendant les arrêts de jeu ; fatigué (sous 60), un joueur court jusqu'à 14 % moins vite, et sous 50 il
 *   tire moins bien (jusqu'à 7 % de réussite en moins pour un bot, jauge plus dure pour un humain) ;
 * - chaque équipe de bots a 2 remplaçants : à une remise en jeu, un bot sous 40 d'énergie sort pour le plus reposé
 *   du banc (au-dessus de 75) ; le banc récupère. Les humains ne sont jamais remplacés ;
 * - l'énergie de chacun est calculée là où il est joué (hôte : bots et joueur de l'hôte ; invité : son joueur),
 *   les changements de joueurs partent chez les invités (événement SUB) ;
 * - barre d'énergie du joueur local en bas de l'écran.
 * Méthodes ajoutées au prototype de GameEngine (voir la fin de GameEngine.js) : `this` est le moteur.
 */

import { CHARACTER_PRESETS } from '../config/constants.js';

const BENCH_SIZE = 2;
// Remplaçants : allure et atouts d'un modèle, mais leur propre nom et numéro (pas deux fois le même joueur)
const BENCH_NAMES = ['Rocket', 'Blaze', 'Viper', 'Ghost', 'Tank', 'Ace'];
const TIRED = 60;      // sous ce niveau, il court moins vite
const SHOT_TIRED = 50; // sous ce niveau, il tire moins bien
const SUB_OUT = 40;    // un bot sort sous ce niveau
const SUB_IN = 75;     // un remplaçant entre au-dessus de ce niveau

export const FatigueMethods = {
    /** Fatigue et remplacements : seulement en 5 contre 5 tout-terrain (pas en demi-terrain ni en solo) */
    fatigueOn() {
        return !this.currentMode.isHalfCourt && !this.currentMode.practice;
    },

    /** Début de match : tout le monde à 100 ; banc de 2 bots pour chaque équipe qui a des bots (5v5) */
    resetFatigue(presetCursor) {
        this.bench = { A: [], B: [] };
        for (const ent of this.entities.values()) {
            ent.energy = 100;
            ent.wasInAir = false;
        }
        if (!this.fatigueOn()) return;
        let n = 0;
        for (const team of ['A', 'B']) {
            if (![...this.entities.values()].some(e => e.team === team && e.isBot)) continue;
            for (let i = 0; i < BENCH_SIZE; i++, n++) {
                const profile = structuredClone(CHARACTER_PRESETS[presetCursor++ % CHARACTER_PRESETS.length]);
                profile.playerName = `[IA] ${BENCH_NAMES[n % BENCH_NAMES.length]}`;
                profile.jerseyNumber = String(30 + n);
                this.bench[team].push({ id: `bench_${team}_${i}`, team, profile, energy: 100 });
            }
        }
        this.lastEnergyShown = null;
        this.renderEnergyHud();
    },

    /** À chaque image : énergie des joueurs calculés ici, et récupération du banc (hôte) */
    updateFatigue(dt) {
        if (!this.fatigueOn()) return;
        const stopped = this.matchRules.deadBall || !!this.matchRules.freeThrow;
        for (const ent of this.entities.values()) {
            if (!(ent.isLocal || (this.isAuthority && ent.isBot))) continue;
            const inAir = ent.pos.y > 0.05;
            // Par seconde : on se fatigue plus vite qu'on ne récupère (sinon personne n'est jamais fatigué)
            let delta;
            // Réglé pour qu'un bot titulaire tienne 1 min 30 à 2 min de jeu avant d'être remplacé (un match à
            // 30 points dure souvent 2 à 5 minutes de jeu)
            if (stopped) delta = 2;                       // arrêt de jeu : on souffle
            else if (ent.mesh.speed > 5.2) delta = -2.6;  // sprint
            else if (ent.mesh.speed > 3.2) delta = -1.8;  // course
            else if (ent.mesh.speed > 1) delta = -0.5;
            else delta = 1;
            ent.energy = Math.max(0, Math.min(100, (ent.energy ?? 100) + delta * dt - (inAir && !ent.wasInAir ? 2.5 : 0)));
            ent.wasInAir = inAir;
        }
        if (this.isAuthority) {
            for (const b of [...this.bench.A, ...this.bench.B]) b.energy = Math.min(100, b.energy + 4 * dt);
        }
        this.renderEnergyHud();
    },

    /** Vitesse en plus ou en moins selon l'énergie (1 = en forme) */
    fatigueSpeed(ent) {
        if (!this.fatigueOn() || !(ent.energy < TIRED)) return 1;
        return 0.86 + 0.14 * (ent.energy / TIRED);
    },

    /** Réussite en moins pour un tir (0 à 0,07) */
    fatigueShot(ent) {
        if (!this.fatigueOn() || !(ent.energy < SHOT_TIRED)) return 0;
        return ((SHOT_TIRED - ent.energy) / SHOT_TIRED) * 0.07;
    },

    /**
     * Remise en jeu (hôte, Rules.js) : les bots épuisés sortent pour le remplaçant le plus reposé. Le joueur garde
     * sa place (même identifiant) : on échange profil, énergie et feuille de match avec le banc
     */
    makeSubstitutions() {
        if (!this.isAuthority || !this.fatigueOn()) return;
        for (const team of ['A', 'B']) {
            const tired = [...this.entities.values()]
                .filter(e => e.team === team && e.isBot && e.energy < SUB_OUT)
                .sort((a, b) => a.energy - b.energy);
            for (const ent of tired) {
                const fresh = this.bench[team].filter(b => b.energy > SUB_IN).sort((a, b) => b.energy - a.energy)[0];
                if (!fresh) break;
                this.swapWithBench(ent, fresh);
                // Les invités ont le même banc (mêmes profils, tirés dans le même ordre) : les identifiants suffisent
                if (!this.offline) this.network.sendGameEvent('SUB', { id: ent.id, benchId: fresh.id });
            }
        }
    },

    /** Échange un joueur du terrain et un remplaçant (aussi chez les invités, NetSync.js) */
    swapWithBench(ent, bench) {
        const outName = ent.profile.playerName;
        [ent.profile, bench.profile] = [bench.profile, ent.profile];
        [ent.energy, bench.energy] = [bench.energy ?? 100, ent.energy ?? 0];
        const stats = this.matchSheet.stats;
        [stats[ent.id], stats[bench.id]] = [stats[bench.id], stats[ent.id]];
        if (!stats[ent.id]) delete stats[ent.id];
        if (!stats[bench.id]) delete stats[bench.id];
        ent.mesh.updateConfig({ ...ent.profile, team: ent.team });
        this.showRuleAlert(`🔄 CHANGEMENT : ${ent.profile.playerName} remplace ${outName}`, false);
    },

    /** Barre d'énergie du joueur local (5v5) */
    renderEnergyHud() {
        const el = document.getElementById('energy-hud');
        const me = this.getLocalEntity();
        if (!el) return;
        const show = this.fatigueOn() && !!me;
        el.classList.toggle('hidden', !show);
        if (!show) return;
        const value = Math.round(me.energy ?? 100);
        if (value === this.lastEnergyShown) return;
        this.lastEnergyShown = value;
        const fill = document.getElementById('energy-fill');
        fill.style.width = `${value}%`;
        fill.className = `energy-fill ${value < SUB_OUT ? 'low' : value < TIRED ? 'mid' : ''}`;
        document.getElementById('energy-text').textContent = `Énergie ${value}`;
    }
};
