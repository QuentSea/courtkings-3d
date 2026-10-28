/**
 * createCharacter.js
 * Fabrique un personnage : modèle animé Quaternius si ses fichiers sont chargés,
 * sinon l'ancien modèle procédural (le jeu reste jouable même si le chargement échoue).
 */

import { CharacterAssets } from './CharacterAssets.js';
import { AnimatedCharacter } from './AnimatedCharacter.js';
import { CharacterMesh } from './CharacterMesh.js';

export function createCharacterMesh(config) {
    if (CharacterAssets.ready) {
        try {
            return new AnimatedCharacter(config);
        } catch (err) {
            console.warn('Personnage animé indisponible, ancien modèle utilisé :', err);
        }
    }
    return new CharacterMesh(config);
}
