from pathlib import Path
import datetime, hashlib, json, tarfile

root = Path('/Users/lazytrot/work/tiny-image-star')
out = root / 'docs/research/2026-09-20/folder-sources'
def digest(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def read(name): return json.loads((out / name).read_text())
assert not (out / 'verification.json').exists()

for name in ['source-browser.log', 'packaged-browser.log']:
    assert 'verify:browser PASS' in (out / name).read_text()
unit = (out / 'unit.log').read_text()
assert 'ℹ tests 38' in unit and 'ℹ tests 143' in unit and unit.count('ℹ fail 0') == 2
assert 'verify:folder-recovery PASS' in (out / 'recovery.log').read_text()
assert '223 files' in (out / 'package.log').read_text()

browser_checks = []
for filename in ['source-security.json', 'packaged-security.json']:
    report = read(filename)
    assert report['schema'] == 'tinystar/csp-browser-verification@1'
    assert [(r['browser'], r['mode']) for r in report['runs']] == [
        ('chromium', 'meta'), ('chromium', 'headers'), ('webkit', 'meta'), ('webkit', 'headers')]
    for run in report['runs']:
        workflow = run['workflow']
        assert workflow['count'] == 4 and workflow['peak'] == 2
        assert workflow['dimensions'] == [8, 8] and workflow['font'] == 'loaded' and workflow['bytes'] > 0
        document = run['document']
        for key in ['eval', 'function', 'fetch', 'post', 'redirect', 'import', 'wasm', 'blob', 'inlineStyleBlocked', 'styleProperty', 'baseUnchanged', 'beaconBlocked', 'font', 'blobWorker']:
            assert document[key] is True, (filename, key)
        assert document['executed'] is False and document['violations']
        assert all(v['disposition'] == 'enforce' for v in document['violations'])
        assert run['documentSinkRequests'] == 0
        protected = run['mode'] == 'headers'
        for key in ['eval', 'function', 'fetch', 'post', 'redirect', 'import']:
            assert run['worker'][key] is protected
        assert run['worker']['executed'] is not protected
        assert run['framingBlocked'] is protected
        assert run['worker']['wasm'] is True and run['worker']['blob'] is True
        expected_requests = [] if protected else [
            {'method': 'GET', 'path': '/fetch'}, {'method': 'POST', 'path': '/post'},
            {'method': 'GET', 'path': '/redirect'}, {'method': 'GET', 'path': '/module.js'}]
        assert run['workerSinkRequests'] == expected_requests
        if protected and run['browser'] == 'chromium': assert run['worker']['violations']
        if protected and run['browser'] == 'webkit': assert run['worker']['violations'] == []
        browser_checks.append({'artifact': filename, 'browser': run['browser'], 'version': run['version'], 'mode': run['mode'], 'outcome': 'pass'})

observations = json.loads(next(line.split(': ', 1)[1] for line in (out / 'focused.log').read_text().splitlines() if line.startswith('folder source observations: ')))
assert 'focused folder sources PASS' in (out / 'focused.log').read_text()
assert observations['independentOutputs'] == 27
for key in ['staleEntry', 'sameMetadataReplacement', 'explicitRepair', 'reload', 'oneWinner', 'staleClaim', 'staleOwner', 'journal', 'preview', 'saveFence']: assert observations[key] is True
assert [row['workers'] for row in observations['runs']] == [1, 4, 8]
assert all(row == {'workers': row['workers'], 'peak': row['workers'], 'violations': 0, 'matched': True, 'pinned': True, 'completed': 9} for row in observations['runs'])
for name in ['source-browser.log', 'packaged-browser.log']:
    observed = json.loads(next(line.split(': ', 1)[1] for line in (out / name).read_text().splitlines() if line.startswith('folder source observations: ')))
    assert observed == observations

inventories = {}
for name, base in [('source-files.json', root), ('archive-files.json', root), ('packaged-files.json', root / '_site')]:
    rows = read(name)
    for row in rows:
        assert digest(base / row['path']) == row['sha256'], row['path']
        assert (base / row['path']).stat().st_size == row['bytes']
    inventories[name] = rows
target = read('target.json')
identity = hashlib.sha256(json.dumps([[r['path'], r['sha256']] for r in inventories['source-files.json']], separators=(',', ':')).encode()).hexdigest()
assert target['revision'].split(':')[-1] == identity
assert len(inventories['archive-files.json']) == 247 and len(inventories['packaged-files.json']) == 223
for filename, inventory in [('verified-source.tar.gz', 'archive-files.json'), ('tested-site.tar.gz', 'packaged-files.json')]:
    with tarfile.open(out / filename) as bundle:
        rows = inventories[inventory]
        assert sorted(bundle.getnames()) == sorted(row['path'] for row in rows)
        for row in rows: assert hashlib.sha256(bundle.extractfile(row['path']).read()).hexdigest() == row['sha256']
parity, coverage = read('parity.json'), read('coverage.json')
assert parity['identity']['targets'][0] == coverage['identity']['targets'][0] == target
assert parity['summary']['passed'] == parity['summary']['selected'] == 33 and not parity['infrastructure_errors']
assert all(row['outcome'] == 'pass' for row in parity['comparisons']) and not coverage['infrastructure_errors']
threshold = coverage['plans'][0]['components'][0]['thresholds'][0]
assert threshold == {'dimension': 'function', 'minimum_percent': 70, 'covered': 27, 'total': 35, 'outcome': 'pass'}
assert (out / 'diff-check.log').read_text() == ''
doc_audit = read('doc-audit.json')['summary']
assert doc_audit['errors'] == 0
assert 'Documentation links OK: 86 Markdown files checked.' in (out / 'doc-links.log').read_text()
assert 'Findings: 0 error(s), 0 review item(s)' in (out / 'fixture-audit.log').read_text()
assert '0 compatible lanes; 3 unproven lanes' in (out / 'aggregate.log').read_text()
artifacts = [{'path': p.name, 'sha256': digest(p), 'bytes': p.stat().st_size} for p in sorted(out.iterdir()) if p.is_file()]
receipt = {
    'schema': 'tinystar/folder-source-verification@1',
    'recordedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'scope': 'First-read durable source identity, canonical manifest requests, repair permission, inspection/render/save validation and concurrent recovery.',
    'processingTarget': target,
    'archiveInventorySha256': digest(out / 'archive-files.json'),
    'packageInventorySha256': digest(out / 'packaged-files.json'),
    'inventoryCounts': {name: len(rows) for name, rows in inventories.items()},
    'checks': {
        'deterministic': {'scheduler': 38, 'modelAndDiagnostics': 143, 'total': 181},
        'sourceBrowser': 'pass', 'packagedBrowser': 'pass', 'folderRecovery': 'pass',
        'csp': browser_checks, 'folderSources': observations,
        'artifactFiles': 223, 'documentation': {'markdownFiles': 86, **doc_audit},
        'parity': {'runId': parity['identity']['run_id'], 'summary': parity['summary']},
        'coverage': {'runId': coverage['identity']['run_id'], 'threshold': threshold},
    },
    'limitations': [
        'Dirty local revision; no deployment or current throughput qualification.',
        'Initial source identity is captured at first admitted processing, not discovery; untouched files remain unbound.',
        'Browser viewport and OPFS picker substitution do not qualify physical phones, native pickers or filesystem crashes.',
        'The constant-timestamp shim isolates digest enforcement; reload fixture binding is explicit, while a separate real-worker race proves inspection binding.',
        'Memory reservations and time estimates are not measurements of complete native memory or production throughput.',
        'Grouped story queues, per-image scene styles, durable variants, complete source/application identity and full production gates remain open.',
        'Production HTTP security headers remain unqualified; no hosting change was made.',
    ],
    'artifacts': artifacts,
}
with (out / 'verification.json').open('x') as handle: handle.write(json.dumps(receipt, indent=2) + '\n')
for row in read('verification.json')['artifacts']: assert digest(out / row['path']) == row['sha256']
print(json.dumps({'sealedArtifacts': len(artifacts), 'archiveFiles': 247, 'siteFiles': 223, 'cspRuns': len(browser_checks), 'folderSourceOutputs': 27, 'productionReady': False}))
