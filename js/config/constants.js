/**
 * Configuration & Constantes Globales - CourtKings 3D
 * Contient :
 * - Les 10 Presets de personnages personnalisables
 * - Les options modulaires 3D (Teintes de peau, Coiffures, Barbes, Maillots)
 * - Les 5 Postes officiels (PG, SG, SF, PF, C) avec gabarits et plafonds d'atouts
 * - Le système de répartition des points d'atouts (Tir, Défense, Dribble, Finition)
 */

export const ATTRIBUTE_POOL = {
    STARTING_BASE: 60,     // Valeur minimale par atout
    TOTAL_BONUS_POINTS: 80 // Pool de points à répartir librement dans la limite des plafonds du poste
};

export const SKIN_TONES = [
    { id: 'skin_1', name: 'Ivoire', hex: '#f7d7c4' },
    { id: 'skin_2', name: 'Sable Clair', hex: '#edb99a' },
    { id: 'skin_3', name: 'Doré', hex: '#d99b72' },
    { id: 'skin_4', name: 'Ambre', hex: '#b8764f' },
    { id: 'skin_5', name: 'Caramel', hex: '#8e5434' },
    { id: 'skin_6', name: 'Acajou', hex: '#643922' },
    { id: 'skin_7', name: 'Ébène', hex: '#3d2214' }
];

export const HAIR_STYLES = [
    { id: 'bald', name: 'Rasé / Chauve' },
    { id: 'buzz', name: 'Coupe Courte (Buzz Cut)' },
    { id: 'afro', name: 'Afro Classique' },
    { id: 'fade_top', name: 'High-Top Fade' },
    { id: 'dreads', name: 'Locks / Dreadlocks' },
    { id: 'mohawk', name: 'Crête Streetball' },
    { id: 'headband_curls', name: 'Boucles + Bandeau Pro' }
];

export const BEARD_STYLES = [
    { id: 'none', name: 'Imberbe' },
    { id: 'goatee', name: 'Bouc & Moustache' },
    { id: 'stubble', name: 'Barbe de 3 jours' },
    { id: 'full_beard', name: 'Barbe Complète (Harden Style)' },
    { id: 'chinstrap', name: 'Collier Sculpté' },
    { id: 'mustache', name: 'Moustache Rétro 80s' }
];

export const HAIR_COLORS = [
    { id: 'black', name: 'Noir Profond', hex: '#18181b' },
    { id: 'dark_brown', name: 'Brun Foncé', hex: '#3b2314' },
    { id: 'light_brown', name: 'Châtain', hex: '#71492c' },
    { id: 'blonde', name: 'Blond Platine', hex: '#e5c158' },
    { id: 'red', name: 'Roux Cuivré', hex: '#9e3623' },
    { id: 'silver', name: 'Gris Vétéran', hex: '#cbd5e1' },
    { id: 'neon_blue', name: 'Bleu Électrique', hex: '#0ea5e9' }
];

export const JERSEY_COLORS = [
    { id: 'lakers_gold', name: 'Or Californie', primary: '#f59e0b', secondary: '#581c87' },
    { id: 'bulls_red', name: 'Rouge Chicago', primary: '#dc2626', secondary: '#111827' },
    { id: 'celtics_green', name: 'Vert Boston', primary: '#16a34a', secondary: '#ffffff' },
    { id: 'miami_vice', name: 'Miami Neon', primary: '#ec4899', secondary: '#06b6d4' },
    { id: 'brooklyn_black', name: 'Noir Bitume', primary: '#18181b', secondary: '#f4f4f5' },
    { id: 'warriors_blue', name: 'Bleu Royal', primary: '#2563eb', secondary: '#facc15' }
];

/**
 * Les 5 Postes officiels (Builds)
 * Chaque poste modifie le gabarit 3D (taille, largeur d'épaules), la vitesse de base
 * et les plafonds de statistiques (caps) sur 99.
 */
export const POSITIONS = {
    PG: {
        code: 'PG',
        name: 'Meneur de jeu (Point Guard)',
        shortName: 'Meneur (PG)',
        heightLabel: '1m88 (6\'2")',
        scaleY: 0.94,
        scaleXZ: 0.93,
        baseSpeed: 1.15,
        specialty: 'Vitesse maximale, maîtrise du crossover et passes éclairs.',
        bonuses: '+15% Vitesse de course | +10% Vitesse Crossover',
        caps: {
            shooting: 92,
            defense: 85,
            dribble: 99,
            finishing: 82
        },
        recommended: {
            shooting: 82,
            defense: 72,
            dribble: 94,
            finishing: 72
        }
    },
    SG: {
        code: 'SG',
        name: 'Arrière (Shooting Guard)',
        shortName: 'Arrière (SG)',
        heightLabel: '1m96 (6\'5")',
        scaleY: 0.98,
        scaleXZ: 0.96,
        baseSpeed: 1.08,
        specialty: 'Spécialiste du tir extérieur à 3 points et création d\'espace.',
        bonuses: '+20% Fenêtre "Green" à 3Pts | Tir en suspension rapide',
        caps: {
            shooting: 99,
            defense: 84,
            dribble: 90,
            finishing: 85
        },
        recommended: {
            shooting: 95,
            defense: 72,
            dribble: 80,
            finishing: 73
        }
    },
    SF: {
        code: 'SF',
        name: 'Ailier (Small Forward)',
        shortName: 'Ailier (SF)',
        heightLabel: '2m03 (6\'8")',
        scaleY: 1.02,
        scaleXZ: 1.02,
        baseSpeed: 1.02,
        specialty: 'Profil "Two-Way" équilibré et polyvalent des deux côtés du terrain.',
        bonuses: 'Équilibre total Attaque / Défense | Polyvalence 3v3 & 5v5',
        caps: {
            shooting: 90,
            defense: 92,
            dribble: 86,
            finishing: 90
        },
        recommended: {
            shooting: 80,
            defense: 80,
            dribble: 78,
            finishing: 82
        }
    },
    PF: {
        code: 'PF',
        name: 'Ailier Fort (Power Forward)',
        shortName: 'Ailier Fort (PF)',
        heightLabel: '2m08 (6\'10")',
        scaleY: 1.07,
        scaleXZ: 1.09,
        baseSpeed: 0.95,
        specialty: 'Puissant dans la raquette, dunks avec contact et défense intérieure.',
        bonuses: '+15% Résistance au contact | Contres et rebonds offensifs',
        caps: {
            shooting: 82,
            defense: 95,
            dribble: 76,
            finishing: 96
        },
        recommended: {
            shooting: 70,
            defense: 88,
            dribble: 68,
            finishing: 94
        }
    },
    C: {
        code: 'C',
        name: 'Pivot (Center)',
        shortName: 'Pivot (C)',
        heightLabel: '2m16 (7\'1")',
        scaleY: 1.13,
        scaleXZ: 1.15,
        baseSpeed: 0.88,
        specialty: 'Géant dominant au rebond, protection de cercle et finition près du cercle.',
        bonuses: '+25% Portée de Contre & Rebond | Domination sous le panneau',
        caps: {
            shooting: 75,
            defense: 99,
            dribble: 70,
            finishing: 99
        },
        recommended: {
            shooting: 64,
            defense: 96,
            dribble: 64,
            finishing: 96
        }
    }
};

/**
 * Base des 10 Presets / Modèles de personnages personnalisables
 */
export const CHARACTER_PRESETS = [
    {
        id: 1,
        presetName: '1. "Flash" Kyrie',
        playerName: 'Flash_PG',
        position: 'PG',
        skinTone: 'skin_5',
        hairStyle: 'afro',
        beardStyle: 'goatee',
        hairColor: 'black',
        jerseyColor: 'brooklyn_black',
        jerseyNumber: '11',
        attributes: { shooting: 84, defense: 70, dribble: 96, finishing: 70 }
    },
    {
        id: 2,
        presetName: '2. "Splash" Steph',
        playerName: 'SplashChef',
        position: 'SG',
        skinTone: 'skin_2',
        hairStyle: 'headband_curls',
        beardStyle: 'goatee',
        hairColor: 'dark_brown',
        jerseyColor: 'warriors_blue',
        jerseyNumber: '30',
        attributes: { shooting: 98, defense: 70, dribble: 84, finishing: 68 }
    },
    {
        id: 3,
        presetName: '3. "King" Bron',
        playerName: 'KingJames',
        position: 'SF',
        skinTone: 'skin_6',
        hairStyle: 'buzz',
        beardStyle: 'full_beard',
        hairColor: 'black',
        jerseyColor: 'lakers_gold',
        jerseyNumber: '23',
        attributes: { shooting: 78, defense: 80, dribble: 76, finishing: 86 }
    },
    {
        id: 4,
        presetName: '4. "Greek" Freak',
        playerName: 'TheFreak',
        position: 'PF',
        skinTone: 'skin_6',
        hairStyle: 'fade_top',
        beardStyle: 'stubble',
        hairColor: 'black',
        jerseyColor: 'celtics_green',
        jerseyNumber: '34',
        attributes: { shooting: 66, defense: 90, dribble: 70, finishing: 94 }
    },
    {
        id: 5,
        presetName: '5. "Wemby" Titan',
        playerName: 'AlienVictor',
        position: 'C',
        skinTone: 'skin_5',
        hairStyle: 'buzz',
        beardStyle: 'none',
        hairColor: 'black',
        jerseyColor: 'brooklyn_black',
        jerseyNumber: '1',
        attributes: { shooting: 72, defense: 96, dribble: 62, finishing: 90 }
    },
    {
        id: 6,
        presetName: '6. "Beard" James',
        playerName: 'TheBeard13',
        position: 'SG',
        skinTone: 'skin_6',
        hairStyle: 'mohawk',
        beardStyle: 'full_beard',
        hairColor: 'black',
        jerseyColor: 'bulls_red',
        jerseyNumber: '13',
        attributes: { shooting: 92, defense: 66, dribble: 88, finishing: 74 }
    },
    {
        id: 7,
        presetName: '7. "Lockdown" Kawhi',
        playerName: 'TheKlaw',
        position: 'SF',
        skinTone: 'skin_6',
        hairStyle: 'dreads',
        beardStyle: 'goatee',
        hairColor: 'black',
        jerseyColor: 'miami_vice',
        jerseyNumber: '2',
        attributes: { shooting: 80, defense: 92, dribble: 72, finishing: 76 }
    },
    {
        id: 8,
        presetName: '8. "Joker" Nikola',
        playerName: 'TheJoker15',
        position: 'C',
        skinTone: 'skin_1',
        hairStyle: 'buzz',
        beardStyle: 'stubble',
        hairColor: 'light_brown',
        jerseyColor: 'warriors_blue',
        jerseyNumber: '15',
        attributes: { shooting: 75, defense: 85, dribble: 70, finishing: 90 }
    },
    {
        id: 9,
        presetName: '9. "HighFly" Ja',
        playerName: 'AirMorant',
        position: 'PG',
        skinTone: 'skin_5',
        hairStyle: 'dreads',
        beardStyle: 'chinstrap',
        hairColor: 'blonde',
        jerseyColor: 'miami_vice',
        jerseyNumber: '12',
        attributes: { shooting: 74, defense: 72, dribble: 92, finishing: 82 }
    },
    {
        id: 10,
        presetName: '10. "Worm" Dennis',
        playerName: 'BadBoy91',
        position: 'PF',
        skinTone: 'skin_6',
        hairStyle: 'afro',
        beardStyle: 'mustache',
        hairColor: 'neon_blue',
        jerseyColor: 'bulls_red',
        jerseyNumber: '91',
        attributes: { shooting: 62, defense: 95, dribble: 72, finishing: 91 }
    }
];

export const GAME_MODES = {
    '3v3': {
        id: '3v3',
        name: '3v3 Demi-Terrain (Streetball)',
        playersPerTeam: 3,
        isHalfCourt: true,
        targetScore: 21,
        description: 'Demi-terrain rapide. Check-ball en haut de la raquette et sortie obligatoire derrière l\'arc après rebond défensif.'
    },
    '4v4': {
        id: '4v4',
        name: '4v4 Demi-Terrain (Park)',
        playersPerTeam: 4,
        isHalfCourt: true,
        targetScore: 21,
        description: 'Demi-terrain intense à 8 joueurs sur le parquet. Idéal pour combiner écrans, coupes et tirs extérieurs.'
    },
    '5v5': {
        id: '5v5',
        name: '5v5 Tout-Terrain (Pro Arena)',
        playersPerTeam: 5,
        isHalfCourt: false,
        targetScore: 30,
        description: 'Match réglementaire tout-terrain avec transitions attaque/défense sur les deux paniers.'
    }
};
