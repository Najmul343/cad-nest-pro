const fs = require('fs');
const path = require('path');

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    file = path.join(dir, file);
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) {
      results = results.concat(walk(file));
    } else if (file.endsWith('.js')) {
      results.push(file);
    }
  });
  return results;
}

const targetDir = path.join(__dirname, '..', 'node_modules', '@makeorbreakshop', 'any-nest', 'dist');

if (fs.existsSync(targetDir)) {
  const jsFiles = walk(targetDir);
  let patchedCount = 0;
  jsFiles.forEach(filePath => {
    let content = fs.readFileSync(filePath, 'utf8');
    const newContent = content.replace(/from\s+["'](\.[^"']+)["']/g, (match, p1) => {
      if (!p1.endsWith('.js')) {
        return 'from "' + p1 + '.js"';
      }
      return match;
    });

    if (content !== newContent) {
      fs.writeFileSync(filePath, newContent, 'utf8');
      patchedCount++;
      console.log('Patched ESM import in: ' + path.relative(targetDir, filePath));
    }
  });
  console.log('Successfully patched ' + patchedCount + ' files in @makeorbreakshop/any-nest');
} else {
  console.log('@makeorbreakshop/any-nest not found, skipping patch.');
}
