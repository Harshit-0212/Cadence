/**
 * Strict 3-layer Interview Grading Engine
 * Layer A: Deterministic algorithmic pre-checks (zero hallucination, immediate reject for filler/gibberish/echo)
 * Layer B: Strict Gemini rubric prompt with temperature 0.1 and quotation-based evidence requirement
 * Layer C: Server-side post-enforcement & quote verification
 */

export interface PreCheckResult {
  passed: boolean;
  score: number;
  reason: string;
  verdict?: string;
}

export interface RubricEvaluation {
  relevant: boolean;
  coherent: boolean;
  keyPointsCovered: Array<{
    point: string;
    evidenceQuote: string;
  }>;
  keyPointsMissed: string[];
  factualErrors: string[];
  correctness: number; // 0-5
  completeness: number; // 0-3
  clarity: number; // 0-2
  feedback?: string;
  sampleAnswer?: string;
}

export interface GradedAnswer {
  score: number; // 0-100
  rawScore10: number; // 0-10
  passedPrecheck: boolean;
  reason?: string;
  relevant: boolean;
  coherent: boolean;
  keyPointsCovered: Array<{ point: string; evidenceQuote: string }>;
  keyPointsMissed: string[];
  factualErrors: string[];
  sampleAnswer: string;
}

const FILLER_REGEX = /^(idk|i don'?t know|no idea|skip|pass|none|n\/?a|nothing|dunno|\?+|\.+|-+)$/i;
const KEYBOARD_MASH_REGEX = /(asdf|qwer|zxcv|hjkl|jkl;|uiop|mnbv|12345|test123|random)/i;

/**
 * Calculates Shannon entropy of a string as a measure of randomness/repetition.
 */
function calculateEntropy(str: string): number {
  const clean = str.replace(/\s+/g, '').toLowerCase();
  if (clean.length === 0) return 0;
  const frequencies = new Map<string, number>();
  for (const char of clean) {
    frequencies.set(char, (frequencies.get(char) || 0) + 1);
  }
  let entropy = 0;
  for (const count of frequencies.values()) {
    const p = count / clean.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/**
 * Checks ratio of vowels to consonants. Normal English prose is typically between 0.3 and 0.9.
 */
function checkVowelConsonantRatio(str: string): boolean {
  const letters = str.toLowerCase().replace(/[^a-z]/g, '');
  if (letters.length < 5) return true; // too short to judge reliably
  const vowels = (letters.match(/[aeiou]/g) || []).length;
  const consonants = letters.length - vowels;
  if (consonants === 0) return false; // all vowels (e.g. "aaaaa")
  if (vowels === 0) return false; // all consonants (e.g. "zxcvbnm", "sdkljh")
  const ratio = vowels / consonants;
  return ratio >= 0.15 && ratio <= 2.5;
}

/**
 * Layer A: Fast algorithmic pre-checks executed before invoking any AI model.
 */
export function preCheckAnswer(question: string, answer: string): PreCheckResult {
  const trimmed = (answer || '').trim();

  // 1. Empty check
  if (!trimmed) {
    return {
      passed: false,
      score: 0,
      reason: 'Answer is empty.',
      verdict: 'Empty response',
    };
  }

  // 2. Minimum meaningful words check (< 3 words)
  const words = trimmed.split(/\s+/).filter((w) => w.length > 1);
  if (words.length < 3) {
    return {
      passed: false,
      score: 0,
      reason: 'Answer is too short (fewer than 3 meaningful words).',
      verdict: 'Too short',
    };
  }

  // 3. Filler check ("idk", "skip", "i don't know")
  if (FILLER_REGEX.test(trimmed)) {
    return {
      passed: false,
      score: 0,
      reason: 'Answer indicates lack of knowledge or a skipped question.',
      verdict: 'Skipped / Filler',
    };
  }

  // 4. Repeated character check (e.g. "aaaaaaa", "noooooooo")
  if (/(.)\1{4,}/i.test(trimmed)) {
    return {
      passed: false,
      score: 0,
      reason: "This doesn't look like an answer to the question (repeated characters).",
      verdict: 'Invalid input',
    };
  }

  // 5. Common keyboard mash patterns
  if (KEYBOARD_MASH_REGEX.test(trimmed.toLowerCase())) {
    // If the answer is dominated by mash patterns
    if (words.length <= 6) {
      return {
        passed: false,
        score: 0,
        reason: "This doesn't look like an answer to the question.",
        verdict: 'Gibberish / Keyboard mash',
      };
    }
  }

  // 6. Vowel / Consonant ratio check
  if (!checkVowelConsonantRatio(trimmed)) {
    return {
      passed: false,
      score: 0,
      reason: "This doesn't look like an answer to the question (unnatural language patterns).",
      verdict: 'Gibberish',
    };
  }

  // 7. Very low entropy for non-trivial strings (repetitive patterns like "abcabcabc")
  if (trimmed.length > 15) {
    const entropy = calculateEntropy(trimmed);
    if (entropy < 2.0) {
      return {
        passed: false,
        score: 0,
        reason: "This doesn't look like an answer to the question (repetitive input).",
        verdict: 'Repetitive input',
      };
    }
  }

  // 8. Answer repeats the question back
  const cleanQ = question.toLowerCase().replace(/[^a-z0-9\s]/g, '');
  const cleanA = trimmed.toLowerCase().replace(/[^a-z0-9\s]/g, '');
  const qWords = new Set(cleanQ.split(/\s+/).filter((w) => w.length > 3));

  if (qWords.size > 0) {
    const aWords = cleanA.split(/\s+/).filter((w) => w.length > 3);
    const matchedCount = aWords.filter((w) => qWords.has(w)).length;
    const overlapRatio = matchedCount / Math.max(1, aWords.length);

    // If answer is mostly words from the question and doesn't add much
    if (overlapRatio > 0.8 && aWords.length <= qWords.size + 4) {
      return {
        passed: false,
        score: 1, // Cap at 1 for echoing question
        reason: 'Answer merely repeats the question without providing technical substance.',
        verdict: 'Echoed question',
      };
    }
  }

  return {
    passed: true,
    score: 0,
    reason: '',
  };
}

/**
 * Builds the strict evaluation prompt for Gemini.
 */
export function buildStrictRubricPrompt(params: {
  role: string;
  topic: string;
  difficulty: string;
  question: string;
  candidateAnswer: string;
}): string {
  return `You are a strict, uncompromising senior technical interviewer evaluating a candidate for the role "${params.role}" (${params.difficulty} level) on topic "${params.topic}".

Question:
"${params.question}"

Candidate's Answer:
"${params.candidateAnswer}"

Grading Rules:
1. You must act as a strict examiner. NEVER be polite with scores.
2. Vague, generic, hand-wavy, or buzzword-filled answers MUST receive low marks.
3. NEVER give credit for knowledge or details not explicitly present in the candidate's answer.
4. For every key point you consider covered, you MUST provide a verbatim quote ("evidenceQuote") directly from the candidate's answer. If you cannot quote actual text from the answer supporting the point, you CANNOT mark that point as covered.
5. Score Rubric:
   - correctness (0 to 5): Technical accuracy and freedom from factual mistakes.
   - completeness (0 to 3): Coverage of core architectural/algorithmic considerations.
   - clarity (0 to 2): Precision of terminology and structural conciseness.
6. If the candidate's answer is not relevant or coherent, mark "relevant": false or "coherent": false.

Output ONLY valid JSON matching this schema:
{
  "relevant": boolean,
  "coherent": boolean,
  "keyPointsCovered": [
    {
      "point": "string describing the key concept",
      "evidenceQuote": "exact quote from candidate answer"
    }
  ],
  "keyPointsMissed": ["string"],
  "factualErrors": ["string"],
  "correctness": number,
  "completeness": number,
  "clarity": number,
  "feedback": "string",
  "sampleAnswer": "string showing ideal model response"
}`;
}

/**
 * Layer C: Server-side post-enforcement & quote verification.
 * Verifies quotes exist in text and bounds scores deterministically.
 */
export function enforceGradingRules(
  userAnswer: string,
  rubric: RubricEvaluation
): GradedAnswer {
  const normAnswer = userAnswer.toLowerCase();

  // Validate quotes in keyPointsCovered
  const verifiedPoints = rubric.keyPointsCovered.filter((kp) => {
    if (!kp.evidenceQuote || typeof kp.evidenceQuote !== 'string') return false;
    const cleanQuote = kp.evidenceQuote.trim().toLowerCase().slice(0, 30);
    return cleanQuote.length > 3 && normAnswer.includes(cleanQuote);
  });

  // Clamp subscores
  const correctness = Math.max(0, Math.min(5, Number(rubric.correctness) || 0));
  const completeness = Math.max(0, Math.min(3, Number(rubric.completeness) || 0));
  const clarity = Math.max(0, Math.min(2, Number(rubric.clarity) || 0));

  let rawTotal = correctness + completeness + clarity; // max 10

  // If no verified evidence quotes from the answer, candidate gets max 1/10
  if (verifiedPoints.length === 0) {
    rawTotal = Math.min(rawTotal, 1);
  }

  // Enforcement Caps
  if (!rubric.relevant) {
    rawTotal = Math.min(rawTotal, 1);
  }
  if (!rubric.coherent) {
    rawTotal = Math.min(rawTotal, 2);
  }

  const score100 = Math.round(rawTotal * 10);

  return {
    score: score100,
    rawScore10: rawTotal,
    passedPrecheck: true,
    relevant: rubric.relevant,
    coherent: rubric.coherent,
    keyPointsCovered: verifiedPoints,
    keyPointsMissed: rubric.keyPointsMissed || [],
    factualErrors: rubric.factualErrors || [],
    sampleAnswer: rubric.sampleAnswer || 'Ideal answer not available.',
  };
}

