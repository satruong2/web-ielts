// Đọc file tham số JSON, kiểm tra nhãn nguồn, gộp thành một object phẳng cho model.
// Quy tắc (SPEC §4): mọi tham số phải có `source` ∈ {CITED, DERIVED, ASSUMED} và `ref` không rỗng.

export const SOURCES = ['CITED', 'DERIVED', 'ASSUMED'];

// Trả về danh sách lỗi (rỗng nếu file hợp lệ).
export function validateParamFile(file) {
  const errors = [];
  const id = file?.id ?? '(không có id)';
  if (!file || typeof file.params !== 'object') {
    return [`${id}: thiếu object "params"`];
  }
  for (const [key, entry] of Object.entries(file.params)) {
    if (!entry || typeof entry !== 'object' || !('value' in entry)) {
      errors.push(`${id}.${key}: phải có dạng { value, unit, source, ref }`);
      continue;
    }
    if (!SOURCES.includes(entry.source)) {
      errors.push(`${id}.${key}: source "${entry.source}" không thuộc ${SOURCES.join('/')}`);
    }
    if (typeof entry.ref !== 'string' || entry.ref.trim() === '') {
      errors.push(`${id}.${key}: thiếu "ref" (nguồn hoặc cách suy ra)`);
    }
    if (typeof entry.unit !== 'string') {
      errors.push(`${id}.${key}: thiếu "unit"`);
    }
  }
  return errors;
}

// Bỏ lớp nhãn, chỉ giữ value. Ném lỗi nếu file không hợp lệ.
export function unwrap(file) {
  const errors = validateParamFile(file);
  if (errors.length) throw new Error('Tham số không hợp lệ:\n' + errors.join('\n'));
  const out = {};
  for (const [key, entry] of Object.entries(file.params)) out[key] = entry.value;
  return out;
}

// Gộp pin + bộ sạc + phiên thành một object phẳng cho model.step().
export function buildModelParams(batteryFile, chargerFile, sessionFile) {
  const parts = [unwrap(batteryFile), unwrap(chargerFile), unwrap(sessionFile)];
  const p = {};
  for (const part of parts) {
    for (const [key, value] of Object.entries(part)) {
      if (key in p) throw new Error(`Tham số "${key}" bị trùng giữa các file`);
      p[key] = value;
    }
  }

  // Ghép bảng OCV và phần mở rộng z > 1 (biến mô hình, không phải SOC vật lý).
  const soc = [...p.ocv.soc, ...(p.ocv_ext?.soc ?? [])];
  const v = [...p.ocv.v, ...(p.ocv_ext?.v ?? [])];
  for (let i = 1; i < soc.length; i++) {
    if (!(soc[i] > soc[i - 1])) throw new Error('Bảng OCV: SOC phải tăng dần');
    if (!(v[i] >= v[i - 1])) throw new Error('Bảng OCV: điện áp không được giảm');
  }
  p.ocv_soc = soc;
  p.ocv_v = v;
  delete p.ocv;
  delete p.ocv_ext;

  p.ids = { battery: batteryFile.id, charger: chargerFile.id, session: sessionFile.id };
  return p;
}
