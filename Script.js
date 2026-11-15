
(() => {
  "use strict";

  if (typeof Chess === "undefined") {
    alert("체스 규칙 라이브러리를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.");
    return;
  }

  const $ = id => document.getElementById(id);
  const game = new Chess();

  const SYMBOLS = {
    w: { k: "♔", q: "♕", r: "♖", b: "♗", n: "♘", p: "♙" },
    b: { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" }
  };

  const VALUES = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };
  const boardElement = $("board");

  let selectedSquare = null;
  let legalMoves = [];
  let boardFlipped = false;
  let whiteTime = 300;
  let blackTime = 300;
  let initialTimeSeconds = 300;
  let activeColor = "w";
  let timerInterval = null;
  let lastClockTick = Date.now();
  let timeoutWinner = null;
  let pendingPromotion = null;
  let botTimer = null;
  let botThinking = false;
  let gameToken = 0;
  let gameStarted = false;

  // 실제 포획 점수와 무르기 복구용 기록
  let whiteScore = 0;
  let blackScore = 0;
  let scoreHistory = [{ white: 0, black: 0 }];
  let resignedWinner = null;
  let agreedDraw = false;

  const mode = () => $("modeSelect").value;
  const humanColor = () => $("humanColorSelect").value;
  const botColor = () => humanColor() === "w" ? "b" : "w";
  const isBotGame = () => mode() === "bot";
  const isHumanTurn = () => !isBotGame() || game.turn() === humanColor();

  function squareName(row, col) {
    return "abcdefgh"[col] + (8 - row);
  }

  function renderBoard() {
    boardElement.innerHTML = "";
    const board = game.board();

    for (let dr = 0; dr < 8; dr++) {
      for (let dc = 0; dc < 8; dc++) {
        const row = boardFlipped ? 7 - dr : dr;
        const col = boardFlipped ? 7 - dc : dc;
        const name = squareName(row, col);
        const piece = board[row][col];
        const square = document.createElement("button");

        square.type = "button";
        square.className = `square ${(row + col) % 2 === 0 ? "light" : "dark"}`;
        square.dataset.square = name;
        square.setAttribute(
          "aria-label",
          `${name}${piece ? ` ${piece.color === "w" ? "백" : "흑"} 기물` : " 빈칸"}`
        );

        if (selectedSquare === name) square.classList.add("selected");

        if (piece) {
          const pieceElement = document.createElement("span");
          pieceElement.className = `piece ${piece.color === "w" ? "white-piece" : "black-piece"}`;
          pieceElement.textContent = SYMBOLS[piece.color][piece.type];
          pieceElement.setAttribute("aria-hidden", "true");
          square.appendChild(pieceElement);
        }

        if (legalMoves.some(move => move.to === name)) {
          square.classList.add(piece ? "legal-capture" : "legal-move");
        }

        square.addEventListener("click", () => handleSquareClick(name));
        boardElement.appendChild(square);
      }
    }

    updateStatus();
    updateMoveList();
    updateScores();
    updateClocksDisplay();
    updatePlayerLabels();
    updateStartOverlay();
  }

  function updateStartOverlay() {
    const overlay = $("startOverlay");
    if (overlay) overlay.classList.toggle("hidden", gameStarted);
  }

  function startGame() {
    if (gameStarted || game.game_over() || timeoutWinner || resignedWinner || agreedDraw) return;

    gameStarted = true;
    lastClockTick = Date.now();

    updateStartOverlay();
    updateStatus();
    updateClocksDisplay();
    startClock();

    // 흑으로 플레이하면 시작 버튼을 누른 뒤에만 봇의 첫 수가 진행됩니다.
    if (isBotGame() && game.turn() === botColor()) {
      scheduleBotMove();
    }
  }

  function handleSquareClick(square) {
    if (
      !gameStarted ||
      game.game_over() ||
      agreedDraw ||
      timeoutWinner ||
      resignedWinner ||
      pendingPromotion ||
      botThinking ||
      !isHumanTurn()
    ) return;

    const piece = game.get(square);

    if (selectedSquare) {
      const move = legalMoves.find(item => item.to === square);

      if (move) {
        const movingPiece = game.get(selectedSquare);
        const promotes = movingPiece &&
          movingPiece.type === "p" &&
          (
            (movingPiece.color === "w" && square.endsWith("8")) ||
            (movingPiece.color === "b" && square.endsWith("1"))
          );

        if (promotes) {
          showPromotionDialog(selectedSquare, square);
          return;
        }

        makeMove(selectedSquare, square);
        return;
      }
    }

    if (piece && piece.color === game.turn()) {
      selectedSquare = square;
      legalMoves = game.moves({ square, verbose: true });
    } else {
      selectedSquare = null;
      legalMoves = [];
    }

    renderBoard();
  }

  function makeMove(from, to, promotion = "q") {
    if (!gameStarted || agreedDraw || resignedWinner || timeoutWinner || game.game_over()) return false;

    const move = game.move({ from, to, promotion });
    if (!move) return false;

    // 잡은 기물의 점수만 획득합니다. 앙파상도 captured 값으로 계산됩니다.
    if (move.captured) {
      const capturedValue = { p: 1, n: 3, b: 3, r: 5, q: 9 }[move.captured] || 0;
      if (move.color === "w") whiteScore += capturedValue;
      else blackScore += capturedValue;
    }

    scoreHistory.push({ white: whiteScore, black: blackScore });

    selectedSquare = null;
    legalMoves = [];
    activeColor = game.turn();
    lastClockTick = Date.now();

    if (game.game_over()) stopClock();

    renderBoard();

    if (
      isBotGame() &&
      !game.game_over() &&
      !timeoutWinner &&
      game.turn() === botColor()
    ) {
      scheduleBotMove();
    }

    return true;
  }

  function showPromotionDialog(from, to) {
    pendingPromotion = { from, to };
    const optionsElement = $("promotionOptions");
    optionsElement.innerHTML = "";
    const color = game.turn();

    [["q", "퀸"], ["r", "룩"], ["b", "비숍"], ["n", "나이트"]]
      .forEach(([type, label]) => {
        const button = document.createElement("button");
        const symbol = document.createElement("span");
        symbol.textContent = SYMBOLS[color][type];
        button.append(symbol, document.createTextNode(label));
        button.type = "button";

        button.addEventListener("click", () => {
          const move = pendingPromotion;
          closePromotionDialog();
          if (move) makeMove(move.from, move.to, type);
        });

        optionsElement.appendChild(button);
      });

    $("promotionModal").classList.remove("hidden");
  }

  function closePromotionDialog() {
    pendingPromotion = null;
    $("promotionModal").classList.add("hidden");
  }

  function updateStatus() {
    let title;
    let detail;

    if (agreedDraw) {
      title = "무승부 · 양측 합의";
      detail = "두 플레이어가 무승부에 합의하여 대국이 종료되었습니다.";
    } else if (resignedWinner) {
      const resignedColor = resignedWinner === "w" ? "b" : "w";
      title = `${resignedWinner === "w" ? "백" : "흑"} 승리 · 기권`;
      detail = `${resignedColor === "w" ? "백" : "흑"} 플레이어가 기권했습니다.`;
    } else if (timeoutWinner) {
      title = `${timeoutWinner === "w" ? "백" : "흑"} 승리 · 시간 초과`;
      detail = "상대 플레이어의 시간이 모두 소진되었습니다.";
    } else if (game.in_checkmate()) {
      const winner = game.turn() === "w" ? "흑" : "백";
      title = `${winner} 승리 · 체크메이트`;
      detail = "왕이 체크 상태이며 합법적인 수가 없습니다.";
    } else if (game.in_stalemate()) {
      title = "스테일메이트 · 무승부";
      detail = "현재 차례인 플레이어는 체크 상태가 아니지만 합법적인 수가 없습니다. 무승부입니다.";
    } else if (game.in_draw()) {
      title = "무승부";
      detail = "체스 규칙에 따라 무승부가 되었습니다.";
    } else if (!gameStarted) {
      title = "게임 시작 대기 중";
      detail = "체스판의 게임 시작 버튼을 누르면 대국과 타이머가 시작됩니다.";
    } else if (botThinking) {
      title = "봇이 생각 중…";
      detail = `${$("difficultySelect").selectedOptions[0].textContent} 난이도로 다음 수를 고르고 있습니다.`;
    } else if (game.in_check()) {
      title = `${game.turn() === "w" ? "백" : "흑"} 차례 · 체크`;
      detail = "왕이 공격받고 있습니다. 체크를 해소해야 합니다.";
    } else {
      title = `${game.turn() === "w" ? "백" : "흑"} 차례`;
      detail = isBotGame()
        ? (isHumanTurn() ? "기물을 선택한 다음 이동할 칸을 선택하세요." : "봇의 차례입니다.")
        : "기물을 선택한 다음 이동할 칸을 선택하세요.";
    }

    $("status").textContent = title;
    $("statusDetail").textContent = detail;

    // 경기가 끝나면 결과를 큰 화면으로 알립니다.
    const gameFinished = agreedDraw || !!resignedWinner || !!timeoutWinner || game.game_over();
    const resultModal = $("resultModal");

    if (resultModal) {
      if (gameFinished) {
        let resultTitle = title;

        if (resignedWinner || timeoutWinner || game.in_checkmate()) {
          resultTitle = `${title.split(" · ")[0]}!`;
        } else if (agreedDraw || game.in_stalemate() || game.in_draw()) {
          resultTitle = "무승부!";
        }

        $("resultTitle").textContent = resultTitle;
        $("resultDetail").textContent = detail;
        resultModal.classList.remove("hidden");
      } else {
        resultModal.classList.add("hidden");
      }
    }

    $("undoMove").disabled = game.history().length === 0 || gameFinished;

    const resignButton = $("resignGame");
    if (resignButton) resignButton.disabled = !gameStarted || gameFinished;

    const drawButton = $("drawOffer");
    if (drawButton) drawButton.disabled = !gameStarted || isBotGame() || gameFinished;
  }

  function updateMoveList() {
    const list = $("moveList");
    list.innerHTML = "";
    const history = game.history();

    if (!history.length) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = "아직 이동 기록이 없습니다.";
      list.appendChild(empty);
      return;
    }

    for (let i = 0; i < history.length; i += 2) {
      const row = document.createElement("div");
      row.className = "move-row";

      const number = document.createElement("span");
      number.textContent = `${Math.floor(i / 2) + 1}.`;

      const white = document.createElement("span");
      white.textContent = history[i];

      const black = document.createElement("span");
      black.textContent = history[i + 1] || "";

      row.append(number, white, black);
      list.appendChild(row);
    }

    list.scrollTop = list.scrollHeight;
  }

  function updateScores() {
    $("whiteScore").textContent = `${whiteScore}점`;
    $("blackScore").textContent = `${blackScore}점`;
  }

  function updatePlayerLabels() {
    const botW = isBotGame() && botColor() === "w";
    const botB = isBotGame() && botColor() === "b";

    $("whitePlayerName").textContent = botW
      ? "백 (봇)"
      : (isBotGame() ? "백 (내 기물)" : "백 (White)");

    $("blackPlayerName").textContent = botB
      ? "흑 (봇)"
      : (isBotGame() ? "흑 (내 기물)" : "흑 (Black)");

    $("whitePlayerRole").textContent = botW
      ? "봇 플레이어"
      : (isBotGame() ? "내 플레이어" : "플레이어 1");

    $("blackPlayerRole").textContent = botB
      ? "봇 플레이어"
      : (isBotGame() ? "내 플레이어" : "플레이어 2");

    $("humanColorSelect").disabled = !isBotGame();
    $("difficultySelect").disabled = !isBotGame();

    $("modeHint").textContent = isBotGame()
      ? `${humanColor() === "w" ? "백" : "흑"}으로 봇과 대전합니다. 봇은 ${botColor() === "w" ? "백" : "흑"}을 맡습니다.`
      : "같은 기기에서 두 사람이 번갈아 두는 모드입니다.";
  }

  function formatTime(seconds) {
    seconds = Math.max(0, Math.ceil(seconds));
    return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  }

  function updateClocksDisplay() {
    $("whiteClock").textContent = formatTime(whiteTime);
    $("blackClock").textContent = formatTime(blackTime);

    $("whiteClock").classList.toggle(
      "active-clock",
      gameStarted && activeColor === "w" && !timeoutWinner && !resignedWinner && !agreedDraw && !game.game_over()
    );

    $("blackClock").classList.toggle(
      "active-clock",
      gameStarted && activeColor === "b" && !timeoutWinner && !resignedWinner && !agreedDraw && !game.game_over()
    );
  }

  function tickClock() {
    if (!gameStarted || timeoutWinner || resignedWinner || agreedDraw || game.game_over()) {
      stopClock();
      return;
    }

    const now = Date.now();
    const elapsed = (now - lastClockTick) / 1000;
    lastClockTick = now;

    if (activeColor === "w") {
      whiteTime = Math.max(0, whiteTime - elapsed);
    } else {
      blackTime = Math.max(0, blackTime - elapsed);
    }

    if (whiteTime <= 0) {
      timeoutWinner = "b";
      stopClock();
      cancelBotMove();
    } else if (blackTime <= 0) {
      timeoutWinner = "w";
      stopClock();
      cancelBotMove();
    }

    updateClocksDisplay();
    updateStatus();
  }

  function startClock() {
    if (!gameStarted) return;

    stopClock();
    lastClockTick = Date.now();
    timerInterval = window.setInterval(tickClock, 200);
  }

  function stopClock() {
    if (timerInterval !== null) {
      window.clearInterval(timerInterval);
      timerInterval = null;
    }
  }

  function resetClock(minutes) {
    stopClock();
    initialTimeSeconds = minutes * 60;
    whiteTime = initialTimeSeconds;
    blackTime = initialTimeSeconds;
    activeColor = "w";
    timeoutWinner = null;
    lastClockTick = Date.now();
    updateClocksDisplay();
  }

  function cancelBotMove() {
    if (botTimer !== null) {
      clearTimeout(botTimer);
      botTimer = null;
    }

    botThinking = false;
    gameToken++;
  }

  // 기물 가치, 중앙 장악, 폰의 전진을 이용해 포지션을 평가합니다.
  function evaluatePosition(color) {
    const board = game.board();
    let score = 0;

    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const piece = board[r][c];
        if (!piece) continue;

        const sign = piece.color === color ? 1 : -1;
        score += sign * VALUES[piece.type];

        const center = 3.5 - (Math.abs(3.5 - r) + Math.abs(3.5 - c)) / 2;

        if (piece.type === "n" || piece.type === "b") {
          score += sign * center * 11;
        }

        if (piece.type === "p") {
          const advance = piece.color === "w" ? 6 - r : r - 1;
          score += sign * advance * 8;
        }

        if (piece.type === "q") {
          score += sign * center * 3;
        }
      }
    }

    if (game.in_check()) {
      score += game.turn() === color ? -35 : 35;
    }

    return score;
  }

  function moveOrderScore(move) {
    let score = 0;

    if (move.captured) {
      score += VALUES[move.captured] - VALUES[move.piece] / 10;
    }

    if (move.promotion) score += VALUES[move.promotion];
    if (move.san && move.san.includes("+")) score += 40;

    return score;
  }

  // 알파-베타 가지치기를 사용해 몇 수 앞을 탐색합니다.
  function minimax(depth, alpha, beta, maximizingColor, rootColor) {
    if (depth <= 0 || game.game_over()) {
      if (game.in_checkmate()) {
        return game.turn() === rootColor ? -100000 - depth : 100000 + depth;
      }

      if (game.in_draw()) return 0;

      return evaluatePosition(rootColor);
    }

    const moves = game.moves({ verbose: true });
    moves.sort((a, b) => moveOrderScore(b) - moveOrderScore(a));

    if (maximizingColor) {
      let best = -Infinity;

      for (const move of moves) {
        game.move({ from: move.from, to: move.to, promotion: move.promotion || "q" });
        const value = minimax(depth - 1, alpha, beta, false, rootColor);
        game.undo();

        best = Math.max(best, value);
        alpha = Math.max(alpha, best);

        if (beta <= alpha) break;
      }

      return best;
    }

    let best = Infinity;

    for (const move of moves) {
      game.move({ from: move.from, to: move.to, promotion: move.promotion || "q" });
      const value = minimax(depth - 1, alpha, beta, true, rootColor);
      game.undo();

      best = Math.min(best, value);
      beta = Math.min(beta, best);

      if (beta <= alpha) break;
    }

    return best;
  }

  function chooseBotMove() {
    const difficulty = $("difficultySelect").value;
    const depth = difficulty === "easy" ? 1 : difficulty === "hard" ? 3 : 2;
    const rootColor = game.turn();
    const moves = game.moves({ verbose: true });

    if (!moves.length) return null;

    if (difficulty === "easy") {
      moves.sort((a, b) => moveOrderScore(b) - moveOrderScore(a));
      const pool = moves.slice(0, Math.min(5, moves.length));
      return pool[Math.floor(Math.random() * pool.length)];
    }

    let bestMove = null;
    let bestScore = -Infinity;

    const ordered = moves.slice().sort((a, b) => moveOrderScore(b) - moveOrderScore(a));

    for (const move of ordered) {
      game.move({ from: move.from, to: move.to, promotion: move.promotion || "q" });
      const score = minimax(depth - 1, -Infinity, Infinity, false, rootColor);
      game.undo();

      const jitter = difficulty === "medium" ? Math.random() * 8 : Math.random() * 0.5;

      if (score + jitter > bestScore) {
        bestScore = score + jitter;
        bestMove = move;
      }
    }

    return bestMove;
  }

  function scheduleBotMove() {
    if (!gameStarted) return;

    cancelBotMove();
    const token = gameToken;
    botThinking = true;
    updateStatus();

    botTimer = window.setTimeout(() => {
      botTimer = null;

      if (
        token !== gameToken ||
        !gameStarted ||
        !isBotGame() ||
        game.turn() !== botColor() ||
        game.game_over() ||
        timeoutWinner ||
        resignedWinner ||
        agreedDraw
      ) {
        botThinking = false;
        updateStatus();
        return;
      }

      const move = chooseBotMove();
      botThinking = false;

      if (move) {
        makeMove(move.from, move.to, move.promotion || "q");
      } else {
        renderBoard();
      }
    }, 280);
  }

  function startNewGame() {
    cancelBotMove();
    gameStarted = false;
    game.reset();

    selectedSquare = null;
    legalMoves = [];
    whiteScore = 0;
    blackScore = 0;
    scoreHistory = [{ white: 0, black: 0 }];
    resignedWinner = null;
    agreedDraw = false;

    closePromotionDialog();

    resetClock(Number($("timeSelect").value) || 5);
    renderBoard();
  }

  function undoMove() {
    if (!game.history().length || resignedWinner || agreedDraw) return;

    cancelBotMove();
    closePromotionDialog();

    game.undo();

    if (scoreHistory.length > 1) {
      scoreHistory.pop();
    }

    // 봇이 응수한 뒤라면 사람의 직전 수까지 함께 무릅니다.
    if (
      isBotGame() &&
      game.history().length &&
      game.turn() !== humanColor()
    ) {
      game.undo();

      if (scoreHistory.length > 1) {
        scoreHistory.pop();
      }
    }

    const restoredScore = scoreHistory[scoreHistory.length - 1] || {
      white: 0,
      black: 0
    };

    whiteScore = restoredScore.white;
    blackScore = restoredScore.black;

    selectedSquare = null;
    legalMoves = [];
    timeoutWinner = null;
    botThinking = false;
    activeColor = game.turn();
    whiteTime = initialTimeSeconds;
    blackTime = initialTimeSeconds;
    lastClockTick = Date.now();

    updateClocksDisplay();
    renderBoard();

    if (gameStarted) startClock();

    if (gameStarted && isBotGame() && game.turn() === botColor() && !game.game_over()) {
      scheduleBotMove();
    }
  }

  function resignGame() {
    if (!gameStarted || agreedDraw || resignedWinner || timeoutWinner || game.game_over()) return;

    if (!window.confirm("정말 기권하시겠습니까?")) return;

    cancelBotMove();
    closePromotionDialog();

    selectedSquare = null;
    legalMoves = [];

    // 봇 대전에서는 사람의 기권으로 처리하고, 2인 대전에서는 현재 차례가 기권합니다.
    resignedWinner = isBotGame()
      ? botColor()
      : (game.turn() === "w" ? "b" : "w");

    stopClock();
    renderBoard();
  }

  function offerDraw() {
    if (!gameStarted) return;

    if (isBotGame()) {
      window.alert("합의 무승부는 사람 대 사람 모드에서만 사용할 수 있습니다.");
      return;
    }

    if (agreedDraw || resignedWinner || timeoutWinner || game.game_over()) return;

    const accepted = window.confirm(
      "무승부 제안입니다.\n\n" +
      "상대방에게 기기를 넘긴 뒤, 상대방이 동의하면 확인을 누르세요.\n" +
      "거절하려면 취소를 누르세요."
    );

    if (!accepted) return;

    agreedDraw = true;

    cancelBotMove();
    closePromotionDialog();

    selectedSquare = null;
    legalMoves = [];

    stopClock();
    renderBoard();
  }

  $("newGame").addEventListener("click", startNewGame);
  $("startGameButton").addEventListener("click", startGame);

  if ($("resultNewGame")) {
    $("resultNewGame").addEventListener("click", startNewGame);
  }

  $("undoMove").addEventListener("click", undoMove);

  if ($("resignGame")) {
    $("resignGame").addEventListener("click", resignGame);
  }

  if ($("drawOffer")) {
    $("drawOffer").addEventListener("click", offerDraw);
  }

  $("flipBoard").addEventListener("click", () => {
    boardFlipped = !boardFlipped;
    renderBoard();
  });

  $("themeSelect").addEventListener("change", event => {
    document.body.dataset.theme = event.target.value;
  });

  $("timeSelect").addEventListener("change", startNewGame);
  $("modeSelect").addEventListener("change", startNewGame);
  $("humanColorSelect").addEventListener("change", startNewGame);

  $("difficultySelect").addEventListener("change", () => {
    if (botThinking) scheduleBotMove();
    updatePlayerLabels();
  });

  if ($("layoutSelect")) {
    $("layoutSelect").addEventListener("change", event => {
      document.body.dataset.layout = event.target.value;
    });

    document.body.dataset.layout = $("layoutSelect").value;
  }

  $("promotionModal").addEventListener("click", event => {
    if (event.target === $("promotionModal")) {
      closePromotionDialog();
    }
  });

  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && pendingPromotion) {
      closePromotionDialog();
    }
  });

  document.body.dataset.theme = $("themeSelect").value;
  startNewGame();
})();
