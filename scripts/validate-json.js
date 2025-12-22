const fs = require('fs');
const path = require('path');

function walk(dir, callback) {
  const files = fs.readdirSync(dir);
  files.forEach(file => {
    const filepath = path.join(dir, file);
    const stats = fs.statSync(filepath);
    if (stats.isDirectory()) {
      walk(filepath, callback);
    } else if (stats.isFile()) {
      callback(filepath);
    }
  });
}

let hasError = false;

const siteDir = path.join(__dirname, '../site');
if (!fs.existsSync(siteDir)) {
    console.error(`Directory not found: ${siteDir}`);
    process.exit(1);
}

console.log(`Scanning ${siteDir} for .json files...`);

walk(siteDir, (filepath) => {
  if (path.extname(filepath) === '.json') {
    try {
      const content = fs.readFileSync(filepath, 'utf8');
      JSON.parse(content);
      // console.log(`✓ ${filepath}`);
    } catch (e) {
      console.error(`✖ Invalid JSON in ${filepath}:`);
      console.error(e.message);
      hasError = true;
    }
  }
});

if (hasError) {
  console.error('JSON validation failed.');
  process.exit(1);
} else {
  console.log('All JSON files are valid.');
}
