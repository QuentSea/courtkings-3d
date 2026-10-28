/**
 * CourtScene.js
 * Environnement 3D complet du terrain de basketball (Étape 3) :
 * - Supporte le mode Demi-Terrain (Half-Court : 3v3 / 4v4) et Tout-Terrain (Full-Court : 5v5)
 * - Marquages réglementaires (Ligne des 3 points, Raquette/Paint, Ligne des lancers francs, Cercle central)
 * - Paniers complets (Poteau, Planche plexiglas, Carré de visée, Arceau orange, Filet 3D)
 * - Éclairage dynamique type arène / streetball + Caméra "2K Cam" fluide
 */

import * as THREE from 'three';

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
        const hemiLight = new THREE.HemisphereLight('#e0f2fe', '#1e293b', 0.75);
        this.scene.add(hemiLight);

        const mainSpot = new THREE.DirectionalLight('#fffbeb', 1.55);
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

        // 1. Fond parquet lattes de bois érable
        ctx.fillStyle = '#c87d3b';
        ctx.fillRect(0, 0, W, H);

        // Lattes subtiles
        for (let y = 0; y < H; y += 32) {
            for (let x = 0; x < W; x += 16) {
                const variation = ((x * 7 + y * 13) % 18) - 9;
                ctx.fillStyle = `rgb(${200 + variation}, ${125 + variation}, ${59 + variation})`;
                ctx.fillRect(x, y, 15, 31);
            }
        }

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

        const tex = new THREE.CanvasTexture(canvas);
        tex.anisotropy = 8;
        tex.needsUpdate = true;
        return tex;
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
        const floorMat = new THREE.MeshStandardMaterial({
            map: courtTex,
            roughness: 0.35,
            metalness: 0.05
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

        // Gradins / Barrières lumineuses décoratives autour du terrain
        this.createArenaPerimeter();
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

    createArenaPerimeter() {
        const barrierMat = new THREE.MeshStandardMaterial({
            color: '#1e293b',
            roughness: 0.6
        });
        const neonMat = new THREE.MeshBasicMaterial({ color: '#0284c7' });

        const halfW = this.courtWidth / 2 + 1.6;
        const halfL = this.courtLength / 2 + 1.8;

        // Barrières latérales gauche et droite
        [-halfW, halfW].forEach((posX) => {
            const wall = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.75, this.courtLength + 2), barrierMat);
            wall.position.set(posX, 0.375, 0);
            wall.receiveShadow = true;
            this.courtGroup.add(wall);

            const strip = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.06, this.courtLength + 2), neonMat);
            strip.position.set(posX, 0.72, 0);
            this.courtGroup.add(strip);
        });

        // Barrière fond Nord
        const northWall = new THREE.Mesh(new THREE.BoxGeometry(this.courtWidth + 3.4, 0.75, 0.25), barrierMat);
        northWall.position.set(0, 0.375, -halfL);
        this.courtGroup.add(northWall);
    }

    getTargetHoop(attackingSide = 'NORTH') {
        if (this.isHalfCourt) {
            return this.hoops[0];
        }
        return this.hoops.find(h => h.side === attackingSide) || this.hoops[0];
    }
}
