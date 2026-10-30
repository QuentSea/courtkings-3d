/**
 * Tests du salon en ligne : ce que l'hôte accepte d'un invité (identité, messages d'hôte, profil truqué).
 * Lancer depuis le dossier du jeu :  node --test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NetworkManager, cleanProfile } from '../js/network/NetworkManager.js';
import { CHARACTER_PRESETS, POSITIONS } from '../js/config/constants.js';

/** Hôte sans réseau, avec ses connexions PeerJS simulées (une par invité) */
function fakeHost() {
    const net = new NetworkManager({});
    net.isHost = true;
    net.broadcastPacket = () => {};
    net.lobbyState.players[net.localPeerId] = { peerId: net.localPeerId, team: 'A', profile: CHARACTER_PRESETS[0], isHost: true };
    const connect = (id) => {
        const conn = { peer: `pj-${id}`, open: true };
        net.peers.set(conn.peer, conn);
        net.handleIncomingPacket({ type: 'JOIN_REQUEST', senderId: id, profile: CHARACTER_PRESETS[1] }, conn);
        return conn;
    };
    return { net, connect };
}

test('un invité ne parle que pour son propre joueur', () => {
    const { net, connect } = fakeHost();
    const ami = connect('peer_ami');
    const tricheur = connect('peer_triche');
    assert.equal(ami.lobbyPeerId, 'peer_ami');
    const equipeAmi = net.lobbyState.players.peer_ami.team;
    const autre = equipeAmi === 'A' ? 'B' : 'A';

    // Changer l'équipe d'un ami, ou se faire passer pour l'hôte : refusé
    net.handleIncomingPacket({ type: 'TEAM_SWITCH', senderId: 'peer_ami', team: autre }, tricheur);
    assert.equal(net.lobbyState.players.peer_ami.team, equipeAmi);
    net.handleIncomingPacket({ type: 'JOIN_REQUEST', senderId: net.localPeerId, profile: { playerName: 'pirate' } }, tricheur);
    assert.equal(net.lobbyState.players[net.localPeerId].profile.playerName, CHARACTER_PRESETS[0].playerName);
    // Une deuxième identité sur la même connexion (remplir le salon de faux joueurs) : refusée
    net.handleIncomingPacket({ type: 'JOIN_REQUEST', senderId: 'peer_faux1', profile: {} }, tricheur);
    assert.equal(net.lobbyState.players.peer_faux1, undefined);
    // Prendre l'identité d'un ami déjà connecté : refusé
    const intrus = { peer: 'pj-intrus', open: true };
    net.peers.set(intrus.peer, intrus);
    net.handleIncomingPacket({ type: 'JOIN_REQUEST', senderId: 'peer_ami', profile: { playerName: 'pirate' } }, intrus);
    assert.notEqual(net.lobbyState.players.peer_ami.profile.playerName, 'pirate');

    // Son propre changement d'équipe passe
    const sienne = net.lobbyState.players.peer_triche.team;
    net.handleIncomingPacket({ type: 'TEAM_SWITCH', senderId: 'peer_triche', team: sienne === 'A' ? 'B' : 'A' }, tricheur);
    assert.notEqual(net.lobbyState.players.peer_triche.team, sienne);
});

test("un invité ne peut pas envoyer les messages de l'hôte", () => {
    const { net, connect } = fakeHost();
    const tricheur = connect('peer_triche');
    let started = 0;
    net.callbacks.onMatchStart = () => started++;
    net.handleIncomingPacket({ type: 'LOBBY_SYNC', senderId: 'peer_triche', lobbyState: { players: {} } }, tricheur);
    net.handleIncomingPacket({ type: 'START_MATCH', senderId: 'peer_triche', lobbyState: { players: {} } }, tricheur);
    assert.equal(Object.keys(net.lobbyState.players).length, 2);
    assert.equal(started, 0);
});

test("les actions d'un invité portent un numéro à son nom", () => {
    const { net, connect } = fakeHost();
    const tricheur = connect('peer_triche');
    const recues = [];
    net.callbacks.onRemoteGameEvent = (p) => recues.push(p.eventId);
    // Numéro au nom d'un autre : ignoré (sinon la vraie action de l'autre passerait pour un doublon)
    net.handleIncomingPacket({ type: 'GAME_EVENT', senderId: 'peer_triche', eventId: 'peer_ami_1', eventName: 'PASS', payload: {} }, tricheur);
    net.handleIncomingPacket({ type: 'GAME_EVENT', senderId: 'peer_triche', eventId: 'peer_triche_1', eventName: 'PASS', payload: {} }, tricheur);
    assert.deepEqual(recues, ['peer_triche_1']);
});

test('un profil truqué est ramené aux limites du créateur', () => {
    // Les joueurs tout faits du jeu passent sans changement
    for (const preset of CHARACTER_PRESETS) {
        const clean = cleanProfile(preset);
        assert.deepEqual(clean.attributes, preset.attributes, preset.playerName);
        assert.equal(clean.playerName, preset.playerName);
        assert.equal(clean.hairStyle, preset.hairStyle);
    }
    const p = cleanProfile({
        playerName: 'x'.repeat(100000), position: 'constructor', hairStyle: '<img>', jerseyNumber: '99999',
        attributes: { shooting: 999, defense: NaN, dribble: -5, finishing: '1e9' }
    });
    assert.equal(p.playerName.length, 14);
    assert.equal(p.position, CHARACTER_PRESETS[0].position);
    assert.equal(p.hairStyle, CHARACTER_PRESETS[0].hairStyle);
    assert.equal(p.jerseyNumber, '99');
    const caps = POSITIONS[p.position].caps;
    for (const k of Object.keys(caps)) assert.ok(p.attributes[k] >= 60 && p.attributes[k] <= caps[k], k);
    assert.equal(cleanProfile(null).playerName, CHARACTER_PRESETS[0].playerName);
});
