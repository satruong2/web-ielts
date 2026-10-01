// Trang Bước 1: chạy mô phỏng LFP và NMC rồi vẽ công suất ổ cắm theo thời gian.
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { buildModelParams } from '../params.js';
import { simulate } from '../simulate.js';
import lfp from '../../params/lfp_16s_20ah.json';
import nmc from '../../params/nmc_13s_20ah.json';
import charger from '../../params/charger_good_300w.json';
import session from '../../params/session_default.json';

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const runs = [
  { key: 'LFP', label: 'LFP 16S', color: '--series-lfp', result: simulate(buildModelParams(lfp, charger, session)) },
  { key: 'NMC', label: 'NMC 13S', color: '--series-nmc', result: simulate(buildModelParams(nmc, charger, session)) },
];

// Hai phiên có cùng dt và cùng t = 0, nên trục x chung là chỉ số bước.
const dt = session.params.dt.value;
const n = Math.max(...runs.map((r) => r.result.n));
const x = Float64Array.from({ length: n }, (_, k) => (k * dt) / 3600);
const ys = runs.map((r) => Array.from({ length: n }, (_, k) => (k < r.result.n ? r.result.columns.P_wall_W[k] : null)));

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

// Bảng mốc (để đọc số chính xác, không phụ thuộc màu).
const rows = [
  ['P ổ cắm đầu phiên (W)', (e) => fmt(e.P_wall_first_W)],
  ['P ổ cắm ngay trước CV (W)', (e) => fmt(e.P_wall_last_cc_W)],
  ['Vào CV (giờ)', (e) => fmt(e.t_cv_s / 3600, 3)],
  ['z lúc vào CV', (e) => fmt(e.z_cv, 4)],
  ['Đuôi CV (phút)', (e) => fmt((e.t_cut_s - e.t_cv_s) / 60, 1)],
  ['Cắt sạc (giờ)', (e) => fmt(e.t_cut_s / 3600, 3)],
  ['Điện năng ổ cắm tới lúc cắt (Wh)', (e) => fmt(e.E_cut_Wh, 0)],
];
const head = `<tr><th></th>${runs.map((r) => `<th><span class="swatch" style="background:var(${r.color})"></span>${r.label}</th>`).join('')}</tr>`;
document.getElementById('events').innerHTML =
  head + rows.map(([name, f]) => `<tr><td>${name}</td>${runs.map((r) => `<td>${f(r.result.events)}</td>`).join('')}</tr>`).join('');
