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
