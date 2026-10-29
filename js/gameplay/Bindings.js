/**
 * Bindings.js — Touches réglables (clavier et manette) et fenêtre « Touches ».
 * - Chaque action a 2 touches clavier (codes physiques `KeyboardEvent.code`) et 2 boutons de manette
 *   (numéros de la disposition standard de l'API Gamepad). Une même touche peut servir à plusieurs actions :
 *   la première qui a du sens dans la situation est jouée (voir `ACTION_ORDER` et Controls.js).
 * - Gardées dans le navigateur (`localStorage`, clé `courtkings_touches`) ; « Touches par défaut » les remet.
 * - Les sticks de la manette ne se règlent pas : gauche = bouger, droit = viser la passe.
 */

const STORAGE_KEY = 'courtkings_touches';

// id, nom affiché, touches clavier et boutons manette par défaut
export const ACTIONS = [
    { id: 'up', label: 'Haut (déplacement)', keys: ['KeyW', 'ArrowUp'], pad: [12, null] },
    { id: 'down', label: 'Bas (déplacement)', keys: ['KeyS', 'ArrowDown'], pad: [13, null] },
    { id: 'left', label: 'Gauche (déplacement)', keys: ['KeyA', 'ArrowLeft'], pad: [14, null] },
    { id: 'right', label: 'Droite (déplacement)', keys: ['KeyD', 'ArrowRight'], pad: [15, null] },
    { id: 'shoot', label: 'Tirer (maintenir) · près du cercle : lay-up · en défense : contrer', keys: ['Space', null], pad: [2, null] },
    { id: 'pass', label: 'Passer au joueur visé / demander la balle', keys: ['KeyE', null], pad: [0, null] },
    { id: 'alleyoop', label: 'Alley-oop (avec ballon : lob ; sans : le demander)', keys: ['KeyT', null], pad: [3, null] },
    { id: 'jump', label: 'Sauter / contrer / rebond', keys: ['KeyR', null], pad: [3, null] },
    { id: 'crossover', label: 'Crossover · près du cercle : euro step', keys: ['KeyC', null], pad: [1, null] },
    { id: 'screen', label: 'Écran (avec ballon : en demander un)', keys: ['KeyB', null], pad: [4, 1] },
    { id: 'steal', label: 'Interception', keys: ['KeyF', null], pad: [1, null] },
    { id: 'sprint', label: 'Sprint (maintenir) · près du cercle : dunk', keys: ['ShiftLeft', 'ShiftRight'], pad: [7, 5] },
    { id: 'defend', label: 'Posture défensive (maintenir) · pendant un tir adverse : box-out', keys: ['ShiftLeft', 'KeyF'], pad: [6, null] },
    { id: 'camera', label: 'Changer de caméra', keys: ['KeyV', null], pad: [8, null] },
    { id: 'pause', label: 'Pause et menu (Échap marche toujours)', keys: ['KeyP', null], pad: [9, null] }
];

// Une touche partagée lance la première de ces actions qui est possible (ex. Y : alley-oop sinon saut)
export const ACTION_ORDER = ['shoot', 'pass', 'alleyoop', 'crossover', 'screen', 'steal', 'jump', 'camera'];

const PAD_NAMES = ['A / ✕', 'B / ◯', 'X / ▢', 'Y / △', 'LB / L1', 'RB / R1', 'LT / L2', 'RT / R2', 'Back / Share',
    'Start / Options', 'Stick G (clic)', 'Stick D (clic)', 'Croix ↑', 'Croix ↓', 'Croix ←', 'Croix →', 'Home / PS'];
const KEY_NAMES = {
    Space: 'Espace', ShiftLeft: 'Shift gauche', ShiftRight: 'Shift droit', ControlLeft: 'Ctrl gauche',
    ControlRight: 'Ctrl droit', AltLeft: 'Alt', AltRight: 'Alt Gr', Enter: 'Entrée', Tab: 'Tab', CapsLock: 'Verr. maj',
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Backquote: '²'
};

export class KeyBindings {
    constructor() {
        this.layout = null; // noms des touches selon le clavier (AZERTY : KeyW s'affiche « Z »)
        navigator.keyboard?.getLayoutMap?.().then((m) => { this.layout = m; this.onChange?.(); }).catch(() => {});
        this.load();
    }

    defaults() {
        const keys = {};
        const pad = {};
        for (const a of ACTIONS) {
            keys[a.id] = [...a.keys];
            pad[a.id] = [...a.pad];
        }
        return { keys, pad };
    }

    load() {
        const d = this.defaults();
        let saved = null;
        try {
            saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
        } catch { /* navigateur qui bloque les données du site, ou valeur abîmée : touches par défaut */ }
        // Ne garder que des valeurs valides, action par action (une action ajoutée plus tard prend son défaut)
        const ok = (v, type) => v === null || typeof v === type;
        for (const a of ACTIONS) {
            const k = saved?.keys?.[a.id];
            const p = saved?.pad?.[a.id];
            if (Array.isArray(k) && k.length === 2 && k.every(v => ok(v, 'string'))) d.keys[a.id] = k;
            if (Array.isArray(p) && p.length === 2 && p.every(v => ok(v, 'number'))) d.pad[a.id] = p;
        }
        this.keys = d.keys;
        this.pad = d.pad;
    }

    save() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({ keys: this.keys, pad: this.pad }));
        } catch { /* pas de sauvegarde possible : les touches restent valables jusqu'à la fermeture */ }
        this.onChange?.();
    }

    reset() {
        const d = this.defaults();
        this.keys = d.keys;
        this.pad = d.pad;
        this.save();
    }

    set(device, actionId, slot, value) {
        this[device][actionId][slot] = value;
        this.save();
    }

    /** Actions liées à une touche clavier ou à un bouton de manette */
    actionsFor(device, value) {
        return ACTIONS.filter(a => this[device][a.id].includes(value)).map(a => a.id);
    }

    keyName(code) {
        if (!code) return '';
        if (KEY_NAMES[code]) return KEY_NAMES[code];
        const fromLayout = this.layout?.get(code);
        if (fromLayout && fromLayout.trim()) return fromLayout.toUpperCase();
        return code.replace(/^Key|^Digit|^Numpad/, '');
    }

    padName(index) {
        if (index === null || index === undefined) return '';
        return PAD_NAMES[index] || `Bouton ${index}`;
    }
}

/**
 * Fenêtre « Touches » : un tableau action par action ; cliquer une case puis appuyer sur la touche ou le bouton.
 * Échap annule, Retour arrière efface la case. Pendant l'ouverture, le jeu ignore les commandes (engine.bindingsOpen).
 */
export class BindingsPanel {
    constructor(engine) {
        this.engine = engine;
        this.bindings = engine.bindings;
        this.overlay = document.getElementById('bindings-overlay');
        this.table = document.getElementById('bindings-table');
        this.waiting = null; // { device, actionId, slot, cell }
        this.bindings.onChange = () => {
            this.render();
            this.engine.renderControlsLegend();
        };

        document.getElementById('btn-bindings-close')?.addEventListener('click', () => this.close());
        document.getElementById('btn-bindings-reset')?.addEventListener('click', () => {
            this.stopWaiting();
            this.bindings.reset();
        });
        // Capture avant le jeu (phase de capture) : la touche sert au réglage, pas au match
        window.addEventListener('keydown', (e) => this.onKey(e), true);
    }

    open() {
        this.engine.bindingsOpen = true;
        this.engine.keys = {}; // aucune touche ne reste « enfoncée » pendant le réglage
        this.render();
        this.overlay?.classList.remove('hidden');
    }

    close() {
        this.stopWaiting();
        this.engine.bindingsOpen = false;
        this.overlay?.classList.add('hidden');
    }

    render() {
        if (!this.table) return;
        const b = this.bindings;
        const head = document.createElement('tr');
        for (const t of ['Action', 'Clavier', 'Clavier (2e)', 'Manette', 'Manette (2e)']) {
            const th = document.createElement('th');
            th.textContent = t;
            head.appendChild(th);
        }
        const rows = [head];
        for (const a of ACTIONS) {
            const tr = document.createElement('tr');
            const name = document.createElement('td');
            name.className = 'bindings-action';
            name.textContent = a.label;
            tr.appendChild(name);
            for (const [device, slot] of [['keys', 0], ['keys', 1], ['pad', 0], ['pad', 1]]) {
                const value = b[device][a.id][slot];
                const td = document.createElement('td');
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'bindings-cell';
                btn.textContent = device === 'keys' ? b.keyName(value) : b.padName(value);
                if (value === null) btn.textContent = '—';
                // Touche partagée avec d'autres actions : signalée (permis, mais à savoir)
                const others = value === null ? [] : b.actionsFor(device, value).filter(id => id !== a.id);
                if (others.length) {
                    btn.classList.add('shared');
                    btn.title = 'Aussi : ' + others.map(id => ACTIONS.find(x => x.id === id).label.split(' (')[0].split(' ·')[0]).join(', ');
                }
                btn.addEventListener('click', () => this.startWaiting(device, a.id, slot, btn));
                td.appendChild(btn);
                tr.appendChild(td);
            }
            rows.push(tr);
        }
        this.table.replaceChildren(...rows);
    }

    startWaiting(device, actionId, slot, cell) {
        this.stopWaiting();
        this.waiting = { device, actionId, slot };
        cell.classList.add('waiting');
        cell.textContent = device === 'keys' ? 'Appuie sur une touche…' : 'Appuie sur un bouton…';
        if (device === 'pad') {
            // Boutons déjà enfoncés au départ ignorés : on attend un nouvel appui
            const pressed = () => {
                const pad = [...(navigator.getGamepads?.() || [])].find(p => p && p.connected);
                return pad ? pad.buttons.map(btn => btn.pressed || btn.value > 0.5) : [];
            };
            const before = pressed();
            this.padTimer = setInterval(() => {
                const now = pressed();
                const idx = now.findIndex((p, i) => p && !before[i]);
                if (idx >= 0) this.assign(idx);
                now.forEach((p, i) => { if (!p) before[i] = false; });
            }, 50);
        }
    }

    stopWaiting() {
        clearInterval(this.padTimer);
        this.padTimer = null;
        if (this.waiting) {
            this.waiting = null;
            this.render();
        }
    }

    assign(value) {
        const w = this.waiting;
        if (!w) return;
        this.waiting = null;
        clearInterval(this.padTimer);
        this.bindings.set(w.device, w.actionId, w.slot, value);
    }

    onKey(e) {
        if (!this.engine.bindingsOpen) return;
        if (e.code === 'Escape') {
            e.preventDefault();
            e.stopImmediatePropagation(); // Échap ferme cette fenêtre, sans ouvrir ni fermer la pause du match
            if (this.waiting) this.stopWaiting(); else this.close();
            return;
        }
        // Sans case en attente, Tab / Entrée servent à naviguer dans la fenêtre (le jeu les ignore : bindingsOpen)
        if (!this.waiting) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (e.repeat) return;
        if (e.code === 'Backspace' || e.code === 'Delete') {
            this.assign(null);
        } else if (this.waiting.device === 'keys') {
            this.assign(e.code);
        }
    }
}
