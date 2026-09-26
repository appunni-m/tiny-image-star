from pathlib import Path
import datetime, hashlib, json, tarfile

root = Path('/Users/lazytrot/work/tiny-image-star')
out = root / 'docs/research/2026-09-20/scene-collections'
def digest(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def read(name): return json.loads((out / name).read_text())
assert not (out / 'verification.json').exists()

for name in ['source-browser.log', 'packaged-browser.log']:
    assert 'verify:browser PASS' in (out / name).read_text()
unit = (out / 'unit.log').read_text()
assert 'ℹ tests 38' in unit and 'ℹ tests 147' in unit and unit.count('ℹ fail 0') == 2
assert 'verify:folder-recovery PASS' in (out / 'recovery.log').read_text()
assert '231 files' in (out / 'package.log').read_text()

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

def collection_observations(filename):
    log = (out / filename).read_text()
    observed = json.loads(next(line.split(': ', 1)[1] for line in log.splitlines() if line.startswith('scene collection observations: ')))
    assert observed['independentOutputs'] == 48
    assert [row['workers'] for row in observed['runs']] == [1, 4, 8]
    assert all(row == {'workers': row['workers'], 'peak': row['workers'], 'violations': 0, 'checked': 16} for row in observed['runs'])
    assert 1 <= observed['pausePreserved'] < 16
    for key in ['retryPreserved', 'reloadWithoutLibrary', 'immutable', 'phoneReview', 'phoneCreate', 'quotaAtomic', 'renderWarningsVisible', 'browserBack']:
        assert observed[key] is True
    return observed
assert 'focused scene collections PASS' in (out / 'focused.log').read_text()
observations = {filename: collection_observations(filename) for filename in ['focused.log', 'source-browser.log', 'packaged-browser.log']}
jpeg_checks = {}
for filename in ['source-jpeg.log', 'packaged-jpeg.log']:
    log = (out / filename).read_text()
    assert 'focused scene JPEG PASS' in log
    observed = json.loads(next(line.split(': ', 1)[1] for line in log.splitlines() if line.startswith('scene JPEG observations: ')))
    assert observed['defaultFormat'] == 'jpeg' and observed['completed'] == 8 and len(observed['outputs']) == 8
    assert all(row == {'format': 'jpeg', 'jpeg': True, 'extension': True, 'match': True, 'dimensions': True} for row in observed['outputs'])
    jpeg_checks[filename] = observed

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
assert len(inventories['archive-files.json']) == 253 and len(inventories['packaged-files.json']) == 231
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
assert 'Documentation links OK: 88 Markdown files checked.' in (out / 'doc-links.log').read_text()
assert 'Findings: 0 error(s), 0 review item(s)' in (out / 'fixture-audit.log').read_text()
assert '0 compatible lanes; 3 unproven lanes' in (out / 'aggregate.log').read_text()
artifacts = [{'path': p.name, 'sha256': digest(p), 'bytes': p.stat().st_size} for p in sorted(out.iterdir()) if p.is_file()]
receipt = {
    'schema': 'tinystar/scene-collection-verification@1',
    'recordedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'scope': 'Durable selected-story groups with immutable scene and asset snapshots, complete slide/shape manifests, concurrent journaled outputs, reload, pause, failed-only retry and paged review.',
    'processingTarget': target,
    'archiveInventorySha256': digest(out / 'archive-files.json'),
    'packageInventorySha256': digest(out / 'packaged-files.json'),
    'inventoryCounts': {name: len(rows) for name, rows in inventories.items()},
    'checks': {
        'deterministic': {'scheduler': 38, 'modelAndDiagnostics': 147, 'total': 185},
        'sourceBrowser': 'pass', 'packagedBrowser': 'pass', 'folderRecovery': 'pass',
        'csp': browser_checks, 'sceneCollections': observations, 'defaultJPEG': jpeg_checks,
        'artifactFiles': 231, 'documentation': {'markdownFiles': 88, **doc_audit},
        'parity': {'runId': parity['identity']['run_id'], 'summary': parity['summary']},
        'coverage': {'runId': coverage['identity']['run_id'], 'threshold': threshold},
    },
    'limitations': [
        'Dirty local revision; no deployment or current throughput qualification.',
        'Groups are selected saved stories; automatic directory/fixed-size grouping and incomplete-group choices remain open.',
        'Directory saving and Web Locks are required; durable phone staging/share fallback remains open.',
        'Synthetic scenes, browser viewports and OPFS picker substitution do not qualify physical phones, native pickers or filesystem crashes.',
        'The 1000-group and 100000-output model bounds are not advertised-scale qualifications; the original story-library asset budget still applies.',
        'PNG checks cover custom fonts, looks and crops; the supplemental default-JPEG checks omit custom fonts.',
        'Memory reservations are not measurements of complete native memory; current throughput and maximum-effect capacity remain unqualified.',
        'Complete per-image scene styles, source/application identity, production HTTP headers and other migration/release gates remain open.',
    ],
    'artifacts': artifacts,
}
with (out / 'verification.json').open('x') as handle: handle.write(json.dumps(receipt, indent=2) + '\n')
for row in read('verification.json')['artifacts']: assert digest(out / row['path']) == row['sha256']
print(json.dumps({'sealedArtifacts': len(artifacts), 'archiveFiles': 253, 'siteFiles': 231, 'cspRuns': len(browser_checks), 'scenePNGOutputsPerRun': 48, 'defaultJPEGOutputsPerRun': 8, 'productionReady': False}))
