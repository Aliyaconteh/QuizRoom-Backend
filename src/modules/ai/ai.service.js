const { extractTextFromFile } = require("../../utils/fileExtractor");

// Only current, live Gemini models. gemini-1.5-*, gemini-1.0-*, and
// gemini-2.0-flash* have all been shut down (they now 404), and the old
// list also had a typo ("gemini-2.5-flash-lit" -> "gemini-2.5-flash-lite").
// Keeping dead models in this list just burns retries/latency before ever
// reaching a working one.
const GEMINI_MODELS = [
  "gemini-3.5-flash",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite"
];

const QUIZ_FORMAT = `Return ONLY valid JSON with no markdown, no extra text.\n\nJSON format:\n{\n  "title": "",\n  "description": "",\n  "questions": [\n    {\n      "question": "",\n      "options": ["", "", "", ""],\n      "correctAnswer": 0,\n      "difficulty": "Easy",\n      "explanation": ""\n    }\n  ]\n}`;

const CHAT_PROMPT = `You are QuizRoom Tutor, a private, patient study assistant for one learner.\nAnswer clearly and directly.\nWhen the learner asks for help, explain the concept step by step and use simple examples.\nWhen the learner asks for practice, you may ask one short question at a time and wait for the answer.\nDo not mention policies or say that you are an AI model.\nKeep responses focused on the learner's current topic and avoid unnecessary filler.`;

function buildQuizPrompt({ focusLabel, focusText, numberOfQuestions, difficulty }) {
  return `${focusLabel}\n\n${focusText}\n\nGenerate exactly ${numberOfQuestions} multiple-choice questions at ${difficulty} difficulty.\nEach question must have exactly four options. Only one option can be correct. Randomize the position of the correct answer. Avoid duplicate questions. Cover different parts of the material. ${QUIZ_FORMAT}`;
}

// Rough token budget: give each question ~600 tokens of headroom (question +
// 4 options + explanation + JSON overhead) plus a fixed base for the
// title/description/envelope, so larger quizzes don't get truncated.
function computeMaxOutputTokens(numberOfQuestions) {
  const base = 1000;
  const perQuestion = 600;
  const count = Number(numberOfQuestions) || 5;
  return Math.min(base + perQuestion * count, 16000);
}

class AIService {
  constructor() {
    this.apiKey = process.env.GEMINI_API_KEY;
    if (!this.apiKey) {
      throw new Error("Gemini API key not configured in GEMINI_API_KEY");
    }
  }

  async callGemini({ prompt, json = false, maxOutputTokens = 2000, temperature = 0.7 }) {
    let response;
    let data;
    let lastError;

    for (const model of GEMINI_MODELS) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": this.apiKey
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature,
            maxOutputTokens,
            ...(json ? { responseMimeType: "application/json" } : {})
          }
        })
      });

      data = await response.json();
      if (response.ok) {
        break;
      }

      lastError = data.error?.message || `Gemini API returned status ${response.status}`;
      const isRetryable = /high demand|quota|temporar|try again later|backend unavailable|unavailable/i.test(lastError);
      if (!isRetryable) {
        throw new Error(lastError);
      }
    }

    if (!response?.ok) {
      throw new Error(lastError || "Gemini API request failed.");
    }

    const finishReason = data?.candidates?.[0]?.finishReason;
    if (finishReason && finishReason !== "STOP") {
      console.warn(`[AI] Gemini finishReason was "${finishReason}" (expected "STOP") - output may be truncated or blocked.`);
    }

    return data;
  }

  async generateQuizFromDocument({ hostId, documentPath, documentName, numberOfQuestions, difficulty }) {
    if (!hostId) throw new Error("Host authorization required");
    if (!documentPath) throw new Error("Document path is required");

    const content = await extractTextFromFile(documentPath, documentName);
    if (!content || !content.trim()) {
      throw new Error("Uploaded document contains no readable text.");
    }

    const prompt = buildQuizPrompt({
      focusLabel: "Read the uploaded document carefully and generate a quiz based only on the content below.",
      focusText: `Document content:\n${content}`,
      numberOfQuestions,
      difficulty
    });

    const data = await this.callGemini({
      prompt,
      json: true,
      maxOutputTokens: computeMaxOutputTokens(numberOfQuestions),
      temperature: 0.7
    });

    const rawOutput = this.extractTextFromGeminiResponse(data);

    if (!rawOutput) {
      throw new Error("Invalid response from Gemini API.");
    }

    const quiz = this.parseAndValidateAIOutput(rawOutput, numberOfQuestions);
    return quiz;
  }

  async generateQuizFromTopic({ hostId, topic, numberOfQuestions, difficulty }) {
    if (!hostId) throw new Error("Host authorization required");
    if (!topic || !topic.trim()) throw new Error("Topic is required.");

    const prompt = buildQuizPrompt({
      focusLabel: "Create a quiz about the topic below.",
      focusText: `Topic:\n${topic.trim()}`,
      numberOfQuestions,
      difficulty
    });

    const data = await this.callGemini({
      prompt,
      json: true,
      maxOutputTokens: computeMaxOutputTokens(numberOfQuestions),
      temperature: 0.8
    });

    const rawOutput = this.extractTextFromGeminiResponse(data);
    if (!rawOutput) {
      throw new Error("Invalid response from Gemini API.");
    }

    return this.parseAndValidateAIOutput(rawOutput, numberOfQuestions);
  }

  async chatWithTutor({ hostId, message, history = [] }) {
    if (!hostId) throw new Error("Host authorization required");
    if (!message || !String(message).trim()) throw new Error("A message is required.");

    const transcript = Array.isArray(history)
      ? history
          .filter((entry) => entry && typeof entry === "object" && entry.content)
          .slice(-10)
          .map((entry) => `${String(entry.role || "user").toUpperCase()}: ${String(entry.content).trim()}`)
          .join("\n")
      : "";

    const prompt = `${CHAT_PROMPT}\n\nConversation so far:\n${transcript || "No previous conversation."}\n\nLearner: ${String(message).trim()}\nTutor:`;

    const data = await this.callGemini({
      prompt,
      json: false,
      maxOutputTokens: 1200,
      temperature: 0.6
    });

    const reply = this.extractTextFromGeminiResponse(data);
    if (!reply || !reply.trim()) {
      throw new Error("Invalid response from Gemini API.");
    }

    return { reply: reply.trim() };
  }

  extractTextFromGeminiResponse(data) {
    const candidate = data?.candidates?.[0] ?? data;
    if (!candidate) return null;

    const collected = [];
    const collect = (value) => {
      if (typeof value === "string") {
        collected.push(value);
        return;
      }
      if (Array.isArray(value)) {
        value.forEach(collect);
        return;
      }
      if (value && typeof value === "object") {
        if (typeof value.text === "string") {
          collect(value.text);
          return;
        }
        if (typeof value.outputText === "string") {
          collect(value.outputText);
          return;
        }
        if (typeof value.output === "string") {
          collect(value.output);
          return;
        }
        if (Array.isArray(value.parts)) {
          collect(value.parts);
          return;
        }
        if (value.content) {
          collect(value.content);
          return;
        }
      }
    };

    collect(candidate.content ?? candidate.output ?? candidate.text ?? candidate);
    return collected.join("");
  }

  extractJsonFromText(rawText) {
    const cleaned = rawText.trim().replace(/^\uFEFF/, "");
    const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fenceMatch ? fenceMatch[1].trim() : cleaned;

    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      return candidate.substring(start, end + 1);
    }

    return candidate;
  }

  parseAndValidateAIOutput(rawOutput, expectedCount) {
    let parsed;
    try {
      parsed = JSON.parse(rawOutput);
    } catch (err) {
      const extracted = this.extractJsonFromText(rawOutput);
      try {
        parsed = JSON.parse(extracted);
      } catch (finalErr) {
        // Log enough of the raw output to diagnose the failure (e.g.
        // truncation shows up as the tail not ending in "}").
        console.error("[AI] Unparseable output - first 500 chars:", rawOutput.slice(0, 500));
        console.error("[AI] Unparseable output - last 200 chars:", rawOutput.slice(-200));
        throw new Error("AI output was not valid JSON.");
      }
    }

    if (!parsed.title || typeof parsed.title !== "string" || !parsed.title.trim()) {
      throw new Error("AI output must include a quiz title.");
    }

    if (!Array.isArray(parsed.questions) || parsed.questions.length !== expectedCount) {
      throw new Error(`AI output must include exactly ${expectedCount} questions.`);
    }

    parsed.questions.forEach((question, index) => {
      if (!question || typeof question !== "object") {
        throw new Error(`Question ${index + 1} is malformed.`);
      }
      if (!question.question || typeof question.question !== "string" || !question.question.trim()) {
        throw new Error(`Question ${index + 1} must include question text.`);
      }
      if (!Array.isArray(question.options) || question.options.length !== 4) {
        throw new Error(`Question ${index + 1} must have exactly four options.`);
      }
      question.options.forEach((option, optionIndex) => {
        if (!option || typeof option !== "string" || !option.trim()) {
          throw new Error(`Question ${index + 1}, option ${optionIndex + 1} cannot be empty.`);
        }
      });
      if (
        typeof question.correctAnswer !== "number" ||
        question.correctAnswer < 0 ||
        question.correctAnswer > 3
      ) {
        throw new Error(`Question ${index + 1} must include a correctAnswer index between 0 and 3.`);
      }
      if (new Set(question.options.map((opt) => opt.trim())).size !== 4) {
        throw new Error(`Question ${index + 1} options must be unique.`);
      }
    });

    return {
      title: parsed.title.trim(),
      description: parsed.description ? String(parsed.description).trim() : "",
      questions: parsed.questions.map((question) => ({
        question: question.question.trim(),
        options: question.options.map((opt) => String(opt).trim()),
        correctAnswer: Number(question.correctAnswer),
        difficulty: question.difficulty ? String(question.difficulty).trim() : "Mixed",
        explanation: question.explanation ? String(question.explanation).trim() : ""
      }))
    };
  }
}

module.exports = new AIService();