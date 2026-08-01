const path = require('node:path');
const Mocha = require('mocha');

async function run() {
  const mocha = new Mocha({ ui: 'tdd', color: true, timeout: 10_000 });
  mocha.addFile(path.resolve(__dirname, 'extension.test.cjs'));
  await new Promise((resolve, reject) => {
    mocha.run((failures) => {
      if (failures > 0) reject(new Error(`${failures} extension test(s) failed.`));
      else resolve();
    });
  });
}

module.exports = { run };
