const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const authRoutes = require("../modules/auth/auth.routes");
const quizRoutes = require("../modules/quizzes/quiz.routes");
const aiRoutes = require("../modules/ai/ai.routes");
const roomRoutes = require("../modules/rooms/room.routes");
const leaderboardRoutes = require("../modules/leaderboard/leaderboard.routes");
const syncRoutes = require("../modules/sync/sync.routes");

const app = express();

// Security middleware
app.use(helmet());

// Logging
app.use(morgan("dev"));

// CORS setup
const corsOptions = {
  origin: (origin, callback) => callback(null, true),
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
app.options(/(.*)/, cors(corsOptions));

// Body parser
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/auth", authRoutes);
app.use("/api/quizzes", quizRoutes);
app.use("/api/ai", aiRoutes);
app.use("/api/rooms", roomRoutes);
app.use("/api/leaderboard", leaderboardRoutes);
app.use("/api/sync", syncRoutes);

// Health check route
app.get("/health", (req, res) => {
  res.json({
    status: "OK",
    message: "KuizRoom API is running"
  });
});

// 🌱 DEVELOPMENT: Seed database with test quiz (GET or POST)
const seedDatabase = async (req, res) => {
  try {
    const QuizService = require("../modules/quizzes/quiz.service");
    
    // Create a test quiz
    const quiz = await QuizService.createQuiz({
      title: "Sample Science Quiz",
      created_by: null
    });

    // Add test questions
    const questions = [
      {
        quiz_id: quiz.id,
        question: "What is the capital of France?",
        options: ["London", "Berlin", "Paris", "Madrid"],
        correct_answer: "Paris",
        time_limit: 10
      },
      {
        quiz_id: quiz.id,
        question: "What is 2 + 2?",
        options: ["3", "4", "5", "6"],
        correct_answer: "4",
        time_limit: 5
      },
      {
        quiz_id: quiz.id,
        question: "What is the largest planet in our solar system?",
        options: ["Saturn", "Neptune", "Jupiter", "Uranus"],
        correct_answer: "Jupiter",
        time_limit: 15
      }
    ];

    for (const q of questions) {
      await QuizService.addQuestion(q);
    }

    res.json({
      success: true,
      message: "✅ Test quiz created successfully!",
      quiz
    });
  } catch (err) {
    console.error("Seed error:", err);
    res.status(400).json({
      success: false,
      message: err.message
    });
  }
};

app.get("/api/seed", seedDatabase);
app.post("/api/seed", seedDatabase);

module.exports = app;
