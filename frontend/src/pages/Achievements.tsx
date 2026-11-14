import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Flame,
  Target,
  Brain,
  BookOpen,
  Zap,
  Trophy,
  Lock,
  Award,
  Code,
  Layers,
  Clock,
  Users,
  CheckCircle2,
  Sparkles,
} from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageContainer, CardGrid } from '@/components/layout/PageContainer';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { AnimatedNumber } from '@/components/ui/AnimatedNumber';
import { EmptyState } from '@/components/ui/EmptyState';
import { useStats } from '@/store/StatsContext';
import { useToast } from '@/store/ToastContext';
import { gamificationService, type BadgeItem } from '@/services/gamificationService';
import { getSocket } from '@/services/socket';

const ICONS: Record<string, typeof Flame> = {
  flame: Flame,
  target: Target,
  brain: Brain,
  book: BookOpen,
  zap: Zap,
  trophy: Trophy,
  award: Award,
  code: Code,
  layers: Layers,
  clock: Clock,
  users: Users,
  check: CheckCircle2,
};

const CATEGORIES = [
  { id: 'all', label: 'All Badges' },
  { id: 'assessments', label: 'Assessments' },
  { id: 'streak', label: 'Streak' },
  { id: 'study', label: 'Study & Mastery' },
  { id: 'coding', label: 'Coding' },
  { id: 'interviews', label: 'Interviews' },
  { id: 'community', label: 'Community' },
];

const RARITY_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  common: { bg: 'bg-slate-100 dark:bg-slate-800', text: 'text-slate-700 dark:text-slate-300', border: 'border-slate-300 dark:border-slate-700' },
  rare: { bg: 'bg-blue-50 dark:bg-blue-950/40', text: 'text-blue-700 dark:text-blue-300', border: 'border-blue-300 dark:border-blue-800' },
  epic: { bg: 'bg-purple-50 dark:bg-purple-950/40', text: 'text-purple-700 dark:text-purple-300', border: 'border-purple-300 dark:border-purple-800' },
  legendary: { bg: 'bg-amber-50 dark:bg-amber-950/40', text: 'text-amber-700 dark:text-amber-300', border: 'border-amber-300 dark:border-amber-800' },
};

const XP_PER_LEVEL = 500;

export function Achievements() {
  const { stats, refreshStats } = useStats();
  const { showToast } = useToast();
  const [badges, setBadges] = useState<BadgeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  const loadBadges = async () => {
    try {
      const data = await gamificationService.getBadges();
      if (Array.isArray(data)) {
        setBadges(data);
      }
    } catch {
      setBadges([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBadges();

    const socket = getSocket();
    if (!socket) return;

    const onBadgeUnlocked = ({ badge }: { badge: { name: string; xpReward: number } }) => {
      showToast(`🏆 Achievement Unlocked: ${badge.name}! (+${badge.xpReward} XP)`, 'success');
      loadBadges();
      refreshStats();
    };

    socket.on('badge:unlocked', onBadgeUnlocked);
    return () => {
      socket.off('badge:unlocked', onBadgeUnlocked);
    };
  }, []);

  const unlocked = badges.filter((b) => b.unlocked);
  const locked = badges.filter((b) => !b.unlocked);

  const filteredBadges = badges.filter((b) => {
    if (selectedCategory === 'all') return true;
    return b.category === selectedCategory;
  });

  const xp = stats?.xp ?? 0;
  const level = stats?.level ?? Math.floor(xp / XP_PER_LEVEL) + 1;
  const streakDays = stats?.currentStreak ?? 0;
  const xpToNext = XP_PER_LEVEL - (xp % XP_PER_LEVEL);

  return (
    <AppLayout>
      <PageContainer maxWidth="7xl">
        <PageHeader
          title="Achievements & Badges"
          subtitle="Genuine milestones evaluated server-side from your real learning activity."
        />

        {/* Summary Stats */}
        <div className="grid gap-5 sm:grid-cols-3 mb-6">
          <Card padding="lg" className="flex items-center gap-4" hover>
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-600 dark:bg-amber-950/40">
              <Flame size={28} />
            </div>
            <div>
              <p className="font-display text-2xl font-bold text-ink-900 dark:text-ink-50">
                <AnimatedNumber value={streakDays} suffix=" days" />
              </p>
              <p className="text-xs text-ink-500">Current streak</p>
            </div>
          </Card>

          <Card padding="lg" className="flex items-center gap-4" hover>
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-purple-50 text-[#6542C5] dark:bg-purple-950/40 dark:text-[#B59AF7]">
              <Zap size={28} />
            </div>
            <div>
              <p className="font-display text-2xl font-bold text-ink-900 dark:text-ink-50">
                <AnimatedNumber value={xp} suffix=" XP" />
              </p>
              <p className="text-xs text-ink-500">
                Level {level} · {xpToNext} to next
              </p>
            </div>
          </Card>

          <Card padding="lg" className="flex items-center gap-4" hover>
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40">
              <Trophy size={28} />
            </div>
            <div>
              <p className="font-display text-2xl font-bold text-ink-900 dark:text-ink-50">
                <AnimatedNumber value={unlocked.length} />/<AnimatedNumber value={badges.length} />
              </p>
              <p className="text-xs text-ink-500">Badges unlocked</p>
            </div>
          </Card>
        </div>

        {/* Category Filters */}
        <div className="flex flex-wrap items-center gap-2 mb-6 pb-2 border-b border-ink-100 dark:border-ink-800">
          {CATEGORIES.map((cat) => {
            const count = cat.id === 'all' ? badges.length : badges.filter((b) => b.category === cat.id).length;
            const isSelected = selectedCategory === cat.id;
            return (
              <Button
                key={cat.id}
                size="sm"
                variant={isSelected ? 'primary' : 'outline'}
                onClick={() => setSelectedCategory(cat.id)}
                className="text-xs"
              >
                {cat.label} ({count})
              </Button>
            );
          })}
        </div>

        {/* Loading Spinner */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#6542C5] border-t-transparent dark:border-[#B59AF7]" />
            <p className="mt-3 text-xs text-ink-500">Loading verified achievements...</p>
          </div>
        ) : filteredBadges.length === 0 ? (
          <EmptyState
            icon={Trophy}
            title="No badges in this category"
            description="Select another category or start completing study sessions to earn badges."
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filteredBadges.map((badge, idx) => {
              const Icon = ICONS[badge.icon] ?? Award;
              const rarityStyle = RARITY_COLORS[badge.rarity] || RARITY_COLORS.common;
              const pct = badge.threshold > 0 ? Math.min(100, Math.round((badge.progress / badge.threshold) * 100)) : 0;

              return (
                <motion.div
                  key={badge.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.04 }}
                >
                  <Card
                    padding="md"
                    className={`h-full flex flex-col justify-between transition-all ${
                      badge.unlocked
                        ? 'border-emerald-300 dark:border-emerald-800/60 bg-gradient-to-b from-white to-emerald-50/20 dark:from-ink-900 dark:to-emerald-950/10 shadow-sm'
                        : 'opacity-75 border-dashed border-ink-200 dark:border-ink-800 bg-ink-50/50 dark:bg-ink-900/30'
                    }`}
                  >
                    <div>
                      {/* Badge Header: Icon + Title + Rarity */}
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <div
                            className={`flex h-12 w-12 items-center justify-center rounded-2xl shadow-sm ${
                              badge.unlocked
                                ? 'bg-gradient-to-br from-[#6542C5] to-emerald-500 text-white'
                                : 'bg-ink-200 text-ink-400 dark:bg-ink-800 dark:text-ink-600'
                            }`}
                          >
                            {badge.unlocked ? <Icon size={22} /> : <Lock size={20} />}
                          </div>
                          <div>
                            <h3 className="font-display text-sm font-bold text-ink-900 dark:text-ink-50">
                              {badge.name}
                            </h3>
                            <span className="text-[10px] uppercase font-mono tracking-wider font-semibold text-ink-400">
                              {badge.category}
                            </span>
                          </div>
                        </div>

                        <span
                          className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider border ${rarityStyle.bg} ${rarityStyle.text} ${rarityStyle.border}`}
                        >
                          {badge.rarity}
                        </span>
                      </div>

                      {/* Description */}
                      <p className="mt-3 text-xs text-ink-600 dark:text-ink-300">{badge.description}</p>

                      {/* How to Earn (if locked) */}
                      {!badge.unlocked && badge.howToEarn && (
                        <div className="mt-2 text-[11px] text-ink-400 dark:text-ink-500 italic">
                          <span className="font-semibold text-ink-600 dark:text-ink-400">How to earn:</span> {badge.howToEarn}
                        </div>
                      )}
                    </div>

                    {/* Footer: Status / Progress */}
                    <div className="mt-4 pt-3 border-t border-ink-100 dark:border-ink-800/80">
                      {badge.unlocked ? (
                        <div className="flex items-center justify-between text-xs">
                          <Badge tone="success" className="flex items-center gap-1 font-semibold">
                            <CheckCircle2 size={12} /> Unlocked
                          </Badge>
                          <span className="text-[11px] font-mono text-ink-400">
                            {badge.unlockedAt
                              ? new Date(badge.unlockedAt).toLocaleDateString(undefined, {
                                  month: 'short',
                                  day: 'numeric',
                                })
                              : 'Verified'}
                          </span>
                          <span className="text-xs font-bold text-[#6542C5] dark:text-[#B59AF7]">
                            +{badge.xpReward} XP
                          </span>
                        </div>
                      ) : (
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="text-ink-400 font-medium">Progress</span>
                            <span className="font-mono font-semibold text-ink-700 dark:text-ink-300">
                              {badge.progress} / {badge.threshold}
                            </span>
                          </div>
                          <div className="h-1.5 w-full rounded-full bg-ink-200 dark:bg-ink-800 overflow-hidden">
                            <motion.div
                              className="h-full rounded-full bg-gradient-to-r from-[#6542C5] to-accent-500"
                              initial={{ width: 0 }}
                              animate={{ width: `${pct}%` }}
                              transition={{ duration: 0.6 }}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </Card>
                </motion.div>
              );
            })}
          </div>
        )}
      </PageContainer>
    </AppLayout>
  );
}
