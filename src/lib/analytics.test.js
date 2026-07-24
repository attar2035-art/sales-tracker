import { classifyByCumulativeSales, ABC_BOUNDARIES, ABCD_BOUNDARIES } from './analytics';

const cust = (code, net_sales) => ({ customer_code: code, net_sales });

describe('classifyByCumulativeSales (canonical ABC — BUG-022)', () => {
  it('sorts by value descending and assigns cumulative-share grades (4-tier)', () => {
    // Total = 100. Cumulative: 60 (A), 85 (B), 95 (B), 99 (C), 100 (D)
    const rows = [
      cust('c1', 60), cust('c2', 25), cust('c3', 10), cust('c4', 4), cust('c5', 1),
    ];
    const graded = classifyByCumulativeSales(rows, { valueKey: 'net_sales', boundaries: ABCD_BOUNDARIES });
    expect(graded.map(g => g.grade)).toEqual(['A', 'B', 'B', 'C', 'D']);
    expect(graded[0].customer_code).toBe('c1'); // sorted desc
  });

  it('supports a different value key and 3-tier boundaries', () => {
    const rows = [
      { id: 1, yearly_sales: 80 }, { id: 2, yearly_sales: 16 }, { id: 3, yearly_sales: 4 },
    ];
    const graded = classifyByCumulativeSales(rows, { valueKey: 'yearly_sales', boundaries: ABC_BOUNDARIES });
    // Cumulative: 80 (A), 96 (C — >95), 100 (C)
    expect(graded.map(g => g.grade)).toEqual(['A', 'C', 'C']);
  });

  it('grades everyone lowest when total value is zero', () => {
    const graded = classifyByCumulativeSales([cust('a', 0), cust('b', 0)], { boundaries: ABCD_BOUNDARIES });
    expect(graded.every(g => g.grade === 'D')).toBe(true);
  });

  it('is consistent: the same customer set grades identically regardless of caller', () => {
    const rows = [cust('a', 50), cust('b', 30), cust('c', 20)];
    const first = classifyByCumulativeSales(rows, { valueKey: 'net_sales', boundaries: ABCD_BOUNDARIES });
    const second = classifyByCumulativeSales([...rows].reverse(), { valueKey: 'net_sales', boundaries: ABCD_BOUNDARIES });
    const key = g => `${g.customer_code}:${g.grade}`;
    expect(new Set(first.map(key))).toEqual(new Set(second.map(key)));
  });

  it('handles empty/non-array input safely', () => {
    expect(classifyByCumulativeSales(null)).toEqual([]);
    expect(classifyByCumulativeSales([])).toEqual([]);
  });
});
