/**
 * ArchWalk Modern - Main Application
 */

class App {
    constructor() {
        this.canvas = document.getElementById('main-canvas');
        this.ctx = this.canvas.getContext('2d');
        this.minimapCanvas = document.getElementById('minimap-canvas');
        this.minimapCtx = this.minimapCanvas ? this.minimapCanvas.getContext('2d') : null;
        
        this.imageProcessor = new ImageProcessor();
        this.player = new Player(0, 0);
        this.renderer2D = new Renderer2D(this.canvas);
        this.renderer3D = new Renderer3D(this.canvas);
        this.trajectory = new Trajectory();
        
        this.viewMode = '2D'; // '2D' or '3D'
        this.isLoaded = false;

        this.isPanning2D = false;
        this.panLastX = 0;
        this.panLastY = 0;

        this.showGrid = true;
        this.renderer2D.showGrid = true;

        this.placementMode = false;
        this.pendingPlayerPos = null;

        this.gridEditMode = null; // null | 'add' | 'delete'
        this.gridUndo = [];
        this.deleteSelection = null;
        this.isSelectingDelete = false;

        this.playerFloorZ = 0;

        this.metersPerPixel = 0.05;
        this.calibrated = false;
        this.calib = {
            p1: null,
            p2: null,
            img: null,
            draw: { scale: 1, offsetX: 0, offsetY: 0 },
            step: 'calibrate',
            maskTool: 'brush',
            maskSizePx: 48,
            maskOps: [],
            maskCanvas: null,
            maskCtx: null,
            drawing: null
        };
        this.isProcessingImage = false;
        this.processingSeq = 0;

        const savedCalibrated = localStorage.getItem('archwalk_calibrated');
        const savedMpp = parseFloat(localStorage.getItem('archwalk_metersPerPixel') || '');
        if (savedCalibrated === '1' && isFinite(savedMpp) && savedMpp > 0) {
            this.metersPerPixel = savedMpp;
            this.calibrated = true;
        }

        const savedShowGrid = localStorage.getItem('archwalk_showGrid');
        if (savedShowGrid === '0' || savedShowGrid === '1') {
            this.showGrid = savedShowGrid === '1';
            this.renderer2D.showGrid = this.showGrid;
        }

        this.scaleTune = parseFloat(localStorage.getItem('archwalk_scaleTune') || '1');
        if (!isFinite(this.scaleTune) || this.scaleTune < 0.8 || this.scaleTune > 1.2) {
            this.scaleTune = 1.0;
        }
        this.playerHeightM = parseFloat(localStorage.getItem('archwalk_playerHeightM') || '1.7');
        if (!isFinite(this.playerHeightM) || this.playerHeightM < 1.5 || this.playerHeightM > 2.0) {
            this.playerHeightM = 1.7;
        }

        const savedViewDistanceM = localStorage.getItem('archwalk_viewDistanceM');
        if (savedViewDistanceM == null || savedViewDistanceM === '18') {
            this.viewDistanceM = 24;
            localStorage.setItem('archwalk_viewDistanceM', '24');
        } else {
            this.viewDistanceM = parseFloat(savedViewDistanceM);
            if (!isFinite(this.viewDistanceM) || this.viewDistanceM < 6 || this.viewDistanceM > 60) {
                this.viewDistanceM = 24;
                localStorage.setItem('archwalk_viewDistanceM', '24');
            }
        }

        const savedLookOffset = localStorage.getItem('archwalk_lookOffset');
        this.lookOffset = parseFloat(savedLookOffset == null ? '0.12' : savedLookOffset);
        if (!isFinite(this.lookOffset) || this.lookOffset < -0.45 || this.lookOffset > 0.45) {
            this.lookOffset = 0.12;
        }

        const savedFovDeg = localStorage.getItem('archwalk_fovDeg');
        if (savedFovDeg == null || savedFovDeg === '60') {
            this.fovDeg = 80;
            localStorage.setItem('archwalk_fovDeg', '80');
        } else {
            this.fovDeg = parseFloat(savedFovDeg);
            if (!isFinite(this.fovDeg) || this.fovDeg < 60 || this.fovDeg > 95) {
                this.fovDeg = 80;
                localStorage.setItem('archwalk_fovDeg', '80');
            }
        }
        
        this.init();
    }

    showToast(message) {
        const toast = document.getElementById('toast');
        if (!toast) return;
        const box = toast.querySelector('div');
        if (!box) return;
        box.textContent = message;
        toast.classList.remove('hidden');
        clearTimeout(this._toastTimer);
        this._toastTimer = setTimeout(() => {
            toast.classList.add('hidden');
        }, 1800);
    }

    init() {
        this.setupEventListeners();
        this.resizeCanvas();
        this.resizeMiniMap();
        window.addEventListener('resize', () => this.resizeCanvas());
        window.addEventListener('resize', () => this.resizeMiniMap());
        this.updateEditorUI();
        
        // Start game loop
        this.loop();
    }

    setupEventListeners() {
        // Image upload
        const uploadInput = document.getElementById('upload-input');
        uploadInput.addEventListener('change', (e) => this.handleImageUpload(e));

        // View switching
        const view2DBtn = document.getElementById('view-2d');
        const view3DBtn = document.getElementById('view-3d');

        view2DBtn.addEventListener('click', () => this.setViewMode('2D'));
        view3DBtn.addEventListener('click', () => this.setViewMode('3D'));

        // Reset button
        const resetBtn = document.getElementById('reset-btn');
        resetBtn.addEventListener('click', () => this.resetScene());

        // Trajectory toggle
        const trajectoryBtn = document.getElementById('toggle-trajectory');
        const trajectoryStatus = document.getElementById('trajectory-status');
        trajectoryBtn.addEventListener('click', () => {
            const isVisible = this.trajectory.toggleVisibility();
            trajectoryStatus.textContent = isVisible ? '开启' : '关闭';
        });

        const toggleGridBtn = document.getElementById('toggle-grid');
        const gridStatus = document.getElementById('grid-status');
        if (toggleGridBtn && gridStatus) {
            gridStatus.textContent = this.showGrid ? '显示' : '隐藏';
            toggleGridBtn.addEventListener('click', () => {
                this.showGrid = !this.showGrid;
                this.renderer2D.showGrid = this.showGrid;
                gridStatus.textContent = this.showGrid ? '显示' : '隐藏';
                localStorage.setItem('archwalk_showGrid', this.showGrid ? '1' : '0');
            });
        }

        const scaleTuneSlider = document.getElementById('scale-tune-slider');
        const scaleTuneLabel = document.getElementById('scale-tune-label');
        if (scaleTuneSlider && scaleTuneLabel) {
            scaleTuneSlider.value = String(this.scaleTune);
            scaleTuneLabel.textContent = `${this.scaleTune.toFixed(2)}x`;
            scaleTuneSlider.addEventListener('input', () => {
                const v = parseFloat(scaleTuneSlider.value);
                if (!isFinite(v)) return;
                this.scaleTune = v;
                scaleTuneLabel.textContent = `${this.scaleTune.toFixed(2)}x`;
                localStorage.setItem('archwalk_scaleTune', String(this.scaleTune));
            });
        }

        const playerHeightSlider = document.getElementById('player-height-slider');
        const playerHeightLabel = document.getElementById('player-height-label');
        if (playerHeightSlider && playerHeightLabel) {
            playerHeightSlider.value = String(this.playerHeightM);
            playerHeightLabel.textContent = `${this.playerHeightM.toFixed(2)} m`;
            playerHeightSlider.addEventListener('input', () => {
                const v = parseFloat(playerHeightSlider.value);
                if (!isFinite(v)) return;
                this.playerHeightM = v;
                playerHeightLabel.textContent = `${this.playerHeightM.toFixed(2)} m`;
                localStorage.setItem('archwalk_playerHeightM', String(this.playerHeightM));
            });
        }

        const fovSlider = document.getElementById('fov-slider');
        const fovLabel = document.getElementById('fov-label');
        if (fovSlider && fovLabel) {
            fovSlider.value = String(this.fovDeg);
            fovLabel.textContent = `${Math.round(this.fovDeg)}°`;
            fovSlider.addEventListener('input', () => {
                const v = parseFloat(fovSlider.value);
                if (!isFinite(v)) return;
                this.fovDeg = v;
                fovLabel.textContent = `${Math.round(this.fovDeg)}°`;
                localStorage.setItem('archwalk_fovDeg', String(this.fovDeg));
            });
        }

        const viewDistanceSlider = document.getElementById('view-distance-slider');
        const viewDistanceLabel = document.getElementById('view-distance-label');
        if (viewDistanceSlider && viewDistanceLabel) {
            viewDistanceSlider.value = String(this.viewDistanceM);
            viewDistanceLabel.textContent = `${this.viewDistanceM.toFixed(1)} m`;
            viewDistanceSlider.addEventListener('input', () => {
                const v = parseFloat(viewDistanceSlider.value);
                if (!isFinite(v)) return;
                this.viewDistanceM = v;
                viewDistanceLabel.textContent = `${this.viewDistanceM.toFixed(1)} m`;
                localStorage.setItem('archwalk_viewDistanceM', String(this.viewDistanceM));
            });
        }

        const lookOffsetSlider = document.getElementById('look-offset-slider');
        const lookOffsetLabel = document.getElementById('look-offset-label');
        if (lookOffsetSlider && lookOffsetLabel) {
            lookOffsetSlider.value = String(this.lookOffset);
            const renderLookLabel = () => {
                const pct = Math.round(Math.abs(this.lookOffset) * 100);
                if (pct === 0) {
                    lookOffsetLabel.textContent = '0%';
                } else if (this.lookOffset > 0) {
                    lookOffsetLabel.textContent = `向下 ${pct}%`;
                } else {
                    lookOffsetLabel.textContent = `向上 ${pct}%`;
                }
            };
            renderLookLabel();
            lookOffsetSlider.addEventListener('input', () => {
                const v = parseFloat(lookOffsetSlider.value);
                if (!isFinite(v)) return;
                this.lookOffset = v;
                renderLookLabel();
                localStorage.setItem('archwalk_lookOffset', String(this.lookOffset));
            });
        }

        const placeBtn = document.getElementById('place-player-btn');
        const placeConfirmBtn = document.getElementById('place-confirm-btn');
        const placeCancelBtn = document.getElementById('place-cancel-btn');
        if (placeBtn) placeBtn.addEventListener('click', () => {
            if (this.viewMode !== '2D') {
                this.showToast('该功能仅在上帝视角可用');
                return;
            }
            if (!this.isLoaded) {
                this.showToast('请先上传建筑图片并完成识别');
                return;
            }
            this.placementMode = !this.placementMode;
            this.pendingPlayerPos = null;
            this.gridEditMode = null;
            this.deleteSelection = null;
            this.isSelectingDelete = false;
            this.updateEditorUI();
        });
        if (placeConfirmBtn) placeConfirmBtn.addEventListener('click', () => {
            if (!this.placementMode || !this.pendingPlayerPos) return;
            this.player.reset(this.pendingPlayerPos.x, this.pendingPlayerPos.y);
            this.trajectory.teleport(this.pendingPlayerPos.x, this.pendingPlayerPos.y);
            this.placementMode = false;
            this.pendingPlayerPos = null;
            this.updateEditorUI();
        });
        if (placeCancelBtn) placeCancelBtn.addEventListener('click', () => {
            if (!this.placementMode) return;
            this.placementMode = false;
            this.pendingPlayerPos = null;
            this.updateEditorUI();
        });

        const gridAddBtn = document.getElementById('grid-add-btn');
        const gridDelBtn = document.getElementById('grid-del-btn');
        const gridUndoBtn = document.getElementById('grid-undo-btn');
        const gridDoneBtn = document.getElementById('grid-done-btn');
        if (gridAddBtn) gridAddBtn.addEventListener('click', () => {
            if (this.viewMode !== '2D') {
                this.showToast('该功能仅在上帝视角可用');
                return;
            }
            if (!this.isLoaded) {
                this.showToast('请先上传建筑图片并完成识别');
                return;
            }
            this.placementMode = false;
            this.pendingPlayerPos = null;
            this.gridEditMode = 'add';
            this.deleteSelection = null;
            this.isSelectingDelete = false;
            this.updateEditorUI();
        });
        if (gridDelBtn) gridDelBtn.addEventListener('click', () => {
            if (this.viewMode !== '2D') {
                this.showToast('该功能仅在上帝视角可用');
                return;
            }
            if (!this.isLoaded) {
                this.showToast('请先上传建筑图片并完成识别');
                return;
            }
            this.placementMode = false;
            this.pendingPlayerPos = null;
            this.gridEditMode = 'delete';
            this.deleteSelection = null;
            this.isSelectingDelete = false;
            this.updateEditorUI();
        });
        if (gridUndoBtn) gridUndoBtn.addEventListener('click', () => {
            if (this.viewMode !== '2D') {
                this.showToast('该功能仅在上帝视角可用');
                return;
            }
            if (!this.isLoaded) {
                this.showToast('请先上传建筑图片并完成识别');
                return;
            }
            this.undoGridEdit();
            this.updateEditorUI();
        });
        if (gridDoneBtn) gridDoneBtn.addEventListener('click', () => {
            if (this.viewMode !== '2D') {
                this.showToast('该功能仅在上帝视角可用');
                return;
            }
            if (!this.isLoaded) {
                this.showToast('请先上传建筑图片并完成识别');
                return;
            }
            this.gridEditMode = null;
            this.deleteSelection = null;
            this.isSelectingDelete = false;
            this.showToast('编辑完成');
            this.updateEditorUI();
        });

        const calibOverlay = document.getElementById('calibration-overlay');
        const calibCanvas = document.getElementById('calib-canvas');
        const calibResetBtn = document.getElementById('calib-reset-btn');
        const calibApplyBtn = document.getElementById('calib-apply-btn');
        const calibSkipBtn = document.getElementById('calib-skip-btn');
        const calibLengthInput = document.getElementById('calib-length-input');
        const calibTitle = document.getElementById('calib-title');
        const calibPanel = document.getElementById('calib-panel');
        const stepBtn1 = document.getElementById('calib-step-1');
        const stepBtn2 = document.getElementById('calib-step-2');
        const calibActions = document.getElementById('calib-actions');
        const calibCancelBtn = document.getElementById('calib-cancel-btn');
        const maskPanel = document.getElementById('mask-panel');
        const maskToolBrush = document.getElementById('mask-tool-brush');
        const maskToolBlock = document.getElementById('mask-tool-block');
        const maskUndoBtn = document.getElementById('mask-undo-btn');
        const maskClearBtn = document.getElementById('mask-clear-btn');
        const maskSizeSlider = document.getElementById('mask-size-slider');
        const maskSizeLabel = document.getElementById('mask-size-label');
        const maskSkipBtn = document.getElementById('mask-skip-btn');
        const maskStartBtn = document.getElementById('mask-start-btn');
        const calibHint = document.getElementById('calib-hint');

        const setStepUI = () => {
            const isMask = this.calib.step === 'mask';
            if (calibTitle) calibTitle.textContent = isMask ? '图片编辑' : '真实尺寸校准';
            if (calibPanel) calibPanel.classList.toggle('hidden', isMask);
            if (maskPanel) maskPanel.classList.toggle('hidden', !isMask);
            if (maskSkipBtn) maskSkipBtn.classList.toggle('hidden', !isMask);
            if (calibActions) calibActions.classList.remove('hidden');
            if (calibHint) {
                calibHint.textContent = isMask
                    ? '2 图片编辑：可手动遮盖不需要的部分，完成后开始识别'
                    : '1 真实尺寸校准：请在图片上依次点击两点绘制参考线';
            }
            if (stepBtn1) {
                stepBtn1.style.color = isMask ? 'rgba(107, 114, 128, 0.2)' : '#6b7daa';
            }
            if (stepBtn2) {
                stepBtn2.style.color = isMask ? '#6b7daa' : 'rgba(107, 114, 128, 0.2)';
            }
        };

        if (calibCancelBtn) {
            calibCancelBtn.addEventListener('click', () => this.cancelUploadFlow());
        }

        const ensureMaskCanvas = () => {
            const img = this.calib.img;
            if (!img) return;
            if (this.calib.maskCanvas && this.calib.maskCtx) return;
            const c = document.createElement('canvas');
            c.width = img.width;
            c.height = img.height;
            const ctx = c.getContext('2d', { willReadFrequently: true });
            if (!ctx) return;
            ctx.imageSmoothingEnabled = false;
            this.calib.maskCanvas = c;
            this.calib.maskCtx = ctx;
        };

        const rebuildMaskCanvas = () => {
            ensureMaskCanvas();
            const ctx = this.calib.maskCtx;
            const c = this.calib.maskCanvas;
            if (!ctx || !c) return;
            ctx.clearRect(0, 0, c.width, c.height);
            ctx.fillStyle = '#FFFFFF';
            for (const op of this.calib.maskOps) {
                if (!op) continue;
                if (op.type === 'rect') {
                    ctx.fillRect(op.x, op.y, op.w, op.h);
                } else if (op.type === 'brush') {
                    for (const p of op.points) {
                        ctx.beginPath();
                        ctx.arc(p.x, p.y, op.r, 0, Math.PI * 2);
                        ctx.fill();
                    }
                }
            }
        };

        const setMaskTool = (tool) => {
            this.calib.maskTool = tool;
            if (maskToolBrush && maskToolBlock) {
                const a = tool === 'brush';
                maskToolBrush.classList.toggle('bg-arch-blue', a);
                maskToolBrush.classList.toggle('text-white', a);
                maskToolBrush.classList.toggle('text-arch-gray', !a);
                maskToolBlock.classList.toggle('bg-arch-blue', !a);
                maskToolBlock.classList.toggle('text-white', !a);
                maskToolBlock.classList.toggle('text-arch-gray', a);
                maskToolBrush.setAttribute('data-active', a ? 'true' : 'false');
                maskToolBlock.setAttribute('data-active', a ? 'false' : 'true');
            }
        };

        if (maskToolBrush) maskToolBrush.addEventListener('click', () => setMaskTool('brush'));
        if (maskToolBlock) maskToolBlock.addEventListener('click', () => setMaskTool('block'));

        if (maskSizeSlider && maskSizeLabel) {
            maskSizeSlider.value = String(this.calib.maskSizePx || 48);
            maskSizeLabel.textContent = `${Math.round(this.calib.maskSizePx || 48)} px`;
            maskSizeSlider.addEventListener('input', () => {
                const v = parseFloat(maskSizeSlider.value);
                if (!isFinite(v) || v <= 0) return;
                this.calib.maskSizePx = v;
                maskSizeLabel.textContent = `${Math.round(this.calib.maskSizePx)} px`;
            });
        }

        const undoMask = () => {
            if (this.calib.maskOps.length === 0) return;
            this.calib.maskOps.pop();
            rebuildMaskCanvas();
            this.renderCalibration();
        };
        const clearMask = () => {
            if (this.calib.maskOps.length === 0) return;
            this.calib.maskOps = [];
            rebuildMaskCanvas();
            this.renderCalibration();
        };
        if (maskUndoBtn) maskUndoBtn.addEventListener('click', undoMask);
        if (maskClearBtn) maskClearBtn.addEventListener('click', clearMask);
        if (maskSkipBtn) maskSkipBtn.addEventListener('click', () => {
            this.calib.maskOps = [];
            rebuildMaskCanvas();
            this.finalizeImageProcessing();
        });
        if (maskStartBtn) maskStartBtn.addEventListener('click', () => this.finalizeImageProcessing());

        const enterMaskStep = () => {
            if (!this.calibrated) {
                this.showToast('请先完成真实尺寸校准');
                return;
            }
            this.calib.step = 'mask';
            ensureMaskCanvas();
            rebuildMaskCanvas();
            setStepUI();
            this.renderCalibration();
        };

        const enterCalibrateStep = () => {
            this.calib.step = 'calibrate';
            setStepUI();
            this.renderCalibration();
            this.updateCalibrationInfo();
        };

        if (stepBtn1) stepBtn1.addEventListener('click', enterCalibrateStep);
        if (stepBtn2) stepBtn2.addEventListener('click', enterMaskStep);

        if (calibCanvas) {
            const drawBrushPoint = (x, y, r) => {
                ensureMaskCanvas();
                const ctx = this.calib.maskCtx;
                if (!ctx) return;
                ctx.fillStyle = '#FFFFFF';
                ctx.beginPath();
                ctx.arc(x, y, r, 0, Math.PI * 2);
                ctx.fill();
            };

            calibCanvas.addEventListener('pointerdown', (e) => {
                if (!calibOverlay || calibOverlay.classList.contains('hidden')) return;
                if (!this.calib.img) return;

                const rect = calibCanvas.getBoundingClientRect();
                const sx = e.clientX - rect.left;
                const sy = e.clientY - rect.top;
                const { scale, offsetX, offsetY } = this.calib.draw;
                const ix = (sx - offsetX) / scale;
                const iy = (sy - offsetY) / scale;
                if (ix < 0 || iy < 0 || ix > this.calib.img.width || iy > this.calib.img.height) return;

                if (this.calib.step === 'calibrate') {
                    if (!this.calib.p1) {
                        this.calib.p1 = { x: ix, y: iy };
                    } else if (!this.calib.p2) {
                        this.calib.p2 = { x: ix, y: iy };
                    } else {
                        this.calib.p1 = { x: ix, y: iy };
                        this.calib.p2 = null;
                    }
                    this.renderCalibration();
                    this.updateCalibrationInfo();
                    return;
                }

                if (this.calib.step !== 'mask') return;
                if (this.calib.maskTool === 'block') {
                    this.calib.drawing = { type: 'rect', startX: ix, startY: iy, curX: ix, curY: iy };
                    this.renderCalibration();
                    calibCanvas.setPointerCapture(e.pointerId);
                    return;
                }

                const size = this.calib.maskSizePx || 48;
                const op = { type: 'brush', r: size / 2, points: [{ x: ix, y: iy }] };
                this.calib.maskOps.push(op);
                this.calib.drawing = { type: 'brush', op };
                drawBrushPoint(ix, iy, op.r);
                this.renderCalibration();
                calibCanvas.setPointerCapture(e.pointerId);
            });

            calibCanvas.addEventListener('pointermove', (e) => {
                if (!calibOverlay || calibOverlay.classList.contains('hidden')) return;
                if (this.calib.step !== 'mask') return;
                if (!this.calib.drawing) return;

                const rect = calibCanvas.getBoundingClientRect();
                const sx = e.clientX - rect.left;
                const sy = e.clientY - rect.top;
                const { scale, offsetX, offsetY } = this.calib.draw;
                const ix = (sx - offsetX) / scale;
                const iy = (sy - offsetY) / scale;
                if (!isFinite(ix) || !isFinite(iy)) return;
                if (ix < 0 || iy < 0 || ix > this.calib.img.width || iy > this.calib.img.height) return;

                if (this.calib.drawing.type === 'rect') {
                    this.calib.drawing.curX = ix;
                    this.calib.drawing.curY = iy;
                    this.renderCalibration();
                    return;
                }

                if (this.calib.drawing.type !== 'brush') return;
                const op = this.calib.drawing.op;
                const last = op.points[op.points.length - 1];
                if (last && Math.hypot(ix - last.x, iy - last.y) < Math.max(1, op.r * 0.25)) return;
                op.points.push({ x: ix, y: iy });
                drawBrushPoint(ix, iy, op.r);
                this.renderCalibration();
            });

            const stopDraw = (e) => {
                if (!this.calib.drawing) return;
                if (this.calib.drawing.type === 'rect') {
                    const d = this.calib.drawing;
                    const x0 = Math.min(d.startX, d.curX);
                    const y0 = Math.min(d.startY, d.curY);
                    const x1 = Math.max(d.startX, d.curX);
                    const y1 = Math.max(d.startY, d.curY);
                    const w = x1 - x0;
                    const h = y1 - y0;
                    if (w >= 2 && h >= 2) {
                        const op = { type: 'rect', x: x0, y: y0, w, h };
                        this.calib.maskOps.push(op);
                        rebuildMaskCanvas();
                    }
                }
                this.calib.drawing = null;
                try {
                    calibCanvas.releasePointerCapture(e.pointerId);
                } catch {}
                this.renderCalibration();
            };
            calibCanvas.addEventListener('pointerup', stopDraw);
            calibCanvas.addEventListener('pointercancel', stopDraw);

            if (calibApplyBtn) {
                calibApplyBtn.addEventListener('click', () => {
                    const pxLen = this.getCalibrationPixelLength();
                    const m = parseFloat(calibLengthInput ? calibLengthInput.value : '');
                    if (!pxLen || !isFinite(pxLen) || pxLen <= 0) {
                        this.showToast('请先绘制参考线');
                        return;
                    }
                    if (!isFinite(m) || m <= 0) {
                        this.showToast('请输入参考线的实际长度（米）');
                        return;
                    }
                    this.metersPerPixel = m / pxLen;
                    this.calibrated = true;
                    this.trajectory.metersPerPixel = this.metersPerPixel;
                    this.trajectory.clear();
                    this.trajectory.teleport(this.player.x, this.player.y);
                    localStorage.setItem('archwalk_calibrated', '1');
                    localStorage.setItem('archwalk_metersPerPixel', String(this.metersPerPixel));
                    this.showToast('校准已应用（可选遮盖）');
                    enterMaskStep();
                });
            }
        }

        if (calibLengthInput) {
            calibLengthInput.addEventListener('input', () => this.updateCalibrationInfo());
        }

        if (calibResetBtn) {
            calibResetBtn.addEventListener('click', () => {
                this.calib.p1 = null;
                this.calib.p2 = null;
                this.renderCalibration();
                this.updateCalibrationInfo();
            });
        }

        if (calibSkipBtn) {
            calibSkipBtn.addEventListener('click', () => {
                this.showToast('真实尺寸校准不可跳过');
            });
        }

        // Mouse interaction for rotation in 3D (optional but good)
        this.canvas.addEventListener('mousemove', (e) => {
            if (this.viewMode === '3D' && this.isLoaded) {
                // Simplified mouse look: use relative movement to rotate player
                if (document.pointerLockElement === this.canvas) {
                    this.player.angle += e.movementX * 0.0022;
                }
            }
        });

        this.canvas.addEventListener('click', () => {
            if (this.viewMode === '3D' && this.isLoaded) {
                this.canvas.requestPointerLock();
            }
        });

        this.canvas.addEventListener('contextmenu', (e) => {
            if (this.viewMode === '2D') {
                e.preventDefault();
            }
        });

        this.canvas.addEventListener('pointerdown', (e) => {
            if (this.viewMode !== '2D' || !this.isLoaded) return;
            const isRight = e.button === 2;
            const isShiftLeft = e.button === 0 && e.shiftKey;
            if (!isRight && !isShiftLeft) return;

            this.isPanning2D = true;
            this.panLastX = e.clientX;
            this.panLastY = e.clientY;
            this.canvas.setPointerCapture(e.pointerId);
        });

        this.canvas.addEventListener('pointerdown', (e) => {
            if (this.viewMode !== '2D' || !this.isLoaded) return;
            if (e.button !== 0) return;
            if (e.shiftKey) return;
            if (this.isPanning2D) return;

            const rect = this.canvas.getBoundingClientRect();
            const sx = e.clientX - rect.left;
            const sy = e.clientY - rect.top;
            const tile = this.renderer2D.tileFromScreen(sx, sy, this.imageProcessor.tileSize);
            const { collisionMap } = this.imageProcessor;
            if (!collisionMap) return;
            if (tile.ty < 0 || tile.ty >= collisionMap.length || tile.tx < 0 || tile.tx >= collisionMap[0].length) return;

            const cell = collisionMap[tile.ty][tile.tx];

            if (this.placementMode) {
                if (cell === 0) {
                    this.pendingPlayerPos = {
                        x: tile.tx * this.imageProcessor.tileSize + this.imageProcessor.tileSize / 2,
                        y: tile.ty * this.imageProcessor.tileSize + this.imageProcessor.tileSize / 2
                    };
                    this.updateEditorUI();
                }
                return;
            }

            if (this.gridEditMode === 'add') {
                if (cell === 2) return;
                if (cell === 3) {
                    this.applyGridEdit([{ tx: tile.tx, ty: tile.ty, next: 0 }]);
                } else if (cell === 0) {
                    this.applyGridEdit([{ tx: tile.tx, ty: tile.ty, next: 1 }]);
                }
                return;
            }

            if (this.gridEditMode === 'delete') {
                if (cell === 2) return;
                this.isSelectingDelete = true;
                this.deleteSelection = {
                    startTx: tile.tx,
                    startTy: tile.ty,
                    endTx: tile.tx,
                    endTy: tile.ty
                };
            }
        });

        this.canvas.addEventListener('pointermove', (e) => {
            if (this.isPanning2D) {
                const dx = e.clientX - this.panLastX;
                const dy = e.clientY - this.panLastY;
                this.panLastX = e.clientX;
                this.panLastY = e.clientY;
                this.renderer2D.panX += dx;
                this.renderer2D.panY += dy;
                return;
            }

            if (!this.isSelectingDelete || !this.deleteSelection || this.viewMode !== '2D' || !this.isLoaded) return;
            const rect = this.canvas.getBoundingClientRect();
            const sx = e.clientX - rect.left;
            const sy = e.clientY - rect.top;
            const tile = this.renderer2D.tileFromScreen(sx, sy, this.imageProcessor.tileSize);
            this.deleteSelection.endTx = tile.tx;
            this.deleteSelection.endTy = tile.ty;
        });

        const stopPan = (e) => {
            if (!this.isPanning2D) return;
            this.isPanning2D = false;
            try {
                this.canvas.releasePointerCapture(e.pointerId);
            } catch {}
        };
        this.canvas.addEventListener('pointerup', stopPan);
        this.canvas.addEventListener('pointercancel', stopPan);

        const stopDeleteSelection = () => {
            if (!this.isSelectingDelete || !this.deleteSelection) return;
            const { collisionMap } = this.imageProcessor;
            const minTx = Math.max(0, Math.min(this.deleteSelection.startTx, this.deleteSelection.endTx));
            const maxTx = Math.min(collisionMap[0].length - 1, Math.max(this.deleteSelection.startTx, this.deleteSelection.endTx));
            const minTy = Math.max(0, Math.min(this.deleteSelection.startTy, this.deleteSelection.endTy));
            const maxTy = Math.min(collisionMap.length - 1, Math.max(this.deleteSelection.startTy, this.deleteSelection.endTy));
            const changes = [];
            for (let ty = minTy; ty <= maxTy; ty++) {
                for (let tx = minTx; tx <= maxTx; tx++) {
                    const cell = collisionMap[ty][tx];
                    if (cell === 2) continue;
                    if (cell === 1) changes.push({ tx, ty, next: 0 });
                    else if (cell === 0) changes.push({ tx, ty, next: 3 });
                }
            }
            if (changes.length) {
                this.applyGridEdit(changes);
            }
            this.isSelectingDelete = false;
            this.deleteSelection = null;
        };
        this.canvas.addEventListener('pointerup', stopDeleteSelection);
        this.canvas.addEventListener('pointercancel', stopDeleteSelection);

        // Zoom support for 2D view
        this.canvas.addEventListener('wheel', (e) => {
            if (this.viewMode === '2D' && this.isLoaded) {
                e.preventDefault();
                const delta = e.deltaY > 0 ? 0.9 : 1.1;
                this.renderer2D.zoom = Math.max(0.2, Math.min(5, this.renderer2D.zoom * delta));
            }
        }, { passive: false });
    }

    resizeCanvas() {
        const parent = this.canvas.parentElement;
        this.canvas.width = parent.clientWidth;
        this.canvas.height = parent.clientHeight;
    }

    resizeMiniMap() {
        if (!this.minimapCanvas || !this.minimapCtx) return;
        const rect = this.minimapCanvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const w = Math.max(2, Math.round(rect.width * dpr));
        const h = Math.max(2, Math.round(rect.height * dpr));
        if (this.minimapCanvas.width !== w) this.minimapCanvas.width = w;
        if (this.minimapCanvas.height !== h) this.minimapCanvas.height = h;
        this.minimapCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    async handleImageUpload(e) {
        const file = e.target.files[0];
        if (!file) return;

        const loadingOverlay = document.getElementById('loading-overlay');
        const loadingText = loadingOverlay.querySelector('p');
        const initialPlaceholder = document.getElementById('initial-placeholder');
        
        loadingOverlay.classList.remove('hidden');
        initialPlaceholder.classList.add('hidden');

        try {
            loadingText.textContent = '正在加载图片...';
            const img = await this.loadImage(file);
            this.calib.img = img;
            this.calib.p1 = null;
            this.calib.p2 = null;
            this.calib.step = 'calibrate';
            this.calib.maskTool = 'brush';
            this.calib.maskOps = [];
            this.calib.maskCanvas = null;
            this.calib.maskCtx = null;
            this.calib.drawing = null;
            const maskPanel = document.getElementById('mask-panel');
            if (maskPanel) maskPanel.classList.add('hidden');

            this.isLoaded = false;
            this.gridUndo = [];
            this.deleteSelection = null;
            this.isSelectingDelete = false;
            this.updateEditorUI();

            this.renderer2D.zoom = 1.0;
            this.renderer2D.panX = 0;
            this.renderer2D.panY = 0;
            this.scaleTune = 1.0;
            localStorage.setItem('archwalk_scaleTune', '1');
            const scaleTuneSlider = document.getElementById('scale-tune-slider');
            const scaleTuneLabel = document.getElementById('scale-tune-label');
            if (scaleTuneSlider) scaleTuneSlider.value = '1.0';
            if (scaleTuneLabel) scaleTuneLabel.textContent = '1.00x';

            this.metersPerPixel = 0.05;
            this.calibrated = false;
            this.trajectory.metersPerPixel = this.metersPerPixel;
            this.trajectory.clear();
            localStorage.setItem('archwalk_calibrated', '0');
            localStorage.setItem('archwalk_metersPerPixel', String(this.metersPerPixel));

            this.startCalibration();
            loadingOverlay.classList.add('hidden');
        } catch (err) {
            console.error('Failed to load image:', err);
            alert(err.message || '图片加载失败，请重试');
            initialPlaceholder.classList.remove('hidden');
            loadingOverlay.classList.add('hidden');
        }
    }

    loadImage(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => resolve(img);
                img.onerror = reject;
                img.src = e.target.result;
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    setViewMode(mode) {
        if (this.viewMode === mode) return;
        
        const view2DBtn = document.getElementById('view-2d');
        const view3DBtn = document.getElementById('view-3d');
        const statusView = document.getElementById('status-view');

        this.viewMode = mode;
        if (mode !== '2D') {
            this.placementMode = false;
            this.pendingPlayerPos = null;
            this.gridEditMode = null;
            this.deleteSelection = null;
            this.isSelectingDelete = false;
        }
        this.updateEditorUI();
        
        // UI updates
        if (mode === '2D') {
            view2DBtn.classList.add('bg-arch-blue', 'text-white');
            view2DBtn.classList.remove('text-arch-gray');
            view3DBtn.classList.remove('bg-arch-blue', 'text-white');
            view3DBtn.classList.add('text-arch-gray');
            view2DBtn.setAttribute('data-active', 'true');
            view3DBtn.setAttribute('data-active', 'false');
            statusView.textContent = '上帝视角 (2.5D)';
            document.exitPointerLock();
            if (this.minimapCanvas) this.minimapCanvas.classList.add('hidden');
        } else {
            view3DBtn.classList.add('bg-arch-blue', 'text-white');
            view3DBtn.classList.remove('text-arch-gray');
            view2DBtn.classList.remove('bg-arch-blue', 'text-white');
            view2DBtn.classList.add('text-arch-gray');
            view2DBtn.setAttribute('data-active', 'false');
            view3DBtn.setAttribute('data-active', 'true');
            statusView.textContent = '人视角 (3D)';
            if (this.minimapCanvas) {
                this.minimapCanvas.classList.remove('hidden');
                this.resizeMiniMap();
            }
        }

        // Add a smooth fade effect to canvas
        this.canvas.style.opacity = '0';
        setTimeout(() => {
            this.canvas.style.opacity = '1';
        }, 100);
    }

    resetScene() {
        if (!this.isLoaded) return;

        this.placementMode = false;
        this.pendingPlayerPos = null;
        this.gridEditMode = null;
        this.deleteSelection = null;
        this.isSelectingDelete = false;
        this.updateEditorUI();
        
        // Reset to first available space
        const result = this.imageProcessor;
        let startX = result.width / 2;
        let startY = result.height / 2;
        
        let found = false;
        for (let y = 0; y < result.collisionMap.length; y++) {
            for (let x = 0; x < result.collisionMap[y].length; x++) {
                if (result.collisionMap[y][x] === 0) {
                    startX = x * result.tileSize + result.tileSize / 2;
                    startY = y * result.tileSize + result.tileSize / 2;
                    found = true;
                    break;
                }
            }
            if (found) break;
        }

        this.player.reset(startX, startY);
        this.trajectory.clear();
        this.renderer2D.panX = 0;
        this.renderer2D.panY = 0;
    }

    update() {
        if (!this.isLoaded) return;

        const now = performance.now();
        const dtSec = Math.min(0.05, (now - (this._lastUpdateTime || now)) / 1000);
        this._lastUpdateTime = now;

        const calibOverlay = document.getElementById('calibration-overlay');
        const calibrating = calibOverlay && !calibOverlay.classList.contains('hidden');

        if (!this.placementMode && !calibrating) {
            this.player.update(this.imageProcessor, dtSec, this.metersPerPixel);
            this.playerFloorZ = 0;
            this.trajectory.record(this.player.x, this.player.y);
        }

        // Update status bar
        const mx = (this.player.x * this.metersPerPixel).toFixed(2);
        const my = (this.player.y * this.metersPerPixel).toFixed(2);
        document.getElementById('status-coord').textContent = `X: ${mx} m, Y: ${my} m`;
        document.getElementById('status-distance').textContent = this.trajectory.getFormattedDistance();
    }

    render() {
        if (!this.isLoaded) return;

        if (this.viewMode === '2D') {
            this.renderer2D.render(this.imageProcessor, this.player, this.trajectory, {
                pendingPlayerPos: this.pendingPlayerPos,
                deleteSelection: this.deleteSelection
            });
        } else {
            this.renderer3D.render(this.imageProcessor, this.player, {
                metersPerPixel: this.metersPerPixel,
                scaleTune: this.scaleTune,
                playerHeightM: this.playerHeightM,
                roomHeightM: 2.9,
                floorZ: 0,
                fovDeg: this.fovDeg,
                viewDistanceM: this.viewDistanceM,
                lookOffset: this.lookOffset
            });
            this.renderMiniMap();
        }
    }

    renderMiniMap() {
        if (!this.minimapCanvas || !this.minimapCtx) return;
        if (!this.imageProcessor.collisionMap) return;

        const ctx = this.minimapCtx;
        const rect = this.minimapCanvas.getBoundingClientRect();
        const w = rect.width;
        const h = rect.height;
        if (w <= 0 || h <= 0) return;

        const tileSize = this.imageProcessor.tileSize;
        const map = this.imageProcessor.collisionMap;
        const rows = map.length;
        const cols = map[0].length;

        const radiusM = 10;
        const radiusPx = radiusM / Math.max(1e-6, this.metersPerPixel);
        const scale = Math.min(w, h) / (radiusPx * 2);

        const cx = w / 2;
        const cy = h / 2;
        const worldToMini = (x, y) => ({
            x: cx + (x - this.player.x) * scale,
            y: cy + (y - this.player.y) * scale
        });

        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
        ctx.fillRect(0, 0, w, h);

        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, w, h);
        ctx.clip();

        const minX = this.player.x - radiusPx;
        const maxX = this.player.x + radiusPx;
        const minY = this.player.y - radiusPx;
        const maxY = this.player.y + radiusPx;

        const tx0 = Math.max(0, Math.floor(minX / tileSize));
        const tx1 = Math.min(cols - 1, Math.floor(maxX / tileSize));
        const ty0 = Math.max(0, Math.floor(minY / tileSize));
        const ty1 = Math.min(rows - 1, Math.floor(maxY / tileSize));

        ctx.fillStyle = 'rgba(55, 65, 81, 0.20)';
        for (let ty = ty0; ty <= ty1; ty++) {
            for (let tx = tx0; tx <= tx1; tx++) {
                if (map[ty][tx] !== 1) continue;
                const x = tx * tileSize;
                const y = ty * tileSize;
                const p = worldToMini(x, y);
                const rw = tileSize * scale;
                const rh = tileSize * scale;
                ctx.fillRect(p.x, p.y, rw, rh);
            }
        }

        const stairMask = this.imageProcessor.stairMask;
        if (stairMask) {
            ctx.fillStyle = 'rgba(107, 125, 170, 0.22)';
            for (let ty = ty0; ty <= ty1; ty++) {
                for (let tx = tx0; tx <= tx1; tx++) {
                    if (stairMask[ty][tx] !== 1) continue;
                    const x = tx * tileSize;
                    const y = ty * tileSize;
                    const p = worldToMini(x, y);
                    const rw = tileSize * scale;
                    const rh = tileSize * scale;
                    ctx.fillRect(p.x, p.y, rw, rh);
                }
            }
        }

        const points = this.trajectory.points || [];
        if (points.length > 1) {
            ctx.strokeStyle = 'rgba(107, 125, 170, 0.9)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            let started = false;
            for (let i = 0; i < points.length; i++) {
                const pt = points[i];
                if (pt.break) {
                    started = false;
                    continue;
                }
                const mp = worldToMini(pt.x, pt.y);
                if (!started) {
                    ctx.moveTo(mp.x, mp.y);
                    started = true;
                } else {
                    ctx.lineTo(mp.x, mp.y);
                }
            }
            ctx.stroke();
        }

        const center = worldToMini(this.player.x, this.player.y);
        ctx.fillStyle = 'rgba(107, 125, 170, 1)';
        ctx.beginPath();
        ctx.arc(center.x, center.y, 4, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = 'rgba(55, 65, 81, 0.5)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(center.x, center.y);
        ctx.lineTo(center.x + Math.cos(this.player.angle) * 10, center.y + Math.sin(this.player.angle) * 10);
        ctx.stroke();

        ctx.restore();
    }

    applyGridEdit(changes) {
        const { collisionMap } = this.imageProcessor;
        const action = [];
        for (const change of changes) {
            const { tx, ty, next } = change;
            if (ty < 0 || ty >= collisionMap.length || tx < 0 || tx >= collisionMap[0].length) continue;
            const prev = collisionMap[ty][tx];
            if (prev === next) continue;
            collisionMap[ty][tx] = next;
            action.push({ tx, ty, prev, next });
            if (next === 1 || next === 2) {
                this.imageProcessor.setElevationAtTile(tx, ty, 0);
                if (this.imageProcessor.stairMask && this.imageProcessor.stairMask[ty]) {
                    this.imageProcessor.stairMask[ty][tx] = 0;
                }
            }
        }
        if (action.length) {
            this.gridUndo.push(action);
            this.imageProcessor.detectOpenings();
            this.imageProcessor.buildRegions();
        }
    }

    undoGridEdit() {
        if (this.gridUndo.length === 0) return;
        const action = this.gridUndo.pop();
        const { collisionMap } = this.imageProcessor;
        for (const change of action) {
            collisionMap[change.ty][change.tx] = change.prev;
            if (change.prev === 1 || change.prev === 2) {
                this.imageProcessor.setElevationAtTile(change.tx, change.ty, 0);
                if (this.imageProcessor.stairMask && this.imageProcessor.stairMask[change.ty]) {
                    this.imageProcessor.stairMask[change.ty][change.tx] = 0;
                }
            }
        }
        this.imageProcessor.detectOpenings();
        this.imageProcessor.buildRegions();
    }

    updateEditorUI() {
        const placeBtn = document.getElementById('place-player-btn');
        const placeConfirmBtn = document.getElementById('place-confirm-btn');
        const placeCancelBtn = document.getElementById('place-cancel-btn');
        const gridAddBtn = document.getElementById('grid-add-btn');
        const gridDelBtn = document.getElementById('grid-del-btn');
        const gridUndoBtn = document.getElementById('grid-undo-btn');
        const gridDoneBtn = document.getElementById('grid-done-btn');
        if (!placeBtn || !placeConfirmBtn || !placeCancelBtn || !gridAddBtn || !gridDelBtn || !gridUndoBtn || !gridDoneBtn) return;

        const in2D = this.viewMode === '2D';
        const usable = in2D && this.isLoaded;
        const setUsableStyle = (btn, ok) => {
            btn.classList.toggle('opacity-40', !ok);
            btn.classList.toggle('cursor-not-allowed', !ok);
        };
        setUsableStyle(placeBtn, usable);
        setUsableStyle(gridAddBtn, usable);
        setUsableStyle(gridDelBtn, usable);
        setUsableStyle(gridUndoBtn, usable);
        setUsableStyle(gridDoneBtn, usable);

        if (this.placementMode) {
            placeBtn.classList.add('bg-arch-blue', 'text-white');
            placeBtn.classList.remove('bg-arch-lightGray', 'text-arch-darkGray');
            placeConfirmBtn.classList.remove('hidden');
            placeCancelBtn.classList.remove('hidden');
            placeConfirmBtn.disabled = !this.pendingPlayerPos;
            placeConfirmBtn.classList.toggle('opacity-40', !this.pendingPlayerPos);
        } else {
            placeBtn.classList.remove('bg-arch-blue', 'text-white');
            placeBtn.classList.add('bg-arch-lightGray', 'text-arch-darkGray');
            placeConfirmBtn.classList.add('hidden');
            placeCancelBtn.classList.add('hidden');
        }

        const setActive = (btn, active) => {
            btn.classList.toggle('bg-arch-blue', active);
            btn.classList.toggle('text-white', active);
            btn.classList.toggle('text-arch-gray', !active);
        };
        setActive(gridAddBtn, this.gridEditMode === 'add');
        setActive(gridDelBtn, this.gridEditMode === 'delete');
        gridUndoBtn.classList.toggle('opacity-40', this.gridUndo.length === 0);
        setActive(gridDoneBtn, this.gridEditMode === null);
    }

    startCalibration() {
        const overlay = document.getElementById('calibration-overlay');
        const canvas = document.getElementById('calib-canvas');
        if (!overlay || !canvas || !this.calib.img) return;
        this.calib.p1 = null;
        this.calib.p2 = null;
        this.calib.step = 'calibrate';
        this.calib.maskOps = [];
        this.calib.maskCanvas = null;
        this.calib.maskCtx = null;
        this.calib.drawing = null;
        const maskPanel = document.getElementById('mask-panel');
        if (maskPanel) maskPanel.classList.add('hidden');
        const skipBtn = document.getElementById('mask-skip-btn');
        if (skipBtn) skipBtn.classList.add('hidden');
        const actions = document.getElementById('calib-actions');
        if (actions) actions.classList.remove('hidden');
        const hint = document.getElementById('calib-hint');
        if (hint) hint.textContent = '请在图片上依次点击两点绘制参考线';
        const title = document.getElementById('calib-title');
        if (title) title.textContent = '真实尺寸校准';
        const panel = document.getElementById('calib-panel');
        if (panel) panel.classList.remove('hidden');
        const s1 = document.getElementById('calib-step-1');
        const s2 = document.getElementById('calib-step-2');
        if (s1 && s2) {
            s1.className = 'text-sm font-medium';
            s2.className = 'text-sm font-medium';
            s1.style.color = '#6b7daa';
            s2.style.color = 'rgba(107, 114, 128, 0.2)';
        }
        overlay.classList.remove('hidden');
        this.renderCalibration();
        this.updateCalibrationInfo();
    }

    cancelUploadFlow() {
        this.processingSeq++;
        this.isProcessingImage = false;
        this.isLoaded = false;

        const uploadInput = document.getElementById('upload-input');
        if (uploadInput) uploadInput.value = '';

        const calibOverlay = document.getElementById('calibration-overlay');
        if (calibOverlay) calibOverlay.classList.add('hidden');

        const actions = document.getElementById('calib-actions');
        if (actions) actions.classList.add('hidden');

        const loadingOverlay = document.getElementById('loading-overlay');
        if (loadingOverlay) loadingOverlay.classList.add('hidden');

        const initialPlaceholder = document.getElementById('initial-placeholder');
        if (initialPlaceholder) initialPlaceholder.classList.remove('hidden');

        this.calib.img = null;
        this.calib.p1 = null;
        this.calib.p2 = null;
        this.calib.step = 'calibrate';
        this.calib.maskOps = [];
        this.calib.maskCanvas = null;
        this.calib.maskCtx = null;
        this.calib.drawing = null;

        this.imageProcessor.collisionMap = null;
        this.imageProcessor.baseCollisionMap = null;
        this.imageProcessor.outerContour = null;
        this.imageProcessor.outerContourPoints = null;
        this.imageProcessor.roomBBox = null;
        this.imageProcessor.openings = [];
        if (this.imageProcessor.openingCellMap) this.imageProcessor.openingCellMap = new Map();
        this.imageProcessor.regionMap = null;
        this.imageProcessor.regionCount = 0;
        this.imageProcessor.regionElevations = new Map();
        this.imageProcessor.stairs = [];

        this.trajectory.clear();
        this.player.reset(0, 0);
        this.playerFloorZ = 0;

        const statusCoord = document.getElementById('status-coord');
        if (statusCoord) statusCoord.textContent = 'X: 0.00 m, Y: 0.00 m';
        const statusDist = document.getElementById('status-distance');
        if (statusDist) statusDist.textContent = '0.00 m';
        const statusRoom = document.getElementById('status-room');
        if (statusRoom) statusRoom.textContent = '-';

        this.updateEditorUI();
    }

    buildMaskedCanvas() {
        const img = this.calib.img;
        if (!img) return null;
        if (!this.calib.maskCanvas || !this.calib.maskCtx || !this.calib.maskOps || this.calib.maskOps.length === 0) {
            return img;
        }
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        if (!ctx) return img;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(img, 0, 0, img.width, img.height);
        ctx.globalAlpha = 1;
        ctx.drawImage(this.calib.maskCanvas, 0, 0);
        return c;
    }

    async finalizeImageProcessing() {
        if (this.isProcessingImage) return;
        this.isProcessingImage = true;
        const seq = ++this.processingSeq;
        const loadingOverlay = document.getElementById('loading-overlay');
        const loadingText = loadingOverlay ? loadingOverlay.querySelector('p') : null;
        const initialPlaceholder = document.getElementById('initial-placeholder');
        const calibOverlay = document.getElementById('calibration-overlay');
        if (calibOverlay) calibOverlay.classList.add('hidden');
        const actions = document.getElementById('calib-actions');
        if (actions) actions.classList.add('hidden');
        if (loadingOverlay) loadingOverlay.classList.remove('hidden');
        if (loadingText) loadingText.textContent = '正在分析建筑轮廓...';

        try {
            const mppBefore = this.metersPerPixel;
            const source = this.buildMaskedCanvas() || this.calib.img;
            this.imageProcessor.metersPerPixel = this.metersPerPixel;
            await this.imageProcessor.processImage(source);

            if (seq !== this.processingSeq) {
                if (loadingOverlay) loadingOverlay.classList.add('hidden');
                this.isProcessingImage = false;
                return;
            }

            const imgW = (this.calib.img && (this.calib.img.naturalWidth || this.calib.img.width)) || 0;
            const imgH = (this.calib.img && (this.calib.img.naturalHeight || this.calib.img.height)) || 0;
            const pW = this.imageProcessor.width || 0;
            const pH = this.imageProcessor.height || 0;
            const sW = imgW > 0 ? pW / imgW : 1;
            const sH = imgH > 0 ? pH / imgH : 1;
            const sComputed = Math.min(sW, sH);
            const sScale = this.imageProcessor.sourceScale;
            const s = (isFinite(sScale) && sScale > 0 && sScale <= 1) ? sScale : sComputed;
            if (isFinite(s) && s > 0 && s !== 1) {
                this.metersPerPixel = mppBefore / s;
                this.imageProcessor.metersPerPixel = this.metersPerPixel;
                this.imageProcessor.detectOpenings();
                this.trajectory.metersPerPixel = this.metersPerPixel;
                if (this.calibrated) {
                    localStorage.setItem('archwalk_metersPerPixel', String(this.metersPerPixel));
                }
            }

            this.isLoaded = true;
            const { collisionMap, tileSize, width, height } = this.imageProcessor;
            let startX = width / 2;
            let startY = height / 2;
            let found = false;
            for (let y = 0; y < collisionMap.length; y++) {
                for (let x = 0; x < collisionMap[y].length; x++) {
                    if (collisionMap[y][x] === 0 || collisionMap[y][x] === 3) {
                        startX = x * tileSize + tileSize / 2;
                        startY = y * tileSize + tileSize / 2;
                        found = true;
                        break;
                    }
                }
                if (found) break;
            }
            this.player.reset(startX, startY);
            this.trajectory.clear();
            this.trajectory.teleport(startX, startY);
            this.updateEditorUI();
            this.updateStatusRoom();

            if (loadingOverlay) loadingOverlay.classList.add('hidden');
            this.isProcessingImage = false;
        } catch (err) {
            console.error('Failed to process image:', err);
            alert(err.message || '图片处理失败，请重试');
            if (initialPlaceholder) initialPlaceholder.classList.remove('hidden');
            if (loadingOverlay) loadingOverlay.classList.add('hidden');
            this.isProcessingImage = false;
        }
    }

    renderCalibration() {
        const canvas = document.getElementById('calib-canvas');
        if (!canvas || !this.calib.img) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        canvas.width = Math.max(2, Math.round(rect.width * dpr));
        canvas.height = Math.max(2, Math.round(rect.height * dpr));
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        ctx.clearRect(0, 0, rect.width, rect.height);
        ctx.fillStyle = '#F9FAFB';
        ctx.fillRect(0, 0, rect.width, rect.height);

        const img = this.calib.img;
        const scale = Math.min(rect.width / img.width, rect.height / img.height);
        const drawW = img.width * scale;
        const drawH = img.height * scale;
        const offsetX = (rect.width - drawW) / 2;
        const offsetY = (rect.height - drawH) / 2;
        this.calib.draw = { scale, offsetX, offsetY };

        ctx.drawImage(img, offsetX, offsetY, drawW, drawH);

        if (this.calib.step === 'mask' && this.calib.maskCanvas) {
            ctx.save();
            ctx.globalAlpha = 1;
            ctx.drawImage(this.calib.maskCanvas, offsetX, offsetY, drawW, drawH);
            ctx.restore();
        }

        if (this.calib.step === 'mask' && this.calib.drawing && this.calib.drawing.type === 'rect') {
            const d = this.calib.drawing;
            const x0 = Math.min(d.startX, d.curX);
            const y0 = Math.min(d.startY, d.curY);
            const x1 = Math.max(d.startX, d.curX);
            const y1 = Math.max(d.startY, d.curY);
            const x = offsetX + x0 * scale;
            const y = offsetY + y0 * scale;
            const w = (x1 - x0) * scale;
            const h = (y1 - y0) * scale;
            ctx.save();
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(x, y, w, h);
            ctx.restore();
        }

        if (this.calib.step === 'calibrate') {
            const drawPoint = (p, color) => {
                ctx.fillStyle = color;
                ctx.strokeStyle = 'rgba(55, 65, 81, 0.35)';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.arc(offsetX + p.x * scale, offsetY + p.y * scale, 5, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
            };

            if (this.calib.p1) drawPoint(this.calib.p1, 'rgba(107, 125, 170, 0.95)');
            if (this.calib.p2) drawPoint(this.calib.p2, 'rgba(107, 125, 170, 0.95)');

            if (this.calib.p1 && this.calib.p2) {
                ctx.strokeStyle = 'rgba(107, 125, 170, 0.85)';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(offsetX + this.calib.p1.x * scale, offsetY + this.calib.p1.y * scale);
                ctx.lineTo(offsetX + this.calib.p2.x * scale, offsetY + this.calib.p2.y * scale);
                ctx.stroke();
            }
        }
    }

    getCalibrationPixelLength() {
        if (!this.calib.p1 || !this.calib.p2) return 0;
        const dx = this.calib.p2.x - this.calib.p1.x;
        const dy = this.calib.p2.y - this.calib.p1.y;
        return Math.sqrt(dx * dx + dy * dy);
    }

    updateCalibrationInfo() {
        const pxEl = document.getElementById('calib-px');
        const ratioEl = document.getElementById('calib-ratio');
        const input = document.getElementById('calib-length-input');
        const pxLen = this.getCalibrationPixelLength();
        if (pxEl) pxEl.textContent = pxLen ? pxLen.toFixed(1) + ' px' : '-';
        const m = parseFloat(input ? input.value : '');
        if (ratioEl) {
            if (pxLen > 0 && isFinite(m) && m > 0) {
                const mpp = m / pxLen;
                ratioEl.textContent = `${mpp.toFixed(6)} m/px`;
            } else {
                ratioEl.textContent = '-';
            }
        }
    }

    updateStatusRoom() {
        const el = document.getElementById('status-room');
        if (!el) return;
        const bbox = this.imageProcessor.roomBBox;
        if (!bbox) {
            el.textContent = '-';
            return;
        }
        const wPx = bbox.maxX - bbox.minX;
        const hPx = bbox.maxY - bbox.minY;
        const wM = (wPx * this.metersPerPixel).toFixed(2);
        const hM = (hPx * this.metersPerPixel).toFixed(2);
        el.textContent = `${wM} m × ${hM} m`;
    }

    loop() {
        const fpsCounter = document.getElementById('status-fps');
        let lastTime = performance.now();
        let frameCount = 0;

        const animate = (time) => {
            const dt = time - lastTime;
            frameCount++;

            if (dt >= 1000) {
                // Stabilize display to avoid flickering between 60/61
                const fps = Math.round(frameCount * 1000 / dt);
                fpsCounter.textContent = `FPS: ${fps}`;
                frameCount = 0;
                lastTime = time;
            }

            this.update();
            this.render();
            requestAnimationFrame(animate);
        };

        requestAnimationFrame(animate);
    }
}

// Initialize App when DOM is ready
window.addEventListener('DOMContentLoaded', () => {
    window.app = new App();
});
