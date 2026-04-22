/*
  HAND TETRIS
  Rewritten version with:
  - lower lag
  - open palm movement
  - fist hard drop
  - improved wrist-turn rotation
  - camera direction matching real hand direction
  - green / red / blue visual indicators
*/

let video;
let handPose;
let hands = [];
let modelLoaded = false;

// =========================
// CANVAS / LAYOUT
// =========================
const CANVAS_W = 1600;
const CANVAS_H = 950;

const COLS = 10;
const ROWS = 30;
const CELL = 24;

const BOARD_W = COLS * CELL;
const BOARD_H = ROWS * CELL;

const BOARD_X = 650;
const BOARD_Y = 120;

const CAM_SIZE = 320;
const CAM_X = 1060;
const CAM_Y = 170;

const PANEL_X = 90;
const PANEL_Y = 180;
const PANEL_W = 420;
const PANEL_H = 430;

const RESTART_BTN = {
  x: 150,
  y: 650,
  w: 300,
  h: 78
};

// =========================
// GAME STATE
// =========================
let board = [];
let currentPiece = null;
let score = 0;
let lines = 0;
let isGameOver = false;

let dropInterval = 650;
let lastDropTick = 0;

// cooldowns
let lastMoveTime = 0;
let lastRotateTime = 0;
let lastHardDropTime = 0;

const MOVE_COOLDOWN = 120;
const ROTATE_COOLDOWN = 350;
const HARD_DROP_COOLDOWN = 700;

// spawn protection
let spawnProtectionUntil = 0;
const SPAWN_PROTECTION_MS = 450;

// smoothed palm position
let smoothPalmX = null;
let smoothPalmY = null;
const PALM_SMOOTH = 0.35;

// visual state
let gestureMode = "NONE";       // NONE / OPEN / FIST
let gestureDirection = "CENTER"; // LEFT / RIGHT / CENTER
let directionFlashUntil = 0;
let previousDirection = "CENTER";
let crtLineOffset = 0;

// rotation state
let previousTiltState = "CENTER"; // LEFT_TILT / RIGHT_TILT / CENTER

// =========================
// TETROMINOES
// =========================
const SHAPES = [
  {
    name: "I",
    color: "#5ad7ff",
    matrix: [
      [1, 1, 1, 1]
    ]
  },
  {
    name: "O",
    color: "#ffe66b",
    matrix: [
      [1, 1],
      [1, 1]
    ]
  },
  {
    name: "T",
    color: "#bb86fc",
    matrix: [
      [0, 1, 0],
      [1, 1, 1]
    ]
  },
  {
    name: "L",
    color: "#ffb347",
    matrix: [
      [0, 0, 1],
      [1, 1, 1]
    ]
  },
  {
    name: "J",
    color: "#7aa7ff",
    matrix: [
      [1, 0, 0],
      [1, 1, 1]
    ]
  },
  {
    name: "S",
    color: "#7dff8a",
    matrix: [
      [0, 1, 1],
      [1, 1, 0]
    ]
  },
  {
    name: "Z",
    color: "#ff7676",
    matrix: [
      [1, 1, 0],
      [0, 1, 1]
    ]
  }
];

// =========================
// SETUP
// =========================
function setup() {
  createCanvas(CANVAS_W, CANVAS_H);
  pixelDensity(1);
  textFont("Arial");

  video = createCapture(VIDEO);
  video.size(320, 240);
  video.hide();

  resetGame();
  initHandTracking();
}

async function initHandTracking() {
  try {
    handPose = await ml5.handPose({
      maxHands: 1,
      flipped: false,
      runtime: "mediapipe",
      modelType: "lite"
    });

    modelLoaded = true;
    handPose.detectStart(video.elt, gotHands);
  } catch (err) {
    console.error("Failed to load HandPose:", err);
  }
}

function gotHands(results) {
  hands = results || [];
}

// =========================
// RESET
// =========================
function resetGame() {
  board = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  score = 0;
  lines = 0;
  isGameOver = false;
  dropInterval = 650;

  currentPiece = createRandomPiece();
  lastDropTick = millis();
  spawnProtectionUntil = millis() + 600;

  smoothPalmX = null;
  smoothPalmY = null;

  gestureMode = "NONE";
  gestureDirection = "CENTER";
  previousDirection = "CENTER";
  previousTiltState = "CENTER";
  directionFlashUntil = 0;
}

// =========================
// DRAW LOOP
// =========================
function draw() {
  background(8);

  updateGame();
  handleGestures();

  drawBackgroundGlow();
  drawTitle();
  drawInstructionPanel();
  drawRestartButton();
  drawBoardFrame();
  drawBoard();
  drawCameraPanel();
  drawStats();
  drawCRTOverlay();

  if (isGameOver) {
    drawGameOver();
  }
}

// =========================
// GAME UPDATE
// =========================
function updateGame() {
  if (isGameOver || !currentPiece) return;

  const now = millis();

  if (now - lastDropTick > dropInterval) {
    movePiece(0, 1);
    lastDropTick = now;
  }
}

// =========================
// GESTURE LOGIC
// =========================
function handleGestures() {
  if (!modelLoaded || isGameOver || !currentPiece) {
    gestureMode = "NONE";
    gestureDirection = "CENTER";
    return;
  }

  if (!hands || hands.length === 0) {
    gestureMode = "NONE";
    gestureDirection = "CENTER";
    previousTiltState = "CENTER";
    return;
  }

  const hand = hands[0];
  const kp = getKeypointsObject(hand);
  if (!kp) return;

  const palm = getPalmCenter(kp);
  if (!palm) return;

  // smooth palm
  if (smoothPalmX === null) {
    smoothPalmX = palm.x;
    smoothPalmY = palm.y;
  } else {
    smoothPalmX = lerp(smoothPalmX, palm.x, PALM_SMOOTH);
    smoothPalmY = lerp(smoothPalmY, palm.y, PALM_SMOOTH);
  }

  const openPalm = isOpenPalm(kp);
  const fist = isFist(kp);

  if (openPalm) gestureMode = "OPEN";
  else if (fist) gestureMode = "FIST";
  else gestureMode = "NONE";

  const now = millis();

  // =====================
  // HORIZONTAL MOVEMENT
  // =====================
  // Since flipped:false, real left stays left
  const leftZone = video.width * 0.38;
  const rightZone = video.width * 0.62;

  let direction = "CENTER";
  if (smoothPalmX < leftZone) direction = "LEFT";
  else if (smoothPalmX > rightZone) direction = "RIGHT";

  gestureDirection = direction;

  if (direction !== previousDirection && direction !== "CENTER") {
    previousDirection = direction;
    directionFlashUntil = now + 180;
  } else if (direction === "CENTER") {
    previousDirection = "CENTER";
  }

  if (gestureMode === "OPEN") {
    if (direction === "LEFT" && now - lastMoveTime > MOVE_COOLDOWN) {
      movePiece(-1, 0);
      lastMoveTime = now;
    } else if (direction === "RIGHT" && now - lastMoveTime > MOVE_COOLDOWN) {
      movePiece(1, 0);
      lastMoveTime = now;
    }
  }

  // =====================
  // ROTATION
  // =====================
  // ONLY rotate when:
  // - palm is OPEN
  // - hand is intentionally tilted
  // - tilt changes from center to left/right
  const tiltState = detectPalmTilt(kp);

  if (gestureMode === "OPEN") {
    if (
      tiltState !== "CENTER" &&
      previousTiltState === "CENTER" &&
      now - lastRotateTime > ROTATE_COOLDOWN
    ) {
      rotatePiece();
      lastRotateTime = now;
    }
  }

  previousTiltState = tiltState;

  // =====================
  // HARD DROP
  // =====================
  if (
    gestureMode === "FIST" &&
    now > spawnProtectionUntil &&
    now - lastHardDropTime > HARD_DROP_COOLDOWN
  ) {
    hardDrop();
    lastHardDropTime = now;
  }
}

// =========================
// HAND KEYPOINT HELPERS
// =========================
function getKeypointsObject(hand) {
  if (!hand) return null;

  if (hand.keypoints && Array.isArray(hand.keypoints)) {
    const pts = hand.keypoints;
    let byName = {};

    for (const p of pts) {
      if (p.name) byName[p.name] = p;
    }

    if (Object.keys(byName).length > 0) return byName;
    return mapIndexedKeypoints(pts);
  }

  if (hand.landmarks && Array.isArray(hand.landmarks)) {
    return mapIndexedKeypoints(hand.landmarks.map(p => ({
      x: p[0],
      y: p[1],
      z: p[2] || 0
    })));
  }

  return null;
}

function mapIndexedKeypoints(pts) {
  const names = [
    "wrist",
    "thumb_cmc", "thumb_mcp", "thumb_ip", "thumb_tip",
    "index_finger_mcp", "index_finger_pip", "index_finger_dip", "index_finger_tip",
    "middle_finger_mcp", "middle_finger_pip", "middle_finger_dip", "middle_finger_tip",
    "ring_finger_mcp", "ring_finger_pip", "ring_finger_dip", "ring_finger_tip",
    "pinky_finger_mcp", "pinky_finger_pip", "pinky_finger_dip", "pinky_finger_tip"
  ];

  let out = {};
  for (let i = 0; i < names.length && i < pts.length; i++) {
    out[names[i]] = pts[i];
  }
  return out;
}

function getPalmCenter(k) {
  const points = [
    k.wrist,
    k.index_finger_mcp,
    k.middle_finger_mcp,
    k.ring_finger_mcp,
    k.pinky_finger_mcp
  ].filter(Boolean);

  if (points.length === 0) return null;

  let sx = 0;
  let sy = 0;

  for (const p of points) {
    sx += p.x;
    sy += p.y;
  }

  return {
    x: sx / points.length,
    y: sy / points.length
  };
}

function dist2D(a, b) {
  return dist(a.x, a.y, b.x, b.y);
}

function fingerExtended(tip, pip, mcp, wrist) {
  if (!tip || !pip || !mcp || !wrist) return false;

  const dTip = dist2D(tip, wrist);
  const dPip = dist2D(pip, wrist);
  const dMcp = dist2D(mcp, wrist);

  return dTip > dPip && dPip > dMcp * 0.92;
}

function isOpenPalm(k) {
  const indexOpen = fingerExtended(k.index_finger_tip, k.index_finger_pip, k.index_finger_mcp, k.wrist);
  const middleOpen = fingerExtended(k.middle_finger_tip, k.middle_finger_pip, k.middle_finger_mcp, k.wrist);
  const ringOpen = fingerExtended(k.ring_finger_tip, k.ring_finger_pip, k.ring_finger_mcp, k.wrist);
  const pinkyOpen = fingerExtended(k.pinky_finger_tip, k.pinky_finger_pip, k.pinky_finger_mcp, k.wrist);

  const thumbOpen =
    k.thumb_tip &&
    k.thumb_mcp &&
    dist2D(k.thumb_tip, k.wrist) > dist2D(k.thumb_mcp, k.wrist);

  const openCount = [indexOpen, middleOpen, ringOpen, pinkyOpen, thumbOpen].filter(Boolean).length;
  return openCount >= 4;
}

function isFist(k) {
  if (!k.wrist) return false;

  const tips = [
    k.thumb_tip,
    k.index_finger_tip,
    k.middle_finger_tip,
    k.ring_finger_tip,
    k.pinky_finger_tip
  ].filter(Boolean);

  if (tips.length < 4) return false;

  let closeCount = 0;
  for (const tip of tips) {
    if (dist2D(tip, k.wrist) < 120) closeCount++;
  }

  return closeCount >= 4;
}

// =========================
// NEW ROTATION SENSOR
// =========================
// Rotation only triggers when palm is OPEN and tilted enough.
//
// We compare the Y positions of index MCP and pinky MCP.
// If one side is clearly higher than the other, the palm is tilted.
//
// This is more stable than the old direction switching logic.
function detectPalmTilt(k) {
  if (!k.index_finger_mcp || !k.pinky_finger_mcp) return "CENTER";

  const indexBase = k.index_finger_mcp;
  const pinkyBase = k.pinky_finger_mcp;

  const diffY = indexBase.y - pinkyBase.y;

  // stronger threshold so it doesn't rotate randomly
  if (diffY < -22) return "LEFT_TILT";
  if (diffY > 22) return "RIGHT_TILT";

  return "CENTER";
}

// =========================
// TETRIS LOGIC
// =========================
function createRandomPiece() {
  const base = random(SHAPES);
  const matrixCopy = base.matrix.map(row => [...row]);

  const piece = {
    name: base.name,
    color: base.color,
    matrix: matrixCopy,
    x: floor((COLS - matrixCopy[0].length) / 2),
    y: 0
  };

  if (collides(piece, 0, 0, piece.matrix)) {
    isGameOver = true;
  }

  return piece;
}

function movePiece(dx, dy) {
  if (!currentPiece) return false;

  if (!collides(currentPiece, dx, dy, currentPiece.matrix)) {
    currentPiece.x += dx;
    currentPiece.y += dy;
    return true;
  }

  if (dy > 0) {
    lockPiece();
  }

  return false;
}

function rotatePiece() {
  if (!currentPiece) return;

  const rotated = rotateMatrix(currentPiece.matrix);
  const offsets = [0, -1, 1, -2, 2];

  for (const off of offsets) {
    if (!collides(currentPiece, off, 0, rotated)) {
      currentPiece.matrix = rotated;
      currentPiece.x += off;
      return;
    }
  }
}

function hardDrop() {
  if (!currentPiece) return;

  while (!collides(currentPiece, 0, 1, currentPiece.matrix)) {
    currentPiece.y++;
  }

  lockPiece();
}

function rotateMatrix(matrix) {
  const rows = matrix.length;
  const cols = matrix[0].length;

  let rotated = Array.from({ length: cols }, () => Array(rows).fill(0));

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      rotated[x][rows - 1 - y] = matrix[y][x];
    }
  }

  return rotated;
}

function collides(piece, dx, dy, testMatrix) {
  for (let y = 0; y < testMatrix.length; y++) {
    for (let x = 0; x < testMatrix[y].length; x++) {
      if (!testMatrix[y][x]) continue;

      const nx = piece.x + x + dx;
      const ny = piece.y + y + dy;

      if (nx < 0 || nx >= COLS || ny >= ROWS) {
        return true;
      }

      if (ny >= 0 && board[ny][nx]) {
        return true;
      }
    }
  }
  return false;
}

function lockPiece() {
  if (!currentPiece) return;

  for (let y = 0; y < currentPiece.matrix.length; y++) {
    for (let x = 0; x < currentPiece.matrix[y].length; x++) {
      if (currentPiece.matrix[y][x]) {
        const bx = currentPiece.x + x;
        const by = currentPiece.y + y;

        if (by < 0) {
          isGameOver = true;
          return;
        }

        board[by][bx] = currentPiece.color;
      }
    }
  }

  clearLines();
  currentPiece = createRandomPiece();
  spawnProtectionUntil = millis() + SPAWN_PROTECTION_MS;
}

function clearLines() {
  let cleared = 0;

  for (let y = ROWS - 1; y >= 0; y--) {
    if (board[y].every(cell => cell !== null)) {
      board.splice(y, 1);
      board.unshift(Array(COLS).fill(null));
      cleared++;
      y++;
    }
  }

  if (cleared > 0) {
    lines += cleared;
    score += cleared * 100;
    dropInterval = max(180, 650 - floor(lines * 8));
  }
}

// =========================
// DRAW UI
// =========================
function drawTitle() {
  push();
  textAlign(CENTER, CENTER);
  fill(240);
  textSize(40);
  textStyle(BOLD);
  text("HAND TETRIS", width / 2, 60);

  fill(120, 255, 180);
  textSize(16);
  textStyle(NORMAL);
  text("Gesture-Controlled Interactive Game", width / 2, 95);
  pop();
}

function drawBackgroundGlow() {
  noStroke();

  for (let i = 0; i < 6; i++) {
    fill(20, 255, 180, 8);
    ellipse(BOARD_X + BOARD_W / 2, BOARD_Y + BOARD_H / 2, 500 + i * 60, 800 + i * 70);
  }

  for (let i = 0; i < 5; i++) {
    fill(100, 180, 255, 8);
    ellipse(CAM_X + CAM_SIZE / 2, CAM_Y + CAM_SIZE / 2, 230 + i * 40, 230 + i * 40);
  }
}

function drawInstructionPanel() {
  push();
  fill(38, 38, 38, 235);
  stroke(150);
  strokeWeight(2);
  rect(PANEL_X, PANEL_Y, PANEL_W, PANEL_H, 22);

  fill(255);
  noStroke();
  textAlign(LEFT, TOP);

  textSize(28);
  textStyle(BOLD);
  text("Instructions", PANEL_X + 28, PANEL_Y + 22);

  textStyle(NORMAL);
  textSize(24);

  const instructions =
    "Open Palm:\nMove left / right\n\n" +
    "Turn Open Palm:\nRotate block\n\n" +
    "Clenched Fist:\nHard drop\n\n" +
    "Lasers:\n" +
    "Green = movement mode\n" +
    "Red = drop mode\n" +
    "Blue = direction change\n\n" +
    "Goal:\nClear full rows.";

  text(instructions, PANEL_X + 28, PANEL_Y + 72, PANEL_W - 56, PANEL_H - 90);
  pop();
}

function drawRestartButton() {
  const hovering =
    mouseX >= RESTART_BTN.x &&
    mouseX <= RESTART_BTN.x + RESTART_BTN.w &&
    mouseY >= RESTART_BTN.y &&
    mouseY <= RESTART_BTN.y + RESTART_BTN.h;

  push();
  stroke(255);
  strokeWeight(2);
  fill(hovering ? color(80, 80, 80) : color(35, 35, 35));
  rect(RESTART_BTN.x, RESTART_BTN.y, RESTART_BTN.w, RESTART_BTN.h, 18);

  noStroke();
  fill(255);
  textAlign(CENTER, CENTER);
  textSize(30);
  textStyle(BOLD);
  text("RESTART", RESTART_BTN.x + RESTART_BTN.w / 2, RESTART_BTN.y + RESTART_BTN.h / 2);
  pop();
}

function drawBoardFrame() {
  push();
  fill(12, 12, 12, 240);
  stroke(220);
  strokeWeight(3);
  rect(BOARD_X - 18, BOARD_Y - 18, BOARD_W + 36, BOARD_H + 36, 16);

  fill(0, 0, 0, 180);
  noStroke();
  rect(BOARD_X, BOARD_Y, BOARD_W, BOARD_H, 8);
  pop();
}

function drawBoard() {
  push();

  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const px = BOARD_X + x * CELL;
      const py = BOARD_Y + y * CELL;

      if (board[y][x]) {
        drawCell(px, py, board[y][x]);
      } else {
        fill(18);
        stroke(45);
        strokeWeight(1);
        rect(px, py, CELL, CELL);
      }
    }
  }

  if (currentPiece) {
    let ghostY = currentPiece.y;
    while (!collides({ ...currentPiece, y: ghostY }, 0, 1, currentPiece.matrix)) {
      ghostY++;
    }

    for (let y = 0; y < currentPiece.matrix.length; y++) {
      for (let x = 0; x < currentPiece.matrix[y].length; x++) {
        if (currentPiece.matrix[y][x]) {
          const px = BOARD_X + (currentPiece.x + x) * CELL;
          const py = BOARD_Y + (ghostY + y) * CELL;
          fill(255, 255, 255, 22);
          stroke(255, 255, 255, 60);
          rect(px, py, CELL, CELL);
        }
      }
    }
  }

  if (currentPiece) {
    for (let y = 0; y < currentPiece.matrix.length; y++) {
      for (let x = 0; x < currentPiece.matrix[y].length; x++) {
        if (currentPiece.matrix[y][x]) {
          const px = BOARD_X + (currentPiece.x + x) * CELL;
          const py = BOARD_Y + (currentPiece.y + y) * CELL;
          drawCell(px, py, currentPiece.color);
        }
      }
    }
  }

  pop();
}

function drawCell(px, py, col) {
  push();
  fill(col);
  stroke(255, 60);
  strokeWeight(1);
  rect(px, py, CELL, CELL, 4);

  fill(255, 45);
  noStroke();
  rect(px + 2, py + 2, CELL - 8, 6, 3);
  pop();
}

function drawCameraPanel() {
  push();

  fill(22, 22, 22, 240);
  stroke(220);
  strokeWeight(3);
  rect(CAM_X - 14, CAM_Y - 14, CAM_SIZE + 28, CAM_SIZE + 28, 18);

  fill(0);
  noStroke();
  rect(CAM_X, CAM_Y, CAM_SIZE, CAM_SIZE, 12);

  if (video && video.loadedmetadata) {
    const sx = (video.width - min(video.width, video.height)) / 2;
    const sy = (video.height - min(video.width, video.height)) / 2;
    const sSize = min(video.width, video.height);

    push();
    drawingContext.save();
    drawingContext.beginPath();
    drawingContext.roundRect(CAM_X, CAM_Y, CAM_SIZE, CAM_SIZE, 12);
    drawingContext.clip();

    // NOT mirrored now, so movement matches reality
    image(video, CAM_X, CAM_Y, CAM_SIZE, CAM_SIZE, sx, sy, sSize, sSize);

    drawingContext.restore();
    pop();
  }

  fill(0, 0, 0, 70);
  noStroke();
  rect(CAM_X, CAM_Y, CAM_SIZE, CAM_SIZE, 12);

  drawLaserIndicators();
  drawCameraLabels();

  pop();
}

function drawLaserIndicators() {
  if (!hands || hands.length === 0 || smoothPalmX === null || smoothPalmY === null) return;

  // Since preview is not mirrored anymore, map directly
  const vx = map(smoothPalmX, 0, video.width, CAM_X, CAM_X + CAM_SIZE);
  const vy = map(smoothPalmY, 0, video.height, CAM_Y, CAM_Y + CAM_SIZE);

  strokeWeight(3);

  if (gestureMode === "OPEN") {
    stroke(0, 255, 120);
    line(vx - 20, vy, vx + 20, vy);
    line(vx, vy - 20, vx, vy + 20);
    noStroke();
    fill(0, 255, 120, 180);
    ellipse(vx, vy, 14, 14);
  }

  if (gestureMode === "FIST") {
    stroke(255, 60, 60);
    line(vx - 25, vy - 25, vx + 25, vy + 25);
    line(vx + 25, vy - 25, vx - 25, vy + 25);
    noStroke();
    fill(255, 60, 60, 180);
    ellipse(vx, vy, 16, 16);
  }

  if (millis() < directionFlashUntil) {
    stroke(90, 170, 255);
    strokeWeight(4);

    if (gestureDirection === "LEFT") {
      line(vx, vy, vx - 60, vy);
      line(vx - 60, vy, vx - 40, vy - 14);
      line(vx - 60, vy, vx - 40, vy + 14);
    } else if (gestureDirection === "RIGHT") {
      line(vx, vy, vx + 60, vy);
      line(vx + 60, vy, vx + 40, vy - 14);
      line(vx + 60, vy, vx + 40, vy + 14);
    }
  }
}

function drawCameraLabels() {
  push();
  noStroke();
  fill(255);
  textAlign(CENTER, TOP);
  textSize(20);
  textStyle(BOLD);
  text("LIVE HAND TRACKING", CAM_X + CAM_SIZE / 2, CAM_Y + CAM_SIZE + 22);

  textSize(16);
  textStyle(NORMAL);

  let statusText = "Waiting for hand...";
  if (gestureMode === "OPEN") statusText = "Mode: OPEN PALM";
  else if (gestureMode === "FIST") statusText = "Mode: FIST";
  else if (hands.length > 0) statusText = "Mode: Neutral";

  text(statusText, CAM_X + CAM_SIZE / 2, CAM_Y + CAM_SIZE + 52);
  pop();
}

function drawStats() {
  push();
  fill(255);
  textAlign(LEFT, TOP);

  textSize(22);
  textStyle(BOLD);
  text("Score", 1060, 560);
  text("Lines", 1060, 635);
  text("State", 1060, 710);

  textStyle(NORMAL);
  textSize(28);
  fill(120, 255, 180);
  text(score, 1060, 592);
  text(lines, 1060, 667);

  let stateText = "IDLE";
  if (gestureMode === "OPEN") stateText = "MOVE";
  if (gestureMode === "FIST") stateText = "DROP";

  text(stateText, 1060, 742);
  pop();
}

function drawCRTOverlay() {
  push();

  for (let y = 0; y < height; y += 4) {
    stroke(255, 255, 255, 8);
    line(0, y, width, y);
  }

  noStroke();
  for (let i = 0; i < 10; i++) {
    fill(0, 0, 0, 10);
    rect(i * 4, i * 3, width - i * 8, height - i * 6, 20);
  }

  crtLineOffset += 0.8;
  fill(255, 255, 255, 6);
  rect(0, crtLineOffset % height, width, 6);

  pop();
}

function drawGameOver() {
  push();
  fill(0, 0, 0, 185);
  rect(0, 0, width, height);

  fill(255, 80, 80);
  textAlign(CENTER, CENTER);
  textSize(54);
  textStyle(BOLD);
  text("GAME OVER", width / 2, height / 2 - 30);

  fill(255);
  textSize(24);
  textStyle(NORMAL);
  text("Click RESTART to play again", width / 2, height / 2 + 28);
  pop();
}

// =========================
// INPUT
// =========================
function mousePressed() {
  if (
    mouseX >= RESTART_BTN.x &&
    mouseX <= RESTART_BTN.x + RESTART_BTN.w &&
    mouseY >= RESTART_BTN.y &&
    mouseY <= RESTART_BTN.y + RESTART_BTN.h
  ) {
    resetGame();
  }
}

// backup keyboard controls for testing
function keyPressed() {
  if (keyCode === LEFT_ARROW) movePiece(-1, 0);
  if (keyCode === RIGHT_ARROW) movePiece(1, 0);
  if (keyCode === DOWN_ARROW) movePiece(0, 1);
  if (keyCode === UP_ARROW) rotatePiece();
  if (key === " ") hardDrop();
  if (key === "r" || key === "R") resetGame();
}