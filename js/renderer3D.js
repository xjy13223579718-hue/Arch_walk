class Renderer3D {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.fov = (80 * Math.PI) / 180;
        this.rayCount = 400; // Resolution of raycasting
        this.maxDepth = 1000;
        
        // Modern Arch Palette
        this.colors = {
            wallNear: '#9CA3AF',
            wallFar: '#4B5563',
            ceiling: '#F9FAFB',
            floor: '#E5E7EB'
        };
        this.wallTexture = null;
        this.glassTexture = null;
        this.shadowRamp = null;
        this._floorDistFactor = null;
    }

    createWallTexture() {
        const size = 128;
        const c = document.createElement('canvas');
        c.width = size;
        c.height = size;
        const ctx = c.getContext('2d');
        if (!ctx) return c;

        const base = 230;
        const img = ctx.createImageData(size, size);
        const d = img.data;
        for (let i = 0; i < d.length; i += 4) {
            const n = (Math.random() * 10 - 5) | 0;
            const v = Math.max(0, Math.min(255, base + n));
            d[i] = v;
            d[i + 1] = v;
            d[i + 2] = v;
            d[i + 3] = 255;
        }
        ctx.putImageData(img, 0, 0);
        return c;
    }

    createGlassTexture() {
        const size = 128;
        const c = document.createElement('canvas');
        c.width = size;
        c.height = size;
        const ctx = c.getContext('2d');
        if (!ctx) return c;

        ctx.clearRect(0, 0, size, size);
        ctx.fillStyle = 'rgba(209, 213, 219, 0.9)';
        ctx.fillRect(0, 0, size, size);

        const img = ctx.createImageData(size, size);
        const d = img.data;
        for (let i = 0; i < d.length; i += 4) {
            const n = (Math.random() * 24 - 12) | 0;
            const v = Math.max(0, Math.min(255, 210 + n));
            d[i] = v;
            d[i + 1] = v;
            d[i + 2] = v;
            d[i + 3] = 255;
        }
        ctx.putImageData(img, 0, 0);
        return c;
    }

    createShadowRamp() {
        const h = 128;
        const c = document.createElement('canvas');
        c.width = 1;
        c.height = h;
        const ctx = c.getContext('2d');
        if (!ctx) return c;
        const img = ctx.createImageData(1, h);
        const d = img.data;
        for (let y = 0; y < h; y++) {
            const t = y / Math.max(1, h - 1);
            const a = Math.max(0, 1 - t);
            const i = y * 4;
            d[i] = 180;
            d[i + 1] = 180;
            d[i + 2] = 180;
            d[i + 3] = Math.round(a * 255);
        }
        ctx.putImageData(img, 0, 0);
        return c;
    }

    render(imageProcessor, player, options = {}) {
        if (!imageProcessor.collisionMap) return;

        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        // 2. Raycasting
        const fovDeg = options.fovDeg;
        const fov = isFinite(fovDeg) && fovDeg > 0 ? (fovDeg * Math.PI) / 180 : this.fov;
        const rayCount = Math.min(900, Math.max(320, Math.floor(this.canvas.width)));
        const step = fov / rayCount;
        const colW = this.canvas.width / rayCount;
        const slices = new Array(rayCount);
        const hits = new Array(rayCount);
        const metersPerPixel = options.metersPerPixel || 0.05;
        const viewDistanceM = Math.max(1, options.viewDistanceM || 24);
        const lookOffsetRaw = options.lookOffset || 0;
        const lookOffset = Math.max(-0.45, Math.min(0.45, lookOffsetRaw));
        const roomHeightM = options.roomHeightM || 2.9;
        const playerHeightM = options.playerHeightM || 1.7;
        const scaleTune = options.scaleTune || 1.0;
        const floorZ = isFinite(options.floorZ) ? options.floorZ : 0;
        const eyeAboveFloorM = playerHeightM * 0.95 + player.z * metersPerPixel;
        const eyeWorldZ = floorZ + eyeAboveFloorM;
        const roomHeightLocalM = roomHeightM - floorZ;
        const projectionPlane = (this.canvas.width / 2) / Math.tan(fov / 2);
        const horizonY = this.canvas.height / 2 - lookOffset * this.canvas.height;

        this.drawBackground(horizonY);
        const maxRayDistPx = Math.min(20000, Math.max(this.maxDepth, viewDistanceM / Math.max(1e-6, metersPerPixel)));
        const minWallDistanceM = Math.max(0.25, Math.min(1.5, options.minWallDistanceM || 0.7));
        if (!this.wallTexture) this.wallTexture = this.createWallTexture();
        if (!this.glassTexture) this.glassTexture = this.createGlassTexture();
        if (!this.shadowRamp) this.shadowRamp = this.createShadowRamp();
        const tex = this.wallTexture;
        const glassTex = this.glassTexture;
        this.ctx.imageSmoothingEnabled = false;

        for (let i = 0; i < rayCount; i++) {
            const rayAngle = player.angle - fov / 2 + i * step;
            const hit = this.castRay(player.x, player.y, rayAngle, imageProcessor, maxRayDistPx);
            const correctedDistanceM = Math.max(minWallDistanceM, hit.distancePx * metersPerPixel);
            hits[i] = hit.hit ? { rayAngle, hit, correctedDistanceM } : null;
        }

        this.drawHeightfieldFloor(imageProcessor, player, {
            fov,
            rayCount,
            step,
            colW,
            horizonY,
            projectionPlane,
            scaleTune,
            metersPerPixel,
            viewDistanceM,
            eyeWorldZ,
            floorZ,
            hits
        });

        for (let i = 0; i < rayCount; i++) {
            const hi = hits[i];
            if (!hi) {
                slices[i] = null;
                continue;
            }
            const hit = hi.hit;
            const correctedDistanceM = hi.correctedDistanceM;
            
            const x = i * colW;
            const n = hit.normal;
            const lit = 0.98;
            const shadowed = 0.80;
            const factorFromNormal = (nn) => (nn === 'E' || nn === 'S') ? shadowed : lit;
            let faceFactor = factorFromNormal(n);
            if (i > 0) {
                const pn = slices[i - 1] && slices[i - 1].normal;
                if (pn && pn !== n) {
                    const pf = factorFromNormal(pn);
                    faceFactor = faceFactor * 0.60 + pf * 0.40;
                }
            }
            if (hit.kind === 'portal') {
                const doorHeadM = 2.1;
                const windowSillM = 0.9;
                const windowHeadM = 2.1;
                const topM = hit.portalType === 'door' ? doorHeadM : windowHeadM;
                const bottomM = hit.portalType === 'door' ? 0 : windowSillM;
                const baseZ = isFinite(hit.baseZ) ? hit.baseZ : floorZ;
                const yTop = horizonY - (((baseZ + topM) - eyeWorldZ) / correctedDistanceM) * projectionPlane * scaleTune;
                const yBottom = horizonY - (((baseZ + bottomM) - eyeWorldZ) / correctedDistanceM) * projectionPlane * scaleTune;
                const texX = Math.max(0, Math.min(glassTex.width - 1, Math.floor(hit.u * glassTex.width)));
                this.ctx.save();
                this.ctx.globalAlpha = 0.6;
                this.ctx.drawImage(glassTex, texX, 0, 1, glassTex.height, x, yTop, colW + 1, yBottom - yTop);
                this.ctx.restore();
                const darkA = Math.max(0, Math.min(0.30, 1 - faceFactor));
                if (darkA > 1e-4) {
                    this.ctx.fillStyle = `rgba(0, 0, 0, ${darkA})`;
                    this.ctx.fillRect(x, yTop, colW + 1, yBottom - yTop);
                }
                slices[i] = {
                    x,
                    y: yTop,
                    w: colW + 1,
                    h: yBottom - yTop,
                    d: correctedDistanceM,
                    tx: hit.tx,
                    ty: hit.ty,
                    normal: hit.normal,
                    portal: { id: hit.portalId, type: hit.portalType, top: yTop, bottom: yBottom }
                };
            } else if (hit.kind === 'riser') {
                const zTop = hit.riserTopZ;
                const zBottom = hit.riserBottomZ;
                const yTop = horizonY - ((zTop - eyeWorldZ) / correctedDistanceM) * projectionPlane * scaleTune;
                const yBottom = horizonY - ((zBottom - eyeWorldZ) / correctedDistanceM) * projectionPlane * scaleTune;
                const y = Math.min(yTop, yBottom);
                const h = Math.abs(yBottom - yTop);
                const texX = Math.max(0, Math.min(tex.width - 1, Math.floor(hit.u * tex.width)));
                this.ctx.drawImage(tex, texX, 0, 1, tex.height, x, y, colW + 1, h);
                const darkA = Math.max(0, Math.min(0.35, 1 - faceFactor));
                if (darkA > 1e-4) {
                    this.ctx.fillStyle = `rgba(0, 0, 0, ${darkA})`;
                    this.ctx.fillRect(x, y, colW + 1, h);
                }
                slices[i] = {
                    x,
                    y,
                    w: colW + 1,
                    h,
                    d: correctedDistanceM,
                    tx: hit.tx,
                    ty: hit.ty,
                    normal: hit.normal,
                    riser: { topZ: zTop, bottomZ: zBottom }
                };
            } else if (hit.kind === 'wall') {
                const baseZ = isFinite(hit.baseZ) ? hit.baseZ : floorZ;
                const yTop = horizonY - ((roomHeightM - eyeWorldZ) / correctedDistanceM) * projectionPlane * scaleTune;
                const yBottom = horizonY - ((baseZ - eyeWorldZ) / correctedDistanceM) * projectionPlane * scaleTune;
                const y = Math.min(yTop, yBottom);
                const visibleHeight = Math.abs(yBottom - yTop);
                const texX = Math.max(0, Math.min(tex.width - 1, Math.floor(hit.u * tex.width)));
                this.ctx.drawImage(tex, texX, 0, 1, tex.height, x, y, colW + 1, visibleHeight);
                const darkA = Math.max(0, Math.min(0.30, 1 - faceFactor));
                if (darkA > 1e-4) {
                    this.ctx.fillStyle = `rgba(0, 0, 0, ${darkA})`;
                    this.ctx.fillRect(x, y, colW + 1, visibleHeight);
                }
                const slice = {
                    x,
                    y,
                    w: colW + 1,
                    h: visibleHeight,
                    d: correctedDistanceM,
                    tx: hit.tx,
                    ty: hit.ty,
                    normal: hit.normal
                };
                if (hit.portalOverlay) {
                    const po = hit.portalOverlay;
                    const doorHeadM = 2.1;
                    const windowSillM = 0.9;
                    const windowHeadM = 2.1;
                    const topM = po.type === 'door' ? doorHeadM : windowHeadM;
                    const bottomM = po.type === 'door' ? 0 : windowSillM;
                    const distM = Math.max(minWallDistanceM, po.distancePx * metersPerPixel);
                    const poBaseZ = isFinite(po.baseZ) ? po.baseZ : baseZ;
                    const yTop = horizonY - (((poBaseZ + topM) - eyeWorldZ) / distM) * projectionPlane * scaleTune;
                    const yBottom = horizonY - (((poBaseZ + bottomM) - eyeWorldZ) / distM) * projectionPlane * scaleTune;
                    const texGX = Math.max(0, Math.min(glassTex.width - 1, Math.floor(po.u * glassTex.width)));
                    this.ctx.save();
                    this.ctx.globalAlpha = 0.6;
                    this.ctx.drawImage(glassTex, texGX, 0, 1, glassTex.height, x, yTop, colW + 1, yBottom - yTop);
                    this.ctx.restore();
                    const gDarkA = Math.max(0, Math.min(0.30, 1 - faceFactor));
                    if (gDarkA > 1e-4) {
                        this.ctx.fillStyle = `rgba(0, 0, 0, ${gDarkA})`;
                        this.ctx.fillRect(x, yTop, colW + 1, yBottom - yTop);
                    }
                    slice.portal = { id: po.id, type: po.type, top: yTop, bottom: yBottom };
                }
                slices[i] = slice;
            } else {
                slices[i] = null;
            }
        }

        this.drawShadows(slices, viewDistanceM, horizonY);

        // 3. Contour lines overlay
        this.drawContourOverlay(slices, viewDistanceM);
        this.drawPortalFrames(slices, viewDistanceM);
    }

    drawBackground(horizonY = this.canvas.height / 2) {
        const h = this.canvas.height;
        const mid = Math.max(0, Math.min(h, horizonY));

        // Ceiling
        const ceilingGradient = this.ctx.createLinearGradient(0, 0, 0, Math.max(1, mid));
        ceilingGradient.addColorStop(0, '#F3F4F6');
        ceilingGradient.addColorStop(1, '#F9FAFB');
        this.ctx.fillStyle = ceilingGradient;
        this.ctx.fillRect(0, 0, this.canvas.width, mid);

        // Floor
        const floorGradient = this.ctx.createLinearGradient(0, mid, 0, h);
        floorGradient.addColorStop(0, '#E5E7EB');
        floorGradient.addColorStop(1, '#D1D5DB');
        this.ctx.fillStyle = floorGradient;
        this.ctx.fillRect(0, mid, this.canvas.width, h - mid);
    }

    drawHeightfieldFloor(imageProcessor, player, params) {
        const elev = imageProcessor.elevationMap;
        const map = imageProcessor.collisionMap;
        if (!elev || !map) return;

        const stairMask = imageProcessor.stairMask;
        const tileSize = imageProcessor.tileSize;
        const rows = map.length;
        const cols = map[0].length;

        const w = this.canvas.width;
        const h = this.canvas.height;
        const horizonY = params.horizonY;
        const yStart = Math.max(0, Math.min(h, Math.floor(horizonY)));
        const floorH = h - yStart;
        if (floorH <= 0) return;

        const fov = params.fov;
        const rayCount = params.rayCount;
        const step = params.step;
        const colW = params.colW;
        const projectionPlane = params.projectionPlane;
        const scaleTune = params.scaleTune;
        const metersPerPixel = params.metersPerPixel;
        const invMpp = 1 / Math.max(1e-6, metersPerPixel);
        const viewDistanceM = params.viewDistanceM;
        const eyeWorldZ = params.eyeWorldZ;
        const floorZ = params.floorZ;
        const hits = params.hits;

        if (!this._floorDistFactor || this._floorDistFactor.length !== floorH) {
            this._floorDistFactor = new Float32Array(floorH);
        }
        for (let yy = 0; yy < floorH; yy++) {
            const denom = (yStart + yy + 0.5) - horizonY;
            this._floorDistFactor[yy] = denom > 1e-3 ? (projectionPlane * scaleTune) / denom : 0;
        }

        const img = this.ctx.getImageData(0, yStart, w, floorH);
        const data = img.data;

        const baseR = 229, baseG = 231, baseB = 235;
        const wallR = 230, wallG = 230, wallB = 230;
        const hash01 = (x, y) => {
            let n = (x * 73856093) ^ (y * 19349663);
            n = (n ^ (n >>> 13)) * 1274126177;
            n = n ^ (n >>> 16);
            return (n >>> 0) / 4294967295;
        };

        for (let i = 0; i < rayCount; i++) {
            const rayAngle = player.angle - fov / 2 + i * step;
            const dirX = Math.cos(rayAngle);
            const dirY = Math.sin(rayAngle);
            const x0 = Math.floor(i * colW);
            const x1 = Math.min(w, Math.floor((i + 1) * colW));
            if (x1 <= x0) continue;

            let maxDistM = viewDistanceM;
            const hi = hits && hits[i];
            if (hi && hi.hit && hi.hit.kind === 'wall') {
                maxDistM = Math.min(viewDistanceM, hi.correctedDistanceM);
            }

            for (let yy = 0; yy < floorH; yy++) {
                const f = this._floorDistFactor[yy];
                if (f <= 0) continue;

                let distM = (eyeWorldZ - floorZ) * f;
                if (!isFinite(distM) || distM <= 0 || distM > maxDistM) continue;
                let distPx = distM * invMpp;
                let wx = player.x + dirX * distPx;
                let wy = player.y + dirY * distPx;

                let tx = Math.floor(wx / tileSize);
                let ty = Math.floor(wy / tileSize);
                if (tx < 0 || ty < 0 || tx >= cols || ty >= rows) continue;

                let z = elev[ty][tx] || 0;
                distM = (eyeWorldZ - z) * f;
                if (!isFinite(distM) || distM <= 0 || distM > maxDistM) continue;
                distPx = distM * invMpp;
                wx = player.x + dirX * distPx;
                wy = player.y + dirY * distPx;

                tx = Math.floor(wx / tileSize);
                ty = Math.floor(wy / tileSize);
                if (tx < 0 || ty < 0 || tx >= cols || ty >= rows) continue;

                z = elev[ty][tx] || 0;

                const t = Math.max(0, Math.min(1, distM / Math.max(1e-6, viewDistanceM)));
                let shade = 1 - 0.22 * t;
                const dz = z - floorZ;
                shade *= (1 + Math.max(-1, Math.min(1, dz / 1.2)) * 0.06);

                let r = baseR * shade;
                let g = baseG * shade;
                let b = baseB * shade;

                const cell = map[ty][tx];
                if (cell === 2) {
                    r *= 0.86;
                    g *= 0.86;
                    b *= 0.86;
                }

                const isStair = stairMask && stairMask[ty][tx] === 1;
                const isElev = Math.abs(z) > 1e-3;
                if (isStair) {
                    const n = hash01(tx, ty);
                    const grain = (n - 0.5) * 16;
                    r = (wallR + grain) * shade;
                    g = (wallG + grain) * shade;
                    b = (wallB + grain) * shade;
                    const dzAbs = Math.min(1.2, Math.abs(z - floorZ));
                    const stepShade = 1 - dzAbs * 0.05;
                    r *= stepShade;
                    g *= stepShade;
                    b *= stepShade;
                } else if (isElev) {
                    const n = hash01(tx, ty);
                    const grain = (n - 0.5) * 10;
                    const s2 = shade * 0.98;
                    r = (baseR + grain) * s2;
                    g = (baseG + grain) * s2;
                    b = (baseB + grain) * s2;
                }

                if (isStair || isElev) {
                    const fx = wx / tileSize - tx;
                    const fy = wy / tileSize - ty;
                    if (fx < 0.04 || fx > 0.96 || fy < 0.04 || fy > 0.96) {
                        const edgeMul = isStair ? 0.62 : 0.74;
                        r *= edgeMul;
                        g *= edgeMul;
                        b *= edgeMul;
                    }
                }

                r = Math.max(0, Math.min(255, r));
                g = Math.max(0, Math.min(255, g));
                b = Math.max(0, Math.min(255, b));

                const rowOff = yy * w * 4;
                for (let x = x0; x < x1; x++) {
                    const idx = rowOff + x * 4;
                    data[idx] = r;
                    data[idx + 1] = g;
                    data[idx + 2] = b;
                    data[idx + 3] = 255;
                }
            }
        }

        this.ctx.putImageData(img, 0, yStart);
    }

    castRay(px, py, angle, imageProcessor, maxDistPx) {
        const tileSize = imageProcessor.tileSize;
        const map = imageProcessor.collisionMap;
        const rows = map.length;
        const cols = map[0].length;
        const openings = imageProcessor.openings || [];
        const openingCellMap = imageProcessor.openingCellMap || null;
        const elev = imageProcessor.elevationMap || null;

        const posX = px / tileSize;
        const posY = py / tileSize;
        const dirX = Math.cos(angle);
        const dirY = Math.sin(angle);

        let mapX = Math.floor(posX);
        let mapY = Math.floor(posY);

        const invX = dirX === 0 ? 1e9 : 1 / dirX;
        const invY = dirY === 0 ? 1e9 : 1 / dirY;
        const deltaX = Math.abs(invX);
        const deltaY = Math.abs(invY);

        let stepX = 1;
        let stepY = 1;
        let sideDistX = 0;
        let sideDistY = 0;

        if (dirX < 0) {
            stepX = -1;
            sideDistX = (posX - mapX) * deltaX;
        } else {
            sideDistX = (mapX + 1 - posX) * deltaX;
        }
        if (dirY < 0) {
            stepY = -1;
            sideDistY = (posY - mapY) * deltaY;
        } else {
            sideDistY = (mapY + 1 - posY) * deltaY;
        }

        const maxDistTiles = maxDistPx / tileSize;
        let side = 0;
        let portalOverlay = null;

        while (true) {
            const prevX = mapX;
            const prevY = mapY;
            if (sideDistX < sideDistY) {
                sideDistX += deltaX;
                mapX += stepX;
                side = 0;
            } else {
                sideDistY += deltaY;
                mapY += stepY;
                side = 1;
            }

            if (mapX < 0 || mapY < 0 || mapX >= cols || mapY >= rows) {
                return { hit: false, distancePx: maxDistPx, tx: -1, ty: -1, u: 0 };
            }

            const distTiles = side === 0
                ? (mapX - posX + (1 - stepX) / 2) / (dirX === 0 ? 1e-9 : dirX)
                : (mapY - posY + (1 - stepY) / 2) / (dirY === 0 ? 1e-9 : dirY);

            if (distTiles > maxDistTiles) {
                return { hit: false, distancePx: maxDistPx, tx: mapX, ty: mapY, u: 0 };
            }

            const cell = map[mapY][mapX];
            const normal = side === 0
                ? (stepX > 0 ? 'W' : 'E')
                : (stepY > 0 ? 'N' : 'S');

            const prevCell = map[prevY][prevX];
            const prevWalk = prevCell === 0 || prevCell === 3;
            const curWalk = cell === 0 || cell === 3;
            if (prevWalk && curWalk && elev) {
                const zA = imageProcessor.getElevationAtTile(prevX, prevY);
                const zB = imageProcessor.getElevationAtTile(mapX, mapY);
                const dz = zB - zA;
                if (Math.abs(dz) >= 0.14) {
                    const hitX = posX + distTiles * dirX;
                    const hitY = posY + distTiles * dirY;
                    let wallX = side === 0 ? hitY : hitX;
                    wallX -= Math.floor(wallX);
                    return {
                        hit: true,
                        kind: 'riser',
                        distancePx: distTiles * tileSize,
                        tx: mapX,
                        ty: mapY,
                        u: wallX,
                        normal,
                        riserTopZ: Math.max(zA, zB),
                        riserBottomZ: Math.min(zA, zB)
                    };
                }
            }

            if (!portalOverlay && openingCellMap) {
                const id = openingCellMap.get(`${mapX},${mapY}`);
                if (id != null) {
                    const o = openings[id];
                    if (o && o.kind === 'interior') {
                        const hitX = posX + distTiles * dirX;
                        const hitY = posY + distTiles * dirY;
                        let wallX = side === 0 ? hitY : hitX;
                        wallX -= Math.floor(wallX);
                        const baseZ = elev ? imageProcessor.getElevationAtTile(mapX, mapY) : 0;
                        portalOverlay = { id, type: o.type || 'opening', distancePx: distTiles * tileSize, u: wallX, normal, baseZ };
                    }
                }
            }

            if (cell === 2) {
                const sideOut = side === 0 ? (stepX > 0 ? 'E' : 'W') : (stepY > 0 ? 'S' : 'N');
                const insideX = prevX;
                const insideY = prevY;
                let portalId = -1;
                let portalType = null;
                if (openingCellMap) {
                    const id = openingCellMap.get(`${insideX},${insideY}`);
                    if (id != null) {
                        const o = openings[id];
                        if (o && o.kind === 'exterior' && o.side === sideOut) {
                            portalId = id;
                            portalType = o.type || 'opening';
                        }
                    }
                }
                if (portalId < 0) {
                    for (let i = 0; i < openings.length; i++) {
                        const o = openings[i];
                        if (!o || o.kind !== 'exterior' || o.side !== sideOut) continue;
                        if (insideX < o.minTx || insideX > o.maxTx || insideY < o.minTy || insideY > o.maxTy) continue;
                        portalId = i;
                        portalType = o.type || 'opening';
                        break;
                    }
                }
                if (portalId >= 0) {
                    const hitX = posX + distTiles * dirX;
                    const hitY = posY + distTiles * dirY;
                    let wallX = side === 0 ? hitY : hitX;
                    wallX -= Math.floor(wallX);
                    const baseZ = elev ? imageProcessor.getElevationAtTile(insideX, insideY) : 0;
                    return { hit: true, kind: 'portal', portalId, portalType, distancePx: distTiles * tileSize, tx: insideX, ty: insideY, u: wallX, normal, baseZ };
                }
                return { hit: false, distancePx: maxDistPx, tx: mapX, ty: mapY, u: 0 };
            }

            if (cell === 1) {
                const hitX = posX + distTiles * dirX;
                const hitY = posY + distTiles * dirY;
                let wallX = side === 0 ? hitY : hitX;
                wallX -= Math.floor(wallX);
                const baseZ = (elev && prevWalk) ? imageProcessor.getElevationAtTile(prevX, prevY) : 0;
                const out = { hit: true, kind: 'wall', distancePx: distTiles * tileSize, tx: mapX, ty: mapY, u: wallX, normal, baseZ };
                if (portalOverlay) out.portalOverlay = portalOverlay;
                return out;
            }
        }
    }

    drawContourOverlay(slices, viewDistanceM) {
        this.ctx.save();
        const base = '55, 65, 81';
        const edgeWidth = 2;

        for (let i = 0; i < slices.length; i++) {
            const s = slices[i];
            if (i === 0) continue;
            const p = slices[i - 1];

            if (!s && p && isFinite(p.d)) {
                const t = Math.max(0, Math.min(1, p.d / Math.max(1, viewDistanceM)));
                const alpha = Math.max(0.08, Math.min(0.30, 0.30 - t * 0.20));
                this.ctx.fillStyle = `rgba(${base}, ${alpha})`;
                this.ctx.fillRect(p.x + p.w - edgeWidth, p.y, edgeWidth, p.h);
                continue;
            }
            if (s && isFinite(s.d) && !p) {
                const t = Math.max(0, Math.min(1, s.d / Math.max(1, viewDistanceM)));
                const alpha = Math.max(0.08, Math.min(0.30, 0.30 - t * 0.20));
                this.ctx.fillStyle = `rgba(${base}, ${alpha})`;
                this.ctx.fillRect(s.x, s.y, edgeWidth, s.h);
                continue;
            }
            if (!s || !p || !isFinite(s.d) || !isFinite(p.d)) continue;

            const depthJump = Math.abs(s.d - p.d);
            const normalChange = s.normal && p.normal && s.normal !== p.normal;
            if (normalChange || depthJump > 0.8) {
                const top = Math.min(s.y, p.y);
                const bottom = Math.max(s.y + s.h, p.y + p.h);
                const d = Math.min(s.d, p.d);
                const t = Math.max(0, Math.min(1, d / Math.max(1, viewDistanceM)));
                const alpha = Math.max(0.08, Math.min(0.34, 0.34 - t * 0.24));
                this.ctx.fillStyle = `rgba(${base}, ${alpha})`;
                this.ctx.fillRect(s.x, top, edgeWidth, bottom - top);
            }
        }

        this.ctx.restore();
    }

    drawShadows(slices, viewDistanceM, horizonY) {
        const ctx = this.ctx;
        const ramp = this.shadowRamp;
        if (!ramp) return;

        ctx.save();
        ctx.globalCompositeOperation = 'multiply';

        const offsetX = 2;
        const offsetY = 2;

        for (let i = 0; i < slices.length; i++) {
            const s = slices[i];
            if (!s || !isFinite(s.d)) continue;
            if (i === 0) continue;
            const p = slices[i - 1];
            if (!p || !isFinite(p.d)) continue;

            const depthJump = Math.abs(s.d - p.d);
            const normalChange = s.normal && p.normal && s.normal !== p.normal;
            if (!normalChange && depthJump <= 0.8) continue;

            const top = Math.min(s.y, p.y);
            const bottom = Math.max(s.y + s.h, p.y + p.h);
            const d = Math.min(s.d, p.d);
            const t = Math.max(0, Math.min(1, d / Math.max(1, viewDistanceM)));
            const alpha = Math.max(0.10, Math.min(0.20, 0.20 - t * 0.10));
            const blur = Math.max(1, Math.min(2, 2 - t));

            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.shadowColor = 'rgb(180, 180, 180)';
            ctx.shadowBlur = blur;
            ctx.shadowOffsetX = offsetX;
            ctx.shadowOffsetY = offsetY;
            ctx.fillStyle = 'rgb(180, 180, 180)';
            ctx.fillRect(s.x, top, 2, bottom - top);
            ctx.restore();

            const floorTop = Math.min(s.y + s.h, p.y + p.h);
            if (floorTop >= horizonY && floorTop <= this.canvas.height) {
                const len = Math.max(6, Math.min(22, (bottom - top) * 0.10));
                ctx.save();
                ctx.globalAlpha = alpha * 0.45;
                ctx.shadowColor = 'rgb(180, 180, 180)';
                ctx.shadowBlur = blur;
                ctx.shadowOffsetX = offsetX;
                ctx.shadowOffsetY = offsetY;
                ctx.drawImage(ramp, 0, 0, 1, ramp.height, s.x, floorTop, 2, len);
                ctx.restore();
            }
        }

        ctx.restore();
    }

    drawPortalFrames(slices, viewDistanceM) {
        this.ctx.save();
        this.ctx.lineWidth = 2;
        this.ctx.setLineDash([]);
        const base = '55, 65, 81';

        let i = 0;
        while (i < slices.length) {
            const s = slices[i];
            if (!s || !s.portal) {
                i++;
                continue;
            }
            const id = s.portal.id;
            let j = i;
            let x0 = s.x;
            let x1 = s.x + s.w;
            let top = s.portal.top;
            let bottom = s.portal.bottom;
            let d = s.d;
            while (j + 1 < slices.length && slices[j + 1] && slices[j + 1].portal && slices[j + 1].portal.id === id) {
                j++;
                const sj = slices[j];
                x1 = sj.x + sj.w;
                if (sj.portal.top < top) top = sj.portal.top;
                if (sj.portal.bottom > bottom) bottom = sj.portal.bottom;
                if (sj.d < d) d = sj.d;
            }
            const t = Math.max(0, Math.min(1, d / Math.max(1, viewDistanceM)));
            const alpha = Math.max(0.10, Math.min(0.40, 0.38 - t * 0.22));
            this.ctx.strokeStyle = `rgba(${base}, ${alpha})`;
            this.ctx.strokeRect(x0, top, x1 - x0, bottom - top);
            i = j + 1;
        }

        this.ctx.restore();
    }
}
