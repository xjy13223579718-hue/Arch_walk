class Trajectory {
    constructor() {
        this.points = [];
        this.totalDistanceM = 0;
        this.visible = true;
        this.lastRecordTime = 0;
        this.recordInterval = 80;
        this.metersPerPixel = 0.05;
        this.minPointSpacingM = 0.15;
        this._lastX = null;
        this._lastY = null;
        this._lastPointX = null;
        this._lastPointY = null;
    }

    record(x, y) {
        const now = Date.now();
        const newPoint = { x, y, timestamp: now };
        const lastPoint = this.points.length > 0 ? this.points[this.points.length - 1] : null;
        
        if (this.points.length > 0) {
            if (lastPoint && lastPoint.break) {
                this.points.push(newPoint);
                this._lastX = x;
                this._lastY = y;
                this._lastPointX = x;
                this._lastPointY = y;
                this.lastRecordTime = now;
                return;
            }

            const prevX = this._lastX == null ? lastPoint.x : this._lastX;
            const prevY = this._lastY == null ? lastPoint.y : this._lastY;
            const distPx = Math.hypot(x - prevX, y - prevY);
            const distM = distPx * this.metersPerPixel;
            if (distM > 1e-6) {
                this.totalDistanceM += distM;
                this._lastX = x;
                this._lastY = y;
            }

            const minPointPx = Math.max(2, this.minPointSpacingM / Math.max(1e-6, this.metersPerPixel));
            const lpX = this._lastPointX == null ? lastPoint.x : this._lastPointX;
            const lpY = this._lastPointY == null ? lastPoint.y : this._lastPointY;
            const distSincePointPx = Math.hypot(x - lpX, y - lpY);
            if (now - this.lastRecordTime >= this.recordInterval && distSincePointPx >= minPointPx) {
                this.points.push(newPoint);
                this._lastPointX = x;
                this._lastPointY = y;
                this.lastRecordTime = now;
            }
        } else {
            this.points.push(newPoint);
            this._lastX = x;
            this._lastY = y;
            this._lastPointX = x;
            this._lastPointY = y;
            this.lastRecordTime = now;
        }

        // Limit points to prevent performance issues (e.g., last 5000 points)
        if (this.points.length > 5000) {
            this.points.shift();
        }
    }

    clear() {
        this.points = [];
        this.totalDistanceM = 0;
        this._lastX = null;
        this._lastY = null;
        this._lastPointX = null;
        this._lastPointY = null;
        this.lastRecordTime = 0;
    }

    teleport(x, y) {
        const now = Date.now();
        if (this.points.length > 0) {
            this.points.push({ break: true, timestamp: now });
        }
        this.points.push({ x, y, timestamp: now });
        this._lastX = x;
        this._lastY = y;
        this._lastPointX = x;
        this._lastPointY = y;
        this.lastRecordTime = now;
    }

    toggleVisibility() {
        this.visible = !this.visible;
        return this.visible;
    }

    getFormattedDistance() {
        return this.totalDistanceM.toFixed(2) + ' m';
    }
}
