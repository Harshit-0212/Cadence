import { useMemo, useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Sparkles,
  ArrowRight,
  Brain,
  RefreshCw,
  Compass,
  Flame,
  CheckCircle2,
  Clock,
  Play,
  Layers,
  Calendar,
  BrainCircuit,
  AlertCircle,
  AlertTriangle,
  Zap,
  BookOpen,
  FileText,
  MessageSquare,
  Timer,
  ChevronRight,
} from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageContainer, CardGrid } from '@/components/layout/PageContainer';
import { useAuth } from '@/store/AuthContext';
import { useAppData } from '@/store/AppDataContext';
import { useStats } from '@/store/StatsContext';
import { mockTestStore } from '@/store/MockTestStore';
import { learningFeaturesService } from '@/services/learningFeaturesService';
import { activityService, type ActivityDayItem } from '@/services/activityService';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { SpotlightCard } from '@/components/ui/SpotlightCard';
import { AnimatedNumber } from '@/components/ui/AnimatedNumber';
import { Reveal, Stagger } from '@/components/ui/Reveal';
import { ConfettiCanvas } from '@/components/ui/ConfettiCanvas';
import { ActivityHeatmap } from '@/components/ui/ActivityHeatmap';
import { DashboardSkeleton } from '@/components/dashboard/DashboardSkeleton';

export function Dashboard() {
  const { user } = useAuth();
  const { plan, progress, weakTopics, isReady, autoAdjustPlan } = useAppData();
  const { stats, error: statsError, refreshStats } = useStats();
  const [activeTest, setActiveTest] = useState<ReturnType<typeof mockTestStore.getActiveTest>>(null);
  const [nextCalendarEvent, setNextCalendarEvent] = useState<{ title: string; date?: string } | null>(null);
  const [recentActivities, setRecentActivities] = useState<ActivityDayItem[]>([]);
  const [loadingActivities, setLoadingActivities] = useState(true);

  // Check ongoing mock test
  useEffect(() => {
    const saved = mockTestStore.getActiveTest();
    if (saved && saved.timerEndsAt > Date.now()) {
      setActiveTest(saved);
    } else {
      setActiveTest(null);
    }
  }, []);

  // Fetch real next calendar event
  useEffect(() => {
    learningFeaturesService
      .getCalendarEvents()
      .then((evs) => {
        if (evs && evs.length > 0) {
          setNextCalendarEvent({ title: evs[0].title, date: evs[0].date });
        } else if (plan?.sessions?.length) {
          const next = plan.sessions.find((s) => s.status === 'upcoming');
          if (next) setNextCalendarEvent({ title: next.topic, date: next.date });
        } else {
          setNextCalendarEvent(null);
        }
      })
      .catch(() => setNextCalendarEvent(null));
  }, [plan]);

  // Fetch real recent activity events
  useEffect(() => {
    activityService
      .getActivity()
      .then((res) => {
        const dailyData = res?.dailyData || {};
        const allItems: ActivityDayItem[] = [];
        Object.values(dailyData).forEach((d) => {
          if (Array.isArray(d.items)) allItems.push(...d.items);
        });
        allItems.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
        setRecentActivities(allItems.slice(0, 6));
      })
      .catch(() => setRecentActivities([]))
      .finally(() => setLoadingActivities(false));
  }, []);

  const firstName = user?.name ? user.name.split(' ')[0] : 'Learner';

  const todaySession = useMemo(
    () =>
      plan?.sessions.find((s) => s.status === 'in-progress') ??
      plan?.sessions.find((s) => s.status === 'upcoming') ??
      plan?.sessions[0],
    [plan],
  );

  const hasMissed = plan?.sessions.some((s) => s.status === 'missed') ?? false;
  const overallPercent = plan?.completionPercent ?? progress?.overallCompletion ?? 0;
  const isPlanCompleted = overallPercent >= 100;

  // Single Source of Truth metrics
  const streakDays = stats?.currentStreak ?? 0;
  const dueCardsCount = stats?.flashcardsDue ?? 0;
  const unresolvedMistakes = stats?.mistakesUnresolved ?? 0;
  const lastInterviewScore = stats?.interviewAverageScore ? stats.interviewAverageScore : null;
  const xp = stats?.xp ?? 0;
  const level = stats?.level ?? Math.floor(xp / 500) + 1;

  if (!isReady) {
    return (
      <AppLayout>
        <DashboardSkeleton />
      </AppLayout>
    );
  }

  // Determine stage test status on current planner session
  const getTestStatusBadge = () => {
    if (!todaySession) {
      return <Badge tone="neutral">No Stage Active</Badge>;
    }
    if (todaySession.status === 'completed' || todaySession.lastTestStatus === 'passed') {
      return (
        <Badge tone="success" className="flex items-center gap-1 font-semibold">
          <CheckCircle2 size={12} /> Test Passed ({todaySession.bestScore || 100}%)
        </Badge>
      );
    }
    if (todaySession.lastTestStatus === 'failed') {
      return (
        <Badge tone="warning" className="flex items-center gap-1 font-semibold">
          <AlertTriangle size={12} /> Test Failed (Best: {todaySession.bestScore || 0}%)
        </Badge>
      );
    }
    return (
      <Badge tone="neutral" className="flex items-center gap-1 font-semibold">
        <Clock size={12} /> Test Not Taken
      </Badge>
    );
  };

  return (
    <AppLayout>
      <ConfettiCanvas active={isPlanCompleted} />

      <PageContainer maxWidth="7xl">
        {/* Onboarding Callout if no study plan exists */}
        {!plan && (
          <div className="rounded-2xl border border-[#6542C5]/30 bg-[#F5F3FD] dark:bg-[#B59AF7]/10 p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-[#6542C5]/20 text-[#6542C5] dark:text-[#B59AF7] flex items-center justify-center shrink-0">
                <Sparkles size={20} />
              </div>
              <div>
                <h4 className="font-display text-sm font-bold text-[#6542C5] dark:text-[#B59AF7]">
                  Personalize Your Learning Goal
                </h4>
                <p className="text-xs text-ink-500 dark:text-ink-400 mt-0.5">
                  Set target exam dates and daily hours to auto-generate adaptive study roadmaps with verification tests.
                </p>
              </div>
            </div>
            <Link to="/app/plan">
              <Button size="sm" variant="primary" className="shrink-0">
                Create Study Plan
              </Button>
            </Link>
          </div>
        )}

        {/* Welcome Header */}
        <Reveal variant="fade-up">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 border-b border-ink-200 dark:border-ink-800 pb-5">
            <div>
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#6542C5] dark:text-[#B59AF7]">
                <Sparkles size={14} /> Learning Workspace
              </div>
              <h1 className="mt-1 font-display text-2xl sm:text-3xl font-bold tracking-tight text-ink-900 dark:text-ink-50">
                Welcome back, {firstName}
              </h1>
              <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">
                {todaySession
                  ? `Day ${todaySession.day}: ${todaySession.topic} (~${todaySession.estimatedMinutes} mins)`
                  : 'All sessions up to date! Great consistency.'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Link to="/app/journey">
                <Button size="sm" variant="outline" className="flex items-center gap-1.5">
                  <Compass size={14} /> Open Journey
                </Button>
              </Link>
              <Link to="/app/plan">
                <Button size="sm" variant="primary" className="flex items-center gap-1.5">
                  <BookOpen size={14} /> View Planner
                </Button>
              </Link>
            </div>
          </div>
        </Reveal>

        {/* Resume In-Progress Test Banner */}
        {activeTest && (
          <Reveal variant="fade-up">
            <div className="rounded-2xl border border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-950/20 p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-500/20 text-[#6542C5] dark:text-[#B59AF7] shrink-0">
                  <Play size={18} />
                </div>
                <div>
                  <h4 className="font-display text-sm font-bold text-[#6542C5] dark:text-[#B59AF7]">
                    Mock Test In Progress: {activeTest.subject}
                  </h4>
                  <p className="text-xs text-ink-500 dark:text-ink-400 mt-0.5">
                    You have an ongoing test attempt. Your answers and timer are preserved.
                  </p>
                </div>
              </div>
              <Link to="/app/assessments">
                <Button size="sm" variant="primary" className="shrink-0 flex items-center gap-1.5">
                  <Play size={13} /> Resume Test
                </Button>
              </Link>
            </div>
          </Reveal>
        )}

        {/* Schedule Adjustment Callout */}
        {hasMissed && (
          <Reveal variant="fade-up">
            <div className="rounded-2xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/20 text-amber-600 dark:text-amber-400 shrink-0">
                  <RefreshCw size={18} />
                </div>
                <div>
                  <h4 className="font-display text-sm font-bold text-amber-800 dark:text-amber-300">
                    Schedule adjustment recommended
                  </h4>
                  <p className="text-xs text-ink-500 dark:text-ink-400 mt-0.5">
                    You have a pending session from earlier. Auto-adjust will rebalance your study targets.
                  </p>
                </div>
              </div>
              <Button size="sm" variant="outline" onClick={autoAdjustPlan} className="shrink-0">
                Auto-Adjust Schedule
              </Button>
            </div>
          </Reveal>
        )}

        {/* Stats Error Notification */}
        {statsError && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-xs text-red-800 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-300 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertCircle size={15} />
              <span>Could not refresh real-time stats: {statsError}</span>
            </div>
            <button onClick={() => refreshStats()} className="font-bold underline hover:no-underline">
              Retry
            </button>
          </div>
        )}

        {/* ============================================================
            12-COLUMN DENSE BENTO GRID (Cards with real data & clicks)
            ============================================================ */}
        <CardGrid cols={12}>
          {/* Card 1: Continue Learning Hero (Cols 8 on desktop) */}
          <div className="col-span-12 lg:col-span-8">
            <SpotlightCard className="h-full flex flex-col justify-between bg-gradient-to-br from-[#6542C5] via-[#51329F] to-[#3E2579] text-white border-[#51329F] p-6">
              <div className="space-y-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-[11px] font-bold uppercase tracking-wider font-mono">
                    <Sparkles size={13} /> Active Course
                  </span>
                  <div className="flex items-center gap-2">
                    {getTestStatusBadge()}
                    <span className="text-xs opacity-80">{todaySession?.subject || 'Curriculum'}</span>
                  </div>
                </div>

                <div>
                  <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight">
                    {plan?.goalTitle || 'Personalized Study Plan'}
                  </h2>
                  <p className="mt-1 text-xs sm:text-sm opacity-85">
                    Current Focus: <strong>{todaySession?.topic || 'Day 1 Concept Mastery'}</strong>
                  </p>
                </div>

                <div className="space-y-1.5 pt-2">
                  <div className="flex justify-between items-center text-xs opacity-90">
                    <span>Course Progress</span>
                    <span className="font-mono font-bold text-sm">
                      <AnimatedNumber value={overallPercent} suffix="%" />
                    </span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-white/20 overflow-hidden">
                    <motion.div
                      className="h-full rounded-full bg-[#F2B38C]"
                      initial={{ width: 0 }}
                      animate={{ width: `${overallPercent}%` }}
                      transition={{ duration: 0.8, ease: 'easeOut' }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[11px] opacity-75 pt-1">
                    <span className="flex items-center gap-1">
                      <Clock size={12} /> ~{todaySession?.estimatedMinutes || 45} min estimated
                    </span>
                    <span>
                      Day {todaySession?.day || 1} · {todaySession?.status || 'upcoming'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="pt-6 mt-4 border-t border-white/15 flex items-center justify-between flex-wrap gap-3">
                <Link to="/app/plan">
                  <Button variant="secondary" size="md" className="gap-2 bg-white text-[#51329F] hover:bg-slate-100 font-bold">
                    <Play size={16} className="fill-current" /> Continue Day {todaySession?.day || 1} <ArrowRight size={16} />
                  </Button>
                </Link>
                <Link to="/app/plan" className="text-xs font-semibold opacity-85 hover:opacity-100 underline">
                  View Syllabus & Verification Tests →
                </Link>
              </div>
            </SpotlightCard>
          </div>

          {/* Card 2: Weak Spots with Practice Button (Cols 4 on desktop) */}
          <div className="col-span-12 lg:col-span-4">
            <SpotlightCard className="h-full flex flex-col justify-between p-5">
              <div>
                <div className="flex items-center justify-between pb-3 border-b border-ink-100 dark:border-ink-800 mb-3">
                  <div className="flex items-center gap-2">
                    <div className="h-8 w-8 rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400 flex items-center justify-center">
                      <Brain size={16} />
                    </div>
                    <div>
                      <h3 className="font-display text-sm font-bold text-ink-900 dark:text-ink-50">
                        Weak Spots
                      </h3>
                      <p className="text-[10px] text-ink-400">Targeted quiz drill</p>
                    </div>
                  </div>
                  <span className="text-[10px] font-bold text-amber-600 bg-amber-50 dark:bg-amber-950/40 px-2 py-0.5 rounded-full font-mono">
                    {weakTopics?.length || 0} Topics
                  </span>
                </div>

                <div className="space-y-2">
                  {weakTopics && weakTopics.length > 0 ? (
                    weakTopics.slice(0, 4).map((topic) => (
                      <div
                        key={topic}
                        className="p-2.5 rounded-xl border border-ink-200 dark:border-ink-800 bg-ink-50/50 dark:bg-ink-900/40 flex items-center justify-between gap-2"
                      >
                        <span className="text-xs font-semibold text-ink-900 dark:text-ink-100 truncate">
                          {topic}
                        </span>
                        <Link to={`/app/assessments?topic=${encodeURIComponent(topic)}`}>
                          <Button size="sm" variant="outline" className="text-[10px] h-7 px-2 font-bold shrink-0">
                            Practice →
                          </Button>
                        </Link>
                      </div>
                    ))
                  ) : (
                    <div className="p-6 text-center text-xs text-ink-400 space-y-1">
                      <CheckCircle2 size={24} className="mx-auto text-emerald-500" />
                      <p className="font-semibold text-ink-900 dark:text-ink-50">No gaps detected!</p>
                      <p className="text-[11px]">Maintain consistency across sessions.</p>
                    </div>
                  )}
                </div>
              </div>

              <div className="pt-3 border-t border-ink-100 dark:border-ink-800 mt-3">
                <Link to="/app/assessments">
                  <Button variant="ghost" size="sm" className="w-full text-xs font-semibold">
                    Open All Assessments →
                  </Button>
                </Link>
              </div>
            </SpotlightCard>
          </div>

          {/* Card 3: Due Flashcards (Cols 4) */}
          <div className="col-span-12 sm:col-span-6 lg:col-span-4">
            <SpotlightCard className="p-5 flex flex-col justify-between h-full">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-xl bg-purple-50 dark:bg-purple-950/40 text-[#6542C5] dark:text-[#B59AF7] flex items-center justify-center shrink-0">
                    <Layers size={18} />
                  </div>
                  <div>
                    <h4 className="font-display text-sm font-bold text-ink-900 dark:text-ink-50">
                      Spaced Repetition
                    </h4>
                    <p className="text-[10px] text-ink-400">SM-2 Active Recall</p>
                  </div>
                </div>
                <Badge tone={dueCardsCount > 0 ? 'primary' : 'neutral'}>
                  {dueCardsCount} Due
                </Badge>
              </div>

              <div className="my-4">
                <p className="font-display text-2xl font-bold text-ink-900 dark:text-ink-50">
                  <AnimatedNumber value={dueCardsCount} suffix=" cards" />
                </p>
                <p className="text-xs text-ink-500 mt-0.5">
                  {dueCardsCount > 0
                    ? 'Scheduled for optimal memory retention.'
                    : 'All caught up! No cards currently due.'}
                </p>
              </div>

              <Link to="/app/flashcards">
                <Button size="sm" variant={dueCardsCount > 0 ? 'primary' : 'outline'} className="w-full text-xs font-bold">
                  {dueCardsCount > 0 ? `Study ${dueCardsCount} Cards` : 'Open Flashcards Deck'} →
                </Button>
              </Link>
            </SpotlightCard>
          </div>

          {/* Card 4: Unresolved Mistakes (Cols 4) */}
          <div className="col-span-12 sm:col-span-6 lg:col-span-4">
            <SpotlightCard className="p-5 flex flex-col justify-between h-full">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-xl bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                    <AlertTriangle size={18} />
                  </div>
                  <div>
                    <h4 className="font-display text-sm font-bold text-ink-900 dark:text-ink-50">
                      Mistake Notebook
                    </h4>
                    <p className="text-[10px] text-ink-400">Targeted error resolution</p>
                  </div>
                </div>
                <Badge tone={unresolvedMistakes > 0 ? 'warning' : 'success'}>
                  {unresolvedMistakes} Unresolved
                </Badge>
              </div>

              <div className="my-4">
                <p className="font-display text-2xl font-bold text-ink-900 dark:text-ink-50">
                  <AnimatedNumber value={unresolvedMistakes} suffix=" items" />
                </p>
                <p className="text-xs text-ink-500 mt-0.5">
                  {unresolvedMistakes > 0
                    ? 'Review and resolve mistakes to gain +15 XP.'
                    : 'Clean record! No unresolved mistakes.'}
                </p>
              </div>

              <Link to="/app/mistakes">
                <Button size="sm" variant="outline" className="w-full text-xs font-bold">
                  Review Mistakes →
                </Button>
              </Link>
            </SpotlightCard>
          </div>

          {/* Card 5: Next Calendar Target (Cols 4) */}
          <div className="col-span-12 sm:col-span-6 lg:col-span-4">
            <SpotlightCard className="p-5 flex flex-col justify-between h-full">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-xl bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
                    <Calendar size={18} />
                  </div>
                  <div>
                    <h4 className="font-display text-sm font-bold text-ink-900 dark:text-ink-50">
                      Calendar Schedule
                    </h4>
                    <p className="text-[10px] text-ink-400">Study plan timeline</p>
                  </div>
                </div>
                <Badge tone="neutral">Upcoming</Badge>
              </div>

              <div className="my-4">
                <p className="font-display text-lg font-bold text-ink-900 dark:text-ink-50 truncate">
                  {nextCalendarEvent ? nextCalendarEvent.title : 'Study Session'}
                </p>
                <p className="text-xs text-ink-500 mt-0.5 truncate">
                  {nextCalendarEvent?.date
                    ? `Target: ${new Date(nextCalendarEvent.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
                    : 'Scheduled in study plan.'}
                </p>
              </div>

              <Link to="/app/calendar">
                <Button size="sm" variant="outline" className="w-full text-xs font-bold">
                  Open Calendar →
                </Button>
              </Link>
            </SpotlightCard>
          </div>

          {/* Card 6: AI Interview Score & Report (Cols 4) */}
          <div className="col-span-12 sm:col-span-6 lg:col-span-4">
            <SpotlightCard className="p-5 flex flex-col justify-between h-full">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                    <BrainCircuit size={18} />
                  </div>
                  <div>
                    <h4 className="font-display text-sm font-bold text-ink-900 dark:text-ink-50">
                      Mock Interview
                    </h4>
                    <p className="text-[10px] text-ink-400">AI Speech & Technical</p>
                  </div>
                </div>
                <Badge tone={lastInterviewScore !== null ? 'success' : 'neutral'}>
                  {lastInterviewScore !== null ? 'Evaluated' : 'Practice'}
                </Badge>
              </div>

              <div className="my-4">
                <p className="font-display text-2xl font-bold text-ink-900 dark:text-ink-50">
                  {lastInterviewScore !== null ? `${lastInterviewScore}%` : 'Not attempted'}
                </p>
                <p className="text-xs text-ink-500 mt-0.5">
                  {lastInterviewScore !== null
                    ? 'Latest technical interview performance.'
                    : 'Practice live coding and behavioral questions.'}
                </p>
              </div>

              <Link to="/app/interview">
                <Button size="sm" variant="outline" className="w-full text-xs font-bold">
                  {lastInterviewScore !== null ? 'View Interview Report →' : 'Start Practice Interview →'}
                </Button>
              </Link>
            </SpotlightCard>
          </div>

          {/* Card 7: Gamification Metrics & Badges (Cols 4) */}
          <div className="col-span-12 sm:col-span-6 lg:col-span-4">
            <SpotlightCard className="p-5 flex flex-col justify-between h-full">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-xl bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                    <Flame size={18} />
                  </div>
                  <div>
                    <h4 className="font-display text-sm font-bold text-ink-900 dark:text-ink-50">
                      Streak & XP
                    </h4>
                    <p className="text-[10px] text-ink-400">Level {level} Scholar</p>
                  </div>
                </div>
                <Badge tone="accent">Level {level}</Badge>
              </div>

              <div className="my-4 flex items-center gap-6">
                <div>
                  <p className="font-display text-2xl font-bold text-ink-900 dark:text-ink-50 flex items-center gap-1">
                    <Flame size={20} className="text-amber-500 fill-current" />
                    <AnimatedNumber value={streakDays} suffix="d" />
                  </p>
                  <p className="text-[10px] text-ink-400">Current Streak</p>
                </div>
                <div>
                  <p className="font-display text-2xl font-bold text-ink-900 dark:text-ink-50 flex items-center gap-1">
                    <Zap size={20} className="text-[#6542C5] dark:text-[#B59AF7]" />
                    <AnimatedNumber value={xp} />
                  </p>
                  <p className="text-[10px] text-ink-400">Total Verified XP</p>
                </div>
              </div>

              <Link to="/app/achievements">
                <Button size="sm" variant="outline" className="w-full text-xs font-bold">
                  View Badges & Milestones →
                </Button>
              </Link>
            </SpotlightCard>
          </div>

          {/* Card 8: Quick Actions Row (Cols 4 on desktop) */}
          <div className="col-span-12 sm:col-span-6 lg:col-span-4">
            <SpotlightCard className="p-5 flex flex-col justify-between h-full">
              <div>
                <h4 className="font-display text-sm font-bold text-ink-900 dark:text-ink-50 mb-1">
                  Quick Actions
                </h4>
                <p className="text-[10px] text-ink-400 mb-3">Jump right into study modes</p>

                <div className="grid grid-cols-2 gap-2">
                  <Link to="/app/assessments">
                    <Button size="sm" variant="outline" className="w-full text-[11px] justify-start h-8 px-2 font-semibold">
                      <Play size={12} /> Mock Test
                    </Button>
                  </Link>
                  <Link to="/app/calendar">
                    <Button size="sm" variant="outline" className="w-full text-[11px] justify-start h-8 px-2 font-semibold">
                      <Timer size={12} /> Focus Session
                    </Button>
                  </Link>
                  <Link to="/app/tutor">
                    <Button size="sm" variant="outline" className="w-full text-[11px] justify-start h-8 px-2 font-semibold">
                      <MessageSquare size={12} /> Ask AI Tutor
                    </Button>
                  </Link>
                  <Link to="/app/library">
                    <Button size="sm" variant="outline" className="w-full text-[11px] justify-start h-8 px-2 font-semibold">
                      <FileText size={12} /> Upload Doc
                    </Button>
                  </Link>
                </div>
              </div>

              <div className="pt-3 border-t border-ink-100 dark:border-ink-800 mt-2">
                <Link to="/app/coding">
                  <Button variant="ghost" size="sm" className="w-full text-xs font-semibold">
                    Coding Studio →
                  </Button>
                </Link>
              </div>
            </SpotlightCard>
          </div>

          {/* Live Heatmap Component (Cols 12) */}
          <div className="col-span-12">
            <ActivityHeatmap compact />
          </div>

          {/* Real Recent Activity Feed (Cols 12) */}
          <div className="col-span-12">
            <Card padding="lg">
              <div className="flex items-center justify-between pb-3 border-b border-ink-100 dark:border-ink-800 mb-3">
                <div>
                  <h3 className="font-display text-base font-bold text-ink-900 dark:text-ink-50">
                    Recent Verified Activity
                  </h3>
                  <p className="text-xs text-ink-400">Authentic learning events recorded on server</p>
                </div>
                <Link to="/app/progress" className="text-xs font-semibold text-[#6542C5] dark:text-[#B59AF7] hover:underline">
                  View Full Analytics →
                </Link>
              </div>

              {loadingActivities ? (
                <div className="py-8 text-center text-xs text-ink-400">Loading activity feed...</div>
              ) : recentActivities.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {recentActivities.map((ev, i) => (
                    <div
                      key={i}
                      className="p-3 rounded-xl border border-ink-200 dark:border-ink-800 bg-ink-50/50 dark:bg-ink-900/30 flex items-center gap-3"
                    >
                      <div className="h-9 w-9 rounded-xl bg-purple-50 dark:bg-purple-950/40 text-[#6542C5] dark:text-[#B59AF7] flex items-center justify-center shrink-0">
                        <Zap size={16} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-bold text-ink-900 dark:text-ink-50 truncate">
                          {ev.title || `Completed ${ev.type.replace('_', ' ')}`}
                        </p>
                        <p className="text-[10px] text-ink-400">
                          {new Date(ev.time).toLocaleDateString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}{' '}
                          · +{ev.points} pts
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-8 text-center text-xs text-ink-400 space-y-1">
                  <CheckCircle2 size={24} className="mx-auto text-ink-300" />
                  <p className="font-semibold text-ink-700 dark:text-ink-300">No activity events recorded yet.</p>
                  <p className="text-[11px]">Take a mock test or pass a stage test to start logging events!</p>
                </div>
              )}
            </Card>
          </div>
        </CardGrid>
      </PageContainer>
    </AppLayout>
  );
}
