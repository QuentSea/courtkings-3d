/**
 * RenderSetup.js
 * Réglages de rendu communs aux trois scènes 3D (Créateur, Salon, Match) :
 * - Couleurs gérées en sRGB et rendu « cinéma » des lumières (tone mapping ACES)
 * - Éclairage d'ambiance (RoomEnvironment) : reflets doux sur tous les matériaux
 */

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export function setupRenderer(renderer, scene, { exposure = 1.1, envIntensity = 0.5 } = {}) {
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = exposure;

    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = envIntensity;
    pmrem.dispose();
}

/**
 * Une texture dessinée (Canvas) contient des couleurs : sans ce réglage elles paraissent délavées
 */
export function asColorTexture(texture) {
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}

/**
 * Libère la mémoire de la carte graphique d'un groupe retiré de la scène (formes, matériaux, textures).
 * À n'utiliser que sur des objets qui ne partagent rien avec ce qui reste affiché.
 */
export function disposeTree(root) {
    root.traverse((o) => {
        o.geometry?.dispose();
        if (o.isInstancedMesh) o.dispose();
        const materials = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
        for (const m of materials) {
            for (const value of Object.values(m)) {
                if (value?.isTexture) value.dispose();
            }
            m.dispose();
        }
    });
}
