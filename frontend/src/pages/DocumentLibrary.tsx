import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FileText,
  Search,
  Sparkles,
  CheckSquare,
  UploadCloud,
  MessageSquare,
  Trash2,
  Loader2,
  BookOpen,
  X,
  AlertTriangle,
  RotateCcw,
} from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageContainer, CardGrid } from '@/components/layout/PageContainer';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { useToast } from '@/store/ToastContext';
import { documentService } from '@/services/documentService';
import { learningFeaturesService } from '@/services/learningFeaturesService';
import { invalidateStats } from '@/store/StatsContext';
import { safeRenderText, SafeText } from '@/utils/safeRender';

interface DocumentItem {
  id: string;
  name: string;
  subject: string;
  summary: string;
  keyPoints: Array<any>;
  uploadedAt: string;
}

export function DocumentLibrary() {
  const { showToast } = useToast();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [search, setSearch] = useState('');
  const [uploading, setUploading] = useState(false);
  const [docCardCounts, setDocCardCounts] = useState<Record<string, number>>({});
  const [generatingCardsDocId, setGeneratingCardsDocId] = useState<string | null>(null);
  const [generationSummary, setGenerationSummary] = useState<{
    doc: DocumentItem;
    created: number;
    skipped: number;
    cards: any[];
  } | null>(null);
  const [generationError, setGenerationError] = useState<{
    doc: DocumentItem;
    message: string;
  } | null>(null);

  useEffect(() => {
    learningFeaturesService
      .getAllFlashcards()
      .then((all) => {
        const counts: Record<string, number> = {};
        if (Array.isArray(all)) {
          for (const c of all) {
            if (c.sourceDocId) {
              counts[c.sourceDocId] = (counts[c.sourceDocId] || 0) + 1;
            }
          }
        }
        setDocCardCounts(counts);
      })
      .catch(() => {});
  }, []);

  const [docs, setDocs] = useState<DocumentItem[]>([
    {
      id: 'doc1',
      name: 'Operating_Systems_Process_Synchronization.pdf',
      subject: 'Operating Systems',
      summary:
        'Detailed overview of critical section problem, semaphores, mutexes, and classic IPC synchronization problems.',
      keyPoints: ['Dining Philosophers Solution', 'Peterson Algorithm', 'Priority Inversion'],
      uploadedAt: 'Nov 10, 2026',
    },
    {
      id: 'doc2',
      name: 'Graph_Algorithms_Cheatsheet.docx',
      subject: 'DSA',
      summary:
        'Condensed notes covering Dijkstra, Bellman-Ford, Floyd-Warshall, and Topological Sorting.',
      keyPoints: ['Negative cycle detection', 'DAG relaxation', 'Disjoint Set Union'],
      uploadedAt: 'Nov 08, 2026',
    },
  ]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const res = await documentService.analyze(file);
      const newDoc: DocumentItem = {
        id: res.documentId,
        name: file.name,
        subject: (res.analysis as any).subject || 'General Study',
        summary: res.analysis.summary,
        keyPoints: (res.analysis as any).keyPoints || (res.analysis as any).topics || [],
        uploadedAt: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      };
      setDocs((prev) => [newDoc, ...prev]);
      showToast('Document analyzed & synthesized successfully.', 'success');
      invalidateStats();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Upload failed.';
      showToast(msg, 'error');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDelete = (id: string) => {
    setDocs((prev) => prev.filter((d) => d.id !== id));
    showToast('Document removed from your library.', 'info');
  };

  const handleGenerateTest = async (doc: DocumentItem) => {
    try {
      navigate('/app/assessments');
      showToast(`Navigated to Assessments to generate test for "${doc.name}".`, 'info');
    } catch {
      showToast('Could not initiate test.', 'error');
    }
  };

  const handleMakeFlashcards = async (doc: DocumentItem) => {
    if (generatingCardsDocId) return;
    setGeneratingCardsDocId(doc.id);
    setGenerationError(null);

    try {
      let existingQuestions: string[] = [];
      try {
        const allCards = await learningFeaturesService.getAllFlashcards();
        existingQuestions = allCards
          .filter((c: any) => c.sourceDocId === doc.id)
          .map((c: any) => c.front);
      } catch {
        // Continue if query fails
      }

      const highlightsText = doc.keyPoints
        .map((k) => (typeof k === 'object' && k !== null ? k.name || JSON.stringify(k) : String(k)))
        .join(', ');

      const res = await learningFeaturesService.generateFlashcardsForDocument({
        documentId: doc.id,
        documentName: doc.name,
        documentContent: `${doc.summary} Key highlights: ${highlightsText}`,
        existingQuestions,
      });

      const { created = 0, skipped = 0, cards = [] } = res || {};
      setDocCardCounts((prev) => ({
        ...prev,
        [doc.id]: (prev[doc.id] || 0) + created,
      }));

      setGenerationSummary({
        doc,
        created,
        skipped,
        cards,
      });

      if (created > 0) {
        showToast(`Created ${created} new flashcards (${skipped} duplicates skipped).`, 'success');
      } else if (skipped > 0) {
        showToast(`All ${skipped} generated cards already exist in your deck.`, 'info');
      } else {
        showToast('Flashcard deck is already comprehensive for this document.', 'info');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Flashcard generation failed.';
      setGenerationError({ doc, message: msg });
      showToast(msg, 'error');
    } finally {
      setGeneratingCardsDocId(null);
    }
  };

  const handleAskTutor = (doc: DocumentItem) => {
    navigate('/app/tutor');
    showToast(`Started AI Tutor session grounded in "${doc.name}".`, 'info');
  };

  const filteredDocs = docs.filter(
    (d) =>
      d.name.toLowerCase().includes(search.toLowerCase()) ||
      d.subject.toLowerCase().includes(search.toLowerCase()) ||
      d.summary.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <AppLayout>
      <PageContainer maxWidth="7xl">
        <PageHeader
          title="Document Library & Notes"
          subtitle="All lecture notes and study documents with instant AI synthesis."
          action={
            <div className="flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.docx,.jpg,.jpeg,.png,.webp"
                className="hidden"
                onChange={handleFileUpload}
              />
              <Button
                size="sm"
                variant="primary"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
              >
                {uploading ? (
                  <>
                    <Loader2 size={14} className="animate-spin" /> Analyzing...
                  </>
                ) : (
                  <>
                    <UploadCloud size={14} /> Upload Notes
                  </>
                )}
              </Button>
            </div>
          }
        />

        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 text-ink-400 size-4" />
            <input
              type="text"
              placeholder="Search your library by document or topic..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full h-10 pl-9 pr-4 text-xs rounded-xl border border-ink-200 dark:border-ink-800 bg-[var(--surface)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[#6542C5]/30"
            />
          </div>
        </div>

        {/* Generation Error Banner with Retry */}
        {generationError && (
          <div className="p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="size-9 rounded-xl bg-rose-500/10 text-rose-600 dark:text-rose-400 flex items-center justify-center shrink-0">
                <AlertTriangle size={18} />
              </div>
              <div>
                <p className="text-xs font-bold text-rose-800 dark:text-rose-200">
                  Failed to generate cards for "{generationError.doc.name}"
                </p>
                <p className="text-[11px] text-rose-600 dark:text-rose-400 mt-0.5">
                  {generationError.message}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleMakeFlashcards(generationError.doc)}
              >
                <RotateCcw size={12} /> Retry
              </Button>
              <button
                onClick={() => setGenerationError(null)}
                className="p-1.5 text-rose-400 hover:text-rose-600"
                aria-label="Dismiss error"
              >
                <X size={14} />
              </button>
            </div>
          </div>
        )}

        {/* Generated Cards Result Modal / Card */}
        {generationSummary && (
          <div className="p-5 rounded-2xl bg-purple-50 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-800 space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="size-10 rounded-xl bg-[#6542C5]/10 text-[#6542C5] dark:text-[#B59AF7] flex items-center justify-center shrink-0">
                  <Sparkles size={20} />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-[var(--text-primary)]">
                    Flashcards Generated: {generationSummary.doc.name}
                  </h4>
                  <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                    <strong>{generationSummary.created} new</strong>, {generationSummary.skipped} duplicates skipped
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => navigate(`/app/flashcards?docId=${generationSummary.doc.id}`)}
                >
                  <BookOpen size={13} /> Study these cards
                </Button>
                <button
                  onClick={() => setGenerationSummary(null)}
                  className="p-1.5 text-ink-400 hover:text-ink-600 dark:hover:text-ink-200"
                  aria-label="Dismiss summary"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {generationSummary.cards.length > 0 && (
              <div className="grid gap-2 sm:grid-cols-2 max-h-60 overflow-y-auto pt-1">
                {generationSummary.cards.slice(0, 6).map((c, idx) => (
                  <div
                    key={c.id || idx}
                    className="p-3 rounded-xl bg-white dark:bg-[#1D1922] border border-purple-100 dark:border-purple-900/40 text-xs space-y-1"
                  >
                    <p className="font-semibold text-[var(--text-primary)] line-clamp-2">
                      Q: {c.front}
                    </p>
                    <p className="text-[var(--text-muted)] line-clamp-2">
                      A: {c.back}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <CardGrid cols={12}>
          {filteredDocs.map((doc) => (
            <div key={doc.id} className="col-span-12 md:col-span-6 flex">
              <Card padding="lg" className="w-full flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Badge tone="primary">{doc.subject}</Badge>
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20">
                        {docCardCounts[doc.id] || 0} cards
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-[var(--text-muted)] font-mono">
                        {doc.uploadedAt}
                      </span>
                      <button
                        onClick={() => handleDelete(doc.id)}
                        aria-label="Delete document"
                        className="text-[var(--text-muted)] hover:text-red-500 transition-colors p-1"
                        title="Delete document"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>

                  <h3 className="font-space font-bold text-sm text-[var(--text-primary)] flex items-center gap-2">
                    <FileText size={16} className="text-[#6542C5] dark:text-[#B59AF7]" />
                    {doc.name}
                  </h3>

                  <p className="mt-2 text-xs text-[var(--text-secondary)] leading-relaxed">
                    {doc.summary}
                  </p>

                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {doc.keyPoints.map((pt, idx) => {
                      if (typeof pt === 'object' && pt !== null) {
                        return (
                          <div
                            key={idx}
                            className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] bg-[var(--surface-muted)] text-[var(--text-primary)] border border-[var(--border)]"
                          >
                            <span className="font-medium">{safeRenderText(pt.name || pt)}</span>
                            {pt.importance && (
                              <span className="px-1 py-0.2 rounded text-[9px] font-semibold bg-[#6542C5]/10 text-[#6542C5] dark:text-[#B59AF7]">
                                {safeRenderText(pt.importance)}
                              </span>
                            )}
                            {pt.frequency !== undefined && (
                              <span className="px-1 py-0.2 rounded text-[9px] bg-amber-500/10 text-amber-600 dark:text-amber-400">
                                freq: {safeRenderText(pt.frequency)}
                              </span>
                            )}
                          </div>
                        );
                      }
                      return (
                        <span
                          key={idx}
                          className="px-2 py-0.5 rounded-md text-[10px] bg-[var(--surface-muted)] text-[var(--text-muted)] border border-[var(--border)]"
                        >
                          <SafeText value={pt} />
                        </span>
                      );
                    })}
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-[var(--border)] flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => handleGenerateTest(doc)}>
                    <CheckSquare size={13} /> Gen Test
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={generatingCardsDocId === doc.id}
                    onClick={() => handleMakeFlashcards(doc)}
                  >
                    {generatingCardsDocId === doc.id ? (
                      <>
                        <Loader2 size={13} className="animate-spin" /> Making Cards...
                      </>
                    ) : (
                      <>
                        <Sparkles size={13} /> Make Cards
                      </>
                    )}
                  </Button>
                  <Button size="sm" variant="primary" onClick={() => handleAskTutor(doc)}>
                    <MessageSquare size={13} /> Ask Tutor
                  </Button>
                </div>
              </Card>
            </div>
          ))}
        </CardGrid>
      </PageContainer>
    </AppLayout>
  );
}
