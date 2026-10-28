/**
 * ShotMeter.js
 * Mécanique de Jauge de Tir (Shot Meter - Étape 3) :
 * - Affichage d'une jauge visuelle à côté du joueur lorsqu'il maintient le bouton de tir (ESPACE ou Clic)
 * - La taille de la "Green Window" s'adapte dynamiquement à l'atout Tir (Shooting) ou Finition (Finishing),
 *   à la distance au panier et à la contestation du défenseur le plus proche.
 * - Calcule le résultat du tir (GREEN EXCELLENT, SLIGHTLY EARLY/LATE, MUY EARLY/LATE) et la probabilité réelle.
 */

export class ShotMeter {
    constructor() {
        this.active = false;
        this.progress = 0;         // 0.0 -> 1.0
        this.chargeSpeed = 1.15;   // Vitesse de montée de la jauge
        this.greenCenter = 0.78;   // Sommet du saut optimal (78% de la jauge)
        this.greenHalfWidth = 0.08;

        this.meterEl = document.getElementById('shot-meter-widget');
        this.fillEl = document.getElementById('shot-meter-fill');
        this.greenZoneEl = document.getElementById('shot-meter-green-zone');
        this.cursorEl = document.getElementById('shot-meter-cursor');
        this.feedbackEl = document.getElementById('shot-feedback-banner');
    }

    /**
     * Démarre la jauge de tir pour le tireur
     * @param {Object} shooterAttributes { shooting, finishing, ... }
     * @param {number} distanceToRim Distance en mètres au panier
     * @param {number} contestFactor 0.0 (Ouvert) à 1.0 (Étouffé / Contré)
     */
    startCharge(shooterAttributes, distanceToRim, contestFactor = 0) {
        this.active = true;
        this.progress = 0;

        const isInsideShot = distanceToRim < 3.1;
        const primaryStat = isInsideShot
            ? (shooterAttributes?.finishing || 80)
            : (shooterAttributes?.shooting || 80);

        // Calcul de la largeur de la fenêtre "Green Window" :
        // Plus l'attribut Tir/Finition est élevé, plus la zone verte est généreuse.
        const statBonus = ((primaryStat - 60) / 39) * 0.075; // 0.00 -> +0.075
        const distPenalty = Math.max(0, (distanceToRim - 4.5) * 0.006);
        const contestPenalty = contestFactor * 0.045;

        this.greenHalfWidth = Math.max(0.032, Math.min(0.135, 0.055 + statBonus - distPenalty - contestPenalty));
        this.greenCenter = 0.78;

        if (this.meterEl) {
            this.meterEl.classList.remove('hidden');
        }
        if (this.greenZoneEl) {
            const bottomPct = (this.greenCenter - this.greenHalfWidth) * 100;
            const heightPct = (this.greenHalfWidth * 2) * 100;
            this.greenZoneEl.style.bottom = `${bottomPct}%`;
            this.greenZoneEl.style.height = `${heightPct}%`;
        }
        this.updateVisuals();
    }

    update(dt) {
        if (!this.active) return null;

        this.progress += dt * this.chargeSpeed;
        this.updateVisuals();

        // Si le joueur maintient trop longtemps (100%), relâchement forcé ("Très Tardif")
        if (this.progress >= 1.0) {
            return 'AUTO_RELEASE';
        }
        return null;
    }

    updateVisuals() {
        const pct = Math.min(100, Math.max(0, this.progress * 100));
        if (this.fillEl) {
            this.fillEl.style.height = `${pct}%`;
            const distFromGreen = Math.abs(this.progress - this.greenCenter);
            if (distFromGreen <= this.greenHalfWidth) {
                this.fillEl.style.background = 'linear-gradient(180deg, #22c55e, #16a34a)';
            } else {
                this.fillEl.style.background = 'linear-gradient(180deg, #f97316, #facc15)';
            }
        }
        if (this.cursorEl) {
            this.cursorEl.style.bottom = `${pct}%`;
        }
    }

    /**
     * Relâche le tir et évalue la probabilité de réussite selon :
     * Timing de la jauge + Attribut (Tir ou Finition) + Distance au panier + Contestation
     */
    releaseShot(shooterAttributes, distanceToRim, contestFactor = 0) {
        this.active = false;
        const releaseVal = this.progress;

        setTimeout(() => {
            if (!this.active && this.meterEl) {
                this.meterEl.classList.add('hidden');
            }
        }, 550);

        const isInside = distanceToRim < 3.1;
        const stat = isInside
            ? (shooterAttributes?.finishing || 80)
            : (shooterAttributes?.shooting || 80);

        const delta = releaseVal - this.greenCenter;
        const absDelta = Math.abs(delta);

        let timingLabel = '';
        let timingClass = '';
        let isGreen = false;
        let timingMultiplier = 0.5;

        if (absDelta <= this.greenHalfWidth) {
            isGreen = true;
            timingLabel = 'EXCELLENT (GREEN RELEASE !)';
            timingClass = 'feedback-green';
            timingMultiplier = 1.0;
        } else if (absDelta <= this.greenHalfWidth * 2.1) {
            timingLabel = delta < 0 ? 'LÉGÈREMENT TÔT' : 'LÉGÈREMENT TARD';
            timingClass = 'feedback-yellow';
            timingMultiplier = 0.72;
        } else {
            timingLabel = delta < 0 ? 'TROP TÔT' : 'TROP TARD';
            timingClass = 'feedback-red';
            timingMultiplier = 0.25;
        }

        // Calcul de probabilité finale :
        // Un "Green Release" garantit 96% à 100% de réussite (sauf contre direct)
        const statFactor = (stat / 99);
        const distanceModifier = Math.max(0.55, 1.08 - (distanceToRim * 0.04));
        const contestPenalty = contestFactor * 0.42;

        let makeProbability = (0.32 + statFactor * 0.55) * timingMultiplier * distanceModifier - contestPenalty;
        if (isGreen) {
            makeProbability = Math.max(0.95, 1.0 - contestFactor * 0.12);
        }
        makeProbability = Math.max(0.05, Math.min(0.99, makeProbability));

        const isMake = Math.random() <= makeProbability;
        const contestPct = Math.round(contestFactor * 100);

        this.showFeedback(timingLabel, contestPct, timingClass, isMake);

        return {
            releaseVal,
            isGreen,
            isMake,
            makeProbability,
            timingLabel,
            contestPct,
            // Zone 2 Points DANS le cercle (< 5.55m) et Zone 3 Points EN DEHORS du cercle (>= 5.55m)
            isThreePointer: distanceToRim >= 5.55
        };
    }

    showFeedback(timingLabel, contestPct, cssClass, isMake) {
        if (!this.feedbackEl) return;
        const contestText = contestPct > 8 ? `${contestPct}% Contesté` : 'Ouvert (Wide Open)';
        const icon = cssClass === 'feedback-green' ? '🔥' : (isMake ? '🏀' : '❌');

        this.feedbackEl.className = `shot-feedback-banner ${cssClass}`;
        this.feedbackEl.innerHTML = `
            <div class="fb-main">${icon} ${timingLabel}</div>
            <div class="fb-sub">${contestText}</div>
        `;
        this.feedbackEl.classList.remove('hidden');

        clearTimeout(this.feedbackTimer);
        this.feedbackTimer = setTimeout(() => {
            this.feedbackEl.classList.add('hidden');
        }, 2400);
    }
}
