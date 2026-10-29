/**
 * Effects.js — Effets « spectacle » :
 * - filet qui bouge quand le ballon passe (CourtScene.animateNet), secousse de caméra au smash ;
 * - dunk au ralenti, caméra de côté près du cercle : seulement seul contre les bots (à plusieurs, le match ne peut
 *   pas ralentir pour tout le monde) ;
 * - confettis aux couleurs de l'équipe gagnante sur l'écran de fin.
 * Méthodes ajoutées au prototype de GameEngine (voir la fin de GameEngine.js) : `this` est le moteur.
 */

import * as THREE from 'three';

const SLOW = 0.35; // vitesse du jeu pendant le ralenti
const TEAM_COLORS = { A: ['#38bdf8', '#2563eb'], B: ['#f43f5e', '#e11d48'] };

export const EffectsMethods = {
    /** Effets visuels qui accompagnent un son du jeu (chez l'hôte et chez les invités, voir playSound) */
    soundEffects(name, pos) {
        if (!pos) return;
        if (name === 'swish' || name === 'dunk') this.court.animateNet(pos);
        if (name === 'dunk') this.cameraShake = 0.4;
    },

    /** Dunk ou alley-oop qui part (hôte, seul contre les bots) : ralenti et caméra près du cercle */
    startDunkCinema(player, hoop, duration) {
        const solo = Object.keys(this.network.lobbyState?.players || {}).length <= 1;
        if (!solo || !this.isAuthority) return;
        this.slowMo = duration + 0.35; // en temps de jeu (le ballon a le temps de traverser le filet)
        this.cinema = { focus: hoop.rimPos.clone(), from: player.pos.clone() };
    },

    /** Temps de jeu de cette image : ralenti pendant un dunk */
    gameDt(dt) {
        if (!(this.slowMo > 0)) return dt;
        const slow = dt * SLOW;
        this.slowMo -= slow;
        if (this.slowMo <= 0) this.cinema = null;
        return slow;
    },

    /** Caméra du ralenti : de côté, à hauteur du cercle, tournée vers l'arceau (Camera.js) */
    placeCinemaCamera() {
        const c = this.cinema;
        const out = _out.set(c.from.x - c.focus.x, 0, c.from.z - c.focus.z).normalize();
        _target.copy(c.focus).addScaledVector(out, 3.6).addScaledVector(_side.set(-out.z, 0, out.x), 3.2).setY(2.3);
        this.camera.position.lerp(_target, 0.12);
        this.camera.lookAt(c.focus.x, c.focus.y - 0.5, c.focus.z);
    },

    /** Confettis sur l'écran de fin, aux couleurs de l'équipe gagnante (4,5 s) */
    launchConfetti(team) {
        document.getElementById('confetti-canvas')?.remove();
        const canvas = document.createElement('canvas');
        canvas.id = 'confetti-canvas';
        canvas.className = 'confetti-canvas';
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        document.body.appendChild(canvas);
        const ctx = canvas.getContext('2d');
        const colors = [...(TEAM_COLORS[team] || TEAM_COLORS.A), '#facc15', '#ffffff'];
        const bits = Array.from({ length: 160 }, () => ({
            x: Math.random() * canvas.width,
            y: -20 - Math.random() * canvas.height * 0.6,
            vx: (Math.random() - 0.5) * 60,
            vy: 90 + Math.random() * 140,
            spin: (Math.random() - 0.5) * 8,
            angle: Math.random() * Math.PI,
            size: 6 + Math.random() * 6,
            color: colors[Math.floor(Math.random() * colors.length)]
        }));
        let last = performance.now();
        const start = last;
        const frame = (now) => {
            const dt = Math.min(0.05, (now - last) / 1000);
            last = now;
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            const fade = Math.min(1, (4500 - (now - start)) / 800);
            for (const b of bits) {
                b.x += (b.vx + Math.sin(now / 300 + b.angle) * 25) * dt;
                b.y += b.vy * dt;
                b.angle += b.spin * dt;
                ctx.save();
                ctx.globalAlpha = Math.max(0, fade);
                ctx.translate(b.x, b.y);
                ctx.rotate(b.angle);
                ctx.fillStyle = b.color;
                ctx.fillRect(-b.size / 2, -b.size / 4, b.size, b.size / 2); // petit rectangle de papier
                ctx.restore();
            }
            if (now - start < 4500 && canvas.isConnected) requestAnimationFrame(frame);
            else canvas.remove();
        };
        requestAnimationFrame(frame);
    }
};

const _out = new THREE.Vector3();
const _side = new THREE.Vector3();
const _target = new THREE.Vector3();
