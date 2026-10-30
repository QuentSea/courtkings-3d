/**
 * Career.js — Progression du joueur, gardée dans ce navigateur (clé `courtkings_carriere`) :
 * - expérience gagnée à chaque match terminé (victoire, points, rebonds, passes décisives, interceptions, contres,
 *   dunks) ; chaque niveau donne 2 points d'atouts en plus dans le créateur (niveau 30 au plus) ;
 * - historique des 20 derniers matchs, bilan victoires / défaites, série en cours, records d'un match ;
 * - records des modes à part (concours à 3 points, tournois gagnés), remplis par ces modes.
 */

const STORAGE_KEY = 'courtkings_carriere';
const HISTORY = 20;
export const MAX_LEVEL = 30;
export const POINTS_PER_LEVEL = 2;

function empty() {
    return {
        xp: 0,
        wins: 0,
        losses: 0,
        streak: 0,       // victoires d'affilée en cours
        bestStreak: 0,
        records: { pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, contest3: 0, tournaments: 0 },
        matches: []      // les plus récents d'abord
    };
}

export function loadCareer() {
    try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
        if (saved && typeof saved.xp === 'number') {
            const c = empty();
            return { ...c, ...saved, records: { ...c.records, ...saved.records }, matches: saved.matches || [] };
        }
    } catch { /* données du site bloquées ou abîmées : on repart de zéro */ }
    return empty();
}

function saveCareer(career) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(career));
    } catch { /* pas de sauvegarde possible : la progression tient jusqu'à la fermeture */ }
}

/** Niveau atteint avec `xp` : il faut 200 XP pour le niveau 2, puis 50 de plus à chaque niveau */
export function levelOf(xp) {
    let level = 1;
    let floor = 0;
    let need = 200;
    while (level < MAX_LEVEL && xp >= floor + need) {
        floor += need;
        level++;
        need = 150 + 50 * level;
    }
    return { level, into: xp - floor, need: level < MAX_LEVEL ? need : 0 };
}

/** Points d'atouts en plus gagnés avec les niveaux (créateur de joueur) */
export function bonusPoints(career = loadCareer()) {
    return (levelOf(career.xp).level - 1) * POINTS_PER_LEVEL;
}

/** Expérience d'un match d'après la feuille de match du joueur */
export function matchXp(s, won) {
    const reb = (s.orb || 0) + (s.drb || 0);
    return Math.round(40 + (won ? 60 : 0) + (s.pts || 0) * 3 + reb * 2 + (s.ast || 0) * 4 +
        (s.stl || 0) * 4 + (s.blk || 0) * 4 + (s.dunkM || 0) * 2);
}

/**
 * Enregistre un match terminé. entry : { mode, won, scoreFor, scoreAgainst, stats }.
 * Renvoie { xp, before, after } (niveaux avant et après) pour l'écran de fin
 */
export function recordMatch(entry) {
    const career = loadCareer();
    const before = levelOf(career.xp);
    const s = entry.stats || {};
    const xp = matchXp(s, entry.won);
    career.xp += xp;
    if (entry.won) {
        career.wins++;
        career.streak++;
        career.bestStreak = Math.max(career.bestStreak, career.streak);
    } else {
        career.losses++;
        career.streak = 0;
    }
    const reb = (s.orb || 0) + (s.drb || 0);
    const r = career.records;
    r.pts = Math.max(r.pts, s.pts || 0);
    r.reb = Math.max(r.reb, reb);
    r.ast = Math.max(r.ast, s.ast || 0);
    r.stl = Math.max(r.stl, s.stl || 0);
    r.blk = Math.max(r.blk, s.blk || 0);
    career.matches.unshift({
        date: new Date().toISOString().slice(0, 10),
        mode: entry.mode,
        won: entry.won,
        score: `${entry.scoreFor}-${entry.scoreAgainst}`,
        pts: s.pts || 0,
        reb,
        ast: s.ast || 0,
        xp
    });
    career.matches.length = Math.min(career.matches.length, HISTORY);
    saveCareer(career);
    return { xp, before, after: levelOf(career.xp) };
}

/** Record d'un mode à part (ex. concours à 3 points) ; renvoie vrai si c'est un nouveau record */
export function recordBest(key, value) {
    const career = loadCareer();
    if (value <= (career.records[key] || 0)) return false;
    career.records[key] = value;
    saveCareer(career);
    return true;
}

/** Compte un événement (ex. tournoi gagné) */
export function addToRecord(key, n = 1) {
    const career = loadCareer();
    career.records[key] = (career.records[key] || 0) + n;
    saveCareer(career);
}
