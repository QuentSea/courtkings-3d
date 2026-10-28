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

    updateCamera() {
        const me = this.getLocalEntity();
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
    }
};
