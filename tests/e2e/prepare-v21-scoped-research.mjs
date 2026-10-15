// Select relevant portions of the actual experiment log; preserve the original complete run.
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {json,digest} from '../../src/core/store/files.ts'
const original=resolve(process.argv[2]),manifest=JSON.parse(await readFile(join(original,'manifest.json'),'utf8')),run=JSON.parse(await readFile(join(original,'experiment.json'),'utf8')),root=join(original,'focused-'+Date.now())
await mkdir(root,{recursive:true})
for(const task of manifest.research){const source=task.directory,directory=join(root,task.id),systems=task.id==='R02-systems';await mkdir(directory,{recursive:true})
  const settings=systems?{node:run.settings.node,cpu:run.settings.cpu,platform:run.settings.platform,arch:run.settings.arch,rows:20000,columns:2,warmupRuns:1,timedRunsPerMethod:5,protocol:run.settings.protocol,scope:'unquoted input; one process; no concurrency; no cross-hardware claims'}:
    {node:run.settings.node,documents:run.documents.length,testQueries:run.queries.length,aliasPairs:Object.keys(run.aliases).length,training:'none',aliasTuning:'none',tieBreak:'ascending document identifier',scope:'self-authored synthetic validation corpus; measured values are actual executions, not a fixture and not population-representative'}
  const selectedRun=systems?{origin:run.origin,executedAt:run.date,scriptHash:run.settings.scriptHash,settings,timings:run.timings}:
    {origin:run.origin,executedAt:run.date,scriptHash:run.settings.scriptHash,settings,documents:run.documents,queries:run.queries,aliases:run.aliases,retrieval:task.id==='R05-update'?run.retrieval.filter(r=>r.method==='fixed-alias-overlap'):run.retrieval}
  await copyFile(join(source,'results.csv'),join(directory,'results.csv'));if(task.id==='R05-update')await copyFile(join(source,'results-v2.csv'),join(directory,'results-v2.csv'))
  await copyFile(join(source,'method.md'),join(directory,'method.md'));await writeFile(join(directory,'settings.json'),json(settings));await writeFile(join(directory,'experiment.json'),json(selectedRun))
  await writeFile(join(directory,'requirements.txt'),task.requirements);task.directory=directory;task.requirements+=' The original supplied records are actual executions on synthetic inputs. Synthetic corpus does not mean invented measurements. Discuss only this selected task and its confirmed results; do not import unrelated experiments from other validation cases. Use the registered full claim IDs and retain exact raw metric values.'
}
manifest.root=root;manifest.parentExperiment=join(original,'experiment.json');manifest.parentExperimentHash=digest(await readFile(manifest.parentExperiment));manifest.scopeSelection='relevant records from one actual complete experiment; complete parent retained unchanged; no experiment rerun or alteration of measured CSV values';await writeFile(join(root,'manifest.json'),json(manifest));console.log(JSON.stringify({root,research:manifest.research.length,parentHash:manifest.parentExperimentHash}))
