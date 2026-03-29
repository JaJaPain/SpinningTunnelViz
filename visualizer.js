const audioElement = document.getElementById('audio-element');
const playBtn = document.getElementById('play-btn');
const uiContainer = document.getElementById('ui-container');
const canvas = document.getElementById('visualizer-canvas');
const ctx = canvas.getContext('2d');

let audioCtx, analyser, source, dataArray;
let isPlaying = false;
let isStarted = false;

// Recording state
let mediaRecorder;
let recordedChunks = [];
let isFadingOut = false;
let fadeAlpha = 0;

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
        
        // Create audio stream destination for recording
        const audioStreamDestination = audioCtx.createMediaStreamDestination();
        source.connect(analyser);
        source.connect(audioStreamDestination); // direct audio to recorder
        analyser.connect(audioCtx.destination); // direct audio to speakers
        
        // Initialize MediaRecorder combining video (canvas) and audio streams
        const videoStream = canvas.captureStream(60); // 60 FPS
        const combinedStream = new MediaStream([
            ...videoStream.getVideoTracks(), 
            ...audioStreamDestination.stream.getAudioTracks()
        ]);
        
        // Try VP9 first, fallback to VP8 or default
        let mimeType = 'video/webm;codecs=vp9,opus';
        if (!MediaRecorder.isTypeSupported(mimeType)) {
            mimeType = 'video/webm;codecs=vp8,opus';
            if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = 'video/webm';
        }

        mediaRecorder = new MediaRecorder(combinedStream, { mimeType: mimeType });
        
        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                recordedChunks.push(event.data);
            }
        };

        mediaRecorder.onstop = () => {
            const blob = new Blob(recordedChunks, { type: 'video/webm' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            document.body.appendChild(a);
            a.style = 'display: none';
            a.href = url;
            a.download = 'SurrenderingHisAuthority_Visualizer.webm';
            a.click();
            window.URL.revokeObjectURL(url);
            
            // Re-show UI after recording completes
            uiContainer.style.opacity = '1';
            playBtn.innerText = 'Play Again';
        };
    }
    
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }

    if (isPlaying) {
        audioElement.pause();
        playBtn.innerText = 'Play / Pause';
        uiContainer.style.opacity = '1';
        if (mediaRecorder && mediaRecorder.state === 'recording') {
            mediaRecorder.pause();
        }
    } else {
        audioElement.play();
        playBtn.innerText = 'Pause Visualizer';
        uiContainer.style.opacity = '0';
        
        // Reset recording and visualizer state if we're starting fresh
        if (audioElement.currentTime === 0 || isFadingOut) {
            recordedChunks = [];
            rings = [];
            splatters = [];
            isFadingOut = false;
            fadeAlpha = 0;
            if (mediaRecorder.state !== 'recording') {
                mediaRecorder.start();
            }
        } else if (mediaRecorder && mediaRecorder.state === 'paused') {
            mediaRecorder.resume();
        }
        
        requestAnimationFrame(renderLoop);
    }
    
    isPlaying = !isPlaying;
});

// Trigger fade out and stop recording when the song finishes
audioElement.addEventListener('ended', () => {
    isFadingOut = true;
    
    // Give it 3.5 seconds to fully fade to black, then stop the recorder
    setTimeout(() => {
        if (mediaRecorder && mediaRecorder.state === 'recording') {
            mediaRecorder.stop();
        }
        isPlaying = false;
    }, 3500);
});

// Helper: detect beats
function detectBeat(bassValue) {
    bassHistory.push(bassValue);
    if (bassHistory.length > 30) bassHistory.shift();
    
    let avg = bassHistory.reduce((a, b) => a + b, 0) / bassHistory.length;
    if (bassValue > avg * 1.2 && bassValue > 130) {
        return true;
    }
    return false;
}

// Calculate the bending curve based on depth
function getBendOffset(depth) {
    let curveTime = time * 0.5 + (Math.log(Math.max(0.001, depth)) * 2);
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
        this.size = Math.random() * 8 + 5;
        this.color = COLORS[Math.floor(Math.random() * COLORS.length)];
        
        this.offsetX = (Math.random() - 0.5) * 60;
        this.offsetY = (Math.random() - 0.5) * 60;

        this.dripLength = 0;
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
        return this.depth > 7; 
    }

    draw(ctx, cx, cy, globalRotation) {
        let radius = this.depth * Math.min(canvas.width, canvas.height); 
        let finalAngle = this.angle + globalRotation;
        
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
        
        // Dynamic Lighting: Calculate the angle of the current bend
        let turnAngle = Math.atan2(bend.oy, bend.ox);
        
        // Create a gradient across the ring pointing precisely into the turn
        let x1 = cx + bend.ox - Math.cos(turnAngle) * radius;
        let y1 = cy + bend.oy - Math.sin(turnAngle) * radius;
        let x2 = cx + bend.ox + Math.cos(turnAngle) * radius;
        let y2 = cy + bend.oy + Math.sin(turnAngle) * radius;

        let grad = ctx.createLinearGradient(x1, y1, x2, y2);
        
        if (this.isBeat) {
            // Darker on trailing side, extremely bright on turning side
            grad.addColorStop(0, `rgba(100, 100, 100, ${alpha * 0.4})`); 
            grad.addColorStop(1, `rgba(255, 255, 255, ${alpha})`); 
        } else {
            // Create a minimum floor for visibility so they never vanish completely
            // It scales up with intensity but never drops below 40% of its potential
            let baseAlpha = alpha * Math.max(0.4, intensity * 1.5);
            
            // Deep blue on trailing side, glowing blue on turning side
            grad.addColorStop(0, `rgba(60, 60, 120, ${baseAlpha * 0.3})`);
            grad.addColorStop(1, `rgba(180, 180, 255, ${baseAlpha})`);
        }
        
        ctx.strokeStyle = grad;
        ctx.lineWidth = this.isBeat ? this.depth * 6 : this.depth * 1.5;
        ctx.stroke();
    }
}

let lastBeatTime = 0;
let globalRotation = 0;

function renderLoop() {
    if (!isPlaying) return;
    requestAnimationFrame(renderLoop);
    
    // Smooth motion blur background - reduced opacity so lines linger longer and build brighter webs
    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)'; 
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    analyser.getByteFrequencyData(dataArray);
    
    let bass = 0;
    for (let i = 0; i < 5; i++) bass += dataArray[i];
    bass /= 5;

    let mid = 0;
    for (let i = 10; i < 30; i++) mid += dataArray[i];
    mid /= 20;

    let intensityRaw = mid / 255;
    let intensity = Math.pow(intensityRaw, 2.5);
    
    let bassRaw = bass / 255;
    let curvedBass = Math.pow(bassRaw, 3.0); 

    let isBeat = detectBeat(bass);
    
    time += 0.01 + (intensity * 0.015);
    globalRotation += 0.002 + (intensity * 0.006);
    
    let cx = canvas.width / 2;
    let cy = canvas.height / 2;

    // Only spawn new elements if we aren't fading out
    if (!isFadingOut) {
        if (Math.random() < 0.2 + (intensity * 0.6)) {
            rings.push(new TunnelRing(isBeat));
        }

        if (isBeat && performance.now() - lastBeatTime > 150) {
            let numSplats = Math.floor(Math.random() * 4) + 1; 
            if (Math.random() < 0.15) numSplats += 15; 
            for (let i = 0; i < numSplats; i++) splatters.push(new Splatter());
            lastBeatTime = performance.now();
        }
    }

    let speed = 1.008 + (curvedBass * 0.035);

    let farBend = getBendOffset(0.01);
    let centerFogX = cx + farBend.ox;
    let centerFogY = cy + farBend.oy;

    // Update & Draw Rings
    for (let i = rings.length - 1; i >= 0; i--) {
        let ring = rings[i];
        if (ring.update(speed)) {
            rings.splice(i, 1);
        } else {
            ring.draw(ctx, cx, cy, globalRotation, intensity);
        }
    }

    // Update & Draw Splatters
    for (let i = splatters.length - 1; i >= 0; i--) {
        let splat = splatters[i];
        if (splat.update(speed, globalRotation)) {
            splatters.splice(i, 1);
        } else {
            splat.draw(ctx, cx, cy, globalRotation);
        }
    }
    
    // Draw center fog as pure black to create a bottomless pit
    let gradient = ctx.createRadialGradient(centerFogX, centerFogY, 0, centerFogX, centerFogY, 150);
    gradient.addColorStop(0, 'rgba(0, 0, 0, 1)');
    gradient.addColorStop(0.4, 'rgba(0, 0, 0, 0.9)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Fade to Black overlay at the end of the song
    if (isFadingOut) {
        fadeAlpha += 0.005; 
        ctx.fillStyle = `rgba(0, 0, 0, ${Math.min(1, fadeAlpha)})`;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
}
