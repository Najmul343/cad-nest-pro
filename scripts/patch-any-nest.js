const fs = require('fs');
const path = require('path');

function walk(dir) {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    file = path.join(dir, file);
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) {
      results = results.concat(walk(file));
    } else if (file.endsWith('.js') || file.endsWith('.mjs')) {
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
    
    const newContent = content.replace(/from\s+["'](\.[^"']+)["']/g, (match, specifier) => {
      // Clean up previous bad patches if any
      let baseSpecifier = specifier.endsWith('.js') ? specifier.slice(0, -3) : specifier;
      
      const absoluteTarget = path.resolve(path.dirname(filePath), baseSpecifier);
      if (fs.existsSync(absoluteTarget) && fs.statSync(absoluteTarget).isDirectory()) {
        return 'from "' + baseSpecifier + '/index.js"';
      }
      return 'from "' + baseSpecifier + '.js"';
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
