// Trang Bước 1–2: chạy mô phỏng LFP và NMC, đưa qua lớp đo PZEM, vẽ công suất ổ cắm theo thời gian.
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { buildModelParams, unwrap } from '../params.js';
import { simulate } from '../simulate.js';
import { measure } from '../pzem.js';
import lfp from '../../params/lfp_16s_20ah.json';
import nmc from '../../params/nmc_13s_20ah.json';
import charger from '../../params/charger_good_300w.json';
import session from '../../params/session_default.json';
import pzemFile from '../../params/pzem004t_v3.json';

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const pz = unwrap(pzemFile);
const seed = session.params.seed.value;
const runs = [
  { key: 'LFP', label: 'LFP 16S', color: '--series-lfp', result: simulate(buildModelParams(lfp, charger, session)) },
  { key: 'NMC', label: 'NMC 13S', color: '--series-nmc', result: simulate(buildModelParams(nmc, charger, session)) },
];
for (const r of runs) r.meas = measure(r.result, pz, seed);
document.getElementById('seed').textContent = seed;

// Hai phiên có cùng chu kỳ lấy mẫu và cùng t = 0, nên trục x chung là chỉ số mẫu.
const T = pz.T_sample;
const n = Math.max(...runs.map((r) => r.meas.n));
const x = Float64Array.from({ length: n }, (_, k) => (k * T) / 3600);
const orNull = (v) => (Number.isNaN(v) ? null : v);
const ys = runs.map((r) => Array.from({ length: n }, (_, k) => (k < r.meas.n ? orNull(r.meas.columns.P_W[k]) : null)));

// Khoảng LFP đang sạc với z > 1 (giờ).
const lfpCols = runs[0].result.columns;
const zOver = [];
for (let k = 0; k < runs[0].result.n; k++) if (lfpCols.soc[k] > 1 && lfpCols.mode[k] !== 2) zOver.push(x[k]);
const zBand = zOver.length ? [zOver[0], zOver[zOver.length - 1]] : null;

const fmt = (v, d = 1, dMin = d) =>
  v == null ? '—' : v.toLocaleString('vi-VN', { minimumFractionDigits: dMin, maximumFractionDigits: d });

// Vạch dọc đánh dấu lúc vào CV và lúc cắt, kèm nhãn ngắn.
function markersPlugin(showBand, showLabels) {
  return {
    hooks: {
      drawClear: (u) => {
        if (!showBand || !zBand) return;
        const { ctx } = u;
        const x0 = u.valToPos(zBand[0], 'x', true);
        const x1 = u.valToPos(zBand[1], 'x', true);
        ctx.save();
        ctx.fillStyle = css('--band');
        ctx.fillRect(x0, u.bbox.top, Math.max(x1 - x0, 2), u.bbox.height);
        ctx.restore();
      },
      draw: (u) => {
        const { ctx } = u;
        ctx.save();
        ctx.font = `${12 * devicePixelRatio}px system-ui, sans-serif`;
        ctx.setLineDash([4 * devicePixelRatio, 4 * devicePixelRatio]);
        ctx.lineWidth = devicePixelRatio;
        runs.forEach((r, i) => {
          const e = r.result.events;
          for (const [t, name] of [[e.t_cv_s, 'vào CV'], [e.t_cut_s, 'cắt']]) {
            const xv = t / 3600;
            if (xv < u.scales.x.min || xv > u.scales.x.max) continue;
            const px = u.valToPos(xv, 'x', true);
            ctx.strokeStyle = css(r.color);
            ctx.beginPath();
            ctx.moveTo(px, u.bbox.top);
            ctx.lineTo(px, u.bbox.top + u.bbox.height);
            ctx.stroke();
            if (!showLabels) continue;
            ctx.fillStyle = css('--text-secondary');
            const ty = u.bbox.top + (14 + i * 30 + (name === 'cắt' ? 15 : 0)) * devicePixelRatio;
            const text = `${r.key} ${name}`;
            const w = ctx.measureText(text).width;
            const tx = px + 4 * devicePixelRatio + w > u.bbox.left + u.bbox.width ? px - 4 * devicePixelRatio - w : px + 4 * devicePixelRatio;
            ctx.fillText(text, tx, ty);
          }
        });
        ctx.restore();
      },
    },
  };
}

function makeChart(el, xRange, showBand) {
  const axis = { stroke: css('--text-secondary'), grid: { stroke: css('--grid'), width: 1 }, ticks: { stroke: css('--grid') } };
  const opts = {
    width: el.clientWidth,
    height: 340,
    scales: { x: { time: false, ...(xRange ? { auto: false, range: xRange } : {}) }, y: { range: [0, 360] } },
    axes: [
      { ...axis, label: 'Thời gian (giờ)', values: (u, v) => v.map((t) => fmt(t, 2, 0)) },
      { ...axis, label: 'P ổ cắm (W)', size: 60 },
    ],
    series: [
      { label: 'Giờ', value: (u, v) => (v == null ? '—' : fmt(v, 3) + ' h') },
      ...runs.map((r) => ({
        label: r.label,
        stroke: css(r.color),
        width: 2,
        value: (u, v) => (v == null ? '—' : fmt(v, 1) + ' W'),
      })),
    ],
    cursor: { drag: { x: true, y: false } },
    plugins: [markersPlugin(showBand, showBand)],
  };
  const chart = new uPlot(opts, [x, ...ys], el);
  new ResizeObserver(() => chart.setSize({ width: el.clientWidth, height: 340 })).observe(el);
  return chart;
}

makeChart(document.getElementById('chart-full'), null, false);
makeChart(document.getElementById('chart-tail'), [3.2, 3.9], true);

// Phóng to 3 phút quanh mẫu mất gói đầu tiên của LFP sau 30 phút: thật (đường) và PZEM (điểm).
{
  const lfpRun = runs[0];
  const valid = lfpRun.meas.columns.valid;
  let kLost = valid.findIndex((v, k) => v === 0 && k * T >= 1800);
  if (kLost < 0) kLost = Math.round(3600 / T);
  const k0 = Math.max(0, kLost - 90);
  const k1 = Math.min(lfpRun.meas.n, kLost + 90);
  const xs = [];
  const truth = [];
  const pzem = [];
  for (let k = k0; k < k1; k++) {
    xs.push((k * T) / 60);
    truth.push(lfpRun.result.columns.P_wall_W[Math.round((k * T) / lfpRun.result.meta.dt)]);
    pzem.push(orNull(lfpRun.meas.columns.P_W[k]));
  }
  const lost = [];
  for (let k = k0; k < k1; k++) if (valid[k] === 0) lost.push((k * T) / 60);
  const yMid = truth[Math.floor(truth.length / 2)];
  const el = document.getElementById('chart-noise');
  const axis = { stroke: css('--text-secondary'), grid: { stroke: css('--grid'), width: 1 }, ticks: { stroke: css('--grid') } };
  const chart = new uPlot(
    {
      width: el.clientWidth,
      height: 300,
      scales: { x: { time: false }, y: { range: [yMid - 4, yMid + 4] } },
      axes: [
        { ...axis, label: 'Thời gian (phút)', values: (u, v) => v.map((t) => fmt(t, 1, 0)) },
        { ...axis, label: 'P ổ cắm (W)', size: 60, values: (u, v) => v.map((w) => fmt(w, 1)) },
      ],
      series: [
        { label: 'Phút', value: (u, v) => (v == null ? '—' : fmt(v, 2) + ' ph') },
        { label: 'Giá trị thật', stroke: css('--text-secondary'), width: 1.5, dash: [6, 4], value: (u, v) => (v == null ? '—' : fmt(v, 2) + ' W') },
        {
          label: 'PZEM đọc (LFP)',
          stroke: css('--series-lfp'),
          fill: css('--series-lfp'),
          paths: () => null,
          points: { show: true, size: 6, width: 0 },
          value: (u, v, si, idx) => (idx == null ? '—' : v == null ? 'mất gói' : fmt(v, 1) + ' W'),
        },
      ],
      plugins: [
        {
          hooks: {
            draw: (u) => {
              const { ctx } = u;
              ctx.save();
              ctx.font = `${12 * devicePixelRatio}px system-ui, sans-serif`;
              ctx.fillStyle = css('--text-secondary');
              ctx.strokeStyle = css('--text-secondary');
              ctx.lineWidth = devicePixelRatio;
              for (const t of lost) {
                const px = u.valToPos(t, 'x', true);
                ctx.beginPath();
                ctx.moveTo(px, u.bbox.top);
                ctx.lineTo(px, u.bbox.top + u.bbox.height);
                ctx.stroke();
                ctx.fillText('mất gói', px + 4 * devicePixelRatio, u.bbox.top + 14 * devicePixelRatio);
              }
              ctx.restore();
            },
          },
        },
      ],
    },
    [xs, truth, pzem],
    el,
  );
  new ResizeObserver(() => chart.setSize({ width: el.clientWidth, height: 300 })).observe(el);
}

// Bảng mốc (để đọc số chính xác, không phụ thuộc màu).
const lastValid = (m, col) => {
  for (let k = m.n - 1; k >= 0; k--) if (m.columns.valid[k] === 1) return m.columns[col][k];
  return null;
};
const pzemAtCut = (r) => {
  let k = Math.round(r.result.events.t_cut_s / T);
  while (k < r.meas.n && r.meas.columns.valid[k] !== 1) k++;
  return k < r.meas.n ? r.meas.columns.E_Wh[k] : null;
};
const rows = [
  ['P ổ cắm đầu phiên (W)', (r) => fmt(r.result.events.P_wall_first_W)],
  ['P ổ cắm ngay trước CV (W)', (r) => fmt(r.result.events.P_wall_last_cc_W)],
  ['Vào CV (giờ)', (r) => fmt(r.result.events.t_cv_s / 3600, 3)],
  ['z lúc vào CV', (r) => fmt(r.result.events.z_cv, 4)],
  ['Đuôi CV (phút)', (r) => fmt((r.result.events.t_cut_s - r.result.events.t_cv_s) / 60, 1)],
  ['Cắt sạc (giờ)', (r) => fmt(r.result.events.t_cut_s / 3600, 3)],
  ['Điện năng ổ cắm tới lúc cắt, thật (Wh)', (r) => fmt(r.result.events.E_cut_Wh, 1)],
  ['Điện năng ổ cắm tới lúc cắt, PZEM đọc (Wh)', (r) => fmt(pzemAtCut(r), 0)],
  ['PZEM: số mẫu mất gói', (r) => `${r.meas.stats.lost} / ${r.meas.n}`],
  ['PZEM standby cuối phiên: P (W) / I (A)', (r) => `${fmt(lastValid(r.meas, 'P_W'))} / ${fmt(lastValid(r.meas, 'I_A'), 3)}`],
];
const head = `<tr><th></th>${runs.map((r) => `<th><span class="swatch" style="background:var(${r.color})"></span>${r.label}</th>`).join('')}</tr>`;
document.getElementById('events').innerHTML =
  head + rows.map(([name, f]) => `<tr><td>${name}</td>${runs.map((r) => `<td>${f(r)}</td>`).join('')}</tr>`).join('');
