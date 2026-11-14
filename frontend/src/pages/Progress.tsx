import { motion } from 'framer-motion';
import { Flame, Clock, BookOpen, Target, Award, AlertCircle, RefreshCw } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { ProgressRing } from '@/components/ui/ProgressRing';
import { AnimatedNumber } from '@/components/ui/AnimatedNumber';
import { Reveal, Stagger, StaggerItem } from '@/components/ui/Reveal';
import { ActivityHeatmap } from '@/components/ui/ActivityHeatmap';
import { useAppData } from '@/store/AppDataContext';
import { useStats } from '@/store/StatsContext';

export function Progress() {
  const { progress, plan, achievements } = useAppData();
  const { stats, loading: statsLoading, error: statsError, refreshStats } = useStats();

  if (statsLoading && !stats) {
    return (
      <AppLayout>
        <div className="p-4 sm:p-6 lg:p-8 space-y-6">
          <PageHeader title="Progress & Stats" subtitle="Loading metrics from database..." />
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-28 rounded-2xl bg-ink-100 dark:bg-ink-800 animate-pulse" />
            ))}
          </div>
          <div className="h-64 rounded-2xl bg-ink-100 dark:bg-ink-800 animate-pulse" />
        </div>
      </AppLayout>
    );
  }

  if (statsError && !stats) {
    return (
      <AppLayout>
        <div className="p-4 sm:p-6 lg:p-8">
          <PageHeader title="Progress & Stats" />
          <div className="max-w-md mx-auto my-12 rounded-2xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/20 p-6 text-center space-y-4">
            <AlertCircle size={36} className="mx-auto text-red-500" />
            <h3 className="font-space text-lg font-bold text-red-900 dark:text-red-200">
              Failed to load stats
            </h3>
            <p className="text-xs text-red-700 dark:text-red-300">
              {statsError}
            </p>
            <button
              onClick={() => refreshStats()}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold transition-colors"
            >
              <RefreshCw size={14} /> Retry Connection
            </button>
          </div>
        </div>
      </AppLayout>
    );
  }

  const overall = stats
    ? Math.min(100, Math.round(stats.testsTaken * 10 + stats.sessionsCompleted * 5))
    : (progress?.overallCompletion ?? 0);
  const streak = stats?.currentStreak ?? 0;
  const hours = stats ? parseFloat((stats.studyMinutes / 60).toFixed(1)) : (progress?.hoursStudied ?? 0);
  const topicsMastered = stats?.flashcardsMastered ?? progress?.topicsMastered ?? 0;
  const daysLeft = plan ? Math.ceil((new Date(plan.examDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : 0;

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 lg:p-8">
        <Reveal variant="fade-in">
          <PageHeader title="Progress & Stats" subtitle="Real-time mastery, activity history, and study streaks." />
        </Reveal>

        {/* Primary Platform Stats (Single Source of Truth) */}
        <Stagger className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4" delay={0.05}>
          <StaggerItem><StatCard icon={Target} label="Overall Completion" value={overall} suffix="%" color="primary" /></StaggerItem>
          <StaggerItem><StatCard icon={Flame} label="Current Streak" value={streak} suffix=" days" color="warning" /></StaggerItem>
          <StaggerItem>
            <StatCard
              icon={Clock}
              label="Study Time"
              value={hours}
              suffix="h"
              decimals={1}
              color="accent"
            />
          </StaggerItem>
          <StaggerItem><StatCard icon={BookOpen} label="Flashcards Mastered" value={topicsMastered} color="success" /></StaggerItem>
        </Stagger>

        {/* Secondary Real Activity Metrics */}
        {stats && (
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3.5 rounded-2xl bg-white dark:bg-ink-900 border border-ink-100 dark:border-ink-800">
              <span className="text-[10px] uppercase font-bold text-ink-400">Mock Tests Taken</span>
              <p className="font-space text-xl font-bold text-ink-900 dark:text-ink-50 mt-0.5">{stats.testsTaken}</p>
            </div>
            <div className="p-3.5 rounded-2xl bg-white dark:bg-ink-900 border border-ink-100 dark:border-ink-800">
              <span className="text-[10px] uppercase font-bold text-ink-400">Average Quiz Score</span>
              <p className="font-space text-xl font-bold text-ink-900 dark:text-ink-50 mt-0.5">
                {stats.testsTaken > 0 ? `${stats.averageScore}%` : '--'}
              </p>
            </div>
            <div className="p-3.5 rounded-2xl bg-white dark:bg-ink-900 border border-ink-100 dark:border-ink-800">
              <span className="text-[10px] uppercase font-bold text-ink-400">Active Days</span>
              <p className="font-space text-xl font-bold text-ink-900 dark:text-ink-50 mt-0.5">{stats.activeDaysCount}</p>
            </div>
            <div className="p-3.5 rounded-2xl bg-white dark:bg-ink-900 border border-ink-100 dark:border-ink-800">
              <span className="text-[10px] uppercase font-bold text-ink-400">Coding Solved</span>
              <p className="font-space text-xl font-bold text-ink-900 dark:text-ink-50 mt-0.5">{stats.codingAcceptedCount}</p>
            </div>
          </div>
        )}

        {/* Activity Spectrum Heatmap */}
        <div className="mt-5">
          <ActivityHeatmap />
        </div>

        <Reveal variant="fade-up" delay={0.1}>
        <div className="mt-5 grid gap-5 lg:grid-cols-3">
          {/* Overall ring */}
          <Card padding="lg" className="flex flex-col items-center" hover>
            <ProgressRing
              value={overall}
              size={160}
              label={`${overall}%`}
              sublabel="overall"
            />
            <p className="mt-4 text-center text-sm text-ink-500 dark:text-ink-400">
              {daysLeft > 0 ? `${daysLeft} days to your exam` : 'Ongoing Curriculum'}
            </p>
          </Card>

          {/* Weekly activity */}
          <Card hover className="lg:col-span-2">
            <CardHeader title="Weekly Study Activity" subtitle="Minutes studied per day" />
            <WeeklyChart data={progress?.weeklyActivity || []} />
            <div className="mt-4 flex items-center justify-between border-t border-ink-200 pt-4 dark:border-ink-800">
              <div>
                <p className="text-xs text-ink-400">Consistency</p>
                <p className="font-display text-xl font-bold text-ink-900 dark:text-ink-50">
                  {progress?.consistencyPercent ?? (stats?.activeDaysCount ? Math.min(100, stats.activeDaysCount * 14) : 0)}%
                </p>
              </div>
              <Badge tone={(progress?.consistencyPercent ?? 0) >= 80 ? 'success' : 'neutral'}>
                {(progress?.consistencyPercent ?? 0) >= 80 ? 'On track' : 'In Progress'}
              </Badge>
            </div>
          </Card>
        </div>
        </Reveal>

        {/* Accuracy trend + topic strengths */}
        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <Card hover>
            <CardHeader title="Quiz Accuracy Trend" subtitle="Week-over-week improvement" />
            <AccuracyChart data={progress?.quizAccuracyTrend || []} />
          </Card>

          <Card hover>
            <CardHeader title="Topic Strength" subtitle="Mastery by topic" />
            <div className="space-y-3">
              {(progress?.topicStrengths || []).length > 0 ? (
                progress!.topicStrengths.map((t) => (
                  <div key={t.id}>
                    <div className="mb-1 flex justify-between text-sm">
                      <span className="text-ink-700 dark:text-ink-200">{t.name}</span>
                      <span className="font-semibold text-ink-900 dark:text-ink-50">{t.strength}%</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-ink-100 dark:bg-ink-800">
                      <motion.div
                        className={`h-full rounded-full ${
                          t.strengthLabel === 'critical'
                            ? 'bg-error-500'
                            : t.strengthLabel === 'weak'
                              ? 'bg-warning-500'
                              : t.strengthLabel === 'moderate'
                                ? 'bg-accent-500'
                                : 'bg-success-500'
                        }`}
                        initial={{ width: 0 }}
                        animate={{ width: `${t.strength}%` }}
                        transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
                      />
                    </div>
                  </div>
                ))
              ) : (
                <div className="py-8 text-center text-xs text-ink-400">
                  Take mock quizzes and coding problems to track topic strength.
                </div>
              )}
            </div>
          </Card>
        </div>

        {/* Milestones */}
        <div className="mt-5">
          <Card hover>
            <CardHeader title="Milestones" subtitle="Key achievements on your journey" />
            <div className="space-y-3">
              {achievements.map((a) => (
                <div
                  key={a.id}
                  className="flex items-center gap-3 rounded-xl border border-ink-200 px-4 py-3 dark:border-ink-800"
                >
                  <div
                    className={`flex h-9 w-9 items-center justify-center rounded-xl ${
                      a.unlocked
                        ? 'bg-success-50 text-success-600 dark:bg-success-700/20'
                        : 'bg-ink-100 text-ink-400 dark:bg-ink-800'
                    }`}
                  >
                    <Award size={18} />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-ink-900 dark:text-ink-50">{a.title}</p>
                    <p className="text-xs text-ink-400">{a.description}</p>
                  </div>
                  <Badge tone={a.unlocked ? 'success' : 'neutral'}>
                    {a.unlocked
                      ? 'Done'
                      : a.progress !== undefined && a.goal !== undefined
                        ? `${a.progress}/${a.goal}`
                        : 'Locked'}
                  </Badge>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  suffix = '',
  decimals = 0,
  color,
}: {
  icon: typeof Flame;
  label: string;
  value: number;
  suffix?: string;
  decimals?: number;
  color: 'primary' | 'warning' | 'accent' | 'success';
}) {
  const colors = {
    primary: 'bg-primary-50 text-[#6542C5] dark:bg-primary-900/40 dark:text-[#B59AF7]',
    warning: 'bg-warning-50 text-warning-600 dark:bg-warning-700/20 dark:text-warning-400',
    accent: 'bg-accent-50 text-accent-600 dark:bg-accent-900/40 dark:text-accent-300',
    success: 'bg-success-50 text-success-600 dark:bg-success-700/20 dark:text-success-400',
  };
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
      <Card hover>
        <div className={`mb-3 flex h-10 w-10 items-center justify-center rounded-xl ${colors[color]}`}>
          <Icon size={20} />
        </div>
        <p className="font-display text-2xl font-bold text-ink-900 dark:text-ink-50">
          <AnimatedNumber value={value} suffix={suffix} decimals={decimals} />
        </p>
        <p className="text-sm text-ink-500 dark:text-ink-400">{label}</p>
      </Card>
    </motion.div>
  );
}

function WeeklyChart({ data }: { data: { day: string; minutes: number }[] }) {
  const max = Math.max(...data.map((d) => d.minutes), 1);
  return (
    <div className="flex items-end justify-between gap-2 pt-2" style={{ height: 180 }}>
      {data.map((d, i) => (
        <div key={d.day} className="flex flex-1 flex-col items-center gap-2">
          <div className="flex w-full flex-1 items-end">
            <motion.div
              className="w-full rounded-t-lg bg-gradient-to-t from-[#6542C5] to-accent-400"
              initial={{ height: 0 }}
              animate={{ height: `${(d.minutes / max) * 140}px` }}
              transition={{ duration: 0.8, delay: i * 0.06, ease: [0.16, 1, 0.3, 1] }}
            />
          </div>
          <span className="text-xs text-ink-400 dark:text-ink-500">{d.day}</span>
        </div>
      ))}
    </div>
  );
}

function AccuracyChart({ data }: { data: { label: string; accuracy: number }[] }) {
  const max = 100;
  return (
    <div className="flex items-end justify-between gap-3 pt-2" style={{ height: 180 }}>
      {data.map((d, i) => (
        <div key={d.label} className="flex flex-1 flex-col items-center gap-2">
          <span className="text-xs font-semibold text-ink-700 dark:text-ink-200">{d.accuracy}%</span>
          <div className="flex w-full flex-1 items-end">
            <motion.div
              className="w-full rounded-t-lg bg-gradient-to-t from-accent-500 to-primary-400"
              initial={{ height: 0 }}
              animate={{ height: `${(d.accuracy / max) * 130}px` }}
              transition={{ duration: 0.8, delay: i * 0.08, ease: [0.16, 1, 0.3, 1] }}
            />
          </div>
          <span className="text-xs text-ink-400 dark:text-ink-500">{d.label}</span>
        </div>
      ))}
    </div>
  );
}
