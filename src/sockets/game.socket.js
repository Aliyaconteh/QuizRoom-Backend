const { supabaseAdmin } = require("../config/supabase.config");
const { metricsCollector } = require("../utils/metricsCollector");

class GameSocketHandler {
  constructor(io) {
    this.io = io;
    this.rooms = new Map();
  }

  registerEvents(socket) {
    socket.on("start-game", (data) => this.handleStartGame(socket, data));
    socket.on("start-quiz", (data) => this.handleStartGame(socket, data));
    socket.on("game:join", (data) => this.handleGameJoin(socket, data));
    socket.on("game:answer", (data) => this.handleAnswerSubmission(socket, data));
    socket.on("submit_answer", (data) => this.handleAnswerSubmission(socket, data));
    socket.on("submitAnswer", (data) => this.handleAnswerSubmission(socket, data));
    socket.on("next-question", (data) => this.handleNextQuestion(socket, data));
    socket.on("next_question", (data) => this.handleNextQuestion(socket, data));
    socket.on("quiz_end", (data) => this.handleQuizEnd(socket, data));
    socket.on("quiz-end", (data) => this.handleQuizEnd(socket, data));
  }

  async handleStartGame(socket, data) {
    try {
      const { roomCode } = data;

      const { data: room, error: roomError } = await supabaseAdmin
        .from("rooms")
        .select("*")
        .eq("room_code", roomCode)
        .single();

      if (roomError || !room) {
        socket.emit("error", { message: "Room not found" });
        return;
      }

      const { data: questions, error: questionError } = await supabaseAdmin
        .from("questions")
        .select("*")
        .eq("quiz_id", room.quiz_id);

      if (questionError || !questions || questions.length === 0) {
        socket.emit("error", { message: "No questions found for this quiz" });
        return;
      }

      this.rooms.set(roomCode, {
        id: room.id,
        roomCode,
        hostId: room.host_id,
        questions,
        currentQuestionIndex: 0,
        syncMode: room.sync_mode || "server",
        delayLevel: room.delay_level || "low",
        delayMs: Number(room.delay_ms || 0),
        status: "active",
        questionStartTime: Date.now(),
        questionEndTime: null,
        timerInterval: null,
        timerTimeout: null,
        submittedAnswers: new Set(),
        answerResults: new Map(),
        previousRanks: new Map(),
        leaderboardTimer: null
      });

      this.io.to(roomCode).emit("room:started", { roomCode });

      setTimeout(() => {
        this.broadcastQuestion(roomCode, 0);
      }, 1000);
    } catch (err) {
      console.error("Error starting game:", err);
      socket.emit("error", { message: `Failed to start game: ${err.message}` });
    }
  }

  async handleGameJoin(socket, data = {}) {
    const { roomCode, username, playerId } = data;
    if (!roomCode) return;

    socket.join(roomCode);
    socket.username = username || socket.username || "Guest";
    socket.playerId = playerId || socket.playerId || socket.id;

    const roomState = this.rooms.get(roomCode);
    if (!roomState) return;

    const question = roomState.questions[roomState.currentQuestionIndex];
    if (question) {
      socket.emit("game:question", this.formatQuestion(roomState, question));
      socket.emit("game:timer", {
        time: this.getSecondsRemaining(roomState),
        serverTime: Date.now(),
        questionEndsAt: roomState.questionEndTime
      });
    }

    await this.broadcastLeaderboard(roomCode);
  }

  broadcastQuestion(roomCode, questionIndex) {
    const roomState = this.rooms.get(roomCode);
    if (!roomState) return;

    this.clearQuestionTimers(roomState);

    const question = roomState.questions[questionIndex];
    if (!question) {
      this.handleQuizCompletion(roomCode);
      return;
    }

    roomState.currentQuestionIndex = questionIndex;
    roomState.questionStartTime = Date.now();
    const timeLimit = this.getQuestionTimeLimit(question);
    roomState.questionEndTime = roomState.questionStartTime + timeLimit * 1000;
    roomState.submittedAnswers = new Set();
    roomState.answerResults = new Map();

    this.io.to(roomCode).emit("game:question", this.formatQuestion(roomState, question));

    this.io.to(roomCode).emit("game:timer", {
      time: timeLimit,
      serverTime: Date.now(),
      questionEndsAt: roomState.questionEndTime
    });

    roomState.timerInterval = setInterval(() => {
      const secondsRemaining = this.getSecondsRemaining(roomState);
      this.io.to(roomCode).emit("game:timer", {
        time: secondsRemaining,
        serverTime: Date.now(),
        questionEndsAt: roomState.questionEndTime
      });

      if (secondsRemaining <= 0) {
        clearInterval(roomState.timerInterval);
        roomState.timerInterval = null;
      }
    }, 1000);

    roomState.timerTimeout = setTimeout(() => {
      this.advanceQuestion(roomCode, questionIndex);
    }, timeLimit * 1000);
  }

  formatQuestion(roomState, question) {
    return {
      questionNumber: roomState.currentQuestionIndex + 1,
      totalQuestions: roomState.questions.length,
      serverTime: Date.now(),
      questionStartedAt: roomState.questionStartTime,
      questionEndsAt: roomState.questionEndTime,
      question: {
        id: question.id,
        text: question.question,
        options: Array.isArray(question.options) ? question.options : [],
        timeLimit: this.getQuestionTimeLimit(question)
      }
    };
  }

  async handleAnswerSubmission(socket, data = {}) {
    try {
      const { roomCode, answer, selectedOption, clientTimestamp, clientPredictedScore, username, playerId } = data;
      const selectedAnswer = selectedOption ?? answer;
      const roomState = this.rooms.get(roomCode);

      if (!roomState) {
        socket.emit("error", { message: "Active game not found" });
        return;
      }

      const question = roomState.questions[roomState.currentQuestionIndex];
      if (!question) {
        socket.emit("error", { message: "No active question" });
        return;
      }

      const receivedAt = Date.now();
      if (roomState.questionEndTime && receivedAt > roomState.questionEndTime) {
        socket.emit("submission_rejected", {
          reason: "Time is up for this question",
          timestamp: receivedAt
        });
        return;
      }

      const player = await this.findPlayer(
        roomState.id,
        username || socket.username,
        playerId || socket.playerId || socket.id
      );

      if (!player) {
        socket.emit("error", { message: "Player not registered in this room" });
        return;
      }

      const answerKey = `${player.id}:${question.id}`;
      if (roomState.submittedAnswers.has(answerKey)) {
        socket.emit("submission_rejected", {
          reason: "Answer already submitted for this question",
          timestamp: Date.now()
        });
        return;
      }
      roomState.submittedAnswers.add(answerKey);

      if (roomState.delayMs > 0) {
        await this.sleep(roomState.delayMs);
      }

      const serverTimestamp = Date.now();
      const submittedAt = Number(clientTimestamp || serverTimestamp);
      const responseTime = Math.max(0, serverTimestamp - roomState.questionStartTime);
      const isCorrect = String(selectedAnswer).trim() === String(question.correct_answer).trim();
      const pointsAwarded = this.computeScore(isCorrect, responseTime, this.getQuestionTimeLimit(question));
      const serverScore = Number(player.score || 0) + pointsAwarded;
      const predictedScore = Number(clientPredictedScore || 0);

      const { error: answerError } = await supabaseAdmin
        .from("answers")
        .upsert([{
          room_id: roomState.id,
          player_id: player.id,
          user_id: null,
          question_id: question.id,
          selected_answer: selectedAnswer,
          selected_option: selectedAnswer,
          points_awarded: pointsAwarded,
          is_correct: isCorrect,
          response_time: responseTime
        }], { onConflict: "room_id,player_id,question_id" });

      if (answerError) throw answerError;

      const { error: playerError } = await supabaseAdmin
        .from("room_players")
        .update({ score: serverScore })
        .eq("id", player.id);

      if (playerError) throw playerError;

      await supabaseAdmin
        .from("leaderboard")
        .upsert([{
          room_id: roomState.id,
          player_id: player.id,
          user_id: null,
          score: serverScore,
          updated_at: new Date()
        }], { onConflict: "room_id,player_id" });

      await supabaseAdmin
        .from("synchronization_logs")
        .insert([{
          room_id: roomState.id,
          player_id: player.id,
          user_id: null,
          question_id: question.id,
          sync_mode: roomState.syncMode,
          event_type: "answer-submission",
          delay_level: roomState.delayLevel,
          artificial_delay_ms: roomState.delayMs,
          client_timestamp: submittedAt,
          server_timestamp: serverTimestamp,
          latency: Math.max(0, serverTimestamp - submittedAt),
          predicted_score: predictedScore,
          server_score: serverScore,
          reconciliation_required: predictedScore > 0 && predictedScore !== serverScore,
          score_difference: predictedScore - serverScore
        }]);

      metricsCollector.recordSubmission(socket.id, {
        roomId: roomState.id,
        playerId: player.id,
        questionId: question.id,
        answer: selectedAnswer,
        syncModel: roomState.syncMode,
        clientTimestamp: submittedAt,
        clientPredictedScore: predictedScore
      });

      socket.emit("answer_confirmed", {
        isCorrect,
        pointsAwarded,
        score: serverScore,
        serverScore,
        timestamp: serverTimestamp,
        model: roomState.syncMode
      });

      roomState.answerResults.set(answerKey, { playerId: player.id, selectedOption: selectedAnswer, isCorrect, pointsAwarded, responseTime, revealedCorrectAnswer: null });
      socket.emit("answerResult", roomState.answerResults.get(answerKey));
      await this.broadcastLeaderboard(roomCode);
      const { count } = await supabaseAdmin.from("room_players").select("id", { count: "exact", head: true }).eq("room_id", roomState.id);
      if (count && roomState.submittedAnswers.size >= count) await this.advanceQuestion(roomCode, roomState.currentQuestionIndex);
    } catch (err) {
      console.error("Error submitting answer:", err);
      socket.emit("error", { message: `Failed to submit answer: ${err.message}` });
    }
  }

  async handleNextQuestion(socket, { roomCode }) {
    socket.emit("manual_next_disabled", {
      roomCode,
      message: "Questions advance automatically when the timer ends."
    });
  }

  async advanceQuestion(roomCode, expectedQuestionIndex) {
    const roomState = this.rooms.get(roomCode);
    if (!roomState || roomState.status !== "active") return;
    if (expectedQuestionIndex !== undefined && roomState.currentQuestionIndex !== expectedQuestionIndex) return;

    this.clearQuestionTimers(roomState);
    this.io.to(roomCode).emit("game:timer", {
      time: 0,
      serverTime: Date.now(),
      questionEndsAt: roomState.questionEndTime
    });
    this.io.to(roomCode).emit("game:timer_finished", {
      questionNumber: roomState.currentQuestionIndex + 1,
      timestamp: Date.now()
    });

    this.io.to(roomCode).emit("questionEnded", { roomCode, leaderboard: await this.broadcastLeaderboard(roomCode), duration: 5000 });
    const nextIndex = roomState.currentQuestionIndex + 1;
    if (nextIndex < roomState.questions.length) {
      setTimeout(() => this.broadcastQuestion(roomCode, nextIndex), 5000);
    } else {
      await this.handleQuizCompletion(roomCode);
    }
  }

  async handleQuizCompletion(roomCode) {
    try {
      const roomState = this.rooms.get(roomCode);
      if (!roomState) return;

      this.clearQuestionTimers(roomState);
      roomState.status = "finished";

      await supabaseAdmin
        .from("rooms")
        .update({ status: "finished" })
        .eq("id", roomState.id);

      const { data: leaderboardData, error } = await supabaseAdmin
        .from("room_players")
        .select("id, username, score, joined_at")
        .eq("room_id", roomState.id)
        .order("score", { ascending: false })
        .order("joined_at", { ascending: true });

      if (error) throw error;

      const leaderboard = (leaderboardData || []).map((player, index) => ({
        id: player.id,
        rank: index + 1,
        username: player.username,
        score: Number(player.score || 0)
      }));

      if (leaderboard.length) {
        await supabaseAdmin
          .from("session_results")
          .insert(leaderboard.map((player) => ({
            room_id: roomState.id,
            player_id: player.id,
            user_id: null,
            score: player.score,
            rank: player.rank
          })));
      }

      this.io.to(roomCode).emit("game:finished", {
        roomCode,
        scores: leaderboard,
        leaderboard
      });

      this.rooms.delete(roomCode);
    } catch (err) {
      console.error("Error completing quiz:", err);
    }
  }

  async handleQuizEnd(socket, { roomCode }) {
    await this.handleQuizCompletion(roomCode);
  }

  async broadcastLeaderboard(roomCode) {
    const roomState = this.rooms.get(roomCode);
    if (!roomState) return;

    const { data, error } = await supabaseAdmin
      .from("room_players")
      .select("id, username, score, joined_at")
      .eq("room_id", roomState.id)
      .order("score", { ascending: false })
      .order("joined_at", { ascending: true });

    if (error) {
      console.error("Failed to load leaderboard:", error.message);
      return;
    }

    const players = (data || []).map((player, index) => ({
      id: player.id,
      rank: index + 1,
      username: player.username,
      score: Number(player.score || 0)
    }));

    this.io.to(roomCode).emit("game:leaderboard", { players });
    this.io.to(roomCode).emit("leaderboard-update", { leaderboard: players });
    this.io.to(roomCode).emit("leaderboardUpdated", { leaderboard: players });
    return players;
  }

  async findPlayer(roomId, username, playerId) {
    if (username) {
      const { data } = await supabaseAdmin
        .from("room_players")
        .select("*")
        .eq("room_id", roomId)
        .eq("username", username)
        .maybeSingle();
      if (data) return data;
    }

    if (this.isUuid(playerId)) {
      const { data } = await supabaseAdmin
        .from("room_players")
        .select("*")
        .eq("room_id", roomId)
        .eq("id", playerId)
        .maybeSingle();
      if (data) return data;
    }

    if (playerId) {
      const { data } = await supabaseAdmin
        .from("room_players")
        .select("*")
        .eq("room_id", roomId)
        .eq("user_id", playerId)
        .maybeSingle();
      if (data) return data;
    }

    return null;
  }

  computeScore(isCorrect, responseTimeMs, timeLimitSeconds) {
    if (!isCorrect) return 0;

    const baseScore = 1000;
    const secondsUsed = responseTimeMs / 1000;
    const remainingRatio = Math.max(0, (timeLimitSeconds - secondsUsed) / timeLimitSeconds);
    return Math.round(baseScore * remainingRatio);
  }

  getQuestionTimeLimit(question) {
    return Math.max(5, Number(question?.time_limit || 15));
  }

  getSecondsRemaining(roomState) {
    if (!roomState.questionEndTime) return 0;
    return Math.max(0, Math.ceil((roomState.questionEndTime - Date.now()) / 1000));
  }

  clearQuestionTimers(roomState) {
    if (roomState.timerInterval) {
      clearInterval(roomState.timerInterval);
      roomState.timerInterval = null;
    }

    if (roomState.timerTimeout) {
      clearTimeout(roomState.timerTimeout);
      roomState.timerTimeout = null;
    }
  }

  isUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value || "");
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = (io, socket) => {
  if (!io.gameHandler) {
    io.gameHandler = new GameSocketHandler(io);
  }
  io.gameHandler.registerEvents(socket);
};

module.exports.GameSocketHandler = GameSocketHandler;




