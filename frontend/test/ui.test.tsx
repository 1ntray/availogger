import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Avatar, Chip, nameCode } from '../src/app/ui';

describe('shared UI', () => {
  it('derives the three-letter name code from the first name and the last surname', () => {
    expect(nameCode({ firstName: 'Ole Markus', lastName: 'Rockstad' })).toBe('ORO');
    expect(nameCode({ firstName: 'Mike', lastName: 'Myers' })).toBe('MMY');
    expect(nameCode({ firstName: 'Chris', lastName: 'Hems Dal' })).toBe('CDA');
    expect(nameCode({ firstName: 'åse', lastName: 'Øvre ås' })).toBe('ÅÅS');
    expect(nameCode({ firstName: 'Anna', lastName: null })).toBe('ANN');
    expect(nameCode({ firstName: null, lastName: 'Berg' })).toBe('BER');
    expect(nameCode({ firstName: ' ', lastName: '', email: 'erik@example.test' })).toBe('E');
    expect(nameCode(null)).toBe('?');
    expect(renderToStaticMarkup(<Avatar user={{ firstName: 'Ole', lastName: 'Rockstad' }} size={34} />)).toContain('>ORO</span>');
  });
  it('renders chips in each tone', () => {
    for (const tone of ['soft', 'warning', 'neutral'] as const)
      expect(renderToStaticMarkup(<Chip tone={tone}>Label</Chip>)).toBe(`<span class="chip chip--${tone}">Label</span>`);
    expect(renderToStaticMarkup(<Chip>Label</Chip>)).toContain('chip--neutral');
  });
});
