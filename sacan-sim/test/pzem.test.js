// Bước 2: lớp đo PZEM. Các test kiểm tra code làm đúng những gì đã mô tả trong
// params/pzem004t_v3.json và src/pzem.js (làm tròn, ngưỡng, nhiễu, mất gói, bộ đếm Wh).
// Chưa phải kiểm chứng thực nghiệm: nhiễu σ và tỉ lệ mất gói là ASSUMED, cần so với
// bản ghi PZEM thật (báo cáo, mục chưa xác nhận #6).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildModelParams, unwrap } from '../src/params.js';
import { simulate } from '../src/simulate.js';
import { measure, quantize } from '../src/pzem.js';
import { MODE } from '../src/model.js';

const load = (name) => JSON.parse(readFileSync(new URL(`../params/${name}`, import.meta.url)));
const PZ = unwrap(load('pzem004t_v3.json'));
const SEED = unwrap(load('session_default.json')).seed;
const CHARGER = unwrap(load('charger_good_300w.json'));

// Phiên giả lập với giá trị thật không đổi, để kiểm tra riêng lớp đo.
function constSim({ n, P, V = 220, PF = 0.99, dt = 1 }) {
  const fill = (v) => new Float32Array(n).fill(v);
  return {
    n,
    columns: {
      t_s: Float32Array.from({ length: n }, (_, k) => k * dt),
      P_wall_W: fill(P),
      V_grid_V: fill(V),
      PF: fill(PF),
      I_rms_A: fill(P / (V * PF)),
    },
    meta: { dt },
  };
}

const sessionRun = (chem) =>
  simulate(
    buildModelParams(
      load(chem === 'LFP' ? 'lfp_16s_20ah.json' : 'nmc_13s_20ah.json'),
      load('charger_good_300w.json'),
      load('session_default.json'),
    ),
  );
const runs = { LFP: sessionRun('LFP'), NMC: sessionRun('NMC') };

const validIdx = (m) => [...m.columns.valid.keys()].filter((k) => m.columns.valid[k] === 1);
const isMultiple = (x, res) => Math.abs(x / res - Math.round(x / res)) < 1e-3;

describe('PZEM: làm tròn theo độ phân giải (CITED)', () => {
  const m = measure(runs.LFP, PZ, SEED);
  const idx = validIdx(m);
  for (const [col, res] of [
    ['V_V', PZ.V_res],
    ['I_A', PZ.I_res],
    ['P_W', PZ.P_res],
    ['PF', PZ.PF_res],
    ['E_Wh', PZ.E_res],
  ]) {
    it(`${col} là bội số của ${res}`, () => {
      expect(idx.every((k) => isMultiple(m.columns[col][k], res))).toBe(true);
    });
  }
  it('quantize không sinh lỗi số thực kiểu 220.10000000000002', () => {
    expect(quantize(220.14, 0.1)).toBe(220.1);
    expect(quantize(1.5234, 0.001)).toBe(1.523);
  });
});

describe('PZEM: ngưỡng bắt đầu đo (CITED)', () => {
  const noNoise = { ...PZ, noise_sigma_rel: 0, loss_prob: 0 };
  it('P dưới 0,4 W đọc 0', () => {
    const m = measure(constSim({ n: 10, P: 0.3 }), noNoise, SEED);
    expect([...m.columns.P_W].every((x) => x === 0)).toBe(true);
  });
  it('P trên 0,4 W vẫn đọc được (standby 0,5 W)', () => {
    const m = measure(constSim({ n: 10, P: 0.5 }), noNoise, SEED);
    expect(m.columns.P_W[0]).toBeCloseTo(0.5, 5);
  });
  it('I dưới 0,01 A đọc 0, kéo theo PF đọc 0 (hành vi ASSUMED)', () => {
    const m = measure(constSim({ n: 10, P: 0.5 }), noNoise, SEED); // I thật ≈ 0,0023 A
    expect(m.columns.I_A[0]).toBe(0);
    expect(m.columns.PF[0]).toBe(0);
  });
  it('không nhiễu, không mất gói → đúng bằng giá trị thật đã làm tròn', () => {
    const m = measure(constSim({ n: 5, P: 305.37 }), noNoise, SEED);
    expect(m.columns.P_W[3]).toBeCloseTo(305.4, 4);
    expect(m.columns.V_V[3]).toBeCloseTo(220.0, 4);
    expect(m.columns.PF[3]).toBeCloseTo(0.99, 5);
  });
});

describe('PZEM: nhiễu và mất gói (ASSUMED)', () => {
  const N = 200_000;
  const m = measure(constSim({ n: N, P: 300 }), PZ, SEED);
  const P = validIdx(m).map((k) => m.columns.P_W[k]);

  it(`độ lệch chuẩn tương đối của P ≈ σ = ${PZ.noise_sigma_rel} (±10%)`, () => {
    const mean = P.reduce((a, b) => a + b, 0) / P.length;
    const sd = Math.sqrt(P.reduce((a, b) => a + (b - mean) ** 2, 0) / (P.length - 1));
    expect(Math.abs(mean - 300) / 300).toBeLessThan(5e-4);
    expect(sd / 300).toBeGreaterThan(PZ.noise_sigma_rel * 0.9);
    expect(sd / 300).toBeLessThan(PZ.noise_sigma_rel * 1.1);
  });

  it(`tỉ lệ mất gói ≈ ${PZ.loss_prob} (trong ±4σ nhị thức)`, () => {
    const sigma = Math.sqrt((PZ.loss_prob * (1 - PZ.loss_prob)) / N);
    expect(Math.abs(m.stats.loss_rate - PZ.loss_prob)).toBeLessThan(4 * sigma);
  });

  it('mẫu mất gói: mọi cột đo là NaN, valid = 0, thời gian vẫn giữ', () => {
    const k = [...m.columns.valid].indexOf(0);
    expect(k).toBeGreaterThanOrEqual(0);
    for (const col of ['V_V', 'I_A', 'P_W', 'PF', 'E_Wh']) expect(Number.isNaN(m.columns[col][k])).toBe(true);
    expect(m.columns.t_s[k]).toBe(k);
  });
});

describe('PZEM: bộ đếm Wh (CITED 1 Wh, cách đếm ASSUMED)', () => {
  for (const chem of ['LFP', 'NMC']) {
    const sim = runs[chem];
    const m = measure(sim, PZ, SEED);
    it(`${chem}: số đọc là số nguyên và không giảm`, () => {
      const E = validIdx(m).map((k) => m.columns.E_Wh[k]);
      expect(E.every((e, i) => Number.isInteger(e) && (i === 0 || e >= E[i - 1]))).toBe(true);
    });
    it(`${chem}: số đọc lúc cắt sạc lệch giá trị thật < 1 Wh (bộ đếm chạy cả khi mất gói)`, () => {
      const kCut = sim.events.t_cut_s / sim.meta.dt;
      // lấy mẫu hợp lệ đầu tiên từ lúc cắt trở đi
      let k = kCut;
      while (m.columns.valid[k] !== 1) k++;
      // Standby (0,5 W) ≥ ngưỡng 0,4 W nên bộ đếm vẫn cộng sau khi cắt.
      expect(CHARGER.P_standby).toBeGreaterThanOrEqual(PZ.P_start);
      const trueAtK = sim.events.E_cut_Wh + ((k - kCut) * sim.meta.dt * CHARGER.P_standby) / 3600;
      expect(trueAtK - m.columns.E_Wh[k]).toBeGreaterThanOrEqual(0);
      expect(trueAtK - m.columns.E_Wh[k]).toBeLessThan(1);
    });
  }
});

describe('PZEM trên phiên sạc Bước 1', () => {
  it('LFP: P trung bình đo được trong pha CC lệch giá trị thật < 0,1%', () => {
    const sim = runs.LFP;
    const m = measure(sim, PZ, SEED);
    let sumTrue = 0;
    let sumMeas = 0;
    let n = 0;
    for (let k = 0; k < sim.n; k++) {
      if (sim.columns.mode[k] !== MODE.CC || m.columns.valid[k] !== 1) continue;
      sumTrue += sim.columns.P_wall_W[k];
      sumMeas += m.columns.P_W[k];
      n++;
    }
    expect(n).toBeGreaterThan(10_000);
    expect(Math.abs(sumMeas - sumTrue) / sumTrue).toBeLessThan(1e-3);
  });

  it('standby sau khi cắt: P đọc ≈ 0,5 W nhưng I đọc 0 (hệ quả của ngưỡng I_start)', () => {
    const m = measure(runs.NMC, { ...PZ, loss_prob: 0 }, SEED);
    const k = m.n - 1;
    expect(m.columns.P_W[k]).toBeGreaterThan(0.4);
    expect(m.columns.I_A[k]).toBe(0);
  });
});

describe('PZEM: tái lập theo seed', () => {
  const bytes = (m) => Object.values(m.columns).map((col) => Buffer.from(col.buffer));
  it('cùng seed → giống từng bit (trên cùng engine JS)', () => {
    const a = bytes(measure(runs.LFP, PZ, SEED));
    const b = bytes(measure(runs.LFP, PZ, SEED));
    a.forEach((buf, i) => expect(buf.equals(b[i])).toBe(true));
  });
  it('khác seed → khác số đọc', () => {
    const a = measure(runs.LFP, PZ, SEED).columns.P_W;
    const b = measure(runs.LFP, PZ, SEED + 1).columns.P_W;
    expect(Buffer.from(a.buffer).equals(Buffer.from(b.buffer))).toBe(false);
  });
  it('đổi tỉ lệ mất gói không làm đổi nhiễu của các mẫu còn lại', () => {
    const a = measure(runs.LFP, { ...PZ, loss_prob: 0 }, SEED);
    const b = measure(runs.LFP, { ...PZ, loss_prob: 0.05 }, SEED);
    for (const k of validIdx(b).slice(0, 2000)) expect(b.columns.P_W[k]).toBe(a.columns.P_W[k]);
  });
});

describe('PZEM: chu kỳ lấy mẫu', () => {
  it('T_sample = 2 s với dt = 1 s cho số mẫu bằng một nửa', () => {
    const m = measure(constSim({ n: 100, P: 300 }), { ...PZ, T_sample: 2 }, SEED);
    expect(m.n).toBe(50);
    expect(m.columns.t_s[1]).toBe(2);
  });
  it('T_sample không phải bội số của dt thì báo lỗi', () => {
    expect(() => measure(constSim({ n: 10, P: 300, dt: 2 }), PZ, SEED)).toThrow(/bội số/);
  });
});
