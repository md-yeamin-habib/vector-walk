const canvas = document.getElementById('navCanvas');
const ctx = canvas.getContext('2d');
const runBtn = document.getElementById('runBtn');
const compassNeedle = document.getElementById('compassNeedle');

function resizeCanvas() {
    canvas.width = canvas.parentElement.clientWidth;
    canvas.height = canvas.parentElement.clientHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

const TILE_SIZE = 60;
const GRID_SIZE = 40;

let serverData = null;
let instructionsList = [];
let currentInstIndex = 0;

let player = {
    x: 20 * TILE_SIZE,
    y: 20 * TILE_SIZE,
    angle: Math.PI / 2, 
    targetAngle: Math.PI / 2,
    moveSpeed: 3.0,
    turnSpeed: 0.08
};

let camAngle = Math.PI / 2;
let trailPoints = [];
let waypointNodes = [];
let targetTrailIndex = 1;
let startPos = { x: 20 * TILE_SIZE, y: 20 * TILE_SIZE };
let finalPos = null;
let viewMode = "DRIVE"; 
let transitionProgress = 0; 
let frameCount = 0;
let isRunning = false;
let pauseCounter = 0; 
let currentWalkedDist = 0;

const FOV = 280;
const CAMERA_HEIGHT = 130;
const LOOK_AHEAD = 190;

async function fetchSimulationAndStart() {
    const textInput = document.getElementById('commandInput').value;

    document.getElementById('phaseVal').innerText = "Parsing NL...";

    try {
        const response = await fetch('/api/simulate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: textInput })
        });
        
        serverData = await response.json();
        instructionsList = serverData.instructions || [];
        currentInstIndex = 0;
        
        let scaleVal = parseFloat(document.getElementById('scaleSelect').value) || 1.0;
        let originX = 20 * TILE_SIZE;
        let originY = 20 * TILE_SIZE;
        
        trailPoints = serverData.trail.map(pt => ({
            x: originX + (pt.x / scaleVal) * TILE_SIZE,
            y: originY - (pt.y / scaleVal) * TILE_SIZE,
            angle: pt.angle,
            inst_index: pt.inst_index || 0
        }));

        if (trailPoints.length > 0) {
            player.x = trailPoints[0].x;
            player.y = trailPoints[0].y;
            player.angle = trailPoints[0].angle;
            player.targetAngle = player.angle;
            startPos = { x: player.x, y: player.y };
            
            let lastPt = trailPoints[trailPoints.length - 1];
            finalPos = { x: lastPt.x, y: lastPt.y };
        }

        waypointNodes = [];
        for (let i = 1; i < trailPoints.length; i++) {
            if (trailPoints[i].inst_index !== trailPoints[i - 1].inst_index) {
                waypointNodes.push({ 
                    x: trailPoints[i].x, 
                    y: trailPoints[i].y, 
                    inst_index: trailPoints[i - 1].inst_index 
                });
            }
        }
        if (trailPoints.length > 0) {
            waypointNodes.push({ 
                x: finalPos.x, 
                y: finalPos.y, 
                inst_index: instructionsList.length - 1 
            });
        }

        camAngle = player.angle;
        targetTrailIndex = 1;
        viewMode = "DRIVE";
        transitionProgress = 0;
        frameCount = 0;
        pauseCounter = 0;
        currentWalkedDist = 0;
        isRunning = true;

        document.getElementById('phaseVal').innerText = "Live Tracking...";
        updateTerminal();

    } catch (err) {
        console.error("Simulation API Error:", err);
        document.getElementById('phaseVal').innerText = "Error parsing script";
    }
}

runBtn.addEventListener('click', fetchSimulationAndStart);

let mousePos = { x: 0, y: 0 };
let hoveredNode = null;

canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    mousePos.x = e.clientX - rect.left;
    mousePos.y = e.clientY - rect.top;
});

function updateTerminal() {
    const prevEl = document.getElementById('termPrev');
    const activeEl = document.getElementById('termActive');
    const nextEl = document.getElementById('termNext');

    if (instructionsList.length === 0) {
        prevEl.innerText = "-";
        activeEl.innerText = "No instructions";
        nextEl.innerText = "-";
        return;
    }

    let prevText = currentInstIndex > 0 ? formatInst(instructionsList[currentInstIndex - 1]) : "--- (Start)";
    let activeText = currentInstIndex < instructionsList.length ? formatInst(instructionsList[currentInstIndex]) : "Simulation Complete";
    let nextText = currentInstIndex + 1 < instructionsList.length ? formatInst(instructionsList[currentInstIndex + 1]) : "--- (End)";

    prevEl.innerText = prevText;
    activeEl.innerText = activeText;
    nextEl.innerText = nextText;
}

function formatInst(inst) {
    if (!inst) return "";
    if (inst.type === 'MOVE') return `MOVE ${inst.value} ${inst.unit || 'km'}`;
    if (inst.type === 'TURN') return `TURN ${inst.direction} ${inst.value}°`;
    return JSON.stringify(inst);
}

function update() {
    if (!isRunning) return;

    if (pauseCounter > 0) {
        pauseCounter--;
        return;
    }

    if (targetTrailIndex < trailPoints.length) {
        let targetPt = trailPoints[targetTrailIndex];
        player.targetAngle = targetPt.angle;

        let dx = targetPt.x - player.x;
        let dy = targetPt.y - player.y;
        let dist = Math.sqrt(dx * dx + dy * dy);

        if (dist > player.moveSpeed) {
            let stepX = (dx / dist) * player.moveSpeed;
            let stepY = (dy / dist) * player.moveSpeed;
            player.x += stepX;
            player.y += stepY;
            
            let scaleVal = parseFloat(document.getElementById('scaleSelect').value) || 1.0;
            currentWalkedDist += (player.moveSpeed / TILE_SIZE) * scaleVal;
        } else {
            player.x = targetPt.x;
            player.y = targetPt.y;
            
            let newInstIdx = Math.min(targetPt.inst_index, instructionsList.length - 1);
            if (newInstIdx !== currentInstIndex) {
                currentInstIndex = newInstIdx;
                updateTerminal();
                pauseCounter = 25; 
            }

            targetTrailIndex++;
        }
    } else {
        currentInstIndex = instructionsList.length;
        if (serverData) {
            currentWalkedDist = serverData.total_distance_km;
        }
        updateTerminal();
        if (viewMode === "DRIVE") {
            viewMode = "MAP";
            document.getElementById('phaseVal').innerText = "Summary Map";
        }
    }

    let angleDiff = player.targetAngle - player.angle;
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
    player.angle += angleDiff * 0.15;

    let desiredCamAngle = player.angle;
    let camAngleDiff = desiredCamAngle - camAngle;
    while (camAngleDiff > Math.PI) camAngleDiff -= Math.PI * 2;
    while (camAngleDiff < -Math.PI) camAngleDiff += Math.PI * 2;
    camAngle += camAngleDiff * 0.12;

    if (viewMode === "DRIVE") {
        transitionProgress += (0 - transitionProgress) * 0.06;
    } else {
        transitionProgress += (1 - transitionProgress) * 0.03; 
    }

    updateUI();
}

function project3D(worldX, worldY, heightOffset = 0) {
    let dx = worldX - player.x;
    let dy = player.y - worldY; 
    
    let rotX = dx * Math.sin(camAngle) - dy * Math.cos(camAngle);
    let rotZ = dx * Math.cos(camAngle) + dy * Math.sin(camAngle);

    rotZ += LOOK_AHEAD; 
    if (rotZ <= 5) return null; 
    
    let screenX = (rotX * FOV) / rotZ + canvas.width / 2;
    let screenY = ((CAMERA_HEIGHT - heightOffset) * FOV) / rotZ + canvas.height * 0.58;
    return { x: screenX, y: screenY, scale: FOV / rotZ };
}

function project2D(worldX, worldY) {
    let targetCenterX = canvas.width / 2;
    let targetCenterY = canvas.height / 2;
    let autoScale = 0.42;

    if (trailPoints.length > 0 && transitionProgress > 0.01) {
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (let pt of trailPoints) {
            if (pt.x < minX) minX = pt.x;
            if (pt.x > maxX) maxX = pt.x;
            if (pt.y < minY) minY = pt.y;
            if (pt.y > maxY) maxY = pt.y;
        }

        let boxCenterX = (minX + maxX) / 2;
        let boxCenterY = (minY + maxY) / 2;
        let boxWidth = Math.max(maxX - minX, 100);
        let boxHeight = Math.max(maxY - minY, 100);

        let scaleX = (canvas.width * 0.75) / boxWidth;
        let scaleY = (canvas.height * 0.75) / boxHeight;
        let fitScale = Math.min(scaleX, scaleY, 0.8); 

        let defaultScale = 0.42;
        autoScale = defaultScale * (1 - transitionProgress) + fitScale * transitionProgress;
        
        let defaultOffsetX = canvas.width / 2 - startPos.x * defaultScale;
        let defaultOffsetY = canvas.height / 2 - startPos.y * defaultScale;
        
        let framedOffsetX = canvas.width / 2 - boxCenterX * fitScale;
        let framedOffsetY = canvas.height / 2 - boxCenterY * fitScale;

        let finalOffsetX = defaultOffsetX * (1 - transitionProgress) + framedOffsetX * transitionProgress;
        let finalOffsetY = defaultOffsetY * (1 - transitionProgress) + framedOffsetY * transitionProgress;

        return {
            x: finalOffsetX + worldX * autoScale,
            y: finalOffsetY + worldY * autoScale,
            scale: autoScale
        };
    }

    let offsetX = canvas.width / 2 - startPos.x * autoScale;
    let offsetY = canvas.height / 2 - startPos.y * autoScale;
    return {
        x: offsetX + worldX * autoScale,
        y: offsetY + worldY * autoScale,
        scale: autoScale
    };
}

function getProjectedPoint(worldX, worldY, heightOffset = 0) {
    let pt3D = project3D(worldX, worldY, heightOffset);
    let pt2D = project2D(worldX, worldY);
    if (!pt3D) pt3D = { x: pt2D.x, y: canvas.height + 150, scale: 0 };
    return {
        x: pt3D.x * (1 - transitionProgress) + pt2D.x * transitionProgress,
        y: pt3D.y * (1 - transitionProgress) + pt2D.y * transitionProgress,
        scale: pt3D.scale * (1 - transitionProgress) + pt2D.scale * transitionProgress
    };
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (transitionProgress < 0.95) {
        let skyGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
        skyGrad.addColorStop(0, '#0f172a');
        skyGrad.addColorStop(0.55, '#1e293b');
        ctx.fillStyle = skyGrad;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    } else {
        ctx.fillStyle = '#020617';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    ctx.strokeStyle = "rgba(51, 65, 85, " + (0.3 + (1 - transitionProgress) * 0.3) + ")";
    ctx.lineWidth = 1;

    for (let i = 0; i <= GRID_SIZE; i += 1) {
        ctx.beginPath();
        let p1 = getProjectedPoint(i * TILE_SIZE, 0);
        let p2 = getProjectedPoint(i * TILE_SIZE, GRID_SIZE * TILE_SIZE);
        if (p1 && p2) { ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); }
        ctx.stroke();

        ctx.beginPath();
        let q1 = getProjectedPoint(0, i * TILE_SIZE);
        let q2 = getProjectedPoint(GRID_SIZE * TILE_SIZE, i * TILE_SIZE);
        if (q1 && q2) { ctx.moveTo(q1.x, q1.y); ctx.lineTo(q2.x, q2.y); }
        ctx.stroke();
    }

    if (trailPoints.length > 0) {
        ctx.strokeStyle = '#38bdf8';
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        let first = getProjectedPoint(trailPoints[0].x, trailPoints[0].y);
        ctx.moveTo(first.x, first.y);

        let activeLimit = Math.min(targetTrailIndex, trailPoints.length);
        for (let i = 1; i < activeLimit; i++) {
            let p = getProjectedPoint(trailPoints[i].x, trailPoints[i].y);
            ctx.lineWidth = Math.max(2, p.scale * 7);
            ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
    }

    if (transitionProgress > 0.85 && trailPoints.length > 0 && finalPos) {
        let ptA = getProjectedPoint(startPos.x, startPos.y);
        let ptB = getProjectedPoint(finalPos.x, finalPos.y);

        ctx.strokeStyle = '#10b981'; 
        ctx.lineWidth = 2.5;
        ctx.setLineDash([6, 6]);
        ctx.beginPath();
        ctx.moveTo(ptA.x, ptA.y);
        ctx.lineTo(ptB.x, ptB.y);
        ctx.stroke();
        ctx.setLineDash([]); 
    }

    hoveredNode = null;
    let scaleVal = parseFloat(document.getElementById('scaleSelect').value) || 1.0;

    if (trailPoints.length > 0) {
        let ptA = getProjectedPoint(startPos.x, startPos.y);
        let hdxA = mousePos.x - ptA.x;
        let hdyA = mousePos.y - ptA.y;
        if (Math.sqrt(hdxA * hdxA + hdyA * hdyA) < 12) {
            hoveredNode = { x: ptA.x, y: ptA.y, label: "0, 0" };
        }
    }

    if (waypointNodes.length > 0) {
        for (let node of waypointNodes) {
            if (currentInstIndex > node.inst_index || currentInstIndex >= instructionsList.length) {
                let ptN = getProjectedPoint(node.x, node.y);
                
                let hdx = mousePos.x - ptN.x;
                let hdy = mousePos.y - ptN.y;
                if (Math.sqrt(hdx * hdx + hdy * hdy) < 12) {
                    let nX_km = ((node.x - startPos.x) / TILE_SIZE) * scaleVal;
                    let nY_km = ((startPos.y - node.y) / TILE_SIZE) * scaleVal;
                    if (Math.abs(nX_km) < 0.05) nX_km = 0;
                    if (Math.abs(nY_km) < 0.05) nY_km = 0;
                    let coordStr = scaleVal < 1 ? `${(nX_km * 1000).toFixed(0)}, ${(nY_km * 1000).toFixed(0)}` : `${nX_km.toFixed(1)}, ${nY_km.toFixed(1)}`;
                    hoveredNode = { x: ptN.x, y: ptN.y, label: coordStr };
                }

                ctx.fillStyle = '#38bdf8';
                ctx.beginPath();
                ctx.arc(ptN.x, ptN.y, Math.max(3, ptN.scale * 5), 0, Math.PI * 2);
                ctx.fill();
                ctx.strokeStyle = '#020617';
                ctx.lineWidth = 1.5;
                ctx.stroke();
            }
        }
    }

    // Always safely render Start Node A first
    if (trailPoints.length > 0) {
        let ptA = getProjectedPoint(startPos.x, startPos.y);
        
        let isExactOverlap = serverData && serverData.net_displacement_km < 0.001 && targetTrailIndex >= trailPoints.length;

        // If they don't overlap, draw Start Node and Label A normally on the right
        if (!isExactOverlap) {
            ctx.fillStyle = '#ef4444';
            ctx.beginPath();
            ctx.arc(ptA.x, ptA.y, Math.max(4, ptA.scale * 10), 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 12px sans-serif';
            ctx.textAlign = 'left';
            ctx.fillText('A (Start)', ptA.x + 10, ptA.y - 10);
        }

        // Render Finish Node B only when simulation trail has finished and finalPos is available
        if (finalPos && targetTrailIndex >= trailPoints.length) {
            let ptB = getProjectedPoint(finalPos.x, finalPos.y);
            let pixelDist = Math.hypot(ptA.x - ptB.x, ptA.y - ptB.y);
            let isVisualOverlap = pixelDist < 45; // Close enough to collide visually

            ctx.fillStyle = '#10b981';
            ctx.beginPath();
            ctx.arc(ptB.x, ptB.y, Math.max(4, ptB.scale * 10), 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 12px sans-serif';

            if (isExactOverlap) {
                ctx.textAlign = 'left';
                ctx.fillText('A / B (Start & Finish)', ptB.x + 10, ptB.y - 10);
            } else if (isVisualOverlap) {
                // Shift B label to the LEFT of the node so labels sit on opposite sides cleanly
                ctx.textAlign = 'right';
                ctx.fillText('B (Finish)', ptB.x - 10, ptB.y - 10);
                ctx.textAlign = 'left'; // Reset back to default
            } else {
                ctx.textAlign = 'left';
                ctx.fillText('B (Finish)', ptB.x + 10, ptB.y - 10);
            }
        }
    }

    if (hoveredNode) {
        ctx.font = '11px sans-serif';
        let textWidth = ctx.measureText(hoveredNode.label).width;
        
        ctx.fillStyle = "rgba(15, 23, 42, 0.9)";
        ctx.fillRect(hoveredNode.x + 12, hoveredNode.y - 22, textWidth + 12, 22);
        ctx.strokeStyle = "#38bdf8";
        ctx.lineWidth = 1;
        ctx.strokeRect(hoveredNode.x + 12, hoveredNode.y - 22, textWidth + 12, 22);

        ctx.fillStyle = "#38bdf8";
        ctx.fillText(hoveredNode.label, hoveredNode.x + 18, hoveredNode.y - 7);
    }

    let pBase = getProjectedPoint(player.x, player.y);
    let pHead = getProjectedPoint(player.x, player.y, 45); 

    if (pBase && pHead && targetTrailIndex < trailPoints.length) {
        let charHeight = pBase.y - pHead.y;
        let charWidth = charHeight * 0.45;

        ctx.save();
        ctx.translate(pBase.x, pBase.y);
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        ctx.beginPath();
        ctx.ellipse(0, 0, charWidth * 0.6, charWidth * 0.2, 0, 0, Math.PI * 2);
        ctx.fill();

        let legWiggle = Math.sin(frameCount * 0.4) * (charHeight * 0.15);
        ctx.fillStyle = "#334155";
        ctx.fillRect(-charWidth * 0.25, -charHeight * 0.3 + legWiggle, charWidth * 0.2, charHeight * 0.3);
        ctx.fillRect(charWidth * 0.05, -charHeight * 0.3 - legWiggle, charWidth * 0.2, charHeight * 0.3);

        ctx.fillStyle = "#f43f5e";
        ctx.fillRect(-charWidth * 0.4, -charHeight * 0.75, charWidth * 0.8, charHeight * 0.5);

        ctx.fillStyle = "#fed7aa";
        ctx.beginPath();
        ctx.arc(0, -charHeight * 0.88, charWidth * 0.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}

function updateUI() {
    if (!serverData) return;

    let scaleVal = parseFloat(document.getElementById('scaleSelect').value) || 1.0;
    
    let currentX_km = ((player.x - startPos.x) / TILE_SIZE) * scaleVal;
    let currentY_km = ((startPos.y - player.y) / TILE_SIZE) * scaleVal;
    
    if (Math.abs(currentX_km) < 0.05) currentX_km = 0;
    if (Math.abs(currentY_km) < 0.05) currentY_km = 0;
    
    let coordText = scaleVal < 1 ? 
        `${(currentX_km * 1000).toFixed(0)}, ${(currentY_km * 1000).toFixed(0)} m` : 
        `${currentX_km.toFixed(1)}, ${currentY_km.toFixed(1)} km`;
    document.getElementById('posVal').innerText = coordText;

    let deg = Math.round((player.angle * 180) / Math.PI);
    let compassDeg = (90 - deg) % 360;
    if (compassDeg < 0) compassDeg += 360;

    let heading = "North";
    if (compassDeg >= 22.5 && compassDeg < 67.5) heading = "Northeast";
    else if (compassDeg >= 67.5 && compassDeg < 112.5) heading = "East";
    else if (compassDeg >= 112.5 && compassDeg < 157.5) heading = "Southeast";
    else if (compassDeg >= 157.5 && compassDeg < 202.5) heading = "South";
    else if (compassDeg >= 202.5 && compassDeg < 247.5) heading = "Southwest";
    else if (compassDeg >= 247.5 && compassDeg < 292.5) heading = "West";
    else if (compassDeg >= 292.5 && compassDeg < 337.5) heading = "Northwest";
    
    document.getElementById('dirVal').innerText = heading.toUpperCase();

    if (compassNeedle) {
        compassNeedle.style.transform = `translate(-50%, -50%) rotate(${compassDeg}deg)`;
    }

    let liveDistKm = (targetTrailIndex >= trailPoints.length) ? serverData.total_distance_km : Math.min(currentWalkedDist, serverData.total_distance_km);
    let liveDispKm = Math.sqrt(currentX_km * currentX_km + currentY_km * currentY_km);

    if (targetTrailIndex >= trailPoints.length) {
        liveDispKm = serverData.net_displacement_km;
    }

    let distText = scaleVal < 1 ? `${(liveDistKm * 1000).toFixed(0)} m` : `${liveDistKm.toFixed(2)} km`;
    let dispText = scaleVal < 1 ? `${(liveDispKm * 1000).toFixed(0)} m` : `${liveDispKm.toFixed(2)} km`;

    document.getElementById('distVal').innerText = distText;
    document.getElementById('dispVal').innerText = dispText;

    document.getElementById('dispHeadVal').innerText = (targetTrailIndex >= trailPoints.length) ? serverData.displacement_heading : heading;
}

// Set up initial idle state so character appears at origin (0,0) on load
let defaultScale = parseFloat(document.getElementById('scaleSelect').value) || 1.0;
let originX = 20 * TILE_SIZE;
let originY = 20 * TILE_SIZE;

player.x = originX;
player.y = originY;
player.angle = Math.PI / 2;
player.targetAngle = player.angle;
startPos = { x: originX, y: originY };

trailPoints = [{ x: originX, y: originY, angle: player.angle, inst_index: 0 }];
targetTrailIndex = 1;
isRunning = false;

function loop() {
    frameCount++;
    update();
    draw();
    requestAnimationFrame(loop);
}

loop();
