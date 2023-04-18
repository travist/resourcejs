#! /usr/bin/env node
const fs = require('fs');
const packageName = process.argv[2];
const packagePath = process.argv[3];

function safeParseJson(str) {
  try {
    const maybeJson = JSON.parse(str);
    return maybeJson != null && typeof maybeJson == 'object' ? maybeJson : {};
  } catch (e) {
    return {};
  }
}

try {
  const packageExist = fs.existsSync(packagePath);

  if (!packageName) return console.log('[change-package-name] no name provided -- aborted');
  if (!packageExist) return console.log('[change-package-name] no package.json was found -- aborted');

  const package = safeParseJson(fs.readFileSync(packagePath).toString());
  package.name = packageName;
  fs.writeFileSync(packagePath, JSON.stringify(package, null, 2));
} catch (e) {
  console.log(e.message);
}