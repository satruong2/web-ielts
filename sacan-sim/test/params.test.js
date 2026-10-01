// Quy tắc SPEC §4: mọi tham số phải có nhãn CITED / DERIVED / ASSUMED. Test này chặn
// việc thêm tham số không nhãn vào params/*.json.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { validateParamFile, unwrap, buildModelParams } from '../src/params.js';

const dir = new URL('../params/', import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
const load = (name) => JSON.parse(readFileSync(new URL(name, dir)));

describe('Nhãn nguồn của tham số', () => {
  it('có ít nhất các file tham số của Bước 1', () => {
    expect(files).toEqual(
      expect.arrayContaining([
        'lfp_16s_20ah.json',
        'nmc_13s_20ah.json',
        'charger_good_300w.json',
        'session_default.json',
      ]),
    );
  });

  for (const f of files) {
    it(`${f}: mọi tham số có source hợp lệ, unit và ref`, () => {
      expect(validateParamFile(load(f))).toEqual([]);
    });
  }

  it('tham số thiếu nhãn bị từ chối', () => {
    const bad = { id: 'bad', params: { x: { value: 1, unit: 'V' } } };
    expect(validateParamFile(bad).length).toBeGreaterThan(0);
    expect(() => unwrap(bad)).toThrow();
  });

  it('nhãn lạ (không thuộc CITED/DERIVED/ASSUMED) bị từ chối', () => {
    const bad = { id: 'bad', params: { x: { value: 1, unit: 'V', source: 'GUESS', ref: 'x' } } };
    expect(validateParamFile(bad).length).toBeGreaterThan(0);
  });
});

describe('Tính nhất quán nội bộ của tham số pack', () => {
  for (const f of ['lfp_16s_20ah.json', 'nmc_13s_20ah.json']) {
    it(`${f}: V_cv_pack = Ns × V_cv_cell`, () => {
      const p = unwrap(load(f));
      expect(p.V_cv_pack).toBeCloseTo(p.Ns * p.V_cv_cell, 6);
    });
  }

  it('buildModelParams ghép bảng OCV và phần mở rộng z > 1', () => {
    const p = buildModelParams(
      load('lfp_16s_20ah.json'),
      load('charger_good_300w.json'),
      load('session_default.json'),
    );
    expect(p.ocv_soc.at(-1)).toBeGreaterThan(1);
    expect(p.ocv_soc.length).toBe(p.ocv_v.length);
  });
});
