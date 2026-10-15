import {experimentStoreSchema,resultAssociationsSchema} from '../../shared/results.ts'
import {id,type Ledger} from '../../shared/schema.ts'
import {digest,json,type FileStore} from '../store/files.ts'
import {invariant,parseStored} from '../../shared/errors.ts'

/** Current internal support, including exact dependencies of confirmed arithmetic. */
export async function resultProofs(io:FileStore,ledger:Ledger,materialHashes:Record<string,string>){
  const file=await io.read('.scholarflow/research/experiments.json'),experiments=file?parseStored(experimentStoreSchema,file.text,'RESULT_VERSION_UNSUPPORTED','review.results'):undefined
  invariant(!experiments||experiments.projectId===ledger.projectId,'PROJECT_ID_CONFLICT','实验记录不属于当前项目。')
  const associationsFile=await io.read('.scholarflow/research/result-associations.json'),associations=associationsFile?parseStored(resultAssociationsSchema,associationsFile.text,'RESULT_LINKS_INVALID','review.results'):undefined
  invariant(!associations||associations.projectId===ledger.projectId,'PROJECT_ID_CONFLICT','结果关联不属于当前项目。')
  const figures=[]
  for(const association of Object.values(associations?.records??{})){
    const record=experiments?.records[association.experimentId];if(!record||record.status!=='current')continue
    for(const figure of association.figures){let currentHash='unavailable';const material=Object.values(ledger.materials).find(row=>row.projectRelativePath===figure.path)
      if(material&&materialHashes[material.id]?.startsWith('sha256:'))try{currentHash=digest(await io.readBytes(figure.path,20*1024*1024))}catch{}
      figures.push({...figure,experimentId:record.id,currentHash,current:association.experimentHash===digest(json(record))&&currentHash===figure.hash})}
  }
  const comparisons:Array<{id:string;evidenceIds:string[];values:number[];current:boolean;record:Record<string,unknown>}>=[],hashes:Record<string,string>={}
  const directory='.scholarflow/research/comparisons'
  if(await io.stat(directory))for(const entry of await io.list(directory))if(entry.type==='file'&&entry.path.endsWith('.json')){
    const file=await io.read(entry.path);invariant(file,'RESULT_COMPARISON_INVALID','比较记录缺失。');hashes[entry.path]=digest(file.text)
    const record=JSON.parse(file.text),{planHash,confirmedAt,confirmedBy,...body}=record
    invariant(record.projectId===ledger.projectId&&typeof confirmedAt==='string'&&typeof confirmedBy==='string'&&digest(json(body))===planHash&&record.comparison?.comparability==='comparable','RESULT_COMPARISON_INVALID','比较记录身份、确认或字节无效。')
    id.parse(record.id)
    const evidenceIds=[record.left.evidenceId,record.right.evidenceId],current=evidenceIds.every((evidenceId,index)=>{const evidence=ledger.evidence[evidenceId],source=evidence&&ledger.sources[evidence.sourceId],ref=index===0?record.left:record.right,experiment=experiments?.records[ref.experimentId]
      return experiment?.status==='current'&&experiment.measurementEvidenceIds.includes(evidenceId)&&evidence?.validation==='located'&&digest(json(evidence))===ref.evidenceHash&&source?.kind==='user-result'&&source.materialId&&materialHashes[source.materialId]===evidence.sourceContentHash})
    comparisons.push({id:record.id,evidenceIds,values:[record.comparison.absoluteChange,record.comparison.relativePercent,record.left.value,record.right.value].filter((value):value is number=>typeof value==='number'&&Number.isFinite(value)),current,record})
  }
  return {experiments,associations,figures,comparisons,hashes}
}
