/**
 * Rules.js — Règles du match : panier attaqué, mi-temps, remises en jeu, possession, tableau de score et messages.
 * Méthodes ajoutées au prototype de GameEngine (voir la fin de GameEngine.js) : `this` est le moteur.
 */

import * as THREE from 'three';

export const RulesMethods = {
    getAttackingHoopForTeam(team) {
        if (this.currentMode.isHalfCourt) {
            return this.court.getTargetHoop('NORTH');
        }
        const attacksNorth = (team === 'A') !== this.matchRules.sidesSwapped;
        return this.court.getTargetHoop(attacksNorth ? 'NORTH' : 'SOUTH');
    },

    /**
     * Tout-terrain : à la moitié du score à atteindre (15 pts en 5v5), les équipes changent de panier.
     * Appelé par l'hôte après chaque panier, avant la remise en jeu.
     */
    checkHalftime() {
        if (this.currentMode.isHalfCourt || this.matchRules.sidesSwapped) return;
        const half = Math.ceil((this.currentMode.targetScore || 30) / 2);
        if (Math.max(this.matchRules.scoreA, this.matchRules.scoreB) >= half) {
            this.matchRules.sidesSwapped = true;
            this.pendingHalftimeAlert = true;
        }
    },

    /**
     * Remise en jeu ("Check Ball" en haut de la raquette en 3v3/4v4, ou remise en jeu 5v5)
     */
    resetPositionsForCheckBall(offenseTeam = 'A') {
        this.matchRules.possessionTeam = offenseTeam;
        this.matchRules.needsTakeBack = false;
        this.matchRules.shotClock = 24;
        if (this.isAuthority) this.matchRules.checkBallSeq++;

        const isHalf = this.currentMode.isHalfCourt;
        const offenseSpots = [
            new THREE.Vector3(0, 0, isHalf ? 0.6 : 1.0),
            new THREE.Vector3(-4.6, 0, isHalf ? -1.4 : -2.2),
            new THREE.Vector3(4.6, 0, isHalf ? -1.4 : -2.2),
            new THREE.Vector3(-3.2, 0, isHalf ? -4.2 : -5.0),
            new THREE.Vector3(3.2, 0, isHalf ? -4.2 : -5.0)
        ];

        const defenseSpots = [
            new THREE.Vector3(0, 0, isHalf ? -1.2 : -1.4),
            new THREE.Vector3(-3.6, 0, isHalf ? -2.4 : -3.0),
            new THREE.Vector3(3.6, 0, isHalf ? -2.4 : -3.0),
            new THREE.Vector3(-2.2, 0, isHalf ? -4.5 : -5.2),
            new THREE.Vector3(2.2, 0, isHalf ? -4.5 : -5.2)
        ];

        let offIdx = 0;
        let defIdx = 0;
        let ballCarrier = null;
        // Les places sont prévues pour une attaque vers le nord : les retourner si l'attaque va vers le sud
        const mirror = !isHalf && this.getAttackingHoopForTeam(offenseTeam).side === 'SOUTH';

        for (const ent of this.entities.values()) {
            if (ent.team === offenseTeam) {
                const spot = offenseSpots[offIdx % offenseSpots.length].clone();
                if (mirror) spot.z *= -1;
                ent.pos.copy(spot);
                ent.slotIndex = offIdx;
                // Même porteur dans tous les onglets : le 1er de l'équipe (ordre du salon, identique partout)
                if (offIdx === 0) {
                    ballCarrier = ent;
                }
                offIdx++;
            } else {
                const spot = defenseSpots[defIdx % defenseSpots.length].clone();
                if (mirror) spot.z *= -1;
                ent.pos.copy(spot);
                ent.slotIndex = defIdx;
                defIdx++;
            }
            ent.mesh.root.position.copy(ent.pos);
            ent.netPos = ent.pos.clone();
            ent.vel.set(0, 0, 0);
            ent.isDunking = false;
            ent.state = 'IDLE';
        }

        if (ballCarrier) {
            this.giveBallTo(ballCarrier.id, false);
        }
        if (this.pendingHalftimeAlert) {
            this.pendingHalftimeAlert = false;
            this.showRuleAlert(`⏱️ MI-TEMPS : CHANGEMENT DE CÔTÉ ! — POSSESSION ÉQUIPE ${offenseTeam}`);
        } else {
            this.showRuleAlert(`CHECK BALL — POSSESSION ÉQUIPE ${offenseTeam}`);
        }
        this.updateScoreboardUI();
    },

    giveBallTo(playerId, isDefensiveChange = false) {
        const player = this.entities.get(playerId);
        if (!player) return;

        const prevTeam = this.matchRules.possessionTeam;
        this.ball.holderId = playerId;
        this.ball.state = 'HELD';
        this.matchRules.possessionTeam = player.team;

        if (this.currentMode.isHalfCourt && isDefensiveChange && prevTeam !== player.team) {
            const hoop = this.getAttackingHoopForTeam(player.team);
            const dist = this.getHorizontalDist(player.pos, hoop.rimPos);
            if (dist < hoop.threePointRadius) {
                this.matchRules.needsTakeBack = true;
                this.showRuleAlert('REBOND DÉFENSIF : RESSORS DERRIÈRE LES 3 PTS !');
            }
        }
        this.updateScoreboardUI();
    },

    updateScoreboardUI() {
        const scoreAEl = document.getElementById('hud-score-a');
        const scoreBEl = document.getElementById('hud-score-b');
        const modeEl = document.getElementById('hud-mode-badge');
        const ruleEl = document.getElementById('hud-rule-status');

        if (scoreAEl) scoreAEl.textContent = this.matchRules.scoreA;
        if (scoreBEl) scoreBEl.textContent = this.matchRules.scoreB;
        if (modeEl) modeEl.textContent = this.currentMode.id;
        if (ruleEl) {
            if (this.matchRules.needsTakeBack) {
                ruleEl.textContent = '⚠️ RESSORTIR DERRIÈRE LES 3 PTS';
                ruleEl.classList.add('takeback-warning');
            } else {
                ruleEl.textContent = `POSSESSION : ÉQUIPE ${this.matchRules.possessionTeam}`;
                ruleEl.classList.remove('takeback-warning');
            }
        }
    },

    showRuleAlert(message, shareWithGuests = true) {
        if (this.isAuthority && shareWithGuests) {
            this.alertSeq++;
            this.lastAlertText = message;
        }
        const toast = document.getElementById('court-rule-toast');
        if (!toast) return;
        toast.textContent = message;
        toast.classList.remove('hidden');
        clearTimeout(this.ruleToastTimer);
        this.ruleToastTimer = setTimeout(() => {
            toast.classList.add('hidden');
        }, 2400);
    }
};
