class ImageProcessor {
    constructor() {
        this.collisionMap = null;
        this.baseCollisionMap = null;
        this.baseTileSize = 0;
        this.width = 0;
        this.height = 0;
        this.contours = [];
        this.tileSize = 20; // Size of collision grid cells
        this.outerContour = null;
        this.outerContourPoints = null;
        this.roomBBox = null;
        this.sourceScale = 1;
        this.metersPerPixel = 0.05;
        this.openings = [];
        this.openingCellMap = new Map();
        this.regionMap = null;
        this.regionCount = 0;
        this.regionElevations = new Map();
        this.stairs = [];
        this.elevationMap = null;
        this.stairMask = null;
    }

    ensureElevationGrid(rows, cols) {
        const ok = this.elevationMap
            && this.elevationMap.length === rows
            && this.elevationMap[0]
            && this.elevationMap[0].length === cols;
        if (!ok) {
            this.elevationMap = Array.from({ length: rows }, () => new Float32Array(cols));
        }
        if (!this.stairMask || this.stairMask.length !== rows || !this.stairMask[0] || this.stairMask[0].length !== cols) {
            this.stairMask = Array.from({ length: rows }, () => new Uint8Array(cols));
        }
    }

    buildRegions() {
        if (!this.collisionMap) {
            this.regionMap = null;
            this.regionCount = 0;
            this.regionElevations = new Map();
            this.elevationMap = null;
            this.stairMask = null;
            return;
        }

        const map = this.collisionMap;
        const rows = map.length;
        const cols = map[0].length;
        const regionMap = Array.from({ length: rows }, () => new Int32Array(cols).fill(-1));
        const isWalkable = (v) => v === 0 || v === 3;

        const prev = this.regionElevations;
        const nextElev = new Map();

        let id = 0;
        const stack = [];
        for (let y0 = 0; y0 < rows; y0++) {
            for (let x0 = 0; x0 < cols; x0++) {
                if (regionMap[y0][x0] !== -1) continue;
                if (!isWalkable(map[y0][x0])) continue;
                regionMap[y0][x0] = id;
                stack.push([x0, y0]);

                while (stack.length) {
                    const [x, y] = stack.pop();
                    if (x > 0 && regionMap[y][x - 1] === -1 && isWalkable(map[y][x - 1])) {
                        regionMap[y][x - 1] = id;
                        stack.push([x - 1, y]);
                    }
                    if (x + 1 < cols && regionMap[y][x + 1] === -1 && isWalkable(map[y][x + 1])) {
                        regionMap[y][x + 1] = id;
                        stack.push([x + 1, y]);
                    }
                    if (y > 0 && regionMap[y - 1][x] === -1 && isWalkable(map[y - 1][x])) {
                        regionMap[y - 1][x] = id;
                        stack.push([x, y - 1]);
                    }
                    if (y + 1 < rows && regionMap[y + 1][x] === -1 && isWalkable(map[y + 1][x])) {
                        regionMap[y + 1][x] = id;
                        stack.push([x, y + 1]);
                    }
                }

                const z = prev && prev.has(id) ? prev.get(id) : 0;
                nextElev.set(id, z);
                id++;
            }
        }

        this.regionMap = regionMap;
        this.regionCount = id;
        this.regionElevations = nextElev;
    }

    getTile(tx, ty) {
        if (!this.collisionMap) return null;
        if (ty < 0 || ty >= this.collisionMap.length) return null;
        if (tx < 0 || tx >= this.collisionMap[0].length) return null;
        return { tx, ty };
    }

    getElevationAtTile(tx, ty) {
        if (!this.elevationMap) return 0;
        if (ty < 0 || ty >= this.elevationMap.length) return 0;
        if (tx < 0 || tx >= this.elevationMap[0].length) return 0;
        const v = this.elevationMap[ty][tx];
        return isFinite(v) ? v : 0;
    }

    isStairAtTile(tx, ty) {
        if (!this.stairMask) return false;
        if (ty < 0 || ty >= this.stairMask.length) return false;
        if (tx < 0 || tx >= this.stairMask[0].length) return false;
        return this.stairMask[ty][tx] === 1;
    }

    getElevationAtWorld(x, y) {
        if (!this.collisionMap) return 0;
        const tx = Math.floor(x / this.tileSize);
        const ty = Math.floor(y / this.tileSize);
        return this.getElevationAtTile(tx, ty);
    }

    isStairAtWorld(x, y) {
        if (!this.collisionMap) return false;
        const tx = Math.floor(x / this.tileSize);
        const ty = Math.floor(y / this.tileSize);
        return this.isStairAtTile(tx, ty);
    }

    setElevationAtTile(tx, ty, zM) {
        if (!this.elevationMap || !isFinite(zM)) return;
        if (ty < 0 || ty >= this.elevationMap.length) return;
        if (tx < 0 || tx >= this.elevationMap[0].length) return;
        this.elevationMap[ty][tx] = zM;
    }

    setElevationRectAtWorld(x0, y0, x1, y1, zM) {
        if (!this.collisionMap || !this.elevationMap) return;
        if (!isFinite(zM)) return;
        const minTx = Math.max(0, Math.min(Math.floor(x0 / this.tileSize), Math.floor(x1 / this.tileSize)));
        const maxTx = Math.min(this.collisionMap[0].length - 1, Math.max(Math.floor(x0 / this.tileSize), Math.floor(x1 / this.tileSize)));
        const minTy = Math.max(0, Math.min(Math.floor(y0 / this.tileSize), Math.floor(y1 / this.tileSize)));
        const maxTy = Math.min(this.collisionMap.length - 1, Math.max(Math.floor(y0 / this.tileSize), Math.floor(y1 / this.tileSize)));
        for (let ty = minTy; ty <= maxTy; ty++) {
            for (let tx = minTx; tx <= maxTx; tx++) {
                const cell = this.collisionMap[ty][tx];
                if (cell === 2) continue;
                if (cell === 0 || cell === 3) {
                    this.elevationMap[ty][tx] = zM;
                }
            }
        }
    }

    placeStairsAtTile(startTx, startTy, opts) {
        if (!this.collisionMap || !this.elevationMap || !this.stairMask) return false;
        const rows = this.collisionMap.length;
        const cols = this.collisionMap[0].length;
        if (startTx < 0 || startTy < 0 || startTx >= cols || startTy >= rows) return false;

        const dir = opts && opts.dir ? opts.dir : 'E';
        const steps = Math.max(1, Math.min(60, Math.floor(opts && opts.steps ? opts.steps : 6)));
        const width = Math.max(1, Math.min(12, Math.floor(opts && opts.width ? opts.width : 2)));
        const stepLen = Math.max(1, Math.min(12, Math.floor(opts && opts.stepLen ? opts.stepLen : 1)));
        const sign = opts && opts.sign === 1 ? 1 : -1;

        let dx = 1, dy = 0;
        if (dir === 'W') { dx = -1; dy = 0; }
        else if (dir === 'N') { dx = 0; dy = -1; }
        else if (dir === 'S') { dx = 0; dy = 1; }
        const px = -dy;
        const py = dx;
        const halfL = Math.floor((width - 1) / 2);
        const halfR = (width - 1) - halfL;
        const baseZ = this.getElevationAtTile(startTx, startTy);

        for (let i = 0; i < steps; i++) {
            const z = baseZ + sign * 0.15 * i;
            for (let j = 0; j < stepLen; j++) {
                const along = i * stepLen + j;
                for (let off = -halfL; off <= halfR; off++) {
                    const tx = startTx + dx * along + px * off;
                    const ty = startTy + dy * along + py * off;
                    if (tx < 0 || ty < 0 || tx >= cols || ty >= rows) continue;
                    const cell = this.collisionMap[ty][tx];
                    if (cell === 2) continue;
                    if (cell === 1) this.collisionMap[ty][tx] = 0;
                    if (cell === 0 || cell === 1 || cell === 3) {
                        this.collisionMap[ty][tx] = 0;
                        this.elevationMap[ty][tx] = z;
                        this.stairMask[ty][tx] = 1;
                    }
                }
            }
        }

        return true;
    }

    getRegionIdAtWorld(x, y) {
        if (!this.collisionMap || !this.regionMap) return -1;
        const tx = Math.floor(x / this.tileSize);
        const ty = Math.floor(y / this.tileSize);
        if (ty < 0 || ty >= this.regionMap.length) return -1;
        if (tx < 0 || tx >= this.regionMap[0].length) return -1;
        return this.regionMap[ty][tx];
    }

    setRegionElevationAtWorld(x, y, zM) {
        const id = this.getRegionIdAtWorld(x, y);
        if (id < 0) return -1;
        this.regionElevations.set(id, zM);
        return id;
    }

    getRegionElevation(regionId) {
        if (regionId < 0) return 0;
        const v = this.regionElevations.get(regionId);
        return isFinite(v) ? v : 0;
    }

    clearElevations() {
        const next = new Map();
        for (let i = 0; i < this.regionCount; i++) next.set(i, 0);
        this.regionElevations = next;
        if (this.elevationMap) {
            for (let y = 0; y < this.elevationMap.length; y++) {
                this.elevationMap[y].fill(0);
            }
        }
    }

    clearStairs() {
        this.stairs = [];
        if (this.stairMask) {
            for (let y = 0; y < this.stairMask.length; y++) {
                this.stairMask[y].fill(0);
            }
        }
    }

    addStairRect(rect, fromRegion, toRegion) {
        if (!rect) return;
        if (fromRegion < 0 || toRegion < 0 || fromRegion === toRegion) return;
        const fromZ = this.getRegionElevation(fromRegion);
        const toZ = this.getRegionElevation(toRegion);
        const deltaZ = toZ - fromZ;
        const stepRise = 0.15;
        const stepCount = Math.max(1, Math.min(30, Math.round(Math.abs(deltaZ) / stepRise)));
        const dx = rect.endX - rect.startX;
        const dy = rect.endY - rect.startY;
        const len = Math.hypot(dx, dy);
        if (!isFinite(len) || len < 1) return;
        const nx = dx / len;
        const ny = dy / len;
        this.stairs.push({
            minX: Math.min(rect.startX, rect.endX),
            maxX: Math.max(rect.startX, rect.endX),
            minY: Math.min(rect.startY, rect.endY),
            maxY: Math.max(rect.startY, rect.endY),
            startX: rect.startX,
            startY: rect.startY,
            endX: rect.endX,
            endY: rect.endY,
            dirX: nx,
            dirY: ny,
            len,
            fromRegion,
            toRegion,
            fromZ,
            toZ,
            deltaZ,
            stepCount
        });
    }

    getFloorZAtWorld(x, y) {
        for (let i = 0; i < this.stairs.length; i++) {
            const s = this.stairs[i];
            if (x < s.minX || x > s.maxX || y < s.minY || y > s.maxY) continue;
            const vx = x - s.startX;
            const vy = y - s.startY;
            const t = Math.max(0, Math.min(1, (vx * s.dirX + vy * s.dirY) / s.len));
            return s.fromZ + (s.toZ - s.fromZ) * t;
        }
        const rid = this.getRegionIdAtWorld(x, y);
        return this.getRegionElevation(rid);
    }

    hasStairBetweenRegions(a, b) {
        if (a < 0 || b < 0) return false;
        for (let i = 0; i < this.stairs.length; i++) {
            const s = this.stairs[i];
            if ((s.fromRegion === a && s.toRegion === b) || (s.fromRegion === b && s.toRegion === a)) return true;
        }
        return false;
    }

    detectOpenings() {
        this.openings = [];
        this.openingCellMap = new Map();
        if (!this.collisionMap) return;
        const map = this.collisionMap;
        const rows = map.length;
        const cols = map[0].length;
        const visited = Array.from({ length: rows }, () => new Uint8Array(cols));
        const dirs = [
            { dx: 0, dy: -1, side: 'N' },
            { dx: 0, dy: 1, side: 'S' },
            { dx: -1, dy: 0, side: 'W' },
            { dx: 1, dy: 0, side: 'E' }
        ];

        const isInside = (v) => v === 0 || v === 3;

        for (let y0 = 0; y0 < rows; y0++) {
            for (let x0 = 0; x0 < cols; x0++) {
                if (visited[y0][x0]) continue;
                if (!isInside(map[y0][x0])) continue;

                let side = null;
                for (const d of dirs) {
                    const nx = x0 + d.dx;
                    const ny = y0 + d.dy;
                    if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
                    if (map[ny][nx] === 2) {
                        side = d.side;
                        break;
                    }
                }
                if (!side) continue;

                const stack = [[x0, y0]];
                visited[y0][x0] = 1;
                const cells = [];
                let minX = x0, maxX = x0, minY = y0, maxY = y0;

                while (stack.length) {
                    const [x, y] = stack.pop();
                    cells.push([x, y]);
                    if (x < minX) minX = x;
                    if (x > maxX) maxX = x;
                    if (y < minY) minY = y;
                    if (y > maxY) maxY = y;

                    for (const dd of dirs) {
                        const nx = x + dd.dx;
                        const ny = y + dd.dy;
                        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
                        if (visited[ny][nx]) continue;
                        if (!isInside(map[ny][nx])) continue;

                        let s2 = null;
                        for (const d2 of dirs) {
                            const nnx = nx + d2.dx;
                            const nny = ny + d2.dy;
                            if (nnx < 0 || nny < 0 || nnx >= cols || nny >= rows) continue;
                            if (map[nny][nnx] === 2) {
                                s2 = d2.side;
                                break;
                            }
                        }
                        if (s2 !== side) continue;

                        visited[ny][nx] = 1;
                        stack.push([nx, ny]);
                    }
                }

                const wCells = maxX - minX + 1;
                const hCells = maxY - minY + 1;
                const spanCells = (side === 'N' || side === 'S') ? wCells : hCells;
                const widthM = spanCells * this.tileSize * (this.metersPerPixel || 0.05);
                if (widthM < 0.5 || widthM > 2.2) continue;

                let type = 'opening';
                if (widthM >= 0.85 && widthM <= 1.30) type = 'door';
                else if (widthM >= 1.15 && widthM <= 1.65) type = 'window';

                const opening = {
                    kind: 'exterior',
                    type,
                    side,
                    minTx: minX,
                    maxTx: maxX,
                    minTy: minY,
                    maxTy: maxY
                };
                const id = this.openings.length;
                this.openings.push(opening);
                for (const [x, y] of cells) {
                    this.openingCellMap.set(`${x},${y}`, id);
                }
            }
        }

        const visited2 = Array.from({ length: rows }, () => new Uint8Array(cols));
        const isWall = (v) => v === 1;
        const addInteriorGroup = (cells, orient) => {
            let minX = cols, maxX = 0, minY = rows, maxY = 0;
            for (const [x, y] of cells) {
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }
            const spanCells = orient === 'V' ? (maxY - minY + 1) : (maxX - minX + 1);
            const widthM = spanCells * this.tileSize * (this.metersPerPixel || 0.05);
            if (widthM < 0.6 || widthM > 2.2) return;
            let type = 'opening';
            if (widthM >= 0.85 && widthM <= 1.30) type = 'door';
            const opening = {
                kind: 'interior',
                type,
                orientation: orient,
                minTx: minX,
                maxTx: maxX,
                minTy: minY,
                maxTy: maxY
            };
            const id = this.openings.length;
            this.openings.push(opening);
            for (const [x, y] of cells) {
                this.openingCellMap.set(`${x},${y}`, id);
            }
        };

        for (let y0 = 1; y0 < rows - 1; y0++) {
            for (let x0 = 1; x0 < cols - 1; x0++) {
                if (visited2[y0][x0]) continue;
                if (!isInside(map[y0][x0])) continue;

                const vL = map[y0][x0 - 1];
                const vR = map[y0][x0 + 1];
                const vU = map[y0 - 1][x0];
                const vD = map[y0 + 1][x0];

                let orient = null;
                if (isWall(vL) && isWall(vR) && isInside(vU) && isInside(vD)) orient = 'V';
                else if (isWall(vU) && isWall(vD) && isInside(vL) && isInside(vR)) orient = 'H';
                if (!orient) continue;

                const stack = [[x0, y0]];
                visited2[y0][x0] = 1;
                const cells = [];
                while (stack.length) {
                    const [x, y] = stack.pop();
                    cells.push([x, y]);
                    for (const dd of dirs) {
                        const nx = x + dd.dx;
                        const ny = y + dd.dy;
                        if (nx <= 0 || ny <= 0 || nx >= cols - 1 || ny >= rows - 1) continue;
                        if (visited2[ny][nx]) continue;
                        if (!isInside(map[ny][nx])) continue;

                        const l = map[ny][nx - 1];
                        const r = map[ny][nx + 1];
                        const u = map[ny - 1][nx];
                        const d = map[ny + 1][nx];
                        const ok = orient === 'V'
                            ? (isWall(l) && isWall(r) && isInside(u) && isInside(d))
                            : (isWall(u) && isWall(d) && isInside(l) && isInside(r));
                        if (!ok) continue;
                        visited2[ny][nx] = 1;
                        stack.push([nx, ny]);
                    }
                }
                if (cells.length) addInteriorGroup(cells, orient);
            }
        }
    }

    filterWallsOnly() {
        if (!this.collisionMap) return;
        const rows = this.collisionMap.length;
        const cols = this.collisionMap[0].length;

        const before = this.collisionMap.map((r) => r.slice());
        let wallBefore = 0;
        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
                if (before[y][x] === 1) wallBefore++;
            }
        }
        if (wallBefore === 0) return;

        const visited = Array.from({ length: rows }, () => new Uint8Array(cols));
        const keep = Array.from({ length: rows }, () => new Uint8Array(cols));
        const dirs = [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1]
        ];

        const minAreaKeep = 10;
        const minLengthKeep = 4;
        const minThicknessKeep = 2;
        const minAspectKeep = 1.6;

        for (let y0 = 0; y0 < rows; y0++) {
            for (let x0 = 0; x0 < cols; x0++) {
                if (this.collisionMap[y0][x0] !== 1) continue;
                if (visited[y0][x0]) continue;

                const stack = [[x0, y0]];
                visited[y0][x0] = 1;
                const cells = [];
                let minX = x0, maxX = x0, minY = y0, maxY = y0;
                let touchesOutside = false;

                while (stack.length) {
                    const [x, y] = stack.pop();
                    cells.push([x, y]);
                    if (x < minX) minX = x;
                    if (x > maxX) maxX = x;
                    if (y < minY) minY = y;
                    if (y > maxY) maxY = y;

                    for (const [dx, dy] of dirs) {
                        const nx = x + dx;
                        const ny = y + dy;
                        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) {
                            touchesOutside = true;
                            continue;
                        }
                        const v = this.collisionMap[ny][nx];
                        if (v === 2) touchesOutside = true;
                        if (v !== 1) continue;
                        if (visited[ny][nx]) continue;
                        visited[ny][nx] = 1;
                        stack.push([nx, ny]);
                    }
                }

                const area = cells.length;
                const bboxW = maxX - minX + 1;
                const bboxH = maxY - minY + 1;
                const thickness = Math.min(bboxW, bboxH);
                const length = Math.max(bboxW, bboxH);
                const aspect = length / Math.max(1, thickness);

                let isWall = false;
                if (touchesOutside) isWall = true;
                else if (area >= minAreaKeep) isWall = true;
                else if (length >= minLengthKeep && thickness >= minThicknessKeep && aspect >= minAspectKeep) isWall = true;

                if (area <= 1) isWall = false;

                if (isWall) {
                    for (const [x, y] of cells) keep[y][x] = 1;
                }
            }
        }

        let wallAfter = 0;
        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
                if (this.collisionMap[y][x] === 1 && !keep[y][x]) {
                    this.collisionMap[y][x] = 0;
                }
                if (this.collisionMap[y][x] === 1) wallAfter++;
            }
        }

        if (wallAfter < Math.max(20, Math.floor(wallBefore * 0.25))) {
            this.collisionMap = before;
        }
    }

    async processImage(imageElement) {
        return new Promise((resolve, reject) => {
            // --- 方案 3: 如果 OpenCV 失败，启用 JS 纯 Canvas 兜底方案 ---
            if (!this.isOpenCvUsable()) {
                console.warn('OpenCV 尚未就绪，启动 JS 纯 Canvas 兜底处理流程...');
                try {
                    this.sourceScale = 1;
                    const result = this.processImagePureJS(imageElement);
                    resolve(result);
                } catch (e) {
                    reject(new Error('核心引擎和兜底方案均无法初始化，请检查网络或更换图片。'));
                }
                return;
            }

            try {
                const src = this.imreadToMat(imageElement);
                this.sourceScale = 1;
                const gray = new cv.Mat();
                cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

                // Use GaussianBlur to reduce noise
                const blurred = new cv.Mat();
                cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);

                // Thresholding to get binary image - Using Otsu's thresholding for better results
                const binary = new cv.Mat();
                cv.threshold(blurred, binary, 0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU);
                const nonZero = cv.countNonZero(binary);
                const totalPx = src.cols * src.rows;
                if (nonZero > totalPx * 0.75) {
                    cv.bitwise_not(binary, binary);
                }

                // Morphological operations to clean up
                const kSizeRaw = Math.max(3, Math.round(Math.min(src.cols, src.rows) / 260));
                const kSize = (kSizeRaw % 2 === 0) ? (kSizeRaw + 1) : kSizeRaw;
                const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(kSize, kSize));
                const opened = new cv.Mat();
                cv.morphologyEx(binary, opened, cv.MORPH_OPEN, kernel);
                const morphed = new cv.Mat();
                cv.morphologyEx(opened, morphed, cv.MORPH_CLOSE, kernel);

                // Find contours
                const contours = new cv.MatVector();
                const hierarchy = new cv.Mat();
                cv.findContours(morphed, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

                this.width = src.cols;
                this.height = src.rows;

                const imageArea = this.width * this.height;
                const borderMargin = Math.max(2, Math.round(Math.min(this.width, this.height) * 0.01));
                let bestApprox = null;
                let bestArea = 0;

                for (let i = 0; i < contours.size(); ++i) {
                    const contour = contours.get(i);
                    const peri = cv.arcLength(contour, true);
                    const epsilon = Math.max(1.0, peri * 0.0025);
                    const approx = new cv.Mat();
                    cv.approxPolyDP(contour, approx, epsilon, true);

                    const area = Math.abs(cv.contourArea(approx));
                    if (area < imageArea * 0.005) {
                        approx.delete();
                        continue;
                    }

                    let minX = this.width, minY = this.height, maxX = 0, maxY = 0;
                    for (let j = 0; j < approx.data32S.length; j += 2) {
                        const px = approx.data32S[j];
                        const py = approx.data32S[j + 1];
                        if (px < minX) minX = px;
                        if (py < minY) minY = py;
                        if (px > maxX) maxX = px;
                        if (py > maxY) maxY = py;
                    }

                    const touchesAllBorders =
                        minX <= borderMargin &&
                        minY <= borderMargin &&
                        maxX >= (this.width - 1 - borderMargin) &&
                        maxY >= (this.height - 1 - borderMargin);
                    const boxW = Math.max(1, maxX - minX);
                    const boxH = Math.max(1, maxY - minY);
                    const boxCoversAlmostAll =
                        (boxW / this.width) > 0.96 &&
                        (boxH / this.height) > 0.96;
                    if ((touchesAllBorders || boxCoversAlmostAll) && area > imageArea * 0.6) {
                        approx.delete();
                        continue;
                    }

                    if (area > bestArea) {
                        if (bestApprox) bestApprox.delete();
                        bestApprox = approx;
                        bestArea = area;
                    } else {
                        approx.delete();
                    }
                }

                this.contours = [];
                this.outerContourPoints = null;
                if (this.outerContour) {
                    this.outerContour.delete();
                    this.outerContour = null;
                }

                let outerMask = null;
                if (bestApprox && bestArea >= imageArea * 0.005) {
                    const pts = [];
                    for (let j = 0; j < bestApprox.data32S.length; j += 2) {
                        pts.push({ x: bestApprox.data32S[j], y: bestApprox.data32S[j + 1] });
                    }

                    if (pts.length >= 3) {
                        this.contours = [pts];
                        this.outerContourPoints = pts;
                        let minX = this.width, minY = this.height, maxX = 0, maxY = 0;
                        for (const p of pts) {
                            if (p.x < minX) minX = p.x;
                            if (p.y < minY) minY = p.y;
                            if (p.x > maxX) maxX = p.x;
                            if (p.y > maxY) maxY = p.y;
                        }
                        this.roomBBox = { minX, minY, maxX, maxY };
                        outerMask = new cv.Mat.zeros(this.height, this.width, cv.CV_8UC1);
                        const drawVec = new cv.MatVector();
                        drawVec.push_back(bestApprox);
                        cv.drawContours(outerMask, drawVec, 0, new cv.Scalar(255), -1);
                        drawVec.delete();
                        this.outerContour = bestApprox;
                    } else {
                        bestApprox.delete();
                    }
                } else if (bestApprox) {
                    bestApprox.delete();
                }

                // Generate collision map based on binary + clipped by outer contour mask
                this.generateCollisionMap(morphed, outerMask);
                this.filterWallsOnly();
                this.detectOpenings();
                this.buildRegions();
                this.baseTileSize = this.tileSize;
                this.baseCollisionMap = this.collisionMap ? this.collisionMap.map((r) => r.slice()) : null;

                if (outerMask) outerMask.delete();

                // Cleanup
                src.delete();
                gray.delete();
                blurred.delete();
                binary.delete();
                opened.delete();
                morphed.delete();
                contours.delete();
                hierarchy.delete();
                kernel.delete();

                resolve({
                    width: this.width,
                    height: this.height,
                    collisionMap: this.collisionMap,
                    contours: this.contours,
                    tileSize: this.tileSize
                });
            } catch (err) {
                reject(err);
            }
        });
    }

    rebuildCollisionMap(tileSizePx, edits = []) {
        if (!this.baseCollisionMap || !this.baseTileSize) return;
        const newTileSize = Math.max(6, Math.round(tileSizePx));
        const cols = Math.ceil(this.width / newTileSize);
        const rows = Math.ceil(this.height / newTileSize);
        const map = Array.from({ length: rows }, () => new Array(cols).fill(0));

        const sampleOffsets = [
            [0.5, 0.5],
            [0.25, 0.25],
            [0.75, 0.25],
            [0.25, 0.75],
            [0.75, 0.75]
        ];

        const getBaseCell = (px, py) => {
            const bx = Math.floor(px / this.baseTileSize);
            const by = Math.floor(py / this.baseTileSize);
            if (by < 0 || by >= this.baseCollisionMap.length || bx < 0 || bx >= this.baseCollisionMap[0].length) return 2;
            return this.baseCollisionMap[by][bx];
        };

        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
                let outside = false;
                let wallHits = 0;
                let blankHits = 0;
                for (const o of sampleOffsets) {
                    const px = (x + o[0]) * newTileSize;
                    const py = (y + o[1]) * newTileSize;
                    const v = getBaseCell(px, py);
                    if (v === 2) {
                        outside = true;
                        break;
                    }
                    if (v === 1) wallHits++;
                    if (v === 3) blankHits++;
                }
                if (outside) {
                    map[y][x] = 2;
                } else if (wallHits >= 2) {
                    map[y][x] = 1;
                } else if (blankHits === sampleOffsets.length) {
                    map[y][x] = 3;
                } else {
                    map[y][x] = 0;
                }
            }
        }

        if (edits && edits.length) {
            for (const ed of edits) {
                if (!ed) continue;
                const ex = ed.x;
                const ey = ed.y;
                const es = ed.size;
                const v = ed.value;
                const x0 = Math.floor(ex / newTileSize);
                const y0 = Math.floor(ey / newTileSize);
                const x1 = Math.floor((ex + es) / newTileSize);
                const y1 = Math.floor((ey + es) / newTileSize);
                for (let yy = y0; yy <= y1; yy++) {
                    if (yy < 0 || yy >= rows) continue;
                    for (let xx = x0; xx <= x1; xx++) {
                        if (xx < 0 || xx >= cols) continue;
                        if (map[yy][xx] === 2) continue;
                        const cx = (xx + 0.5) * newTileSize;
                        const cy = (yy + 0.5) * newTileSize;
                        if (cx >= ex && cx <= ex + es && cy >= ey && cy <= ey + es) {
                            map[yy][xx] = v;
                        }
                    }
                }
            }
        }

        this.tileSize = newTileSize;
        this.collisionMap = map;
    }

    isOpenCvUsable() {
        if (!window.cvReady) return false;
        if (typeof cv === 'undefined') return false;
        if (!cv || !cv.Mat || !cv.cvtColor || !cv.threshold || !cv.findContours) return false;
        if (typeof cv.imread !== 'function' && typeof cv.matFromImageData !== 'function') return false;
        return true;
    }

    imreadToMat(imageElement) {
        if (typeof cv.imread === 'function') {
            return cv.imread(imageElement);
        }

        if (typeof cv.matFromImageData !== 'function') {
            throw new Error('OpenCV 缺少 imread/matFromImageData');
        }

        const w = imageElement.naturalWidth || imageElement.width;
        const h = imageElement.naturalHeight || imageElement.height;
        if (!w || !h) {
            throw new Error('图片尺寸无效');
        }

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
            throw new Error('Canvas 初始化失败');
        }
        ctx.drawImage(imageElement, 0, 0, w, h);
        const imageData = ctx.getImageData(0, 0, w, h);
        return cv.matFromImageData(imageData);
    }

    generateCollisionMap(binaryMat, outerMask = null) {
        const cols = Math.ceil(this.width / this.tileSize);
        const rows = Math.ceil(this.height / this.tileSize);
        this.collisionMap = Array.from({ length: rows }, () => new Array(cols).fill(0));

        const isInsideOuter = (px, py) => {
            if (!outerMask) return true;
            const x = Math.min(this.width - 1, Math.max(0, px));
            const y = Math.min(this.height - 1, Math.max(0, py));
            return outerMask.ucharPtr(y, x)[0] > 0;
        };

        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
                const centerX = x * this.tileSize + Math.floor(this.tileSize / 2);
                const centerY = y * this.tileSize + Math.floor(this.tileSize / 2);
                if (!isInsideOuter(centerX, centerY)) {
                    this.collisionMap[y][x] = 2;
                    continue;
                }

                // Check a small area in the original binary map for each tile
                let wallCount = 0;
                const startX = x * this.tileSize;
                const startY = y * this.tileSize;
                
                for (let sy = 0; sy < this.tileSize; sy++) {
                    for (let sx = 0; sx < this.tileSize; sx++) {
                        const px = startX + sx;
                        const py = startY + sy;
                        if (px < this.width && py < this.height) {
                            if (binaryMat.ucharPtr(py, px)[0] > 0) {
                                wallCount++;
                            }
                        }
                    }
                }

                // If more than 20% of the tile is wall, mark it as obstacle
                if (wallCount > (this.tileSize * this.tileSize) * 0.2) {
                    this.collisionMap[y][x] = 1;
                }
            }
        }

        if (!outerMask) {
            for (let x = 0; x < cols; x++) {
                this.collisionMap[0][x] = 2;
                this.collisionMap[rows - 1][x] = 2;
            }
            for (let y = 0; y < rows; y++) {
                this.collisionMap[y][0] = 2;
                this.collisionMap[y][cols - 1] = 2;
            }
        }
    }

    isWall(worldX, worldY) {
        if (!this.collisionMap) return false;
        const x = Math.floor(worldX / this.tileSize);
        const y = Math.floor(worldY / this.tileSize);
        if (y >= 0 && y < this.collisionMap.length && x >= 0 && x < this.collisionMap[0].length) {
            const v = this.collisionMap[y][x];
            return v === 1 || v === 2;
        }
        return true; // Out of bounds is considered wall
    }

    // --- 纯 JS 兜底处理函数 (不依赖 OpenCV) ---
    processImagePureJS(imageElement) {
        const srcW = imageElement.naturalWidth || imageElement.width;
        const srcH = imageElement.naturalHeight || imageElement.height;
        if (!srcW || !srcH) {
            throw new Error('图片尺寸无效');
        }

        const maxDim = 1400;
        const scale = Math.min(1, maxDim / Math.max(srcW, srcH));
        const w = Math.max(2, Math.round(srcW * scale));
        const h = Math.max(2, Math.round(srcH * scale));

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
            throw new Error('Canvas 初始化失败');
        }

        ctx.imageSmoothingEnabled = false;
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(imageElement, 0, 0, w, h);

        const imageData = ctx.getImageData(0, 0, w, h);
        const data = imageData.data;

        this.width = w;
        this.height = h;
        this.sourceScale = scale;
        this.tileSize = Math.max(8, Math.min(18, Math.round(Math.max(w, h) / 120)));

        const cols = Math.ceil(w / this.tileSize);
        const rows = Math.ceil(h / this.tileSize);
        this.collisionMap = Array.from({ length: rows }, () => new Array(cols).fill(0));
        this.contours = [];

        const gray = new Uint8Array(w * h);
        let sampleCount = 0;
        let sampleSum = 0;
        let sampleSumSq = 0;
        let sampleMin = 255;
        let sampleMax = 0;
        for (let py = 0; py < h; py++) {
            for (let px = 0; px < w; px++) {
                const idx = (py * w + px) * 4;
                const r = data[idx];
                const g = data[idx + 1];
                const b = data[idx + 2];
                const v = (r * 0.299 + g * 0.587 + b * 0.114) | 0;
                gray[py * w + px] = v;

                if ((px % 6 === 0) && (py % 6 === 0)) {
                    sampleCount++;
                    sampleSum += v;
                    sampleSumSq += v * v;
                    if (v < sampleMin) sampleMin = v;
                    if (v > sampleMax) sampleMax = v;
                }
            }
        }

        const range = sampleMax - sampleMin;
        if (range > 20) {
            const inv = 255 / range;
            for (let i = 0; i < gray.length; i++) {
                const nv = Math.round((gray[i] - sampleMin) * inv);
                gray[i] = nv < 0 ? 0 : nv > 255 ? 255 : nv;
            }
        }

        const mean = sampleSum / Math.max(1, sampleCount);
        const variance = sampleSumSq / Math.max(1, sampleCount) - mean * mean;
        const std = Math.sqrt(Math.max(0, variance));
        const darkThreshold = Math.max(40, Math.min(200, Math.round(mean - std * 0.8)));

        const grad = new Uint16Array(w * h);
        let gradSampleCount = 0;
        let gradSampleSum = 0;
        let gradSampleSumSq = 0;
        for (let py = 1; py < h - 1; py++) {
            for (let px = 1; px < w - 1; px++) {
                const i = py * w + px;
                const a00 = gray[i - w - 1];
                const a01 = gray[i - w];
                const a02 = gray[i - w + 1];
                const a10 = gray[i - 1];
                const a12 = gray[i + 1];
                const a20 = gray[i + w - 1];
                const a21 = gray[i + w];
                const a22 = gray[i + w + 1];

                const gx = -a00 + a02 - 2 * a10 + 2 * a12 - a20 + a22;
                const gy = -a00 - 2 * a01 - a02 + a20 + 2 * a21 + a22;
                const mag = Math.min(65535, Math.abs(gx) + Math.abs(gy));
                grad[i] = mag;

                if ((px % 7 === 0) && (py % 7 === 0)) {
                    gradSampleCount++;
                    gradSampleSum += mag;
                    gradSampleSumSq += mag * mag;
                }
            }
        }

        const gMean = gradSampleSum / Math.max(1, gradSampleCount);
        const gVar = gradSampleSumSq / Math.max(1, gradSampleCount) - gMean * gMean;
        const gStd = Math.sqrt(Math.max(0, gVar));
        const edgeThreshold = Math.max(40, Math.round(gMean + gStd * 1.2));

        for (let ty = 0; ty < rows; ty++) {
            for (let tx = 0; tx < cols; tx++) {
                let darkCount = 0;
                let edgeCount = 0;
                let total = 0;

                const startX = tx * this.tileSize;
                const startY = ty * this.tileSize;
                const endX = Math.min(w, startX + this.tileSize);
                const endY = Math.min(h, startY + this.tileSize);

                for (let py = startY; py < endY; py++) {
                    for (let px = startX; px < endX; px++) {
                        total++;
                        const i = py * w + px;
                        if (gray[i] <= darkThreshold) darkCount++;
                        if (grad[i] >= edgeThreshold) edgeCount++;
                    }
                }

                const darkDensity = darkCount / Math.max(1, total);
                const edgeDensity = edgeCount / Math.max(1, total);

                if (edgeDensity > 0.02 || darkDensity > 0.06) {
                    this.collisionMap[ty][tx] = 1;
                }
            }
        }

        const computeWallRate = () => {
            let wall = 0;
            let total = 0;
            for (let y = 0; y < rows; y++) {
                for (let x = 0; x < cols; x++) {
                    total++;
                    if (this.collisionMap[y][x] === 1) wall++;
                }
            }
            return wall / Math.max(1, total);
        };

        const wallRate = computeWallRate();
        if (wallRate > 0.65 || wallRate < 0.01) {
            const edgeGate = wallRate > 0.65 ? 0.05 : 0.01;
            const darkGate = wallRate > 0.65 ? 0.12 : 0.03;
            for (let y = 0; y < rows; y++) {
                for (let x = 0; x < cols; x++) {
                    this.collisionMap[y][x] = 0;
                }
            }

            for (let ty = 0; ty < rows; ty++) {
                for (let tx = 0; tx < cols; tx++) {
                    let darkCount = 0;
                    let edgeCount = 0;
                    let total = 0;

                    const startX = tx * this.tileSize;
                    const startY = ty * this.tileSize;
                    const endX = Math.min(w, startX + this.tileSize);
                    const endY = Math.min(h, startY + this.tileSize);

                    for (let py = startY; py < endY; py++) {
                        for (let px = startX; px < endX; px++) {
                            total++;
                            const i = py * w + px;
                            if (gray[i] <= darkThreshold) darkCount++;
                            if (grad[i] >= edgeThreshold) edgeCount++;
                        }
                    }

                    const darkDensity = darkCount / Math.max(1, total);
                    const edgeDensity = edgeCount / Math.max(1, total);

                    if (edgeDensity > edgeGate || darkDensity > darkGate) {
                        this.collisionMap[ty][tx] = 1;
                    }
                }
            }
        }

        const wallRate2 = computeWallRate();
        if (wallRate2 > 0.85) {
            for (let y = 0; y < rows; y++) {
                for (let x = 0; x < cols; x++) {
                    this.collisionMap[y][x] = this.collisionMap[y][x] ? 0 : 1;
                }
            }
        }

        for (let x = 0; x < cols; x++) {
            this.collisionMap[0][x] = 2;
            this.collisionMap[rows - 1][x] = 2;
        }
        for (let y = 0; y < rows; y++) {
            this.collisionMap[y][0] = 2;
            this.collisionMap[y][cols - 1] = 2;
        }

        const smoothed = this.collisionMap.map((row) => row.slice());
        for (let y = 1; y < rows - 1; y++) {
            for (let x = 1; x < cols - 1; x++) {
                let n = 0;
                for (let oy = -1; oy <= 1; oy++) {
                    for (let ox = -1; ox <= 1; ox++) {
                        if (ox === 0 && oy === 0) continue;
                        if (this.collisionMap[y + oy][x + ox] === 1) n++;
                    }
                }
                if (this.collisionMap[y][x] === 1 && n <= 1) smoothed[y][x] = 0;
                if (this.collisionMap[y][x] === 0 && n >= 6) smoothed[y][x] = 1;
            }
        }
        this.collisionMap = smoothed;

        this.filterWallsOnly();
        this.detectOpenings();
        this.buildRegions();
        this.baseTileSize = this.tileSize;
        this.baseCollisionMap = this.collisionMap.map((r) => r.slice());

        return {
            width: this.width,
            height: this.height,
            collisionMap: this.collisionMap,
            contours: [],
            tileSize: this.tileSize,
            engine: 'js'
        };
    }
}
