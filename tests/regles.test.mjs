/**
 * Tests des règles du match (chrono de tir, fin de match, feuille de match, fautes), sans navigateur ni 3D.
 * Lancer depuis le dossier du jeu :  node --test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClockMethods, SHOT_CLOCK } from '../js/gameplay/Clock.js';
import { MatchSheetMethods } from '../js/gameplay/MatchSheet.js';
import { FoulMethods } from '../js/gameplay/Fouls.js';

// Les règles touchent un peu à la page (écran de fin) : une page vide suffit ici
globalThis.document = { getElementById: () => null };

/** Faux moteur : juste ce dont les règles ont besoin, l'hôte qui décide de tout */
function fakeEngine({ targetScore = 21, gameDuration = 420, isHalfCourt = true } = {}) {
    const players = [
        { id: 'a1', team: 'A', pos: { x: 0, z: 0 }, profile: { playerName: 'A1' } },
        { id: 'a2', team: 'A', pos: { x: 0, z: 0 }, profile: { playerName: 'A2' } },
        { id: 'b1', team: 'B', pos: { x: 0, z: 0 }, profile: { playerName: 'B1' } }
    ];
    const engine = Object.assign({}, ClockMethods, MatchSheetMethods, FoulMethods, {
        isAuthority: true,
        currentMode: { targetScore, gameDuration, isHalfCourt },
        entities: new Map(players.map(p => [p.id, p])),
        ball: { state: 'HELD', holderId: 'a1', pos: { set() {} }, vel: { set() {} } },
        matchRules: { scoreA: 0, scoreB: 0, possessionTeam: 'A', sidesSwapped: false },
        network: { isHost: true },
        checkBalls: [],
        alerts: [],
        updateScoreboardUI() {},
        checkHalftime() {},
        showRuleAlert(text) { this.alerts.push(text); },
        showMatchEnd() {},
        getLocalEntity() { return null; },
        // Tactiques (Tactics.js charge Three.js) : sans effet ici
        resetTactics() {},
        noteScoreForTactics() {},
        pickPossessionPlay() {}
    });
    // Remise en jeu et lancers francs notés au lieu d'attendre un minuteur
    engine.scheduleCheckBall = (team) => engine.checkBalls.push(team);
    engine.freeThrows = [];
    engine.scheduleFreeThrows = (shooter, total) => engine.freeThrows.push([shooter.id, total]);
    engine.resetMatchClock();
    return engine;
}

test('chrono de tir : 24 s si l\'équipe change, 14 s au moins après un rebond offensif', () => {
    const e = fakeEngine();
    const r = e.matchRules;
    r.shotClock = 5;
    r.shotClockStopped = true; // un tir vient de partir
    e.onPossessionGained('A', 'A');
    assert.equal(r.shotClock, 14, 'rebond offensif : repart à 14');
    assert.equal(r.shotClockStopped, false);

    r.shotClock = 18;
    r.shotClockStopped = true;
    e.onPossessionGained('A', 'A');
    assert.equal(r.shotClock, 18, 'il restait plus de 14 s : on garde le temps');

    r.shotClock = 3;
    e.onPossessionGained('A', 'B');
    assert.equal(r.shotClock, SHOT_CLOCK, 'changement d\'équipe : repart à 24');
});

test('chrono de tir à zéro : balle à l\'autre équipe et balle perdue au porteur', () => {
    const e = fakeEngine();
    e.matchRules.shotClock = 0.01;
    e.updateMatchClock(0.05);
    assert.equal(e.matchRules.deadBall, true);
    assert.deepEqual(e.checkBalls, ['B']);
    assert.equal(e.matchSheet.stats.a1.tov, 1);
});

test('fin de match au score cible', () => {
    const e = fakeEngine({ targetScore: 21 });
    e.matchRules.scoreA = 19;
    e.scorePoints('A', 2, 'a1');
    assert.equal(e.matchRules.matchOver, true);
    assert.equal(e.matchRules.winner, 'A');
    assert.deepEqual(e.checkBalls, [], 'pas de remise en jeu après la fin');
});

test('temps écoulé : vainqueur si écart, panier en or si égalité', () => {
    const lead = fakeEngine();
    lead.matchRules.scoreA = 9;
    lead.matchRules.scoreB = 7;
    lead.matchRules.gameClock = 0.01;
    lead.updateMatchClock(0.05);
    assert.equal(lead.matchRules.winner, 'A');

    const tie = fakeEngine();
    tie.matchRules.scoreA = 10;
    tie.matchRules.scoreB = 10;
    tie.matchRules.gameClock = 0.01;
    tie.updateMatchClock(0.05);
    assert.equal(tie.matchRules.matchOver, false);
    assert.equal(tie.matchRules.goldenPoint, true);
    tie.matchRules.deadBall = false;
    tie.scorePoints('B', 2, 'b1');
    assert.equal(tie.matchRules.winner, 'B', 'le premier panier en or gagne');
});

test('un tir en l\'air à la sirène compte encore', () => {
    const e = fakeEngine();
    e.matchRules.scoreA = 10;
    e.matchRules.scoreB = 10;
    e.matchRules.gameClock = 0.01;
    e.ball.state = 'SHOT';
    e.updateMatchClock(0.05);
    assert.equal(e.matchRules.matchOver, false, 'on attend la fin du tir');
    e.scorePoints('A', 3, 'a1');
    assert.equal(e.matchRules.winner, 'A');
});

test('feuille de match : passe décisive, interception et rebonds', () => {
    const e = fakeEngine();
    // a2 passe à a1, qui marque tout de suite : passe décisive pour a2
    e.onBallGained({ team: 'A', state: 'PASS', holderId: null, passFromId: 'a2', afterShot: false }, e.entities.get('a1'));
    e.matchRules.scoreA += 2;
    e.onScored('A', 2, 'a1', 'shot');
    assert.equal(e.matchSheet.stats.a2.ast, 1);
    assert.equal(e.matchSheet.stats.a1.pts, 2);

    // b1 prend le ballon que tenait a1 : interception pour b1, balle perdue pour a1
    e.onBallGained({ team: 'A', state: 'HELD', holderId: 'a1', afterShot: false }, e.entities.get('b1'));
    assert.equal(e.matchSheet.stats.b1.stl, 1);
    assert.equal(e.matchSheet.stats.a1.tov, 1);

    // Après un tir : même équipe = rebond offensif, autre équipe = rebond défensif
    e.onBallGained({ team: 'B', state: 'LOOSE', afterShot: true }, e.entities.get('b1'));
    e.onBallGained({ team: 'B', state: 'LOOSE', afterShot: true }, e.entities.get('a2'));
    assert.equal(e.matchSheet.stats.b1.orb, 1);
    assert.equal(e.matchSheet.stats.a2.drb, 1);
});

test('pas de passe décisive si le panier arrive trop longtemps après la passe', () => {
    const e = fakeEngine();
    e.onBallGained({ team: 'A', state: 'PASS', passFromId: 'a2', afterShot: false }, e.entities.get('a1'));
    e.liveTime += 10;
    e.onScored('A', 2, 'a1', 'shot');
    assert.equal(e.matchSheet.stats.a2?.ast ?? 0, 0);
});

test('faute sur tir : 2 ou 3 lancers si raté, 1 seul (and one) si réussi', () => {
    const missed3 = fakeEngine();
    missed3.commitFoul('b1', 'a1', { shotPts: 3, made: false });
    assert.deepEqual(missed3.freeThrows, [['a1', 3]]);
    assert.equal(missed3.matchSheet.stats.b1.pf, 1);
    assert.equal(missed3.matchRules.deadBall, true);

    const andOne = fakeEngine();
    andOne.scorePoints('A', 2, 'a1', 'shot', () => andOne.commitFoul('b1', 'a1', { shotPts: 2, made: true }));
    assert.equal(andOne.matchRules.scoreA, 2, 'le panier compte');
    assert.deepEqual(andOne.freeThrows, [['a1', 1]]);
    assert.deepEqual(andOne.checkBalls, [], 'pas de remise en jeu avant le lancer franc');
});

test("faute hors tir : remise en jeu, puis lancers francs au bonus (5e faute d'équipe en 5v5)", () => {
    const e = fakeEngine({ isHalfCourt: false });
    for (let i = 0; i < 4; i++) e.commitFoul('b1', 'a2');
    assert.deepEqual(e.checkBalls, ['A', 'A', 'A', 'A']);
    assert.deepEqual(e.freeThrows, []);
    e.commitFoul('b1', 'a2');
    assert.deepEqual(e.freeThrows, [['a2', 2]]);
    assert.equal(e.matchRules.teamFouls.B, 5);
});

test('lancer franc réussi : 1 point, pas de passe décisive', () => {
    const e = fakeEngine();
    e.onBallGained({ team: 'A', state: 'PASS', passFromId: 'a2', afterShot: false }, e.entities.get('a1'));
    e.scorePoints('A', 1, 'a1', 'ft');
    assert.equal(e.matchRules.scoreA, 1);
    assert.equal(e.matchSheet.stats.a1.ftm, 1);
    assert.equal(e.matchSheet.stats.a2?.ast ?? 0, 0);
});
