const LeaderboardService = require("./leaderboard.service");
const RoomRepository = require("../rooms/room.repository");
const QuizRepository = require("../quizzes/quiz.repository");

const leaderboardService = new LeaderboardService({ to: () => ({ emit: () => {} }) });

class LeaderboardController {
  async getLive(req, res) {
    try {
      const data = await leaderboardService.getPersisted(req.params.roomCode);
      return res.json({ success: true, data });
    } catch (err) {
      return res.status(404).json({ success: false, message: err.message });
    }
  }

  async getFinal(req, res) {
    try {
      const data = await leaderboardService.getFinalResults(req.params.roomCode);
      return res.json({ success: true, data });
    } catch (err) {
      return res.status(404).json({ success: false, message: err.message });
    }
  }

  async getReview(req, res) {
    try {
      const room = await RoomRepository.getRoomByCode(req.params.roomCode);
      if (!room) throw new Error("Room not found");
      const quiz = await QuizRepository.getQuizWithQuestions(room.quiz_id);
      return res.json({
        success: true,
        data: {
          quizTitle: quiz?.title || "Quiz Review",
          questions: (quiz?.questions || []).map((q) => ({
            id: q.id,
            question: q.question,
            options: q.options,
            correct_answer: q.correct_answer,
            time_limit: q.time_limit,
            explanation: q.explanation || `The correct answer is: ${q.correct_answer}`
          }))
        }
      });
    } catch (err) {
      return res.status(404).json({ success: false, message: err.message });
    }
  }
}

module.exports = new LeaderboardController();
