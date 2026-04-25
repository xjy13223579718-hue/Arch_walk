class Renderer2D {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.zoom = 1.0;
        this.offsetX = 0;
        this.offsetY = 0;
        this.panX = 0;
        this.panY = 0;
        this.showGrid = true;
        
        // Modern Arch Palette
        this.colors = {
            wall: '#6B7280',     // Gray
            floor: '#F9FAFB',    // Off White
            player: '#6B7DAA',   // Blue
            trajectory: '#6B7DAA' // Blue
        };
    }

    worldToIsometric(x, y, z = 0) {
        // Isometric projection: 
        // screenX = (x - y) * cos(30°)
        // screenY = (x + y) * sin(30°) - z
        const angle = Math.PI / 6; // 30 degrees
        const cosA = Math.cos(angle);
        const sinA = Math.sin(angle);
        
        return {
            x: (x - y) * cosA * this.zoom + this.canvas.width / 2 + this.offsetX,
            y: (x + y) * sinA * this.zoom + this.canvas.height / 2 + this.offsetY - z * this.zoom
        };
    }

    screenToWorld(screenX, screenY) {
        const angle = Math.PI / 6;
        const cosA = Math.cos(angle);
        const sinA = Math.sin(angle);

        const sx = (screenX - this.canvas.width / 2 - this.offsetX) / (cosA * this.zoom);
        const sy = (screenY - this.canvas.height / 2 - this.offsetY) / (sinA * this.zoom);

        return {
            x: (sx + sy) / 2,
            y: (sy - sx) / 2
        };
    }

    tileFromScreen(screenX, screenY, tileSize) {
        const w = this.screenToWorld(screenX, screenY);
        return {
            tx: Math.floor(w.x / tileSize),
            ty: Math.floor(w.y / tileSize),
            worldX: w.x,
            worldY: w.y
        };
    }

    render(imageProcessor, player, trajectory, overlays = null) {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        if (!imageProcessor.collisionMap) return;

        // Follow player (center screen on player)
        this.offsetX = -((player.x - player.y) * Math.cos(Math.PI / 6) * this.zoom) + this.panX;
        this.offsetY = -((player.x + player.y) * Math.sin(Math.PI / 6) * this.zoom) + this.panY;

        // 1. Draw floor/grid
        if (this.showGrid) {
            this.drawFloor(imageProcessor);
            this.drawBlankCells(imageProcessor);
        }

        // 1.5 Draw original irregular contours (external outline)
        this.drawContours(imageProcessor);

        // 2. Draw trajectory
        if (trajectory && trajectory.visible) {
            this.drawTrajectory(trajectory);
        }

        // 3. Draw walls + player with depth ordering
        this.drawWallsAndPlayer(imageProcessor, player);

        // 3.5 Placement marker
        if (overlays && overlays.pendingPlayerPos) {
            this.drawPlacementMarker(overlays.pendingPlayerPos);
        }

        if (overlays && overlays.deleteSelection) {
            this.drawDeleteSelection(overlays.deleteSelection, imageProcessor.tileSize);
        }

        // Player is drawn inside drawWallsAndPlayer for correct occlusion
    }

    drawContours(imageProcessor) {
        if (!imageProcessor.contours || imageProcessor.contours.length === 0) return;

        this.ctx.save();
        this.ctx.strokeStyle = 'rgba(55, 65, 81, 0.75)';
        this.ctx.lineWidth = Math.max(1, 1.25 * this.zoom);
        this.ctx.setLineDash([]);

        for (const contour of imageProcessor.contours) {
            if (!contour || contour.length < 3) continue;
            const first = this.worldToIsometric(contour[0].x, contour[0].y);
            this.ctx.beginPath();
            this.ctx.moveTo(first.x, first.y);
            for (let i = 1; i < contour.length; i++) {
                const p = this.worldToIsometric(contour[i].x, contour[i].y);
                this.ctx.lineTo(p.x, p.y);
            }
            this.ctx.closePath();
            this.ctx.stroke();
        }

        this.ctx.restore();
    }

    drawStairs(imageProcessor) {
        const mask = imageProcessor.stairMask;
        const elev = imageProcessor.elevationMap;
        const mpp = imageProcessor.metersPerPixel || 0.05;
        if (!mask || !elev) return;

        const ctx = this.ctx;
        ctx.save();
        ctx.fillStyle = 'rgba(229, 231, 235, 0.35)';
        ctx.strokeStyle = 'rgba(55, 65, 81, 0.32)';
        ctx.lineWidth = 1;

        const { collisionMap, tileSize } = imageProcessor;
        const rows = collisionMap.length;
        const cols = collisionMap[0].length;
        const zScale = 1 / Math.max(1e-6, mpp);

        for (let ty = 0; ty < rows; ty++) {
            for (let tx = 0; tx < cols; tx++) {
                if (mask[ty][tx] !== 1) continue;
                const zPx = elev[ty][tx] * zScale;
                this.drawIsometricTileFillZ(tx * tileSize, ty * tileSize, tileSize, zPx);
                this.drawIsometricTileStrokeZ(tx * tileSize, ty * tileSize, tileSize, zPx);
            }
        }

        ctx.restore();
    }

    drawElevations(imageProcessor) {
        const elev = imageProcessor.elevationMap;
        const mask = imageProcessor.stairMask;
        const mpp = imageProcessor.metersPerPixel || 0.05;
        if (!elev) return;

        const { collisionMap, tileSize } = imageProcessor;
        const rows = collisionMap.length;
        const cols = collisionMap[0].length;
        const zScale = 1 / Math.max(1e-6, mpp);

        const ctx = this.ctx;
        ctx.save();

        if (imageProcessor.outerContourPoints && imageProcessor.outerContourPoints.length >= 3) {
            const pts = imageProcessor.outerContourPoints;
            const p0 = this.worldToIsometric(pts[0].x, pts[0].y);
            ctx.beginPath();
            ctx.moveTo(p0.x, p0.y);
            for (let i = 1; i < pts.length; i++) {
                const p = this.worldToIsometric(pts[i].x, pts[i].y);
                ctx.lineTo(p.x, p.y);
            }
            ctx.closePath();
            ctx.clip();
        }

        ctx.lineWidth = 1;

        for (let ty = 0; ty < rows; ty++) {
            for (let tx = 0; tx < cols; tx++) {
                const cell = collisionMap[ty][tx];
                if (!(cell === 0 || cell === 3)) continue;
                if (mask && mask[ty][tx] === 1) continue;
                const zM = elev[ty][tx] || 0;
                if (Math.abs(zM) < 1e-3) continue;
                const zPx = zM * zScale;

                if (zM < 0) {
                    ctx.fillStyle = 'rgba(55, 65, 81, 0.06)';
                    ctx.strokeStyle = 'rgba(55, 65, 81, 0.14)';
                } else {
                    ctx.fillStyle = 'rgba(107, 125, 170, 0.10)';
                    ctx.strokeStyle = 'rgba(55, 65, 81, 0.12)';
                }

                this.drawIsometricTileFillZ(tx * tileSize, ty * tileSize, tileSize, zPx);
                this.drawIsometricTileStrokeZ(tx * tileSize, ty * tileSize, tileSize, zPx);
            }
        }

        ctx.restore();
    }

    drawIsometricTileFillZ(x, y, size, zPx) {
        const p1 = this.worldToIsometric(x, y, zPx);
        const p2 = this.worldToIsometric(x + size, y, zPx);
        const p3 = this.worldToIsometric(x + size, y + size, zPx);
        const p4 = this.worldToIsometric(x, y + size, zPx);
        this.ctx.beginPath();
        this.ctx.moveTo(p1.x, p1.y);
        this.ctx.lineTo(p2.x, p2.y);
        this.ctx.lineTo(p3.x, p3.y);
        this.ctx.lineTo(p4.x, p4.y);
        this.ctx.closePath();
        this.ctx.fill();
    }

    drawIsometricTileStrokeZ(x, y, size, zPx) {
        const p1 = this.worldToIsometric(x, y, zPx);
        const p2 = this.worldToIsometric(x + size, y, zPx);
        const p3 = this.worldToIsometric(x + size, y + size, zPx);
        const p4 = this.worldToIsometric(x, y + size, zPx);
        this.ctx.beginPath();
        this.ctx.moveTo(p1.x, p1.y);
        this.ctx.lineTo(p2.x, p2.y);
        this.ctx.lineTo(p3.x, p3.y);
        this.ctx.lineTo(p4.x, p4.y);
        this.ctx.closePath();
        this.ctx.stroke();
    }

    drawFloor(imageProcessor) {
        const { collisionMap, tileSize } = imageProcessor;
        const rows = collisionMap.length;
        const cols = collisionMap[0].length;

        if (imageProcessor.outerContourPoints && imageProcessor.outerContourPoints.length >= 3) {
            this.ctx.save();
            const pts = imageProcessor.outerContourPoints;
            const p0 = this.worldToIsometric(pts[0].x, pts[0].y);
            this.ctx.beginPath();
            this.ctx.moveTo(p0.x, p0.y);
            for (let i = 1; i < pts.length; i++) {
                const p = this.worldToIsometric(pts[i].x, pts[i].y);
                this.ctx.lineTo(p.x, p.y);
            }
            this.ctx.closePath();
            this.ctx.clip();
        }

        this.ctx.strokeStyle = 'rgba(107, 114, 128, 0.05)';
        this.ctx.lineWidth = 1;

        for (let y = 0; y <= rows; y++) {
            const start = this.worldToIsometric(0, y * tileSize);
            const end = this.worldToIsometric(cols * tileSize, y * tileSize);
            this.ctx.beginPath();
            this.ctx.moveTo(start.x, start.y);
            this.ctx.lineTo(end.x, end.y);
            this.ctx.stroke();
        }

        for (let x = 0; x <= cols; x++) {
            const start = this.worldToIsometric(x * tileSize, 0);
            const end = this.worldToIsometric(x * tileSize, rows * tileSize);
            this.ctx.beginPath();
            this.ctx.moveTo(start.x, start.y);
            this.ctx.lineTo(end.x, end.y);
            this.ctx.stroke();
        }

        if (imageProcessor.outerContourPoints && imageProcessor.outerContourPoints.length >= 3) {
            this.ctx.restore();
        }
    }

    drawBlankCells(imageProcessor) {
        const { collisionMap, tileSize } = imageProcessor;
        const rows = collisionMap.length;
        const cols = collisionMap[0].length;

        this.ctx.save();
        this.ctx.fillStyle = '#F9FAFB';
        this.ctx.strokeStyle = 'rgba(107, 114, 128, 0.10)';
        this.ctx.lineWidth = 1;

        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
                if (collisionMap[y][x] !== 3) continue;
                this.drawIsometricTileFill(x * tileSize, y * tileSize, tileSize);
            }
        }

        this.ctx.restore();
    }

    drawIsometricTileFill(x, y, size) {
        const p1 = this.worldToIsometric(x, y);
        const p2 = this.worldToIsometric(x + size, y);
        const p3 = this.worldToIsometric(x + size, y + size);
        const p4 = this.worldToIsometric(x, y + size);

        this.ctx.beginPath();
        this.ctx.moveTo(p1.x, p1.y);
        this.ctx.lineTo(p2.x, p2.y);
        this.ctx.lineTo(p3.x, p3.y);
        this.ctx.lineTo(p4.x, p4.y);
        this.ctx.closePath();
        this.ctx.fill();
    }

    drawWalls(imageProcessor) {
        const { collisionMap, tileSize } = imageProcessor;
        const wallHeight = 40;

        this.ctx.lineWidth = 1;

        for (let y = 0; y < collisionMap.length; y++) {
            for (let x = 0; x < collisionMap[y].length; x++) {
                if (collisionMap[y][x] === 1) {
                    this.drawIsometricCube(x * tileSize, y * tileSize, tileSize, wallHeight);
                }
            }
        }
    }

    drawWallsAndPlayer(imageProcessor, player) {
        const { collisionMap, tileSize } = imageProcessor;
        const rows = collisionMap.length;
        const cols = collisionMap[0].length;
        const wallHeight = 40;

        const playerDepth = (player.x + player.y) / Math.max(1e-6, tileSize);
        let drawnPlayer = false;

        for (let d = 0; d <= rows + cols - 2; d++) {
            if (!drawnPlayer && d + 0.5 >= playerDepth) {
                this.drawPlayer(player);
                drawnPlayer = true;
            }

            for (let y = 0; y < rows; y++) {
                const x = d - y;
                if (x < 0 || x >= cols) continue;
                if (collisionMap[y][x] === 1) {
                    this.drawIsometricCube(x * tileSize, y * tileSize, tileSize, wallHeight);
                }
            }
        }

        if (!drawnPlayer) {
            this.drawPlayer(player);
        }
    }

    drawIsometricCube(x, y, size, height) {
        const p1 = this.worldToIsometric(x, y);
        const p2 = this.worldToIsometric(x + size, y);
        const p3 = this.worldToIsometric(x + size, y + size);
        const p4 = this.worldToIsometric(x, y + size);

        const p1h = this.worldToIsometric(x, y, height);
        const p2h = this.worldToIsometric(x + size, y, height);
        const p3h = this.worldToIsometric(x + size, y + size, height);
        const p4h = this.worldToIsometric(x, y + size, height);

        // Right face
        this.ctx.fillStyle = '#D1D5DB'; // Medium gray
        this.ctx.beginPath();
        this.ctx.moveTo(p2.x, p2.y);
        this.ctx.lineTo(p3.x, p3.y);
        this.ctx.lineTo(p3h.x, p3h.y);
        this.ctx.lineTo(p2h.x, p2h.y);
        this.ctx.closePath();
        this.ctx.fill();
        this.ctx.strokeStyle = '#9CA3AF';
        this.ctx.stroke();

        // Left face
        this.ctx.fillStyle = '#E5E7EB'; // Light gray
        this.ctx.beginPath();
        this.ctx.moveTo(p3.x, p3.y);
        this.ctx.lineTo(p4.x, p4.y);
        this.ctx.lineTo(p4h.x, p4h.y);
        this.ctx.lineTo(p3h.x, p3h.y);
        this.ctx.closePath();
        this.ctx.fill();
        this.ctx.stroke();

        // Top face
        this.ctx.fillStyle = '#F3F4F6'; // Off white
        this.ctx.beginPath();
        this.ctx.moveTo(p1h.x, p1h.y);
        this.ctx.lineTo(p2h.x, p2h.y);
        this.ctx.lineTo(p3h.x, p3h.y);
        this.ctx.lineTo(p4h.x, p4h.y);
        this.ctx.closePath();
        this.ctx.fill();
        this.ctx.stroke();
    }

    drawPlayer(player) {
        const p = this.worldToIsometric(player.x, player.y, player.z);
        const height = 20;
        const size = 6;

        // Player shadow
        const s = this.worldToIsometric(player.x, player.y, 0);
        this.ctx.fillStyle = 'rgba(0,0,0,0.1)';
        this.ctx.beginPath();
        this.ctx.ellipse(s.x, s.y, size * this.zoom, size/2 * this.zoom, 0, 0, Math.PI * 2);
        this.ctx.fill();

        // Player body (isometric cylinder/box)
        this.ctx.fillStyle = this.colors.player;
        this.ctx.strokeStyle = '#4B5563';
        this.ctx.lineWidth = 1;

        const pTop = this.worldToIsometric(player.x, player.y, player.z + height);
        
        this.ctx.beginPath();
        this.ctx.arc(p.x, p.y, size * this.zoom, 0, Math.PI, false);
        this.ctx.lineTo(pTop.x - size * this.zoom, pTop.y);
        this.ctx.arc(pTop.x, pTop.y, size * this.zoom, Math.PI, 0, false);
        this.ctx.lineTo(p.x + size * this.zoom, p.y);
        this.ctx.fill();
        this.ctx.stroke();
    }

    drawPlacementMarker(pos) {
        const p = this.worldToIsometric(pos.x, pos.y, 0);
        const r = 10 * this.zoom;

        this.ctx.save();
        this.ctx.strokeStyle = 'rgba(107, 125, 170, 0.85)';
        this.ctx.fillStyle = 'rgba(107, 125, 170, 0.14)';
        this.ctx.lineWidth = Math.max(1, 1.5 * this.zoom);
        this.ctx.beginPath();
        this.ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.stroke();

        this.ctx.strokeStyle = 'rgba(55, 65, 81, 0.35)';
        this.ctx.lineWidth = Math.max(1, 1 * this.zoom);
        this.ctx.beginPath();
        this.ctx.moveTo(p.x - r, p.y);
        this.ctx.lineTo(p.x + r, p.y);
        this.ctx.moveTo(p.x, p.y - r);
        this.ctx.lineTo(p.x, p.y + r);
        this.ctx.stroke();
        this.ctx.restore();
    }

    drawDeleteSelection(selection, tileSize) {
        if (!selection) return;
        const minTx = Math.min(selection.startTx, selection.endTx);
        const maxTx = Math.max(selection.startTx, selection.endTx) + 1;
        const minTy = Math.min(selection.startTy, selection.endTy);
        const maxTy = Math.max(selection.startTy, selection.endTy) + 1;

        const p1 = this.worldToIsometric(minTx * tileSize, minTy * tileSize);
        const p2 = this.worldToIsometric(maxTx * tileSize, minTy * tileSize);
        const p3 = this.worldToIsometric(maxTx * tileSize, maxTy * tileSize);
        const p4 = this.worldToIsometric(minTx * tileSize, maxTy * tileSize);

        this.ctx.save();
        this.ctx.fillStyle = 'rgba(107, 125, 170, 0.12)';
        this.ctx.strokeStyle = 'rgba(55, 65, 81, 0.45)';
        this.ctx.lineWidth = Math.max(1, 1.2 * this.zoom);
        this.ctx.setLineDash([6, 4]);
        this.ctx.beginPath();
        this.ctx.moveTo(p1.x, p1.y);
        this.ctx.lineTo(p2.x, p2.y);
        this.ctx.lineTo(p3.x, p3.y);
        this.ctx.lineTo(p4.x, p4.y);
        this.ctx.closePath();
        this.ctx.fill();
        this.ctx.stroke();
        this.ctx.setLineDash([]);
        this.ctx.restore();
    }

    drawTrajectory(trajectory) {
        if (trajectory.points.length < 2) return;

        this.ctx.strokeStyle = this.colors.trajectory;
        this.ctx.lineWidth = 1.5;
        this.ctx.setLineDash([5, 5]);
        this.ctx.beginPath();

        let started = false;

        for (let i = 1; i < trajectory.points.length; i++) {
            const pt = trajectory.points[i];
            if (!pt || pt.break) {
                started = false;
                continue;
            }
            if (!started) {
                const p0 = this.worldToIsometric(pt.x, pt.y);
                this.ctx.moveTo(p0.x, p0.y);
                started = true;
                continue;
            }
            const p = this.worldToIsometric(pt.x, pt.y);
            this.ctx.lineTo(p.x, p.y);
        }

        this.ctx.stroke();
        this.ctx.setLineDash([]);
    }
}
