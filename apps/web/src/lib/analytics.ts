import { API_BASE } from './api';

export type TrackSubject = { subjectType: 'PORTFOLIO_ITEM' | 'POST' | 'PROFILE_LINK'; subjectId: string };

/**
 * Fire-and-forget analytics beacon (plays, link clicks). The server decides whether it counts
 * (public subject, not the owner, not a bot, once per viewer per day); profile views are counted
 * by the server itself. Never blocks navigation or playback.
 */
export function track(event: 'PLAY' | 'LINK_CLICK', subject: TrackSubject) {
  const url = `${API_BASE}/api/v1/analytics/events`;
  const body = JSON.stringify({ event, ...subject });
  try {
    if (navigator.sendBeacon?.(url, new Blob([body], { type: 'application/json' }))) return;
  } catch {
    // fall through to fetch
  }
  void fetch(url, { method: 'POST', body, headers: { 'Content-Type': 'application/json' }, credentials: 'include', keepalive: true }).catch(
    () => {},
  );
}
