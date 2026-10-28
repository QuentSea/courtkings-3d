/**
 * HairStyles.js
 * Coiffures fabriquées par le jeu pour les styles absents du pack Quaternius (afro, crête, locks,
 * boucles + bandeau). Elles sont dessinées dans le repère de l'ancienne tête (visage vers +Z,
 * sommet du crâne à y = 0.32), que CharacterAssets cale sur la vraie tête du personnage.
 * Le crâne y est mesuré à peu près comme un ellipsoïde (SKULL) ; les cheveux partent de sa surface.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Crâne mesuré sur le corps Quaternius, dans le repère de l'ancienne tête
const SKULL = { center: new THREE.Vector3(0, 0.16, -0.005), radius: new THREE.Vector3(0.148, 0.165, 0.198) };

// Coiffures posées sur une base rasée du pack (côtés de la crête, racines des locks...)
export const HAIR_BASE_FROM_PACK = {
    mohawk: 'hair_buzzed',
    dreads: 'hair_buzzed',
    headband_curls: 'hair_buzzed'
};

/**
 * Renvoie un groupe à poser dans le repère de la tête, ou null si le style n'est pas géré ici
 */
export function buildProceduralHair(style, hairMat, accentColor) {
    let geometries = null;
    const extra = [];
    if (style === 'afro') {
        geometries = [shellGeometry({ thickness: afroThickness, detail: 5, bumps: 0.18, bumpFreq: 26 })];
    } else if (style === 'headband_curls') {
        geometries = [shellGeometry({ thickness: curlsThickness, detail: 5, bumps: 0.45, bumpFreq: 34 })];
        extra.push(headband(accentColor));
    } else if (style === 'mohawk') {
        geometries = [mohawkGeometry()];
    } else if (style === 'dreads') {
        geometries = dreadsGeometries();
    } else {
        return null;
    }

    const group = new THREE.Group();
    const merged = geometries.length === 1 ? geometries[0] : mergeGeometries(geometries);
    group.add(new THREE.Mesh(merged, hairMat));
    for (const mesh of extra) group.add(mesh);
    return group;
}

/** Point de la surface du crâne dans la direction d (depuis son centre) */
function skullPoint(d, out = new THREE.Vector3()) {
    const r = SKULL.radius;
    const k = 1 / Math.sqrt((d.x / r.x) ** 2 + (d.y / r.y) ** 2 + (d.z / r.z) ** 2);
    return out.copy(d).multiplyScalar(k).add(SKULL.center);
}

/**
 * Ligne d'implantation des cheveux : hauteur minimale selon la direction
 * (haute sur le front, plus basse aux tempes, jusqu'à la nuque derrière)
 */
function hairlineHeight(p) {
    const front = THREE.MathUtils.clamp(p.z / SKULL.radius.z, -1, 1); // 1 = front, -1 = nuque
    const side = Math.abs(p.x) / SKULL.radius.x;
    if (front > 0) return THREE.MathUtils.lerp(0.13, 0.205, front ** 1.5) + 0.02 * side * front;
    return THREE.MathUtils.lerp(0.13, 0.0, (-front) ** 1.2);
}

function smoothstep(e0, e1, x) {
    const t = THREE.MathUtils.clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
}

function afroThickness(p) {
    // Volume rond : plus épais en haut et sur les côtés, plus court près du visage
    const top = smoothstep(0.0, 0.32, p.y);
    const nearFace = smoothstep(0.0, 1, p.z / SKULL.radius.z);
    return 0.075 + 0.07 * top - 0.03 * nearFace;
}

function curlsThickness(p) {
    return 0.03 + 0.03 * smoothstep(0.1, 0.32, p.y);
}

/**
 * Coque de cheveux autour du crâne : épaisseur variable, petites bosses (boucles),
 * rentrée dans la tête sous la ligne d'implantation
 */
function shellGeometry({ thickness, detail, bumps, bumpFreq }) {
    const geo = new THREE.IcosahedronGeometry(1, detail);
    const pos = geo.attributes.position;
    const d = new THREE.Vector3();
    const p = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
        d.fromBufferAttribute(pos, i).normalize();
        skullPoint(d, p);
        const line = hairlineHeight(p);
        const grow = smoothstep(line - 0.005, line + 0.035, p.y);
        const noise = curlNoise(d, bumpFreq);
        const t = thickness(p) * grow * (1 + bumps * noise);
        // Sous la ligne : légèrement à l'intérieur du crâne (invisible)
        p.addScaledVector(d, grow > 0 ? Math.max(t, 0.004) : -0.01);
        pos.setXYZ(i, p.x, p.y, p.z);
    }
    geo.computeVertexNormals();
    return geo;
}

function curlNoise(d, f) {
    return (Math.sin(d.x * f + 1.3) * Math.sin(d.y * f * 0.9 + 0.4) * Math.sin(d.z * f * 1.1 + 2.2)
        + 0.5 * Math.sin(d.x * f * 2.1 + d.z * f * 1.7) * Math.sin(d.y * f * 2.3 + 0.9)) / 1.5;
}

/**
 * Crête : une lame qui suit le milieu du crâne, du front à la nuque, découpée en pointes
 * couchées vers l'arrière
 */
function mohawkGeometry() {
    const steps = 64;
    const halfWidth = 0.032;
    const positions = [];
    const indices = [];
    const d = new THREE.Vector3();
    const base = new THREE.Vector3();
    const tangent = new THREE.Vector3();
    const next = new THREE.Vector3();
    const start = THREE.MathUtils.degToRad(62);   // vers l'avant (front)
    const end = THREE.MathUtils.degToRad(-118);   // vers l'arrière (nuque)
    const spikes = 7;
    for (let s = 0; s <= steps; s++) {
        const u = s / steps;
        const a = THREE.MathUtils.lerp(start, end, u);
        d.set(0, Math.cos(a), Math.sin(a));
        skullPoint(d, base);
        skullPoint(next.set(0, Math.cos(a - 0.01), Math.sin(a - 0.01)), next);
        tangent.subVectors(next, base).normalize(); // vers l'arrière
        // Hauteur : bouts arrondis, pointes régulières
        const envelope = Math.sin(Math.PI * Math.min(1, u * 1.15)) ** 0.6;
        const spike = 0.55 + 0.45 * Math.abs(Math.cos(Math.PI * spikes * u));
        const h = (0.035 + 0.1 * envelope * spike) * (u < 0.98 ? 1 : 0.3);
        const out = d.clone().normalize();
        const tip = base.clone().addScaledVector(out, h).addScaledVector(tangent, h * 0.45);
        const left = base.clone().add(new THREE.Vector3(-halfWidth, 0, 0)).addScaledVector(out, -0.004);
        const right = base.clone().add(new THREE.Vector3(halfWidth, 0, 0)).addScaledVector(out, -0.004);
        positions.push(...left.toArray(), ...tip.toArray(), ...right.toArray());
        if (s > 0) {
            const a0 = (s - 1) * 3, a1 = s * 3;
            // côté gauche (gauche -> pointe) et côté droit (pointe -> droite)
            indices.push(a0, a1, a0 + 1, a1, a1 + 1, a0 + 1);
            indices.push(a0 + 1, a1 + 1, a0 + 2, a1 + 1, a1 + 2, a0 + 2);
        }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
}

/**
 * Locks : mèches en tubes qui partent du crâne et retombent sur les côtés et dans le dos
 */
function dreadsGeometries() {
    const list = [];
    const d = new THREE.Vector3();
    const root = new THREE.Vector3();
    let seed = 7;
    const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const rows = [
        { elev: 75, count: 6, len: 0.26 },
        { elev: 45, count: 11, len: 0.3 },
        { elev: 18, count: 14, len: 0.32 }
    ];
    for (const row of rows) {
        for (let k = 0; k < row.count; k++) {
            // Azimut : 0 = devant ; on laisse le visage libre (±50° devant)
            const az = THREE.MathUtils.degToRad(50 + (260 * (k + 0.5)) / row.count + (rand() - 0.5) * 8);
            const el = THREE.MathUtils.degToRad(row.elev + (rand() - 0.5) * 8);
            d.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).normalize();
            skullPoint(d, root);
            if (root.y < hairlineHeight(root) - 0.01) continue;
            const outward = new THREE.Vector3(d.x, 0, d.z).normalize();
            const len = row.len * (0.85 + rand() * 0.3);
            const p1 = root.clone().addScaledVector(d, 0.035);
            const p2 = p1.clone().addScaledVector(outward, 0.05).add(new THREE.Vector3(0, -0.02, 0));
            const p3 = p2.clone().addScaledVector(outward, 0.025).add(new THREE.Vector3(0, -len * 0.55, 0));
            const p4 = p3.clone().addScaledVector(outward, 0.01).add(new THREE.Vector3(0, -len * 0.45, -0.01));
            const curve = new THREE.CatmullRomCurve3([root.clone().addScaledVector(d, -0.01), p1, p2, p3, p4]);
            const tube = new THREE.TubeGeometry(curve, 10, 0.019 + rand() * 0.005, 6, false);
            list.push(tube);
        }
    }
    // Volume sur le dessus pour qu'on ne voie pas les racines une à une
    list.push(shellGeometry({ thickness: () => 0.03, detail: 4, bumps: 0.35, bumpFreq: 40 }));
    // TubeGeometry n'a pas d'index identique à l'icosaèdre : tout passer en non indexé
    return list.map(g => (g.index ? g.toNonIndexed() : g));
}

/** Bandeau de sport autour du front (couleur secondaire de l'équipe) */
function headband(color) {
    const y = 0.205;
    const geo = new THREE.CylinderGeometry(1, 1, 0.045, 40, 1, true);
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.55, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    // Ellipse du crâne à cette hauteur, un peu agrandie, inclinée (plus basse sur le front)
    const k = Math.sqrt(Math.max(0.05, 1 - ((y - SKULL.center.y) / SKULL.radius.y) ** 2));
    mesh.scale.set(SKULL.radius.x * k + 0.035, 1, SKULL.radius.z * k + 0.035);
    mesh.position.set(0, y, SKULL.center.z);
    mesh.rotation.x = 0.12;
    mesh.userData.ownMaterial = mat;
    return mesh;
}
