import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  preCheckAnswer,
  enforceGradingRules,
  type RubricEvaluation,
} from '../src/lib/interviewGrading.js';

describe('Interview Grading 3-Layer Enforcement Unit Tests', () => {
  const sampleQuestion = 'How does Node.js handle non-blocking I/O operations through the Event Loop and libuv?';

  test('Layer A: Rejects gibberish keyboard mash "asdkjh qweqwe zxcvb" with score 0', () => {
    const res = preCheckAnswer(sampleQuestion, 'asdkjh qweqwe zxcvb');
    assert.strictEqual(res.passed, false, 'Precheck should fail on keyboard mash');
    assert.strictEqual(res.score, 0, 'Score must be 0');
  });

  test('Layer A: Rejects filler "idk" / "i don\'t know" with score 0', () => {
    const res1 = preCheckAnswer(sampleQuestion, 'idk');
    assert.strictEqual(res1.passed, false);
    assert.strictEqual(res1.score, 0);

    const res2 = preCheckAnswer(sampleQuestion, "i don't know");
    assert.strictEqual(res2.passed, false);
    assert.strictEqual(res2.score, 0);
  });

  test('Layer A: Empty or short answers (< 3 words) return score 0', () => {
    const resEmpty = preCheckAnswer(sampleQuestion, '   ');
    assert.strictEqual(resEmpty.passed, false);
    assert.strictEqual(resEmpty.score, 0);

    const resShort = preCheckAnswer(sampleQuestion, 'Node js');
    assert.strictEqual(resShort.passed, false);
    assert.strictEqual(resShort.score, 0);
  });

  test('Layer A: Repeating question back returns score <= 1', () => {
    const echoAnswer = 'Node.js handles non-blocking I/O operations through the Event Loop and libuv.';
    const res = preCheckAnswer(sampleQuestion, echoAnswer);
    assert.strictEqual(res.passed, false);
    assert.ok(res.score <= 1, 'Score for echo must be <= 1');
  });

  test('Layer A: Natural technical answer passes precheck', () => {
    const validAnswer = 'Node.js delegates asynchronous operations to libuv thread pool and poll mechanisms.';
    const res = preCheckAnswer(sampleQuestion, validAnswer);
    assert.strictEqual(res.passed, true, 'Valid response should pass precheck');
  });

  test('Layer C: Irrelevant answer is capped at <= 10 (1 out of 10)', () => {
    const answer = 'I love playing basketball on weekends with my friends.';
    const mockRubric: RubricEvaluation = {
      relevant: false,
      coherent: true,
      keyPointsCovered: [],
      keyPointsMissed: ['libuv thread pool', 'epoll / kqueue'],
      factualErrors: [],
      correctness: 4, // LLM hallucinated high score
      completeness: 3,
      clarity: 2,
    };
    const enforced = enforceGradingRules(answer, mockRubric);
    assert.ok(enforced.score <= 10, 'Irrelevant answer must be capped at 10%');
  });

  test('Layer C: Discards unverified fake quotes that LLM invented', () => {
    const answer = 'Node.js uses an event loop to handle requests asynchronously.';
    const mockRubric: RubricEvaluation = {
      relevant: true,
      coherent: true,
      keyPointsCovered: [
        {
          point: 'libuv handles thread pool',
          evidenceQuote: 'libuv manages a thread pool of 4 worker threads by default', // NOT in candidate answer
        },
      ],
      keyPointsMissed: [],
      factualErrors: [],
      correctness: 5,
      completeness: 3,
      clarity: 2,
    };
    const enforced = enforceGradingRules(answer, mockRubric);
    // Because the evidence quote was fabricated and not in the answer, verified points = 0, so capped at 1
    assert.ok(enforced.score <= 10, 'Fabricated quotes must be rejected and score capped at 10');
  });

  test('Layer C: Valid answer with verifiable quotes gets authentic high score', () => {
    const answer = 'Node.js uses an event loop for single-threaded non-blocking execution while delegating file and DNS tasks to the libuv threadpool.';
    const mockRubric: RubricEvaluation = {
      relevant: true,
      coherent: true,
      keyPointsCovered: [
        {
          point: 'Single-threaded event loop',
          evidenceQuote: 'event loop for single-threaded non-blocking',
        },
        {
          point: 'Libuv thread pool delegation',
          evidenceQuote: 'delegating file and DNS tasks to the libuv threadpool',
        },
      ],
      keyPointsMissed: [],
      factualErrors: [],
      correctness: 5,
      completeness: 3,
      clarity: 2,
    };
    const enforced = enforceGradingRules(answer, mockRubric);
    assert.strictEqual(enforced.score, 100, 'Accurate response with verifiable quotes scores 100');
    assert.strictEqual(enforced.keyPointsCovered.length, 2);
  });
});

