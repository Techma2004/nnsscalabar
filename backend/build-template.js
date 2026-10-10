// Regenerates ../score-sheet-template.xlsx (the blank, reusable Continuous Assessment Sheet).
const path = require('path');
const { buildWorkbook } = require('./sheetExcel');
buildWorkbook({}).then(wb => wb.xlsx.writeFile(path.join(__dirname, '..', 'score-sheet-template.xlsx')))
  .then(() => console.log('Wrote score-sheet-template.xlsx')).catch(err => { console.error(err); process.exit(1); });
