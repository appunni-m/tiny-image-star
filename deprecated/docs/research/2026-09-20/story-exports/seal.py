from pathlib import Path
import hashlib,json,tarfile,datetime
root=Path('/Users/lazytrot/work/tiny-image-star')
out=root/'docs/research/2026-09-20/story-exports'
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def read(p):return json.loads(p.read_text())
assert not (out/'verification.json').exists()
for name in ['source-browser.log','packaged-browser.log']:
 assert 'verify:browser PASS' in (out/name).read_text(),name
log=(out/'unit.log').read_text()
assert 'ℹ tests 38' in log and 'ℹ tests 137' in log and log.count('ℹ fail 0')==2
assert 'verify:folder-recovery PASS' in (out/'recovery.log').read_text()
assert '214 files' in (out/'package.log').read_text()
assert 'focused story exports PASS' in (out/'focused.log').read_text()
observations=json.loads(next(line.split(': ',1)[1] for line in (out/'focused.log').read_text().splitlines() if line.startswith('story export observations: ')))
assert observations['fullSizeOutputs']==8 and observations['retryPreserved']==7 and observations['pausePreserved']==1
assert all(run['concurrency']==run['peak'] and run['violations']==0 and run['checked']==8 for run in observations['runs'])
assert observations['savedShapes']==['portrait','tall']
for key in ['sourceEditsUnchanged','reusableOutputStyle','activeBackCleanup','pendingShareRetained']:assert observations[key]
for name in ['source-browser.log','packaged-browser.log']:
 observed=json.loads(next(line.split(': ',1)[1] for line in (out/name).read_text().splitlines() if line.startswith('story export observations: ')))
 assert observed==observations,name
target=read(out/'target.json')
inventories={}
for name,base in [('source-files.json',root),('archive-files.json',root),('packaged-files.json',root/'_site')]:
 rows=read(out/name)
 for row in rows:
  assert digest(base/row['path'])==row['sha256'],row['path']
  assert (base/row['path']).stat().st_size==row['bytes'],row['path']
 inventories[name]=rows
identity=hashlib.sha256(json.dumps([[r['path'],r['sha256']] for r in inventories['source-files.json']],separators=(',',':')).encode()).hexdigest()
assert target['revision'].split(':')[-1]==identity
for filename,inventory in [('verified-source.tar.gz','archive-files.json'),('tested-site.tar.gz','packaged-files.json')]:
 with tarfile.open(out/filename) as bundle:
  rows=inventories[inventory]
  assert sorted(bundle.getnames())==sorted(row['path'] for row in rows)
  for row in rows:assert hashlib.sha256(bundle.extractfile(row['path']).read()).hexdigest()==row['sha256']
p=read(out/'parity.json');c=read(out/'coverage.json')
assert p['identity']['targets'][0]==c['identity']['targets'][0]==target
assert p['summary']['passed']==p['summary']['selected']==33 and not p['infrastructure_errors']
assert all(x['outcome']=='pass' for x in p['comparisons']) and not c['infrastructure_errors']
threshold=c['plans'][0]['components'][0]['thresholds'][0]
assert threshold=={'dimension':'function','minimum_percent':70,'covered':27,'total':35,'outcome':'pass'}
assert (out/'diff-check.log').read_text()==''
docAudit=read(out/'doc-audit.json')['summary']
assert docAudit['errors']==0
assert 'Documentation links OK: 80 Markdown files checked.' in (out/'doc-links.log').read_text()
assert 'Findings: 0 error(s), 0 review item(s)' in (out/'fixture-audit.log').read_text()
artifacts=[{'path':p.name,'sha256':digest(p),'bytes':p.stat().st_size} for p in sorted(out.iterdir()) if p.is_file()]
receipt={'schema':'tinystar/story-export-verification@1','recordedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'target':target,
 'scope':'Multiple-shape story exports, reusable output styles, immutable concurrent preparation, partial failure, pause, retry and cancellation.',
 'inventoryCounts':{name:len(rows) for name,rows in inventories.items()},
 'checks':{'deterministic':{'scheduler':38,'modelAndDiagnostics':137,'total':175},'sourceBrowser':'pass','packagedBrowser':'pass','folderRecovery':'pass','artifactFiles':214,'documentation':{'markdownFiles':80,**docAudit},'focused':observations,'parity':{'runId':p['identity']['run_id'],'summary':p['summary']},'coverage':{'runId':c['identity']['run_id'],'threshold':threshold}},
 'limitations':['Dirty local development revision; no deployment or release certification.','Previous canonical timing target differs; no new throughput qualification.','Browser-managed OPFS and viewport tests do not qualify physical devices or native filesystem crashes.','Prepared files and progress last only while the export sheet stays open; durable grouped collection queues remain unimplemented.','Complete migration and production gates remain open.'],
 'artifacts':artifacts}
with (out/'verification.json').open('x') as handle:handle.write(json.dumps(receipt,indent=2)+'\n')
for row in read(out/'verification.json')['artifacts']:assert digest(out/row['path'])==row['sha256']
print(json.dumps({'sealedArtifacts':len(artifacts),'target':target['revision'],'checks':'pass','productionReady':False}))
