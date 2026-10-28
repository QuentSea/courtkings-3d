/**
 * Quality.js — Qualité graphique du match, pour rester fluide sur les PC moins puissants.
 * - Haute : netteté écran (jusqu'à 2 pixels par point), ombres fines, public
 * - Moyenne : 1 pixel par point, ombres moins fines, public
 * - Basse : image calculée à 70 % puis agrandie, sans ombres ni public
 * En « Auto » (par défaut), le jeu commence en Haute et baisse d'un cran s'il passe sous ~45 images/s.
 * Le choix du joueur est gardé dans le navigateur (localStorage).
 */

import * as THREE from 'three';

const LEVELS = {
    haute: { label: 'Haute', pixelRatio: () => Math.min(window.devicePixelRatio || 1, 2), shadows: true, shadowSize: 2048, crowd: true },
    moyenne: { label: 'Moyenne', pixelRatio: () => Math.min(window.devicePixelRatio || 1, 1), shadows: true, shadowSize: 1024, crowd: true },
    basse: { label: 'Basse', pixelRatio: () => Math.min(window.devicePixelRatio || 1, 1) * 0.7, shadows: false, shadowSize: 512, crowd: false }
};
const ORDER = ['haute', 'moyenne', 'basse'];
const STORAGE_KEY = 'courtkings_qualite';
const TARGET_FRAME = 1 / 45;   // en dessous de ~45 images/s, le mode Auto baisse la qualité
const GRACE = 2;               // secondes ignorées après un changement (compilation des effets, chargement)
const WINDOW = 2.5;            // secondes de mesure

export class QualityManager {
    constructor(engine) {
        this.engine = engine;
        let saved = null;
        try { saved = localStorage.getItem(STORAGE_KEY); } catch (e) { /* navigation privée */ }
        this.mode = saved === 'auto' || LEVELS[saved] ? saved : 'auto';
        this.level = this.mode === 'auto' ? 'haute' : this.mode;
        this.resetMeasure();
        this.apply(this.level);
    }

    resetMeasure() {
        this.grace = GRACE;
        this.sum = 0;
        this.frames = 0;
    }

    /** Choix du joueur : 'auto', 'haute', 'moyenne' ou 'basse' */
    setMode(mode) {
        if (mode !== 'auto' && !LEVELS[mode]) return;
        this.mode = mode;
        try { localStorage.setItem(STORAGE_KEY, mode); } catch (e) { /* navigation privée */ }
        this.apply(mode === 'auto' ? 'haute' : mode);
    }

    /** À chaque image du match (dt en secondes) : en Auto, baisse la qualité si le jeu rame */
    sample(dt) {
        if (this.mode !== 'auto' || document.hidden) return;
        // Images très longues = onglet en arrière-plan ou fenêtre cachée, pas un PC lent : on les ignore
        if (dt <= 0 || dt > 0.25) return;
        if (this.grace > 0) { this.grace -= dt; return; }
        this.sum += dt;
        this.frames++;
        if (this.sum < WINDOW) return;
        const average = this.sum / this.frames;
        this.sum = 0;
        this.frames = 0;
        const next = ORDER[ORDER.indexOf(this.level) + 1];
        if (average > TARGET_FRAME && next) {
            this.apply(next);
            this.engine.showRuleAlert(`⚙️ QUALITÉ ${LEVELS[next].label.toUpperCase()} (JEU PLUS FLUIDE)`, false);
        }
    }

    apply(level) {
        const cfg = LEVELS[level];
        const { renderer, scene, court } = this.engine;
        this.level = level;
        this.resetMeasure();

        renderer.setPixelRatio(cfg.pixelRatio());
        const size = renderer.getSize(new THREE.Vector2());
        renderer.setSize(size.x, size.y, false);

        if (renderer.shadowMap.enabled !== cfg.shadows) {
            renderer.shadowMap.enabled = cfg.shadows;
            // Les effets des matériaux doivent être refaits avec ou sans ombres
            scene.traverse(o => {
                if (!o.material) return;
                for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.needsUpdate = true;
            });
        }
        const light = court?.mainLight;
        if (light && light.shadow.mapSize.x !== cfg.shadowSize) {
            light.shadow.mapSize.set(cfg.shadowSize, cfg.shadowSize);
            light.shadow.map?.dispose();
            light.shadow.map = null;
        }
        if (court) {
            court.crowdVisible = cfg.crowd;
            for (const m of court.crowdMeshes || []) m.visible = cfg.crowd;
        }
        this.updateSelect();
    }

    /** Menu « Qualité » du match : affiche le niveau choisi par le mode Auto */
    updateSelect() {
        const select = document.getElementById('hud-quality');
        if (!select) return;
        select.value = this.mode;
        const auto = select.querySelector('option[value="auto"]');
        if (auto) auto.textContent = `Qualité : Auto (${LEVELS[this.level].label})`;
    }
}
