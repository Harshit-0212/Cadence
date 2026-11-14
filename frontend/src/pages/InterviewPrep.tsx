import { useState, useEffect, useRef } from 'react';
import {
  Mic,
  MicOff,
  Sparkles,
  CheckCircle2,
  ChevronRight,
  Play,
  RotateCcw,
  Volume2,
  Square,
  AlertTriangle,
  History,
  FileText,
  Clock,
} from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageContainer, CardGrid } from '@/components/layout/PageContainer';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { useToast } from '@/store/ToastContext';
import { learningFeaturesService, type InterviewReportRecord } from '@/services/learningFeaturesService';
import { invalidateStats } from '@/store/StatsContext';
import { SafeText, safeRenderText } from '@/utils/safeRender';

export function InterviewPrep() {
  const { showToast } = useToast();
  const [role, setRole] = useState('Full Stack Engineer');
  const [difficulty, setDifficulty] = useState('Medium');
  const [inProgress, setInProgress] = useState(false);
  const [userAnswer, setUserAnswer] = useState('');
  const [currentQIndex, setCurrentQIndex] = useState(0);
  const [completedReport, setCompletedReport] = useState<any | null>(null);
  const [answersList, setAnswersList] = useState<Array<{ question: string; answer: string }>>([]);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [evalError, setEvalError] = useState<string | null>(null);
  const [historyReports, setHistoryReports] = useState<InterviewReportRecord[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Web Speech API Voice synthesis & recognition
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [recognitionSupported, setRecognitionSupported] = useState(true);
  const recognitionRef = useRef<any>(null);

  const questions = [
    'How does Node.js handle non-blocking I/O operations through the Event Loop and libuv?',
    'Explain the differences between optimistic and pessimistic locking in database transactions.',
    'Describe how you would design a rate limiter for a distributed microservices API.',
    'What are the core trade-offs between Monolithic and Microservices architectures regarding data consistency?',
    'Walk through how you would optimize a slow database query with an execution plan.',
  ];

  // Load past interview reports from backend
  const loadHistory = async () => {
    setLoadingHistory(true);
    try {
      const reports = await learningFeaturesService.getInterviewReports();
      setHistoryReports(reports || []);
    } catch {
      // Continue without history
    } finally {
      setLoadingHistory(false);
    }
  };

  useEffect(() => {
    loadHistory();
  }, []);

  // Initialize Speech Recognition
  useEffect(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setRecognitionSupported(false);
      return;
    }

    const rec = new SpeechRecognition();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-US';

    rec.onresult = (event: any) => {
      let finalTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript + ' ';
        }
      }
      if (finalTranscript) {
        setUserAnswer((prev) => (prev ? `${prev} ${finalTranscript.trim()}` : finalTranscript.trim()));
      }
    };

    rec.onerror = () => {
      setIsListening(false);
    };

    rec.onend = () => {
      setIsListening(false);
    };

    recognitionRef.current = rec;
  }, []);

  const toggleVoiceInput = () => {
    if (!recognitionSupported) {
      showToast('Speech recognition is not supported in this browser. Please type your answer.', 'error');
      return;
    }

    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      showToast('Microphone paused.', 'info');
    } else {
      try {
        if (window.speechSynthesis) window.speechSynthesis.cancel();
        setIsSpeaking(false);

        recognitionRef.current?.start();
        setIsListening(true);
        showToast('Listening... Speak your answer.', 'info');
      } catch {
        setIsListening(false);
      }
    }
  };

  const speakQuestion = (text: string) => {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();

    if (isSpeaking) {
      setIsSpeaking(false);
      return;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.95;
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);

    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
    }

    setIsSpeaking(true);
    window.speechSynthesis.speak(utterance);
  };

  const handleStart = () => {
    setInProgress(true);
    setCurrentQIndex(0);
    setCompletedReport(null);
    setAnswersList([]);
    setUserAnswer('');
    setEvalError(null);
    speakQuestion(questions[0]);
  };

  const submitForEvaluation = async (answersToSubmit: Array<{ question: string; answer: string }>) => {
    setIsEvaluating(true);
    setEvalError(null);
    try {
      const report = await learningFeaturesService.evaluateInterview({
        role,
        difficulty,
        questions: answersToSubmit,
      });
      setCompletedReport(report);
      showToast('Interview evaluation completed!', 'success');
      invalidateStats();
      loadHistory();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Evaluation failed';
      setEvalError(msg);
      showToast(`Evaluation error: ${msg}. Click "Retry report" to re-evaluate.`, 'error');
    } finally {
      setIsEvaluating(false);
    }
  };

  const handleNext = async () => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
    }
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
    }

    if (!userAnswer.trim()) {
      showToast('Please provide an answer before continuing.', 'error');
      return;
    }

    const currentAnswerObj = { question: questions[currentQIndex], answer: userAnswer.trim() };
    const updatedAnswers = [...answersList, currentAnswerObj];
    setAnswersList(updatedAnswers);

    if (currentQIndex + 1 < questions.length) {
      setCurrentQIndex((idx) => idx + 1);
      setUserAnswer('');
      speakQuestion(questions[currentQIndex + 1]);
    } else {
      setInProgress(false);
      await submitForEvaluation(updatedAnswers);
    }
  };

  const handleEndEarly = async () => {
    if (answersList.length === 0 && !userAnswer.trim()) {
      setInProgress(false);
      return;
    }

    const finalAnswers = userAnswer.trim()
      ? [...answersList, { question: questions[currentQIndex], answer: userAnswer.trim() }]
      : answersList;

    setAnswersList(finalAnswers);
    setInProgress(false);
    await submitForEvaluation(finalAnswers);
  };

  return (
    <AppLayout>
      <PageContainer maxWidth="7xl">
        <PageHeader
          title="AI Technical & Behavioral Interviewer"
          subtitle="Realistic adaptive interviews with voice synthesis, dictation, and granular feedback."
          badge={
            <Badge tone="primary">
              <Sparkles size={12} /> Powered by Gemini
            </Badge>
          }
        />

        {/* Evaluation Failure State with Retry */}
        {evalError && !isEvaluating && (
          <Card padding="lg" className="max-w-2xl mx-auto space-y-4 border-amber-300 dark:border-amber-700/50">
            <div className="flex items-center gap-3 text-amber-700 dark:text-amber-400">
              <AlertTriangle size={24} />
              <div>
                <h3 className="font-bold text-sm">Evaluation Could Not Complete</h3>
                <p className="text-xs text-[var(--text-muted)]">{evalError}</p>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold text-[var(--text-secondary)]">Your Answers Collected ({answersList.length}):</p>
              <div className="max-h-48 overflow-y-auto space-y-2">
                {answersList.map((a, i) => (
                  <div key={i} className="p-2.5 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] text-xs">
                    <p className="font-semibold text-[var(--text-primary)]">Q{i + 1}: {a.question}</p>
                    <p className="text-[var(--text-secondary)] mt-1 font-mono text-[11px]">{a.answer}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--border)]">
              <Button
                variant="outline"
                size="sm"
                onClick={() => { setEvalError(null); setAnswersList([]); setInProgress(false); }}
              >
                Discard
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => submitForEvaluation(answersList)}
              >
                <RotateCcw size={13} /> Retry Report
              </Button>
            </div>
          </Card>
        )}

        {/* Setup and Past Interviews View */}
        {!inProgress && !completedReport && !isEvaluating && !evalError && (
          <div className="space-y-8">
            <Card padding="lg" className="max-w-xl mx-auto space-y-4">
              <CardHeader title="Setup Interview Session" subtitle="Configure role and target parameters" />
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-semibold text-[var(--text-secondary)]">Target Role</label>
                  <input
                    type="text"
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    className="w-full mt-1 h-9 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-3 text-xs text-[var(--text-primary)] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-[var(--text-secondary)]">Difficulty</label>
                  <select
                    value={difficulty}
                    onChange={(e) => setDifficulty(e.target.value)}
                    className="w-full mt-1 h-9 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-3 text-xs text-[var(--text-primary)] focus:outline-none"
                  >
                    <option value="Junior">Junior (Fundamentals)</option>
                    <option value="Medium">Medium (System Design & Concurrency)</option>
                    <option value="Senior">Senior (Staff Architecture & Edge Cases)</option>
                  </select>
                </div>

                <div className="pt-4 flex justify-end">
                  <Button variant="primary" onClick={handleStart}>
                    <Play size={14} /> Start Voice & Text Interview
                  </Button>
                </div>
              </div>
            </Card>
            {/* Past Interview History */}
            {historyReports.length > 0 && (
              <div className="max-w-3xl mx-auto space-y-3">
                <div className="flex items-center gap-2">
                  <History size={16} className="text-[#6542C5] dark:text-[#B59AF7]" />
                  <h3 className="font-space font-bold text-sm text-[var(--text-primary)]">Interview History</h3>
                </div>
                <div className="space-y-2">
                  {historyReports.map((item, idx) => (
                    <div
                      key={item.id || item._id || idx}
                      onClick={() => setCompletedReport(item)}
                      className="p-3.5 rounded-xl border border-[var(--border)] bg-[var(--surface)] hover:border-[#6542C5]/50 transition-all flex items-center justify-between cursor-pointer"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-[#6542C5]/10 text-[#6542C5] dark:text-[#B59AF7] flex items-center justify-center font-bold text-sm">
                          {item.overallScore}%
                        </div>
                        <div>
                          <p className="text-xs font-bold text-[var(--text-primary)]">{item.role}</p>
                          <p className="text-[11px] text-[var(--text-muted)] flex items-center gap-2 mt-0.5">
                            <Clock size={11} /> {item.createdAt ? new Date(item.createdAt).toLocaleDateString() : 'Recent'}
                            <span>•</span>
                            <span>{item.difficulty || 'Standard'}</span>
                          </p>
                        </div>
                      </div>
                      <Button size="sm" variant="outline">
                        <FileText size={12} /> View Report
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {isEvaluating && (
          <Card padding="lg" className="max-w-md mx-auto text-center py-12 space-y-3">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#6542C5] border-t-transparent dark:border-[#B59AF7] mx-auto" />
            <h3 className="font-space font-bold text-base text-[var(--text-primary)]">
              Synthesizing Interview Evaluation
            </h3>
            <p className="text-xs text-[var(--text-muted)]">
              Gemini is assessing technical depth, communication, and key strengths...
            </p>
          </Card>
        )}

        {inProgress && (
          <Card padding="lg" className="max-w-2xl mx-auto space-y-6">
            <div className="flex items-center justify-between border-b border-[var(--border)] pb-3">
              <Badge tone="primary">
                Question {currentQIndex + 1} of {questions.length}
              </Badge>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-[var(--text-muted)]">
                  {role} • {difficulty}
                </span>
                <button
                  onClick={handleEndEarly}
                  className="text-xs text-red-500 hover:underline font-semibold ml-2 cursor-pointer"
                >
                  End Early
                </button>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <h3 className="text-sm font-semibold text-[var(--text-primary)] leading-relaxed">
                  {questions[currentQIndex]}
                </h3>
                <button
                  onClick={() => speakQuestion(questions[currentQIndex])}
                  className={`p-2 rounded-xl border border-[var(--border)] transition-colors shrink-0 ${
                    isSpeaking
                      ? 'bg-red-500/10 text-red-500 border-red-500/30'
                      : 'bg-[var(--surface-muted)] text-[var(--text-secondary)] hover:text-[#6542C5]'
                  }`}
                  title={isSpeaking ? 'Stop audio' : 'Speak question aloud'}
                >
                  {isSpeaking ? <Square size={14} /> : <Volume2 size={14} />}
                </button>
              </div>

              <div>
                <label className="text-[11px] font-semibold text-[var(--text-muted)] block mb-1">
                  Your Response (Type or use Voice Dictation):
                </label>
                <textarea
                  rows={4}
                  value={userAnswer}
                  onChange={(e) => setUserAnswer(e.target.value)}
                  placeholder="Explain your approach, core mechanisms, complexity tradeoffs, and edge cases..."
                  className="w-full p-3 text-xs rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[#6542C5]"
                />
              </div>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-[var(--border)]">
              <button
                type="button"
                onClick={toggleVoiceInput}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                  isListening
                    ? 'bg-rose-500 text-white animate-pulse shadow-sm'
                    : 'border border-[var(--border)] bg-[var(--surface-muted)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                {isListening ? <MicOff size={14} /> : <Mic size={14} />}
                {isListening ? 'Stop Dictation' : 'Voice Dictate'}
              </button>

              <Button variant="primary" size="sm" onClick={handleNext}>
                {currentQIndex + 1 < questions.length ? 'Next Question' : 'Complete Interview'} <ChevronRight size={14} />
              </Button>
            </div>
          </Card>
        )}

        {completedReport && (
          <div className="space-y-6">
            <CardGrid cols={12}>
              <div className="col-span-12 md:col-span-3">
                <Card padding="lg" className="text-center">
                  <span className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
                    Overall Rating
                  </span>
                  <p className="font-space font-bold text-4xl text-[#6542C5] dark:text-[#B59AF7] mt-2">
                    {completedReport.overallScore}%
                  </p>
                  <p className="text-[11px] text-[var(--text-muted)] mt-1">Ready for Technical Screen</p>
                </Card>
              </div>

              <div className="col-span-12 md:col-span-3">
                <Card padding="lg" className="text-center">
                  <span className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
                    Technical Depth
                  </span>
                  <p className="font-space font-bold text-4xl text-[var(--text-primary)] mt-2">
                    {completedReport.technicalDepthScore || completedReport.technicalScore || 82}%
                  </p>
                </Card>
              </div>

              <div className="col-span-12 md:col-span-3">
                <Card padding="lg" className="text-center">
                  <span className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
                    Communication
                  </span>
                  <p className="font-space font-bold text-4xl text-[var(--text-primary)] mt-2">
                    {completedReport.communicationScore}%
                  </p>
                </Card>
              </div>

              <div className="col-span-12 md:col-span-3">
                <Card padding="lg" className="text-center">
                  <span className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
                    Confidence
                  </span>
                  <p className="font-space font-bold text-4xl text-[var(--text-primary)] mt-2">
                    {completedReport.confidenceScore}%
                  </p>
                </Card>
              </div>

              <div className="col-span-12 lg:col-span-6">
                <Card padding="lg">
                  <CardHeader title="Demonstrated Strengths" subtitle="Key competencies observed" />
                  <ul className="mt-3 space-y-2">
                    {completedReport.strengths?.map((str: any, i: number) => (
                      <li key={i} className="text-xs text-[var(--text-secondary)] flex items-start gap-2">
                        <CheckCircle2 size={14} className="text-emerald-500 shrink-0 mt-0.5" />
                        <span><SafeText value={str} /></span>
                      </li>
                    ))}
                  </ul>
                </Card>
              </div>

              <div className="col-span-12 lg:col-span-6">
                <Card padding="lg">
                  <CardHeader title="Improvement Targets" subtitle="Specific diagnostic feedback" />
                  <div className="mt-3 space-y-3">
                    {completedReport.weaknesses?.map((w: any, i: number) => (
                      <div key={i} className="p-3 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)]/50 space-y-1">
                        <p className="text-xs font-bold text-[var(--text-primary)]">
                          <SafeText value={w.area || w.topic} />
                        </p>
                        <p className="text-[11px] text-[var(--text-muted)]">
                          <SafeText value={w.reason || w.problem} />
                        </p>
                        <p className="text-[11px] text-[#6542C5] dark:text-[#B59AF7] font-semibold mt-1">
                          Fix: <SafeText value={w.fix} />
                        </p>
                      </div>
                    ))}
                  </div>
                </Card>
              </div>

              {/* Per-Answer Feedback */}
              {completedReport.questions && completedReport.questions.length > 0 && (
                <div className="col-span-12">
                  <Card padding="lg" className="space-y-4">
                    <CardHeader title="Granular Question Review" subtitle="Per-answer breakdown, accuracy, and model answers" />
                    <div className="space-y-3">
                      {completedReport.questions.map((qItem: any, idx: number) => (
                        <div key={idx} className="p-4 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)]/30 space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-[var(--text-primary)]">
                              Question {idx + 1}: <SafeText value={qItem.question} />
                            </span>
                            <Badge tone={qItem.score >= 70 ? 'success' : qItem.score >= 40 ? 'warning' : 'error'}>
                              {qItem.score}/100
                            </Badge>
                          </div>
                          <div className="p-2.5 rounded-lg bg-[var(--surface)] text-[11px] border border-[var(--border)]">
                            <span className="font-semibold text-[var(--text-secondary)]">Your Answer: </span>
                            <span className="text-[var(--text-primary)]"><SafeText value={qItem.userAnswer} /></span>
                          </div>
                          {qItem.sampleAnswer && (
                            <p className="text-[11px] text-[var(--text-muted)]">
                              <span className="font-semibold text-emerald-600 dark:text-emerald-400">Sample Solution: </span>
                              <SafeText value={qItem.sampleAnswer} />
                            </p>
                          )}
                          {qItem.reason && (
                            <p className="text-[11px] text-amber-600 dark:text-amber-400 font-medium">
                              Note: <SafeText value={qItem.reason} />
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </Card>
                </div>
              )}

              <div className="col-span-12 flex justify-center gap-3 pt-4">
                <Button variant="outline" onClick={() => { setCompletedReport(null); setInProgress(false); loadHistory(); }}>
                  <History size={14} /> Back to Interview History
                </Button>
                <Button variant="primary" onClick={() => { setCompletedReport(null); handleStart(); }}>
                  <RotateCcw size={14} /> Start New Interview
                </Button>
              </div>
            </CardGrid>
          </div>
        )}
      </PageContainer>
    </AppLayout>
  );
}
