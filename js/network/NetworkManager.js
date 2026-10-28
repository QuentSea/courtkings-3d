/**
 * NetworkManager.js
 * Architecture Réseau Temps Réel Hybride (Étape 4) :
 * - Génère des codes de salon courts (ex: BASKET-42) et un lien partageable (?room=BASKET-42)
 * - Canal 1 : PeerJS (WebRTC Cloud Broker gratuit) pour jouer en ligne entre amis sur différents PC/réseaux
 * - Canal 2 : BroadcastChannel local instantané pour tester plusieurs fenêtres/onglets sur la même machine sans latence
 * - Synchronise : Profils 3D du Lobby, Équipes (A/B), Mode (3v3, 4v4, 5v5), Positions des joueurs, Animations, Ballon et Score.
 */

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
            matchStarted: false,
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
            matchStarted: false,
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
        await this.setupPeerJSHost(this.roomCode);
        this.notifyLobbyUpdated();
        return this.roomCode;
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
                this.peerInstance.on('open', () => resolve(true));
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
                    });
                });
                this.peerInstance.on('error', () => resolve(false));
                setTimeout(() => resolve(false), 1800);
            } catch {
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
                    setTimeout(() => resolve(false), 1800);
                });
                this.peerInstance.on('error', () => resolve(false));
            } catch {
                resolve(false);
            }
        });
    }

    handleIncomingPacket(packet) {
        if (!packet || !packet.type) return;

        if (packet.type === 'JOIN_REQUEST' && this.isHost) {
            // La demande arrive par BroadcastChannel ET par PeerJS : ne pas recompter un joueur déjà présent
            const existing = this.lobbyState.players[packet.senderId];
            if (existing) {
                existing.profile = packet.profile;
                this.broadcastLobbyState();
                this.notifyLobbyUpdated();
                return;
            }
            const countA = Object.values(this.lobbyState.players).filter(p => p.team === 'A').length;
            const countB = Object.values(this.lobbyState.players).filter(p => p.team === 'B').length;
            const assignedTeam = countA <= countB ? 'A' : 'B';

            this.lobbyState.players[packet.senderId] = {
                peerId: packet.senderId,
                team: assignedTeam,
                profile: packet.profile,
                isHost: false
            };
            this.broadcastLobbyState();
            this.notifyLobbyUpdated();
        } else if (packet.type === 'LOBBY_SYNC') {
            this.lobbyState = packet.lobbyState;
            this.notifyLobbyUpdated();
        } else if (packet.type === 'TEAM_SWITCH') {
            const p = this.lobbyState.players[packet.senderId];
            if (p) {
                p.team = packet.team;
                if (this.isHost) this.broadcastLobbyState();
                this.notifyLobbyUpdated();
            }
        } else if (packet.type === 'PROFILE_UPDATE') {
            const p = this.lobbyState.players[packet.senderId];
            if (p) {
                p.profile = packet.profile;
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
        if (!me) return;
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
        this.lobbyState.matchStarted = true;
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

    notifyLobbyUpdated() {
        if (this.callbacks.onLobbyUpdate) {
            this.callbacks.onLobbyUpdate(this.lobbyState);
        }
    }

    cleanup() {
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
