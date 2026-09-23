const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');

test('published entry points support CommonJS, ESM and TypeScript Cypress consumers', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'mailsac-consumer-'));
  try {
    fs.mkdirSync(path.join(temporary, 'node_modules/@mailsac'), { recursive: true });
    fs.symlinkSync(root, path.join(temporary, 'node_modules/@mailsac/cypress'), 'dir');
    fs.symlinkSync(path.join(root, 'node_modules/cypress'), path.join(temporary, 'node_modules/cypress'), 'dir');
    for (const moduleType of ['commonjs', 'module']) {
      const script = moduleType === 'commonjs'
        ? "const {extractCode}=require('@mailsac/cypress'); const {createMailsacTasks}=require('@mailsac/cypress/node'); if(extractCode({text:'123456'})!=='123456'||typeof createMailsacTasks!=='function')process.exit(1);"
        : "import {extractCode} from '@mailsac/cypress'; import {createMailsacTasks} from '@mailsac/cypress/node'; if(extractCode({text:'123456'})!=='123456'||typeof createMailsacTasks!=='function')process.exit(1);";
      const result = spawnSync(process.execPath, ['--input-type=' + moduleType, '-e', script], { cwd: temporary, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
    }
    const source = path.join(temporary, 'consumer.ts');
    fs.writeFileSync(source, `import {extractCode} from '@mailsac/cypress';
import {createMailsacTasks} from '@mailsac/cypress/node';
import '@mailsac/cypress/commands';
createMailsacTasks({apiKey:'fixture'});
cy.mailsacWaitForMessage({email:'test@example.com',receivedAfter:new Date().toISOString(),subject:'Reset'})
  .then(message => extractCode(message));
`);
    for (const modern of [false, true]) {
      const program = ts.createProgram([source], {
        noEmit: true, strict: true, skipLibCheck: true,
        target: ts.ScriptTarget.ES2022,
        module: modern ? ts.ModuleKind.Node16 : ts.ModuleKind.CommonJS,
        moduleResolution: modern ? ts.ModuleResolutionKind.Node16 : ts.ModuleResolutionKind.Node10,
      });
      const errors = ts.getPreEmitDiagnostics(program);
      assert.equal(errors.length, 0, ts.formatDiagnosticsWithColorAndContext(errors, {
        getCanonicalFileName: x => x, getCurrentDirectory: () => temporary, getNewLine: () => '\n',
      }));
    }
    const browserOnly = spawnSync(process.execPath, ['-e', "require('@mailsac/cypress'); if(Object.keys(require.cache).some(p=>p.includes('/@mailsac/api/')||p.includes('/axios/'))) process.exit(1);"], { cwd: temporary });
    assert.equal(browserOnly.status, 0, 'Browser helpers must not load the Node SDK.');
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
});
