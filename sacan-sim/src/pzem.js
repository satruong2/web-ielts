// Lớp đo PZEM-004T v3: biến giá trị thật ở ổ cắm (từ simulate) thành số đọc như module PZEM.
// Hàm thuần, không chạm DOM. Lớp đo không tác động ngược lên vật lý, nên được xử lý
// sau khi chạy mô phỏng (khác với các lỗi ở Bước 3, phải nằm trong model).
//
// Mỗi mẫu đọc:
//   1. Mất gói với xác suất loss_prob → cả hàng là NaN, valid = 0.
//   2. Nhiễu tương đối N(0, σ) độc lập cho V, I, P, PF.
//   3. Ngưỡng: P < P_start → P = 0; I < I_start → I = 0 và PF = 0.
//   4. Làm tròn theo độ phân giải; Wh lấy phần nguyên (floor) của bộ đếm.
//
// Các hành vi sau là ASSUMED (manual không mô tả, chưa đo):
//   - nhiễu của 4 kênh độc lập nhau, không có sai số hệ thống (gain) riêng từng máy;
//   - PF đọc 0 khi dòng dưới ngưỡng I_start;
//   - bộ đếm Wh tích phân công suất THẬT (không nhiễu), bỏ qua khi P < P_start, rồi floor;
//   - V ngoài dải [V_min, V_max] → mẫu không hợp lệ (NaN);
//   - mất gói chỉ làm mất lần đọc, bộ đếm Wh trong module vẫn chạy.

import { mulberry32, normalPair, streamSeed, STREAM } from './rng.js';

export const PZEM_COLUMNS = ['t_s', 'V_V', 'I_A', 'P_W', 'PF', 'E_Wh', 'valid'];

// Làm tròn tới bội số của res (res = 0,1; 0,001; ...). Dùng 1/res nguyên để tránh lỗi số thực.
export function quantize(x, res) {
  const inv = Math.round(1 / res);
  return Math.round(x * inv) / inv;
}

export function measure(sim, pz, seed) {
  const c = sim.columns;
  const dt = sim.meta.dt;
  const every = pz.T_sample / dt;
  if (!Number.isInteger(every) || every < 1) {
    throw new Error(`T_sample (${pz.T_sample} s) phải là bội số nguyên của dt (${dt} s)`);
  }

  const rng = mulberry32(streamSeed(seed, STREAM.PZEM));
  const rows = Object.fromEntries(PZEM_COLUMNS.map((k) => [k, []]));
  const pushRow = (t, V, I, P, PF, E, valid) => {
    rows.t_s.push(t);
    rows.V_V.push(V);
    rows.I_A.push(I);
    rows.P_W.push(P);
    rows.PF.push(PF);
    rows.E_Wh.push(E);
    rows.valid.push(valid);
  };

  let E_acc = 0; // bộ đếm bên trong module (Wh, chưa làm tròn)
  for (let k = 0; k < sim.n; k++) {
    const P_true = c.P_wall_W[k];
    if (k % every === 0) {
      // Luôn rút đúng 5 số ngẫu nhiên mỗi mẫu, để dãy số không phụ thuộc mẫu nào bị mất.
      const lost = rng() < pz.loss_prob;
      const [nV, nI] = normalPair(rng);
      const [nP, nPF] = normalPair(rng);
      const V_true = c.V_grid_V[k];

      if (lost || V_true < pz.V_min || V_true > pz.V_max) {
        pushRow(c.t_s[k], NaN, NaN, NaN, NaN, NaN, 0);
      } else {
        const s = pz.noise_sigma_rel;
        let V = V_true * (1 + s * nV);
        let I = c.I_rms_A[k] * (1 + s * nI);
        let P = P_true * (1 + s * nP);
        let PF = Math.min(1, c.PF[k] * (1 + s * nPF));
        if (P < pz.P_start) P = 0;
        if (I < pz.I_start) {
          I = 0;
          PF = 0;
        }
        pushRow(
          c.t_s[k],
          quantize(V, pz.V_res),
          quantize(I, pz.I_res),
          quantize(P, pz.P_res),
          quantize(PF, pz.PF_res),
          Math.floor(E_acc / pz.E_res) * pz.E_res,
          1,
        );
      }
    }
    // Cộng điện năng của khoảng [t_k, t_k + dt) sau khi đọc: số đọc tại t_k là tổng tới t_k.
    if (P_true >= pz.P_start) E_acc += (P_true * dt) / 3600;
  }

  const columns = Object.fromEntries(PZEM_COLUMNS.map((k) => [k, Float32Array.from(rows[k])]));
  const n = rows.t_s.length;
  const lostCount = n - rows.valid.reduce((a, b) => a + b, 0);
  return { columns, n, stats: { lost: lostCount, loss_rate: lostCount / n }, meta: { ...sim.meta, seed, T_sample: pz.T_sample } };
}
