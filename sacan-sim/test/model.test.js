// =====================================================================================
// KIỂM TRA TÍNH NHẤT QUÁN VỚI TÀI LIỆU, CHƯA PHẢI KIỂM CHỨNG THỰC NGHIỆM.
//
// Các số tham chiếu dưới đây lấy từ "phép thử nhanh" trong báo cáo `Mô phỏng sạc pin
// lithium.md`. Chính các số đó được tính từ tham số ASSUMED giống hệt params/*.json.
// Test đạt chỉ chứng minh code JS tính đúng các công thức đã mô tả trong tài liệu.
// Nó KHÔNG chứng minh mô hình đúng với pin, bộ sạc hay ổ cắm thật. Muốn kiểm chứng
// thực nghiệm cần PyBaMM (Bước 5, kiểm tra độc lập về số) và dữ liệu PZEM thật.
//
// Dung sai theo SPEC §6 (bản thân các dung sai này cũng là ASSUMED):
//   công suất ±5%, thời điểm vào CV ±10 phút, tổng Wh ±5%, đuôi CV chỉ kiểm định tính.
// =====================================================================================

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildModelParams } from '../src/params.js';
import { simulate } from '../src/simulate.js';
import { MODE, initState, step } from '../src/model.js';
import { mulberry32 } from '../src/rng.js';

const load = (name) => JSON.parse(readFileSync(new URL(`../params/${name}`, import.meta.url)));
const BATTERY = { LFP: 'lfp_16s_20ah.json', NMC: 'nmc_13s_20ah.json' };

function params(chem, sessionOverrides = {}) {
  const session = load('session_default.json');
  for (const [k, v] of Object.entries(sessionOverrides)) session.params[k].value = v;
  return buildModelParams(load(BATTERY[chem]), load('charger_good_300w.json'), session);
}

const H = 3600;
const MIN = 60;

// Số tham chiếu, kèm vị trí trong báo cáo. "DERIVED (Claude)" = báo cáo không ghi số
// này; Claude tự suy ra từ bảng tham số của báo cáo, nên càng mang tính vòng tròn.
const REF = {
  LFP: {
    P_first_soc10: 298, // §"LFP và NMC khác nhau...": 298 W đầu phiên từ SOC 10%
    P_first_soc50: 305, // cùng đoạn: 305 W khi bắt đầu từ SOC 50%
    P_peak_cc: 335, // "rồi tăng lên khoảng 335 W ở khuỷu ngay trước CV"
    t_cv_h: 3.63 - 1.4 / 60, // DERIVED (Claude): tổng 3,63 h trừ đuôi 1,4 phút
    t_cut_h: 3.63, // bảng chèn lỗi, dòng "Bình thường"
    E_Wh: 1110, // 1,11 kWh
    tail_min: 1.4, // "khoảng 1,4 phút"
  },
  NMC: {
    P_first_soc10: 257, // 257 W
    P_first_soc50: 280, // 280 W khi bắt đầu từ SOC 50%
    P_peak_cc: 312, // "257 W lên 312 W"
    t_cv_h: (0.967 - 0.1) * (20 / 5), // DERIVED (Claude): vào CV ở z ≈ 0,967 (bảng OCV + I·R), 5 A, 20 Ah
    t_cut_h: null, // báo cáo không ghi tổng thời gian NMC
    E_Wh: 1020, // 1,02 kWh
    tail_min: 13, // "đuôi CV 13 phút"
  },
};

const within = (actual, ref, relTol) => Math.abs(actual - ref) / Math.abs(ref) <= relTol;

const runs = {
  LFP: simulate(params('LFP')),
  NMC: simulate(params('NMC')),
};

describe('Kiểm tra tính nhất quán với tài liệu, chưa phải kiểm chứng thực nghiệm', () => {
  for (const chem of ['LFP', 'NMC']) {
    const ref = REF[chem];
    const { events: e } = runs[chem];

    describe(`${chem}: công suất vùng phẳng (±5%)`, () => {
      it(`đầu phiên từ SOC 10% ≈ ${ref.P_first_soc10} W`, () => {
        expect(within(e.P_wall_first_W, ref.P_first_soc10, 0.05)).toBe(true);
      });
      it(`đầu phiên từ SOC 50% ≈ ${ref.P_first_soc50} W`, () => {
        const e50 = simulate(params(chem, { soc0: 0.5 })).events;
        expect(within(e50.P_wall_first_W, ref.P_first_soc50, 0.05)).toBe(true);
      });
      it(`đỉnh cuối CC (ngay trước CV) ≈ ${ref.P_peak_cc} W`, () => {
        expect(within(e.P_wall_last_cc_W, ref.P_peak_cc, 0.05)).toBe(true);
      });
      it('đỉnh công suất nằm tại điểm chuyển CC → CV (bước CC cuối hoặc CV đầu)', () => {
        const { columns: c } = runs[chem];
        const kMax = c.P_wall_W.indexOf(Math.max(...c.P_wall_W));
        expect(Math.abs(c.t_s[kMax] - e.t_cv_s)).toBeLessThanOrEqual(params(chem).dt);
      });
    });

    describe(`${chem}: thời điểm vào CV (±10 phút)`, () => {
      it(`vào CV ở ≈ ${ref.t_cv_h.toFixed(2)} h`, () => {
        expect(e.t_cv_s).not.toBeNull();
        expect(Math.abs(e.t_cv_s - ref.t_cv_h * H)).toBeLessThanOrEqual(10 * MIN);
      });
      if (ref.t_cut_h !== null) {
        it(`cắt sạc ở ≈ ${ref.t_cut_h} h`, () => {
          expect(Math.abs(e.t_cut_s - ref.t_cut_h * H)).toBeLessThanOrEqual(10 * MIN);
        });
      }
    });

    describe(`${chem}: tổng Wh phiên sạc (±5%)`, () => {
      it(`điện năng từ ổ cắm tới lúc cắt ≈ ${ref.E_Wh} Wh`, () => {
        expect(within(e.E_cut_Wh, ref.E_Wh, 0.05)).toBe(true);
      });
      it('Ah nạp vào khớp với thay đổi z (bảo toàn điện tích)', () => {
        const p = params(chem);
        expect(e.Ah_cut).toBeCloseTo((e.z_cut - p.soc0) * p.Q_Ah, 9);
      });
    });

    describe(`${chem}: đuôi CV (chỉ định tính)`, () => {
      const { columns: c, n } = runs[chem];
      it('trong pha CV, dòng và công suất ổ cắm giảm dần, điện áp giữ ở V_cv', () => {
        const p = params(chem);
        for (let k = 1; k < n; k++) {
          if (c.mode[k] === MODE.CV && c.mode[k - 1] === MODE.CV) {
            expect(c.I_out_A[k]).toBeLessThanOrEqual(c.I_out_A[k - 1]);
            expect(c.P_wall_W[k]).toBeLessThanOrEqual(c.P_wall_W[k - 1]);
            expect(c.V_out_V[k]).toBeCloseTo(p.V_cv_pack, 4);
          }
        }
      });
      it('sau khi cắt, công suất ổ cắm về mức standby', () => {
        const p = params(chem);
        expect(c.P_wall_W[n - 1]).toBeCloseTo(p.P_standby, 6);
      });
      it(`độ dài đuôi cùng bậc với báo cáo (~${ref.tail_min} phút, kiểm lỏng ×0,5–×2)`, () => {
        const tail = (e.t_cut_s - e.t_cv_s) / MIN;
        expect(tail).toBeGreaterThan(ref.tail_min * 0.5);
        expect(tail).toBeLessThan(ref.tail_min * 2);
      });
    });
  }

  it('đuôi CV của LFP ngắn hơn NMC (vấn đề đã biết, SPEC §7)', () => {
    const tail = (r) => r.events.t_cut_s - r.events.t_cv_s;
    expect(tail(runs.LFP)).toBeLessThan(tail(runs.NMC));
  });

  it('LFP chỉ vào CV khi z > 1: biến của mô hình, không phải SOC vật lý (ASSUMED)', () => {
    // Ghi lại hành vi này thành test để nó không âm thầm thay đổi.
    expect(runs.LFP.events.z_cv).toBeGreaterThan(1);
    expect(runs.NMC.events.z_cv).toBeLessThan(1);
  });
});

describe('Tái lập theo seed', () => {
  // Bước 1 chưa có nhiễu nên phần mô phỏng không dùng RNG. Test dưới kiểm tra hai điều:
  // (1) cùng tham số → cùng kết quả từng bit; (2) RNG có seed (sẽ dùng ở Bước 2) tái lập.
  // "Từng bit" chỉ áp dụng trên cùng một engine JS (Math.exp có thể khác giữa engine).
  const bytes = (r) => Object.values(r.columns).map((col) => Buffer.from(col.buffer));

  for (const chem of ['LFP', 'NMC']) {
    it(`${chem}: hai lần chạy cùng tham số cho kết quả giống từng bit`, () => {
      const a = bytes(simulate(params(chem)));
      const b = bytes(simulate(params(chem)));
      a.forEach((buf, i) => expect(buf.equals(b[i])).toBe(true));
    });
  }

  it('mulberry32: cùng seed → cùng dãy; khác seed → khác dãy', () => {
    const seq = (seed) => {
      const r = mulberry32(seed);
      return Array.from({ length: 1000 }, r);
    };
    expect(seq(20261001)).toEqual(seq(20261001));
    expect(seq(20261001)).not.toEqual(seq(20261002));
    expect(seq(1).every((x) => x >= 0 && x < 1)).toBe(true);
  });
});

describe('Tính chất số học của model.step', () => {
  it('step không sửa state đầu vào (hàm thuần)', () => {
    const p = params('LFP');
    const s0 = initState(p);
    const snapshot = JSON.stringify({ ...s0, z: [...s0.z], v1: [...s0.v1] });
    step(s0, p, 1);
    expect(JSON.stringify({ ...s0, z: [...s0.z], v1: [...s0.v1] })).toBe(snapshot);
  });

  it('dt = 2 s cho kết quả gần dt = 1 s (Wh lệch < 0,5%, vào CV lệch < 1 phút)', () => {
    for (const chem of ['LFP', 'NMC']) {
      const e1 = runs[chem].events;
      const e2 = simulate(params(chem, { dt: 2 })).events;
      expect(within(e2.E_cut_Wh, e1.E_cut_Wh, 0.005)).toBe(true);
      expect(Math.abs(e2.t_cv_s - e1.t_cv_s)).toBeLessThan(MIN);
    }
  });

  it('z ra ngoài bảng OCV thì báo lỗi, không ngoại suy', () => {
    const p = params('LFP');
    const s = { ...initState(p), z: new Float64Array(p.Ns).fill(1.2) };
    expect(() => step(s, p, 1)).toThrow(/ngoài bảng OCV/);
  });

  it('RC2 mặc định tắt; bật mà chưa có R2, τ2 thì báo lỗi', () => {
    const p = params('LFP');
    expect(p.rc2_enabled).toBe(false);
    expect(() => simulate({ ...p, rc2_enabled: true })).toThrow(/RC2/);
  });

  it('RC2 bật (giá trị chỉ dùng trong test) làm vào CV sớm hơn', () => {
    // R2 = 5 mΩ, τ2 = 1800 s: KHÔNG phải tham số mô hình, chỉ để kiểm tra code nhánh RC2.
    // τ2 nằm trong dải CITED 180–8070 s; R2 là ASSUMED thuần túy.
    for (const chem of ['LFP', 'NMC']) {
      const off = runs[chem].events;
      const on = simulate({ ...params(chem), rc2_enabled: true, R2_cell: 0.005, tau2: 1800 }).events;
      expect(on.t_cv_s).toBeLessThan(off.t_cv_s);
      expect(on.t_cut_s - on.t_cv_s).toBeGreaterThan(off.t_cut_s - off.t_cv_s);
    }
  });
});
