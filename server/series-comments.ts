import type { Application } from 'express';
import { z } from 'zod';
import {
  isSeriesCommentBodyValid,
  SERIES_COMMENT_MAX_LENGTH,
  type SeriesComment,
  type SeriesCommentLike,
  type SeriesCommentsPage,
} from '../shared/series-comments-schema.js';
import { requireAuth, rateLimit } from './auth.js';
import { all, one, run, transaction } from './db.js';
import { assert } from './errors.js';
import { publicSeriesAllowedSql } from './moderation.js';

const route = '/api/series/:id/comments';
const positiveInteger = z.string().regex(/^[1-9]\d{0,15}$/).transform(Number).pipe(z.int().positive());
const pageQuery = z.object({
  before: positiveInteger.optional(),
  limit: positiveInteger.pipe(z.int().max(50)).optional(),
});
const commentBody = z.strictObject({
  body: z.string().trim().refine(isSeriesCommentBodyValid, `Write a comment of 1–${SERIES_COMMENT_MAX_LENGTH} characters.`),
});
const likeBody = z.strictObject({ liked: z.boolean() });

const publicSeries = `s.status='published' AND ${publicSeriesAllowedSql('s')}
  AND EXISTS (SELECT 1 FROM episodes e WHERE e.series_id=s.id)`;

type CommentRow = Omit<SeriesComment, 'isOwn' | 'likedByViewer'> & {
  isOwn: number | null;
  likedByViewer: number;
};

function assertPublicSeries(seriesId: string) {
  assert(one(`SELECT 1 FROM series s WHERE s.id=? AND ${publicSeries}`, seriesId), 404, 'NOT_FOUND', 'Series not found.');
}

function requireComment(seriesId: string, commentId: number) {
  assertPublicSeries(seriesId);
  const row = one<{ author_id: string }>('SELECT author_id FROM series_comments WHERE series_id=? AND id=?', seriesId, commentId);
  assert(row, 404, 'NOT_FOUND', 'Comment not found.');
  return row;
}

function listComments(seriesId: string, viewerId: string | null, limit: number, before?: number): SeriesCommentsPage {
  // The left join distinguishes an empty page from an unavailable series in the same SQLite snapshot.
  const bound = before === undefined ? '' : 'AND c.id < ?';
  const rows = all<CommentRow | { id: null }>(`
    SELECT c.id,u.name AS authorName,c.body,c.created_at_ms AS createdAt,
      (SELECT COUNT(*) FROM series_comment_likes l WHERE l.comment_id=c.id) AS likeCount,
      EXISTS (SELECT 1 FROM series_comment_likes l WHERE l.comment_id=c.id AND l.user_id=?) AS likedByViewer,
      c.author_id=? AS isOwn
    FROM series s
    LEFT JOIN series_comments c ON c.series_id=s.id ${bound}
    LEFT JOIN users u ON u.id=c.author_id
    WHERE s.id=? AND ${publicSeries}
    ORDER BY c.id DESC LIMIT ?`, viewerId, viewerId, ...(before === undefined ? [] : [before]), seriesId, limit + 1);
  assert(rows.length, 404, 'NOT_FOUND', 'Series not found.');
  const comments = rows.slice(0, limit).flatMap(row => row.id === null ? [] : [{
    ...row,
    isOwn: Boolean(row.isOwn),
    likedByViewer: Boolean(row.likedByViewer),
  }]);
  return { comments, nextBefore: rows.length > limit ? comments[limit - 1].id : null };
}

export function registerSeriesComments(app: Application) {
  app.get(route, (req, res) => {
    const { before, limit = 20 } = pageQuery.parse(req.query);
    res.json(listComments(String(req.params.id), req.user?.id ?? null, limit, before));
  });

  app.post(route, requireAuth, rateLimit('series-comment-post', 12, 60_000), (req, res) => {
    const seriesId = String(req.params.id);
    const author = req.user!;
    const { body } = commentBody.parse(req.body);
    const comment: SeriesComment = transaction(() => {
      assertPublicSeries(seriesId);
      const createdAt = Date.now();
      const { id } = one<{ id: number }>(`INSERT INTO series_comments (series_id,author_id,body,created_at_ms)
        VALUES (?,?,?,?) RETURNING id`, seriesId, author.id, body, createdAt)!;
      return { id, authorName: author.name, body, createdAt, likeCount: 0, isOwn: true, likedByViewer: false };
    });
    res.status(201).json({ comment });
  });

  app.put(`${route}/:commentId/like`, requireAuth, rateLimit('series-comment-like', 120, 60_000), (req, res) => {
    const seriesId = String(req.params.id);
    const commentId = positiveInteger.parse(req.params.commentId);
    const userId = req.user!.id;
    const { liked } = likeBody.parse(req.body);
    const result: SeriesCommentLike = transaction(() => {
      const comment = requireComment(seriesId, commentId);
      assert(comment.author_id !== userId, 400, 'OWN_COMMENT_LIKE', 'You can like comments from other viewers.');
      if (liked) {
        run('INSERT INTO series_comment_likes (comment_id,user_id) VALUES (?,?) ON CONFLICT(comment_id,user_id) DO NOTHING', commentId, userId);
      } else {
        run('DELETE FROM series_comment_likes WHERE comment_id=? AND user_id=?', commentId, userId);
      }
      const { likeCount } = one<{ likeCount: number }>('SELECT COUNT(*) AS likeCount FROM series_comment_likes WHERE comment_id=?', commentId)!;
      return { likeCount, likedByViewer: liked };
    });
    res.json(result);
  });

  app.delete(`${route}/:commentId`, requireAuth, rateLimit('series-comment-delete', 30, 60_000), (req, res) => {
    const seriesId = String(req.params.id);
    const commentId = positiveInteger.parse(req.params.commentId);
    transaction(() => {
      const comment = requireComment(seriesId, commentId);
      assert(comment.author_id === req.user!.id, 403, 'FORBIDDEN', 'You can only delete your own comments.');
      run('DELETE FROM series_comments WHERE id=?', commentId);
    });
    res.status(204).end();
  });
}
