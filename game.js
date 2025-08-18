// =================================================================================
// RAYTRACE - A Complete Game Implementation
// =================================================================================
window.addEventListener('DOMContentLoaded', () => {
    const game = new GameManager();
});

// =================================================================================
// Core Constants
// =================================================================================
const VIRTUAL_WIDTH = 1000;
const VIRTUAL_HEIGHT = 1000;
const MAX_BOUNCES = 25;
const TIMER_START_SECONDS = 60;

// =================================================================================
// Vector Math Class - The building block for all physics
// =================================================================================
class Vector {
    constructor(x = 0, y = 0) {
        this.x = x;
        this.y = y;
    }
    add(v) { return new Vector(this.x + v.x, this.y + v.y); }
    sub(v) { return new Vector(this.x - v.x, this.y - v.y); }
    mult(s) { return new Vector(this.x * s, this.y * s); }
    mag() { return Math.sqrt(this.x * this.x + this.y * this.y); }
    normalize() {
        const m = this.mag();
        return m === 0 ? new Vector(0, 0) : new Vector(this.x / m, this.y / m);
    }
    dot(v) { return this.x * v.x + this.y * v.y; }
    static fromAngle(angle) { return new Vector(Math.cos(angle), Math.sin(angle)); }
}

// =================================================================================
// Entity Classes
// =================================================================================
class Emitter {
    constructor(pos) { this.pos = pos; }
}
class Target {
    constructor(pos, size) { this.pos = pos; this.size = size; }
}
class Reflector {
    constructor(p1, p2) {
        this.p1 = p1;
        this.p2 = p2;
        const diff = this.p2.sub(this.p1);
        this.normal = new Vector(-diff.y, diff.x).normalize();
    }
}

// =================================================================================
// Input Handler
// =================================================================================
class InputHandler {
    constructor(canvas, gameManager) {
        this.canvas = canvas;
        this.gameManager = gameManager;
        this.touchStartPos = null;
        this.touchCurrentPos = null;
        this.isDragging = false;

        this.canvas.addEventListener('mousedown', e => this.handleStart(e.clientX, e.clientY));
        this.canvas.addEventListener('mousemove', e => this.handleMove(e.clientX, e.clientY));
        this.canvas.addEventListener('mouseup', e => this.handleEnd());
        this.canvas.addEventListener('touchstart', e => {
            e.preventDefault();
            this.handleStart(e.touches[0].clientX, e.touches[0].clientY);
        }, { passive: false });
        this.canvas.addEventListener('touchmove', e => {
            e.preventDefault();
            this.handleMove(e.touches[0].clientX, e.touches[0].clientY);
        }, { passive: false });
        this.canvas.addEventListener('touchend', e => this.handleEnd());
    }

    handleStart(x, y) {
        if (this.gameManager.state !== 'AWAITING_INPUT') return;
        this.isDragging = true;
        this.touchStartPos = this.gameManager.renderer.screenToVirtual(new Vector(x, y));
        this.touchCurrentPos = this.touchStartPos;
    }

    handleMove(x, y) {
        if (!this.isDragging) return;
        this.touchCurrentPos = this.gameManager.renderer.screenToVirtual(new Vector(x, y));
    }

    handleEnd() {
        if (!this.isDragging) return;
        this.isDragging = false;
        const aimVector = this.touchCurrentPos.sub(this.touchStartPos);
        if (aimVector.mag() > 10) { // Threshold for a valid swipe
            this.gameManager.fireBeam(aimVector.normalize());
        }
        this.touchStartPos = null;
        this.touchCurrentPos = null;
    }
}

// =================================================================================
// Physics Engine - All math, no state
// =================================================================================
class PhysicsEngine {
    static castRay(origin, dir, reflectors, target) {
        let path = [origin];
        let currentPos = origin;
        let currentDir = dir;
        let bounces = 0;
        let didHitTarget = false;

        while (bounces < MAX_BOUNCES) {
            let closestIntersection = null;
            let closestDist = Infinity;
            let closestEntity = null;

            // Check intersections with reflectors
            for (const reflector of reflectors) {
                const intersection = this.getLineIntersection(currentPos, currentDir, reflector.p1, reflector.p2);
                if (intersection) {
                    const dist = intersection.sub(currentPos).mag();
                    if (dist < closestDist && dist > 0.001) {
                        closestDist = dist;
                        closestIntersection = intersection;
                        closestEntity = reflector;
                    }
                }
            }

            // Check intersections with target (as 4 line segments)
            const p1 = target.pos;
            const p2 = new Vector(target.pos.x + target.size, target.pos.y);
            const p3 = new Vector(target.pos.x + target.size, target.pos.y + target.size);
            const p4 = new Vector(target.pos.x, target.pos.y + target.size);
            const targetSegments = [
                { p1, p2 }, { p1: p2, p2: p3 }, { p1: p3, p2: p4 }, { p1: p4, p2: p1 }
            ];

            for (const segment of targetSegments) {
                const intersection = this.getLineIntersection(currentPos, currentDir, segment.p1, segment.p2);
                if (intersection) {
                    const dist = intersection.sub(currentPos).mag();
                    if (dist < closestDist && dist > 0.001) {
                        closestDist = dist;
                        closestIntersection = intersection;
                        closestEntity = target;
                    }
                }
            }
            
            if (closestEntity) {
                path.push(closestIntersection);
                if (closestEntity instanceof Target) {
                    didHitTarget = true;
                    break;
                }
                currentPos = closestIntersection;
                const v = currentDir;
                const n = closestEntity.normal;
                // Reflection formula: R = V - 2 * dot(V, N) * N
                currentDir = v.sub(n.mult(2 * v.dot(n)));
                bounces++;
            } else {
                // No intersection, beam goes off-screen
                path.push(currentPos.add(currentDir.mult(VIRTUAL_WIDTH * 2)));
                break;
            }
        }
        return { path, didHitTarget };
    }

    static getLineIntersection(rayOrigin, rayDir, segP1, segP2) {
        const v1 = rayOrigin.sub(segP1);
        const v2 = segP2.sub(segP1);
        const v3 = new Vector(-rayDir.y, rayDir.x);

        const dot = v2.dot(v3);
        if (Math.abs(dot) < 0.000001) {
            return null; // Parallel lines
        }

        const t1 = (v2.x * v1.y - v2.y * v1.x) / dot;
        const t2 = v1.dot(v3) / dot;

        if (t1 >= 0 && (t2 >= 0 && t2 <= 1)) {
            return rayOrigin.add(rayDir.mult(t1));
        }
        return null;
    }
}

// =================================================================================
// Renderer
// =================================================================================
class Renderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.scale = 1;
        this.offsetX = 0;
        this.offsetY = 0;
        this.resize();
        window.addEventListener('resize', () => this.resize());
    }

    resize() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
        this.scale = Math.min(this.canvas.width / VIRTUAL_WIDTH, this.canvas.height / VIRTUAL_HEIGHT);
        this.offsetX = (this.canvas.width - VIRTUAL_WIDTH * this.scale) / 2;
        this.offsetY = (this.canvas.height - VIRTUAL_HEIGHT * this.scale) / 2;
    }

    screenToVirtual(screenPos) {
        return new Vector(
            (screenPos.x - this.offsetX) / this.scale,
            (screenPos.y - this.offsetY) / this.scale
        );
    }
    
    clear() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.fillStyle = '#0f0f18';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }

    draw(gameState, entities) {
        this.ctx.save();
        this.ctx.translate(this.offsetX, this.offsetY);
        this.ctx.scale(this.scale, this.scale);

        // Draw entities
        if (entities.emitter) this.drawEmitter(entities.emitter);
        if (entities.target) this.drawTarget(entities.target);
        if (entities.reflectors) entities.reflectors.forEach(r => this.drawReflector(r));

        // Draw aiming line
        if (gameState.inputHandler.isDragging) {
            this.drawAimingLine(entities.emitter.pos, gameState.inputHandler.touchCurrentPos);
        }

        // Draw beam path
        if (gameState.beamPath) {
            this.drawBeam(gameState.beamPath, gameState.beamAnimationProgress);
        }

        // Draw hit effect
        if (gameState.hitEffect.active) {
            this.drawHitEffect(gameState.hitEffect);
        }

        this.ctx.restore();
        
        // Draw UI on top, not scaled
        this.drawHUD(gameState);

        // Draw overlays
        if (gameState.state === 'PRE_GAME') this.drawMainMenu(gameState);
        if (gameState.state === 'GAME_OVER') this.drawGameOver(gameState);
        if (gameState.state === 'LEVEL_STARTING' || gameState.state === 'ROUND_COMPLETE') {
            this.drawTransition(gameState.transitionAlpha);
        }
    }

    drawEmitter(emitter) {
        this.ctx.beginPath();
        this.ctx.arc(emitter.pos.x, emitter.pos.y, 20, 0, Math.PI * 2);
        this.ctx.fillStyle = '#ffffff';
        this.ctx.fill();
    }

    drawTarget(target) {
        this.ctx.fillStyle = '#ff4757';
        this.ctx.fillRect(target.pos.x, target.pos.y, target.size, target.size);
    }

    drawReflector(reflector) {
        this.ctx.beginPath();
        this.ctx.moveTo(reflector.p1.x, reflector.p1.y);
        this.ctx.lineTo(reflector.p2.x, reflector.p2.y);
        this.ctx.strokeStyle = '#74b9ff';
        this.ctx.lineWidth = 8;
        this.ctx.stroke();
    }
    
    drawAimingLine(startPos, endPos) {
        this.ctx.beginPath();
        this.ctx.moveTo(startPos.x, startPos.y);
        this.ctx.lineTo(endPos.x, endPos.y);
        this.ctx.setLineDash([10, 10]);
        this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        this.ctx.lineWidth = 3;
        this.ctx.stroke();
        this.ctx.setLineDash([]);
    }

    drawBeam(path, progress) {
        if (path.length < 2) return;

        const totalLength = path.slice(1).reduce((acc, p, i) => acc + p.sub(path[i]).mag(), 0);
        const drawnLength = totalLength * progress;
        
        this.ctx.beginPath();
        this.ctx.moveTo(path[0].x, path[0].y);
        
        let lengthSoFar = 0;
        for (let i = 1; i < path.length; i++) {
            const segment = path[i].sub(path[i-1]);
            const segmentLength = segment.mag();
            if (lengthSoFar + segmentLength > drawnLength) {
                const remainingLength = drawnLength - lengthSoFar;
                const endPoint = path[i-1].add(segment.normalize().mult(remainingLength));
                this.ctx.lineTo(endPoint.x, endPoint.y);
                break;
            } else {
                this.ctx.lineTo(path[i].x, path[i].y);
                lengthSoFar += segmentLength;
            }
        }
        
        this.ctx.strokeStyle = '#feca57';
        this.ctx.lineWidth = 5;
        this.ctx.lineCap = 'round';
        this.ctx.shadowColor = '#feca57';
        this.ctx.shadowBlur = 15;
        this.ctx.stroke();
        this.ctx.shadowBlur = 0;
    }
    
    drawHitEffect(effect) {
        this.ctx.beginPath();
        this.ctx.arc(effect.pos.x, effect.pos.y, effect.radius, 0, Math.PI * 2);
        this.ctx.fillStyle = `rgba(255, 255, 255, ${effect.alpha})`;
        this.ctx.fill();
    }

    drawHUD(gameState) {
        this.ctx.fillStyle = 'white';
        this.ctx.font = '24px sans-serif';
        this.ctx.textAlign = 'left';
        this.ctx.fillText(`Score: ${gameState.score}`, 20, 40);
        this.ctx.textAlign = 'center';
        this.ctx.fillText(`Round: ${gameState.level}`, this.canvas.width / 2, 40);
        this.ctx.textAlign = 'right';
        this.ctx.fillStyle = gameState.timer < 10 ? '#ff4757' : 'white';
        this.ctx.fillText(`Time: ${Math.ceil(gameState.timer)}`, this.canvas.width - 20, 40);
    }
    
    drawMainMenu(gameState) {
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.fillStyle = 'white';
        this.ctx.textAlign = 'center';
        this.ctx.font = '60px sans-serif';
        this.ctx.fillText('RayTrace', this.canvas.width / 2, this.canvas.height / 2 - 100);
        this.ctx.font = '24px sans-serif';
        this.ctx.fillText('Swipe to aim. Hit the red square.', this.canvas.width / 2, this.canvas.height / 2);
        this.ctx.fillText('Tap or Click to Start', this.canvas.width / 2, this.canvas.height / 2 + 50);
        this.ctx.font = '20px sans-serif';
        this.ctx.fillText(`High Score: ${gameState.highScore}`, this.canvas.width / 2, this.canvas.height / 2 + 150);
    }
    
    drawGameOver(gameState) {
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.fillStyle = 'white';
        this.ctx.textAlign = 'center';
        this.ctx.font = '60px sans-serif';
        this.ctx.fillText('Game Over', this.canvas.width / 2, this.canvas.height / 2 - 100);
        this.ctx.font = '30px sans-serif';
        this.ctx.fillText(`Final Score: ${gameState.score}`, this.canvas.width / 2, this.canvas.height / 2);
        if (gameState.isNewHighScore) {
            this.ctx.fillStyle = '#feca57';
            this.ctx.fillText('New High Score!', this.canvas.width / 2, this.canvas.height / 2 + 50);
        }
        this.ctx.fillStyle = 'white';
        this.ctx.font = '20px sans-serif';
        this.ctx.fillText('Tap or Click to Play Again', this.canvas.width / 2, this.canvas.height / 2 + 120);
    }

    drawTransition(alpha) {
        this.ctx.fillStyle = `rgba(0, 0, 0, ${alpha})`;
        this.ctx.fillRect(0, 0, VIRTUAL_WIDTH, VIRTUAL_HEIGHT);
    }
}

// =================================================================================
// Level Generator
// =================================================================================
class LevelGenerator {
    static generate(levelNumber) {
        while (true) {
            const numReflections = Math.floor(levelNumber / 3) + 1;
            const numNoiseReflectors = Math.floor(levelNumber / 2);
            
            const emitter = new Emitter(new Vector(
                this.random(100, VIRTUAL_WIDTH - 100), 
                this.random(VIRTUAL_HEIGHT - 150, VIRTUAL_HEIGHT - 100)
            ));
            const target = new Target(
                new Vector(this.random(100, VIRTUAL_WIDTH - 100), this.random(100, 200)),
                Math.max(20, 60 - levelNumber)
            );

            let reflectors = [];
            let solutionPath = [];

            // Reverse path generation
            let currentPos = target.pos.add(new Vector(target.size / 2, target.size / 2));
            let incomingDir = emitter.pos.sub(currentPos).normalize();
            
            for (let i = 0; i < numReflections; i++) {
                const dist = this.random(150, 400);
                const reflectionPoint = currentPos.add(incomingDir.mult(dist));
                
                let outgoingDir = Vector.fromAngle(Math.random() * Math.PI * 2);
                if (i === numReflections - 1) { // Final bounce must aim towards emitter
                    outgoingDir = emitter.pos.sub(reflectionPoint).normalize();
                }

                const normal = outgoingDir.sub(incomingDir).normalize();
                const reflectorDir = new Vector(-normal.y, normal.x);
                const reflectorLength = this.random(100, 200);
                
                const p1 = reflectionPoint.sub(reflectorDir.mult(reflectorLength / 2));
                const p2 = reflectionPoint.add(reflectorDir.mult(reflectorLength / 2));
                reflectors.push(new Reflector(p1, p2));
                
                currentPos = reflectionPoint;
                incomingDir = outgoingDir;
            }
            solutionPath.push(emitter.pos);
            solutionPath.push(currentPos);
            
            // Add noise reflectors
            for (let i = 0; i < numNoiseReflectors; i++) {
                reflectors.push(new Reflector(
                    new Vector(this.random(50, VIRTUAL_WIDTH-50), this.random(50, VIRTUAL_HEIGHT-50)),
                    new Vector(this.random(50, VIRTUAL_WIDTH-50), this.random(50, VIRTUAL_HEIGHT-50))
                ));
            }
            
            // Verify solvability
            const solutionAim = solutionPath[1].sub(solutionPath[0]).normalize();
            const result = PhysicsEngine.castRay(emitter.pos, solutionAim, reflectors, target);
            if (result.didHitTarget) {
                return { emitter, target, reflectors };
            }
            // If not solvable, the loop continues and regenerates
        }
    }
    static random(min, max) { return Math.random() * (max - min) + min; }
}

// =================================================================================
// Game Manager - The Brain
// =================================================================================
class GameManager {
    constructor() {
        this.canvas = document.getElementById('gameCanvas');
        this.renderer = new Renderer(this.canvas);
        this.inputHandler = new InputHandler(this.canvas, this);
        this.state = 'PRE_GAME';
        this.lastTime = 0;
        
        this.highScore = parseInt(localStorage.getItem('raytrace_highscore') || '0');
        this.isNewHighScore = false;
        
        this.resetGame();

        window.addEventListener('visibilitychange', () => {
            if (document.hidden) this.pause(); else this.resume();
        });
        this.canvas.addEventListener('click', () => {
             if (this.state === 'PRE_GAME' || this.state === 'GAME_OVER') {
                this.startGame();
            }
        });

        requestAnimationFrame(this.gameLoop.bind(this));
    }
    
    resetGame() {
        this.level = 1;
        this.score = 0;
        this.timer = TIMER_START_SECONDS;
        this.isNewHighScore = false;
        
        this.emitter = null;
        this.target = null;
        this.reflectors = [];
        
        this.beamPath = null;
        this.beamAnimationProgress = 0;
        this.beamDidHit = false;

        this.transitionAlpha = 1.0;
        
        this.hitEffect = { active: false, pos: new Vector(), radius: 0, alpha: 1 };
    }

    startGame() {
        this.resetGame();
        this.state = 'LEVEL_STARTING';
    }

    nextLevel() {
        this.level++;
        this.timer = TIMER_START_SECONDS;
        this.state = 'LEVEL_STARTING';
        this.beamPath = null;
    }

    fireBeam(dir) {
        if (this.state !== 'AWAITING_INPUT') return;
        const result = PhysicsEngine.castRay(this.emitter.pos, dir, this.reflectors, this.target);
        this.beamPath        if (hitTarget && (!intersection || hitTarget.dist < intersection.dist)) {
            beamPath.push(hitTarget.point);
            console.log("HIT!");
            // In a real game, you'd trigger a success state here
            return;
        }

        if (intersection) {
            beamPath.push(intersection.point);
            
            // Calculate reflection
            const segmentVec = { x: reflector.x2 - reflector.x1, y: reflector.y2 - reflector.y1 };
            // The normal is perpendicular to the segment
            let normal = { x: -segmentVec.y, y: segmentVec.x };
            // Normalize the normal
            const len = Math.sqrt(normal.x * normal.x + normal.y * normal.y);
            normal.x /= len;
            normal.y /= len;

            const dot = 2 * (currentDir.x * normal.x + currentDir.y * normal.y);
            
            currentDir = {
                x: currentDir.x - dot * normal.x,
                y: currentDir.y - dot * normal.y
            };
            currentPos = intersection.point;
        } else {
            // No intersection, beam goes off-screen
            beamPath.push({
                x: currentPos.x + currentDir.x * 2000,
                y: currentPos.y + currentDir.y * 2000
            });
            return;
        }
    }
}

// Ray-Segment Intersection function
function getIntersection(rayOrigin, rayDir, segment) {
    const v1 = { x: rayOrigin.x - segment.x1, y: rayOrigin.y - segment.y1 };
    const v2 = { x: segment.x2 - segment.x1, y: segment.y2 - segment.y1 };
    const v3 = { x: -rayDir.y, y: rayDir.x };

    const dot = v2.x * v3.x + v2.y * v3.y;
    if (Math.abs(dot) < 0.000001) return null; // Parallel lines

    const t1 = (v2.x * v1.y - v2.y * v1.x) / dot;
    const t2 = (v1.x * v3.x + v1.y * v3.y) / dot;

    if (t1 >= 0 && (t2 >= 0 && t2 <= 1)) {
        return {
            point: { x: rayOrigin.x + t1 * rayDir.x, y: rayOrigin.y + t1 * rayDir.y },
            dist: t1
        };
    }
    return null;
}

// Check for hit on target
function checkTargetHit(rayOrigin, rayDir, rect) {
    const lines = [
        { x1: rect.x, y1: rect.y, x2: rect.x + rect.width, y2: rect.y },
        { x1: rect.x + rect.width, y1: rect.y, x2: rect.x + rect.width, y2: rect.y + rect.height },
        { x1: rect.x + rect.width, y1: rect.y + rect.height, x2: rect.x, y2: rect.y + rect.height },
        { x1: rect.x, y1: rect.y + rect.height, x2: rect.x, y2: rect.y }
    ];
    let closestHit = null;
    for (const line of lines) {
        const hit = getIntersection(rayOrigin, rayDir, line);
        if (hit && (!closestHit || hit.dist < closestHit.dist)) {
            closestHit = hit;
        }
    }
    return closestHit;
}


// --- 5. RENDERER ---
function gameLoop() {
    // Clear the canvas with a dark gradient
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, '#1c2541');
    gradient.addColorStop(1, '#0b132b');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw emitter
    ctx.fillStyle = '#6fffe9';
    ctx.beginPath();
    ctx.arc(emitter.x, emitter.y, emitter.radius, 0, Math.PI * 2);
    ctx.fill();

    // Draw target
    ctx.fillStyle = '#ff4d6d';
    ctx.fillRect(target.x, target.y, target.width, target.height);

    // Draw reflector
    ctx.strokeStyle = '#80ffdb';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(reflector.x1, reflector.y1);
    ctx.lineTo(reflector.x2, reflector.y2);
    ctx.stroke();

    // Draw beam path
    if (beamPath.length > 1) {
        ctx.strokeStyle = '#fca311';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(beamPath[0].x, beamPath[0].y);
        for (let i = 1; i < beamPath.length; i++) {
            ctx.lineTo(beamPath[i].x, beamPath[i].y);
        }
        ctx.stroke();
    }

    // Keep the loop going
    requestAnimationFrame(gameLoop);
}

// Start the game loop
gameLoop();
