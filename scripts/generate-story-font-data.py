from pathlib import Path
import argparse, hashlib, fontTools
parser=argparse.ArgumentParser(description='Regenerate font identities and Unicode coverage from the pinned, unmodified local font binaries.')
parser.add_argument('--check', action='store_true'); args=parser.parse_args()
if fontTools.__version__ != '4.60.2': raise SystemExit('Use fontTools 4.60.2 to reproduce this inspection.')
from fontTools.ttLib import TTFont
import json
root=Path(__file__).resolve().parents[1];directory=root/'src/assets/story-type-v1'
p=json.loads((directory/'provenance.json').read_text());entries=[]
def write(path, text):
 if args.check:
  if path.read_text()!=text: raise SystemExit(f'Outdated font metadata: {path}')
 else: path.write_text(text)
for font in p['fonts']:
 for file in font['files']:
  data=(directory/file['path']).read_bytes()
  assert len(data)==file['bytes'] and hashlib.sha256(data).hexdigest()==file['sha256'], file['path']
 info=font['files'][0];f=TTFont(directory/info['path'])
 axes={a.axisTag:[a.minValue,a.defaultValue,a.maxValue] for a in f['fvar'].axes}
 points=sorted(f.getBestCmap());ranges=[]
 for n in points:
  if ranges and n==ranges[-1][1]+1:ranges[-1][1]=n
  else:ranges.append([n,n])
 name=f['name'].getDebugName(16) or f['name'].getDebugName(1);weight=axes['wght']
 entry={'role':font['role'],'path':info['path'],'asset':{'id':'story-font-'+info['sha256'],'kind':'font','name':name,'type':'font/ttf','byteLength':info['bytes'],'sha256':info['sha256'],'orientation':'upright','license':'OFL-1.1','fontFace':{'weight':f'{int(weight[0])} {int(weight[2])}','style':'normal'}},'codepoints':ranges,'axes':axes,'version':f['name'].getDebugName(5)}
 entries.append(entry)
module=root/'src/styles/font-pack-data.js'
write(module,'// Generated from the unmodified files pinned in src/assets/story-type-v1/provenance.json.\n// Unicode coverage comes from each binary cmap; ranges do not certify shaping quality.\nexport const STORY_FONT_DATA = '+json.dumps(entries,separators=(',',':'),ensure_ascii=False)+';\n')
write(directory/'inspection.json',json.dumps({'fonttools_version':'4.60.2','fonts':[{'role':e['role'],'version':e['version'],'axes':e['axes'],'unicode_codepoints':sum(b-a+1 for a,b in e['codepoints'])} for e in entries]},indent=2)+'\n')
print(json.dumps([{'role':e['role'],'name':e['asset']['name'],'bytes':e['asset']['byteLength'],'cmap_ranges':len(e['codepoints']),'weight':e['asset']['fontFace']['weight']} for e in entries]))
