/**
 * CareerUI.js — Affichage de la progression (Career.js) : carte « Niveau » du créateur de joueur et fenêtre
 * « Historique & records ».
 */

import { loadCareer, levelOf, bonusPoints } from './Career.js';

const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;

/** Carte du créateur : niveau, barre d'expérience, bilan, points d'atouts gagnés */
export function renderCareerCard() {
    const c = loadCareer();
    const lv = levelOf(c.xp);
    const set = (id, text) => {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    };
    set('career-level', `⭐ NIVEAU ${lv.level}`);
    const fill = document.getElementById('career-xp-fill');
    if (fill) fill.style.width = `${lv.need ? Math.round((100 * lv.into) / lv.need) : 100}%`;
    const bonus = bonusPoints(c);
    set('career-summary', `${lv.need ? `${lv.into} / ${lv.need} XP` : 'Niveau maximum'} · ` +
        `${plural(c.wins, 'victoire')} · ${plural(c.losses, 'défaite')}` +
        (c.streak > 1 ? ` · série de ${c.streak}` : '') +
        (bonus ? ` · +${bonus} points d'atouts gagnés` : ' · 2 points d\'atouts à chaque niveau'));
}

/** Fenêtre « Historique & records » : bouton du créateur, Fermer ou Échap */
export function bindCareerWindow() {
    const overlay = document.getElementById('career-overlay');
    if (!overlay) return;
    const close = () => overlay.classList.add('hidden');
    document.getElementById('btn-career')?.addEventListener('click', () => {
        fillCareerWindow();
        overlay.classList.remove('hidden');
    });
    document.getElementById('btn-career-close')?.addEventListener('click', close);
    window.addEventListener('keydown', (e) => {
        if (e.code === 'Escape' && !overlay.classList.contains('hidden')) {
            e.stopImmediatePropagation();
            close();
        }
    }, true);
}

function fillCareerWindow() {
    const c = loadCareer();
    const lv = levelOf(c.xp);
    const r = c.records;
    document.getElementById('career-overview').textContent =
        `Niveau ${lv.level} (${c.xp} XP en tout) · ${plural(c.wins, 'victoire')}, ${plural(c.losses, 'défaite')} · ` +
        `meilleure série : ${plural(c.bestStreak, 'victoire')} d'affilée.`;

    // Records : textes fixes et nombres, écrits comme du texte
    const records = document.getElementById('career-records');
    const items = [
        ['Points en un match', r.pts], ['Rebonds', r.reb], ['Passes décisives', r.ast], ['Interceptions', r.stl],
        ['Contres', r.blk], ['Concours à 3 points', r.contest3], ['Tournois gagnés', r.tournaments]
    ];
    records.replaceChildren(...items.map(([label, value]) => {
        const div = document.createElement('div');
        div.className = 'career-record';
        const v = document.createElement('strong');
        v.textContent = value || 0;
        const l = document.createElement('span');
        l.textContent = label;
        div.append(v, l);
        return div;
    }));

    const table = document.getElementById('career-history');
    const head = document.createElement('tr');
    for (const t of ['Date', 'Mode', 'Résultat', 'Score', 'Pts', 'Reb', 'PD', 'XP']) {
        const th = document.createElement('th');
        th.textContent = t;
        head.appendChild(th);
    }
    const rows = c.matches.map((m) => {
        const tr = document.createElement('tr');
        tr.className = m.won ? 'won' : 'lost';
        for (const v of [m.date, m.mode, m.won ? 'Victoire' : 'Défaite', m.score, m.pts, m.reb, m.ast, `+${m.xp}`]) {
            const td = document.createElement('td');
            td.textContent = v;
            tr.appendChild(td);
        }
        return tr;
    });
    if (!rows.length) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = 8;
        td.textContent = 'Pas encore de match terminé : joue un match jusqu\'au bout pour gagner de l\'expérience.';
        tr.appendChild(td);
        rows.push(tr);
    }
    table.replaceChildren(head, ...rows);
}
