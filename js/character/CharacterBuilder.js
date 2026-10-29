/**
 * CharacterBuilder.js
 * Gère le Créateur de Personnage (Étape 2) :
 * - Scène Three.js dédiée avec podium néon, ballon 3D et rotation souris/boutons
 * - Sélection parmi les 10 Presets / Modèles
 * - Personnalisation modulaire : Nom, Numéro, Couleur de peau, Coiffure, Barbe, Couleur cheveux, Maillot
 * - Sélection des 5 Postes (PG, SG, SF, PF, C) modifiant taille/vitesse/plafonds
 * - Répartition interactive du pool de points dans les 4 Atouts (Tir, Défense, Dribble, Finition)
 */

import * as THREE from 'three';
import {
    ATTRIBUTE_POOL,
    SKIN_TONES,
    HAIR_STYLES,
    BEARD_STYLES,
    HAIR_COLORS,
    JERSEY_COLORS,
    POSITIONS,
    CHARACTER_PRESETS
} from '../config/constants.js';
import { createCharacterMesh } from './createCharacter.js';
import { setupRenderer } from '../render/RenderSetup.js';
import { bonusPoints } from '../progress/Career.js';

export class CharacterBuilder {
    constructor(canvasContainerId, onConfirmCallback) {
        this.container = document.getElementById(canvasContainerId);
        this.onConfirmCallback = onConfirmCallback;

        // Charger la sauvegarde locale ou le Preset #1 par défaut
        // (navigateur qui bloque les données du site : lire la sauvegarde lève une erreur, on part du preset)
        this.profile = structuredClone(CHARACTER_PRESETS[0]);
        try {
            const saved = localStorage.getItem('courtkings_player_profile');
            if (saved) this.profile = JSON.parse(saved);
        } catch {
            /* pas de sauvegarde lisible */
        }

        this.previewAnimState = 'IDLE';
        this.isDragging = false;
        this.prevMouseX = 0;
        this.targetRotationY = 0.25;

        this.initThreePreview();
        this.bindUI();
        this.syncUIFromProfile();
        this.animate();
    }

    initThreePreview() {
        const width = this.container.clientWidth || 500;
        const height = this.container.clientHeight || 600;

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color('#090d16');
        this.scene.fog = new THREE.FogExp2('#090d16', 0.08);

        this.camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 50);
        this.camera.position.set(0, 1.55, 4.35);
        this.camera.lookAt(0, 1.25, 0);

        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(width, height);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        setupRenderer(this.renderer, this.scene);
        this.container.innerHTML = '';
        this.container.appendChild(this.renderer.domElement);

        // Éclairage Studio 3 points (Key, Fill, Rim)
        const ambient = new THREE.AmbientLight('#ffffff', 0.65);
        this.scene.add(ambient);

        const keyLight = new THREE.DirectionalLight('#fff7ed', 1.45);
        keyLight.position.set(3, 5, 4);
        keyLight.castShadow = true;
        this.scene.add(keyLight);

        const rimLight = new THREE.SpotLight('#38bdf8', 2.2, 12, Math.PI / 3);
        rimLight.position.set(-3, 3.5, -3);
        this.scene.add(rimLight);

        const warmRim = new THREE.PointLight('#f97316', 1.5, 8);
        warmRim.position.set(2.5, 1.0, -2);
        this.scene.add(warmRim);

        // Podium circulaire parquet & anneau lumineux
        const podiumGroup = new THREE.Group();
        const floorGeo = new THREE.CylinderGeometry(1.35, 1.45, 0.12, 48);
        const floorMat = new THREE.MeshStandardMaterial({
            color: '#b45309',
            roughness: 0.3,
            metalness: 0.1
        });
        const podium = new THREE.Mesh(floorGeo, floorMat);
        podium.position.y = -0.06;
        podium.receiveShadow = true;
        podiumGroup.add(podium);

        const neonRingGeo = new THREE.RingGeometry(1.32, 1.38, 48);
        const neonRingMat = new THREE.MeshBasicMaterial({ color: '#f97316', side: THREE.DoubleSide });
        const neonRing = new THREE.Mesh(neonRingGeo, neonRingMat);
        neonRing.rotation.x = -Math.PI / 2;
        neonRing.position.y = 0.01;
        podiumGroup.add(neonRing);

        this.scene.add(podiumGroup);

        // Personnage 3D
        this.characterMesh = createCharacterMesh(this.profile);
        this.scene.add(this.characterMesh.root);
        this.hideNameplate();

        // Ballon 3D décoratif pour l'aperçu Dribble / Tir
        const ballGeo = new THREE.SphereGeometry(0.14, 24, 24);
        const ballMat = new THREE.MeshStandardMaterial({
            color: '#ea580c',
            roughness: 0.45
        });
        this.previewBall = new THREE.Mesh(ballGeo, ballMat);
        this.previewBall.castShadow = true;
        this.previewBall.position.set(0.42, 0.72, 0.25);
        this.characterMesh.root.add(this.previewBall);

        // Contrôle rotation à la souris sur le canvas
        this.renderer.domElement.addEventListener('pointerdown', (e) => {
            this.isDragging = true;
            this.prevMouseX = e.clientX;
        });
        window.addEventListener('pointerup', () => {
            this.isDragging = false;
        });
        window.addEventListener('pointermove', (e) => {
            if (!this.isDragging) return;
            const deltaX = e.clientX - this.prevMouseX;
            this.prevMouseX = e.clientX;
            this.targetRotationY += deltaX * 0.012;
        });

        window.addEventListener('resize', () => this.handleResize());
        // La zone change aussi de taille sans que la fenêtre bouge (changement d'écran, mise en page étroite)
        if (window.ResizeObserver) new ResizeObserver(() => this.handleResize()).observe(this.container);
    }

    handleResize() {
        if (!this.container || !this.renderer) return;
        const w = this.container.clientWidth;
        const h = this.container.clientHeight;
        if (w === 0 || h === 0) return;
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(w, h);
    }

    getUsedBonusPoints() {
        const a = this.profile.attributes;
        const base = ATTRIBUTE_POOL.STARTING_BASE;
        return (
            (a.shooting - base) +
            (a.defense - base) +
            (a.dribble - base) +
            (a.finishing - base)
        );
    }

    /** Points d'atouts encore libres : le pool de départ plus ceux gagnés avec les niveaux (Career.js) */
    getRemainingPoints() {
        return ATTRIBUTE_POOL.TOTAL_BONUS_POINTS + bonusPoints() - this.getUsedBonusPoints();
    }

    clampAttributesToPositionCaps() {
        const caps = POSITIONS[this.profile.position].caps;
        const base = ATTRIBUTE_POOL.STARTING_BASE;
        for (const key of ['shooting', 'defense', 'dribble', 'finishing']) {
            if (this.profile.attributes[key] > caps[key]) {
                this.profile.attributes[key] = caps[key];
            }
            if (this.profile.attributes[key] < base) {
                this.profile.attributes[key] = base;
            }
        }
    }

    bindUI() {
        // 1. Grille des 10 Presets
        const presetGrid = document.getElementById('preset-grid');
        if (presetGrid) {
            presetGrid.innerHTML = '';
            CHARACTER_PRESETS.forEach((preset) => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'preset-btn';
                btn.dataset.presetId = preset.id;
                btn.innerHTML = `
                    <span class="preset-pos">${preset.position}</span>
                    <span class="preset-title">${preset.presetName}</span>
                `;
                btn.addEventListener('click', () => {
                    this.profile = structuredClone(preset);
                    this.syncUIFromProfile();
                });
                presetGrid.appendChild(btn);
            });
        }

        // 2. Identité : Nom & Numéro de maillot
        const nameInput = document.getElementById('player-name-input');
        if (nameInput) {
            nameInput.addEventListener('input', (e) => {
                this.profile.playerName = e.target.value.trim() || 'Baller';
                this.update3DPreview();
            });
        }

        const numInput = document.getElementById('player-number-input');
        if (numInput) {
            numInput.addEventListener('input', (e) => {
                this.profile.jerseyNumber = e.target.value.replace(/[^0-9]/g, '').slice(0, 2) || '0';
                this.update3DPreview();
            });
        }

        // 3. Sélecteurs Couleur de Peau
        const skinContainer = document.getElementById('skin-tone-swatches');
        if (skinContainer) {
            skinContainer.innerHTML = '';
            SKIN_TONES.forEach((tone) => {
                const swatch = document.createElement('button');
                swatch.type = 'button';
                swatch.className = 'color-swatch';
                swatch.style.backgroundColor = tone.hex;
                swatch.title = tone.name;
                swatch.dataset.skinId = tone.id;
                swatch.addEventListener('click', () => {
                    this.profile.skinTone = tone.id;
                    this.syncUIFromProfile();
                });
                skinContainer.appendChild(swatch);
            });
        }

        // 4. Coiffure, Couleur de Cheveux, Barbe, Maillot
        this.populateSelect('hair-style-select', HAIR_STYLES, 'hairStyle');
        this.populateSelect('beard-style-select', BEARD_STYLES, 'beardStyle');
        this.populateSelect('hair-color-select', HAIR_COLORS, 'hairColor');
        this.populateSelect('jersey-color-select', JERSEY_COLORS, 'jerseyColor');

        // 5. Sélecteur des 5 Postes (PG, SG, SF, PF, C)
        const posCards = document.getElementById('position-cards');
        if (posCards) {
            posCards.innerHTML = '';
            Object.values(POSITIONS).forEach((pos) => {
                const card = document.createElement('button');
                card.type = 'button';
                card.className = 'pos-card';
                card.dataset.posCode = pos.code;
                card.innerHTML = `
                    <div class="pos-code">${pos.code}</div>
                    <div class="pos-meta">
                        <div class="pos-name">${pos.shortName}</div>
                        <div class="pos-height">${pos.heightLabel}</div>
                    </div>
                `;
                card.addEventListener('click', () => {
                    this.profile.position = pos.code;
                    this.clampAttributesToPositionCaps();
                    this.syncUIFromProfile();
                });
                posCards.appendChild(card);
            });
        }

        // Bouton d'application de la répartition recommandée du poste
        const autoAllocBtn = document.getElementById('btn-recommended-attrs');
        if (autoAllocBtn) {
            autoAllocBtn.addEventListener('click', () => {
                const rec = POSITIONS[this.profile.position].recommended;
                this.profile.attributes = { ...rec };
                this.syncUIFromProfile();
            });
        }

        // Bouton Réinitialiser les points d'atouts
        const resetAttrBtn = document.getElementById('btn-reset-attrs');
        if (resetAttrBtn) {
            resetAttrBtn.addEventListener('click', () => {
                const b = ATTRIBUTE_POOL.STARTING_BASE;
                this.profile.attributes = { shooting: b, defense: b, dribble: b, finishing: b };
                this.syncUIFromProfile();
            });
        }

        // 6. Contrôles + / - et Sliders des 4 Atouts
        ['shooting', 'defense', 'dribble', 'finishing'].forEach((attrKey) => {
            const slider = document.getElementById(`slider-${attrKey}`);
            if (slider) {
                slider.addEventListener('input', (e) => {
                    this.setAttributeValue(attrKey, parseInt(e.target.value, 10));
                });
            }
            const minusBtn = document.querySelector(`[data-attr-minus="${attrKey}"]`);
            const plusBtn = document.querySelector(`[data-attr-plus="${attrKey}"]`);
            if (minusBtn) {
                minusBtn.addEventListener('click', () => {
                    this.setAttributeValue(attrKey, this.profile.attributes[attrKey] - 1);
                });
            }
            if (plusBtn) {
                plusBtn.addEventListener('click', () => {
                    this.setAttributeValue(attrKey, this.profile.attributes[attrKey] + 1);
                });
            }
        });

        // 7. Boutons d'animation de prévisualisation 3D
        document.querySelectorAll('[data-preview-anim]').forEach((btn) => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('[data-preview-anim]').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.previewAnimState = btn.dataset.previewAnim;
            });
        });

        // 8. Bouton de validation "Sauvegarder & Aller au Salon / Terrain"
        const confirmBtn = document.getElementById('btn-save-character');
        if (confirmBtn) {
            confirmBtn.addEventListener('click', () => {
                this.saveProfile();
                if (this.onConfirmCallback) {
                    this.onConfirmCallback(this.profile);
                }
            });
        }
    }

    populateSelect(elementId, items, profileKey) {
        const select = document.getElementById(elementId);
        if (!select) return;
        select.innerHTML = '';
        items.forEach((item) => {
            const opt = document.createElement('option');
            opt.value = item.id;
            opt.textContent = item.name;
            select.appendChild(opt);
        });
        select.addEventListener('change', (e) => {
            this.profile[profileKey] = e.target.value;
            this.syncUIFromProfile();
        });
    }

    setAttributeValue(attrKey, desiredVal) {
        const base = ATTRIBUTE_POOL.STARTING_BASE;
        const cap = POSITIONS[this.profile.position].caps[attrKey];
        const currentVal = this.profile.attributes[attrKey];
        const clampedTarget = Math.max(base, Math.min(cap, desiredVal));
        const delta = clampedTarget - currentVal;

        if (delta > 0) {
            const remaining = this.getRemainingPoints();
            const allowedDelta = Math.min(delta, remaining);
            this.profile.attributes[attrKey] = currentVal + allowedDelta;
        } else {
            this.profile.attributes[attrKey] = clampedTarget;
        }

        this.syncUIFromProfile();
    }

    syncUIFromProfile() {
        // Inputs texte
        const nameInput = document.getElementById('player-name-input');
        if (nameInput && document.activeElement !== nameInput) {
            nameInput.value = this.profile.playerName;
        }
        const numInput = document.getElementById('player-number-input');
        if (numInput && document.activeElement !== numInput) {
            numInput.value = this.profile.jerseyNumber;
        }

        // Presets actifs
        document.querySelectorAll('.preset-btn').forEach((btn) => {
            btn.classList.toggle('active', Number(btn.dataset.presetId) === Number(this.profile.id));
        });

        // Swatches peau
        document.querySelectorAll('.color-swatch').forEach((sw) => {
            sw.classList.toggle('active', sw.dataset.skinId === this.profile.skinTone);
        });

        // Selects
        const setSelectVal = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.value = val;
        };
        setSelectVal('hair-style-select', this.profile.hairStyle);
        setSelectVal('beard-style-select', this.profile.beardStyle);
        setSelectVal('hair-color-select', this.profile.hairColor);
        setSelectVal('jersey-color-select', this.profile.jerseyColor);

        // Cartes de Poste
        const posData = POSITIONS[this.profile.position] || POSITIONS.SF;
        document.querySelectorAll('.pos-card').forEach((card) => {
            card.classList.toggle('active', card.dataset.posCode === this.profile.position);
        });

        // Détails du poste sélectionné
        const posDescEl = document.getElementById('position-specialty-text');
        const posBonusEl = document.getElementById('position-bonuses-text');
        if (posDescEl) posDescEl.textContent = `${posData.name} (${posData.heightLabel}) — ${posData.specialty}`;
        if (posBonusEl) posBonusEl.textContent = posData.bonuses;

        // Pool de points restants
        const remaining = this.getRemainingPoints();
        const remEl = document.getElementById('remaining-points-badge');
        if (remEl) {
            remEl.textContent = `${remaining} PTS DISPONIBLES`;
            remEl.classList.toggle('empty', remaining === 0);
        }

        // Sliders et jauges des 4 atouts
        ['shooting', 'defense', 'dribble', 'finishing'].forEach((key) => {
            const val = this.profile.attributes[key];
            const cap = posData.caps[key];
            const slider = document.getElementById(`slider-${key}`);
            const valLabel = document.getElementById(`val-${key}`);
            const capLabel = document.getElementById(`cap-${key}`);
            const fillBar = document.getElementById(`fill-${key}`);

            if (slider) {
                slider.min = ATTRIBUTE_POOL.STARTING_BASE;
                slider.max = cap;
                slider.value = val;
            }
            if (valLabel) valLabel.textContent = val;
            if (capLabel) capLabel.textContent = `MAX ${cap}`;
            if (fillBar) {
                const pct = ((val - 50) / (99 - 50)) * 100;
                fillBar.style.width = `${Math.max(5, Math.min(100, pct))}%`;
            }
        });

        // Badge OVR Global
        const ovrBadge = document.getElementById('builder-ovr-value');
        if (ovrBadge) {
            const a = this.profile.attributes;
            const ovr = Math.round((a.shooting + a.defense + a.dribble + a.finishing) / 4);
            ovrBadge.textContent = ovr;
        }

        this.update3DPreview();
        this.saveProfile();
    }

    update3DPreview() {
        if (!this.characterMesh) return;
        this.characterMesh.updateConfig(this.profile);
        this.hideNameplate();
    }

    // Pas d'étiquette au-dessus de la tête ici : elle passait sous la carte « Note globale » (le nom est dans le champ,
    // la note dans la carte). Refaite à chaque reconstruction du modèle, d'où l'appel après updateConfig
    hideNameplate() {
        if (this.characterMesh.nameSprite) this.characterMesh.nameSprite.visible = false;
    }

    saveProfile() {
        try {
            localStorage.setItem('courtkings_player_profile', JSON.stringify(this.profile));
        } catch {
            /* données du site bloquées : le joueur n'est simplement pas gardé */
        }
    }

    getProfile() {
        return structuredClone(this.profile);
    }

    animate() {
        requestAnimationFrame(() => this.animate());

        const dt = 0.016;
        if (this.characterMesh) {
            this.characterMesh.root.rotation.y += (this.targetRotationY - this.characterMesh.root.rotation.y) * 0.1;
            this.characterMesh.updateAnimation(dt, this.previewAnimState);

            // Animer le ballon de prévisualisation selon l'état choisi
            if (this.previewBall) {
                if (this.previewAnimState === 'DRIBBLE' || this.previewAnimState === 'CROSSOVER') {
                    this.previewBall.visible = true;
                    const bounceY = Math.abs(Math.sin(this.characterMesh.animTime * 1.6)) * 0.68 + 0.14;
                    const sideX = this.previewAnimState === 'CROSSOVER'
                        ? Math.sin(this.characterMesh.animTime * 2.5) * 0.38
                        : 0.38;
                    this.previewBall.position.set(sideX, bounceY, 0.28);
                } else if (this.previewAnimState === 'SHOOT') {
                    this.previewBall.visible = true;
                    this.previewBall.position.set(0.05, 2.35, 0.18);
                } else {
                    this.previewBall.visible = true;
                    this.previewBall.position.set(0.42, 0.14, 0.25);
                }
            }
        }

        if (this.renderer && this.scene && this.camera) {
            this.renderer.render(this.scene, this.camera);
        }
    }
}
