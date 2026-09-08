Apache ECharts 6.1.0, "common" build (line, bar, pie plus tooltip, legend and grid).
Apache License 2.0, see ECHARTS-LICENSE.txt. Vendored so the app keeps working offline.

Receipt OCR is vendored for the same reason:
- Tesseract.js 7.0.0 browser bundle and worker, Apache License 2.0. See
  tesseract/TESSERACT-LICENSE.md.
- tesseract.js-core 7.0.0 LSTM WebAssembly bundles (base, SIMD and relaxed
  SIMD), Apache License 2.0. See tesseract/core/CORE-LICENSE.txt.
- English 4.0.0_best_int trained data from naptha/tessdata, Apache License
  2.0. See tesseract/lang/TESSDATA-LICENSE.txt.

Only the English LSTM model and the three cores selected by Tesseract.js's
runtime feature detection are included. The app supplies local workerPath,
corePath and langPath values, so scanning makes no network request.
