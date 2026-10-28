// 生成跨境 ETF 持仓快照 etf/holdings.js(季报更新后跑一次):node etf/snap.mjs [代码...]
// 浏览器直连东财持仓接口容易被限流,这份快照是兜底数据;写成 JS 是为了 file:// 双击打开也能加载
import { writeFileSync, readFileSync, existsSync } from 'node:fs';

const DEF = ['513850', '159577', '513870', '159696', '159660', '513390', '513110', '159509', '513500'];
const out = new URL('./holdings.js', import.meta.url);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const get = async (url, ref = 'https://fundf10.eastmoney.com/') => {
  for (let i = 0; i < 3; i++) {
    const r = await fetch(url, { headers: { Referer: ref, 'User-Agent': 'Mozilla/5.0' } });
    if (r.ok) return r.text();
    await sleep(1500);
  }
  throw new Error('HTTP 失败 ' + url);
};
const num = s => parseFloat(String(s).replace(/[^\d.\-]/g, '')) || 0;

async function snap(code) {
  const f = { code };
  const jj = await get(`https://fundf10.eastmoney.com/FundArchivesDatas.aspx?type=jjcc&code=${code}&topline=10`);
  const first = jj.split("<div class='boxitem")[1] || '';
  f.hd = (first.match(/截止至：<font class='px12'>([\d-]+)/) || [])[1] || '';
  f.hold = [...first.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map(([, tr]) => {
    const m = tr.match(/unify\/r\/\d+\.([A-Z0-9.\-]+)'\s*>([^<]+)<\/a><\/td><td[^>]*><a[^>]*>([^<]+)/);
    const w = tr.match(/>([\d.]+)%</);
    return m && w ? { s: m[1], n: m[3].trim(), w: +w[1] } : null;
  }).filter(Boolean);
  await sleep(500);
  const jb = await get(`https://fundf10.eastmoney.com/jbgk_${code}.html`);
  const cell = k => ((jb.match(new RegExp(k + '</th><td[^>]*>(?:<a[^>]*>)?([^<]*)')) || [])[1] || '').trim();
  f.name = cell('基金简称');
  f.co = cell('基金管理人');
  f.idx = cell('跟踪标的');
  f.fee = [num(cell('管理费率')), num(cell('托管费率'))];
  await sleep(500);
  const pz = await get(`https://fund.eastmoney.com/pingzhongdata/${code}.js`, 'https://fund.eastmoney.com/');
  const al = pz.match(/Data_assetAllocation = (\{.*?\});/);
  if (al) {
    const a = JSON.parse(al[1]), ser = n => (a.series.find(x => x.name === n)?.data || []).at(-1);
    f.gp = ser('股票占净比');
    f.cash = ser('现金占净比');
  }
  return f;
}

const codes = process.argv.slice(2).length ? process.argv.slice(2) : DEF;
const prev = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8').replace(/^window\.ETF_SNAP = |;\s*$/g, '')) : { funds: {} };
const funds = { ...prev.funds };
for (const c of codes) {
  try {
    funds[c] = await snap(c);
    console.log(c, funds[c].name, funds[c].hd, funds[c].hold.length + ' 只', '股票', funds[c].gp + '%', '费率', funds[c].fee.join('+'));
  } catch (e) { console.log(c, '失败', e.message); }
  await sleep(800);
}
writeFileSync(out, 'window.ETF_SNAP = ' + JSON.stringify({ t: new Date().toISOString().slice(0, 10), funds }) + ';\n');
