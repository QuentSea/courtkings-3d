/**
 * AnimatedCharacter.js
 * Personnage animé (corps Quaternius CC0) avec la même interface que l'ancien CharacterMesh :
 * root, selectionRing, dribbleHand, animTime, updateAnimation(dt, état), updateConfig(config).
 * - Animations du pack (repos, course, sprint, saut, posture basse) avec fondus entre elles
 * - Gestes de basket par-dessus : les bras sont orientés vers une direction voulue (dribble, tir,
 *   dunk, contre, défense) en partant de la pose animée
 * - Tenue découpée dans le corps (CharacterAssets) : maillot avec numéro, short, chaussettes, chaussures
 */

import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { POSITIONS } from '../config/constants.js';
import { CharacterAssets } from './CharacterAssets.js';
import { CharacterMesh } from './CharacterMesh.js';
import { asColorTexture } from '../render/RenderSetup.js';
import { buildProceduralHair, HAIR_BASE_FROM_PACK } from './HairStyles.js';

// Coiffures et barbes du pack ; les autres styles reprennent les formes de l'ancien modèle
const PACK_HAIR_BY_STYLE = {
    buzz: 'hair_buzzed',
    fade_top: 'hair_simpleparted',
    long: 'hair_long',
    buns: 'hair_buns'
};
const PACK_BEARD_BY_STYLE = {
    full_beard: 'hair_beard',
    stubble: 'hair_beard',
    goatee: 'hair_beard',
    chinstrap: 'hair_beard'
};

const CLIPS = {
    idle: 'Idle_Loop',
    jog: 'Jog_Fwd_Loop',
    sprint: 'Sprint_Loop',
    crouchIdle: 'Crouch_Idle_Loop',
    crouchMove: 'Crouch_Fwd_Loop',
    air: 'Jump_Loop'
};
const LOCOMOTION = new Set(['jog', 'sprint', 'crouchMove']);
// Part de l'accroupi du pack dans la posture de défense (1 = accroupi complet, trop bas)
const DEFENSE_CROUCH = 0.3;

export class AnimatedCharacter {
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
            team: config.team || null,
            attributes: config.attributes || { shooting: 80, defense: 80, dribble: 80, finishing: 80 }
        };

        this.root = new THREE.Group();
        this.bodyGroup = new THREE.Group();
        this.root.add(this.bodyGroup);

        this.nameSprite = null;
        this.selectionRing = null;
        this.animState = 'IDLE';
        this.dribbleHand = 'RIGHT';
        this.animTime = 0;

        this.speed = 0;
        this.lastPos = null;
        this.overlayWeight = 0;
        this.overlayDirs = null;
        this.disposables = [];

        this.buildMesh();
    }

    buildMesh() {
        this.disposeOwned();
        while (this.bodyGroup.children.length > 0) this.bodyGroup.remove(this.bodyGroup.children[0]);
        if (this.nameSprite) this.root.remove(this.nameSprite);
        if (this.selectionRing) this.root.remove(this.selectionRing);

        const tpl = CharacterAssets.template;

        // 1. Modèle cloné (os compris), redressé, posé au sol et mis à l'échelle
        const wrapper = new THREE.Group();
        wrapper.quaternion.copy(tpl.wrapper.quaternion);
        wrapper.scale.setScalar(tpl.wrapper.scale);
        wrapper.position.y = tpl.wrapper.offsetY;
        const model = cloneSkinned(tpl.scene);
        wrapper.add(model);
        this.bodyGroup.add(wrapper);
        this.model = model;

        const skinned = [];
        model.traverse(o => { if (o.isSkinnedMesh) skinned.push(o); });
        const body = skinned.find(m => m.name === tpl.bodyName) || skinned[0];
        this.skeleton = body.skeleton;
        // La copie du modèle donne un squelette à chaque pièce (corps, yeux, sourcils...), chacun avec sa
        // texture d'os sur la carte graphique : les libérer avec le reste
        for (const m of skinned) this.disposables.push(m.skeleton);
        this.bones = {};
        for (const b of this.skeleton.bones) this.bones[b.name] = b;

        // 2. Peau teintée selon la couleur choisie, sourcils/cils à la couleur des cheveux
        const skinMat = body.material.clone();
        skinMat.color.copy(colorRatio(this.getSkinHex(), tpl.skinRef));
        body.material = skinMat;
        this.disposables.push(skinMat);
        for (const m of skinned) {
            m.castShadow = true;
            m.frustumCulled = false;
            if (m !== body && /Hair/i.test(m.material?.name || '')) {
                m.material = m.material.clone();
                m.material.color.set(this.getHairHex());
                this.disposables.push(m.material);
            }
        }

        // 3. Tenue de basket (mêmes os que le corps)
        const palette = this.getJerseyPalette();
        const jerseyTex = this.createJerseyTexture2(palette.primary, palette.secondary, this.config.jerseyNumber);
        const clothes = [
            ['jersey', new THREE.MeshStandardMaterial({ map: jerseyTex, roughness: 0.62, side: THREE.DoubleSide })],
            ['shorts', new THREE.MeshStandardMaterial({ color: palette.primary, roughness: 0.6, side: THREE.DoubleSide })],
            ['socks', new THREE.MeshStandardMaterial({ color: '#f1f5f9', roughness: 0.8 })],
            ['shoes', new THREE.MeshStandardMaterial({ color: palette.secondary, roughness: 0.32, metalness: 0.1 })]
        ];
        for (const [piece, mat] of clothes) {
            const mesh = new THREE.SkinnedMesh(tpl.clothing[piece], mat);
            mesh.frustumCulled = false;
            mesh.castShadow = true;
            body.parent.add(mesh);
            mesh.bind(this.skeleton, body.bindMatrix);
            this.disposables.push(mat);
        }
        this.disposables.push(jerseyTex);

        // 4. Coiffure et barbe
        this.attachHairAndBeard(body, palette.secondary);

        // 5. Anneau au sol et étiquette (comme l'ancien modèle)
        this.selectionRing = new THREE.Mesh(
            new THREE.RingGeometry(0.42, 0.54, 32),
            new THREE.MeshBasicMaterial({
                color: this.config.team === 'B' ? '#f43f5e' : '#38bdf8',
                side: THREE.DoubleSide,
                transparent: true,
                opacity: 0.75
            })
        );
        this.selectionRing.rotation.x = -Math.PI / 2;
        this.selectionRing.position.y = 0.02;
        this.root.add(this.selectionRing);

        const posData = POSITIONS[this.config.position] || POSITIONS.SF;
        this.bodyGroup.scale.set(posData.scaleXZ, posData.scaleY, posData.scaleXZ);
        this.nameSprite = this.createNameplateSprite(this.config.playerName, this.config.position, this.getOverallRating());
        this.nameSprite.position.y = 2.45 * posData.scaleY;
        this.root.add(this.nameSprite);
        // Étiquette et anneau sont refaits à chaque reconstruction : les libérer avec le reste
        this.disposables.push(this.nameSprite.material.map, this.nameSprite.material,
            this.selectionRing.geometry, this.selectionRing.material);

        // 6. Animations
        this.mixer = new THREE.AnimationMixer(model);
        this.actions = {};
        for (const [key, name] of Object.entries(CLIPS)) {
            const clip = CharacterAssets.clips[name];
            if (clip) this.actions[key] = this.mixer.clipAction(clip);
        }
        this.blendWeights = null;
        this.playAction('idle', 0);
        this.mixer.update(Math.random() * 2); // décaler les joueurs pour qu'ils ne bougent pas en même temps

        const side = tpl.armPlusX;
        const other = side === 'l' ? 'r' : 'l';
        this.arms = {
            plusX: { upper: this.bones[`upperarm_${side}`], lower: this.bones[`lowerarm_${side}`], hand: this.bones[`hand_${side}`] },
            minusX: { upper: this.bones[`upperarm_${other}`], lower: this.bones[`lowerarm_${other}`], hand: this.bones[`hand_${other}`] }
        };
    }

    attachHairAndBeard(body, accentColor) {
        const tpl = CharacterAssets.template;
        const hairHex = this.getHairHex();

        const attachPack = (id) => {
            const asset = CharacterAssets.hair[id];
            if (!asset) return false;
            const scene = cloneSkinned(asset.scene);
            const meshes = [];
            scene.traverse(o => { if (o.isSkinnedMesh) meshes.push(o); });
            for (const mesh of meshes) {
                // Relier la coiffure aux os du corps (mêmes noms) pour qu'elle suive la tête
                const bones = mesh.skeleton.bones.map(b => this.bones[b.name] || b);
                const skeleton = new THREE.Skeleton(bones, mesh.skeleton.boneInverses);
                this.disposables.push(skeleton);
                const mat = mesh.material.clone();
                mat.color.copy(colorRatio(hairHex, asset.colorRef));
                mesh.material = mat;
                mesh.frustumCulled = false;
                mesh.castShadow = true;
                const bindMatrix = mesh.bindMatrix.clone();
                body.parent.add(mesh);
                mesh.bind(skeleton, bindMatrix);
                this.disposables.push(mat);
            }
            return meshes.length > 0;
        };

        const style = this.config.hairStyle;
        const hairPack = PACK_HAIR_BY_STYLE[style] || HAIR_BASE_FROM_PACK[style];
        const beardPack = PACK_BEARD_BY_STYLE[this.config.beardStyle];
        const hairDone = hairPack ? attachPack(hairPack) : false;
        const beardDone = beardPack ? attachPack(beardPack) : false;

        // Styles sans équivalent dans le pack : coiffures fabriquées (HairStyles), sinon formes de
        // l'ancien modèle, posées sur l'os de la tête
        const hairMat = new THREE.MeshStandardMaterial({ color: hairHex, roughness: 0.85 });
        this.disposables.push(hairMat);
        const procedural = buildProceduralHair(style, hairMat, accentColor);
        const needHair = !procedural && !hairDone && style !== 'bald' && !PACK_HAIR_BY_STYLE[style];
        const needBeard = !beardDone && this.config.beardStyle !== 'none' && !beardPack;
        if (!procedural && !needHair && !needBeard) return;

        const headGroup = new THREE.Group();
        headGroup.matrixAutoUpdate = false;
        headGroup.matrix.copy(tpl.headAttach);
        const legacy = { config: this.config };
        if (procedural) {
            procedural.traverse(o => {
                if (!o.isMesh) return;
                this.disposables.push(o.geometry);
                if (o.userData.ownMaterial) this.disposables.push(o.userData.ownMaterial);
            });
            headGroup.add(procedural);
        }
        if (needHair) {
            // Les coiffures de l'ancien modèle descendaient sur les yeux : on les remonte un peu
            const hairGroup = new THREE.Group();
            hairGroup.position.y = 0.09;
            CharacterMesh.prototype.buildHair.call(legacy, hairGroup, hairMat, accentColor);
            headGroup.add(hairGroup);
        }
        if (needBeard) CharacterMesh.prototype.buildBeard.call(legacy, headGroup, hairMat);
        headGroup.traverse(o => { if (o.isMesh) o.castShadow = true; });
        this.bones.Head.add(headGroup);
    }

    /**
     * Maillot : moitié gauche = devant (logo + numéro), moitié droite = dos (grand numéro)
     */
    createJerseyTexture2(primary, secondary, numberText) {
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');
        const number = String(numberText || '23').slice(0, 2);

        ctx.fillStyle = primary;
        ctx.fillRect(0, 0, 512, 256);
        // Bandes sur les côtés et encolure
        ctx.fillStyle = secondary;
        for (const x of [0, 236, 256, 492]) ctx.fillRect(x, 0, 20, 256);
        ctx.fillRect(0, 238, 512, 18);

        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        // Devant
        ctx.fillStyle = '#ffffff';
        ctx.font = '900 26px "Chakra Petch", sans-serif';
        ctx.fillText('COURTKINGS', 128, 168);
        drawNumber(ctx, number, 128, 112, 78, secondary);
        // Dos
        drawNumber(ctx, number, 384, 140, 120, secondary);

        const tex = asColorTexture(new THREE.CanvasTexture(canvas));
        tex.anisotropy = 4;
        return tex;
    }

    /**
     * Mélange voulu des animations, ex. { crouchIdle: 0.55, idle: 0.45 } (total = 1) ; les poids
     * réels y glissent en douceur dans blendActions
     */
    playAction(key, fade = 0.18) {
        this.playBlend({ [key]: 1 }, fade);
    }

    playBlend(targets, fade = 0.18) {
        this.blendTargets = targets;
        this.blendFade = fade;
        if (!this.blendWeights) {
            // Première pose : directement à la cible
            this.blendWeights = { ...targets };
            this.blendActions(0);
        }
    }

    blendActions(dt) {
        const rate = this.blendFade > 0 ? Math.min(1, dt / this.blendFade * 2.5) : 1;
        let leader = null;
        for (const [key, action] of Object.entries(this.actions)) {
            const target = this.blendTargets[key] || 0;
            const w = (this.blendWeights[key] || 0) + (target - (this.blendWeights[key] || 0)) * (dt > 0 ? rate : 1);
            this.blendWeights[key] = w;
            if (w > 0.002) {
                if (!action.isRunning()) action.reset().play();
                action.setEffectiveWeight(w);
                if (LOCOMOTION.has(key) && (!leader || target > (this.blendTargets[leader] || 0))) leader = key;
            } else if (action.isRunning()) {
                action.stop();
                this.blendWeights[key] = 0;
            }
        }
        // Les animations de déplacement mélangées gardent le même rythme de pas
        if (leader) {
            const lead = this.actions[leader];
            const phase = lead.time / lead.getClip().duration;
            for (const key of LOCOMOTION) {
                const a = this.actions[key];
                if (key === leader || !a?.isRunning()) continue;
                const dur = a.getClip().duration;
                a.time = phase * dur;
                a.timeScale = lead.timeScale * dur / lead.getClip().duration;
            }
        }
    }

    updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
        this.buildMesh();
    }

    /**
     * Choisit l'animation selon l'état et la vitesse réelle, puis ajoute les gestes de basket
     */
    updateAnimation(dt, state = this.animState) {
        this.animState = state;
        const dribbleScore = this.config.attributes?.dribble || 75;
        const dribbleSpeedMultiplier = 0.8 + (dribbleScore / 99) * 0.75;
        this.animTime += dt * 7 * dribbleSpeedMultiplier; // même rythme que l'ancien modèle (ballon synchronisé)

        // Vitesse au sol mesurée d'une image à l'autre (marche aussi pour les joueurs distants et les bots)
        const p = this.root.position;
        if (this.lastPos && dt > 0) {
            const raw = Math.hypot(p.x - this.lastPos.x, p.z - this.lastPos.z) / dt;
            this.speed += (Math.min(raw, 12) - this.speed) * Math.min(1, dt * 10);
        }
        this.lastPos = { x: p.x, z: p.z };
        const moving = this.speed > 0.6;

        let key = moving ? 'jog' : 'idle';
        if (state === 'RUN') key = this.speed > 5.2 ? 'sprint' : 'jog';
        else if (state === 'SHOOT' || state === 'CONTEST' || state === 'DUNK') key = 'air';
        if (state === 'DEFENSE') {
            // Posture de défense : l'accroupi du pack mélangé avec la pose debout (genoux fléchis, dos droit)
            this.playBlend(moving ? { crouchMove: DEFENSE_CROUCH, jog: 1 - DEFENSE_CROUCH }
                : { crouchIdle: DEFENSE_CROUCH, idle: 1 - DEFENSE_CROUCH }, 0.2);
        } else if (state === 'SCREEN') {
            // Écran : appuis larges, un peu fléchi, immobile
            this.playBlend({ crouchIdle: 0.2, idle: 0.8 }, 0.15);
        } else {
            this.playAction(key, key === 'air' ? 0.1 : 0.2);
        }

        for (const [k, action] of Object.entries(this.actions)) {
            const ref = k === 'sprint' ? 6.5 : k === 'jog' || k === 'crouchMove' ? 3.6 : 0;
            action.timeScale = ref ? THREE.MathUtils.clamp(this.speed / ref, 0.6, 1.6) : 1;
        }
        this.blendActions(dt);
        this.mixer.update(dt);

        this.applyBasketballGestures(dt, state);
    }

    /**
     * Directions voulues des bras (repère du personnage : +Y haut, +Z devant, +X côté « droit » du jeu)
     */
    gestureDirections(state) {
        const v = (x, y, z) => new THREE.Vector3(x, y, z).normalize();
        const b = Math.abs(Math.sin(this.animTime * 1.6)); // 1 = ballon dans la main, 0 = ballon au sol
        const dribbling = state === 'DRIBBLE' || state === 'CROSSOVER';
        if (dribbling) {
            const sway = state === 'CROSSOVER' ? Math.sin(this.animTime * 2.5) : 0;
            const handSide = state === 'CROSSOVER' ? (sway >= 0 ? 'plusX' : 'minusX') : (this.dribbleHand === 'RIGHT' ? 'plusX' : 'minusX');
            const s = handSide === 'plusX' ? 1 : -1;
            const guard = handSide === 'plusX' ? 'minusX' : 'plusX';
            return {
                [handSide]: [v(0.35 * s, -1, 0.3), v(0.15 * s, -0.55 - 0.45 * (1 - b), 0.55)],
                [guard]: [v(-0.4 * s, -0.8, 0.45), v(-0.1 * s, -0.15, 1)]
            };
        }
        if (state === 'SHOOT') {
            return { plusX: [v(0.1, 1, 0.45), v(0, 1, 0.55)], minusX: [v(-0.2, 1, 0.55), v(0.25, 0.9, 0.3)] };
        }
        if (state === 'DUNK') {
            return { plusX: [v(0.1, 1, 0.25), v(0, 1, 0.15)], minusX: [v(-0.7, 0.3, 0.4), v(-0.4, 0.4, 0.6)] };
        }
        if (state === 'CONTEST') {
            return { plusX: [v(0.15, 1, 0.2), v(0.05, 1, 0.1)], minusX: [v(-0.15, 1, 0.2), v(-0.05, 1, 0.1)] };
        }
        if (state === 'SCREEN') {
            // Bras croisés contre la poitrine (écran réglementaire)
            return { plusX: [v(0.3, -0.75, 0.55), v(-0.95, 0.2, 0.3)], minusX: [v(-0.3, -0.7, 0.55), v(0.95, 0.25, 0.3)] };
        }
        if (state === 'DEFENSE') {
            // Une main haute (contre le tir), une main basse et écartée (contre le dribble)
            return { plusX: [v(1, 0.05, 0.3), v(0.75, 0.6, 0.35)], minusX: [v(-1, -0.4, 0.35), v(-0.85, -0.25, 0.6)] };
        }
        return null;
    }

    applyBasketballGestures(dt, state) {
        const dirs = this.gestureDirections(state);
        if (dirs) this.overlayDirs = dirs;
        const target = dirs ? 1 : 0;
        this.overlayWeight += (target - this.overlayWeight) * Math.min(1, dt * 14);
        if (this.overlayWeight < 0.01 || !this.overlayDirs) return;

        this.root.updateMatrixWorld(true);
        const charQuat = this.root.getWorldQuaternion(new THREE.Quaternion());
        for (const [sideKey, [upperDir, lowerDir]] of Object.entries(this.overlayDirs)) {
            const arm = this.arms[sideKey];
            if (!arm?.upper || !arm.lower || !arm.hand) continue;
            aimBone(arm.upper, arm.lower, upperDir.clone().applyQuaternion(charQuat), this.overlayWeight);
            aimBone(arm.lower, arm.hand, lowerDir.clone().applyQuaternion(charQuat), this.overlayWeight);
        }
    }

    disposeOwned() {
        for (const d of this.disposables) d.dispose?.();
        this.disposables = [];
        if (this.mixer) this.mixer.stopAllAction();
    }
}

// Couleurs, étiquette et note : mêmes règles que l'ancien modèle
for (const name of ['getSkinHex', 'getHairHex', 'getJerseyPalette', 'createNameplateSprite', 'getOverallRating']) {
    AnimatedCharacter.prototype[name] = CharacterMesh.prototype[name];
}

/**
 * Teinte qui transforme la couleur moyenne d'une texture en la couleur voulue (multiplication)
 */
function colorRatio(hex, ref) {
    const want = new THREE.Color(hex);
    return new THREE.Color(
        Math.min(2.2, want.r / Math.max(ref.r, 0.02)),
        Math.min(2.2, want.g / Math.max(ref.g, 0.02)),
        Math.min(2.2, want.b / Math.max(ref.b, 0.02))
    );
}

function drawNumber(ctx, number, x, y, size, outline) {
    ctx.font = `900 ${size}px "Chakra Petch", sans-serif`;
    ctx.lineWidth = Math.round(size / 9);
    ctx.strokeStyle = outline;
    ctx.strokeText(number, x, y);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(number, x, y);
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _wq = new THREE.Quaternion();
const _pq = new THREE.Quaternion();

/**
 * Oriente un os pour que la direction os -> enfant pointe vers dirWorld (mélangé avec la pose animée)
 */
function aimBone(bone, child, dirWorld, weight) {
    bone.getWorldPosition(_a);
    child.getWorldPosition(_b);
    const current = _b.sub(_a).normalize();
    _q.setFromUnitVectors(current, dirWorld);
    bone.getWorldQuaternion(_wq);
    bone.parent.getWorldQuaternion(_pq);
    const targetLocal = _pq.invert().multiply(_q.multiply(_wq));
    bone.quaternion.slerp(targetLocal, weight);
    bone.updateMatrixWorld(true);
}
