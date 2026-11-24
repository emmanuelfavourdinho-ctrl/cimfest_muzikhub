import { useState } from 'react';
import { Flag } from 'lucide-react';
import { toast } from 'sonner';
import { REPORT_REASONS, type CreateReportInput, type ReportReason } from '@muzikhub/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/Dialog';
import { Field, Select, Textarea } from '@/components/ui/form';
import { api, errorMessage } from '@/lib/api';

/** Stores a real report (reviewed by moderators once Milestone 5 ships — said plainly to the user). */
export function ReportButton({ targetType, targetId, compact = false }: Pick<CreateReportInput, 'targetType' | 'targetId'> & { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReportReason>('SPAM');
  const [details, setDetails] = useState('');
  const [sending, setSending] = useState(false);

  async function submit() {
    setSending(true);
    try {
      await api.report({ targetType, targetId, reason, details: details.trim() || undefined });
      toast.success('Report received. Thank you for helping keep MuzikHub safe.');
      setOpen(false);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <Button type="button" variant="quiet" size={compact ? 'icon' : 'sm'} onClick={() => setOpen(true)} aria-label="Report">
        <Flag /> {!compact && 'Report'}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Report this content">
        <Field label="What's wrong?">
          {(a) => (
            <Select {...a} value={reason} onChange={(e) => setReason(e.target.value as ReportReason)}>
              {Object.entries(REPORT_REASONS).map(([k, label]) => (
                <option key={k} value={k}>{label}</option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Details (optional)">{(a) => <Textarea {...a} value={details} maxLength={1000} onChange={(e) => setDetails(e.target.value)} />}</Field>
        <p className="mb-4 text-xs text-sage-dim">Reports are private. The person you report isn't told who reported them.</p>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={sending}>{sending ? 'Sending…' : 'Send report'}</Button>
        </div>
      </Dialog>
    </>
  );
}
