import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Sparkles,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Play,
  Clock,
  ArrowRight,
  ArrowLeft,
  RotateCcw,
  Code2,
  HelpCircle,
  Award,
} from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { studyPlanService } from '@/services/studyPlanService';
import type { StudySession, StudyPlan } from '@/types';

interface StageTestModalProps {
  session: StudySession | null;
  open: boolean;
  onClose: () => void;
  onPassed: (updatedSession: StudySession, updatedPlan?: StudyPlan) => void;
}

export function StageTestModal({ session, open, onClose, onPassed }: StageTestModalProps) {
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testData, setTestData] = useState<Awaited<ReturnType<typeof studyPlanService.startStageTest>> | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [codingCode, setCodingCode] = useState<string>('');
  const [runningCode, setRunningCode] = useState(false);
  const [codeTestResults, setCodeTestResults] = useState<Array<{ input: string; expected: string; actual?: string; passed: boolean; error?: string }> | null>(null);
  const [result, setResult] = useState<Awaited<ReturnType<typeof studyPlanService.submitStageTest>> | null>(null);
  const [cooldownRemaining, setCooldownRemaining] = useState<number>(0);
  const cooldownTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (open && session) {
      loadTest();
    } else {
      resetState();
    }
    return () => {
      if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current);
    };
  }, [open, session?.id]);

  const resetState = () => {
    setTestData(null);
    setAnswers({});
    setCurrentIndex(0);
    setCodingCode('');
    setCodeTestResults(null);
    setResult(null);
    setError(null);
    setCooldownRemaining(0);
    if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current);
  };

  const loadTest = async () => {
    if (!session) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const data = await studyPlanService.startStageTest(session.id);
      setTestData(data);
      const codingQ = data.questions.find((q) => q.isCoding || q.type === 'coding');
      if (codingQ?.starterCode) {
        setCodingCode(codingQ.starterCode);
      }
    } catch (err: any) {
      const remaining = err?.data?.error?.secondsRemaining || err?.error?.secondsRemaining;
      if (remaining) {
        startCooldownTimer(remaining);
      }
      setError(err?.message || 'Could not start verification test.');
    } finally {
      setLoading(false);
    }
  };

  const startCooldownTimer = (seconds: number) => {
    setCooldownRemaining(seconds);
    if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current);
    cooldownTimerRef.current = setInterval(() => {
      setCooldownRemaining((prev) => {
        if (prev <= 1) {
          if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const runCodeInWorker = async () => {
    if (!currentQuestion?.testCases || !codingCode) return;
    setRunningCode(true);

    const testCases = currentQuestion.testCases;
    const workerScript = `
      self.onmessage = function(e) {
        const { code, testCases } = e.data;
        try {
          const userFn = new Function('input', code + '\\n return solution(input);');
          const results = testCases.map(tc => {
            try {
              let parsedInput;
              try { parsedInput = JSON.parse(tc.input); } catch { parsedInput = tc.input; }
              const actual = String(userFn(parsedInput));
              const expected = String(tc.expected).trim();
              return { input: tc.input, expected: tc.expected, actual, passed: actual === expected };
            } catch (err) {
              return { input: tc.input, expected: tc.expected, passed: false, error: err.message };
            }
          });
          self.postMessage({ success: true, results });
        } catch (err) {
          self.postMessage({ success: false, error: err.message });
        }
      };
    `;

    try {
      const blob = new Blob([workerScript], { type: 'application/javascript' });
      const worker = new Worker(URL.createObjectURL(blob));

      const promise = new Promise<Array<{ input: string; expected: string; actual?: string; passed: boolean; error?: string }>>((resolve) => {
        const timer = setTimeout(() => {
          worker.terminate();
          resolve(testCases.map((tc) => ({ ...tc, passed: false, error: 'Execution timeout (3s)' })));
        }, 3000);

        worker.onmessage = (e) => {
          clearTimeout(timer);
          worker.terminate();
          if (e.data.success) {
            resolve(e.data.results);
          } else {
            resolve(testCases.map((tc) => ({ ...tc, passed: false, error: e.data.error })));
          }
        };

        worker.onerror = (e) => {
          clearTimeout(timer);
          worker.terminate();
          resolve(testCases.map((tc) => ({ ...tc, passed: false, error: e.message })));
        };

        worker.postMessage({ code: codingCode, testCases });
      });

      const res = await promise;
      setCodeTestResults(res);
      const allPassed = res.every((r) => r.passed);
      setAnswers((prev) => ({ ...prev, [currentQuestion.id]: codingCode }));
    } catch {
      setCodeTestResults(testCases.map((tc) => ({ ...tc, passed: false, error: 'Sandbox error' })));
    } finally {
      setRunningCode(false);
    }
  };

  const handleSubmit = async () => {
    if (!session || !testData) return;
    setSubmitting(true);
    setError(null);

    const codeResultsMap: Record<string, { passed: boolean }> = {};
    if (codeTestResults && currentQuestion?.isCoding) {
      codeResultsMap[currentQuestion.id] = {
        passed: codeTestResults.every((t) => t.passed),
      };
    }

    try {
      const res = await studyPlanService.submitStageTest(session.id, {
        attemptId: testData.attemptId,
        answers,
        codeResults: codeResultsMap,
      });
      setResult(res);

      if (res.passed && res.session) {
        onPassed(res.session, res.plan);
      } else {
        startCooldownTimer(120); // 2 minutes cooldown
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to grade verification test.');
    } finally {
      setSubmitting(false);
    }
  };

  const questions = testData?.questions || [];
  const currentQuestion = questions[currentIndex];
  const answeredCount = Object.keys(answers).length;

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!submitting) onClose();
      }}
      title={`Day ${session?.day || 1} Verification Test: ${session?.topic || ''}`}
      size="lg"
    >
      <div className="space-y-5">
        {/* Loading State */}
        {loading && (
          <div className="py-16 text-center space-y-3">
            <div className="mx-auto h-10 w-10 animate-spin rounded-full border-3 border-[#6542C5] border-t-transparent dark:border-[#B59AF7]" />
            <h4 className="font-display text-base font-semibold text-ink-900 dark:text-ink-50">
              Generating Fresh Verification Test...
            </h4>
            <p className="text-xs text-ink-500 max-w-md mx-auto">
              Synthesizing 10-12 technical questions and sandbox coding tasks tailored to{' '}
              <strong>{session?.topic}</strong> and your weak spots with Gemini AI.
            </p>
          </div>
        )}

        {/* Cooldown / Error Banner */}
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-xs text-red-800 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-300 flex items-start gap-3">
            <AlertTriangle size={16} className="shrink-0 mt-0.5 text-red-600" />
            <div className="flex-1 space-y-1">
              <p className="font-bold">Test Unavailable</p>
              <p>{error}</p>
              {cooldownRemaining > 0 && (
                <p className="font-mono text-amber-700 dark:text-amber-400 font-semibold">
                  Retry available in: {cooldownRemaining}s
                </p>
              )}
            </div>
            {cooldownRemaining === 0 && (
              <Button size="sm" variant="outline" onClick={loadTest}>
                Retry Now
              </Button>
            )}
          </div>
        )}

        {/* Results Screen */}
        {result && (
          <div className="space-y-6 py-2">
            <div
              className={`rounded-2xl p-6 text-center space-y-3 ${
                result.passed
                  ? 'border border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/20'
                  : 'border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/20'
              }`}
            >
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-white shadow-soft dark:bg-ink-900">
                {result.passed ? (
                  <CheckCircle2 size={32} className="text-emerald-500" />
                ) : (
                  <XCircle size={32} className="text-amber-500" />
                )}
              </div>
              <h3 className="font-display text-2xl font-bold text-ink-900 dark:text-ink-50">
                {result.passed ? 'Day Test Passed!' : 'Pass Mark Not Reached'}
              </h3>
              <p className="text-sm font-semibold">
                Your Score:{' '}
                <span className={result.passed ? 'text-emerald-600 font-bold text-lg' : 'text-amber-600 font-bold text-lg'}>
                  {result.scorePercent}%
                </span>{' '}
                · Required: <span className="font-mono">{result.passMark}%</span>
              </p>
              <p className="text-xs text-ink-600 dark:text-ink-400 max-w-md mx-auto">
                {result.passed
                  ? `Congratulations! Day ${session?.day} has been completed and marked done on the server. Day ${(session?.day || 1) + 1} is now unlocked.`
                  : `You need at least 90% to complete Day ${session?.day}. Review the detailed feedback below before retrying with fresh questions.`}
              </p>
            </div>

            {/* Mistakes & Explanations */}
            {result.mistakes && result.mistakes.length > 0 && (
              <div className="space-y-3">
                <h4 className="font-display text-sm font-bold text-ink-900 dark:text-ink-50 flex items-center gap-2">
                  <AlertTriangle size={15} className="text-amber-500" />
                  Mistakes Review ({result.mistakes.length})
                </h4>
                <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
                  {result.mistakes.map((m, idx) => (
                    <Card key={idx} padding="sm" className="space-y-2 border-amber-200 dark:border-amber-900/40">
                      <p className="text-xs font-semibold text-ink-900 dark:text-ink-100">{m.prompt}</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                        <div className="p-2 rounded-lg bg-red-50 text-red-800 dark:bg-red-950/20 dark:text-red-300">
                          <span className="font-bold">Your answer:</span> {m.studentAnswer}
                        </div>
                        <div className="p-2 rounded-lg bg-emerald-50 text-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-300">
                          <span className="font-bold">Correct answer:</span> {m.correctAnswer}
                        </div>
                      </div>
                      <p className="text-[11px] text-ink-500 dark:text-ink-400 italic">
                        <span className="font-semibold text-ink-700 dark:text-ink-300">Why:</span> {m.explanation}
                      </p>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {/* Result Actions */}
            <div className="flex items-center justify-between pt-3 border-t border-ink-200 dark:border-ink-800">
              <span className="text-xs text-ink-500">
                Attempts: {result.attemptsCount} · Best: {result.bestScore}%
              </span>
              <div className="flex gap-2">
                {result.passed ? (
                  <Button onClick={onClose} variant="primary">
                    <CheckCircle2 size={14} /> Close & Continue
                  </Button>
                ) : (
                  <Button
                    onClick={loadTest}
                    variant="primary"
                    disabled={cooldownRemaining > 0}
                  >
                    <RotateCcw size={14} />
                    {cooldownRemaining > 0 ? `Cooldown (${cooldownRemaining}s)` : 'Retry with New Questions'}
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* In-Progress Test Questions View */}
        {!loading && !result && testData && currentQuestion && (
          <div className="space-y-4">
            {/* Header info */}
            <div className="flex items-center justify-between pb-3 border-b border-ink-100 dark:border-ink-800 text-xs">
              <div className="flex items-center gap-2">
                <Badge tone="primary">Question {currentIndex + 1} of {questions.length}</Badge>
                <Badge tone="accent">{currentQuestion.topic}</Badge>
              </div>
              <span className="text-ink-400">Pass mark: 90%</span>
            </div>

            {/* Question Prompt */}
            <div className="space-y-3">
              <h3 className="font-display text-base font-semibold text-ink-900 dark:text-ink-50">
                {currentQuestion.prompt}
              </h3>

              {/* MCQ & True/False */}
              {(currentQuestion.type === 'mcq' || currentQuestion.type === 'true-false') && currentQuestion.options && (
                <div className="space-y-2">
                  {currentQuestion.options.map((opt, optIdx) => {
                    const isSelected = answers[currentQuestion.id] === opt;
                    return (
                      <button
                        key={optIdx}
                        onClick={() => setAnswers((prev) => ({ ...prev, [currentQuestion.id]: opt }))}
                        className={`w-full text-left p-3 rounded-xl border text-xs font-medium transition-colors flex items-center justify-between ${
                          isSelected
                            ? 'border-[#6542C5] bg-[#F5F3FD] text-[#6542C5] dark:border-[#B59AF7] dark:bg-[#B59AF7]/10 dark:text-[#B59AF7]'
                            : 'border-ink-200 hover:border-ink-300 dark:border-ink-800 dark:hover:border-ink-700 text-ink-700 dark:text-ink-300'
                        }`}
                      >
                        <span>{opt}</span>
                        <div
                          className={`h-4 w-4 rounded-full border flex items-center justify-center ${
                            isSelected ? 'border-[#6542C5] bg-[#6542C5] text-white' : 'border-ink-300'
                          }`}
                        >
                          {isSelected && <div className="h-1.5 w-1.5 rounded-full bg-white" />}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Short Answer */}
              {currentQuestion.type === 'short-answer' && (
                <div className="space-y-2">
                  <input
                    type="text"
                    value={answers[currentQuestion.id] || ''}
                    onChange={(e) => setAnswers((prev) => ({ ...prev, [currentQuestion.id]: e.target.value }))}
                    placeholder="Type your concise answer here..."
                    className="w-full rounded-xl border border-ink-200 bg-white px-3.5 py-2.5 text-xs text-ink-900 outline-none focus:border-[#6542C5] dark:border-ink-700 dark:bg-ink-900 dark:text-ink-50"
                  />
                  <p className="text-[11px] text-ink-400">
                    Empty or keyboard gibberish answers automatically score 0.
                  </p>
                </div>
              )}

              {/* Coding Question with Web Worker sandbox */}
              {(currentQuestion.type === 'coding' || currentQuestion.isCoding) && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs text-ink-500">
                    <span className="flex items-center gap-1 font-mono">
                      <Code2 size={13} /> JavaScript Sandbox (Web Worker)
                    </span>
                    <Button size="sm" variant="outline" onClick={runCodeInWorker} loading={runningCode}>
                      <Play size={12} /> Run Tests
                    </Button>
                  </div>
                  <textarea
                    rows={6}
                    value={codingCode}
                    onChange={(e) => {
                      setCodingCode(e.target.value);
                      setAnswers((prev) => ({ ...prev, [currentQuestion.id]: e.target.value }));
                    }}
                    className="w-full font-mono text-xs rounded-xl border border-ink-200 bg-ink-950 p-3 text-emerald-400 outline-none focus:border-[#6542C5]"
                  />

                  {/* Test Cases Results */}
                  {codeTestResults && (
                    <div className="space-y-1.5 rounded-xl border border-ink-200 bg-ink-50 p-3 dark:border-ink-800 dark:bg-ink-900/50">
                      <p className="text-[11px] font-bold text-ink-700 dark:text-ink-300">Test Execution Results:</p>
                      {codeTestResults.map((tc, idx) => (
                        <div key={idx} className="flex items-center justify-between text-[11px] font-mono">
                          <span>Case {idx + 1}: input: {tc.input}</span>
                          <span className={tc.passed ? 'text-emerald-600 font-bold' : 'text-red-600 font-bold'}>
                            {tc.passed ? 'Passed ✓' : `Failed ✗ (${tc.error || `Expected: ${tc.expected}, Got: ${tc.actual}`})`}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Navigation & Submit */}
            <div className="flex items-center justify-between pt-4 border-t border-ink-100 dark:border-ink-800">
              <Button
                size="sm"
                variant="ghost"
                disabled={currentIndex === 0}
                onClick={() => setCurrentIndex((prev) => prev - 1)}
              >
                <ArrowLeft size={14} /> Previous
              </Button>

              <div className="flex items-center gap-2">
                {currentIndex < questions.length - 1 ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setCurrentIndex((prev) => prev + 1)}
                  >
                    Next <ArrowRight size={14} />
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={handleSubmit}
                    loading={submitting}
                  >
                    <CheckCircle2 size={14} /> Submit Test ({answeredCount}/{questions.length})
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
