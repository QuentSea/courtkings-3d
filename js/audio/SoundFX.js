/**
 * SoundFX.js — Sons du jeu fabriqués par le navigateur (Web Audio), sans aucun fichier : dribble, filet, cercle,
 * planche, sifflet, sirène, foule (bruit de fond qui monte après une belle action).
 * - Le navigateur n'autorise le son qu'après un clic ou une touche : il démarre à ce moment-là.
 * - play(nom, position) : plus fort près de la caméra, à gauche ou à droite selon l'écran.
 * - Son coupé ou non : gardé dans le navigateur (clé `courtkings_son`).
 */

const STORAGE_KEY = 'courtkings_son';
const _v = { x: 0, y: 0, z: 0 };

export class SoundFX {
    constructor() {
        this.ctx = null;
        this.muted = false;
        try {
            this.muted = localStorage.getItem(STORAGE_KEY) === 'off';
        } catch { /* données du site bloquées : son allumé */ }
        const unlock = () => this.unlock();
        window.addEventListener('pointerdown', unlock);
        window.addEventListener('keydown', unlock);
    }

    /** Crée le moteur audio au premier geste du joueur (ou le relance s'il a été suspendu) */
    unlock() {
        if (this.ctx) {
            if (this.ctx.state === 'suspended') this.ctx.resume();
            return;
        }
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        this.ctx = new Ctx();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.8;
        const limiter = this.ctx.createDynamicsCompressor(); // plusieurs sons en même temps ne saturent pas
        this.master.connect(limiter).connect(this.ctx.destination);

        // Bruit blanc réutilisé par tous les sons « de souffle » (filet, foule, sneakers)
        const len = this.ctx.sampleRate * 2;
        this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const data = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

        // Foule : murmure continu (bruit filtré) dont le volume monte après les belles actions
        const crowd = this.ctx.createBufferSource();
        crowd.buffer = this.noise;
        crowd.loop = true;
        const band = this.ctx.createBiquadFilter();
        band.type = 'bandpass';
        band.frequency.value = 650;
        band.Q.value = 0.6;
        this.crowdGain = this.ctx.createGain();
        this.crowdGain.gain.value = 0;
        crowd.connect(band).connect(this.crowdGain).connect(this.master);
        crowd.start();
    }

    setMuted(muted) {
        this.muted = muted;
        try {
            localStorage.setItem(STORAGE_KEY, muted ? 'off' : 'on');
        } catch { /* pas de sauvegarde : le réglage tient jusqu'à la fermeture */ }
        if (this.master) this.master.gain.setTargetAtTime(muted ? 0 : 0.8, this.ctx.currentTime, 0.05);
    }

    /** Murmure de la foule pendant un match (0 hors match) */
    setCrowd(level) {
        if (!this.crowdGain) return;
        this.crowdGain.gain.setTargetAtTime(level * 0.05, this.ctx.currentTime, 0.4);
    }

    /**
     * Joue un son. position : endroit du terrain (THREE.Vector3 ou {x, y, z}), camera : pour le volume et la
     * gauche/droite ; sans position, le son est au centre
     */
    play(name, position = null, camera = null) {
        if (!this.ctx || this.muted || this.ctx.state !== 'running') return;
        let gain = 1;
        let pan = 0;
        if (position && camera) {
            camera.updateMatrixWorld();
            const e = camera.matrixWorldInverse.elements;
            const { x, y, z } = position;
            _v.x = e[0] * x + e[4] * y + e[8] * z + e[12];
            _v.z = e[2] * x + e[6] * y + e[10] * z + e[14];
            const dist = Math.hypot(_v.x, _v.z);
            gain = 1 / (1 + Math.max(0, dist - 6) / 9);
            pan = Math.max(-0.8, Math.min(0.8, _v.x / Math.max(3, Math.abs(_v.z))));
        }
        const out = this.ctx.createGain();
        out.gain.value = gain;
        const panner = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
        if (panner) {
            panner.pan.value = pan;
            out.connect(panner).connect(this.master);
        } else {
            out.connect(this.master);
        }
        const recipe = RECIPES[name];
        if (recipe) recipe(this, out, this.ctx.currentTime);
    }

    // ---------------------------------------------------------------- Briques de base

    /**
     * Oscillateur avec enveloppe : fréquence de départ → fin, volume qui monte en `attack`, tient `hold`, puis
     * s'éteint en `decay`
     */
    tone(out, t, { type = 'sine', from, to = from, level, attack = 0.005, hold = 0, decay, delay = 0 }) {
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        osc.type = type;
        const t0 = t + delay;
        osc.frequency.setValueAtTime(from, t0);
        if (to !== from) osc.frequency.exponentialRampToValueAtTime(to, t0 + decay);
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(level, t0 + attack);
        g.gain.setValueAtTime(level, t0 + attack + hold);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + hold + decay);
        osc.connect(g).connect(out);
        osc.start(t0);
        osc.stop(t0 + attack + hold + decay + 0.05);
        return osc;
    }

    /** Bruit filtré avec enveloppe (souffle, frottement, foule) */
    hiss(out, t, { type = 'bandpass', freq, toFreq = freq, q = 1, level, attack = 0.01, decay, delay = 0 }) {
        const src = this.ctx.createBufferSource();
        src.buffer = this.noise;
        const f = this.ctx.createBiquadFilter();
        f.type = type;
        f.Q.value = q;
        const g = this.ctx.createGain();
        const t0 = t + delay;
        f.frequency.setValueAtTime(freq, t0);
        if (toFreq !== freq) f.frequency.exponentialRampToValueAtTime(toFreq, t0 + attack + decay);
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(level, t0 + attack);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
        src.connect(f).connect(g).connect(out);
        src.start(t0, Math.random());
        src.stop(t0 + attack + decay + 0.05);
    }

    /** La foule réagit : murmure plus fort pendant ~2 s */
    excite(amount) {
        if (!this.crowdGain) return;
        const now = this.ctx.currentTime;
        const g = this.crowdGain.gain;
        g.cancelScheduledValues(now);
        g.setValueAtTime(g.value, now);
        g.linearRampToValueAtTime(0.05 + amount * 0.12, now + 0.25);
        g.setTargetAtTime(0.05, now + 1.2, 0.8);
    }
}

// Recettes des sons (fréquences et durées réglées à l'oreille)
const RECIPES = {
    // Rebond du ballon sur le parquet : « boum » grave et court + petit claquement
    dribble(s, out, t) {
        s.tone(out, t, { from: 140, to: 55, level: 0.55, decay: 0.11 });
        s.hiss(out, t, { type: 'lowpass', freq: 1200, level: 0.12, attack: 0.002, decay: 0.03 });
    },
    // Ballon dans le filet : « chhh » qui monte
    swish(s, out, t) {
        s.hiss(out, t, { freq: 2600, toFreq: 5200, q: 0.7, level: 0.7, attack: 0.03, decay: 0.32 });
    },
    // Cercle touché : son métallique (fréquences qui ne sont pas des harmoniques)
    rim(s, out, t) {
        for (const [f, l] of [[520, 0.22], [1137, 0.14], [1890, 0.09], [2710, 0.05]]) {
            s.tone(out, t, { type: 'triangle', from: f, level: l, attack: 0.002, decay: 0.55 });
        }
        s.hiss(out, t, { type: 'highpass', freq: 2500, level: 0.1, attack: 0.002, decay: 0.05 });
    },
    // Planche : coup sourd
    board(s, out, t) {
        s.tone(out, t, { from: 110, to: 70, level: 0.4, decay: 0.18 });
        s.hiss(out, t, { type: 'lowpass', freq: 500, level: 0.25, attack: 0.002, decay: 0.12 });
    },
    // Dunk : cercle secoué, planche, foule qui explose
    dunk(s, out, t) {
        RECIPES.rim(s, out, t);
        RECIPES.board(s, out, t + 0.02);
        RECIPES.cheer(s, out, t + 0.1);
    },
    // Contre : claque sur le ballon + « oooh » de la foule
    block(s, out, t) {
        s.tone(out, t, { from: 220, to: 90, level: 0.45, decay: 0.12 });
        s.hiss(out, t, { type: 'lowpass', freq: 900, level: 0.3, attack: 0.002, decay: 0.08 });
        RECIPES.ooh(s, out, t + 0.12);
    },
    // Sifflet de l'arbitre : deux notes aiguës qui battent ensemble, avec un trille
    whistle(s, out, t) {
        for (const f of [2900, 3080]) {
            const osc = s.tone(out, t, { from: f, level: 0.13, attack: 0.02, hold: 0.3, decay: 0.12 });
            const lfo = s.ctx.createOscillator();
            const depth = s.ctx.createGain();
            lfo.frequency.value = 28;
            depth.gain.value = 60;
            lfo.connect(depth).connect(osc.frequency);
            lfo.start(t);
            lfo.stop(t + 0.5);
        }
    },
    // Sirène de fin (24 s, mi-temps, fin du match)
    buzzer(s, out, t) {
        for (const f of [196, 392, 588]) {
            s.tone(out, t, { type: 'sawtooth', from: f, level: 0.12, attack: 0.03, hold: 0.85, decay: 0.15 });
        }
    },
    // Foule qui applaudit (panier à 3 points, dunk, victoire)
    cheer(s, out, t) {
        s.hiss(out, t, { freq: 1400, toFreq: 1100, q: 0.5, level: 0.5, attack: 0.25, decay: 1.6 });
        s.excite(1);
    },
    // Foule surprise (contre, interception)
    ooh(s, out, t) {
        s.hiss(out, t, { freq: 380, toFreq: 700, q: 2.5, level: 0.9, attack: 0.15, decay: 0.7 });
        s.excite(0.5);
    },
    // Crissement de chaussures (crossover, changement de direction)
    squeak(s, out, t) {
        s.tone(out, t, { from: 1900, to: 2700, level: 0.1, attack: 0.01, decay: 0.07 });
        s.hiss(out, t, { freq: 2400, q: 8, level: 0.25, attack: 0.005, decay: 0.06 });
    },
    // Passe : petit souffle
    pass(s, out, t) {
        s.hiss(out, t, { freq: 900, toFreq: 1600, q: 1.2, level: 0.25, attack: 0.02, decay: 0.12 });
    },
    // Interception : chaussures + foule surprise
    steal(s, out, t) {
        RECIPES.squeak(s, out, t);
        RECIPES.ooh(s, out, t + 0.05);
    }
};
