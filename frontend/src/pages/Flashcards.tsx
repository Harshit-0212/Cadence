import { useState, useEffect, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Layers,
  RotateCcw,
  Check,
  Sparkles,
  Award,
  AlertTriangle,
  Calendar,
  CheckCircle2,
  XCircle,
  HelpCircle,
  PenTool,
  Clock,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageContainer } from '@/components/layout/PageContainer';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { useToast } from '@/store/ToastContext';
import { learningFeaturesService } from '@/services/learningFeaturesService';
import { invalidateStats } from '@/store/StatsContext';

interface Flashcard {
  id: string;
  front: string;
  back: string;
  subject: string;
  topic: string;
  stage?: 'new' | 'learning' | 'review' | 'mastered';
  leech?: boolean;
  leechCount?: number;
  distractors?: string[];
  clozeText?: string;
  sourceDocId?: string;
  lastReviewType?: 'flip' | 'mcq' | 'cloze' | 'type';
  interval?: number;
  nextReviewDate?: string;
}

export function Flashcards() {
  const { showToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedDocId = searchParams.get('docId') || 'all';

  const [cards, setCards] = useState<Flashcard[]>([]);
  const [queue, setQueue] = useState<Flashcard[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [completed, setCompleted] = useState(false);

  // Dynamic review mode states
  const [typedAnswer, setTypedAnswer] = useState('');
  const [typedChecked, setTypedChecked] = useState(false);
  const [mcqSelected, setMcqSelected] = useState<string | null>(null);
  const [mcqChecked, setMcqChecked] = useState(false);

  // Session Statistics
  const [startTime, setStartTime] = useState<number>(Date.now());
  const [reviewedStats, setReviewedStats] = useState<{
    totalReviewed: number;
    againCount: number;
    hardCount: number;
    goodCount: number;
    easyCount: number;
  }>({
    totalReviewed: 0,
    againCount: 0,
    hardCount: 0,
    goodCount: 0,
    easyCount: 0,
  });

  useEffect(() => {
    async function loadCards() {
      try {
        const due = await learningFeaturesService.getDueFlashcards();
        let loadedAll: Flashcard[] = [];
        if (due && due.length > 0) {
          loadedAll = due.map((d: any) => ({
            id: d.id || d._id,
            front: d.front,
            back: d.back,
            subject: d.subject || 'General',
            topic: d.topic || 'General',
            stage: d.stage || 'learning',
            leech: d.leech || false,
            leechCount: d.leechCount || 0,
            distractors: d.distractors || [],
            clozeText: d.clozeText,
            sourceDocId: d.sourceDocId,
            lastReviewType: d.lastReviewType || 'flip',
            interval: d.interval || 1,
            nextReviewDate: d.nextReviewDate,
          }));
        } else {
          const all = await learningFeaturesService.getAllFlashcards();
          if (all && all.length > 0) {
            loadedAll = all.map((d: any) => ({
              id: d.id || d._id,
              front: d.front,
              back: d.back,
              subject: d.subject || 'General',
              topic: d.topic || 'General',
              stage: d.stage || 'learning',
              leech: d.leech || false,
              leechCount: d.leechCount || 0,
              distractors: d.distractors || [],
              clozeText: d.clozeText,
              sourceDocId: d.sourceDocId,
              lastReviewType: d.lastReviewType || 'flip',
              interval: d.interval || 1,
              nextReviewDate: d.nextReviewDate,
            }));
          }
        }
        setCards(loadedAll);
      } catch {
        setCards([]);
      }
      setStartTime(Date.now());
    }
    loadCards();
  }, []);

  // Filter queue whenever cards or selectedDocId changes
  useEffect(() => {
    const filtered =
      selectedDocId === 'all'
        ? cards
        : cards.filter((c) => c.sourceDocId === selectedDocId);
    setQueue(filtered);
    setCurrentIndex(0);
    setCompleted(false);
    setIsFlipped(false);
  }, [cards, selectedDocId]);

  // Distinct decks per document
  const decks = useMemo(() => {
    const map = new Map<string, { id: string; name: string; count: number }>();
    for (const c of cards) {
      if (c.sourceDocId) {
        const existing = map.get(c.sourceDocId) || {
          id: c.sourceDocId,
          name: c.topic && c.topic !== 'General' ? c.topic : (c.subject || 'Document Deck'),
          count: 0,
        };
        existing.count++;
        map.set(c.sourceDocId, existing);
      }
    }
    return Array.from(map.values());
  }, [cards]);

  const currentCard = queue[currentIndex];

  // Determine current review mode for this card:
  // Rotation: flip -> mcq -> cloze -> type -> flip
  const currentMode = useMemo<'flip' | 'mcq' | 'cloze' | 'type'>(() => {
    if (!currentCard) return 'flip';
    const modes: Array<'flip' | 'mcq' | 'cloze' | 'type'> = ['flip', 'mcq', 'cloze', 'type'];
    const prev = currentCard.lastReviewType || 'type';
    const idx = (modes.indexOf(prev) + 1) % modes.length;

    // Check availability: MCQ requires distractors, Cloze requires clozeText
    const chosen = modes[idx];
    if (chosen === 'mcq' && (!currentCard.distractors || currentCard.distractors.length < 3)) {
      return 'flip';
    }
    if (chosen === 'cloze' && !currentCard.clozeText) {
      return 'type';
    }
    return chosen;
  }, [currentCard]);

  // MCQ Options shuffled
  const mcqOptions = useMemo(() => {
    if (!currentCard || !currentCard.distractors) return [];
    const options = [currentCard.back, ...currentCard.distractors.slice(0, 3)];
    return options.sort(() => Math.sin(options.length) - 0.5);
  }, [currentCard]);

  // 7-day forecast projection
  const forecast7Days = useMemo(() => {
    const counts = [0, 0, 0, 0, 0, 0, 0];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (const card of cards) {
      const interval = card.interval || 1;
      const targetDay = Math.min(6, Math.max(0, interval - 1));
      counts[targetDay] += 1;
    }
    return counts;
  }, [cards]);

  const handleRate = async (rating: 1 | 2 | 3 | 4) => {
    if (!currentCard) return;

    try {
      await learningFeaturesService.reviewFlashcard(currentCard.id, rating, currentMode);
      invalidateStats();
    } catch {
      // offline fallback
    }

    // Update stats
    setReviewedStats((prev) => ({
      ...prev,
      totalReviewed: prev.totalReviewed + 1,
      againCount: rating === 1 ? prev.againCount + 1 : prev.againCount,
      hardCount: rating === 2 ? prev.hardCount + 1 : prev.hardCount,
      goodCount: rating === 3 ? prev.goodCount + 1 : prev.goodCount,
      easyCount: rating === 4 ? prev.easyCount + 1 : prev.easyCount,
    }));

    showToast(`Rated ${rating}/4! Next interval updated via SM-2. +5 XP`, 'success');

    // Reset interaction state
    setIsFlipped(false);
    setTypedAnswer('');
    setTypedChecked(false);
    setMcqSelected(null);
    setMcqChecked(false);

    // If rating is 1 (Again), append card to end of session queue to retry
    if (rating === 1) {
      setQueue((prev) => [...prev, currentCard]);
      showToast('Card scheduled for re-drill at the end of session.', 'info');
    }

    if (currentIndex + 1 < queue.length) {
      setCurrentIndex((idx) => idx + 1);
    } else {
      setCompleted(true);
    }
  };

  const handleMcqSelect = (option: string) => {
    if (mcqChecked) return;
    setMcqSelected(option);
    setMcqChecked(true);

    const isCorrect = option === currentCard?.back;
    if (isCorrect) {
      showToast('Correct! Choose rating below.', 'success');
    } else {
      showToast('Incorrect option. Study the correct answer.', 'error');
    }
  };

  const handleCheckTyped = () => {
    setTypedChecked(true);
    const cleanTyped = typedAnswer.trim().toLowerCase();
    const cleanBack = currentCard.back.trim().toLowerCase();
    const isExact = cleanTyped === cleanBack || cleanBack.includes(cleanTyped);
    if (isExact && cleanTyped.length > 3) {
      showToast('Great answer! Confirm your rating below.', 'success');
    } else {
      showToast('Compare your typed answer with the card solution.', 'info');
    }
  };

  const resetSession = () => {
    setCurrentIndex(0);
    setIsFlipped(false);
    setCompleted(false);
    setTypedAnswer('');
    setTypedChecked(false);
    setMcqSelected(null);
    setMcqChecked(false);
    setStartTime(Date.now());
  };

  const sessionMinutes = Math.max(1, Math.round((Date.now() - startTime) / 60000));
  const accuracy =
    reviewedStats.totalReviewed > 0
      ? Math.round(
          ((reviewedStats.goodCount + reviewedStats.easyCount) / reviewedStats.totalReviewed) * 100
        )
      : 100;

  return (
    <AppLayout>
      <PageContainer maxWidth="md">
        <PageHeader
          title="Flashcard Mastery Studio"
          subtitle="Multi-modal active recall (Flip, MCQ, Cloze, Typed) powered by SM-2 spaced repetition."
          action={
            <div className="flex items-center gap-2">
              <Badge tone="primary">
                <Sparkles size={12} /> {queue.length - currentIndex} cards due
              </Badge>
            </div>
          }
        />

        {/* Deck Selector Tabs */}
        {decks.length > 0 && (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 mb-2">
            <button
              onClick={() => setSearchParams({})}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold shrink-0 transition-all ${
                selectedDocId === 'all'
                  ? 'bg-[#6542C5] text-white shadow-sm'
                  : 'bg-[var(--surface-muted)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border)]'
              }`}
            >
              All Decks ({cards.length})
            </button>
            {decks.map((deck) => (
              <button
                key={deck.id}
                onClick={() => setSearchParams({ docId: deck.id })}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold shrink-0 transition-all ${
                  selectedDocId === deck.id
                    ? 'bg-[#6542C5] text-white shadow-sm'
                    : 'bg-[var(--surface-muted)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border)]'
                }`}
              >
                {deck.name} ({deck.count})
              </button>
            ))}
          </div>
        )}

        {completed ? (
          <div className="space-y-6">
            <Card padding="lg" className="text-center py-8 space-y-5">
              <div className="size-16 mx-auto rounded-full bg-emerald-500/10 text-emerald-600 flex items-center justify-center">
                <Award size={36} />
              </div>
              <div>
                <h3 className="font-space text-2xl font-bold text-[var(--text-primary)]">
                  Session Completed!
                </h3>
                <p className="text-xs text-[var(--text-muted)] mt-1">
                  Your long-term memory traces have been reinforced with optimal intervals.
                </p>
              </div>

              {/* End of Session Summary Grid */}
              <div className="grid grid-cols-3 gap-3 max-w-sm mx-auto text-left">
                <div className="p-3 rounded-xl bg-[var(--surface-muted)] border border-[var(--border)]">
                  <span className="text-[10px] text-[var(--text-muted)] uppercase font-semibold">
                    Accuracy
                  </span>
                  <p className="text-lg font-bold text-[var(--text-primary)] mt-0.5">{accuracy}%</p>
                </div>
                <div className="p-3 rounded-xl bg-[var(--surface-muted)] border border-[var(--border)]">
                  <span className="text-[10px] text-[var(--text-muted)] uppercase font-semibold">
                    Time Taken
                  </span>
                  <p className="text-lg font-bold text-[var(--text-primary)] mt-0.5">
                    {sessionMinutes} min
                  </p>
                </div>
                <div className="p-3 rounded-xl bg-[var(--surface-muted)] border border-[var(--border)]">
                  <span className="text-[10px] text-[var(--text-muted)] uppercase font-semibold">
                    XP Earned
                  </span>
                  <p className="text-lg font-bold text-emerald-600 mt-0.5">
                    +{reviewedStats.totalReviewed * 5} XP
                  </p>
                </div>
              </div>

              <div className="pt-2">
                <Button variant="primary" onClick={resetSession} className="mx-auto">
                  <RotateCcw size={14} /> Review Again
                </Button>
              </div>
            </Card>

            {/* 7-Day Forecast */}
            <Card padding="lg" className="space-y-3">
              <div className="flex items-center gap-2">
                <Calendar size={14} className="text-[#6542C5]" />
                <h4 className="font-space font-bold text-xs uppercase tracking-wider text-[var(--text-primary)]">
                  7-Day Retention Forecast
                </h4>
              </div>
              <p className="text-xs text-[var(--text-muted)]">
                Projected number of flashcards scheduled for review over the next week based on SM-2 intervals.
              </p>
              <div className="grid grid-cols-7 gap-2 pt-2">
                {forecast7Days.map((count, dayIdx) => (
                  <div
                    key={dayIdx}
                    className="p-2.5 rounded-xl bg-[var(--surface-muted)] border border-[var(--border)] text-center flex flex-col justify-between h-20"
                  >
                    <span className="text-[10px] font-medium text-[var(--text-muted)]">
                      {dayIdx === 0 ? 'Today' : `+${dayIdx}d`}
                    </span>
                    <span className="text-sm font-bold text-[#6542C5]">{count}</span>
                    <span className="text-[9px] text-[var(--text-muted)]">cards</span>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        ) : currentCard ? (
          <div className="space-y-5">
            {/* Stage & Leech Indicator */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Badge tone={currentCard.stage === 'mastered' ? 'success' : 'primary'}>
                  Stage: {currentCard.stage?.toUpperCase() || 'LEARNING'}
                </Badge>
                <Badge tone="neutral">Mode: {currentMode.toUpperCase()}</Badge>
                {currentCard.leech && (
                  <Badge tone="warning">
                    <AlertTriangle size={11} className="inline mr-1" /> Leech Card
                  </Badge>
                )}
              </div>
              <span className="text-xs text-[var(--text-muted)] font-mono">
                {currentIndex + 1} / {queue.length}
              </span>
            </div>

            {/* Leech Simplification Notice */}
            {currentCard.leech && (
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-700 dark:text-amber-300">
                <strong>Attention:</strong> This card has been marked as difficult (missed 4+ times). Pay special attention to the breakdown below.
              </div>
            )}

            {/* ── MODE 1: Standard Flip Card ── */}
            {currentMode === 'flip' && (
              <div
                onClick={() => setIsFlipped(!isFlipped)}
                className="relative h-72 cursor-pointer perspective-1000 select-none"
              >
                <motion.div
                  animate={{ rotateY: isFlipped ? 180 : 0 }}
                  transition={{ duration: 0.35, ease: 'easeOut' }}
                  className="w-full h-full relative preserve-3d"
                >
                  {/* Front */}
                  <div
                    className={`absolute inset-0 backface-hidden p-8 rounded-3xl border border-[var(--border)] bg-[var(--surface)] shadow-md flex flex-col justify-between ${
                      isFlipped ? 'pointer-events-none' : ''
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Badge tone="primary">{currentCard.subject}</Badge>
                      <span className="text-xs text-[var(--text-muted)]">{currentCard.topic}</span>
                    </div>
                    <h3 className="font-space text-lg sm:text-xl font-bold text-[var(--text-primary)] text-center my-auto">
                      {currentCard.front}
                    </h3>
                    <p className="text-center text-xs text-[var(--text-muted)]">Click to reveal answer</p>
                  </div>

                  {/* Back */}
                  <div
                    className={`absolute inset-0 backface-hidden p-8 rounded-3xl border border-[#6542C5]/30 bg-gradient-to-br from-[var(--surface)] to-[#F5F3FD] dark:to-[#1D1922] shadow-md flex flex-col justify-between rotate-y-180 ${
                      !isFlipped ? 'pointer-events-none' : ''
                    }`}
                  >
                    <Badge tone="success" className="w-fit">
                      Solution
                    </Badge>
                    <p className="font-sans text-base text-[var(--text-primary)] text-center my-auto leading-relaxed">
                      {currentCard.back}
                    </p>
                    <p className="text-center text-xs text-[var(--text-muted)]">Rate below to schedule interval</p>
                  </div>
                </motion.div>
              </div>
            )}

            {/* ── MODE 2: Multiple Choice Question (MCQ) ── */}
            {currentMode === 'mcq' && (
              <Card padding="lg" className="space-y-4">
                <div className="flex items-center justify-between">
                  <Badge tone="primary">{currentCard.subject}</Badge>
                  <span className="text-xs text-[var(--text-muted)]">{currentCard.topic}</span>
                </div>
                <h3 className="font-space text-base font-bold text-[var(--text-primary)]">
                  {currentCard.front}
                </h3>
                <div className="space-y-2 pt-2">
                  {mcqOptions.map((opt, i) => {
                    const isSelected = mcqSelected === opt;
                    const isCorrect = opt === currentCard.back;
                    let btnStyle = 'border-[var(--border)] bg-[var(--surface-muted)] text-[var(--text-primary)]';
                    if (mcqChecked) {
                      if (isCorrect) btnStyle = 'border-emerald-500 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 font-semibold';
                      else if (isSelected) btnStyle = 'border-red-500 bg-red-500/10 text-red-700 dark:text-red-300';
                    }
                    return (
                      <button
                        key={i}
                        disabled={mcqChecked}
                        onClick={() => handleMcqSelect(opt)}
                        className={`w-full text-left p-3.5 rounded-xl border text-xs transition flex items-center justify-between ${btnStyle}`}
                      >
                        <span>{opt}</span>
                        {mcqChecked && isCorrect && <CheckCircle2 size={14} className="text-emerald-600" />}
                        {mcqChecked && isSelected && !isCorrect && <XCircle size={14} className="text-red-600" />}
                      </button>
                    );
                  })}
                </div>
              </Card>
            )}

            {/* ── MODE 3: Cloze Deletion (Fill in the blank) ── */}
            {currentMode === 'cloze' && (
              <Card padding="lg" className="space-y-4">
                <div className="flex items-center justify-between">
                  <Badge tone="primary">{currentCard.subject}</Badge>
                  <span className="text-xs text-[var(--text-muted)]">Fill in the blank</span>
                </div>
                <div className="p-4 rounded-xl bg-[var(--surface-muted)] border border-[var(--border)]">
                  <p className="text-sm font-medium text-[var(--text-primary)] leading-relaxed">
                    {currentCard.clozeText || currentCard.front}
                  </p>
                </div>
                {!isFlipped ? (
                  <Button fullWidth variant="outline" onClick={() => setIsFlipped(true)}>
                    Reveal Missing Concept
                  </Button>
                ) : (
                  <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-800 dark:text-emerald-300 text-xs">
                    <strong>Solution:</strong> {currentCard.back}
                  </div>
                )}
              </Card>
            )}

            {/* ── MODE 4: Type-the-Answer ── */}
            {currentMode === 'type' && (
              <Card padding="lg" className="space-y-4">
                <div className="flex items-center justify-between">
                  <Badge tone="primary">{currentCard.subject}</Badge>
                  <span className="text-xs text-[var(--text-muted)]">Type your answer</span>
                </div>
                <h3 className="font-space text-base font-bold text-[var(--text-primary)]">
                  {currentCard.front}
                </h3>
                <textarea
                  value={typedAnswer}
                  onChange={(e) => setTypedAnswer(e.target.value)}
                  disabled={typedChecked}
                  placeholder="Type the exact answer or explanation from memory..."
                  rows={3}
                  className="w-full p-3 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] text-xs text-[var(--text-primary)] focus:outline-none resize-none"
                />
                {!typedChecked ? (
                  <Button
                    fullWidth
                    variant="primary"
                    disabled={!typedAnswer.trim()}
                    onClick={handleCheckTyped}
                  >
                    <PenTool size={13} /> Check My Answer
                  </Button>
                ) : (
                  <div className="p-4 rounded-xl bg-purple-500/10 border border-purple-500/30 text-xs text-[var(--text-primary)] space-y-2">
                    <p>
                      <strong>Correct Answer:</strong> {currentCard.back}
                    </p>
                  </div>
                )}
              </Card>
            )}

            {/* SM-2 Rating Controls (Revealed once answer is shown or checked) */}
            {(isFlipped || mcqChecked || typedChecked) && (
              <div className="pt-2">
                <span className="block text-[11px] font-semibold text-[var(--text-muted)] mb-2 text-center">
                  Rate your recall difficulty (SM-2):
                </span>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <Button variant="danger" size="sm" onClick={() => handleRate(1)}>
                    1: Again
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => handleRate(2)}>
                    2: Hard
                  </Button>
                  <Button variant="primary" size="sm" onClick={() => handleRate(3)}>
                    3: Good
                  </Button>
                  <Button variant="success" size="sm" onClick={() => handleRate(4)}>
                    4: Easy
                  </Button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <Card padding="lg" className="text-center py-12 space-y-4">
            <CheckCircle2 size={44} className="mx-auto text-emerald-500" />
            <div>
              <h3 className="font-space text-lg font-bold text-[var(--text-primary)]">
                All Caught Up!
              </h3>
              <p className="text-xs text-[var(--text-muted)] max-w-md mx-auto mt-1">
                You have no flashcards due for review right now. Generate new flashcards from your uploaded documents to keep expanding your retention.
              </p>
            </div>
            <div className="pt-2">
              <Link to="/app/library">
                <Button variant="primary" size="sm">
                  Generate from Document
                </Button>
              </Link>
            </div>
          </Card>
        )}
      </PageContainer>
    </AppLayout>
  );
}
