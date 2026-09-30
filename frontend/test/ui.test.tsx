import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Avatar, Chip, initials } from '../src/app/ui';

describe('shared UI', () => {
  it('derives avatar initials from the name, then the email', () => {
    expect(initials({ firstName: 'Ole Markus', lastName: 'Rockstad' })).toBe('OR');
    expect(initials({ firstName: 'anna', lastName: null })).toBe('A');
    expect(initials({ firstName: ' ', lastName: '', email: 'erik@example.test' })).toBe('E');
    expect(initials(null)).toBe('?');
    expect(renderToStaticMarkup(<Avatar user={{ firstName: 'Ole', lastName: 'Rockstad' }} size={34} />)).toContain('>OR</span>');
  });
  it('renders chips in each tone', () => {
    for (const tone of ['soft', 'warning', 'neutral'] as const)
      expect(renderToStaticMarkup(<Chip tone={tone}>Label</Chip>)).toBe(`<span class="chip chip--${tone}">Label</span>`);
    expect(renderToStaticMarkup(<Chip>Label</Chip>)).toContain('chip--neutral');
  });
});
