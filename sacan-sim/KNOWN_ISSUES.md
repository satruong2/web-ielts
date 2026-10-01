# Việc đã biết

Các điểm mô hình lệch tài liệu, lệch dữ liệu thật hoặc còn mang tính giả định.
Mục nào chưa xử lý thì con số liên quan phải được nêu rõ là chưa xác nhận khi đưa vào báo cáo.

| # | Vấn đề | Chi tiết | Trạng thái |
|---|---|---|---|
| 1 | **Đuôi CV của LFP quá ngắn** | Mô hình cho đuôi CV LFP ≈ **1,4 phút**. Mốc so sánh: ≈ **1,8 giờ** cho 10% SOC cuối = 4,8 h (100%) − 3,0 h (90%), lấy từ trang FAQ VinFast ([vinfastauto.com/vn_en/node/1142](https://vinfastauto.com/vn_en/node/1142)); **chưa rõ dòng xe**, chưa rõ pack và bộ sạc; "90%" là SOC hiển thị của BMS, không phải z của mô hình. Đã thử RC2 (R2 ≤ 10 mΩ, τ2 1800–8070 s): đuôi chỉ lên 1,4–1,8 phút. | Chưa sửa ở Bước 1 (người dùng quyết định, 2026-10-01). Đề xuất chỉnh bảng OCV gần 100% (ASSUMED) đang chờ duyệt. |
| 2 | **z > 1 khi sạc LFP** | Với bảng OCV hiện tại, LFP chỉ chạm 3,65 V/cell ở z ≈ 1,002 và cắt ở z ≈ 1,005. z > 1 là **biến của mô hình, không phải vật lý**. | Có test ghi lại hành vi; nhãn ASSUMED. |
| 3 | NMC vào CV ở z ≈ 0,967 | Báo cáo viết NMC hết CC ở 80–90% SOC (con số đó là cho sạc 1C); bảng tham số của chính báo cáo cho ≈ 96–97% ở 0,25C. | Ghi nhận, không sửa. |
| 4 | Test Bước 1 mang tính vòng tròn | Số tham chiếu (298 W, 1,11 kWh, ...) do tác giả báo cáo tính từ cùng tham số ASSUMED. Test chỉ chứng minh code tính đúng công thức. Thời điểm vào CV tham chiếu do Claude tự suy ra. | Chờ PyBaMM (Bước 5) và dữ liệu PZEM thật. |
| 5 | "Giống từng bit" chỉ trong cùng engine JS | `Math.exp`, `Math.log`, `Math.cos` có thể khác giữa các trình duyệt. RNG mulberry32 thì giống nhau ở mọi nơi. | So giữa engine hoặc với PyBaMM phải dùng dung sai. |
| 6 | Standby: PZEM đọc P > 0 nhưng I = 0 | Standby 0,5 W (ASSUMED) ≥ ngưỡng 0,4 W nên P và Wh vẫn đếm; dòng thật ≈ 0,0023 A < ngưỡng 0,01 A nên I và PF đọc 0. PF thật của bộ sạc khi standby chưa biết (mô hình giữ 0,99). | Hệ quả của tham số; cần so với bản ghi thật. |
| 7 | Bảng nhiệt của báo cáo không khớp nhau | τ nhiệt tính với 5 kg (pack 12 Ah) dù pack 20 Ah ≈ 8 kg; nhiệt sinh 2,2 W tính ở 6 A, 60 mΩ thay vì 5 A, 24 mΩ. | Xử lý khi làm mô hình nhiệt (Bước 3). |
