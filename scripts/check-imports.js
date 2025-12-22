const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '../site/js');

function getAllFiles(dir, fileList = []) {
    const files = fs.readdirSync(dir);
    files.forEach(file => {
        const filePath = path.join(dir, file);
        if (fs.statSync(filePath).isDirectory()) {
            getAllFiles(filePath, fileList);
        } else {
            if (filePath.endsWith('.js')) {
                fileList.push(filePath);
            }
        }
    });
    return fileList;
}

const files = getAllFiles(rootDir);
const exportsMap = {}; // filePath -> Set(exportedNames)
const importsMap = {}; // filePath -> [ { names: [], source: '' } ]

// Helper to resolve path
function resolveImportPath(currentFile, importPath) {
    if (importPath.startsWith('.')) {
        return path.resolve(path.dirname(currentFile), importPath);
    }
    return null; // Ignore absolute or node_modules imports for now
}

// 1. Parse Exports
files.forEach(file => {
    const content = fs.readFileSync(file, 'utf-8');
    const exports = new Set();
    
    // export function/const/class Name
    const declRegex = /export\s+(?:async\s+)?(?:function|class|const|let|var)\s+([a-zA-Z0-9_$]+)/g;
    let match;
    while ((match = declRegex.exec(content)) !== null) {
        exports.add(match[1]);
    }

    // export { Name }
    const listRegex = /export\s+\{\s*([^}]+)\s*\}/g;
    while ((match = listRegex.exec(content)) !== null) {
        const names = match[1].split(',').map(s => s.trim());
        names.forEach(n => {
            const parts = n.split(/\s+as\s+/);
            exports.add(parts[parts.length - 1]);
        });
    }
    
    // export default
    if (/export\s+default/.test(content)) {
        exports.add('default');
    }

    exportsMap[file] = exports;
});

// 2. Parse Imports and Validate
let errors = 0;

files.forEach(file => {
    const content = fs.readFileSync(file, 'utf-8');
    
    // import { X, Y } from './Z.js'
    const importRegex = /import\s+\{\s*([^}]+)\s*\}\s+from\s+['"]([^'"]+)['"]/g;
    let match;
    while ((match = importRegex.exec(content)) !== null) {
        const names = match[1].split(',').map(s => s.trim());
        const source = match[2];
        const targetFile = resolveImportPath(file, source);
        
        if (targetFile) {
            // Check file existence
            // Try explicit extension first, usually .js in this project
            let resolvedPath = targetFile;
             if (!fs.existsSync(resolvedPath) && fs.existsSync(targetFile + '.js')) {
                resolvedPath = targetFile + '.js';
            }

            if (!fs.existsSync(resolvedPath)) {
                console.error(`[ERROR] File ${path.relative(rootDir, file)} imports from missing file: ${source}`);
                errors++;
                continue;
            }

            const targetExports = exportsMap[resolvedPath];
            if (!targetExports) {
                 // Should not happen if getAllFiles works and file exists
                 continue;
            }

            names.forEach(name => {
                const parts = name.split(/\s+as\s+/);
                const importName = parts[0]; // The name we look for in exports
                if (!targetExports.has(importName)) {
                    console.error(`[ERROR] File ${path.relative(rootDir, file)} imports '${importName}' from '${path.relative(rootDir, resolvedPath)}' but it is not exported.`);
                    errors++;
                }
            });
        }
    }
});

if (errors > 0) {
    console.log(`Found ${errors} import errors.`);
    process.exit(1);
} else {
    console.log('No static import errors found.');
}
