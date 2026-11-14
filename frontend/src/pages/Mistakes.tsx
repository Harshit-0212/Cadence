import { useState, useEffect } from 'react';
import { BookX, CheckCircle, Search, RefreshCw, RotateCcw, Sparkles, Filter, ChevronRight, Loader2 } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageContainer, CardGrid } from '@/components/layout/PageContainer';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { useToast } from '@/store/ToastContext';
import { learningFeaturesService, type MistakeRecord } from '@/services/learningFeaturesService';
import { invalidateStats } from '@/store/StatsContext';

interface MistakeItem {
  id: string;
  question: string;
  userAnswer: string;
  correctAnswer: string;
  subject: string;
  topic: string;
  explanation: string;
  resolved: boolean;
}

export function Mistakes() {
  const { showToast } = useToast();
  const [filter, setFilter] = useState<'all' | 'unresolved' | 'resolved'>('unresolved');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const [items, setItems] = useState<MistakeItem[]>([]);

  const loadData = async () => {
    setLoading(true);
    try {
      const fetched = await learningFeaturesService.getMistakes();
      if (fetched && fetched.length > 0) {
        setItems(
          fetched.map((m: any) => ({
            id: m.id || m._id,
            question: m.question,
            userAnswer: m.userAnswer,
            correctAnswer: m.correctAnswer,
            subject: m.subject || 'General',
            topic: m.topic || 'General',
            explanation: m.explanation || 'Review this concept to master the topic.',
            resolved: Boolean(m.resolved),
          }))
        );
      } else {
        setItems([]);
      }
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleResolve = async (id: string) => {
    try {
      await learningFeaturesService.resolveMistake(id);
      showToast('Marked mistake as resolved! +15 XP earned.', 'success');
    } catch {
      showToast('Marked mistake as resolved.', 'info');
    }
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, resolved: true } : item)));
    invalidateStats();
  };

  const handleReopen = async (id: string) => {
    try {
      await learningFeaturesService.reopenMistake(id);
      showToast('Reopened mistake for active review.', 'info');
    } catch {
      showToast('Reopened mistake.', 'info');
    }
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, resolved: false } : item)));
    invalidateStats();
  };

  const unresolvedCount = items.filter((i) => !i.resolved).length;
  const resolvedCount = items.filter((i) => i.resolved).length;

  const filtered = items.filter((item) => {
    if (filter === 'unresolved' && item.resolved) return false;
    if (filter === 'resolved' && !item.resolved) return false;
    if (search && !item.question.toLowerCase().includes(search.toLowerCase()) && !item.topic.toLowerCase().includes(search.toLowerCase())) {
      return false;
    }
    return true;
  });

  return (
    <AppLayout>
      <PageContainer maxWidth="7xl">
        <PageHeader
          title="Mistake Notebook"
          subtitle="Review incorrect answers across quizzes and drills to master weak spots."
          action={
            <div className="flex items-center gap-2">
              <Button
                variant={filter === 'unresolved' ? 'primary' : 'outline'}
                size="sm"
                onClick={() => setFilter('unresolved')}
              >
                Unresolved ({unresolvedCount})
              </Button>
              <Button
                variant={filter === 'resolved' ? 'primary' : 'outline'}
                size="sm"
                onClick={() => setFilter('resolved')}
              >
                Resolved ({resolvedCount})
              </Button>
              <Button
                variant={filter === 'all' ? 'primary' : 'outline'}
                size="sm"
                onClick={() => setFilter('all')}
              >
                All ({items.length})
              </Button>
            </div>
          }
        />

        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 text-ink-400 size-4" />
            <input
              type="text"
              placeholder="Search mistakes by question or topic..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full h-10 pl-9 pr-4 text-xs rounded-xl border border-ink-200 dark:border-ink-800 bg-[var(--surface)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[#6542C5]/30"
            />
          </div>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-16">
            <Loader2 className="w-8 h-8 animate-spin text-[#6542C5]" />
            <p className="mt-3 text-xs text-[#8A8192]">Loading mistake notebook...</p>
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={CheckCircle}
            title={filter === 'unresolved' ? 'All clear!' : 'No mistakes found'}
            description={
              filter === 'unresolved'
                ? 'You have no unresolved mistakes. Great job mastering your weak spots!'
                : 'No mistakes matching your current filter.'
            }
          />
        ) : (
          <CardGrid cols={12}>
            {filtered.map((item) => (
              <div key={item.id} className="col-span-12 md:col-span-6 flex">
                <Card padding="lg" className="w-full flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        <Badge tone="primary">{item.subject}</Badge>
                        <span className="text-[11px] text-[var(--text-muted)] font-medium">{item.topic}</span>
                      </div>
                      {item.resolved ? (
                        <Badge tone="success">Resolved</Badge>
                      ) : (
                        <Badge tone="warning">Needs Review</Badge>
                      )}
                    </div>
                    <h3 className="font-space font-bold text-sm text-[var(--text-primary)] mt-1">
                      {item.question}
                    </h3>

                    <div className="mt-3 space-y-1.5 text-xs">
                      <p className="text-rose-600 dark:text-rose-400">
                        <span className="font-semibold">Your Answer:</span> {item.userAnswer}
                      </p>
                      <p className="text-emerald-600 dark:text-emerald-400">
                        <span className="font-semibold">Correct Answer:</span> {item.correctAnswer}
                      </p>
                    </div>

                    <div className="mt-3 p-3 rounded-xl bg-[var(--surface-muted)] text-xs text-[var(--text-secondary)] border border-[var(--border)]">
                      <span className="font-bold flex items-center gap-1 mb-0.5 text-[#6542C5] dark:text-[#B59AF7]">
                        <Sparkles size={12} /> Key Concept Explanation
                      </span>
                      {item.explanation}
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-[var(--border)] flex justify-end gap-2">
                    {!item.resolved ? (
                      <Button size="sm" variant="primary" onClick={() => handleResolve(item.id)}>
                        <CheckCircle size={14} /> Mark Resolved
                      </Button>
                    ) : (
                      <>
                        <span className="text-xs text-emerald-600 font-semibold flex items-center gap-1 mr-auto">
                          <CheckCircle size={14} /> Resolved
                        </span>
                        <Button size="sm" variant="outline" onClick={() => handleReopen(item.id)}>
                          <RotateCcw size={13} /> Reopen
                        </Button>
                      </>
                    )}
                  </div>
                </Card>
              </div>
            ))}
          </CardGrid>
        )}
      </PageContainer>
    </AppLayout>
  );
}

