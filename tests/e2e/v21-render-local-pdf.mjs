// Independent visual inspection with the native Chromium PDF viewer; source bytes remain read-only.
import {createServer} from 'node:http'
import {readFile,mkdir} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {chromium} from '@playwright/test'
const source=resolve(process.argv[2]),output=resolve(process.argv[3]),pages=process.argv.slice(4).map(Number),bytes=await readFile(source)
if(!pages.length||pages.some(n=>!Number.isSafeInteger(n)||n<1))throw Error('Explicit physical pages required')
const server=createServer((request,response)=>{if(request.url?.split('#')[0]==='/source.pdf'){response.writeHead(200,{'content-type':'application/pdf'});response.end(bytes)}else{response.writeHead(404);response.end()}})
await new Promise(done=>server.listen(0,'127.0.0.1',done));const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});await mkdir(output,{recursive:true})
try{for(const physicalPage of pages){const page=await browser.newPage({viewport:{width:1200,height:1600}});await page.goto('http://127.0.0.1:'+server.address().port+'/source.pdf#page='+physicalPage+'&zoom=100');await page.waitForTimeout(2500);await page.screenshot({path:join(output,'page-'+physicalPage+'.png')});await page.close()}console.log(JSON.stringify({source,output,pages,viewer:'native Chromium PDF viewer; verify screenshots independently'}))}finally{await browser.close();await new Promise(done=>server.close(done))}