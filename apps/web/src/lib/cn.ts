import { createCn } from 'cn/config';

/**
 * The project's class merger. Our type scale (index.css --text-*) uses names the merger can't
 * know: without this, `cn('text-h2', 'text-text-1')` treats text-h2 as a colour and drops it.
 * Keep this list in sync with the --text-* tokens.
 */
export const TYPE_SCALE = ['display', 'h1', 'h2', 'h3', 'lead', 'body', 'small', 'caption', 'label'] as const;

export const cn = createCn({
  extend: { classGroups: { 'font-size': [{ text: [...TYPE_SCALE] }] } },
});
