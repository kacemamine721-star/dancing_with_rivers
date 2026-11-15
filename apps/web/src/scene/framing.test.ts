import { describe, expect, it } from 'vitest';
import { framing } from '@/scene/framing';

describe('framing', () => {
  it('keeps the subject between a left card and a right widget column', () => {
    const card = { left: 32, top: 300, right: 492, bottom: 868 };
    const widget = { left: 828, top: 260, right: 1408, bottom: 868 };
    const f = framing(1440, 900, [card, widget]);
    // the subject is not under the widget column, and we zoom out to fit
    expect(f.x < widget.left || f.y < widget.top).toBe(true);
    expect(f.x > card.right || f.y < card.top).toBe(true);
    expect(f.zoom).toBeGreaterThan(1);
  });
  it('no occluder: centre, no zoom', () => {
    const f = framing(1440, 900, []);
    expect(f.x).toBe(720);
    expect(f.zoom).toBe(1);
  });
});
