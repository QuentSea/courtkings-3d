/**
 * AnimatedCharacter.js
 * Personnage animé (corps Quaternius CC0) avec la même interface que l'ancien CharacterMesh :
 * root, selectionRing, dribbleHand, animTime, updateAnimation(dt, état), updateConfig(config).
 * - Animations du pack (repos, course, sprint, saut, posture basse, danse) avec fondus entre elles ;
 *   jouées à l'envers pour reculer, remplacées par des pas chassés quand le joueur se déplace de côté
 * - Par-dessus, en procédural (applyProcedural) : bassin qui descend avec les pieds qui restent au sol
 *   (IK des jambes : flexion avant le tir, réception de saut, posture de défense, box-out), buste penché
 *   (sprint, dribble, virages, faute subie), main de dribble qui suit le ballon (IK du bras), gestes en
 *   plusieurs temps (tir : armé, mise en place, poignet cassé ; lay-up : genou levé ; dunk : bras armé puis
 *   smash), réactions (faute, célébration, défaite) ; danse des vainqueurs
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
    walk: 'Walk_Loop',
    jog: 'Jog_Fwd_Loop',
    sprint: 'Sprint_Loop',
    crouchIdle: 'Crouch_Idle_Loop',
    crouchMove: 'Crouch_Fwd_Loop',
    air: 'Jump_Loop',
    dance: 'Dance_Loop'
};
const LOCOMOTION = new Set(['walk', 'jog', 'sprint', 'crouchMove']);
// Distance parcourue par cycle de pas (2 pas) de chaque animation, à l'échelle 1 : mesurée sur le pied d'appui.
// La course du pack fait de grands bonds (5,5 m par cycle) : mélangée à la marche, la foulée raccourcit
// (le mélange garde une foulée proportionnelle aux poids, vérifié à 30, 50 et 70 %)
const STRIDE = { walk: 1.42, jog: 5.49, sprint: 5.83, crouchMove: 1.57 };
// Part de l'accroupi du pack dans la posture de défense (1 = accroupi complet, trop bas)
const DEFENSE_CROUCH = 0.3;
const LAND_TIME = 0.28;      // amorti des genoux à la réception d'un saut (s)
const NO_INFO = {};

/** Hauteur du ballon dribblé (Ball.js place le ballon, la main de dribble le suit) */
export function dribbleBallHeight(animTime) {
    return Math.abs(Math.sin(animTime * 1.6)) * 0.74 + 0.16;
}

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
        this.fwdSpeed = 0;      // vitesse vers l'avant du joueur (négative : il recule)
        this.latSpeed = 0;      // vitesse de côté (+X)
        this.turnRate = 0;      // vitesse de rotation (rad/s), pour pencher dans les virages
        this.lastPos = null;
        this.lastYaw = 0;
        this.lateral = false;
        this.cadence = 1;       // cycles de pas par seconde des animations de déplacement
        this.shuffleStride = 0.7;
        this.shufflePhase = 0;
        this.shuffleW = 0;
        this.landTimer = 0;
        this.wasAirborne = false;
        this.pose = { dip: 0, pitch: 0, lean: 0 };
        this.armW = { plusX: 0, minusX: 0 };
        this.armDirs = { plusX: null, minusX: null };
        this.legW = 0;
        this.legDirs = null;
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
        // Même côté pour les jambes (bras gauche et jambe gauche)
        this.legs = {
            plusX: { thigh: this.bones[`thigh_${side}`], calf: this.bones[`calf_${side}`], foot: this.bones[`foot_${side}`] },
            minusX: { thigh: this.bones[`thigh_${other}`], calf: this.bones[`calf_${other}`], foot: this.bones[`foot_${other}`] }
        };
        this.spine = ['spine_01', 'spine_02', 'spine_03'].map(n => this.bones[n]).filter(Boolean);
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
     * Choisit l'animation selon l'état et le déplacement réel, puis ajoute les gestes de basket.
     * info (facultatif, donné par le moteur du match) : hasBall, finish ('DUNK' / 'LAYUP') et finishT (0 à 1),
     * release (secondes depuis le départ de son tir, -1 sinon), boxOut, boxed, react ('FOULED' / 'CELEBRATE'),
     * matchEnd ('WIN' / 'LOSE')
     */
    updateAnimation(dt, state = this.animState, info = NO_INFO) {
        this.animState = state;
        const dribbleScore = this.config.attributes?.dribble || 75;
        const dribbleSpeedMultiplier = 0.8 + (dribbleScore / 99) * 0.75;

        // Déplacement mesuré d'une image à l'autre (marche aussi pour les joueurs distants et les bots),
        // décomposé selon l'orientation du joueur : avancer, reculer, aller de côté, tourner
        const p = this.root.position;
        const yaw = this.root.rotation.y;
        if (this.lastPos && dt > 0) {
            let vx = (p.x - this.lastPos.x) / dt;
            let vz = (p.z - this.lastPos.z) / dt;
            if (Math.hypot(vx, vz) > 15) vx = vz = 0; // remise en jeu : téléportation, pas une course
            const k = Math.min(1, dt * 10);
            this.speed += (Math.hypot(vx, vz) - this.speed) * k;
            this.fwdSpeed += (vx * Math.sin(yaw) + vz * Math.cos(yaw) - this.fwdSpeed) * k;
            this.latSpeed += (vx * Math.cos(yaw) - vz * Math.sin(yaw) - this.latSpeed) * k;
            const dYaw = Math.atan2(Math.sin(yaw - this.lastYaw), Math.cos(yaw - this.lastYaw));
            this.turnRate += (THREE.MathUtils.clamp(dYaw / dt, -12, 12) - this.turnRate) * k;
        }
        this.lastPos = { x: p.x, z: p.z };
        this.lastYaw = yaw;
        // Rythme du dribble : plus rapide en courant (le ballon suit le même temps, Ball.js)
        this.animTime += dt * 7 * dribbleSpeedMultiplier * (1 + Math.min(this.speed, 7) * 0.05);

        const airborne = p.y > 0.05;
        const moving = this.speed > 0.6;
        // De côté (défenseur face à son joueur) : pas chassés ; vers l'arrière : animation jouée à l'envers.
        // Pas pendant un demi-tour (le corps pivote, le déplacement n'a pas encore suivi)
        const turning = Math.abs(this.turnRate) > 5;
        this.lateral = moving && !airborne && !turning && this.speed < 3.8 &&
            Math.abs(this.latSpeed) > Math.abs(this.fwdSpeed) * 1.2;
        const backward = moving && !this.lateral && !turning && this.fwdSpeed < -0.4 * this.speed;
        if (this.lateral) {
            // Pas chassés plus longs quand on va vite (sinon les pieds s'affolent)
            this.shuffleStride = THREE.MathUtils.clamp(0.5 + 0.13 * Math.abs(this.latSpeed), 0.6, 1.0);
            this.shufflePhase = (this.shufflePhase + Math.abs(this.latSpeed) * dt / this.shuffleStride) % 1;
        }

        const low = state === 'DEFENSE' || info.boxOut ? DEFENSE_CROUCH : 0.12;
        const loco = moving ? this.locomotionBlend(this.speed) : { idle: 1 };
        if (info.matchEnd === 'WIN' && this.actions.dance) {
            this.playAction('dance', 0.4);
        } else if (airborne || state === 'CONTEST' || state === 'DUNK') {
            this.playAction('air', 0.1);
        } else if (this.lateral) {
            this.playBlend({ crouchIdle: low, idle: 1 - low }, 0.2);
        } else if (state === 'DEFENSE' || info.boxOut) {
            // Posture de défense : l'accroupi du pack mélangé avec la pose debout (genoux fléchis, dos droit)
            const crouch = moving ? 'crouchMove' : 'crouchIdle';
            const blend = { [crouch]: low };
            for (const [k, w] of Object.entries(loco)) blend[k] = w * (1 - low);
            this.playBlend(blend, 0.2);
        } else if (state === 'SCREEN') {
            // Écran : appuis larges, un peu fléchi, immobile
            this.playBlend({ crouchIdle: 0.2, idle: 0.8 }, 0.15);
        } else {
            this.playBlend(loco, 0.2);
        }

        // Rythme des pas : le pied d'appui reste sur place (foulée du mélange = somme des foulées pondérées)
        let stride = 0;
        for (const k of LOCOMOTION) stride += (this.blendTargets[k] || 0) * STRIDE[k];
        if (stride > 0) this.cadence = THREE.MathUtils.clamp(this.speed / (stride * this.bodyGroup.scale.z), 0.4, 1.8);
        const dir = backward ? -1 : 1;
        for (const [k, action] of Object.entries(this.actions)) {
            action.timeScale = LOCOMOTION.has(k) ? dir * this.cadence * action.getClip().duration : 1;
        }
        this.blendActions(dt);
        this.mixer.update(dt);

        this.applyProcedural(dt, state, info, airborne);
    }

    /**
     * Marche, course et sprint mélangés selon la vitesse (m/s) : des pas un peu plus rapides quand on va vite
     * (0,85 à 1,4 cycle par seconde), la foulée fait le reste. Seule, la course du pack donnerait des bonds de
     * 2,7 m à petite cadence ; jouée plus vite, les pieds glissaient sur le parquet
     */
    locomotionBlend(speed) {
        const s = speed / this.bodyGroup.scale.z;
        const cadence = THREE.MathUtils.clamp(0.85 + 0.07 * s, 0.8, 1.4);
        const sprint = THREE.MathUtils.clamp((s - 5.5) / 2, 0, 1);
        const runStride = STRIDE.jog + (STRIDE.sprint - STRIDE.jog) * sprint;
        const run = THREE.MathUtils.clamp((s / cadence - STRIDE.walk) / (runStride - STRIDE.walk), 0, 1);
        return { walk: 1 - run, jog: run * (1 - sprint), sprint: run * sprint };
    }

    /**
     * Gestes des bras (repère du personnage : +Y haut, +Z devant, +X côté « droit » du jeu), en plusieurs temps.
     * Renvoie { arms: { plusX: [haut du bras, avant-bras], minusX: ... }, dribble: côté de la main qui dribble,
     * flick: poignet cassé (fin de tir), legs: pose des jambes en l'air }
     */
    gesturePose(state, info, airborne) {
        const v = (x, y, z) => new THREE.Vector3(x, y, z).normalize();
        const mirror = (pair) => pair.map(d => new THREE.Vector3(-d.x, d.y, d.z));
        // Main de tir : celle du dribble (droite par défaut)
        const shootSide = this.dribbleHand === 'LEFT' ? 'minusX' : 'plusX';
        const guideSide = shootSide === 'plusX' ? 'minusX' : 'plusX';
        const both = (pair) => ({ plusX: pair, minusX: mirror(pair) });
        const shooting = (shootPair, guidePair) => {
            const m = shootSide === 'plusX' ? (x) => x : mirror;
            return { [shootSide]: m(shootPair), [guideSide]: m(guidePair) };
        };

        if (info.matchEnd === 'WIN' && this.actions.dance) return null; // la danse fait tout
        if (info.matchEnd === 'LOSE') return { arms: both([v(0.6, -0.7, -0.2), v(-0.6, -0.45, 0.35)]) }; // mains sur les hanches
        if (info.react === 'FOULED') return { arms: both([v(0.9, 0.2, -0.3), v(0.6, 0.65, -0.2)]) };

        if (info.finish === 'DUNK') {
            const t = info.finishT || 0;
            const legs = both([v(0.12, -0.35, 1), v(0, -0.55, -0.85)]); // genoux repliés
            if (!info.hasBall) return { arms: both([v(0.15, 1, 0.35), v(0.05, 1, 0.3)]), legs }; // alley-oop : mains tendues vers le ballon
            if (t < 0.6) return { arms: shooting([v(0.25, 0.85, -0.45), v(0.1, 0.5, -0.85)], [v(0.6, 0.4, 0.5), v(0.3, 0.5, 0.8)]), legs };
            return { arms: shooting([v(0.05, 0.8, 0.6), v(0, -0.25, 1)], [v(0.6, 0.2, 0.4), v(0.3, 0.2, 0.9)]), legs };
        }
        if (info.finish === 'LAYUP') {
            const t = info.finishT || 0;
            // Appel sur un pied : genou opposé à la main de tir levé, l'autre jambe en arrière
            const raised = [v(0, -0.1, 1), v(0, -1, 0.1)];
            const trail = [v(0, -1, -0.3), v(0, -0.7, -0.7)];
            const legs = { [guideSide]: raised, [shootSide]: trail };
            if (t < 0.45) return { arms: both([v(0.35, -0.35, 0.85), v(-0.3, 0.55, 0.75)]), legs }; // ballon protégé contre la poitrine
            return { arms: shooting([v(0.15, 1, 0.55), v(0.05, 0.95, 0.6)], [v(0.5, 0.5, 0.55), v(0.3, 0.6, 0.7)]), legs };
        }
        if (info.release >= 0 && info.release < 0.9) {
            // Fin du tir : bras tendu vers le cercle, poignet cassé (« col de cygne »), main guide sur le côté
            return { arms: shooting([v(0.08, 1, 0.45), v(0.02, 0.85, 0.55)], [v(0.35, 0.95, 0.35), v(0.25, 1, 0.15)]), flick: 1.2 };
        }
        if (state === 'SHOOT') {
            if (!airborne) return { arms: both([v(0.3, -0.4, 0.85), v(-0.2, 0.6, 0.75)]) }; // armé : ballon devant la poitrine
            // En l'air : ballon au-dessus du front (mise en place), la détente vient au lâcher
            return { arms: shooting([v(0.2, 0.55, 0.8), v(0, 1, 0.15)], [v(0.35, 0.6, 0.7), v(-0.25, 0.85, 0.3)]) };
        }
        if (info.react === 'CELEBRATE' && !airborne) {
            const pump = Math.abs(Math.sin(this.animTime * 0.9));
            return { arms: { [shootSide]: shooting([v(0.45, 0.55, 0.35), v(0.05, 0.4 + pump, 0.1)], [])[shootSide] } }; // poing levé
        }
        if (state === 'DUNK') {
            return { arms: shooting([v(0.1, 1, 0.25), v(0, 1, 0.15)], [v(0.7, 0.3, 0.4), v(0.4, 0.4, 0.6)]) };
        }
        // Enfermé au rebond ou en box-out : seulement au contact, presque à l'arrêt (pas en pleine course)
        const holding = this.speed < 2;
        if (state === 'CONTEST' || (info.boxed && holding)) {
            return { arms: both([v(0.15, 1, 0.2), v(0.05, 1, 0.1)]) };
        }
        if (info.boxOut && holding) return { arms: both([v(1, 0.25, -0.15), v(0.45, 0.8, 0.3)]) }; // coudes écartés, dos à l'adversaire
        if (state === 'SCREEN') {
            // Bras croisés contre la poitrine (écran réglementaire)
            return { arms: { plusX: [v(0.3, -0.75, 0.55), v(-0.95, 0.2, 0.3)], minusX: [v(-0.3, -0.7, 0.55), v(0.95, 0.25, 0.3)] } };
        }
        if (state === 'DRIBBLE' || state === 'CROSSOVER') {
            // Main de dribble sur le ballon (IK), l'autre bras protège
            const handSide = this.dribbleHand === 'RIGHT' ? 'plusX' : 'minusX';
            const guard = handSide === 'plusX' ? 'minusX' : 'plusX';
            const g = [v(0.4, -0.8, 0.45), v(0.1, -0.15, 1)];
            return { arms: { [guard]: handSide === 'plusX' ? mirror(g) : g }, dribble: handSide };
        }
        if (state === 'DEFENSE') {
            // Une main haute (contre le tir), une main basse et écartée (contre le dribble)
            return { arms: { plusX: [v(1, 0.05, 0.3), v(0.75, 0.6, 0.35)], minusX: [v(-1, -0.4, 0.35), v(-0.85, -0.25, 0.6)] } };
        }
        return null;
    }

    applyProcedural(dt, state, info, airborne) {
        const scale = this.bodyGroup.scale.y;
        if (this.wasAirborne && !airborne) this.landTimer = LAND_TIME;
        this.wasAirborne = airborne;
        this.landTimer = Math.max(0, this.landTimer - dt);
        const dribbling = state === 'DRIBBLE' || state === 'CROSSOVER';
        const sprint = THREE.MathUtils.clamp((this.speed - 3) / 4, 0, 1);
        const dancing = info.matchEnd === 'WIN' && !!this.actions.dance;

        // 1. Cibles du corps : bassin plus bas (m), buste penché en avant (rad), penché sur le côté (+X)
        let dip = 0;
        let pitch = 0;
        let lean = 0;
        if (!airborne && !dancing) {
            if (dribbling) { dip = 0.07; pitch = 0.1 + 0.1 * sprint; }
            else if (state === 'RUN') pitch = 0.08 * sprint;
            if (state === 'CROSSOVER') { dip = 0.13; lean = this.dribbleHand === 'RIGHT' ? 0.16 : -0.16; }
            if (state === 'SHOOT') { dip = 0.14; pitch = 0.04; } // armé du tir (avant le saut)
            if (state === 'DEFENSE' || this.lateral) dip = Math.max(dip, 0.08);
            if (info.boxOut && this.speed < 2) { dip = 0.15; pitch = 0.25; }
            if (this.landTimer > 0) dip = Math.max(dip, 0.15 * Math.sin(Math.PI * this.landTimer / LAND_TIME));
            lean += THREE.MathUtils.clamp(this.turnRate * this.speed * 0.01, -0.18, 0.18); // dans les virages
        }
        if (info.react === 'FOULED') pitch = -0.32;
        if (info.matchEnd === 'LOSE') pitch = 0.3;
        const k = Math.min(1, dt * 10);
        const pose = this.pose;
        pose.dip += (dip - pose.dip) * k;
        pose.pitch += (pitch - pose.pitch) * k;
        pose.lean += (lean - pose.lean) * k;
        this.shuffleW += ((this.lateral ? 1 : 0) - this.shuffleW) * k;

        this.root.updateMatrixWorld(true);
        const charQuat = this.root.getWorldQuaternion(_cq);
        const fwdW = _fwd.set(0, 0, 1).applyQuaternion(charQuat);
        const sideW = _side.set(1, 0, 0).applyQuaternion(charQuat);
        const toWorld = (d) => d.clone().applyQuaternion(charQuat);

        // 2. Jambes au sol : on retient où sont les pieds avant de descendre le bassin
        const legsIK = !airborne && (pose.dip > 0.004 || this.shuffleW > 0.01);
        const feet = {};
        if (legsIK) {
            for (const [sideKey, leg] of Object.entries(this.legs)) {
                if (!leg.foot) continue;
                feet[sideKey] = { pos: leg.foot.getWorldPosition(new THREE.Vector3()), quat: leg.foot.getWorldQuaternion(new THREE.Quaternion()) };
            }
        }
        const pelvis = this.bones.pelvis;
        if (pose.dip > 0.004 && pelvis) {
            const pp = pelvis.getWorldPosition(_v1);
            pp.y -= pose.dip * scale;
            pelvis.parent.worldToLocal(pp);
            pelvis.position.copy(pp);
            pelvis.updateMatrixWorld(true);
        }

        // 3. Buste : réparti sur les trois vertèbres
        if (Math.abs(pose.pitch) > 0.002 || Math.abs(pose.lean) > 0.002) {
            for (const bone of this.spine) {
                rotateBoneWorld(bone, sideW, pose.pitch / this.spine.length);
                rotateBoneWorld(bone, fwdW, -pose.lean / this.spine.length);
            }
        }

        // 4. Jambes : pieds remis à leur place (genoux qui plient), pas chassés de côté
        if (legsIK) {
            const m = Math.sign(this.latSpeed) || 1; // côté où l'on va
            const W = this.shuffleStride / 2;
            const stepOf = (swingStart) => {
                let u = (this.shufflePhase - swingStart + 1) % 1;
                if (u < 0.5) {
                    u /= 0.5;
                    return { d: -W / 2 + W * u * u * (3 - 2 * u), lift: 0.07 * Math.sin(Math.PI * u) };
                }
                return { d: W / 2 - W * (u - 0.5) / 0.5, lift: 0 };
            };
            for (const [sideKey, leg] of Object.entries(this.legs)) {
                const f = feet[sideKey];
                if (!f || !leg.thigh || !leg.calf) continue;
                const out = sideKey === 'plusX' ? 1 : -1;
                const target = f.pos.clone();
                if (this.shuffleW > 0.01) {
                    const lead = out === m;
                    const step = stepOf(lead ? 0 : 0.5);
                    target.addScaledVector(sideW, (m * step.d + out * 0.07) * this.shuffleW * scale);
                    target.y += step.lift * this.shuffleW * scale;
                }
                const pole = _v2.copy(fwdW).addScaledVector(sideW, out * 0.25);
                solveTwoBone(leg.thigh, leg.calf, leg.foot, target, pole, 1);
                setWorldQuaternion(leg.foot, f.quat); // pied à plat
            }
        }

        // 5. Gestes (bras, jambes en l'air), en douceur d'une pose à l'autre
        const g = dancing ? null : this.gesturePose(state, info, airborne);
        const kd = Math.min(1, dt * 16);
        const kw = Math.min(1, dt * 14);
        for (const sideKey of ['plusX', 'minusX']) {
            const want = g?.arms?.[sideKey];
            if (want) {
                const cur = this.armDirs[sideKey];
                if (!cur || this.armW[sideKey] < 0.02) this.armDirs[sideKey] = want.map(d => d.clone());
                else cur.forEach((d, i) => d.lerp(want[i], kd).normalize());
            }
            const wTarget = want || g?.dribble === sideKey ? 1 : 0;
            this.armW[sideKey] += (wTarget - this.armW[sideKey]) * kw;
        }
        if (g?.legs) this.legDirs = g.legs;
        this.legW += ((g?.legs && airborne ? 1 : 0) - this.legW) * kw;

        if (this.legW > 0.01 && this.legDirs) {
            for (const [sideKey, [thighDir, calfDir]] of Object.entries(this.legDirs)) {
                const leg = this.legs[sideKey];
                if (!leg?.thigh || !leg.calf || !leg.foot) continue;
                aimBone(leg.thigh, leg.calf, toWorld(thighDir), this.legW);
                aimBone(leg.calf, leg.foot, toWorld(calfDir), this.legW);
            }
        }

        for (const sideKey of ['plusX', 'minusX']) {
            const w = this.armW[sideKey];
            const arm = this.arms[sideKey];
            if (w < 0.01 || !arm?.upper || !arm.lower || !arm.hand) continue;
            if (g?.dribble === sideKey) {
                // Poignet au-dessus du ballon quand il remonte, il l'attend à hauteur de hanche quand il est au sol
                const out = sideKey === 'plusX' ? 1 : -1;
                const ballY = dribbleBallHeight(this.animTime);
                const wristY = Math.max(ballY + 0.24, 0.98 * scale);
                const target = this.root.localToWorld(_v1.set(out * 0.34, wristY, 0.3));
                const pole = _v2.copy(sideW).multiplyScalar(out * 0.6).addScaledVector(fwdW, -0.8);
                solveTwoBone(arm.upper, arm.lower, arm.hand, target, pole, w);
                continue;
            }
            const dirs = this.armDirs[sideKey];
            if (!dirs) continue;
            aimBone(arm.upper, arm.lower, toWorld(dirs[0]), w);
            aimBone(arm.lower, arm.hand, toWorld(dirs[1]), w);
        }

        // Poignet cassé de la main de tir après le lâcher
        const flick = g?.flick || 0;
        this.flickW = (this.flickW || 0) + (flick - (this.flickW || 0)) * kw;
        const shootArm = this.arms[this.dribbleHand === 'LEFT' ? 'minusX' : 'plusX'];
        if (this.flickW > 0.01 && shootArm?.hand) rotateBoneWorld(shootArm.hand, sideW, this.flickW);
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
const _cq = new THREE.Quaternion();
const _fwd = new THREE.Vector3();
const _side = new THREE.Vector3();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _ia = new THREE.Vector3();
const _ib = new THREE.Vector3();
const _ic = new THREE.Vector3();
const _id = new THREE.Vector3();
const _ip = new THREE.Vector3();
const _ik = new THREE.Vector3();
const _rq = new THREE.Quaternion();
const _rw = new THREE.Quaternion();

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

/**
 * Tourne un os autour d'un axe du monde (le reste de la chaîne suit)
 */
function rotateBoneWorld(bone, axisWorld, angle) {
    _rq.setFromAxisAngle(axisWorld, angle);
    bone.getWorldQuaternion(_rw);
    setWorldQuaternion(bone, _rq.multiply(_rw));
}

/** Donne à un os une orientation dans le monde (convertie dans le repère de son parent) */
function setWorldQuaternion(bone, worldQuat) {
    bone.parent.getWorldQuaternion(_pq);
    bone.quaternion.copy(_pq.invert().multiply(worldQuat));
    bone.updateMatrixWorld(true);
}

/**
 * IK à deux os (cuisse-mollet-pied, bras-avant-bras-main) : l'extrémité va sur target, le coude ou le
 * genou plie du côté de pole. Les longueurs sont celles du squelette (taille du joueur comprise)
 */
function solveTwoBone(upper, middle, end, target, pole, weight) {
    upper.getWorldPosition(_ia);
    middle.getWorldPosition(_ib);
    end.getWorldPosition(_ic);
    const l1 = _ia.distanceTo(_ib);
    const l2 = _ib.distanceTo(_ic);
    _id.subVectors(target, _ia);
    const dist = THREE.MathUtils.clamp(_id.length(), Math.abs(l1 - l2) + 1e-3, l1 + l2 - 1e-4);
    _id.normalize();
    const x = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
    const h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
    _ip.copy(pole).addScaledVector(_id, -pole.dot(_id)).normalize();
    _ik.copy(_ia).addScaledVector(_id, x).addScaledVector(_ip, h); // genou / coude
    aimBone(upper, middle, _ib.subVectors(_ik, _ia).normalize(), weight);
    middle.getWorldPosition(_ib);
    _ic.copy(_ia).addScaledVector(_id, dist); // extrémité (cible ramenée à portée)
    aimBone(middle, end, _ic.sub(_ib).normalize(), weight);
}
