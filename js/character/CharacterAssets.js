/**
 * CharacterAssets.js
 * Chargement et préparation (une seule fois) des personnages animés Quaternius (licence CC0) :
 * - Corps « Superhero Male », coiffures attachées à l'os de la tête, 11 animations (même squelette, 65 os)
 * - Analyse du squelette au repos : orientation, taille, position de la tête et des articulations
 * - Vêtements découpés dans le corps lui-même (maillot, short, chaussettes, chaussures) : ils suivent
 *   les animations comme la peau, puisqu'ils utilisent les mêmes os et les mêmes poids
 * Fichiers préparés pour le web dans assets/characters/ (images WebP 1024 px, animations triées).
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const BASE_URL = new URL('../../assets/characters/', import.meta.url);

export const PACK_HAIR_FILES = {
    hair_buzzed: 'hair_buzzed.glb',
    hair_simpleparted: 'hair_simpleparted.glb',
    hair_long: 'hair_long.glb',
    hair_buns: 'hair_buns.glb',
    hair_beard: 'hair_beard.glb'
};

// Taille d'un joueur de gabarit 1.0 (sommet du crâne), comme l'ancien personnage
const TARGET_HEIGHT = 2.0;

export const CharacterAssets = {
    ready: false,
    template: null, // { scene, wrapper, frame, clothing, headAttach, skinRef, armPlusX }
    clips: {},      // nom -> THREE.AnimationClip
    hair: {}        // id -> { scene, colorRef }
};

export async function loadCharacterAssets() {
    const loader = new GLTFLoader();
    const load = (file) => loader.loadAsync(new URL(file, BASE_URL).href);

    const hairIds = Object.keys(PACK_HAIR_FILES);
    const [body, anims, ...hairs] = await Promise.all([
        load('body_male.glb'),
        load('animations.glb'),
        ...hairIds.map(id => load(PACK_HAIR_FILES[id]))
    ]);

    CharacterAssets.template = analyzeBody(body.scene);
    for (const clip of anims.animations) {
        CharacterAssets.clips[clip.name] = clip;
    }
    hairIds.forEach((id, i) => {
        const scene = hairs[i].scene;
        const mesh = findSkinned(scene)[0];
        CharacterAssets.hair[id] = { scene, colorRef: averageTextureColor(mesh?.material?.map, 0.1) };
    });
    CharacterAssets.ready = true;
}

function findSkinned(root) {
    const list = [];
    root.traverse(o => { if (o.isSkinnedMesh) list.push(o); });
    return list;
}

/**
 * Couleur moyenne d'une texture (pixels assez clairs seulement : on ignore les sous-vêtements noirs),
 * en espace linéaire, pour teinter la peau ou les cheveux vers n'importe quelle couleur
 */
function averageTextureColor(texture, minLum = 0.25) {
    const img = texture?.image;
    if (!img) return new THREE.Color(0.6, 0.45, 0.35);
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, 64, 64);
    const data = ctx.getImageData(0, 0, 64, 64).data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 128) continue;
        const lum = (data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11) / 255;
        if (lum < minLum) continue;
        r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
    }
    if (!n) return new THREE.Color(0.6, 0.45, 0.35);
    return new THREE.Color().setRGB(r / n / 255, g / n / 255, b / n / 255, THREE.SRGBColorSpace);
}

function analyzeBody(scene) {
    scene.updateMatrixWorld(true);
    const skinned = findSkinned(scene);
    const body = skinned.find(m => /Superhero/i.test(m.material?.name || '')) || skinned[0];
    const skeleton = body.skeleton;
    const boneIndex = {};
    skeleton.bones.forEach((b, i) => { boneIndex[b.name] = i; });

    // Position des os au repos, dans l'espace des sommets du corps (« espace de liaison »)
    const bindPos = (name) => new THREE.Vector3().setFromMatrixPosition(
        skeleton.boneInverses[boneIndex[name]].clone().invert()
    );
    const footMid = bindPos('foot_l').add(bindPos('foot_r')).multiplyScalar(0.5);
    const up = bindPos('Head').sub(footMid).normalize();
    const toe = bindPos('ball_l').sub(bindPos('foot_l'));
    const fwd = toe.sub(up.clone().multiplyScalar(toe.dot(up))).normalize();
    const lat = new THREE.Vector3().crossVectors(up, fwd).normalize(); // côté +X du personnage

    const geo = body.geometry;
    const pos = geo.attributes.position;
    const p = new THREE.Vector3();
    let minH = Infinity, maxH = -Infinity;
    for (let i = 0; i < pos.count; i++) {
        p.fromBufferAttribute(pos, i);
        const h = p.dot(up);
        minH = Math.min(minH, h);
        maxH = Math.max(maxH, h);
    }
    const height = maxH - minH;
    const frame = { up, fwd, lat, minH, height, boneIndex, bindPos };

    // Redresser le modèle : haut -> +Y, avant -> +Z, pieds au sol, taille TARGET_HEIGHT
    const bindMatrix = body.bindMatrix;
    const worldUp = up.clone().transformDirection(bindMatrix);
    const worldFwd = fwd.clone().transformDirection(bindMatrix);
    const worldLat = new THREE.Vector3().crossVectors(worldUp, worldFwd).normalize();
    const basis = new THREE.Matrix4().makeBasis(worldLat, worldUp, worldFwd);
    const quaternion = new THREE.Quaternion().setFromRotationMatrix(basis).invert();
    const scale = TARGET_HEIGHT / (height * new THREE.Vector3().setFromMatrixScale(bindMatrix).x);
    const wrapperMatrix = new THREE.Matrix4().compose(new THREE.Vector3(), quaternion, new THREE.Vector3(scale, scale, scale));
    let minY = Infinity;
    for (let i = 0; i < pos.count; i += 7) {
        p.fromBufferAttribute(pos, i).applyMatrix4(bindMatrix).applyMatrix4(wrapperMatrix);
        minY = Math.min(minY, p.y);
    }
    const wrapper = { quaternion, scale, offsetY: -minY };

    // Quel bras est du côté +X (la main « droite » du jeu dribble côté +X)
    const armPlusX = bindPos('upperarm_l').sub(bindPos('spine_03')).dot(lat) > 0 ? 'l' : 'r';

    return {
        scene,
        bodyName: body.name,
        wrapper,
        frame,
        armPlusX,
        clothing: buildClothing(geo, frame),
        headAttach: computeHeadAttach(geo, frame, skeleton),
        skinRef: averageTextureColor(body.material.map, 0.3)
    };
}

/**
 * Découpe les vêtements dans la géométrie du corps : chaque sommet est classé selon l'os qui le
 * fait le plus bouger et sa hauteur ; les triangles retenus sont légèrement gonflés vers l'extérieur.
 */
function buildClothing(geo, frame) {
    const { up, fwd, lat, height, boneIndex, bindPos } = frame;
    const pos = geo.attributes.position;
    const nrm = geo.attributes.normal;
    const si = geo.attributes.skinIndex;
    const sw = geo.attributes.skinWeight;
    const count = pos.count;

    const h = (v) => v.dot(up);
    const hipH = h(bindPos('thigh_l'));
    const kneeH = h(bindPos('calf_l'));
    const ankleH = h(bindPos('foot_l'));
    const waistH = h(bindPos('spine_01'));
    const neckH = h(bindPos('neck_01'));

    const ids = (names) => new Set(names.map(n => boneIndex[n]).filter(i => i !== undefined));
    const torsoBones = ids(['spine_01', 'spine_02', 'spine_03', 'clavicle_l', 'clavicle_r']);
    const hipBones = ids(['pelvis', 'thigh_l', 'thigh_r', 'spine_01']);
    const pelvisBone = boneIndex.pelvis;
    const calfBones = ids(['calf_l', 'calf_r']);
    const footBones = ids(['foot_l', 'foot_r', 'ball_l', 'ball_r', 'ball_leaf_l', 'ball_leaf_r']);

    const dom = new Int32Array(count);
    const vh = new Float32Array(count);
    const p = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
        let best = 0;
        for (let k = 1; k < 4; k++) if (sw.getComponent(i, k) > sw.getComponent(i, best)) best = k;
        dom[i] = si.getComponent(i, best);
        vh[i] = h(p.fromBufferAttribute(pos, i));
    }

    const regions = {
        jersey: (i) => vh[i] < neckH - 0.01 * height &&
            (torsoBones.has(dom[i]) || (dom[i] === pelvisBone && vh[i] > waistH - 0.02 * height)),
        shorts: (i) => hipBones.has(dom[i]) && vh[i] > kneeH + 0.035 * height && vh[i] < waistH + 0.035 * height,
        socks: (i) => (calfBones.has(dom[i]) || footBones.has(dom[i])) && vh[i] < ankleH + 0.4 * (kneeH - ankleH),
        shoes: (i) => footBones.has(dom[i]) || (calfBones.has(dom[i]) && vh[i] < ankleH + 0.03 * height)
    };
    const inflate = { jersey: 0.011, shorts: 0.022, socks: 0.003, shoes: 0.02 };
    // Maillot et short : triangle gardé seulement si ses 3 sommets sont dans la zone (bords nets) ;
    // chaussures : 2 sur 3 suffisent (elles recouvrent le bas des chaussettes, sans trou)
    const minVerts = { jersey: 3, shorts: 3, socks: 3, shoes: 2 };

    const index = geo.index ? geo.index.array : Array.from({ length: count }, (_, i) => i);
    const out = {};
    for (const name of Object.keys(regions)) {
        const keep = regions[name];
        const tris = [];
        for (let t = 0; t < index.length; t += 3) {
            const a = index[t], b = index[t + 1], c = index[t + 2];
            if ((keep(a) ? 1 : 0) + (keep(b) ? 1 : 0) + (keep(c) ? 1 : 0) >= minVerts[name]) tris.push(a, b, c);
        }
        out[name] = makePiece(tris, geo, inflate[name] * height, name === 'jersey' ? { up, fwd, lat } : null);
    }
    return out;
}

function makePiece(tris, geo, offset, jerseyFrame) {
    const pos = geo.attributes.position;
    const nrm = geo.attributes.normal;
    const si = geo.attributes.skinIndex;
    const sw = geo.attributes.skinWeight;
    const n = tris.length;
    const positions = new Float32Array(n * 3);
    const normals = new Float32Array(n * 3);
    const skinIndex = new Uint16Array(n * 4);
    const skinWeight = new Float32Array(n * 4);
    const p = new THREE.Vector3();
    const q = new THREE.Vector3();
    for (let k = 0; k < n; k++) {
        const i = tris[k];
        p.fromBufferAttribute(pos, i);
        q.fromBufferAttribute(nrm, i);
        p.addScaledVector(q, offset);
        p.toArray(positions, k * 3);
        q.toArray(normals, k * 3);
        for (let c = 0; c < 4; c++) {
            skinIndex[k * 4 + c] = si.getComponent(i, c);
            skinWeight[k * 4 + c] = sw.getComponent(i, c);
        }
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    out.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndex, 4));
    out.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));
    if (jerseyFrame) out.setAttribute('uv', new THREE.BufferAttribute(jerseyUVs(positions, normals, jerseyFrame), 2));
    out.computeBoundingSphere();
    return out;
}

/**
 * Coordonnées de texture du maillot : moitié gauche de l'image = devant, moitié droite = dos,
 * choisies par triangle (selon qu'il regarde vers l'avant ou l'arrière) pour ne pas mélanger les deux
 */
function jerseyUVs(positions, normals, { up, fwd, lat }) {
    const n = positions.length / 3;
    const uv = new Float32Array(n * 2);
    const v = new THREE.Vector3();
    let xMin = Infinity, xMax = -Infinity, hMin = Infinity, hMax = -Infinity;
    for (let i = 0; i < n; i++) {
        v.fromArray(positions, i * 3);
        xMin = Math.min(xMin, v.dot(lat)); xMax = Math.max(xMax, v.dot(lat));
        hMin = Math.min(hMin, v.dot(up)); hMax = Math.max(hMax, v.dot(up));
    }
    const nSum = new THREE.Vector3();
    const nv = new THREE.Vector3();
    for (let t = 0; t < n; t += 3) {
        nSum.set(0, 0, 0);
        for (let k = 0; k < 3; k++) nSum.add(nv.fromArray(normals, (t + k) * 3));
        const isFront = nSum.dot(fwd) >= 0;
        for (let k = 0; k < 3; k++) {
            v.fromArray(positions, (t + k) * 3);
            const x = (v.dot(lat) - xMin) / (xMax - xMin || 1);
            const y = (v.dot(up) - hMin) / (hMax - hMin || 1);
            // Sens choisi pour que le numéro se lise à l'endroit devant comme derrière
            uv[(t + k) * 2] = isFront ? 0.5 * x : 0.5 + 0.5 * (1 - x);
            uv[(t + k) * 2 + 1] = y;
        }
    }
    return uv;
}

/**
 * Où poser une coiffure « maison » (ancien modèle) sur la tête du nouveau personnage :
 * matrice locale à l'os de la tête qui place le repère de l'ancienne tête (largeur 0.35)
 * au centre de la nouvelle, à la bonne échelle
 */
function computeHeadAttach(geo, frame, skeleton) {
    const { up, fwd, lat, boneIndex } = frame;
    const head = boneIndex.Head;
    const pos = geo.attributes.position;
    const si = geo.attributes.skinIndex;
    const sw = geo.attributes.skinWeight;
    const p = new THREE.Vector3();
    const min = new THREE.Vector3(Infinity, Infinity, Infinity);
    const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
    for (let i = 0; i < pos.count; i++) {
        let best = 0;
        for (let k = 1; k < 4; k++) if (sw.getComponent(i, k) > sw.getComponent(i, best)) best = k;
        if (si.getComponent(i, best) !== head) continue;
        p.fromBufferAttribute(pos, i);
        const local = new THREE.Vector3(p.dot(lat), p.dot(up), p.dot(fwd));
        min.min(local);
        max.max(local);
    }
    const center = min.clone().add(max).multiplyScalar(0.5);
    const s = (max.x - min.x) / 0.35;
    // Repère de l'ancienne tête (visage vers +Z) : son sommet du crâne (y = 0.32) est calé sur le
    // sommet de la nouvelle tête ; les sommets « tête » descendent jusqu'au cou, le centre serait trop bas
    const origin = lat.clone().multiplyScalar(center.x)
        .addScaledVector(up, max.y - 0.32 * s)
        .addScaledVector(fwd, center.z - 0.02 * s);
    const groupBind = new THREE.Matrix4().makeBasis(
        lat.clone().multiplyScalar(s), up.clone().multiplyScalar(s), fwd.clone().multiplyScalar(s)
    ).setPosition(origin);
    return skeleton.boneInverses[head].clone().multiply(groupBind);
}
