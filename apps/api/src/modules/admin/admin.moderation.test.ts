import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import { makeStaff, resetDatabase, signUp, testApp, uploadMedia } from '../../test/helpers.js';
import { BootstrapError, grantInitialAdmin } from './bootstrap.js';

const app = testApp();
beforeEach(resetDatabase);

async function reportedPost(reporters = 1) {
  const author = await signUp(app);
  const post = await author.agent.post('/api/v1/posts').send({ body: 'buy followers cheap' });
  const reporterList = [];
  for (let i = 0; i < reporters; i++) {
    const r = await signUp(app);
    await r.agent.post('/api/v1/reports').send({ targetType: 'POST', targetId: post.body.id, reason: 'SPAM', details: 'Spam link' });
    reporterList.push(r);
  }
  const reports = await prisma.report.findMany({ orderBy: { createdAt: 'asc' } });
  return { author, postId: post.body.id as string, reports, reporters: reporterList };
}

describe('report lifecycle', () => {
  it('pending → assigned (under review) → notes → resolve with content removal; related reports close too', async () => {
    const mod = await makeStaff(app, 'MODERATOR');
    const { postId, reports } = await reportedPost(2);
    const id = reports[0]!.id;

    const queue = await mod.agent.get('/api/v1/admin/reports?open=true');
    expect(queue.body.items).toHaveLength(2);
    expect(queue.body.items[0]).toMatchObject({
      status: 'PENDING',
      openReportsOnTarget: 2,
      target: { exists: true, text: 'buy followers cheap' },
    });

    expect((await mod.agent.post(`/api/v1/admin/reports/${id}/assign`).send({ assignee: 'me' })).body.status).toBe('UNDER_REVIEW');
    expect((await mod.agent.get('/api/v1/admin/reports?assigned=me')).body.items.map((r: { id: string }) => r.id)).toEqual([id]);
    await mod.agent.post(`/api/v1/admin/reports/${id}/notes`).send({ body: 'Link goes to a known scam site.' });

    const removed = await mod.agent.post(`/api/v1/admin/content/post/${postId}/remove`).send({ reason: 'Spam / scam link', reportId: id });
    expect(removed.body).toEqual({ removed: true, restorable: true });
    expect((await request(app).get(`/api/v1/posts/${postId}`)).status).toBe(404);
    expect((await request(app).get('/api/v1/feed')).body.items).toHaveLength(0);

    const resolved = await mod.agent.post(`/api/v1/admin/reports/${id}/resolve`).send({ resolution: 'Removed the scam post' });
    expect(resolved.body).toEqual({ status: 'RESOLVED', closed: 2 });
    expect(await prisma.report.count({ where: { status: 'RESOLVED' } })).toBe(2);

    const detail = await mod.agent.get(`/api/v1/admin/reports/${id}`);
    expect(detail.body.notes.map((n: { body: string }) => n.body)).toEqual(['Link goes to a known scam site.']);
    expect(detail.body.target.removed).toBe(true);
    expect(detail.body.history.map((h: { action: string }) => h.action)).toEqual(['report.assign', 'report.note', 'report.resolve']);

    // Closed reports can't be reopened or re-decided.
    expect((await mod.agent.post(`/api/v1/admin/reports/${id}/dismiss`).send({ resolution: 'Changed my mind' })).body.error.code).toBe(
      'REPORT_CLOSED',
    );
  });

  it('escalated reports can only be decided by an administrator', async () => {
    const mod = await makeStaff(app, 'MODERATOR');
    const admin = await makeStaff(app, 'ADMIN');
    const { reports } = await reportedPost();
    const id = reports[0]!.id;
    await mod.agent.post(`/api/v1/admin/reports/${id}/escalate`).send({ reason: 'Possible legal issue' });
    expect((await mod.agent.post(`/api/v1/admin/reports/${id}/resolve`).send({ resolution: 'Handled by mod' })).body.error.code).toBe(
      'ESCALATED',
    );
    expect((await mod.agent.get(`/api/v1/admin/reports/${id}`)).body.canDecide).toBe(false);
    expect((await admin.agent.post(`/api/v1/admin/reports/${id}/dismiss`).send({ resolution: 'No violation found' })).body.status).toBe(
      'DISMISSED',
    );
  });

  it('reports are never visible to the reporter or the reported user through admin endpoints', async () => {
    const { author, reporters } = await reportedPost();
    expect((await author.agent.get('/api/v1/admin/reports')).status).toBe(403);
    expect((await reporters[0]!.agent.get('/api/v1/admin/reports')).status).toBe(403);
  });
});

describe('content moderation', () => {
  it('removal needs a reason, hides content everywhere, keeps ownership, and can be restored', async () => {
    const mod = await makeStaff(app, 'MODERATOR');
    const owner = await signUp(app);
    const item = await owner.agent
      .post('/api/v1/portfolio')
      .send({ type: 'PROJECT', title: 'Offensive work', description: 'd', publish: true, shareToFeed: true });

    expect((await mod.agent.post(`/api/v1/admin/content/portfolio-item/${item.body.id}/remove`).send({})).status).toBe(400);
    expect(
      (await mod.agent.post(`/api/v1/admin/content/portfolio-item/${item.body.id}/remove`).send({ reason: 'Hate speech in title' })).status,
    ).toBe(200);

    expect((await request(app).get(`/api/v1/portfolio/${item.body.id}`)).status).toBe(404);
    expect((await request(app).get('/api/v1/discover/work')).body.items).toHaveLength(0);
    expect((await request(app).get('/api/v1/feed')).body.items).toHaveLength(0); // its showcase post too
    // The owner still sees it, with the reason.
    const own = await owner.agent.get(`/api/v1/portfolio/${item.body.id}`);
    expect(own.body.moderation).toMatchObject({ reason: 'Hate speech in title' });
    expect(await prisma.portfolioItem.count({ where: { id: item.body.id, ownerId: owner.userId } })).toBe(1);

    const removedList = await mod.agent.get('/api/v1/admin/content?type=portfolio-item&state=removed');
    expect(removedList.body.items.map((i: { id: string }) => i.id)).toEqual([item.body.id]);

    expect(
      (await mod.agent.post(`/api/v1/admin/content/portfolio-item/${item.body.id}/restore`).send({ reason: 'Reviewed on appeal' })).status,
    ).toBe(200);
    expect((await request(app).get(`/api/v1/portfolio/${item.body.id}`)).status).toBe(200);
  });

  it('removed comments disappear; profile images can be removed (permanently)', async () => {
    const mod = await makeStaff(app, 'MODERATOR');
    const a = await signUp(app);
    const b = await signUp(app);
    const post = await a.agent.post('/api/v1/posts').send({ body: 'post' });
    const c = await b.agent.post(`/api/v1/posts/${post.body.id}/comments`).send({ body: 'abusive comment' });
    await mod.agent.post(`/api/v1/admin/content/comment/${c.body.id}/remove`).send({ reason: 'Harassment' });
    expect((await request(app).get(`/api/v1/posts/${post.body.id}/comments`)).body.items).toHaveLength(0);
    expect((await request(app).get(`/api/v1/posts/${post.body.id}`)).body.commentCount).toBe(0); // removed comments aren't counted

    const avatar = await uploadMedia(b.agent, { purpose: 'AVATAR' });
    await b.agent.put('/api/v1/me/profile/avatar').send({ mediaId: avatar });
    expect(
      (await mod.agent.post(`/api/v1/admin/content/profile-avatar/${b.userId}/remove`).send({ reason: 'Explicit image' })).body.restorable,
    ).toBe(false);
    expect((await request(app).get(`/api/v1/profiles/${b.input.username}`)).body.image).toBeNull();
    expect(
      (await mod.agent.post(`/api/v1/admin/content/profile-avatar/${b.userId}/restore`).send({ reason: 'Try restore' })).body.error.code,
    ).toBe('NOT_RESTORABLE');
  });

  it("moderators can't moderate their own content or staff content", async () => {
    const mod = await makeStaff(app, 'MODERATOR');
    const admin = await makeStaff(app, 'ADMIN');
    const own = await mod.agent.post('/api/v1/posts').send({ body: 'mod post' });
    const adminPost = await admin.agent.post('/api/v1/posts').send({ body: 'admin post' });
    expect(
      (await mod.agent.post(`/api/v1/admin/content/post/${own.body.id}/remove`).send({ reason: 'Testing rules' })).body.error.code,
    ).toBe('CANNOT_ACT_ON_SELF');
    expect(
      (await mod.agent.post(`/api/v1/admin/content/post/${adminPost.body.id}/remove`).send({ reason: 'Testing rules' })).body.error.code,
    ).toBe('FORBIDDEN_TARGET');
  });
});

describe('audit log', () => {
  it('records actor, action, target, reason and before/after for every administrative action', async () => {
    const admin = await makeStaff(app, 'ADMIN');
    const t = await signUp(app);
    await admin.agent.post(`/api/v1/admin/users/${t.userId}/status`).send({ status: 'RESTRICTED', reason: 'Spam behaviour' });
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { targetId: t.userId } });
    expect(entry).toMatchObject({
      actorId: admin.userId,
      actorRole: 'ADMIN',
      action: 'user.status.restricted',
      targetType: 'USER',
      reason: 'Spam behaviour',
      before: { status: 'ACTIVE', statusReason: null, statusUntil: null },
      after: expect.objectContaining({ status: 'RESTRICTED', statusReason: 'Spam behaviour' }),
    });
    expect(entry.createdAt).toBeInstanceOf(Date);

    const list = await admin.agent.get(`/api/v1/admin/audit?targetId=${t.userId}`);
    expect(list.body.items[0]).toMatchObject({ action: 'user.status.restricted', actor: { username: admin.input.username } });
  });

  it('is append-only at the database level: UPDATE, DELETE and TRUNCATE are refused', async () => {
    const admin = await makeStaff(app, 'ADMIN');
    const t = await signUp(app);
    await admin.agent.post(`/api/v1/admin/users/${t.userId}/status`).send({ status: 'RESTRICTED', reason: 'Spam behaviour' });
    const entry = await prisma.auditLog.findFirstOrThrow();

    await expect(prisma.auditLog.update({ where: { id: entry.id }, data: { reason: 'tampered' } })).rejects.toThrow(/append-only/);
    await expect(prisma.auditLog.delete({ where: { id: entry.id } })).rejects.toThrow(/append-only/);
    await expect(prisma.auditLog.deleteMany()).rejects.toThrow(/append-only/);
    await expect(prisma.$executeRawUnsafe(`UPDATE audit_log SET reason = 'x'`)).rejects.toThrow(/append-only/);
    await expect(prisma.$executeRawUnsafe('TRUNCATE TABLE audit_log')).rejects.toThrow(/append-only/);
    expect((await prisma.auditLog.findUniqueOrThrow({ where: { id: entry.id } })).reason).toBe('Spam behaviour');
  });

  it('a failed action writes no audit entry (they commit together)', async () => {
    const mod = await makeStaff(app, 'MODERATOR');
    const t = await signUp(app);
    await mod.agent.post(`/api/v1/admin/users/${t.userId}/status`).send({ status: 'BANNED', reason: 'Not allowed for mods' });
    expect(await prisma.auditLog.count()).toBe(0);
  });
});

describe('overview uses real data only', () => {
  it('reports exact counts and marks unbuilt pillars as pending (not zero)', async () => {
    const admin = await makeStaff(app, 'ADMIN');
    await reportedPost(1); // +2 users, 1 post, 1 report
    const res = await admin.agent.get('/api/v1/admin/overview');
    expect(res.body.users.total).toBe(3);
    expect(res.body.users.new7d).toBe(3);
    expect(res.body.content.posts).toBe(1);
    expect(res.body.moderation).toMatchObject({ openReports: 1, unassigned: 1, escalated: 0 });
    expect(res.body.staff).toMatchObject({ admins: 1, moderators: 0, withoutTwoFactor: 0 });
    expect(res.body.users.weeklySignups).toHaveLength(12);
    expect(res.body.users.weeklySignups.at(-1).signups).toBe(3);
    expect(res.body.pending).toEqual(expect.arrayContaining(['communities', 'competitions', 'opportunities', 'payments', 'announcements']));
    expect(res.body).not.toHaveProperty('revenue');
  });
});

describe('initial administrator (CLI function)', () => {
  it('grants ADMIN to an existing verified account once, is idempotent, refuses a second, and audits', async () => {
    const a = await signUp(app);
    const b = await signUp(app);
    await expect(grantInitialAdmin('nobody@example.test')).rejects.toMatchObject({ code: 'NO_ACCOUNT' });
    await expect(grantInitialAdmin(a.input.email)).rejects.toMatchObject({ code: 'EMAIL_NOT_VERIFIED' });

    await prisma.user.updateMany({ data: { emailVerified: true } });
    expect(await grantInitialAdmin(` ${a.input.email.toUpperCase()} `)).toEqual({ changed: true, userId: a.userId });
    expect(await grantInitialAdmin(a.input.email)).toEqual({ changed: false, userId: a.userId }); // re-run: no change
    await expect(grantInitialAdmin(b.input.email)).rejects.toMatchObject({ code: 'ADMIN_EXISTS' });
    await expect(grantInitialAdmin(b.input.email)).rejects.toBeInstanceOf(BootstrapError);

    expect(await prisma.user.count({ where: { platformRole: 'ADMIN' } })).toBe(1);
    const audit = await prisma.auditLog.findMany({ where: { action: 'user.role.grant_initial' } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorId: null, actorLabel: 'cli:admin:grant-initial', targetId: a.userId });
  });

  it('two simultaneous runs for different accounts create exactly one administrator', async () => {
    const a = await signUp(app);
    const b = await signUp(app);
    await prisma.user.updateMany({ data: { emailVerified: true } });
    const results = await Promise.allSettled([grantInitialAdmin(a.input.email), grantInitialAdmin(b.input.email)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await prisma.user.count({ where: { platformRole: 'ADMIN' } })).toBe(1);
  });
});
