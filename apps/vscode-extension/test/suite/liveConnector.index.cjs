const path = require('node:path');
const Mocha = require('mocha');

async function run() {
  const mocha = new Mocha({ ui: 'tdd', color: true, timeout: 20_000 });
  mocha.addFile(path.resolve(__dirname, 'liveConnector.test.cjs'));
  await new Promise((resolve, reject) => {
    mocha.run((failures) => {
      if (failures > 0) reject(new Error(`${failures} live extension test(s) failed.`));
      else resolve();
    });
  });
}

module.exports = { run };
