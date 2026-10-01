// Bộ sinh số ngẫu nhiên có seed (mulberry32). Chỉ dùng phép toán số nguyên 32 bit
// nên cùng seed cho cùng dãy số trên mọi trình duyệt. Bước 1 chưa dùng (chưa có nhiễu);
// Bước 2 (lớp đo PZEM) sẽ dùng để sinh nhiễu và mất gói.

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
