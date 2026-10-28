/**
 * CourtScene.js
 * Environnement 3D complet du terrain de basketball (Étape 3) :
 * - Supporte le mode Demi-Terrain (Half-Court : 3v3 / 4v4) et Tout-Terrain (Full-Court : 5v5)
 * - Marquages réglementaires (Ligne des 3 points, Raquette/Paint, Ligne des lancers francs, Cercle central)
 * - Paniers complets (Poteau, Planche plexiglas, Carré de visée, Arceau orange, Filet 3D)
 * - Éclairage dynamique type arène / streetball + Caméra "2K Cam" fluide
 */

import * as THREE from 'three';
import { asColorTexture } from '../render/RenderSetup.js';

export class CourtScene {
    constructor(scene) {
        this.scene = scene;
        this.courtGroup = new THREE.Group();
        this.scene.add(this.courtGroup);

        this.isHalfCourt = true;
        this.hoops = []; // [{ side: 'NORTH' | 'SOUTH', rimPos: THREE.Vector3, backboardZ: number }]

        this.setupLights();
        this.buildCourt(true);
    }

    setupLights() {
        // L'éclairage d'ambiance (RenderSetup) apporte déjà une lumière douce : hémisphère plus discrète
        const hemiLight = new THREE.HemisphereLight('#e0f2fe', '#1e293b', 0.45);
        this.scene.add(hemiLight);

        const mainSpot = new THREE.DirectionalLight('#fffbeb', 2.1);
        mainSpot.position.set(12, 24, 14);
        mainSpot.castShadow = true;
        mainSpot.shadow.mapSize.width = 2048;
        mainSpot.shadow.mapSize.height = 2048;
        mainSpot.shadow.camera.near = 1;
        mainSpot.shadow.camera.far = 65;
        const d = 22;
        mainSpot.shadow.camera.left = -d;
        mainSpot.shadow.camera.right = d;
        mainSpot.shadow.camera.top = d;
        mainSpot.shadow.camera.bottom = -d;
        this.scene.add(mainSpot);

        const fillLight = new THREE.DirectionalLight('#38bdf8', 0.45);
        fillLight.position.set(-14, 15, -10);
        this.scene.add(fillLight);
    }

    /**
     * Génère la texture haute résolution du parquet et des lignes réglementaires
     */
    createCourtTexture(isHalfCourt) {
        const canvas = document.createElement('canvas');
        canvas.width = 1024;
        canvas.height = isHalfCourt ? 1024 : 2048;
        const ctx = canvas.getContext('2d');

        const W = canvas.width;
        const H = canvas.height;

        // 1. Parquet en érable : longues lattes dans le sens du terrain, joints décalés et veines du bois
        this.drawWoodPlanks(ctx, W, H);

        // Bordure extérieure (Out of bounds) bleu nuit / bitume
        const border = 48;
        ctx.lineWidth = border;
        ctx.strokeStyle = '#0f172a';
        ctx.strokeRect(border / 2, border / 2, W - border, H - border);

        // Lignes blanches réglementaires
        ctx.strokeStyle = '#f8fafc';
        ctx.lineWidth = 8;
        ctx.strokeRect(border, border, W - border * 2, H - border * 2);

        // Fonction utilitaire pour dessiner une moitié de terrain (Raquette + Arc 3Pts)
        const drawHalfMarkings = (isTop) => {
            ctx.save();
            if (!isTop) {
                ctx.translate(W, H);
                ctx.rotate(Math.PI);
            }

            // Raquette (The Paint)
            const keyW = 240;
            const keyH = 310;
            const keyX = (W - keyW) / 2;
            const keyY = border;

            ctx.fillStyle = 'rgba(30, 64, 175, 0.78)';
            ctx.fillRect(keyX, keyY, keyW, keyH);
            ctx.strokeStyle = '#f8fafc';
            ctx.lineWidth = 8;
            ctx.strokeRect(keyX, keyY, keyW, keyH);

            // Cercle des lancers francs
            ctx.beginPath();
            ctx.arc(W / 2, keyY + keyH, keyW / 2, 0, Math.PI, false);
            ctx.stroke();

            // Arc des 3 Points et teinte subtile pour distinguer Zone 2 PTS (Intérieur) et Zone 3 PTS (Extérieur)
            const hoopY = border + 65;
            const threeRadius = 385;
            const cornerXOffset = Math.cos(0.12 * Math.PI) * threeRadius;
            const cornerYEnd = hoopY + Math.sin(0.12 * Math.PI) * threeRadius;

            // Légère teinte chaude à l'intérieur de l'arc pour bien visualiser la Zone à 2 Points
            ctx.fillStyle = 'rgba(251, 191, 36, 0.14)';
            ctx.beginPath();
            ctx.moveTo(W / 2 - cornerXOffset, border);
            ctx.lineTo(W / 2 - cornerXOffset, cornerYEnd);
            ctx.arc(W / 2, hoopY, threeRadius, 0.88 * Math.PI, 0.12 * Math.PI, true);
            ctx.lineTo(W / 2 + cornerXOffset, border);
            ctx.closePath();
            ctx.fill();

            // Raquette (The Paint) par-dessus la zone 2Pts
            ctx.fillStyle = 'rgba(30, 64, 175, 0.82)';
            ctx.fillRect(keyX, keyY, keyW, keyH);
            ctx.strokeStyle = '#f8fafc';
            ctx.lineWidth = 8;
            ctx.strokeRect(keyX, keyY, keyW, keyH);

            // Cercle des lancers francs
            ctx.beginPath();
            ctx.arc(W / 2, keyY + keyH, keyW / 2, 0, Math.PI, false);
            ctx.stroke();

            // Tracé lumineux de l'arc des 3 Points + Lignes des corners
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 10;
            ctx.beginPath();
            ctx.arc(W / 2, hoopY, threeRadius, 0.12 * Math.PI, 0.88 * Math.PI, false);
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(W / 2 - cornerXOffset, border);
            ctx.lineTo(W / 2 - cornerXOffset, cornerYEnd);
            ctx.moveTo(W / 2 + cornerXOffset, border);
            ctx.lineTo(W / 2 + cornerXOffset, cornerYEnd);
            ctx.stroke();

            // Marquages au sol "2 PTS" (dans le cercle) et "3 PTS" (en dehors du cercle)
            ctx.font = '900 28px "Chakra Petch", sans-serif';
            ctx.textAlign = 'center';
            ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
            ctx.fillText('ZONE 2 PTS', W / 2 - 210, hoopY + 210);
            ctx.fillText('ZONE 2 PTS', W / 2 + 210, hoopY + 210);

            ctx.fillStyle = 'rgba(56, 189, 248, 0.78)';
            ctx.font = '900 32px "Chakra Petch", sans-serif';
            ctx.fillText('ZONE 3 PTS', W / 2, hoopY + threeRadius + 52);

            // Zone restreinte sous le cercle
            ctx.strokeStyle = '#f8fafc';
            ctx.lineWidth = 8;
            ctx.beginPath();
            ctx.arc(W / 2, hoopY, 64, 0, Math.PI, false);
            ctx.stroke();

            ctx.restore();
        };

        // Toujours dessiner le panier Nord (Haut)
        drawHalfMarkings(true);

        if (!isHalfCourt) {
            // Tout-Terrain : Panier Sud + Ligne médiane
            drawHalfMarkings(false);
            ctx.beginPath();
            ctx.moveTo(border, H / 2);
            ctx.lineTo(W - border, H / 2);
            ctx.stroke();
        }

        // Logo central CourtKings
        const centerY = isHalfCourt ? H - border : H / 2;
        ctx.fillStyle = 'rgba(249, 115, 22, 0.85)';
        ctx.beginPath();
        ctx.arc(W / 2, centerY, 92, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = 8;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();

        const tex = asColorTexture(new THREE.CanvasTexture(canvas));
        tex.anisotropy = 8;
        tex.needsUpdate = true;
        return tex;
    }

    drawWoodPlanks(ctx, W, H) {
        // Générateur pseudo-aléatoire fixe : le même parquet chez tous les joueurs
        let seed = 7;
        const rand = () => {
            seed = (seed * 16807) % 2147483647;
            return seed / 2147483647;
        };

        const plankW = 22;
        for (let x = 0; x < W; x += plankW) {
            let y = -Math.floor(rand() * 300);
            while (y < H) {
                const len = 220 + Math.floor(rand() * 260);
                const v = Math.floor(rand() * 26) - 13;
                ctx.fillStyle = `rgb(${214 + v}, ${150 + v}, ${92 + Math.floor(v * 0.8)})`;
                ctx.fillRect(x, y, plankW, len);

                // Veines du bois : fines lignes un peu plus sombres dans la longueur
                ctx.strokeStyle = `rgba(120, 70, 30, ${0.08 + rand() * 0.08})`;
                ctx.lineWidth = 1;
                for (let g = 0; g < 3; g++) {
                    const gx = x + 3 + rand() * (plankW - 6);
                    ctx.beginPath();
                    ctx.moveTo(gx, y + 4);
                    ctx.bezierCurveTo(gx + rand() * 4 - 2, y + len * 0.33, gx + rand() * 4 - 2, y + len * 0.66, gx, y + len - 4);
                    ctx.stroke();
                }

                // Joint entre deux lattes
                ctx.fillStyle = 'rgba(70, 40, 18, 0.35)';
                ctx.fillRect(x, y + len - 1, plankW, 1);
                y += len;
            }
            ctx.fillStyle = 'rgba(70, 40, 18, 0.3)';
            ctx.fillRect(x + plankW - 1, 0, 1, H);
        }
    }

    /**
     * Construit ou reconstruit le terrain (Half-Court 3v3/4v4 ou Full-Court 5v5)
     */
    buildCourt(isHalfCourt = true) {
        this.isHalfCourt = isHalfCourt;
        while (this.courtGroup.children.length > 0) {
            this.courtGroup.remove(this.courtGroup.children[0]);
        }
        this.hoops = [];

        // Dimensions physiques 3D (en mètres)
        this.courtWidth = 15;
        this.courtLength = isHalfCourt ? 14 : 28;

        // Sol entourant le terrain (Bitume / Arena Floor)
        const surroundGeo = new THREE.PlaneGeometry(46, 56);
        const surroundMat = new THREE.MeshStandardMaterial({
            color: '#090d16',
            roughness: 0.9
        });
        const surround = new THREE.Mesh(surroundGeo, surroundMat);
        surround.rotation.x = -Math.PI / 2;
        surround.position.y = -0.02;
        surround.receiveShadow = true;
        this.courtGroup.add(surround);

        // Surface du terrain avec marquages
        const courtTex = this.createCourtTexture(isHalfCourt);
        const floorGeo = new THREE.PlaneGeometry(this.courtWidth + 1.4, this.courtLength + 1.4);
        // Parquet verni : couche de vernis brillante qui reflète les lumières de l'arène
        const floorMat = new THREE.MeshPhysicalMaterial({
            map: courtTex,
            roughness: 0.45,
            metalness: 0,
            clearcoat: 0.85,
            clearcoatRoughness: 0.16
        });
        const floor = new THREE.Mesh(floorGeo, floorMat);
        floor.rotation.x = -Math.PI / 2;
        floor.receiveShadow = true;
        this.courtGroup.add(floor);

        // Panier principal (Nord : Z négatif)
        const northHoopZ = -this.courtLength / 2 + 1.25;
        this.createHoopUnit(0, northHoopZ, 1, 'NORTH');

        // Second panier (Sud : Z positif) uniquement en mode 5v5 Tout-Terrain
        if (!isHalfCourt) {
            const southHoopZ = this.courtLength / 2 - 1.25;
            this.createHoopUnit(0, southHoopZ, -1, 'SOUTH');
        }

        // Arène : panneaux lumineux, tribunes avec public, écran géant du score, rampes de lumière
        this.createLedBoards();
        this.createStandsAndCrowd();
        this.createJumbotron();
        this.createCeilingLights();
    }

    createHoopUnit(x, rimZ, dirZ, side) {
        const hoopGroup = new THREE.Group();
        const rimHeight = 3.05;
        const backboardZ = rimZ - dirZ * 0.42;
        const poleZ = rimZ - dirZ * 1.15;

        // Poteau de soutien
        const poleMat = new THREE.MeshStandardMaterial({ color: '#1e293b', metalness: 0.7, roughness: 0.3 });
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 3.6, 16), poleMat);
        pole.position.set(x, 1.8, poleZ);
        pole.castShadow = true;
        hoopGroup.add(pole);

        // Bras horizontal
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.85), poleMat);
        arm.position.set(x, 3.35, (poleZ + backboardZ) / 2);
        hoopGroup.add(arm);

        // Planche (Backboard en verre trempé)
        const boardGeo = new THREE.BoxGeometry(1.80, 1.05, 0.06);
        const boardMat = new THREE.MeshStandardMaterial({
            color: '#e2e8f0',
            transparent: true,
            opacity: 0.65,
            roughness: 0.15
        });
        const backboard = new THREE.Mesh(boardGeo, boardMat);
        backboard.position.set(x, 3.38, backboardZ);
        backboard.castShadow = true;
        hoopGroup.add(backboard);

        // Cadre blanc + carré de visée sur la planche
        const frameEdges = new THREE.EdgesGeometry(boardGeo);
        const frameLines = new THREE.LineSegments(
            frameEdges,
            new THREE.LineBasicMaterial({ color: '#ffffff', linewidth: 2 })
        );
        backboard.add(frameLines);

        const targetSquareGeo = new THREE.RingGeometry(0.18, 0.22, 4);
        const targetSquareMat = new THREE.MeshBasicMaterial({ color: '#f97316', side: THREE.DoubleSide });
        const targetSquare = new THREE.Mesh(targetSquareGeo, targetSquareMat);
        targetSquare.rotation.z = Math.PI / 4;
        targetSquare.position.set(0, -0.18, dirZ * 0.035);
        backboard.add(targetSquare);

        // Arceau (Rim)
        const rimGeo = new THREE.TorusGeometry(0.24, 0.022, 12, 32);
        const rimMat = new THREE.MeshStandardMaterial({ color: '#ea580c', metalness: 0.5, roughness: 0.3 });
        const rim = new THREE.Mesh(rimGeo, rimMat);
        rim.rotation.x = Math.PI / 2;
        rim.position.set(x, rimHeight, rimZ);
        hoopGroup.add(rim);

        // Filet (Net) en maillage conique filaire blanc
        const netGeo = new THREE.CylinderGeometry(0.23, 0.15, 0.42, 14, 4, true);
        const netMat = new THREE.MeshBasicMaterial({
            color: '#f8fafc',
            wireframe: true,
            transparent: true,
            opacity: 0.85
        });
        const net = new THREE.Mesh(netGeo, netMat);
        net.position.set(x, rimHeight - 0.21, rimZ);
        hoopGroup.add(net);

        this.courtGroup.add(hoopGroup);

        this.hoops.push({
            side,
            rimPos: new THREE.Vector3(x, rimHeight, rimZ),
            backboardZ,
            threePointRadius: 5.55
        });

        // Cercle / Arc 3D lumineux au sol délimitant exactement la Zone 2 Points (intérieur) et 3 Points (extérieur)
        const arcRingGeo = new THREE.RingGeometry(5.51, 5.59, 64, 1, dirZ > 0 ? 0.12 * Math.PI : 1.12 * Math.PI, 0.76 * Math.PI);
        const arcRingMat = new THREE.MeshBasicMaterial({
            color: '#38bdf8',
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.65
        });
        const arcRing = new THREE.Mesh(arcRingGeo, arcRingMat);
        arcRing.rotation.x = -Math.PI / 2;
        arcRing.position.set(x, 0.012, rimZ);
        this.courtGroup.add(arcRing);
    }

    /**
     * Les 4 côtés de l'arène, à une distance donnée du bord du terrain :
     * centre, longueur du côté, et rotation pour faire face au terrain
     */
    getArenaSides(margin) {
        const hw = this.courtWidth / 2 + margin;
        const hl = this.courtLength / 2 + margin;
        return [
            { x: -hw, z: 0, length: hl * 2, rotY: Math.PI / 2, out: new THREE.Vector3(-1, 0, 0) },
            { x: hw, z: 0, length: hl * 2, rotY: -Math.PI / 2, out: new THREE.Vector3(1, 0, 0) },
            { x: 0, z: -hl, length: hw * 2, rotY: 0, out: new THREE.Vector3(0, 0, -1) },
            { x: 0, z: hl, length: hw * 2, rotY: Math.PI, out: new THREE.Vector3(0, 0, 1) }
        ];
    }

    /**
     * Panneaux publicitaires lumineux (LED) tout autour du terrain
     */
    createLedBoards() {
        const canvas = document.createElement('canvas');
        canvas.width = 1024;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        const grad = ctx.createLinearGradient(0, 0, 1024, 0);
        grad.addColorStop(0, '#0c4a6e');
        grad.addColorStop(0.5, '#1e1b4b');
        grad.addColorStop(1, '#7c2d12');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 1024, 64);
        ctx.font = '900 40px "Chakra Petch", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#f97316';
        ctx.fillText('COURTKINGS 3D', 256, 34);
        ctx.fillStyle = '#38bdf8';
        ctx.fillText('★  STREETBALL  ★', 768, 34);

        const tex = asColorTexture(new THREE.CanvasTexture(canvas));
        tex.wrapS = THREE.RepeatWrapping;

        for (const side of this.getArenaSides(1.25)) {
            const sideTex = tex.clone();
            sideTex.repeat.set(Math.max(1, Math.round(side.length / 9)), 1);
            sideTex.needsUpdate = true;
            const mat = new THREE.MeshBasicMaterial({ map: sideTex, toneMapped: false });
            const board = new THREE.Mesh(new THREE.PlaneGeometry(side.length, 0.7), mat);
            board.position.set(side.x, 0.38, side.z);
            board.rotation.y = side.rotY;
            this.courtGroup.add(board);

            // Dos du panneau (caisson sombre)
            const back = new THREE.Mesh(
                new THREE.BoxGeometry(side.length, 0.78, 0.18),
                new THREE.MeshStandardMaterial({ color: '#0f172a', roughness: 0.7 })
            );
            back.position.copy(board.position).addScaledVector(side.out, 0.1);
            back.rotation.y = side.rotY;
            this.courtGroup.add(back);
        }
    }

    /**
     * Tribunes en gradins et public. Tous les spectateurs sont dessinés en une seule fois
     * (InstancedMesh) pour rester fluide même avec des centaines de personnes.
     */
    createStandsAndCrowd() {
        let seed = 42;
        const rand = () => {
            seed = (seed * 16807) % 2147483647;
            return seed / 2147483647;
        };

        const rows = 6;
        const rowDepth = 0.9;
        const rowRise = 0.42;
        const startMargin = 2.4;
        const standMat = new THREE.MeshStandardMaterial({ color: '#1e293b', roughness: 0.85 });
        const seats = [];

        for (const side of this.getArenaSides(startMargin)) {
            for (let r = 0; r < rows; r++) {
                const rowLength = side.length + r * rowDepth * 2;
                const height = 0.3 + r * rowRise;
                const step = new THREE.Mesh(new THREE.BoxGeometry(rowLength, height, rowDepth), standMat);
                const center = new THREE.Vector3(side.x, height / 2, side.z).addScaledVector(side.out, r * rowDepth + rowDepth / 2);
                step.position.copy(center);
                step.rotation.y = side.rotY;
                step.receiveShadow = true;
                this.courtGroup.add(step);

                // Places assises le long de la rangée (quelques places vides)
                const along = new THREE.Vector3(-side.out.z, 0, side.out.x);
                const count = Math.floor(rowLength / 0.72);
                for (let i = 0; i < count; i++) {
                    if (rand() < 0.14) continue;
                    const offset = (i + 0.5) * (rowLength / count) - rowLength / 2 + (rand() - 0.5) * 0.15;
                    const p = center.clone().addScaledVector(along, offset);
                    p.y = height;
                    seats.push(p);
                }
            }
        }

        const shirtColors = ['#0284c7', '#38bdf8', '#e11d48', '#f43f5e', '#f97316', '#facc15', '#f8fafc', '#1f2937', '#22c55e', '#a855f7'];
        const skinColors = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#5c3a1e', '#ffdbac'];

        const bodies = new THREE.InstancedMesh(
            new THREE.CapsuleGeometry(0.17, 0.32, 4, 8),
            new THREE.MeshStandardMaterial({ roughness: 0.8 }),
            seats.length
        );
        const heads = new THREE.InstancedMesh(
            new THREE.SphereGeometry(0.12, 10, 8),
            new THREE.MeshStandardMaterial({ roughness: 0.7 }),
            seats.length
        );
        const m = new THREE.Matrix4();
        const c = new THREE.Color();
        seats.forEach((p, i) => {
            const standing = rand() < 0.18 ? 0.22 : 0; // quelques spectateurs debout
            m.makeTranslation(p.x, p.y + 0.36 + standing, p.z);
            bodies.setMatrixAt(i, m);
            bodies.setColorAt(i, c.set(shirtColors[Math.floor(rand() * shirtColors.length)]));
            m.makeTranslation(p.x, p.y + 0.78 + standing, p.z);
            heads.setMatrixAt(i, m);
            heads.setColorAt(i, c.set(skinColors[Math.floor(rand() * skinColors.length)]));
        });
        this.courtGroup.add(bodies, heads);
        this.crowdCount = seats.length;
    }

    /**
     * Écran géant suspendu au-dessus du terrain : affiche le score sur ses 4 faces
     */
    createJumbotron() {
        const group = new THREE.Group();
        group.position.set(0, 10.5, 0);

        const frame = new THREE.Mesh(
            new THREE.BoxGeometry(5.2, 2.6, 5.2),
            new THREE.MeshStandardMaterial({ color: '#0b1120', metalness: 0.6, roughness: 0.35 })
        );
        group.add(frame);

        this.scoreCanvas = document.createElement('canvas');
        this.scoreCanvas.width = 512;
        this.scoreCanvas.height = 256;
        this.scoreTexture = asColorTexture(new THREE.CanvasTexture(this.scoreCanvas));
        const screenMat = new THREE.MeshBasicMaterial({ map: this.scoreTexture, toneMapped: false });

        for (let k = 0; k < 4; k++) {
            const screen = new THREE.Mesh(new THREE.PlaneGeometry(4.8, 2.3), screenMat);
            const angle = k * Math.PI / 2;
            screen.position.set(Math.sin(angle) * 2.62, 0, Math.cos(angle) * 2.62);
            screen.rotation.y = angle;
            group.add(screen);
        }

        // Câbles de suspension
        const cableMat = new THREE.MeshBasicMaterial({ color: '#334155' });
        for (const [cx, cz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) {
            const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 4, 4), cableMat);
            cable.position.set(cx, 3.3, cz);
            group.add(cable);
        }

        this.courtGroup.add(group);
        this.updateScoreboard(this.lastScoreA || 0, this.lastScoreB || 0);
    }

    updateScoreboard(scoreA, scoreB) {
        this.lastScoreA = scoreA;
        this.lastScoreB = scoreB;
        if (!this.scoreCanvas) return;
        const ctx = this.scoreCanvas.getContext('2d');
        ctx.fillStyle = '#020617';
        ctx.fillRect(0, 0, 512, 256);

        ctx.fillStyle = '#0284c7';
        ctx.fillRect(0, 0, 256, 56);
        ctx.fillStyle = '#e11d48';
        ctx.fillRect(256, 0, 256, 56);

        ctx.font = '900 34px "Chakra Petch", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#ffffff';
        ctx.fillText('ÉQUIPE A', 128, 30);
        ctx.fillText('ÉQUIPE B', 384, 30);

        ctx.font = '900 130px "Chakra Petch", sans-serif';
        ctx.fillStyle = '#38bdf8';
        ctx.fillText(String(scoreA), 128, 160);
        ctx.fillStyle = '#fb7185';
        ctx.fillText(String(scoreB), 384, 160);

        ctx.fillStyle = '#f97316';
        ctx.fillRect(254, 80, 4, 150);
        this.scoreTexture.needsUpdate = true;
    }

    /**
     * Rampes de projecteurs au plafond (purement visuelles : la vraie lumière vient de setupLights)
     */
    createCeilingLights() {
        const lampMat = new THREE.MeshBasicMaterial({ color: '#fff7e6', toneMapped: false });
        const lampGeo = new THREE.BoxGeometry(0.9, 0.12, 0.5);
        const trussMat = new THREE.MeshStandardMaterial({ color: '#1e293b', metalness: 0.7, roughness: 0.4 });
        const halfL = this.courtLength / 2;
        for (const x of [-6, 6]) {
            const truss = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.25, this.courtLength + 4), trussMat);
            truss.position.set(x, 13.2, 0);
            this.courtGroup.add(truss);
            for (let z = -halfL; z <= halfL; z += 3.5) {
                const lamp = new THREE.Mesh(lampGeo, lampMat);
                lamp.position.set(x, 13, z);
                this.courtGroup.add(lamp);
            }
        }
    }

    getTargetHoop(attackingSide = 'NORTH') {
        if (this.isHalfCourt) {
            return this.hoops[0];
        }
        return this.hoops.find(h => h.side === attackingSide) || this.hoops[0];
    }
}
