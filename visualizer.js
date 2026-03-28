const audioElement = document.getElementById('audio-element');
const playBtn = document.getElementById('play-btn');
const uiContainer = document.getElementById('ui-container');
const canvas = document.getElementById('visualizer-canvas');
const ctx = canvas.getContext('2d');

let audioCtx, analyser, source, dataArray;
let isPlaying = false;

// Visualizer State
let time = 0;
let bassHistory = [];
let splatters = [];
let rings = [];

const COLORS = [
    '#ff3b3b', '#ff993b', '#ffd13b', '#3bff5b', '#3bd6ff', '#8d3bff', '#ff3bee', '#ffffff'
];

function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

playBtn.addEventListener('click', () => {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.8;
        const bufferLength = analyser.frequencyBinCount;
        dataArray = new Uint8Array(bufferLength);
        
        source = audioCtx.createMediaElementSource(audioElement);
        source.connect(analyser);
        analyser.connect(audioCtx.destination);
    }
    
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }

    if (isPlaying) {
        audioElement.pause();
        playBtn.innerText = 'Play / Pause';
        uiContainer.style.opacity = '1';
    } else {
        audioElement.play();
        playBtn.innerText = 'Pause Visualizer';
        uiContainer.style.opacity = '0';
        requestAnimationFrame(renderLoop);
    }
    
    isPlaying = !isPlaying;
});

// Helper: detect beats
function detectBeat(bassValue) {
    bassHistory.push(bassValue);
    if (bassHistory.length > 30) bassHistory.shift();
    
    let avg = bassHistory.reduce((a, b) => a + b, 0) / bassHistory.length;
    // Lowered threshold slightly to trigger more often
    if (bassValue > avg * 1.2 && bassValue > 130) {
        return true;
    }
    return false;
}

// Calculate the bending curve based on depth
function getBendOffset(depth) {
    // Math.log(depth) creates a smooth perspective curve
    // It makes the curve tighten the further away it is
    let curveTime = time * 0.5 + (Math.log(Math.max(0.001, depth)) * 2);
    
    // Scale curve amplitude by depth so it's subtle near camera and extreme far away
    let bendAmp = Math.min(600, 300 / depth); 
    
    return {
        ox: Math.sin(curveTime * 0.8) * bendAmp * depth,
        oy: Math.cos(curveTime * 0.5) * bendAmp * depth,
    };
}

// Splatter class for paint hitting the wall
class Splatter {
    constructor() {
        this.angle = Math.random() * Math.PI * 2;
        this.depth = 0.01; 
        this.size = Math.random() * 8 + 5; // Slightly larger base size
        this.color = COLORS[Math.floor(Math.random() * COLORS.length)];
        
        // Offset from the exact center of the ring
        this.offsetX = (Math.random() - 0.5) * 60;
        this.offsetY = (Math.random() - 0.5) * 60;

        // Drip simulation
        this.dripLength = 0;
        // Make gravity more intense for dynamic effect
        this.dripSpeed = Math.random() * 4 + 2;

        this.drops = [];
        let numDrops = Math.floor(Math.random() * 6) + 3;
        for (let i = 0; i < numDrops; i++) {
            this.drops.push({
                dx: (Math.random() - 0.5) * 25,
                dy: (Math.random() - 0.5) * 25,
                ds: Math.random() * 0.8 + 0.3
            });
        }
    }

    update(speed, globalRotation) {
        this.depth *= speed;
        this.dripLength += this.dripSpeed * (this.depth * 0.08);
        return this.depth > 7; // Give it more time to clear camera
    }

    draw(ctx, cx, cy, globalRotation) {
        let radius = this.depth * Math.min(canvas.width, canvas.height); 
        let finalAngle = this.angle + globalRotation;
        
        // Add tunnel bending offsets
        let bend = getBendOffset(this.depth);

        let x = cx + bend.ox + Math.cos(finalAngle) * radius + (this.offsetX * this.depth * 10);
        let y = cy + bend.oy + Math.sin(finalAngle) * radius + (this.offsetY * this.depth * 10);
        let s = this.size * this.depth * 6;

        ctx.fillStyle = this.color;
        
        this.drops.forEach(drop => {
            let px = x + drop.dx * this.depth * 10;
            let py = y + drop.dy * this.depth * 10;
            let pSize = s * drop.ds;

            ctx.beginPath();
            ctx.arc(px, py, pSize, 0, Math.PI * 2);
            ctx.fill();

            if (drop.ds > 0.5) { 
                ctx.beginPath();
                ctx.moveTo(px - pSize/2, py);
                // Drip bends straight down regardless of rotation (simulating gravity)
                ctx.quadraticCurveTo(px, py + pSize + (this.dripLength * drop.ds), px + pSize/2, py);
                ctx.fill();
            }
        });
    }
}

// Tunnel Ring class
class TunnelRing {
    constructor(isBeat) {
        this.depth = 0.01; 
        this.isBeat = isBeat;
        this.vertices = 14; 
    }

    update(speed) {
        this.depth *= speed;
        return this.depth > 7;
    }

    draw(ctx, cx, cy, globalRotation, intensity) {
        let radius = this.depth * Math.min(canvas.width, canvas.height);
        let bend = getBendOffset(this.depth);

        ctx.beginPath();
        for (let i = 0; i < this.vertices; i++) {
            let angle = (i / this.vertices) * Math.PI * 2 + globalRotation;
            let x = cx + bend.ox + Math.cos(angle) * radius;
            let y = cy + bend.oy + Math.sin(angle) * radius;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.closePath();

        let alpha = Math.min(1, this.depth * 5) * Math.max(0, 1 - (this.depth * 0.12));
        
        ctx.strokeStyle = this.isBeat 
            ? `rgba(255, 255, 255, ${alpha})` 
            : `rgba(130, 130, 180, ${alpha * 0.3 * intensity})`;
        
        ctx.lineWidth = this.isBeat ? this.depth * 6 : this.depth * 1.5;
        ctx.stroke();
    }
}

let lastBeatTime = 0;
let globalRotation = 0;

function renderLoop() {
    if (!isPlaying) return;
    requestAnimationFrame(renderLoop);
    
    // Smooth motion blur background
    ctx.fillStyle = 'rgba(5, 5, 10, 0.4)'; 
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    analyser.getByteFrequencyData(dataArray);
    
    // Calculate Bass and Mid range
    let bass = 0;
    for (let i = 0; i < 5; i++) bass += dataArray[i];
    bass /= 5;

    let mid = 0;
    for (let i = 10; i < 30; i++) mid += dataArray[i];
    mid /= 20;

    let intensity = mid / 255;
    let isBeat = detectBeat(bass);
    
    time += 0.01 + (intensity * 0.015);
    // Tunnel rotates continually
    globalRotation += 0.003 + (intensity * 0.005);
    
    let cx = canvas.width / 2;
    let cy = canvas.height / 2;

    // Constantly spawn Tunnel Rings for dense wall feel
    if (Math.random() < 0.4 + (intensity * 0.4)) {
        rings.push(new TunnelRing(isBeat));
    }

    // Spawn Splatters
    // If it's a beat and a slight cooldown has passed
    if (isBeat && performance.now() - lastBeatTime > 150) {
        
        let numSplats = Math.floor(Math.random() * 4) + 1; // 1-4 standard splats
        
        // ~15% chance to do a massive "super splash" of paint down the hole
        if (Math.random() < 0.15) {
            numSplats += 15; // Mega burst
        }

        for (let i = 0; i < numSplats; i++) {
            splatters.push(new Splatter());
        }
        lastBeatTime = performance.now();
    }

    // Tunnel speed increases with bass
    let speed = 1.012 + (bass / 255) * 0.025;

    // Pre-calculate closest bend center to draw a clean center "fog" 
    let farBend = getBendOffset(0.01);
    let centerFogX = cx + farBend.ox;
    let centerFogY = cy + farBend.oy;

    // Update & Draw Rings (drawn back to front naturally by depth)
    for (let i = rings.length - 1; i >= 0; i--) {
        let ring = rings[i];
        if (ring.update(speed)) {
            rings.splice(i, 1);
        } else {
            ring.draw(ctx, cx, cy, globalRotation, intensity);
        }
    }

    // Update & Draw Splatters (paint sits on the walls)
    for (let i = splatters.length - 1; i >= 0; i--) {
        let splat = splatters[i];
        if (splat.update(speed, globalRotation)) {
            splatters.splice(i, 1);
        } else {
            splat.draw(ctx, cx, cy, globalRotation);
        }
    }
    
    // Draw fog at the very back of the bending tunnel to hide pop-in perfectly
    let gradient = ctx.createRadialGradient(centerFogX, centerFogY, 0, centerFogX, centerFogY, 150);
    gradient.addColorStop(0, 'rgba(5, 5, 10, 1)');
    gradient.addColorStop(0.3, 'rgba(5, 5, 10, 0.9)');
    gradient.addColorStop(1, 'rgba(5, 5, 10, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
}
