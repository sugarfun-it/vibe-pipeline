import { describe, expect, it } from 'bun:test';
import { formatAgo, formatDateTime, formatLastChecked, formatNum } from './format';

const fixedTime = new Date('2026-05-25T10:30:00').getTime();

function withNow<T>(now: number, fn: () => T): T {
  const origNow = Date.now;
  Date.now = () => now;
  try {
    return fn();
  } finally {
    Date.now = origNow;
  }
}

describe('formatDateTime', () => {
  it('formats full date time by default with zero padding', () => {
    expect(formatDateTime(fixedTime)).toBe('2026-05-25 10:30:00');
  });

  it('formats full date time with explicit full variant', () => {
    const ms = new Date('2026-01-02T03:04:05').getTime();
    expect(formatDateTime(ms, 'full')).toBe('2026-01-02 03:04:05');
  });

  it('formats short date time without year or seconds', () => {
    const ms = new Date('2026-01-02T03:04:05').getTime();
    expect(formatDateTime(ms, 'short')).toBe('01-02 03:04');
  });

  it('formats compact date time without zero-padded month or day', () => {
    const ms = new Date('2026-01-02T03:04:05').getTime();
    expect(formatDateTime(ms, 'compact')).toBe('1/2 03:04');
  });

  it('keeps compact hour and minute zero-padded', () => {
    const ms = new Date('2026-11-09T07:08:09').getTime();
    expect(formatDateTime(ms, 'compact')).toBe('11/9 07:08');
  });

  it('formats full-tz with date, minute precision, and timezone offset', () => {
    expect(formatDateTime(fixedTime, 'full-tz')).toMatch(
      /^2026-05-25 10:30 \(UTC[+-]\d{2}:\d{2}\)$/,
    );
  });
});

describe('formatAgo', () => {
  it('returns null for null, undefined, and 0', () => {
    withNow(fixedTime, () => {
      expect(formatAgo(null)).toBeNull();
      expect(formatAgo(undefined)).toBeNull();
      expect(formatAgo(0)).toBeNull();
    });
  });

  it('formats zh just now below 60 seconds', () => {
    withNow(fixedTime, () => {
      expect(formatAgo(fixedTime - 59_000)).toBe('剛剛');
    });
  });

  it('formats zh minutes from 60 seconds to below 1 hour', () => {
    withNow(fixedTime, () => {
      expect(formatAgo(fixedTime - 60_000)).toBe('1分鐘前');
      expect(formatAgo(fixedTime - 59 * 60_000)).toBe('59分鐘前');
    });
  });

  it('formats zh hours from 1 hour to below 1 day', () => {
    withNow(fixedTime, () => {
      expect(formatAgo(fixedTime - 60 * 60_000)).toBe('1小時前');
      expect(formatAgo(fixedTime - 23 * 60 * 60_000)).toBe('23小時前');
    });
  });

  it('formats zh days at and above 1 day', () => {
    withNow(fixedTime, () => {
      expect(formatAgo(fixedTime - 24 * 60 * 60_000)).toBe('1天前');
      expect(formatAgo(fixedTime - 3 * 24 * 60 * 60_000)).toBe('3天前');
    });
  });

  it('formats en just now below 60 seconds', () => {
    withNow(fixedTime, () => {
      expect(formatAgo(fixedTime - 59_000, 'en')).toBe('just now');
    });
  });

  it('formats en minutes, hours, and days with spaces', () => {
    withNow(fixedTime, () => {
      expect(formatAgo(fixedTime - 60_000, 'en')).toBe('1 min');
      expect(formatAgo(fixedTime - 2 * 60 * 60_000, 'en')).toBe('2 h');
      expect(formatAgo(fixedTime - 2 * 24 * 60 * 60_000, 'en')).toBe('2 d');
    });
  });
});

describe('formatLastChecked', () => {
  it('returns dash for null', () => {
    withNow(fixedTime, () => {
      expect(formatLastChecked(null)).toBe('—');
    });
  });

  it('formats below 1 minute as just now', () => {
    withNow(fixedTime, () => {
      expect(formatLastChecked(fixedTime - 59_000)).toBe('剛剛');
    });
  });

  it('formats minutes with spaces from 1 minute to below 1 hour', () => {
    withNow(fixedTime, () => {
      expect(formatLastChecked(fixedTime - 60_000)).toBe('1 分鐘前');
      expect(formatLastChecked(fixedTime - 59 * 60_000)).toBe('59 分鐘前');
    });
  });

  it('formats 1 hour and older as HH:MM', () => {
    withNow(fixedTime, () => {
      expect(formatLastChecked(fixedTime - 60 * 60_000)).toBe('09:30');
      expect(formatLastChecked(new Date('2026-05-25T01:02:03').getTime())).toBe('01:02');
    });
  });
});

describe('formatNum', () => {
  it('formats numbers below 1000 without suffix', () => {
    expect(formatNum(0)).toBe('0');
    expect(formatNum(999)).toBe('999');
  });

  it('formats thousands with one decimal', () => {
    expect(formatNum(1_000)).toBe('1.0k');
    expect(formatNum(12_345)).toBe('12.3k');
    expect(formatNum(999_999)).toBe('1000.0k');
  });

  it('formats millions with two decimals', () => {
    expect(formatNum(1_000_000)).toBe('1.00M');
    expect(formatNum(1_234_567)).toBe('1.23M');
  });
});
