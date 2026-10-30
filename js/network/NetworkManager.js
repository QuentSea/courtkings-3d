/**
 * NetworkManager.js
 * Architecture Réseau Temps Réel Hybride (Étape 4) :
 * - Génère des codes de salon courts (ex: BASKET-42) et un lien partageable (?room=BASKET-42)
 * - Canal 1 : PeerJS (WebRTC Cloud Broker gratuit) pour jouer en ligne entre amis sur différents PC/réseaux
 * - Canal 2 : BroadcastChannel local instantané pour tester plusieurs fenêtres/onglets sur la même machine sans latence
 * - Synchronise : Profils 3D du Lobby, Équipes (A/B), Mode (3v3, 4v4, 5v5), Positions des joueurs, Animations, Ballon et Score.
 */

import {
    ATTRIBUTE_POOL, BEARD_STYLES, CHARACTER_PRESETS, HAIR_COLORS, HAIR_STYLES, JERSEY_COLORS, POSITIONS, SKIN_TONES
} from '../config/constants.js';
import { MAX_LEVEL, POINTS_PER_LEVEL } from '../progress/Career.js';

// 10 joueurs humains au maximum (5 contre 5)
const MAX_PER_TEAM = 5;
const MODE_SIZES = { '3v3': 3, '4v4': 4, '5v5': 5 };
const DIFFICULTY_KEY = 'courtkings_difficulte';
// Messages que seul l'hôte envoie : venant d'un invité, ce serait une prise de contrôle du salon
const HOST_ONLY = new Set(['LOBBY_SYNC', 'START_MATCH', 'WORLD_STATE', 'ROOM_FULL']);
const PEER_ID = /^peer_[a-z0-9]{1,12}$/;

/**
 * Profil reçu d'un invité : seulement les champs connus, des choix qui existent, et des atouts dans
 * les limites du créateur (plafonds du poste, points du plus haut niveau). Un profil truqué ne casse rien.
 */
export function cleanProfile(p) {
    const base = CHARACTER_PRESETS[0];
    if (!p || typeof p !== 'object') p = base;
    const pick = (list, v, fallback) => (list.some(o => o.id === v) ? v : fallback);
    const position = Object.hasOwn(POSITIONS, p.position) ? p.position : base.position;
    const caps = POSITIONS[position].caps;
    const min = ATTRIBUTE_POOL.STARTING_BASE;
    const attributes = {};
    let bonus = 0;
    for (const k of Object.keys(caps)) {
        const v = Number(p.attributes?.[k]);
        attributes[k] = Math.round(Math.max(min, Math.min(caps[k], Number.isFinite(v) ? v : min)));
        bonus += attributes[k] - min;
    }
    // Plus de points que le niveau maximum n'en donne : tous réduits dans la même proportion
    const maxBonus = ATTRIBUTE_POOL.TOTAL_BONUS_POINTS + (MAX_LEVEL - 1) * POINTS_PER_LEVEL;
    if (bonus > maxBonus) {
        for (const k in attributes) attributes[k] = min + Math.floor((attributes[k] - min) * maxBonus / bonus);
    }
    return {
        playerName: String(p.playerName ?? '').trim().slice(0, 14) || 'Joueur',
        position,
        skinTone: pick(SKIN_TONES, p.skinTone, base.skinTone),
        hairStyle: pick(HAIR_STYLES, p.hairStyle, base.hairStyle),
        beardStyle: pick(BEARD_STYLES, p.beardStyle, base.beardStyle),
        hairColor: pick(HAIR_COLORS, p.hairColor, base.hairColor),
        jerseyColor: pick(JERSEY_COLORS, p.jerseyColor, base.jerseyColor),
        jerseyNumber: String(p.jerseyNumber ?? '').replace(/\D/g, '').slice(0, 2) || '0',
        attributes
    };
}

/** Dernier niveau des bots choisi par ce joueur (Normal par défaut) */
function savedDifficulty() {
    try {
        return localStorage.getItem(DIFFICULTY_KEY) || 'NORMAL';
    } catch {
        return 'NORMAL';
    }
}

export class NetworkManager {
    constructor(callbacks = {}) {
        this.callbacks = callbacks;
        this.roomCode = null;
        this.isHost = false;
        this.localPeerId = 'peer_' + Math.random().toString(36).substring(2, 9);
        this.peers = new Map(); // peerId -> DataConnection (PeerJS)
        this.broadcastChannel = null;
        this.peerInstance = null;
        this.eventCounter = 0;
        this.seenEventIds = new Set();

        this.lobbyState = {
            roomCode: '',
            mode: '3v3',
            fillWithBots: true,
            players: {} // peerId -> { peerId, team: 'A'|'B', profile, isHost }
        };
    }

    generateRoomCode() {
        // 4 caractères (sans 0/O, 1/I/L) : ~700 000 codes, pour ne pas croiser d'autres joueurs
        // sur le serveur PeerJS public une fois le jeu en ligne
        const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
        let suffix = '';
        for (let i = 0; i < 4; i++) {
            suffix += alphabet[Math.floor(Math.random() * alphabet.length)];
        }
        return `BASKET-${suffix}`;
    }

    /**
     * Crée un salon en tant qu'Hôte
     */
    async createRoom(localProfile, mode = '3v3', customCode = null) {
        this.cleanup();
        this.isHost = true;
        this.roomCode = (customCode || this.generateRoomCode()).toUpperCase();

        this.lobbyState = {
            roomCode: this.roomCode,
            mode,
            fillWithBots: true,
            difficulty: savedDifficulty(),
            players: {
                [this.localPeerId]: {
                    peerId: this.localPeerId,
                    team: 'A',
                    profile: localProfile,
                    isHost: true
                }
            }
        };

        this.setupBroadcastChannel(this.roomCode);
        this.setOnlineStatus('connecting');
        await this.setupPeerJSHost(this.roomCode);
        this.notifyLobbyUpdated();
        return this.roomCode;
    }

    /**
     * État de la connexion affiché dans le salon :
     * 'connecting', 'online' (joignable d'autres PC), 'local' (onglets de ce PC seulement),
     * 'not-found' (salon rejoint introuvable)
     */
    setOnlineStatus(status) {
        if (status === this.onlineStatus) return; // PeerJS et le délai d'attente peuvent annoncer la même chose
        this.onlineStatus = status;
        if (this.callbacks.onOnlineStatus) this.callbacks.onOnlineStatus(status, this.isHost);
    }

    /**
     * Rejoint un salon existant via son Code (ex: BASKET-42)
     */
    async joinRoom(roomCode, localProfile) {
        this.cleanup();
        this.isHost = false;
        this.roomCode = roomCode.trim().toUpperCase();

        this.lobbyState.roomCode = this.roomCode;
        this.lobbyState.players[this.localPeerId] = {
            peerId: this.localPeerId,
            team: 'B',
            profile: localProfile,
            isHost: false
        };

        this.setupBroadcastChannel(this.roomCode);
        this.gotHostSync = false;
        this.setOnlineStatus('connecting');
        // Sans réponse de l'hôte (code faux, hôte parti, PeerJS injoignable) : prévenir le joueur
        this.hostSyncTimer = setTimeout(() => {
            if (!this.gotHostSync) this.setOnlineStatus('not-found');
        }, 6000);
        await this.setupPeerJSClient(this.roomCode, localProfile);

        // Annoncer l'arrivée sur BroadcastChannel (multi-onglets local)
        this.sendBroadcast({
            type: 'JOIN_REQUEST',
            senderId: this.localPeerId,
            profile: localProfile
        });

        this.notifyLobbyUpdated();
        return this.roomCode;
    }

    setupBroadcastChannel(code) {
        if (typeof BroadcastChannel === 'undefined') return;
        this.broadcastChannel = new BroadcastChannel(`courtkings_room_${code}`);
        this.broadcastChannel.onmessage = (event) => {
            this.handleIncomingPacket(event.data);
        };
    }

    sendBroadcast(packet) {
        if (this.broadcastChannel) {
            this.broadcastChannel.postMessage(packet);
        }
    }

    async setupPeerJSHost(roomCode) {
        if (!window.Peer) return;
        const peerId = `courtkings-2k-${roomCode.toLowerCase()}`;
        return new Promise((resolve) => {
            try {
                this.peerInstance = new window.Peer(peerId);
                this.peerInstance.on('open', () => {
                    this.setOnlineStatus('online');
                    resolve(true);
                });
                this.peerInstance.on('connection', (conn) => {
                    conn.on('open', () => {
                        this.peers.set(conn.peer, conn);
                        conn.send({
                            type: 'LOBBY_SYNC',
                            lobbyState: this.lobbyState
                        });
                    });
                    conn.on('data', (data) => this.handleIncomingPacket(data, conn));
                    conn.on('close', () => {
                        this.peers.delete(conn.peer);
                        // Un invité est parti : le retirer du salon (son joueur passe en bot pendant un match)
                        if (conn.lobbyPeerId) this.removePlayer(conn.lobbyPeerId);
                    });
                });
                // Serveur PeerJS injoignable ou code déjà pris : le salon ne marche que sur ce PC
                this.peerInstance.on('error', () => {
                    this.setOnlineStatus('local');
                    resolve(false);
                });
                setTimeout(() => resolve(false), 1800);
            } catch {
                this.setOnlineStatus('local');
                resolve(false);
            }
        });
    }

    async setupPeerJSClient(roomCode, localProfile) {
        if (!window.Peer) return;
        const hostPeerId = `courtkings-2k-${roomCode.toLowerCase()}`;
        return new Promise((resolve) => {
            try {
                this.peerInstance = new window.Peer();
                this.peerInstance.on('open', () => {
                    const conn = this.peerInstance.connect(hostPeerId);
                    conn.on('open', () => {
                        this.peers.set(hostPeerId, conn);
                        conn.send({
                            type: 'JOIN_REQUEST',
                            senderId: this.localPeerId,
                            profile: localProfile
                        });
                        resolve(true);
                    });
                    conn.on('data', (data) => this.handleIncomingPacket(data, conn));
                    conn.on('close', () => {
                        this.peers.delete(hostPeerId);
                        if (this.callbacks.onHostLeft) this.callbacks.onHostLeft();
                    });
                    setTimeout(() => resolve(false), 1800);
                });
                this.peerInstance.on('error', (err) => {
                    // Hôte introuvable : seulement si aucun onglet de ce PC n'a répondu non plus
                    if (err?.type === 'peer-unavailable' && !this.gotHostSync) this.setOnlineStatus('not-found');
                    resolve(false);
                });
            } catch {
                resolve(false);
            }
        });
    }

    countTeam(team) {
        return Object.values(this.lobbyState.players).filter(p => p.team === team).length;
    }

    /**
     * Hôte : un paquet d'invité (PeerJS) est-il recevable ? Une seule identité par connexion (fixée par sa
     * première demande d'entrée), jamais celle de l'hôte ou d'un autre invité, et jamais un message d'hôte.
     */
    trustPeerPacket(packet, conn) {
        if (HOST_ONLY.has(packet.type)) return false;
        const id = packet.senderId;
        if (packet.type === 'JOIN_REQUEST') {
            if (typeof id !== 'string' || !PEER_ID.test(id) || id === this.localPeerId) return false;
            if (conn.lobbyPeerId && conn.lobbyPeerId !== id) return false;
            for (const other of this.peers.values()) {
                if (other !== conn && other.lobbyPeerId === id) return false;
            }
            return true;
        }
        if (!conn.lobbyPeerId || id !== conn.lobbyPeerId) return false;
        // Numéro d'action à son nom : sinon il pourrait faire ignorer (doublon) les actions d'un autre
        return packet.type !== 'GAME_EVENT' || String(packet.eventId).startsWith(`${id}_`);
    }

    handleIncomingPacket(packet, conn = null) {
        if (!packet || !packet.type) return;
        if (conn && this.isHost && !this.trustPeerPacket(packet, conn)) return;

        if (packet.type === 'JOIN_REQUEST' && this.isHost) {
            if (conn) conn.lobbyPeerId = packet.senderId;
            // La demande arrive par BroadcastChannel ET par PeerJS : ne pas recompter un joueur déjà présent
            const existing = this.lobbyState.players[packet.senderId];
            if (existing) {
                existing.profile = cleanProfile(packet.profile);
                this.broadcastLobbyState();
                this.notifyLobbyUpdated();
                return;
            }
            const countA = this.countTeam('A');
            const countB = this.countTeam('B');
            if (countA >= MAX_PER_TEAM && countB >= MAX_PER_TEAM) {
                // 10 joueurs déjà là (5 contre 5) : prévenir le nouveau venu
                this.broadcastPacket({ type: 'ROOM_FULL', targetId: packet.senderId });
                return;
            }
            const assignedTeam = countA <= countB ? 'A' : 'B';

            this.lobbyState.players[packet.senderId] = {
                peerId: packet.senderId,
                team: assignedTeam,
                profile: cleanProfile(packet.profile),
                isHost: false
            };
            this.broadcastLobbyState();
            this.notifyLobbyUpdated();
        } else if (packet.type === 'ROOM_FULL') {
            if (packet.targetId === this.localPeerId && this.callbacks.onRoomFull) {
                this.callbacks.onRoomFull();
            }
        } else if (packet.type === 'LOBBY_SYNC') {
            if (!this.isHost && !this.gotHostSync) {
                this.gotHostSync = true;
                clearTimeout(this.hostSyncTimer);
                this.setOnlineStatus(conn ? 'online' : 'local');
            }
            this.lobbyState = packet.lobbyState;
            this.notifyLobbyUpdated();
        } else if (packet.type === 'TEAM_SWITCH') {
            const p = this.lobbyState.players[packet.senderId];
            if (p && (packet.team === 'A' || packet.team === 'B')) {
                // L'hôte refuse d'aller dans une équipe déjà à 5 (et renvoie le salon pour annuler le changement)
                const full = p.team !== packet.team && this.countTeam(packet.team) >= MAX_PER_TEAM;
                if (!full) p.team = packet.team;
                if (this.isHost) this.broadcastLobbyState();
                this.notifyLobbyUpdated();
            }
        } else if (packet.type === 'PROFILE_UPDATE') {
            const p = this.lobbyState.players[packet.senderId];
            if (p) {
                p.profile = this.isHost ? cleanProfile(packet.profile) : packet.profile;
                if (this.isHost) this.broadcastLobbyState();
                this.notifyLobbyUpdated();
            }
        } else if (packet.type === 'START_MATCH') {
            this.lobbyState = packet.lobbyState;
            if (this.callbacks.onMatchStart) {
                this.callbacks.onMatchStart(this.lobbyState);
            }
        } else if (packet.type === 'PLAYER_STATE') {
            if (packet.senderId !== this.localPeerId && this.callbacks.onRemotePlayerState) {
                this.callbacks.onRemotePlayerState(packet);
            }
        } else if (packet.type === 'WORLD_STATE') {
            // État du monde décidé par l'hôte (bots, ballon, score) : seuls les invités l'appliquent
            if (!this.isHost && packet.senderId !== this.localPeerId && this.callbacks.onWorldState) {
                this.callbacks.onWorldState(packet);
            }
        } else if (packet.type === 'GAME_EVENT') {
            // Même action reçue par les deux canaux : ne la jouer qu'une fois
            if (packet.eventId) {
                if (this.seenEventIds.has(packet.eventId)) return;
                this.seenEventIds.add(packet.eventId);
                if (this.seenEventIds.size > 500) this.seenEventIds.clear();
            }
            if (packet.senderId !== this.localPeerId && this.callbacks.onRemoteGameEvent) {
                this.callbacks.onRemoteGameEvent(packet);
            }
        }
    }

    broadcastPacket(packet) {
        this.sendBroadcast(packet);
        for (const conn of this.peers.values()) {
            if (conn && conn.open) {
                conn.send(packet);
            }
        }
    }

    broadcastLobbyState() {
        this.broadcastPacket({
            type: 'LOBBY_SYNC',
            lobbyState: this.lobbyState
        });
    }

    switchLocalTeam(newTeam) {
        const me = this.lobbyState.players[this.localPeerId];
        if (!me || me.team === newTeam) return;
        if (this.countTeam(newTeam) >= MAX_PER_TEAM) {
            if (this.callbacks.onTeamFull) this.callbacks.onTeamFull(newTeam);
            return;
        }
        me.team = newTeam;
        this.broadcastPacket({
            type: 'TEAM_SWITCH',
            senderId: this.localPeerId,
            team: newTeam
        });
        if (this.isHost) this.broadcastLobbyState();
        this.notifyLobbyUpdated();
    }

    setGameMode(mode) {
        if (!this.isHost) return;
        this.lobbyState.mode = mode;
        this.broadcastLobbyState();
        this.notifyLobbyUpdated();
    }

    setFillWithBots(fill) {
        if (!this.isHost) return;
        this.lobbyState.fillWithBots = fill;
        this.broadcastLobbyState();
        this.notifyLobbyUpdated();
    }

    /** Niveau des bots adverses (constants.js, DIFFICULTY) : l'hôte choisit, gardé dans son navigateur */
    setDifficulty(level) {
        if (!this.isHost) return;
        this.lobbyState.difficulty = level;
        try {
            localStorage.setItem(DIFFICULTY_KEY, level);
        } catch { /* pas de sauvegarde : le choix tient jusqu'à la fermeture */ }
        this.broadcastLobbyState();
        this.notifyLobbyUpdated();
    }

    updateLocalProfile(profile) {
        const me = this.lobbyState.players[this.localPeerId];
        if (!me) return;
        me.profile = profile;
        this.broadcastPacket({
            type: 'PROFILE_UPDATE',
            senderId: this.localPeerId,
            profile
        });
        this.notifyLobbyUpdated();
    }

    startMatch() {
        // Seul l'hôte lance le match (c'est lui qui le calcule)
        if (!this.isHost) {
            if (this.callbacks.onOnlyHostCanStart) this.callbacks.onOnlyHostCanStart();
            return;
        }
        // Trop d'humains pour le mode choisi : passer au mode qui les accueille tous (ex. 4 contre 3 en 3v3 → 4v4)
        const needed = Math.max(this.countTeam('A'), this.countTeam('B'));
        const currentSize = MODE_SIZES[this.lobbyState.mode] || 3;
        if (needed > currentSize) {
            this.lobbyState.mode = needed <= 4 ? '4v4' : '5v5';
        }
        this.broadcastPacket({
            type: 'START_MATCH',
            lobbyState: this.lobbyState
        });
        if (this.callbacks.onMatchStart) {
            this.callbacks.onMatchStart(this.lobbyState);
        }
    }

    sendPlayerState(statePayload) {
        this.broadcastPacket({
            type: 'PLAYER_STATE',
            senderId: this.localPeerId,
            ...statePayload
        });
    }

    sendWorldState(world) {
        this.broadcastPacket({
            type: 'WORLD_STATE',
            senderId: this.localPeerId,
            ...world
        });
    }

    sendGameEvent(eventName, payload = {}) {
        this.broadcastPacket({
            type: 'GAME_EVENT',
            senderId: this.localPeerId,
            eventId: `${this.localPeerId}_${++this.eventCounter}`,
            eventName,
            payload
        });
    }

    removePlayer(peerId) {
        if (!this.lobbyState.players[peerId]) return;
        delete this.lobbyState.players[peerId];
        this.broadcastLobbyState();
        this.notifyLobbyUpdated();
        if (this.callbacks.onPlayerLeft) this.callbacks.onPlayerLeft(peerId);
    }

    notifyLobbyUpdated() {
        if (this.callbacks.onLobbyUpdate) {
            this.callbacks.onLobbyUpdate(this.lobbyState);
        }
    }

    cleanup() {
        clearTimeout(this.hostSyncTimer);
        if (this.broadcastChannel) {
            this.broadcastChannel.close();
            this.broadcastChannel = null;
        }
        if (this.peerInstance) {
            this.peerInstance.destroy();
            this.peerInstance = null;
        }
        this.peers.clear();
    }
}
