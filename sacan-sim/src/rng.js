// Bộ sinh số ngẫu nhiên có seed (mulberry32). Chỉ dùng phép toán số nguyên 32 bit
// nên cùng seed cho cùng dãy số trên mọi trình duyệt.
//
// Mỗi tầng dùng một "luồng" riêng (streamSeed), để thêm ngẫu nhiên ở tầng này
// không làm xô lệch dãy số của tầng khác.

export const STREAM = Object.freeze({ PZEM: 1 });

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Trộn seed gốc với số hiệu luồng thành seed con (hàm băm số nguyên, kiểu murmur3 fmix32).
export function streamSeed(seed, stream) {
  let h = (seed ^ Math.imul(stream + 1, 0x9e3779b9)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

// Hai số chuẩn N(0, 1) độc lập từ hai số đều (Box–Muller).
// Dùng Math.log/cos/sin nên "giống từng bit" chỉ đảm bảo trên cùng một engine JS.
export function normalPair(rng) {
  const u1 = 1 - rng(); // (0, 1], tránh log(0)
  const u2 = rng();
  const r = Math.sqrt(-2 * Math.log(u1));
  return [r * Math.cos(2 * Math.PI * u2), r * Math.sin(2 * Math.PI * u2)];
}
