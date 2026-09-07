"""Build pinned 807 data and site-hosted British audio for the independent modules."""
import asyncio
import hashlib
import json
from pathlib import Path
import argparse
import edge_tts

ROOT = Path(__file__).resolve().parents[1]
VOICE = 'en-GB-SoniaNeural'
def read(path): return json.loads((ROOT / path).read_text(encoding='utf-8'))
def write(path, data):
    target=ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(data, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
def build():
    raw=(ROOT/'source/807.txt').read_text(encoding='utf-8')
    terms=list(dict.fromkeys(line.strip().lower() for line in raw.splitlines() if line.strip() and not line.startswith('#')))
    assert len(terms)==1854, f'Unexpected source size {len(terms)}'
    conf=read('confusions/data/confusions.json')
    groups=conf['groups'] if isinstance(conf,dict) else conf
    texts=list(dict.fromkeys(terms+[t[field] for g in groups for t in g['terms'] for field in ['term','chunk']]))
    existing={i.get('audioText',i['term']).strip().lower():i['audioPath'] for i in read('data/listening.json') if (ROOT/i['audioPath']).exists()}
    mapping={text:existing.get(text.lower(), 'module-audio/'+hashlib.sha256(text.encode()).hexdigest()[:20]+'.mp3') for text in texts}
    write('807/data/terms.json',{'source':'https://github.com/golowper/807WordsRepo/blob/main/807.txt','snapshotDate':'2026-09-07','sourceSha256':hashlib.sha256(raw.encode()).hexdigest(),'count':len(terms),'terms':terms})
    write('module-audio/manifest.json',{'voice':VOICE,'synthetic':True,'items':mapping})
    return mapping
async def main():
    parser=argparse.ArgumentParser();parser.add_argument('--manifest-only',action='store_true');args=parser.parse_args()
    mapping=build()
    if args.manifest_only: print(json.dumps({'mapped':len(mapping)}));return
    sem=asyncio.Semaphore(4);done=0;failed=[]
    async def generate(text,path):
        nonlocal done
        target=ROOT/path
        if target.exists() and target.stat().st_size>500:return
        async with sem:
            for attempt in range(4):
                try:
                    await asyncio.wait_for(edge_tts.Communicate(text,VOICE,rate='-8%').save(str(target)),40)
                    if target.stat().st_size<=500:raise ValueError('empty audio')
                    done+=1
                    if done%50==0:print(json.dumps({'generated':done}),flush=True)
                    return
                except Exception as error:
                    if attempt==3:failed.append({'text':text,'error':str(error)[:120]})
                    else:await asyncio.sleep(attempt+1)
    await asyncio.gather(*(generate(t,p) for t,p in mapping.items()))
    print(json.dumps({'mapped':len(mapping),'generated':done,'failed':failed},ensure_ascii=False),flush=True)
    if failed:raise SystemExit(1)
if __name__=='__main__':asyncio.run(main())
