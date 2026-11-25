export const SERIES_COMMENT_MAX_LENGTH = 500;

export interface SeriesComment {
  id: number;
  authorName: string;
  body: string;
  createdAt: number;
  likeCount: number;
  likedByViewer: boolean;
  isOwn: boolean;
}

export interface SeriesCommentsPage {
  comments: SeriesComment[];
  nextBefore: number | null;
}

export type SeriesCommentLike = Pick<SeriesComment, 'likeCount' | 'likedByViewer'>;

export function isSeriesCommentBodyValid(body: string): boolean {
  const text = body.trim();
  return /[^\s\p{Default_Ignorable_Code_Point}]/u.test(text)
    && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\ud800-\udfff]/u.test(text)
    && Array.from(text).length <= SERIES_COMMENT_MAX_LENGTH;
}

export const SERIES_COMMENTS_SCHEMA = `
CREATE TABLE IF NOT EXISTS series_comments (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 series_id TEXT NOT NULL REFERENCES series(id) ON DELETE CASCADE,
 author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND ${SERIES_COMMENT_MAX_LENGTH}),
 created_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS series_comments_series_id ON series_comments(series_id,id DESC);
CREATE TABLE IF NOT EXISTS series_comment_likes (
 comment_id INTEGER NOT NULL REFERENCES series_comments(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 PRIMARY KEY(comment_id,user_id)
);
`;
