import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const src = readFileSync(new URL('./index.html', import.meta.url), 'utf8');

function grab(name) {
  const fn = src.indexOf(`function ${name}`);
  const cn = src.indexOf(`const ${name} =`);
  const start = fn >= 0 ? fn : cn;
  if (start < 0) throw new Error(`缺少 ${name}`);
  let i = src.indexOf('{', start);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`函数没收尾 ${name}`);
}

const TODAY = new Date().toISOString().slice(0, 10);
const code = [
  `const TODAY = ${JSON.stringify(TODAY)};`,
  'const iso = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");',
  'const addDays = (s, n) => { const d = new Date(s + "T00:00:00"); d.setDate(d.getDate() + n); return iso(d); };',
  grab('sgOf'),
  grab('fwdAdj'),
  grab('poolTier'),
  grab('gambPrice'),
  grab('distressAct'),
  grab('yieldLadder'),
  grab('dayAmp'),
  grab('gridOn'),
].join('\n');
const fns = new Function(`${code}\nreturn { sgOf, fwdAdj, poolTier, gambPrice, distressAct, yieldLadder, dayAmp, gridOn };`)();

test('送转股数按每 10 股折成比例', () => {
  assert.equal(fns.sgOf('10派5.00元(含税)送2股转增3股'), 0.5);
  assert.equal(fns.sgOf('10派3.00元'), 0);
});

test('前复权抹平送转缺口，最后一根仍是现价', () => {
  const bars = [['2024-01-05', 10], ['2024-01-12', 10], ['2024-01-19', 5]];
  const adj = fns.fwdAdj(bars, [{ ex: '2024-01-15', ps: 0, sg: 1 }]);
  assert.deepEqual(adj.map(v => +v.toFixed(4)), [5, 5, 5]);
});

test('前复权抹平现金除息缺口', () => {
  const bars = [['2024-01-05', 10], ['2024-01-12', 9.5]];
  const adj = fns.fwdAdj(bars, [{ ex: '2024-01-08', ps: 0.5, sg: 0 }]);
  assert.equal(+adj[0].toFixed(4), 9.5);
  assert.equal(+adj[1].toFixed(4), 9.5);
});

test('没有除权时前复权等于原价', () => {
  const bars = [['2024-01-05', 8], ['2024-01-12', 9]];
  assert.deepEqual(fns.fwdAdj(bars, []), [8, 9]);
});

test('数据不足是待验证，不是一般观察；已知风险仍优先', () => {
  assert.equal(fns.poolTier({ hard: true, unverified: true, t: 'stable', Q: 90, C: 0.8, P: 0.8 }), 'r');
  assert.equal(fns.poolTier({ hard: false, unverified: true, t: 'stable', Q: 90, C: 0.8, P: 0.8 }), 'd');
  assert.equal(fns.poolTier({ hard: false, unverified: false, t: 'stable', Q: null, C: 0.8, P: 0.8 }), 'd');
  assert.equal(fns.poolTier({ hard: false, unverified: false, t: 'stable', Q: 80, C: null, P: 0.8 }), 'd');
  assert.equal(fns.poolTier({ hard: false, unverified: false, t: 'cyc', Q: 80, C: 0.8, P: 0.8 }), 'y');
  assert.equal(fns.poolTier({ hard: false, unverified: false, t: 'stable', Q: 60, C: 0.8, P: 0.5 }), 'y');
  assert.equal(fns.poolTier({ hard: false, unverified: false, t: 'stable', Q: 80, C: 0.5, P: 0.5 }), 'y');
  assert.equal(fns.poolTier({ hard: false, unverified: false, t: 'stable', Q: 80, C: 0.7, P: 0.5 }), 'g');
  assert.equal(fns.poolTier({ hard: false, unverified: false, t: 'oth', Q: 80, C: 0.7, P: 0.5 }), 'g');
  assert.equal(fns.poolTier({ hard: false, unverified: false, t: 'oth', Q: 80, C: 0.7, P: 0.1 }), 'y');
  assert.equal(fns.poolTier({ hard: false, live: true, deadGap: false, unverified: false, t: 'fin', Q: 70, C: 0.8, P: 0.5 }), 'k');
  assert.equal(fns.poolTier({ hard: true, live: true, t: 'fin', Q: 90, C: 0.8, P: 0.9 }), 'r');
  assert.equal(fns.poolTier({ hard: false, live: true, deadGap: true, unverified: true, t: 'fin', Q: 90, C: 0.8, P: 0.9 }), 'd');
});

test('困境股博弈价是合理价再往下 1.5 个月度波动', () => {
  assert.equal(fns.gambPrice(10, 0.1), 8.5);
  assert.equal(fns.gambPrice(10, null), null);
  assert.equal(fns.gambPrice(null, 0.1), null);
});

test('困境股不到博弈价不买，跌破就可以轻仓', () => {
  assert.equal(fns.distressAct(8.82, 7.5), 'above');
  assert.equal(fns.distressAct(7.4, 7.5), 'bet');
  assert.equal(fns.distressAct(7.5, 7.5), 'bet');
  assert.equal(fns.distressAct(7.4, null), 'na');
});

test('阶梯价按当前股息率向下取 0.5 个百分点', () => {
  const bank = 8.8 * 0.0591;
  const sh = fns.yieldLadder(bank, 0.0591);
  assert.ok(Math.abs(sh.r1 - 0.055) < 1e-9);
  assert.ok(Math.abs(sh.r2 - 0.06) < 1e-9);
  assert.ok(sh.p1 > 8.8 && sh.p2 < 8.8);
  const gree = 37.13 * 0.0808;
  const gl = fns.yieldLadder(gree, 0.0808);
  assert.ok(Math.abs(gl.p1 - 37.5) < 0.02);
  assert.ok(Math.abs(gl.p2 - 35.29) < 0.02);
  const haier = fns.yieldLadder(19.69 * 0.0453, 0.0453);
  assert.ok(Math.abs(haier.r1 - 0.045) < 1e-9);
  assert.ok(Math.abs(haier.r2 - 0.05) < 1e-9);
  assert.equal(fns.yieldLadder(0, 0.05), null);
  assert.equal(fns.yieldLadder(1, 0), null);
});

test('日振幅是每天高低差的平均，不是 20 日最高减最低', () => {
  const bars = Array.from({ length: 20 }, (_, i) => ['d' + i, 10.19, 10, 10]);
  assert.ok(Math.abs(fns.dayAmp(bars) - 0.019) < 1e-9);
  assert.equal(fns.dayAmp(bars.slice(0, 9)), null);
  const wide = [...bars];
  wide[0] = ['d0', 12, 8, 10];
  assert.ok(fns.dayAmp(wide) < 0.05);
  assert.ok(fns.dayAmp(wide) > 0.019);
});

test('网格只在重点关注到买入价或困境观察到博弈线时出现', () => {
  assert.equal(fns.gridOn({ cl: { c: 'g' }, q: { price: 10 }, b1: 10.5 }), true);
  assert.equal(fns.gridOn({ cl: { c: 'g' }, q: { price: 11 }, b1: 10.5 }), false);
  assert.equal(fns.gridOn({ cl: { c: 'y' }, q: { price: 9 }, b1: 10 }), false);
  assert.equal(fns.gridOn({ cl: { c: 'k' }, q: { price: 7.9 }, gamb: 8, b1: 9 }), true);
  assert.equal(fns.gridOn({ cl: { c: 'k' }, q: { price: 8.8 }, gamb: 7.98, b1: 8.2 }), false);
  assert.equal(fns.gridOn({ cl: { c: 'r' }, q: { price: 5 }, b1: 8, gamb: 7 }), false);
  assert.equal(fns.gridOn({ cl: { c: 'd' }, q: { price: 5 }, b1: 8 }), false);
});
