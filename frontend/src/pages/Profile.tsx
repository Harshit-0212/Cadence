import { useRef, useState, useEffect } from 'react';
import { Mail, Calendar, Target, Zap, Flame, BookOpen, Edit3, Check, Camera, Award } from 'lucide-react';
import { Link } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { Reveal, Stagger, StaggerItem } from '@/components/ui/Reveal';
import { motion } from 'framer-motion';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
import { Avatar } from '@/components/ui/Avatar';
import { useAuth } from '@/store/AuthContext';
import { useAppData } from '@/store/AppDataContext';
import { useStats } from '@/store/StatsContext';
import { useToast } from '@/store/ToastContext';
import { gamificationService, type BadgeItem } from '@/services/gamificationService';
import { activityService } from '@/services/activityService';

const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

export function Profile() {
  const { user, uploadAvatar } = useAuth();
  const { goal, progress } = useAppData();
  const { stats } = useStats();
  const { showToast } = useToast();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(user?.name ?? '');
  const [uploading, setUploading] = useState(false);
  const [badges, setBadges] = useState<BadgeItem[]>([]);
  const [recentEvents, setRecentEvents] = useState<Array<{ type: string; points: number; time: string; title?: string }>>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    gamificationService.getBadges().then((data) => {
      if (Array.isArray(data)) setBadges(data);
    }).catch(() => {});

    activityService.getActivity().then((res) => {
      const dailyData = res?.dailyData || {};
      const allItems: Array<{ type: string; points: number; time: string; title?: string }> = [];
      Object.values(dailyData).forEach((d: any) => {
        if (Array.isArray(d.items)) allItems.push(...d.items);
      });
      allItems.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
      setRecentEvents(allItems.slice(0, 5));
    }).catch(() => {});
  }, []);

  const save = () => {
    setEditing(false);
    showToast('Profile updated.');
  };

  const handleAvatarPick = () => fileInputRef.current?.click();

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      showToast('Please choose a JPG, PNG, or WEBP image.');
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      showToast('Image is too large. Maximum size is 2MB.');
      return;
    }

    setUploading(true);
    try {
      await uploadAvatar(file);
      showToast('Profile photo updated.');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not upload your photo.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 lg:p-8">
        <Reveal variant="fade-in"><PageHeader title="Profile" subtitle="Your account and learning summary." /></Reveal>

        <Stagger className="grid gap-5 lg:grid-cols-3">
          {/* Profile card */}
          <StaggerItem className="lg:col-span-1"><Card padding="lg" className="h-full">
            <div className="flex flex-col items-center text-center">
              <motion.div whileHover={{ scale: 1.03 }} transition={{ type: "spring", stiffness: 350, damping: 25 }} className="relative group cursor-pointer">
                <Avatar user={user} size={80} className="text-2xl shadow-soft group-hover:shadow-[0_0_24px_rgba(101,66,197,0.3)] dark:group-hover:shadow-[0_0_24px_rgba(181,154,247,0.25)] transition-shadow" />
                <button
                  type="button"
                  onClick={handleAvatarPick}
                  disabled={uploading}
                  aria-label="Change profile photo"
                  className="absolute bottom-0 right-0 flex h-7 w-7 items-center justify-center rounded-full bg-[#6542C5] text-white shadow-soft transition hover:bg-primary-700 disabled:opacity-60"
                >
                  <Camera size={13} />
                </button>
              </motion.div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={handleAvatarChange}
              />
              {editing ? (
                <div className="mt-4 w-full max-w-xs">
                  <Input value={name} onChange={(e) => setName(e.target.value)} label="Name" />
                  <Button size="sm" className="mt-3" fullWidth onClick={save}>
                    <Check size={14} /> Save
                  </Button>
                </div>
              ) : (
                <>
                  <h2 className="mt-4 font-display text-xl font-bold text-ink-900 dark:text-ink-50">{user?.name}</h2>
                  <p className="text-sm text-ink-500 dark:text-ink-400">{user?.email}</p>
                  <Button size="sm" variant="outline" className="mt-4" onClick={() => setEditing(true)}>
                    <Edit3 size={14} /> Edit profile
                  </Button>
                </>
              )}
            </div>
            <div className="mt-6 space-y-3 border-t border-ink-200 pt-4 dark:border-ink-800">
              <InfoRow
                icon={Calendar}
                label="Joined"
                value={new Date(user?.createdAt ?? Date.now()).toLocaleDateString(undefined, {
                  month: 'long',
                  year: 'numeric',
                })}
              />
              <InfoRow icon={Target} label="Current goal" value={goal?.title ?? 'Not set'} />
              <InfoRow icon={Zap} label="Level" value={`Level ${stats?.level ?? 1} · ${stats?.xp ?? 0} XP`} />
            </div>
          </Card>
          </StaggerItem>

          {/* Stats + activity */}
          <StaggerItem className="lg:col-span-2"><div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatBox icon={Flame} label="Streak" value={`${stats?.currentStreak ?? 0} days`} color="warning" />
              <StatBox icon={BookOpen} label="Flashcards Mastered" value={`${stats?.flashcardsMastered ?? progress?.topicsMastered ?? 0}`} color="success" />
              <StatBox icon={Zap} label="Total XP" value={`${stats?.xp ?? 0}`} color="primary" />
              <StatBox
                icon={Target}
                label="Overall"
                value={`${progress?.overallCompletion ?? (stats ? Math.min(100, Math.round(stats.testsTaken * 10 + stats.sessionsCompleted * 5)) : 0)}%`}
                color="accent"
              />
            </div>

            <Card>
              <CardHeader title="Learning Goal" subtitle="Your current study target" />
              {goal ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between rounded-xl border border-ink-200 px-4 py-3 dark:border-ink-800">
                    <div>
                      <p className="text-sm font-semibold text-ink-900 dark:text-ink-50">{goal.title}</p>
                      <p className="text-xs text-ink-400">{goal.subjects.join(', ')}</p>
                    </div>
                    <Badge tone="primary">{goal.type}</Badge>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {goal.topics.map((t) => (
                      <span
                        key={t}
                        className="rounded-lg bg-ink-100 px-3 py-1.5 text-xs font-medium text-ink-600 dark:bg-ink-800 dark:text-ink-300"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-ink-400">No goal set yet.</p>
              )}
            </Card>

            {/* Badges & Honors */}
            <Card>
              <div className="flex items-center justify-between pb-3 border-b border-ink-100 dark:border-ink-800">
                <div>
                  <h3 className="font-display text-base font-semibold text-ink-900 dark:text-ink-50">
                    Badges & Honors
                  </h3>
                  <p className="text-xs text-ink-400">Verified milestone achievements</p>
                </div>
                <Link to="/app/achievements" className="text-xs font-semibold text-[#6542C5] dark:text-[#B59AF7] hover:underline">
                  View all ({badges.length}) →
                </Link>
              </div>

              <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-3">
                {badges.filter((b) => b.unlocked).slice(0, 6).map((b) => (
                  <div
                    key={b.id}
                    className="p-3 rounded-xl border border-emerald-200 dark:border-emerald-800/60 bg-emerald-50/20 dark:bg-emerald-950/20 flex items-center gap-2.5"
                  >
                    <div className="h-8 w-8 rounded-lg bg-emerald-500/10 text-emerald-600 flex items-center justify-center shrink-0">
                      <Award size={16} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold text-ink-900 dark:text-ink-50 truncate">{b.name}</p>
                      <p className="text-[10px] text-ink-400 capitalize truncate">{b.rarity}</p>
                    </div>
                  </div>
                ))}
                {badges.filter((b) => b.unlocked).length === 0 && (
                  <p className="text-xs text-ink-400 col-span-3 py-2 text-center">
                    No badges unlocked yet. Complete mock tests and study sessions to earn badges!
                  </p>
                )}
              </div>
            </Card>

            <Card>
              <CardHeader title="Recent Activity" subtitle="Your latest verified learning events" />
              <div className="space-y-2">
                {recentEvents.length > 0 ? (
                  recentEvents.map((ev, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-3 rounded-xl border border-ink-200 px-4 py-3 dark:border-ink-800"
                    >
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-50 text-[#6542C5] dark:bg-primary-900/40">
                        <Zap size={16} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-ink-900 dark:text-ink-50 truncate">
                          {ev.title || `Completed ${ev.type.replace('_', ' ')}`}
                        </p>
                        <p className="text-xs text-ink-400">
                          {new Date(ev.time).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · +{ev.points} pts
                        </p>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-ink-400 py-3 text-center">No recent activity recorded yet.</p>
                )}
              </div>
            </Card>
          </div>
          </StaggerItem>
        </Stagger>
      </div>
    </AppLayout>
  );
}

function InfoRow({ icon: Icon, label, value }: { icon: typeof Mail; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-ink-100 text-ink-500 dark:bg-ink-800 dark:text-ink-400">
        <Icon size={14} />
      </div>
      <div className="flex-1">
        <p className="text-xs text-ink-400">{label}</p>
        <p className="text-sm font-medium text-ink-900 dark:text-ink-50">{value}</p>
      </div>
    </div>
  );
}

function StatBox({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: typeof Flame;
  label: string;
  value: string;
  color: 'primary' | 'warning' | 'accent' | 'success';
}) {
  const colors = {
    primary: 'bg-primary-50 text-[#6542C5] dark:bg-primary-900/40 dark:text-[#B59AF7]',
    warning: 'bg-warning-50 text-warning-600 dark:bg-warning-700/20 dark:text-warning-400',
    accent: 'bg-accent-50 text-accent-600 dark:bg-accent-900/40 dark:text-accent-300',
    success: 'bg-success-50 text-success-600 dark:bg-success-700/20 dark:text-success-400',
  };
  return (
    <Card padding="sm">
      <div className={`mb-2 flex h-9 w-9 items-center justify-center rounded-lg ${colors[color]}`}>
        <Icon size={16} />
      </div>
      <p className="font-display text-xl font-bold text-ink-900 dark:text-ink-50">{value}</p>
      <p className="text-xs text-ink-400">{label}</p>
    </Card>
  );
}
