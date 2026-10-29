/**
 * Camera.js — Caméra « 2K Cam » / « Vue Suivi » : suit l'action et indique si l'écran est retourné.
 * Méthodes ajoutées au prototype de GameEngine (voir la fin de GameEngine.js) : `this` est le moteur.
 */

import * as THREE from 'three';

export const CameraMethods = {
    /**
     * Panier vers lequel regarde la caméra : en tout-terrain, celui qu'attaque l'équipe qui a le ballon
     * (l'action), pour ne jamais tourner le dos au jeu quand on défend
     */
    getCameraFocusHoop(me) {
        if (this.currentMode.isHalfCourt) return this.getAttackingHoopForTeam(me.team);
        return this.getAttackingHoopForTeam(this.matchRules.possessionTeam);
    },

    updateCamera(dt = 0) {
        const me = this.getLocalEntity();
        // Dunk au ralenti (Effects.js) : caméra près du cercle ; les commandes gardent leur sens d'avant
        if (this.cinema) {
            this.placeCinemaCamera();
            this.shakeCamera(dt);
            return;
        }
        if (!me) return;

        const hoop = this.getCameraFocusHoop(me);
        const dirZ = hoop.side === 'NORTH' ? 1 : -1;

        if (this.cameraMode === '2K') {
            const targetCamPos = new THREE.Vector3(
                me.pos.x * 0.45,
                7.6,
                me.pos.z + dirZ * 8.8
            );
            this.camera.position.lerp(targetCamPos, 0.08);
            const lookTarget = new THREE.Vector3(
                me.pos.x * 0.35,
                1.4,
                (me.pos.z + hoop.rimPos.z) * 0.5
            );
            this.camera.lookAt(lookTarget);
        } else {
            const targetCamPos = new THREE.Vector3(me.pos.x, 4.2, me.pos.z + dirZ * 6.2);
            this.camera.position.lerp(targetCamPos, 0.1);
            this.camera.lookAt(me.pos.x, 1.5, me.pos.z - dirZ * 2.5);
        }

        // Caméra tournée vers le sud (+Z) : les touches et le stick s'inversent pour rester « haut = haut de l'écran »
        this.camera.getWorldDirection(this.cameraForward);
        this.viewFlipped = this.cameraForward.z > 0;
        this.shakeCamera(dt);
    },

    /** Secousse au smash d'un dunk (Effects.js) : quelques centimètres au hasard, de moins en moins */
    shakeCamera(dt) {
        if (!(this.cameraShake > 0)) return;
        this.cameraShake -= dt;
        const a = Math.max(0, this.cameraShake) * 0.3;
        this.camera.position.x += (Math.random() - 0.5) * a;
        this.camera.position.y += (Math.random() - 0.5) * a;
    },

    /**
     * Étiquettes des joueurs (poste, note, nom) : quand deux se chevauchent à l'écran, celle du joueur le plus loin
     * s'efface. La mienne puis celle du porteur du ballon passent avant les autres.
     */
    declutterNameplates(dt) {
        const cam = this.camera;
        cam.updateMatrixWorld();
        const right = _right.setFromMatrixColumn(cam.matrixWorld, 0);
        const up = _up.setFromMatrixColumn(cam.matrixWorld, 1);
        const plates = [];
        for (const ent of this.entities.values()) {
            const s = ent.mesh.nameSprite;
            if (!s) continue;
            _p.copy(ent.mesh.root.position);
            _p.y += s.position.y;
            const dist = _p.distanceTo(cam.position);
            const c = _c.copy(_p).project(cam);
            // Pilule dessinée sur ~86 % de la largeur et ~64 % de la hauteur du sprite (createNameplateSprite)
            const w = Math.abs(_q.copy(_p).addScaledVector(right, s.scale.x * 0.43).project(cam).x - c.x);
            const h = Math.abs(_q.copy(_p).addScaledVector(up, s.scale.y * 0.32).project(cam).y - c.y);
            const rank = ent.id === this.localPlayerId ? 0 : ent.id === this.ball.holderId ? 1 : 2;
            plates.push({ s, x: c.x, y: c.y, w, h, rank, dist });
        }
        plates.sort((a, b) => a.rank - b.rank || a.dist - b.dist);
        const shown = [];
        for (const pl of plates) {
            // Marge pour une étiquette déjà effacée : elle ne clignote pas quand deux joueurs se frôlent
            const m = pl.s.material.opacity < 0.5 ? 1.15 : 1;
            const hidden = shown.some(o => Math.abs(pl.x - o.x) < (pl.w + o.w) * m && Math.abs(pl.y - o.y) < (pl.h + o.h) * m);
            if (!hidden) shown.push(pl);
            const target = hidden || this.cinema ? 0 : 1; // dunk au ralenti : image dégagée (Effects.js)
            pl.s.material.opacity += (target - pl.s.material.opacity) * Math.min(1, dt * 12);
        }
    }
};

const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _p = new THREE.Vector3();
const _c = new THREE.Vector3();
const _q = new THREE.Vector3();
