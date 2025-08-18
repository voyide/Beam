// --- 1. SETUP ---
// Get the canvas and its context
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// Function to set canvas size
function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}
// Initial resize and listen for future window resize events
window.addEventListener('resize', resizeCanvas);
resizeCanvas();


// --- 2. GAME ENTITIES (Hard-coded for this milestone) ---
// Emitter: where the beam starts
const emitter = { x: canvas.width / 2, y: canvas.height - 50, radius: 15 };

// Target: the goal
const target = { x: canvas.width / 2 - 50, y: 100, width: 100, height: 20 };

// Reflector: a simple line segment
const reflector = { x1: 100, y1: canvas.height / 2, x2: canvas.width - 100, y2: canvas.height / 2 + 50 };


// --- 3. GAME STATE & INPUT HANDLING ---
let isAiming = false;
let startPos = { x: 0, y: 0 };
let beamPath = []; // An array to store the points of the beam's path

// Listen for touch/mouse input
canvas.addEventListener('mousedown', startAim);
canvas.addEventListener('touchstart', (e) => startAim(e.touches[0]));

canvas.addEventListener('mouseup', fireBeam);
canvas.addEventListener('touchend', (e) => fireBeam(e.changedTouches[0]));

function startAim(event) {
    isAiming = true;
    startPos = { x: event.clientX, y: event.clientY };
}

function fireBeam(event) {
    if (!isAiming) return;
    isAiming = false;
    
    const endPos = { x: event.clientX, y: event.clientY };
    
    // Calculate direction vector
    let dirX = endPos.x - emitter.x;
    let dirY = endPos.y - emitter.y;
    
    // Normalize the vector (make its length 1)
    const length = Math.sqrt(dirX * dirX + dirY * dirY);
    dirX /= length;
    dirY /= length;

    // Calculate the path
    calculateBeamPath({ x: emitter.x, y: emitter.y }, { x: dirX, y: dirY });
}


// --- 4. PHYSICS ENGINE (Simplified) ---
function calculateBeamPath(origin, direction) {
    beamPath = [origin];
    const MAX_BOUNCES = 5; // Safety limit

    let currentPos = origin;
    let currentDir = direction;

    for (let i = 0; i < MAX_BOUNCES; i++) {
        // Find the nearest intersection with all objects (here, just one reflector and the target)
        let intersection = getIntersection(currentPos, currentDir, reflector);
        let hitTarget = checkTargetHit(currentPos, currentDir, target);

        if (hitTarget && (!intersection || hitTarget.dist < intersection.dist)) {
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
