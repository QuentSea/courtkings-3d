/**
 * TouchControls.js — Commandes tactiles (téléphone, tablette) : joystick à gauche pour bouger et viser les passes,
 * boutons à droite (tir à maintenir, passe, sprint et défense à maintenir, crossover, saut / contre, interception,
 * alley-oop, pause). Seulement sur un écran tactile, pendant un match (body.touch, styles.css).
 * Le joystick et les boutons tenus sont lus comme une manette (Controls.js, updateLocalPlayerControl) ; les autres
 * boutons lancent les mêmes actions que le clavier (runActions).
 */

const STICK_RADIUS = 48; // px : course du bouton du joystick

/** Garder le doigt même s'il sort du bouton (sans capture possible, le bouton marche quand même) */
function capture(el, pointerId) {
    try {
        el.setPointerCapture(pointerId);
    } catch { /* pointeur déjà relâché ou simulé */ }
}

export class TouchControls {
    constructor(engine) {
        this.engine = engine;
        // Écran tactile comme pointeur principal (téléphone, tablette) ; pas un PC avec souris et écran tactile
        this.enabled = !!window.matchMedia?.('(pointer: coarse)').matches;
        this.move = { x: 0, z: 0 };
        this.held = new Set(); // actions tenues : 'sprint', 'defend'
        const root = document.getElementById('touch-controls');
        if (!this.enabled || !root) return;
        document.body.classList.add('touch');
        this.bindStick(document.getElementById('touch-stick'));
        root.querySelectorAll('[data-touch]').forEach(btn => this.bindButton(btn));
    }

    bindStick(base) {
        const knob = base.querySelector('.touch-knob');
        let pointer = null;
        let cx = 0;
        let cy = 0;
        const follow = (e) => {
            let dx = e.clientX - cx;
            let dy = e.clientY - cy;
            const len = Math.hypot(dx, dy);
            if (len > STICK_RADIUS) {
                dx *= STICK_RADIUS / len;
                dy *= STICK_RADIUS / len;
            }
            this.move.x = dx / STICK_RADIUS;
            this.move.z = dy / STICK_RADIUS; // vers le bas de l'écran = vers soi, comme la touche « bas »
            knob.style.transform = `translate(${dx}px, ${dy}px)`;
        };
        base.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            pointer = e.pointerId;
            capture(base, pointer);
            const r = base.getBoundingClientRect();
            cx = r.left + r.width / 2;
            cy = r.top + r.height / 2;
            follow(e);
        });
        base.addEventListener('pointermove', (e) => {
            if (e.pointerId === pointer) follow(e);
        });
        const end = (e) => {
            if (e.pointerId !== pointer) return;
            pointer = null;
            this.move.x = 0;
            this.move.z = 0;
            knob.style.transform = '';
        };
        base.addEventListener('pointerup', end);
        base.addEventListener('pointercancel', end);
    }

    bindButton(btn) {
        const action = btn.dataset.touch;
        btn.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            capture(btn, e.pointerId);
            btn.classList.add('pressed');
            this.press(action);
        });
        const up = () => {
            if (!btn.classList.contains('pressed')) return;
            btn.classList.remove('pressed');
            this.release(action);
        };
        btn.addEventListener('pointerup', up);
        btn.addEventListener('pointercancel', up);
    }

    press(action) {
        const eng = this.engine;
        if (action === 'pause') {
            if (eng.canPause()) eng.togglePause();
            return;
        }
        if (action === 'sprint' || action === 'defend') {
            this.held.add(action);
            return;
        }
        const me = eng.getLocalEntity();
        if (!me || !eng.isRunning || eng.matchRules.matchOver || eng.menuOpen) return;
        eng.runActions([action], me);
    }

    release(action) {
        this.held.delete(action);
        const eng = this.engine;
        const me = eng.getLocalEntity();
        // Bouton de tir relâché : le tir part (comme la touche du clavier)
        if (action === 'shoot' && me && eng.shotMeter.active && eng.ball.holderId === me.id) eng.executeShotRelease(me);
    }

    /** Joystick et boutons tenus, au format d'une manette ; null si rien n'est touché */
    input() {
        if (!this.enabled || (!this.move.x && !this.move.z && !this.held.size)) return null;
        return {
            moveX: this.move.x,
            moveZ: this.move.z,
            rightStickX: 0,
            rightStickZ: 0,
            sprint: this.held.has('sprint'),
            defend: this.held.has('defend')
        };
    }
}
