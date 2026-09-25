// Local-only lifecycle fixture. No filesystem, network, credentials or external tools.
import {createInterface} from 'node:readline';
const mode=process.argv[2]??'good';
process.on('SIGTERM',()=>{}); // Exercise the parent's bounded escalation and physical close join.
const heartbeat=setInterval(()=>{},1000);
if(mode==='raw-final'){
  setTimeout(()=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:1,result:{final:true}})+'\n',()=>process.exit(0)),10);
}else{
  const lines=createInterface({input:process.stdin,terminal:false});
  const send=value=>process.stdout.write(JSON.stringify(value)+'\n');
  lines.on('line',line=>{
    let message;try{message=JSON.parse(line);}catch{return;}
    if(message.id===undefined)return;
    const {id,method}=message;
    if(method==='initialize'){
      send({jsonrpc:'2.0',id,result:{protocolVersion:mode==='bad'?'unsupported-fixture':'2025-06-18',capabilities:{},serverInfo:{name:'local-fixture',version:'1.0.0'}}});
    }else if(method==='tools/list')send({jsonrpc:'2.0',id,result:{tools:[]}});
    else if(method==='ping'&&mode==='health-bad')send({jsonrpc:'2.0',id,error:{code:-32000,message:'fixture health failure'}});
    else if(method==='tools/call')send({jsonrpc:'2.0',id,result:{content:[{type:'text',text:'fixture'}],isError:false}});
    else send({jsonrpc:'2.0',id,result:{}});
  });
  // Readiness observation for transport-only tests; not part of the client handshake.
  send({jsonrpc:'2.0',method:'fixture/ready'});
}
process.on('exit',()=>clearInterval(heartbeat));
