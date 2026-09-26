from pathlib import Path
import hashlib, json, tarfile

root = Path('/Users/lazytrot/work/tiny-image-star')
out = root / 'docs/research/2026-09-20/folder-contracts'
parity = json.loads((root / '.migration-results/parity-6533c6ff-cad1-47a3-bd4a-ff785bbfee34/parity.json').read_text())
target = parity['identity']['targets'][0]

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def rows(paths, base):
    return [{'path': str(p.relative_to(base)), 'sha256': digest(p), 'bytes': p.stat().st_size} for p in paths if p.is_file()]

source = rows(sorted((root / 'src').rglob('*')) + sorted((root / 'scripts/migration').rglob('*')) +
              [root / p for p in ['wasm/pillow_rs_js.js', 'wasm/pillow_rs_js_bg.wasm', 'package-lock.json']], root)
identity = hashlib.sha256(json.dumps([[r['path'], r['sha256']] for r in source], separators=(',', ':')).encode()).hexdigest()
assert target['revision'].split(':')[-1] == identity
package = rows(sorted((root / '_site').rglob('*')), root / '_site')
archive = rows(sorted({p for directory in ['src', 'scripts', 'tests', 'wasm'] for p in (root / directory).rglob('*') if p.is_file()} |
                      {root / p for p in ['index.html', 'styles.css', 'package.json', 'package-lock.json', 'Makefile']}), root)
for name, data in [('source-files.json', source), ('packaged-files.json', package), ('archive-files.json', archive), ('target.json', target)]:
    with (out / name).open('x') as handle:
        handle.write(json.dumps(data, indent=2) + '\n')

for name, entries, base in [('verified-source.tar.gz', archive, root), ('tested-site.tar.gz', package, root / '_site')]:
    with tarfile.open(out / name, 'x:gz') as bundle:
        for row in entries:
            path = base / row['path']
            assert digest(path) == row['sha256'] and path.stat().st_size == row['bytes']
            bundle.add(path, arcname=row['path'])
    with tarfile.open(out / name) as bundle:
        assert sorted(bundle.getnames()) == sorted(row['path'] for row in entries)
        for row in entries:
            assert hashlib.sha256(bundle.extractfile(row['path']).read()).hexdigest() == row['sha256']

print(json.dumps({'source_inputs': len(source), 'archive_files': len(archive), 'packaged_files': len(package), 'target': target}))
