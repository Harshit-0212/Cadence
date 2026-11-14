import { getDb } from './db.js';
import { generateJson, GeminiError, SchemaType } from './gemini.js';

export interface StageTestQuestion {
  id: string;
  type: 'mcq' | 'true-false' | 'short-answer' | 'coding';
  prompt: string;
  options?: string[];
  correctAnswer: string;
  explanation: string;
  topic: string;
  isCoding?: boolean;
  language?: string;
  starterCode?: string;
  testCases?: Array<{ input: string; expected: string; description?: string }>;
  reviewMode?: 'worker' | 'ai_review';
}

export interface PlannerTestAttempt {
  id: string;
  userId: string;
  sessionId: string;
  planId: string;
  day: number;
  attemptNumber: number;
  questions: StageTestQuestion[];
  status: 'in-progress' | 'passed' | 'failed';
  scorePercent?: number;
  passed?: boolean;
  mistakes?: Array<{
    questionId: string;
    prompt: string;
    studentAnswer: string;
    correctAnswer: string;
    explanation: string;
  }>;
  createdAt: string;
  completedAt?: string;
}

const CODING_SUBJECT_REGEX = /code|coding|program|javascript|python|typescript|algorithm|data structure|react|node|html|css|web|sql|software/i;

function isCodingTopic(subject: string, topic: string, objective: string): boolean {
  return (
    CODING_SUBJECT_REGEX.test(subject) ||
    CODING_SUBJECT_REGEX.test(topic) ||
    CODING_SUBJECT_REGEX.test(objective)
  );
}

function isGibberish(text: string): boolean {
  const clean = text.trim();
  if (clean.length < 3) return true;
  // Repeated single character like aaaaa
  if (/^(.)\1+$/i.test(clean)) return true;
  // Key smash / keyboard mash patterns
  if (/^[asdfghjklqwertyuiopzxcvbnm]{10,}$/i.test(clean) && !/[aeiouy]{2,}/i.test(clean)) return true;
  return false;
}

export function generateFallbackQuestions(opts: {
  topic: string;
  subject: string;
  objective: string;
  difficulty: string;
  hasCoding: boolean;
}): StageTestQuestion[] {
  const baseQuestions: StageTestQuestion[] = [
    {
      id: 'q_1',
      type: 'mcq',
      prompt: `What is the core principle behind ${opts.topic}?`,
      options: [
        `It establishes systematic architectural principles for ${opts.subject}.`,
        `It bypasses underlying algorithmic guarantees completely.`,
        `It has no relation to ${opts.subject} or computational efficiency.`,
        `It is solely an outdated convention with no practical utility.`,
      ],
      correctAnswer: `It establishes systematic architectural principles for ${opts.subject}.`,
      explanation: `${opts.topic} provides structured, reliable principles for solving problems in ${opts.subject}.`,
      topic: opts.topic,
    },
    {
      id: 'q_2',
      type: 'mcq',
      prompt: `Which of the following best satisfies the objective: "${opts.objective}"?`,
      options: [
        `Executing correct implementation and understanding edge cases.`,
        `Ignoring edge cases and relying on undefined behavior.`,
        `Skipping validation to optimize for short-term write speed.`,
        `Disregarding constraints and performance trade-offs.`,
      ],
      correctAnswer: `Executing correct implementation and understanding edge cases.`,
      explanation: `Mastering ${opts.objective} requires robust implementation and thorough handling of boundaries.`,
      topic: opts.topic,
    },
    {
      id: 'q_3',
      type: 'true-false',
      prompt: `True or False: In ${opts.subject}, adhering to ${opts.topic} minimizes runtime anomalies and improves maintainability.`,
      options: ['True', 'False'],
      correctAnswer: 'True',
      explanation: `Proper application of ${opts.topic} systematically eliminates preventable runtime bugs.`,
      topic: opts.topic,
    },
    {
      id: 'q_4',
      type: 'mcq',
      prompt: `What is the expected time or structural complexity behavior when applying standard ${opts.topic}?`,
      options: [
        `Predictable and deterministic performance scaling.`,
        `Unbounded exponential degradation on every input.`,
        `Random execution times that vary without algorithmic cause.`,
        `Memory leaks that cannot be mitigated.`,
      ],
      correctAnswer: `Predictable and deterministic performance scaling.`,
      explanation: `Standard techniques in ${opts.topic} guarantee predictable complexity characteristics.`,
      topic: opts.topic,
    },
    {
      id: 'q_5',
      type: 'mcq',
      prompt: `When encountering failure or invalid states in ${opts.topic}, what is the recommended practice?`,
      options: [
        `Fail fast with explicit validation and clear diagnostic output.`,
        `Silently proceed and produce corrupted downstream state.`,
        `Terminate the entire OS process without logging.`,
        `Ignore errors and hope subsequent calls self-correct.`,
      ],
      correctAnswer: `Fail fast with explicit validation and clear diagnostic output.`,
      explanation: `Failing fast prevents cascading corruptions and assists immediate debugging.`,
      topic: opts.topic,
    },
    {
      id: 'q_6',
      type: 'short-answer',
      prompt: `In one or two words, what key metric or quality is prioritized when designing solutions for ${opts.topic}?`,
      correctAnswer: 'correctness',
      explanation: `Correctness (and efficiency) is paramount when mastering ${opts.topic}.`,
      topic: opts.topic,
    },
    {
      id: 'q_7',
      type: 'mcq',
      prompt: `Which data abstraction or design approach is most suitable for ${opts.topic}?`,
      options: [
        `Modular components with clear single responsibilities.`,
        `A single monolithic function with shared global state.`,
        `Deeply nested spaghetti control flows.`,
        `Directly mutating external third-party memory spaces.`,
      ],
      correctAnswer: `Modular components with clear single responsibilities.`,
      explanation: `Modularity and single responsibility isolate defects and enhance testability.`,
      topic: opts.topic,
    },
    {
      id: 'q_8',
      type: 'true-false',
      prompt: `True or False: Automated verification and comprehensive unit tests are critical for validating ${opts.topic}.`,
      options: ['True', 'False'],
      correctAnswer: 'True',
      explanation: `Testing guarantees that invariants in ${opts.topic} are preserved across refactorings.`,
      topic: opts.topic,
    },
    {
      id: 'q_9',
      type: 'mcq',
      prompt: `How does ${opts.topic} interact with resource management (e.g. CPU, memory, I/O)?`,
      options: [
        `It encourages conscious resource allocation and prompt deallocation.`,
        `It consumes all available system memory regardless of workload.`,
        `It bypasses garbage collection and corrupts pointer tables.`,
        `It has zero interaction with computational resources.`,
      ],
      correctAnswer: `It encourages conscious resource allocation and prompt deallocation.`,
      explanation: `Resource awareness ensures high scalability and prevents leaks.`,
      topic: opts.topic,
    },
    {
      id: 'q_10',
      type: 'short-answer',
      prompt: `What should always be tested first when verifying an implementation of ${opts.topic}?`,
      correctAnswer: 'edge cases',
      explanation: `Edge cases and boundary inputs expose the vast majority of logical bugs.`,
      topic: opts.topic,
    },
  ];

  if (opts.hasCoding) {
    baseQuestions.push({
      id: 'q_coding',
      type: 'coding',
      isCoding: true,
      prompt: `Write a JavaScript function solution(input) that validates and processes ${opts.topic}. Return true if the input satisfies criteria, or false otherwise.`,
      starterCode: `function solution(input) {\n  // Write your code here for ${opts.topic}\n  return Boolean(input);\n}`,
      correctAnswer: `return Boolean(input);`,
      explanation: `Solution must handle valid and empty inputs accurately.`,
      topic: opts.topic,
      language: 'javascript',
      reviewMode: 'worker',
      testCases: [
        { input: '"test"', expected: 'true', description: 'Non-empty input should return true' },
        { input: '""', expected: 'false', description: 'Empty input should return false' },
        { input: 'null', expected: 'false', description: 'Null input should return false' },
      ],
    });
  }

  return baseQuestions;
}

export async function generateStageTest(opts: {
  topic: string;
  subject: string;
  objective: string;
  difficulty: string;
  weakTopics: string[];
  knowledgeLevel?: string;
  attemptNumber: number;
}): Promise<StageTestQuestion[]> {
  const hasCoding = isCodingTopic(opts.subject, opts.topic, opts.objective);

  const prompt = `You are an expert exam author creating a rigorous, high-quality knowledge verification test for a student completing a study plan day.
Session context:
- Subject: ${opts.subject}
- Day Topic: ${opts.topic}
- Learning Objective: ${opts.objective}
- Target Difficulty: ${opts.difficulty}
- Student Weak Topics: ${opts.weakTopics.slice(0, 3).join(', ') || 'None reported'}
- Attempt #${opts.attemptNumber}: (Generate completely fresh, diverse questions differing from past attempts)

Requirements:
1. Generate between 10 and 12 questions in total.
2. Question types must be a healthy mix of:
   - "mcq" (multiple choice with exactly 4 options)
   - "true-false" (with options ["True", "False"])
   - "short-answer" (concise text answer)
3. ${hasCoding ? 'Include EXACTLY 1 "coding" question at the end testing JavaScript implementation with starterCode and testCases.' : 'All questions conceptual and technical.'}
4. For every question:
   - "prompt": Clear, direct question.
   - "correctAnswer": Exact correct answer string.
   - "explanation": Why it is correct and how to understand it.
   - "topic": Specific sub-concept.
5. High academic rigor. Avoid trick questions, ensure 100% correctness.`;

  const questionSchema = {
    type: SchemaType.ARRAY,
    items: {
      type: SchemaType.OBJECT,
      properties: {
        id: { type: SchemaType.STRING },
        type: { type: SchemaType.STRING, format: 'enum', enum: ['mcq', 'true-false', 'short-answer', 'coding'] },
        prompt: { type: SchemaType.STRING },
        options: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
        correctAnswer: { type: SchemaType.STRING },
        explanation: { type: SchemaType.STRING },
        topic: { type: SchemaType.STRING },
        isCoding: { type: SchemaType.BOOLEAN },
        language: { type: SchemaType.STRING },
        starterCode: { type: SchemaType.STRING },
      },
      required: ['id', 'type', 'prompt', 'correctAnswer', 'explanation', 'topic'],
    },
  };

  try {
    const raw = await generateJson<StageTestQuestion[]>([{ text: prompt }], questionSchema);
    if (Array.isArray(raw) && raw.length >= 8) {
      return raw.map((q, idx) => {
        const isCode = q.type === 'coding' || q.isCoding;
        return {
          id: `q_${idx + 1}`,
          type: q.type,
          prompt: q.prompt,
          options: q.options || (q.type === 'true-false' ? ['True', 'False'] : undefined),
          correctAnswer: q.correctAnswer,
          explanation: q.explanation,
          topic: q.topic || opts.topic,
          isCoding: isCode,
          language: isCode ? (q.language || 'javascript') : undefined,
          starterCode: isCode ? (q.starterCode || `function solution(input) {\n  // Code here\n}`) : undefined,
          reviewMode: isCode ? (q.language === 'javascript' || !q.language ? 'worker' : 'ai_review') : undefined,
          testCases: isCode
            ? [
                { input: '"test"', expected: 'true', description: 'Basic test case' },
                { input: '""', expected: 'false', description: 'Edge case test' },
              ]
            : undefined,
        };
      });
    }
  } catch (err) {
    console.warn('Gemini stage test generation error, using deterministic generator:', err);
  }

  return generateFallbackQuestions({
    topic: opts.topic,
    subject: opts.subject,
    objective: opts.objective,
    difficulty: opts.difficulty,
    hasCoding,
  });
}

export function evaluateStudentAnswer(
  q: StageTestQuestion,
  studentAnswer: string,
  codeResult?: { passed: boolean }
): { isCorrect: boolean; studentAnswer: string } {
  const ans = (studentAnswer || '').trim();

  // Gibberish / empty checks (Strict 0 score rule)
  if (!ans && !codeResult) {
    return { isCorrect: false, studentAnswer: '(No answer provided)' };
  }
  if (isGibberish(ans)) {
    return { isCorrect: false, studentAnswer: ans };
  }

  if (q.type === 'coding') {
    if (codeResult) {
      return { isCorrect: codeResult.passed, studentAnswer: ans || 'Submitted code' };
    }
    // Non-worker fallback code evaluation
    const passesBasic = ans.length >= 20 && !ans.includes('// Write your code here');
    return { isCorrect: passesBasic, studentAnswer: ans };
  }

  if (q.type === 'mcq' || q.type === 'true-false') {
    const isCorrect = ans.toLowerCase() === q.correctAnswer.trim().toLowerCase();
    return { isCorrect, studentAnswer: ans };
  }

  // Short answer
  const target = q.correctAnswer.trim().toLowerCase();
  const given = ans.toLowerCase();
  const isCorrect = given === target || given.includes(target) || target.includes(given);
  return { isCorrect, studentAnswer: ans };
}
