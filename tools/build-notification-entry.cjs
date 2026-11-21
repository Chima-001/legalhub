// Supabase CLI may bundle the two local source files. For a single-file deployment, use these exact bytes.
// No package downloads, remote imports, deploy, credentials or network calls. Emits JavaScript valid as index.ts.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const source = fs
  .readFileSync(path.join(__dirname, '../supabase/functions/notify-admins-on-upload/handler.mjs'), 'utf8')
  .replace(/\r\n/g, '\n')
  .trimEnd();
if (/^\s*import\b/m.test(source))
  throw Error('The standalone notification entry must not require a runtime import.');
const entry = source + '\nDeno.serve(uploadEndpoint(name => Deno.env.get(name)));\n';
module.exports = entry;
if (require.main === module) process.stdout.write(entry);
