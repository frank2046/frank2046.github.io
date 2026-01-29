(() => {
  "use strict";

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");

  const btnRestart = document.getElementById("btnRestart");
  const btnPause = document.getElementById("btnPause");
  const btnStart = document.getElementById("btnStart");
  const btnHow = document.getElementById("btnHow");

  const overlay = document.getElementById("overlay");
  const overlayTitle = document.getElementById("overlayTitle");
  const overlayText = document.getElementById("overlayText");
  const how = document.getElementById("how");

  const hudLives = document.getElementById("hudLives");
  const hudScore = document.getElementById("hudScore");
  const hudLevel = document.getElementById("hudLevel");
  const hudEnemies = document.getElementById("hudEnemies");

  const W = canvas.width;
  const H = canvas.height;

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  function aabbIntersect(a, b) {
    return (
      a.x < b.x + b.w &&
      a.x + a.w > b.x &&
      a.y < b.y + b.h &&
      a.y + a.h > b.y
    );
  }

  function circleRectHit(cx, cy, r, rect) {
    const px = clamp(cx, rect.x, rect.x + rect.w);
    const py = clamp(cy, rect.y, rect.y + rect.h);
    const dx = cx - px;
    const dy = cy - py;
    return dx * dx + dy * dy <= r * r;
  }

  function normAngle(a) {
    const pi2 = Math.PI * 2;
    a = a % pi2;
    if (a < -Math.PI) a += pi2;
    if (a > Math.PI) a -= pi2;
    return a;
  }

  const KEYS = new Set();
  window.addEventListener("keydown", (e) => {
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(e.key)) {
      e.preventDefault();
    }
    KEYS.add(e.key);
    if (e.key === "Enter" && state.mode !== "running") startGame();
    if (e.key.toLowerCase() === "p") togglePause();
    if (e.key.toLowerCase() === "r") restart();
  });
  window.addEventListener("keyup", (e) => KEYS.delete(e.key));

  btnRestart.addEventListener("click", restart);
  btnPause.addEventListener("click", togglePause);
  btnStart.addEventListener("click", startGame);
  btnHow.addEventListener("click", () => how.classList.toggle("hidden"));

  const TILE = 32;
  const COLORS = {
    bg1: "#0b1020",
    grid: "rgba(255,255,255,.06)",
    brick: "#c25b4b",
    brickEdge: "rgba(0,0,0,.25)",
    steel: "#6b7aa5",
    steelEdge: "rgba(0,0,0,.25)",
    water: "rgba(110,231,255,.14)",
    grass: "rgba(52,211,153,.10)",
    player: "#6ee7ff",
    enemy: "#ff4d6d",
    bullet: "#f6f7ff",
    shadow: "rgba(0,0,0,.35)",
  };

  function makeLevel1() {
    const cols = Math.floor(W / TILE);
    const rows = Math.floor(H / TILE);
    const grid = Array.from({ length: rows }, () => Array(cols).fill(0));

    // Border steel walls
    for (let x = 0; x < cols; x++) {
      grid[0][x] = 2;
      grid[rows - 1][x] = 2;
    }
    for (let y = 0; y < rows; y++) {
      grid[y][0] = 2;
      grid[y][cols - 1] = 2;
    }

    // Some bricks and steels
    const putRect = (x0, y0, w, h, t) => {
      for (let y = y0; y < y0 + h; y++) {
        for (let x = x0; x < x0 + w; x++) {
          if (x > 0 && x < cols - 1 && y > 0 && y < rows - 1) grid[y][x] = t;
        }
      }
    };

    putRect(3, 3, 6, 1, 1);
    putRect(3, 4, 1, 4, 1);
    putRect(8, 4, 1, 4, 1);
    putRect(cols - 9, 3, 6, 1, 1);
    putRect(cols - 9, 4, 1, 4, 1);
    putRect(cols - 4, 4, 1, 4, 1);

    putRect(6, 9, cols - 12, 1, 2);
    putRect(6, rows - 10, cols - 12, 1, 2);

    // Center bricks
    putRect(Math.floor(cols / 2) - 4, Math.floor(rows / 2) - 1, 8, 1, 1);
    putRect(Math.floor(cols / 2) - 1, Math.floor(rows / 2) - 4, 1, 8, 1);

    // A bit of grass + water (cosmetic & slows)
    putRect(2, rows - 6, 5, 3, 4);
    putRect(cols - 7, rows - 6, 5, 3, 4);
    putRect(Math.floor(cols / 2) - 2, 2, 4, 2, 3);

    return { cols, rows, grid };
  }

  function levelToWalls(level) {
    const walls = [];
    for (let y = 0; y < level.rows; y++) {
      for (let x = 0; x < level.cols; x++) {
        const t = level.grid[y][x];
        if (t === 1 || t === 2) {
          walls.push({
            x: x * TILE,
            y: y * TILE,
            w: TILE,
            h: TILE,
            type: t, // 1=brick 2=steel
            hp: t === 1 ? 2 : Infinity,
          });
        }
      }
    }
    return walls;
  }

  function getTileType(level, x, y) {
    const tx = Math.floor(x / TILE);
    const ty = Math.floor(y / TILE);
    if (tx < 0 || ty < 0 || tx >= level.cols || ty >= level.rows) return 2;
    return level.grid[ty][tx]; // 0 empty, 1 brick, 2 steel, 3 water, 4 grass
  }

  function tileFriction(level, x, y) {
    const t = getTileType(level, x, y);
    if (t === 3) return 0.70; // water slows a lot
    if (t === 4) return 0.88; // grass slows a bit
    return 1.0;
  }

  function spawnPlayer() {
    return {
      kind: "player",
      x: 96,
      y: H - 96,
      r: 16,
      angle: -Math.PI / 2,
      speed: 0,
      maxSpeed: 240,
      accel: 620,
      turnSpeed: 2.8,
      strafe: 140,
      fireCooldown: 0,
      fireRate: 0.28,
      invuln: 1.0,
    };
  }

  function spawnEnemy(i) {
    const spawnPoints = [
      { x: 96, y: 96 },
      { x: W - 96, y: 96 },
      { x: W / 2, y: 96 },
      { x: W / 2 - 180, y: 96 },
      { x: W / 2 + 180, y: 96 },
    ];
    const p = spawnPoints[i % spawnPoints.length];
    return {
      kind: "enemy",
      x: p.x,
      y: p.y,
      r: 16,
      angle: Math.PI / 2,
      speed: 0,
      maxSpeed: 190,
      accel: 520,
      turnSpeed: 2.4,
      fireCooldown: lerp(0.1, 0.6, Math.random()),
      fireRate: lerp(0.55, 0.9, Math.random()),
      thinkTimer: lerp(0.25, 0.6, Math.random()),
      desiredAngle: Math.PI / 2,
      desiredSpeed: 0,
      jitter: lerp(0.5, 1.2, Math.random()),
      hp: 1,
    };
  }

  function makeBullet(ownerKind, x, y, angle) {
    const speed = ownerKind === "player" ? 520 : 460;
    return {
      ownerKind,
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      r: ownerKind === "player" ? 4.5 : 4.0,
      life: 1.8,
    };
  }

  const state = {
    mode: "intro", // intro | running | paused | win | lose
    t: 0,
    lastTs: 0,
    levelIndex: 1,
    level: null,
    walls: [],
    player: null,
    enemies: [],
    bullets: [],
    particles: [],
    score: 0,
    lives: 3,
  };

  function setOverlay(visible, title, text) {
    overlayTitle.textContent = title;
    overlayText.innerHTML = text;
    overlay.classList.toggle("hidden", !visible);
  }

  function syncHud() {
    hudLives.textContent = String(state.lives);
    hudScore.textContent = String(state.score);
    hudLevel.textContent = String(state.levelIndex);
    hudEnemies.textContent = String(state.enemies.length);
    btnPause.textContent = state.mode === "paused" ? "继续" : "暂停";
  }

  function resetWorld() {
    state.level = makeLevel1();
    state.walls = levelToWalls(state.level);
    state.player = spawnPlayer();
    state.enemies = Array.from({ length: 6 }, (_, i) => spawnEnemy(i));
    state.bullets = [];
    state.particles = [];
    syncHud();
  }

  function startGame() {
    if (state.mode === "running") return;
    if (state.mode === "intro") {
      state.levelIndex = 1;
      state.score = 0;
      state.lives = 3;
      resetWorld();
    }
    state.mode = "running";
    setOverlay(false, "", "");
    syncHud();
  }

  function restart() {
    state.mode = "intro";
    state.levelIndex = 1;
    state.score = 0;
    state.lives = 3;
    resetWorld();
    setOverlay(
      true,
      "坦克大战",
      '按 <b>Enter</b> 开始。WASD 移动，左右键转向，空格开火。'
    );
    syncHud();
  }

  function togglePause() {
    if (state.mode === "running") {
      state.mode = "paused";
      setOverlay(true, "已暂停", "按 <b>P</b> 继续，或点击上方按钮。");
    } else if (state.mode === "paused") {
      state.mode = "running";
      setOverlay(false, "", "");
    }
    syncHud();
  }

  function explode(x, y, color, n = 14) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = lerp(60, 260, Math.random());
      state.particles.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        r: lerp(1.5, 3.6, Math.random()),
        life: lerp(0.25, 0.65, Math.random()),
        color,
      });
    }
  }

  function moveTankWithCollisions(tank, dx, dy, dt) {
    // Move on each axis and revert if colliding.
    const r = tank.r;

    const prevX = tank.x;
    tank.x += dx;
    tank.x = clamp(tank.x, r + 1, W - r - 1);
    for (let i = 0; i < state.walls.length; i++) {
      const w = state.walls[i];
      if (circleRectHit(tank.x, tank.y, r, w)) {
        tank.x = prevX;
        break;
      }
    }

    const prevY = tank.y;
    tank.y += dy;
    tank.y = clamp(tank.y, r + 1, H - r - 1);
    for (let i = 0; i < state.walls.length; i++) {
      const w = state.walls[i];
      if (circleRectHit(tank.x, tank.y, r, w)) {
        tank.y = prevY;
        break;
      }
    }

    // friction based on tile
    const fr = tileFriction(state.level, tank.x, tank.y);
    tank.speed *= Math.pow(0.98, dt * 60) * fr;
  }

  function fire(tank) {
    if (tank.fireCooldown > 0) return;
    const muzzle = tank.r + 10;
    const bx = tank.x + Math.cos(tank.angle) * muzzle;
    const by = tank.y + Math.sin(tank.angle) * muzzle;
    state.bullets.push(makeBullet(tank.kind, bx, by, tank.angle));
    tank.fireCooldown = tank.fireRate;
  }

  function updatePlayer(dt) {
    const p = state.player;
    if (!p) return;

    const left = KEYS.has("ArrowLeft");
    const right = KEYS.has("ArrowRight");
    const up = KEYS.has("w") || KEYS.has("W");
    const down = KEYS.has("s") || KEYS.has("S");
    const a = KEYS.has("a") || KEYS.has("A");
    const d = KEYS.has("d") || KEYS.has("D");
    const shoot = KEYS.has(" ");

    let turn = 0;
    if (left) turn -= 1;
    if (right) turn += 1;
    p.angle = normAngle(p.angle + turn * p.turnSpeed * dt);

    let accel = 0;
    if (up) accel += 1;
    if (down) accel -= 1;
    p.speed += accel * p.accel * dt;
    p.speed = clamp(p.speed, -p.maxSpeed * 0.55, p.maxSpeed);

    // mild strafe
    const str = (d ? 1 : 0) - (a ? 1 : 0);
    const sx = Math.cos(p.angle + Math.PI / 2) * (str * p.strafe) * dt;
    const sy = Math.sin(p.angle + Math.PI / 2) * (str * p.strafe) * dt;

    const vx = Math.cos(p.angle) * p.speed * dt;
    const vy = Math.sin(p.angle) * p.speed * dt;
    moveTankWithCollisions(p, vx + sx, vy + sy, dt);

    if (shoot) fire(p);
    p.fireCooldown = Math.max(0, p.fireCooldown - dt);
    p.invuln = Math.max(0, p.invuln - dt);
  }

  function enemyThink(e, dt) {
    e.thinkTimer -= dt;
    if (e.thinkTimer > 0) return;
    e.thinkTimer = lerp(0.22, 0.52, Math.random()) * e.jitter;

    const p = state.player;
    if (!p) return;
    const dx = p.x - e.x;
    const dy = p.y - e.y;
    const dist = Math.hypot(dx, dy);
    const angToPlayer = Math.atan2(dy, dx);

    // Sometimes wander / sometimes chase
    const chase = dist < 520 ? 0.80 : 0.50;
    if (Math.random() < chase) {
      e.desiredAngle = angToPlayer + lerp(-0.35, 0.35, Math.random());
      e.desiredSpeed = e.maxSpeed * (dist > 200 ? 1 : 0.4);
    } else {
      e.desiredAngle = e.angle + lerp(-1.4, 1.4, Math.random());
      e.desiredSpeed = e.maxSpeed * lerp(0.2, 0.9, Math.random());
    }
  }

  function updateEnemy(e, dt) {
    enemyThink(e, dt);
    // turn towards desiredAngle
    const da = normAngle(e.desiredAngle - e.angle);
    e.angle = normAngle(e.angle + clamp(da, -1, 1) * e.turnSpeed * dt);

    // speed towards desiredSpeed
    const dv = e.desiredSpeed - e.speed;
    e.speed += clamp(dv, -e.accel * dt, e.accel * dt);
    e.speed = clamp(e.speed, -e.maxSpeed * 0.3, e.maxSpeed);

    const dx = Math.cos(e.angle) * e.speed * dt;
    const dy = Math.sin(e.angle) * e.speed * dt;
    moveTankWithCollisions(e, dx, dy, dt);

    // shooting: if facing player-ish
    const p = state.player;
    if (p) {
      const angTo = Math.atan2(p.y - e.y, p.x - e.x);
      const facing = Math.abs(normAngle(angTo - e.angle)) < 0.45;
      if (facing && Math.random() < 0.45) fire(e);
    }
    e.fireCooldown = Math.max(0, e.fireCooldown - dt);
  }

  function updateBullets(dt) {
    for (let i = state.bullets.length - 1; i >= 0; i--) {
      const b = state.bullets[i];
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      if (b.life <= 0) {
        state.bullets.splice(i, 1);
        continue;
      }

      // Out of bounds
      if (b.x < -20 || b.y < -20 || b.x > W + 20 || b.y > H + 20) {
        state.bullets.splice(i, 1);
        continue;
      }

      // Walls
      let hit = false;
      for (let wi = 0; wi < state.walls.length; wi++) {
        const w = state.walls[wi];
        if (!circleRectHit(b.x, b.y, b.r, w)) continue;
        hit = true;
        if (w.type === 1) {
          w.hp -= 1;
          explode(b.x, b.y, COLORS.brick, 10);
          if (w.hp <= 0) state.walls.splice(wi, 1);
        } else {
          explode(b.x, b.y, COLORS.steel, 8);
        }
        break;
      }
      if (hit) {
        state.bullets.splice(i, 1);
        continue;
      }

      // Tanks
      const p = state.player;
      if (p && b.ownerKind !== "player") {
        const dx = b.x - p.x;
        const dy = b.y - p.y;
        if (dx * dx + dy * dy <= (p.r + b.r) * (p.r + b.r)) {
          if (p.invuln <= 0) {
            state.lives -= 1;
            p.invuln = 1.2;
            explode(p.x, p.y, COLORS.player, 18);
            if (state.lives <= 0) {
              state.mode = "lose";
              setOverlay(
                true,
                "失败",
                `你的坦克被击毁。得分 <b>${state.score}</b>。按 <b>Enter</b> 再来一局。`
              );
            } else {
              // respawn position
              p.x = 96;
              p.y = H - 96;
              p.speed = 0;
            }
            syncHud();
          }
          state.bullets.splice(i, 1);
          continue;
        }
      }

      if (b.ownerKind === "player") {
        for (let ei = state.enemies.length - 1; ei >= 0; ei--) {
          const e = state.enemies[ei];
          const dx = b.x - e.x;
          const dy = b.y - e.y;
          if (dx * dx + dy * dy <= (e.r + b.r) * (e.r + b.r)) {
            explode(e.x, e.y, COLORS.enemy, 20);
            state.enemies.splice(ei, 1);
            state.score += 100;
            syncHud();
            state.bullets.splice(i, 1);
            break;
          }
        }
      }
    }
  }

  function updateParticles(dt) {
    for (let i = state.particles.length - 1; i >= 0; i--) {
      const p = state.particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= Math.pow(0.90, dt * 60);
      p.vy *= Math.pow(0.90, dt * 60);
      p.life -= dt;
      if (p.life <= 0) state.particles.splice(i, 1);
    }
  }

  function update(dt) {
    if (state.mode !== "running") return;

    updatePlayer(dt);
    for (const e of state.enemies) updateEnemy(e, dt);
    updateBullets(dt);
    updateParticles(dt);

    // Win condition
    if (state.enemies.length === 0) {
      state.mode = "win";
      setOverlay(
        true,
        "胜利！",
        `你消灭了所有敌人。得分 <b>${state.score}</b>。按 <b>Enter</b> 重新开始。`
      );
    }
    syncHud();
  }

  function drawGrid() {
    ctx.save();
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    for (let x = 0; x <= W; x += TILE) {
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, H);
      ctx.stroke();
    }
    for (let y = 0; y <= H; y += TILE) {
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(W, y + 0.5);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawTiles() {
    // draw water/grass as translucent overlays (non-blocking)
    const level = state.level;
    if (!level) return;
    for (let y = 0; y < level.rows; y++) {
      for (let x = 0; x < level.cols; x++) {
        const t = level.grid[y][x];
        if (t === 3) {
          ctx.fillStyle = COLORS.water;
          ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
        } else if (t === 4) {
          ctx.fillStyle = COLORS.grass;
          ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
        }
      }
    }
  }

  function drawWalls() {
    for (const w of state.walls) {
      const isBrick = w.type === 1;
      ctx.fillStyle = isBrick ? COLORS.brick : COLORS.steel;
      ctx.fillRect(w.x, w.y, w.w, w.h);
      ctx.strokeStyle = isBrick ? COLORS.brickEdge : COLORS.steelEdge;
      ctx.lineWidth = 2;
      ctx.strokeRect(w.x + 1, w.y + 1, w.w - 2, w.h - 2);
      if (isBrick && w.hp === 1) {
        ctx.fillStyle = "rgba(0,0,0,.20)";
        ctx.fillRect(w.x + 4, w.y + 4, w.w - 8, w.h - 8);
      }
    }
  }

  function drawTank(t, color) {
    ctx.save();
    // shadow
    ctx.fillStyle = COLORS.shadow;
    ctx.beginPath();
    ctx.ellipse(t.x + 3, t.y + 5, t.r * 1.05, t.r * 0.9, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.translate(t.x, t.y);
    ctx.rotate(t.angle);

    // body
    ctx.fillStyle = color;
    ctx.strokeStyle = "rgba(0,0,0,.35)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(-t.r, -t.r * 0.75, t.r * 2, t.r * 1.5, 8);
    ctx.fill();
    ctx.stroke();

    // treads
    ctx.fillStyle = "rgba(0,0,0,.22)";
    ctx.fillRect(-t.r, -t.r * 0.85, t.r * 2, 5);
    ctx.fillRect(-t.r, t.r * 0.85 - 5, t.r * 2, 5);

    // turret
    ctx.fillStyle = "rgba(255,255,255,.14)";
    ctx.beginPath();
    ctx.arc(0, 0, t.r * 0.55, 0, Math.PI * 2);
    ctx.fill();

    // barrel
    ctx.fillStyle = "rgba(0,0,0,.25)";
    ctx.beginPath();
    ctx.roundRect(2, -3.5, t.r + 12, 7, 4);
    ctx.fill();

    ctx.restore();

    if (t.kind === "player" && t.invuln > 0) {
      const a = 0.25 + 0.25 * Math.sin(state.t * 18);
      ctx.save();
      ctx.strokeStyle = `rgba(110,231,255,${a})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(t.x, t.y, t.r + 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawBullets() {
    for (const b of state.bullets) {
      ctx.save();
      ctx.fillStyle = b.ownerKind === "player" ? COLORS.bullet : "rgba(255,77,109,.95)";
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawParticles() {
    for (const p of state.particles) {
      const a = clamp(p.life / 0.65, 0, 1);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function render() {
    // background
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#0b1020");
    g.addColorStop(1, "#070a14");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    drawGrid();
    drawTiles();
    drawWalls();

    // Tanks
    if (state.player) drawTank(state.player, COLORS.player);
    for (const e of state.enemies) drawTank(e, COLORS.enemy);

    drawBullets();
    drawParticles();

    // Vignette
    const vg = ctx.createRadialGradient(W / 2, H / 2, 120, W / 2, H / 2, 520);
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(0,0,0,.38)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);

    if (state.mode === "paused") {
      ctx.save();
      ctx.fillStyle = "rgba(0,0,0,.22)";
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
  }

  function frame(ts) {
    const t = ts / 1000;
    let dt = t - (state.lastTs || t);
    state.lastTs = t;
    state.t = t;
    dt = clamp(dt, 0, 0.033); // avoid huge jumps

    update(dt);
    render();

    requestAnimationFrame(frame);
  }

  // Polyfill for roundRect (older browsers)
  if (!CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
      const rr = Array.isArray(r) ? r : [r, r, r, r];
      const [r1, r2, r3, r4] = rr.map((v) => Math.max(0, Math.min(v, Math.min(w, h) / 2)));
      this.beginPath();
      this.moveTo(x + r1, y);
      this.lineTo(x + w - r2, y);
      this.quadraticCurveTo(x + w, y, x + w, y + r2);
      this.lineTo(x + w, y + h - r3);
      this.quadraticCurveTo(x + w, y + h, x + w - r3, y + h);
      this.lineTo(x + r4, y + h);
      this.quadraticCurveTo(x, y + h, x, y + h - r4);
      this.lineTo(x, y + r1);
      this.quadraticCurveTo(x, y, x + r1, y);
      return this;
    };
  }

  // init
  restart();
  requestAnimationFrame(frame);
})();
