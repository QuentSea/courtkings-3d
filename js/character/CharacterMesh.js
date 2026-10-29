/**
 * CharacterMesh.js
 * Générateur procédural 3D modulaire pour les personnages de basketball.
 * Gère :
 * - L'anatomie articulée (Torse, Tête, Bras gauche/droit, Jambes gauche/droite)
 * - Le gabarit selon le poste (PG à C)
 * - Les teintes de peau, coiffures 3D, barbes 3D, numéro et couleurs de maillot
 * - L'étiquette 3D (Sprite Canvas) avec Pseudonyme + Poste au-dessus du joueur
 * - Les animations procédurales basées sur les états (Idle, Run, Dribble, Crossover, Shoot, Dunk, Defense, Jump)
 */

import * as THREE from 'three';
import {
    SKIN_TONES,
    HAIR_COLORS,
    JERSEY_COLORS,
    POSITIONS
} from '../config/constants.js';
import { asColorTexture, disposeTree } from '../render/RenderSetup.js';

export class CharacterMesh {
    constructor(config = {}) {
        this.config = {
            playerName: config.playerName || 'Baller',
            position: config.position || 'SF',
            skinTone: config.skinTone || 'skin_4',
            hairStyle: config.hairStyle || 'afro',
            beardStyle: config.beardStyle || 'goatee',
            hairColor: config.hairColor || 'black',
            jerseyColor: config.jerseyColor || 'lakers_gold',
            jerseyNumber: config.jerseyNumber || '23',
            team: config.team || null, // 'A' or 'B' in match
            attributes: config.attributes || { shooting: 80, defense: 80, dribble: 80, finishing: 80 }
        };

        this.root = new THREE.Group();
        this.bodyGroup = new THREE.Group();
        this.root.add(this.bodyGroup);

        // Références d'articulations pour l'animation procédurale
        this.joints = {
            torso: null,
            headGroup: null,
            leftArmPivot: null,
            rightArmPivot: null,
            leftForearm: null,
            rightForearm: null,
            leftLegPivot: null,
            rightLegPivot: null,
            ballMountRight: null,
            ballMountLeft: null
        };

        this.nameSprite = null;
        this.selectionRing = null;
        this.animState = 'IDLE'; // IDLE, RUN, DRIBBLE, CROSSOVER, SHOOT, DUNK, DEFENSE, CONTEST
        this.dribbleHand = 'RIGHT'; // RIGHT or LEFT
        this.animTime = 0;

        this.buildMesh();
    }

    getSkinHex() {
        const found = SKIN_TONES.find(s => s.id === this.config.skinTone);
        return found ? found.hex : '#b8764f';
    }

    getHairHex() {
        const found = HAIR_COLORS.find(h => h.id === this.config.hairColor);
        return found ? found.hex : '#18181b';
    }

    getJerseyPalette() {
        if (this.config.team === 'A') {
            return { primary: '#2563eb', secondary: '#60a5fa' }; // Équipe A : Bleu
        }
        if (this.config.team === 'B') {
            return { primary: '#e11d48', secondary: '#fbbf24' }; // Équipe B : Rouge/Or
        }
        const found = JERSEY_COLORS.find(j => j.id === this.config.jerseyColor);
        return found || { primary: '#f59e0b', secondary: '#581c87' };
    }

    /**
     * Crée une texture Canvas dynamique pour le devant/dos du maillot avec numéro
     */
    createJerseyTexture(primaryColor, secondaryColor, numberText) {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');

        // Fond maillot
        ctx.fillStyle = primaryColor;
        ctx.fillRect(0, 0, 256, 256);

        // Bandes latérales et col
        ctx.fillStyle = secondaryColor;
        ctx.fillRect(0, 0, 22, 256);
        ctx.fillRect(234, 0, 22, 256);
        ctx.fillRect(0, 0, 256, 18);

        // Texte "COURTKINGS" au-dessus du numéro
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 22px "Chakra Petch", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('COURTKINGS', 128, 65);

        // Numéro du joueur
        ctx.fillStyle = secondaryColor;
        ctx.font = '900 108px "Chakra Petch", sans-serif';
        ctx.fillText(String(numberText || '23').slice(0, 2), 132, 175);

        ctx.fillStyle = '#ffffff';
        ctx.font = '900 108px "Chakra Petch", sans-serif';
        ctx.fillText(String(numberText || '23').slice(0, 2), 128, 171);

        const texture = asColorTexture(new THREE.CanvasTexture(canvas));
        texture.needsUpdate = true;
        return texture;
    }

    /**
     * Crée le badge 3D (Sprite) affiché au-dessus de la tête du joueur
     */
    createNameplateSprite(name, posCode, ovr) {
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');

        ctx.clearRect(0, 0, 512, 128);

        // Fond pilule sombre
        ctx.fillStyle = 'rgba(10, 14, 26, 0.85)';
        ctx.beginPath();
        ctx.roundRect(36, 20, 440, 82, 41);
        ctx.fill();

        ctx.lineWidth = 4;
        ctx.strokeStyle = this.config.team === 'B' ? '#f43f5e' : '#38bdf8';
        ctx.stroke();

        // Badge Poste + OVR
        ctx.fillStyle = this.config.team === 'B' ? '#e11d48' : '#0284c7';
        ctx.beginPath();
        ctx.roundRect(48, 32, 108, 58, 29);
        ctx.fill();

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 26px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`${posCode} ${ovr}`, 102, 70);

        // Nom du joueur
        ctx.fillStyle = '#f8fafc';
        ctx.font = 'bold 34px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(String(name || 'Baller').slice(0, 14), 174, 72);

        const tex = asColorTexture(new THREE.CanvasTexture(canvas));
        // Étiquette = interface : pas d'effet d'éclairage « cinéma », couleurs exactes
        const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, toneMapped: false });
        const sprite = new THREE.Sprite(mat);
        sprite.scale.set(2.2, 0.55, 1);
        sprite.position.set(0, 2.55, 0);
        return sprite;
    }

    getOverallRating() {
        const a = this.config.attributes || { shooting: 80, defense: 80, dribble: 80, finishing: 80 };
        return Math.round((a.shooting + a.defense + a.dribble + a.finishing) / 4);
    }

    /**
     * Construit ou reconstruit intégralement le Mesh 3D haute-fidélité du personnage
     */
    /**
     * Retire et libère le corps, l'étiquette et l'anneau (reconstruction ou joueur qui quitte la scène)
     */
    disposeOwned() {
        for (const obj of [...this.bodyGroup.children, this.nameSprite, this.selectionRing]) {
            if (!obj) continue;
            obj.parent?.remove(obj);
            disposeTree(obj);
        }
        this.nameSprite = null;
        this.selectionRing = null;
    }

    buildMesh() {
        this.disposeOwned();

        const skinMat = new THREE.MeshStandardMaterial({
            color: this.getSkinHex(),
            roughness: 0.48,
            metalness: 0.06
        });

        const hairMat = new THREE.MeshStandardMaterial({
            color: this.getHairHex(),
            roughness: 0.72
        });

        const palette = this.getJerseyPalette();
        const jerseyTex = this.createJerseyTexture(palette.primary, palette.secondary, this.config.jerseyNumber);

        const jerseyMat = new THREE.MeshStandardMaterial({
            map: jerseyTex,
            roughness: 0.52
        });

        const shortsMat = new THREE.MeshStandardMaterial({
            color: palette.primary,
            roughness: 0.58
        });

        const accentMat = new THREE.MeshStandardMaterial({
            color: palette.secondary,
            roughness: 0.4
        });

        const shoeMat = new THREE.MeshStandardMaterial({
            color: palette.secondary,
            roughness: 0.30,
            metalness: 0.18
        });

        const darkTrimMat = new THREE.MeshStandardMaterial({
            color: '#111827',
            roughness: 0.5
        });

        // 1. TORSE ATHLÉTIQUE, ÉPAULES, COL V & SHORT DÉTAILLÉ
        const torsoGroup = new THREE.Group();
        torsoGroup.position.set(0, 1.15, 0);

        // Poitrine / Maillot principal
        const chestMesh = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.66, 0.30), jerseyMat);
        chestMesh.position.set(0, 0.13, 0);
        chestMesh.castShadow = true;
        torsoGroup.add(chestMesh);

        // Col en V / Bordure d'encolure et emmanchures pro
        const collarRing = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.022, 10, 20), accentMat);
        collarRing.rotation.x = Math.PI / 2 - 0.18;
        collarRing.position.set(0, 0.46, 0.03);
        torsoGroup.add(collarRing);

        // Ceinture élastique du short
        const waistband = new THREE.Mesh(new THREE.BoxGeometry(0.59, 0.07, 0.33), accentMat);
        waistband.position.set(0, -0.19, 0);
        torsoGroup.add(waistband);

        // Corps du short + jambes de short amples avec bandes latérales
        const shortsPelvis = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.24, 0.32), shortsMat);
        shortsPelvis.position.set(0, -0.32, 0);
        shortsPelvis.castShadow = true;
        torsoGroup.add(shortsPelvis);

        [-0.295, 0.295].forEach((sideX) => {
            const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.28, 0.08), accentMat);
            stripe.position.set(sideX, -0.32, 0);
            torsoGroup.add(stripe);
        });

        this.joints.torso = torsoGroup;
        this.bodyGroup.add(torsoGroup);

        // 2. TÊTE SCULPTÉE, VISAGE DÉTAILLÉ (NEZ, SOURCILS, BOUCHE, OREILLES), COIFFURE & BARBE
        const headGroup = new THREE.Group();
        headGroup.position.set(0, 0.66, 0);
        torsoGroup.add(headGroup);
        this.joints.headGroup = headGroup;

        // Cou musculaire + Trapèzes
        const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.115, 0.16, 14), skinMat);
        neck.position.set(0, -0.12, 0);
        headGroup.add(neck);

        // Crâne / Visage aux bords adoucis (combinaison boîte + dôme crânien + mâchoire)
        const headMesh = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.36, 0.35), skinMat);
        headMesh.position.set(0, 0.07, 0);
        headMesh.castShadow = true;
        headGroup.add(headMesh);

        const craniumDome = new THREE.Mesh(new THREE.SphereGeometry(0.185, 16, 12), skinMat);
        craniumDome.scale.set(0.98, 0.55, 0.98);
        craniumDome.position.set(0, 0.22, 0);
        headGroup.add(craniumDome);

        // Nez 3D en relief
        const noseBridge = new THREE.Mesh(new THREE.BoxGeometry(0.048, 0.095, 0.045), skinMat);
        noseBridge.position.set(0, 0.075, 0.185);
        noseBridge.rotation.x = -0.15;
        headGroup.add(noseBridge);

        // Yeux (Sclère, Iris, Pupille) & Sourcils expressifs
        const eyeMat = new THREE.MeshBasicMaterial({ color: '#0f172a' });
        const eyeWhiteMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });

        [-0.082, 0.082].forEach((eyeX, i) => {
            const eyeW = new THREE.Mesh(new THREE.BoxGeometry(0.072, 0.038, 0.02), eyeWhiteMat);
            eyeW.position.set(eyeX, 0.115, 0.176);
            headGroup.add(eyeW);

            const pupil = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.036, 0.025), eyeMat);
            pupil.position.set(eyeX, 0.115, 0.181);
            headGroup.add(pupil);

            // Arcade / Sourcil
            const brow = new THREE.Mesh(new THREE.BoxGeometry(0.086, 0.022, 0.028), hairMat);
            brow.position.set(eyeX, 0.152, 0.18);
            brow.rotation.z = i === 0 ? -0.08 : 0.08;
            headGroup.add(brow);
        });

        // Bouche / Lèvres
        const mouthMat = new THREE.MeshStandardMaterial({ color: '#451a1c', roughness: 0.6 });
        const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.022, 0.02), mouthMat);
        mouth.position.set(0, -0.025, 0.178);
        headGroup.add(mouth);

        // Oreilles sculptées
        [-0.185, 0.185].forEach((earX) => {
            const ear = new THREE.Mesh(new THREE.SphereGeometry(0.042, 10, 10), skinMat);
            ear.scale.set(0.45, 1.15, 0.75);
            ear.position.set(earX, 0.075, -0.01);
            headGroup.add(ear);
        });

        // Construction modulaire de la Coiffure 3D
        this.buildHair(headGroup, hairMat, palette.secondary);

        // Construction modulaire de la Barbe 3D
        this.buildBeard(headGroup, hairMat);

        // 3. BRAS GAUCHE & DROIT (Avec Deltoïdes, Manchon Shooter Sleeve & Doigts)
        this.joints.leftArmPivot = this.createArm(torsoGroup, -0.35, skinMat, palette.secondary, 'left');
        this.joints.rightArmPivot = this.createArm(torsoGroup, 0.35, skinMat, palette.secondary, 'right');

        // 4. JAMBES GAUCHE & DROITE (Avec Jambières, Genouillères & Sneakers Pro détaillées)
        this.joints.leftLegPivot = this.createLeg(torsoGroup, -0.15, skinMat, shortsMat, shoeMat, darkTrimMat);
        this.joints.rightLegPivot = this.createLeg(torsoGroup, 0.15, skinMat, shortsMat, shoeMat, darkTrimMat);

        // 5. Anneau au sol sous le joueur
        const ringGeo = new THREE.RingGeometry(0.42, 0.54, 32);
        const ringMat = new THREE.MeshBasicMaterial({
            color: this.config.team === 'B' ? '#f43f5e' : '#38bdf8',
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.75
        });
        this.selectionRing = new THREE.Mesh(ringGeo, ringMat);
        this.selectionRing.rotation.x = -Math.PI / 2;
        this.selectionRing.position.y = 0.02;
        this.root.add(this.selectionRing);

        // 6. Appliquer le gabarit du Poste (PG, SG, SF, PF, C)
        const posData = POSITIONS[this.config.position] || POSITIONS.SF;
        this.bodyGroup.scale.set(posData.scaleXZ, posData.scaleY, posData.scaleXZ);

        // 7. Étiquette Nom + Poste + OVR au-dessus du personnage
        this.nameSprite = this.createNameplateSprite(
            this.config.playerName,
            this.config.position,
            this.getOverallRating()
        );
        this.nameSprite.position.y = 2.45 * posData.scaleY;
        this.root.add(this.nameSprite);
    }

    buildHair(headGroup, hairMat, headbandColor) {
        const style = this.config.hairStyle;
        if (style === 'bald') return;

        if (style === 'buzz') {
            const cap = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.12, 0.38), hairMat);
            cap.position.set(0, 0.25, 0);
            headGroup.add(cap);
        } else if (style === 'afro') {
            const afro = new THREE.Mesh(new THREE.SphereGeometry(0.31, 18, 18), hairMat);
            afro.position.set(0, 0.28, -0.02);
            headGroup.add(afro);
        } else if (style === 'fade_top') {
            const top = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.24, 0.34), hairMat);
            top.position.set(0, 0.34, 0);
            headGroup.add(top);
        } else if (style === 'mohawk') {
            const hawk = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.28, 0.40), hairMat);
            hawk.position.set(0, 0.35, -0.01);
            headGroup.add(hawk);
        } else if (style === 'dreads') {
            const base = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.14, 0.38), hairMat);
            base.position.set(0, 0.26, 0);
            headGroup.add(base);
            for (let i = -2; i <= 2; i++) {
                const lock = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.025, 0.28, 8), hairMat);
                lock.position.set(i * 0.07, 0.16, -0.19);
                lock.rotation.x = 0.25;
                headGroup.add(lock);
            }
        } else if (style === 'headband_curls') {
            const curls = new THREE.Mesh(new THREE.SphereGeometry(0.25, 14, 14), hairMat);
            curls.position.set(0, 0.30, 0);
            headGroup.add(curls);

            const bandMat = new THREE.MeshStandardMaterial({ color: headbandColor, roughness: 0.4 });
            const band = new THREE.Mesh(new THREE.BoxGeometry(0.39, 0.07, 0.39), bandMat);
            band.position.set(0, 0.21, 0);
            headGroup.add(band);
        }
    }

    buildBeard(headGroup, hairMat) {
        const style = this.config.beardStyle;
        if (style === 'none') return;

        if (style === 'goatee') {
            const chin = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.11, 0.06), hairMat);
            chin.position.set(0, -0.08, 0.17);
            const stache = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.035, 0.05), hairMat);
            stache.position.set(0, -0.01, 0.18);
            headGroup.add(chin, stache);
        } else if (style === 'stubble') {
            const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.365, 0.14, 0.365), hairMat);
            jaw.position.set(0, -0.05, 0.005);
            headGroup.add(jaw);
        } else if (style === 'full_beard') {
            const full = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.24, 0.26), hairMat);
            full.position.set(0, -0.09, 0.09);
            headGroup.add(full);
        } else if (style === 'chinstrap') {
            const strap = new THREE.Mesh(new THREE.BoxGeometry(0.375, 0.06, 0.37), hairMat);
            strap.position.set(0, -0.09, 0.01);
            headGroup.add(strap);
        } else if (style === 'mustache') {
            const stache = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.05, 0.06), hairMat);
            stache.position.set(0, -0.01, 0.185);
            headGroup.add(stache);
        }
    }

    createArm(parent, offsetX, skinMat, bandColor, side) {
        const pivot = new THREE.Group();
        pivot.position.set(offsetX, 0.40, 0);
        parent.add(pivot);

        // Deltoïde / Épaule musclée arrondie
        const shoulder = new THREE.Mesh(new THREE.SphereGeometry(0.095, 14, 14), skinMat);
        shoulder.position.set(0, -0.02, 0);
        shoulder.castShadow = true;
        pivot.add(shoulder);

        // Biceps / Bras supérieur
        const upperArm = new THREE.Mesh(new THREE.CylinderGeometry(0.082, 0.072, 0.34, 12), skinMat);
        upperArm.position.set(0, -0.17, 0);
        upperArm.castShadow = true;
        pivot.add(upperArm);

        // Avant-bras (avec Manchon de Tir / Shooter Sleeve sur le bras droit)
        const forearmGroup = new THREE.Group();
        forearmGroup.position.set(0, -0.34, 0);
        pivot.add(forearmGroup);

        const sleeveMat = new THREE.MeshStandardMaterial({
            color: bandColor,
            roughness: 0.45
        });

        const forearm = new THREE.Mesh(
            new THREE.CylinderGeometry(0.070, 0.058, 0.34, 12),
            side === 'right' ? sleeveMat : skinMat
        );
        forearm.position.set(0, -0.16, 0);
        forearm.castShadow = true;
        forearmGroup.add(forearm);

        // Bandeau de poignet (Sweatband) sur le bras gauche
        if (side === 'left') {
            const wristband = new THREE.Mesh(new THREE.CylinderGeometry(0.066, 0.064, 0.07, 12), sleeveMat);
            wristband.position.set(0, -0.28, 0);
            forearmGroup.add(wristband);
        }

        // Paume de la main + Pouce articulé
        const hand = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.11, 0.05), skinMat);
        hand.position.set(0, -0.36, 0.01);
        forearmGroup.add(hand);

        const thumb = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.05, 0.028), skinMat);
        thumb.position.set(side === 'left' ? 0.048 : -0.048, -0.35, 0.03);
        thumb.rotation.z = side === 'left' ? -0.4 : 0.4;
        forearmGroup.add(thumb);

        if (side === 'left') {
            this.joints.leftForearm = forearmGroup;
            this.joints.ballMountLeft = hand;
        } else {
            this.joints.rightForearm = forearmGroup;
            this.joints.ballMountRight = hand;
        }

        return pivot;
    }

    createLeg(parent, offsetX, skinMat, shortsMat, shoeMat, darkTrimMat) {
        const pivot = new THREE.Group();
        pivot.position.set(offsetX, -0.46, 0);
        parent.add(pivot);

        // Bas de jambe du short ample qui suit le mouvement de la cuisse
        const shortLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.135, 0.125, 0.22, 14), shortsMat);
        shortLeg.position.set(0, -0.08, 0);
        shortLeg.castShadow = true;
        pivot.add(shortLeg);

        // Cuisse
        const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.102, 0.086, 0.36, 12), skinMat);
        thigh.position.set(0, -0.20, 0);
        thigh.castShadow = true;
        pivot.add(thigh);

        // Genouillère de protection (Hex Knee Pad noir pro)
        const kneePad = new THREE.Mesh(new THREE.CylinderGeometry(0.088, 0.084, 0.11, 12), darkTrimMat);
        kneePad.position.set(0, -0.36, 0.005);
        pivot.add(kneePad);

        // Mollet athlétique
        const calf = new THREE.Mesh(new THREE.CylinderGeometry(0.082, 0.064, 0.34, 12), skinMat);
        calf.position.set(0, -0.50, 0);
        calf.castShadow = true;
        pivot.add(calf);

        // Chaussette montante NBA blanche avec double bande
        const sockMat = new THREE.MeshStandardMaterial({ color: '#f8fafc', roughness: 0.7 });
        const sock = new THREE.Mesh(new THREE.CylinderGeometry(0.072, 0.068, 0.18, 12), sockMat);
        sock.position.set(0, -0.57, 0);
        pivot.add(sock);

        // Chaussure (Sneaker Basket High-Top détaillée : Tige, Semelle blanche, Languette)
        const shoeGroup = new THREE.Group();
        shoeGroup.position.set(0, -0.66, 0.05);
        pivot.add(shoeGroup);

        const soleMat = new THREE.MeshStandardMaterial({ color: '#f8fafc', roughness: 0.4 });
        const sole = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.042, 0.32), soleMat);
        sole.position.set(0, -0.04, 0);
        sole.castShadow = true;
        shoeGroup.add(sole);

        const upperShoe = new THREE.Mesh(new THREE.BoxGeometry(0.158, 0.085, 0.28), shoeMat);
        upperShoe.position.set(0, 0.015, -0.01);
        upperShoe.castShadow = true;
        shoeGroup.add(upperShoe);

        const ankleCollar = new THREE.Mesh(new THREE.CylinderGeometry(0.076, 0.078, 0.06, 12), darkTrimMat);
        ankleCollar.position.set(0, 0.065, -0.05);
        shoeGroup.add(ankleCollar);

        return pivot;
    }

    updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
        this.buildMesh();
    }

    /**
     * Met à jour les animations procédurales selon l'état du joueur et son score d'atout Dribble
     */
    updateAnimation(dt, state = this.animState) {
        this.animState = state;
        const dribbleScore = (this.config.attributes?.dribble || 75);
        // La vitesse et fluidité de dribble s'adaptent directement à l'atout "Dribble"
        const dribbleSpeedMultiplier = 0.8 + (dribbleScore / 99) * 0.75;

        this.animTime += dt * 7 * dribbleSpeedMultiplier;

        const {
            torso,
            leftArmPivot,
            rightArmPivot,
            leftForearm,
            rightForearm,
            leftLegPivot,
            rightLegPivot
        } = this.joints;

        if (!torso) return;

        // Reset de base
        torso.rotation.set(0, 0, 0);
        torso.position.y = 1.15;
        leftForearm.rotation.set(0, 0, 0);
        rightForearm.rotation.set(0, 0, 0);

        if (state === 'IDLE') {
            const breathe = Math.sin(this.animTime * 0.4) * 0.03;
            torso.position.y = 1.15 + breathe;
            leftArmPivot.rotation.set(0, 0, 0.08);
            rightArmPivot.rotation.set(0, 0, -0.08);
            leftLegPivot.rotation.set(0, 0, 0);
            rightLegPivot.rotation.set(0, 0, 0);
        } else if (state === 'RUN') {
            const swing = Math.sin(this.animTime * 1.35) * 0.65;
            torso.rotation.x = 0.14;
            torso.position.y = 1.15 + Math.abs(Math.cos(this.animTime * 1.35)) * 0.06;
            leftLegPivot.rotation.x = swing;
            rightLegPivot.rotation.x = -swing;
            leftArmPivot.rotation.x = -swing * 0.8;
            rightArmPivot.rotation.x = swing * 0.8;
            leftForearm.rotation.x = -0.5;
            rightForearm.rotation.x = -0.5;
        } else if (state === 'DRIBBLE') {
            const swing = Math.sin(this.animTime * 1.2) * 0.45;
            const bounce = Math.abs(Math.sin(this.animTime * 1.6));
            torso.rotation.x = 0.18;
            torso.position.y = 1.11 + bounce * 0.05;
            leftLegPivot.rotation.x = swing;
            rightLegPivot.rotation.x = -swing;

            if (this.dribbleHand === 'RIGHT') {
                rightArmPivot.rotation.set(-0.45 + bounce * 0.55, 0, -0.15);
                rightForearm.rotation.x = -0.65;
                leftArmPivot.rotation.set(-0.3, 0, 0.35); // Bras de protection (off-arm guard)
            } else {
                leftArmPivot.rotation.set(-0.45 + bounce * 0.55, 0, 0.15);
                leftForearm.rotation.x = -0.65;
                rightArmPivot.rotation.set(-0.3, 0, -0.35);
            }
        } else if (state === 'CROSSOVER') {
            const crossSwing = Math.sin(this.animTime * 2.5);
            torso.rotation.z = crossSwing * 0.22;
            torso.rotation.x = 0.25;
            torso.position.y = 1.06;
            leftArmPivot.rotation.set(-0.6, 0, 0.4 * crossSwing);
            rightArmPivot.rotation.set(-0.6, 0, -0.4 * crossSwing);
            leftLegPivot.rotation.z = 0.12;
            rightLegPivot.rotation.z = -0.12;
        } else if (state === 'SHOOT') {
            // Saut vertical et bras levés vers le cercle ("Jump Shot")
            torso.rotation.x = -0.06;
            rightArmPivot.rotation.set(-2.65, 0, -0.05);
            leftArmPivot.rotation.set(-2.35, 0, 0.15);
            rightForearm.rotation.x = -0.25;
            leftLegPivot.rotation.x = 0.12;
            rightLegPivot.rotation.x = -0.08;
        } else if (state === 'DUNK') {
            // Animation Tomahawk / Poster Dunk : corps penché vers l'arceau, bras droit armé au-dessus de la tête, jambes groupées en vol
            torso.rotation.x = 0.22;
            torso.position.y = 1.22;
            rightArmPivot.rotation.set(-3.05, 0, -0.18);
            rightForearm.rotation.x = -0.25;
            leftArmPivot.rotation.set(-1.35, 0, 0.55);
            leftLegPivot.rotation.x = -0.55;
            rightLegPivot.rotation.x = 0.42;
        } else if (state === 'DEFENSE') {
            // Posture défensive basse ("Defensive Stance") + bras écartés
            torso.position.y = 1.03;
            torso.rotation.x = 0.22;
            leftArmPivot.rotation.set(-0.35, 0, 0.85);
            rightArmPivot.rotation.set(-0.35, 0, -0.85);
            leftLegPivot.rotation.set(-0.2, 0, 0.18);
            rightLegPivot.rotation.set(-0.2, 0, -0.18);
        } else if (state === 'CONTEST') {
            // Saut de Contre / Extension verticale bras levés et jambes fléchies en l'air
            torso.rotation.x = -0.08;
            rightArmPivot.rotation.set(-2.95, 0, -0.10);
            leftArmPivot.rotation.set(-2.95, 0, 0.10);
            rightForearm.rotation.x = -0.15;
            leftForearm.rotation.x = -0.15;
            leftLegPivot.rotation.x = 0.22;
            rightLegPivot.rotation.x = -0.18;
        }
    }
}
