class Player {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.z = 0; // Height for jumping
        this.radius = 8;
        this.angle = 0; // Rotation angle in radians
        this.walkSpeedMps = 1.2;
        this.stepLengthM = 0.7;
        this.rotSpeed = 2.2; // rad/s
        this.jumpForce = 0;
        this.gravity = 0.5;
        this.isJumping = false;
        
        this.controls = {
            forward: false,
            backward: false,
            left: false,
            right: false,
            jump: false,
            rotateLeft: false,
            rotateRight: false
        };

        this.setupEventListeners();
    }

    setupEventListeners() {
        window.addEventListener('keydown', (e) => this.handleKey(e, true));
        window.addEventListener('keyup', (e) => this.handleKey(e, false));
    }

    handleKey(e, isDown) {
        const key = e.key.toLowerCase();
        if (key === 'w') this.controls.forward = isDown;
        if (key === 's') this.controls.backward = isDown;
        if (key === 'a') this.controls.left = isDown;
        if (key === 'd') this.controls.right = isDown;
        if (key === ' ') this.controls.jump = isDown;
        if (e.key === 'ArrowLeft') this.controls.rotateLeft = isDown;
        if (e.key === 'ArrowRight') this.controls.rotateRight = isDown;
    }

    update(imageProcessor, dtSec = 1 / 60, metersPerPixel = 0.05) {
        // Handle rotation
        if (this.controls.rotateLeft) this.angle -= this.rotSpeed * dtSec;
        if (this.controls.rotateRight) this.angle += this.rotSpeed * dtSec;

        // Calculate potential movement
        let dx = 0;
        let dy = 0;

        const pxPerSec = this.walkSpeedMps / Math.max(1e-6, metersPerPixel);
        const move = pxPerSec * dtSec;

        if (this.controls.forward) {
            dx += Math.cos(this.angle) * move;
            dy += Math.sin(this.angle) * move;
        }
        if (this.controls.backward) {
            dx -= Math.cos(this.angle) * move;
            dy -= Math.sin(this.angle) * move;
        }
        
        // Strafe movement (optional, but good for experience)
        if (this.controls.left) {
            dx += Math.sin(this.angle) * move;
            dy -= Math.cos(this.angle) * move;
        }
        if (this.controls.right) {
            dx -= Math.sin(this.angle) * move;
            dy += Math.cos(this.angle) * move;
        }

        // Apply movement with collision detection
        this.moveWithCollision(dx, dy, imageProcessor);

        // Handle jump logic
        if (this.controls.jump && !this.isJumping) {
            this.jumpForce = 8;
            this.isJumping = true;
        }

        if (this.isJumping) {
            this.z += this.jumpForce;
            this.jumpForce -= this.gravity;
            if (this.z <= 0) {
                this.z = 0;
                this.isJumping = false;
                this.jumpForce = 0;
            }
        }
    }

    moveWithCollision(dx, dy, imageProcessor) {
        // Simple circle-grid collision
        const newX = this.x + dx;
        const newY = this.y + dy;

        // Check X axis
        if (!imageProcessor.isWall(newX + (dx > 0 ? this.radius : -this.radius), this.y)) {
            this.x = newX;
        }
        
        // Check Y axis
        if (!imageProcessor.isWall(this.x, newY + (dy > 0 ? this.radius : -this.radius))) {
            this.y = newY;
        }
    }

    reset(x, y) {
        this.x = x;
        this.y = y;
        this.z = 0;
        this.angle = 0;
        this.isJumping = false;
        this.jumpForce = 0;
    }
}
