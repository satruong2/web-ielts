// Chạy cả một phiên sạc bằng model.step(), trả về các cột Float32Array và các mốc sự kiện.
// Dùng chung cho test, trang web và (Bước 4) worker.js.

import { MODE, initState, step } from './model.js';

export const CODE_VERSION = '0.2.0-buoc2';

export const COLUMNS = [
  't_s', // thời điểm đầu khoảng [t, t + dt)
  'P_wall_W', // công suất ổ cắm
  'V_out_V', // điện áp đầu ra bộ sạc (DC)
  'I_out_A', // dòng sạc (DC)
  'I_rms_A', // dòng ổ cắm = P_wall / (V_grid · PF)
  'PF',
  'V_grid_V', // điện áp lưới thật tại ổ cắm
  'soc', // z trung bình các cell (có thể > 1, xem model.js)
  'V_cell_max_V',
  'mode', // 0 = CC, 1 = CV, 2 = đã cắt
  'E_wall_Wh', // điện năng cộng dồn từ ổ cắm, tại cuối khoảng
];

export function simulate(p) {
  const dt = p.dt;
  const rows = Object.fromEntries(COLUMNS.map((c) => [c, []]));
  const events = {
    t_cv_s: null, // lúc vào CV
    z_cv: null, // z trung bình lúc vào CV
    P_wall_last_cc_W: null, // công suất bước CC cuối cùng (đỉnh trước CV)
    t_cut_s: null, // lúc bộ sạc cắt
    E_cut_Wh: null, // điện năng từ ổ cắm tính tới lúc cắt (chưa cộng standby)
    Ah_cut: null,
    z_cut: null,
    P_wall_first_W: null,
    P_wall_max_W: -Infinity,
    stopped_by_t_max: false,
  };

  let s = initState(p);
  let prevOut = null;
  for (;;) {
    if (s.t >= p.t_max) {
      events.stopped_by_t_max = true;
      break;
    }
    const { state, out } = step(s, p, dt);

    if (events.P_wall_first_W === null) events.P_wall_first_W = out.P_wall;
    if (out.mode !== MODE.DONE && out.P_wall > events.P_wall_max_W) events.P_wall_max_W = out.P_wall;
    if (out.mode === MODE.CV && events.t_cv_s === null) {
      events.t_cv_s = out.t;
      events.z_cv = out.z_mean;
      events.P_wall_last_cc_W = prevOut ? prevOut.P_wall : null;
    }
    if (out.mode === MODE.DONE && events.t_cut_s === null) {
      events.t_cut_s = out.t;
      events.E_cut_Wh = s.E_Wh;
      events.Ah_cut = s.Ah;
      events.z_cut = out.z_mean;
    }

    rows.t_s.push(out.t);
    rows.P_wall_W.push(out.P_wall);
    rows.V_out_V.push(out.V_out);
    rows.I_out_A.push(out.I);
    rows.I_rms_A.push(out.I_rms);
    rows.PF.push(out.PF);
    rows.V_grid_V.push(out.V_grid);
    rows.soc.push(out.z_mean);
    rows.V_cell_max_V.push(out.V_cell_max);
    rows.mode.push(out.mode);
    rows.E_wall_Wh.push(state.E_Wh);

    prevOut = out;
    s = state;
    if (events.t_cut_s !== null && s.t >= events.t_cut_s + p.t_standby_after) break;
  }

  const columns = Object.fromEntries(COLUMNS.map((c) => [c, Float32Array.from(rows[c])]));
  return {
    columns,
    n: rows.t_s.length,
    events,
    meta: { code_version: CODE_VERSION, dt, seed: p.seed, ids: p.ids },
  };
}
