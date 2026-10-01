// Mô hình sạc: bộ sạc CC/CV + chuỗi Ns cell (mỗi cell 1RC, tùy chọn RC2).
// Hàm thuần, không chạm DOM. Quy ước: dòng sạc I > 0.
//
//   V_cell = OCV(z) + I·R0 + V1 (+ V2)
//   V1[k+1] = a·V1[k] + R1·(1 − a)·I[k],  a = exp(−dt/τ1)   (rời rạc hóa chính xác)
//   z[k+1]  = z[k] + I·dt / Q
//   P_wall  = P_out + P0 + a·P_out + b·P_out²  (khi đang sạc), P_standby (khi đã cắt)
//
// z là biến trạng thái của mô hình. z > 1 KHÔNG có nghĩa là pin chứa hơn 100% điện;
// nó chỉ cho phép bảng OCV (ASSUMED) chạm được V_cv. Xem params/*.json, trường ocv_ext.

export const MODE = Object.freeze({ CC: 0, CV: 1, DONE: 2 });

// Nội suy tuyến tính trên bảng (xs tăng dần). Ngoài bảng thì báo lỗi thay vì ngoại suy.
export function interp(xs, ys, x) {
  const n = xs.length;
  if (!(x >= xs[0] && x <= xs[n - 1])) {
    throw new RangeError(`z = ${x} nằm ngoài bảng OCV [${xs[0]}, ${xs[n - 1]}]`);
  }
  let i = 1;
  while (i < n - 1 && x > xs[i]) i++;
  const f = (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
  return ys[i - 1] + f * (ys[i] - ys[i - 1]);
}

export function ocv(p, z) {
  return interp(p.ocv_soc, p.ocv_v, z);
}

export function initState(p) {
  return {
    t: 0,
    mode: MODE.CC,
    z: new Float64Array(p.Ns).fill(p.soc0),
    v1: new Float64Array(p.Ns).fill(p.v1_0),
    v2: new Float64Array(p.Ns),
    E_Wh: 0,
    Ah: 0,
  };
}

// Một bước dt giây. Trả về { state, out }: `out` là giá trị trong khoảng [t, t + dt),
// `state` là trạng thái tại t + dt. Không sửa state cũ.
export function step(state, p, dt) {
  const Ns = p.Ns;
  if (p.rc2_enabled && (p.R2_cell == null || p.tau2 == null)) {
    throw new Error('RC2 đang bật nhưng R2_cell hoặc tau2 chưa có giá trị');
  }

  // Điện áp pack khi chưa tính sụt áp tức thì: ΣOCV + ΣV1 + ΣV2.
  let E = 0;
  for (let i = 0; i < Ns; i++) E += ocv(p, state.z[i]) + state.v1[i] + state.v2[i];
  const R_series = Ns * p.R0_cell + p.R_c_dc;
  if (!(R_series > 0)) throw new Error('Tổng điện trở nối tiếp phải > 0');

  // Bộ sạc: CC cho tới khi chạm V_cv, sau đó CV cho tới khi I < I_cut.
  let mode = state.mode;
  let I = 0;
  if (mode === MODE.CC) {
    if (E + p.I_cc * R_series < p.V_cv_pack) I = p.I_cc;
    else mode = MODE.CV;
  }
  if (mode === MODE.CV) {
    I = Math.min(p.I_cc, (p.V_cv_pack - E) / R_series);
    if (I < p.I_cut) {
      mode = MODE.DONE;
      I = 0;
    }
  }
  const charging = mode !== MODE.DONE;

  // Phía DC (đầu ra bộ sạc) và phía AC (ổ cắm).
  const V_out = E + I * R_series;
  const P_out = V_out * I;
  const P_wall = charging ? P_out + p.P0 + p.a * P_out + p.b * P_out * P_out : p.P_standby;
  const I_rms = P_wall / (p.V_grid * p.PF);

  // Cập nhật trạng thái từng cell với I giữ không đổi trong dt.
  const a1 = Math.exp(-dt / p.tau1);
  const a2 = p.rc2_enabled ? Math.exp(-dt / p.tau2) : 0;
  const dz = (I * dt) / (p.Q_Ah * 3600);
  const z = new Float64Array(Ns);
  const v1 = new Float64Array(Ns);
  const v2 = new Float64Array(Ns);
  let V_cell_max = -Infinity;
  let z_sum = 0;
  for (let i = 0; i < Ns; i++) {
    const vc = ocv(p, state.z[i]) + state.v1[i] + state.v2[i] + I * p.R0_cell;
    if (vc > V_cell_max) V_cell_max = vc;
    z_sum += state.z[i];
    z[i] = state.z[i] + dz;
    v1[i] = a1 * state.v1[i] + p.R1_cell * (1 - a1) * I;
    v2[i] = p.rc2_enabled ? a2 * state.v2[i] + p.R2_cell * (1 - a2) * I : 0;
  }

  return {
    state: {
      t: state.t + dt,
      mode,
      z,
      v1,
      v2,
      E_Wh: state.E_Wh + (P_wall * dt) / 3600,
      Ah: state.Ah + (I * dt) / 3600,
    },
    out: {
      t: state.t,
      mode,
      I,
      V_out,
      P_out,
      P_wall,
      I_rms,
      PF: p.PF,
      z_mean: z_sum / Ns,
      V_cell_max,
    },
  };
}
