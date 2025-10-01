const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Раздаем статические файлы
app.use(express.static(path.join(__dirname, "public")));

// Состояние игры
const gameState = {
  players: {},
  ball: { x: 400, y: 250, vx: 0, vy: 0 },
  score: { player1: 0, player2: 0 },
  lastKicker: null,
};

// Физика игры
const BALL_FRICTION = 0.98;
const KICK_POWER = 5;
const FIELD_WIDTH = 800;
const FIELD_HEIGHT = 500;

function updateBall() {
  // Движение мяча
  gameState.ball.x += gameState.ball.vx;
  gameState.ball.y += gameState.ball.vy;

  // Трение
  gameState.ball.vx *= BALL_FRICTION;
  gameState.ball.vy *= BALL_FRICTION;

  // Границы поля
  if (gameState.ball.x <= 10 || gameState.ball.x >= FIELD_WIDTH - 10) {
    gameState.ball.vx = -gameState.ball.vx * 0.8;
    gameState.ball.x = gameState.ball.x <= 10 ? 10 : FIELD_WIDTH - 10;
  }
  if (gameState.ball.y <= 10 || gameState.ball.y >= FIELD_HEIGHT - 10) {
    gameState.ball.vy = -gameState.ball.vy * 0.8;
    gameState.ball.y = gameState.ball.y <= 10 ? 10 : FIELD_HEIGHT - 10;
  }

  // Проверка голов
  checkGoal();
}

function checkGoal() {
  // Гол в левые ворота
  if (
    gameState.ball.x <= 20 &&
    gameState.ball.y >= 200 &&
    gameState.ball.y <= 300
  ) {
    if (gameState.lastKicker === "player2") {
      gameState.score.player2++;
      resetBall("player2");
    } else {
      resetBall(null);
    }
  }

  // Гол в правые ворота
  if (
    gameState.ball.x >= FIELD_WIDTH - 20 &&
    gameState.ball.y >= 200 &&
    gameState.ball.y <= 300
  ) {
    if (gameState.lastKicker === "player1") {
      gameState.score.player1++;
      resetBall("player1");
    } else {
      resetBall(null);
    }
  }
}

function resetBall(scorer) {
  gameState.ball.x = FIELD_WIDTH / 2;
  gameState.ball.y = FIELD_HEIGHT / 2;
  gameState.ball.vx = 0;
  gameState.ball.vy = 0;
  gameState.lastKicker = null;

  // Сброс позиций игроков
  if (gameState.players.player1) {
    gameState.players.player1.x = 100;
    gameState.players.player1.y = 250;
  }
  if (gameState.players.player2) {
    gameState.players.player2.x = 700;
    gameState.players.player2.y = 250;
  }

  if (scorer === "player1") {
    gameState.ball.vx = -2;
  } else if (scorer === "player2") {
    gameState.ball.vx = 2;
  }
}

function checkCollisions() {
  Object.keys(gameState.players).forEach((playerId) => {
    const player = gameState.players[playerId];
    const dist = Math.sqrt(
      Math.pow(player.x - gameState.ball.x, 2) +
        Math.pow(player.y - gameState.ball.y, 2)
    );

    if (dist < 25) {
      const angle = Math.atan2(
        gameState.ball.y - player.y,
        gameState.ball.x - player.x
      );
      const speed = Math.sqrt(
        gameState.ball.vx * gameState.ball.vx +
          gameState.ball.vy * gameState.ball.vy
      );

      if (speed < 1) {
        gameState.ball.vx = Math.cos(angle) * 2;
        gameState.ball.vy = Math.sin(angle) * 2;
      } else {
        gameState.ball.vx = Math.cos(angle) * speed * 0.8;
        gameState.ball.vy = Math.sin(angle) * speed * 0.8;
      }

      gameState.lastKicker = playerId;
    }
  });
}

// Игровой цикл
setInterval(() => {
  updateBall();
  checkCollisions();
  io.emit("gameState", gameState);
}, 1000 / 60); // 60 FPS

// Обработка подключений
io.on("connection", (socket) => {
  console.log("Новый игрок подключился:", socket.id);

  // Назначение роли игрока
  let playerRole = null;
  if (!gameState.players.player1) {
    playerRole = "player1";
    gameState.players.player1 = { x: 100, y: 250, id: socket.id };
  } else if (!gameState.players.player2) {
    playerRole = "player2";
    gameState.players.player2 = { x: 700, y: 250, id: socket.id };
  } else {
    // Все места заняты - наблюдатель
    playerRole = "spectator";
  }

  socket.emit("roleAssigned", playerRole);
  console.log(`Игроку ${socket.id} назначена роль: ${playerRole}`);

  // Обработка движения игрока
  socket.on("playerMove", (data) => {
    if (gameState.players[playerRole]) {
      gameState.players[playerRole].x = data.x;
      gameState.players[playerRole].y = data.y;
    }
  });

  // Обработка удара
  socket.on("kickBall", () => {
    if (gameState.players[playerRole]) {
      const player = gameState.players[playerRole];
      const dist = Math.sqrt(
        Math.pow(player.x - gameState.ball.x, 2) +
          Math.pow(player.y - gameState.ball.y, 2)
      );

      if (dist < 40) {
        const angle = Math.atan2(
          gameState.ball.y - player.y,
          gameState.ball.x - player.x
        );
        gameState.ball.vx = Math.cos(angle) * KICK_POWER;
        gameState.ball.vy = Math.sin(angle) * KICK_POWER;
        gameState.lastKicker = playerRole;
      }
    }
  });

  // Обработка отключения
  socket.on("disconnect", () => {
    console.log("Игрок отключился:", socket.id);
    if (playerRole && gameState.players[playerRole]) {
      delete gameState.players[playerRole];
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});
